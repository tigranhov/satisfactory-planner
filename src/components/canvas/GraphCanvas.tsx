import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useActiveGraph, useActiveGraphId } from '@/hooks/useActiveGraph';
import { useGraphStore } from '@/store/graphStore';
import { useNavigationStore } from '@/store/navigationStore';
import { loadGameData } from '@/data/loader';
import RecipeNode from './nodes/RecipeNode';
import FactoryNode from './nodes/FactoryNode';
import InterfaceNode from './nodes/InterfaceNode';
import BlueprintNode from './nodes/BlueprintNode';
import HubNode from './nodes/HubNode';
import SplitterNode from './nodes/SplitterNode';
import MergerNode from './nodes/MergerNode';
import RateEdge from './edges/RateEdge';
import CanvasContextMenu from './CanvasContextMenu';
import NodeContextMenu from './NodeContextMenu';
import EdgeContextMenu from './EdgeContextMenu';
import DragDropMenu, { type DragDropChoice } from './DragDropMenu';
import { computeFlows, type HandleFlow, type SubgraphResolver } from '@/models/flow';
import { useSubgraphResolver } from '@/hooks/useSubgraphResolver';
import {
  HUB_IN_HANDLE,
  HUB_OUT_HANDLE,
  MERGER_IN_HANDLES,
  MERGER_OUT_HANDLE,
  SPLITTER_IN_HANDLE,
  SPLITTER_OUT_HANDLES,
  handleIdForIngredient,
  handleIdForInterface,
  handleIdForProduct,
  isHublikeKind,
  itemIdForHandle,
  itemsPerMinute,
  nodePowerMW,
  somersloopMultiplier,
} from '@/models/factory';
import { useBlueprintStore } from '@/store/blueprintStore';
import {
  extractSelectionToBlueprint,
  openBlueprintForEditing,
  placeBlueprintOnActiveGraph,
} from '@/hooks/useBlueprintEditorBridge';
import { ROOT_GRAPH_ID } from '@/lib/ids';
import type {
  BlueprintNodeData,
  Graph,
  GraphEdge,
  NodeData,
  RecipeNodeData,
} from '@/models/graph';

// Session-scoped clipboard of copied nodes + their internal edges. Stored at
// module scope so it survives component remounts (e.g. navigating subgraphs).
interface ClipboardPayload {
  nodes: Array<{ data: NodeData; position: { x: number; y: number }; origId: string }>;
  edges: Array<Omit<GraphEdge, 'id'>>;
}
let clipboard: ClipboardPayload | null = null;

const DUPLICATE_OFFSET = { x: 40, y: 40 };

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

const gameData = loadGameData();

// React Flow reserves the type names `input`, `output`, and `default` for its
// built-in node variants (they ship with light-theme styling). Route both
// of our interface kinds through an `interface` key instead so the defaults
// don't render as a white backplate under our node.
const nodeTypes = {
  recipe: RecipeNode,
  factory: FactoryNode,
  interface: InterfaceNode,
  blueprint: BlueprintNode,
  hub: HubNode,
  splitter: SplitterNode,
  merger: MergerNode,
};

function reactFlowTypeForKind(kind: NodeData['kind']): string {
  return kind === 'input' || kind === 'output' ? 'interface' : kind;
}
const edgeTypes = { rate: RateEdge };

function graphToFlow(graph: Graph, resolver: SubgraphResolver): { nodes: Node[]; edges: Edge[] } {
  const flows = computeFlows(graph, gameData, resolver);
  // Single edge pass → hub-like item by node. Avoids scanning graph.edges
  // once per hub-like during the node map below (H×E → O(E)).
  const hubIds = new Set<string>();
  for (const n of graph.nodes) if (isHublikeKind(n.data.kind)) hubIds.add(n.id);
  const hubItemByNode = new Map<string, string>();
  if (hubIds.size) {
    for (const e of graph.edges) {
      if (!e.itemId) continue;
      if (hubIds.has(e.source) && !hubItemByNode.has(e.source)) hubItemByNode.set(e.source, e.itemId);
      if (hubIds.has(e.target) && !hubItemByNode.has(e.target)) hubItemByNode.set(e.target, e.itemId);
    }
  }
  const nodes: Node[] = graph.nodes.map((n) => {
    const handleMap = flows.targetHandles.get(n.id);
    const handleFlows: Record<string, HandleFlow> = {};
    if (handleMap) for (const [hid, hf] of handleMap) handleFlows[hid] = hf;
    const extra: Record<string, unknown> = { handleFlows };
    if (hubIds.has(n.id)) extra.currentItemId = hubItemByNode.get(n.id) ?? null;
    return {
      id: n.id,
      position: n.position,
      type: reactFlowTypeForKind(n.data.kind),
      data: { ...(n.data as unknown as Record<string, unknown>), ...extra },
    };
  });
  const edges: Edge[] = graph.edges.map((e) => {
    const flow = flows.edges.get(e.id);
    return {
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      type: 'rate',
      data: {
        rate: flow?.rate ?? 0,
        satisfaction: flow?.satisfaction ?? 1,
        sourceUtilization: flow?.sourceUtilization ?? 0,
        itemId: e.itemId,
      },
    };
  });
  return { nodes, edges };
}

interface Props {
  onSelectNode: (id: string | null) => void;
}

export default function GraphCanvas({ onSelectNode }: Props) {
  const activeGraphId = useActiveGraphId();
  const activeGraph = useActiveGraph();
  const resolver = useSubgraphResolver();
  // Subscribe to the whole maps so the effect re-runs when a nested subgraph
  // changes — the active graph's own reference doesn't change then.
  const graphs = useGraphStore((s) => s.graphs);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const store = useGraphStore;
  const enter = useNavigationStore((s) => s.enter);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // React Flow's internal state must own the nodes array: it mutates it in place to
  // store `measured` dimensions, and losing that mutation reverts nodes to
  // visibility:hidden. We mirror Zustand into this state and merge on updates to
  // preserve those internal fields.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
  } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{
    screen: { x: number; y: number };
    nodeId: string;
  } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{
    screen: { x: number; y: number };
    edgeId: string;
  } | null>(null);
  const [dragMenu, setDragMenu] = useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
    sourceNodeId: string;
    sourceHandleId: string | null;
    sourceHandleType: 'source' | 'target';
    itemId: string;
  } | null>(null);
  // Tracks a drag in progress from a handle. Set in onConnectStart, cleared
  // when a valid connection lands (onConnect) or we finish handling the
  // drop on pane (onConnectEnd).
  const pendingConnectRef = useRef<{
    nodeId: string;
    handleId: string | null;
    handleType: 'source' | 'target';
  } | null>(null);
  const cursorFlowRef = useRef<{ x: number; y: number } | null>(null);
  const nodesRef = useRef<Node[]>([]);
  nodesRef.current = nodes;

  useEffect(() => {
    if (!activeGraph) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: srcNodes, edges: srcEdges } = graphToFlow(activeGraph, resolver);
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return srcNodes.map((n) => {
        const existing = byId.get(n.id);
        return existing ? { ...existing, position: n.position, data: n.data, type: n.type } : n;
      });
    });
    setEdges(srcEdges);
  }, [activeGraph, resolver, graphs, blueprints, setNodes, setEdges]);

  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      store.getState().updateNode(activeGraphId, node.id, { position: node.position });
    },
    [activeGraphId, store],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) store.getState().removeNode(activeGraphId, n.id);
    },
    [activeGraphId, store],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) store.getState().removeEdge(activeGraphId, e.id);
    },
    [activeGraphId, store],
  );

  // Resolves item consistency, commits a fresh interface node's itemId on
  // its first connection (rewriting its handle id in the process), and
  // creates the edge. Shared between the normal `onConnect` path and the
  // drag-drop menu's auto-connect path.
  const commitAndAddEdge = useCallback(
    (
      connection: {
        source: string;
        sourceHandle: string | null | undefined;
        target: string;
        targetHandle: string | null | undefined;
      },
    ) => {
      const g = store.getState().graphs[activeGraphId];
      if (!g) return false;
      const sourceNode = g.nodes.find((n) => n.id === connection.source);
      const targetNode = g.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;
      const sourceItemId = itemIdForHandle(g, sourceNode, connection.sourceHandle, 'source');
      const targetItemId = itemIdForHandle(g, targetNode, connection.targetHandle, 'target');
      if (sourceItemId && targetItemId && sourceItemId !== targetItemId) return false;
      const itemId = sourceItemId || targetItemId;
      if (!itemId) return false;

      let sourceHandle = connection.sourceHandle ?? '';
      let targetHandle = connection.targetHandle ?? '';
      if (
        (sourceNode.data.kind === 'input' || sourceNode.data.kind === 'output') &&
        !sourceNode.data.itemId
      ) {
        store.getState().updateNode(activeGraphId, sourceNode.id, {
          data: { ...sourceNode.data, itemId },
        });
        sourceHandle = handleIdForInterface(sourceNode.data.kind, itemId);
      }
      if (
        (targetNode.data.kind === 'input' || targetNode.data.kind === 'output') &&
        !targetNode.data.itemId
      ) {
        store.getState().updateNode(activeGraphId, targetNode.id, {
          data: { ...targetNode.data, itemId },
        });
        targetHandle = handleIdForInterface(targetNode.data.kind, itemId);
      }

      store.getState().addEdge(activeGraphId, {
        source: connection.source,
        sourceHandle,
        target: connection.target,
        targetHandle,
        itemId,
        rate: 0,
      });
      return true;
    },
    [activeGraphId, store],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      pendingConnectRef.current = null;
      if (!connection.source || !connection.target) return;
      commitAndAddEdge({
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      });
    },
    [commitAndAddEdge],
  );

  const onConnectStart = useCallback<NonNullable<React.ComponentProps<typeof ReactFlow>['onConnectStart']>>(
    (_event, { nodeId, handleId, handleType }) => {
      if (!nodeId || !handleType) return;
      pendingConnectRef.current = { nodeId, handleId: handleId ?? null, handleType };
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const pending = pendingConnectRef.current;
      pendingConnectRef.current = null;
      if (!pending) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.classList.contains('react-flow__pane')) return;

      const clientX =
        'clientX' in event ? event.clientX : event.changedTouches?.[0]?.clientX ?? 0;
      const clientY =
        'clientY' in event ? event.clientY : event.changedTouches?.[0]?.clientY ?? 0;

      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      const sourceNode = g.nodes.find((n) => n.id === pending.nodeId);
      if (!sourceNode) return;
      const itemId = itemIdForHandle(g, sourceNode, pending.handleId, pending.handleType);

      setDragMenu({
        screen: { x: clientX, y: clientY },
        flow: screenToFlowPosition({ x: clientX, y: clientY }),
        sourceNodeId: pending.nodeId,
        sourceHandleId: pending.handleId,
        sourceHandleType: pending.handleType,
        itemId,
      });
    },
    [activeGraphId, screenToFlowPosition, store],
  );

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      onSelectNode(params.nodes[0]?.id ?? null);
    },
    [onSelectNode],
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'factory') {
        const factoryGraphId = (node.data as { factoryGraphId?: string }).factoryGraphId;
        if (factoryGraphId) enter(factoryGraphId);
      }
    },
    [enter],
  );

  const onCanvasContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Only open on empty pane — not on nodes, edges, handles, controls, etc.
      const target = event.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      event.preventDefault();
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setMenu({ screen: { x: event.clientX, y: event.clientY }, flow });
    },
    [screenToFlowPosition],
  );

  const onPickRecipe = useCallback(
    (recipeId: string, position: { x: number; y: number }) => {
      if (!gameData.recipes[recipeId]) return;
      store.getState().addNode(activeGraphId, position, {
        kind: 'recipe',
        recipeId,
        clockSpeed: 1,
        count: 1,
        somersloops: 0,
      });
      setMenu(null);
    },
    [activeGraphId, store],
  );

  const onAddInterface = useCallback(
    (kind: 'input' | 'output', position: { x: number; y: number }) => {
      store.getState().addNode(activeGraphId, position, { kind });
      setMenu(null);
    },
    [activeGraphId, store],
  );

  const onPickBlueprint = useCallback(
    (blueprintId: string, position: { x: number; y: number }) => {
      placeBlueprintOnActiveGraph(blueprintId, position);
      setMenu(null);
    },
    [],
  );

  const onAddHublike = useCallback(
    (kind: 'hub' | 'splitter' | 'merger', position: { x: number; y: number }) => {
      store.getState().addNode(activeGraphId, position, { kind });
      setMenu(null);
    },
    [activeGraphId, store],
  );

  // Place a new node at the drop position and wire it to the dragged handle
  // via the shared commitAndAddEdge path. For interface / hub-likes that
  // land without a committed item, the unset handle form is used —
  // commitAndAddEdge will itemize it on the first connection.
  const onDragDropPick = useCallback(
    (choice: DragDropChoice) => {
      if (!dragMenu) return;
      const { flow, sourceNodeId, sourceHandleId, sourceHandleType, itemId } = dragMenu;
      const isFromSource = sourceHandleType === 'source';

      let data: NodeData | null = null;
      let newHandle = '';
      if (choice.kind === 'recipe') {
        const recipe = gameData.recipes[choice.recipeId];
        if (!recipe) return;
        data = { kind: 'recipe', recipeId: choice.recipeId, clockSpeed: 1, count: 1, somersloops: 0 };
        if (isFromSource) {
          const idx = recipe.ingredients.findIndex((i) => i.itemId === itemId);
          if (idx < 0) return;
          newHandle = handleIdForIngredient(recipe.id, itemId, idx);
        } else {
          const idx = recipe.products.findIndex((p) => p.itemId === itemId);
          if (idx < 0) return;
          newHandle = handleIdForProduct(recipe.id, itemId, idx);
        }
      } else if (choice.kind === 'blueprint') {
        // Blueprint placement doesn't return a synchronous node id we can
        // wire into a new edge — drop the blueprint at the cursor and
        // leave the auto-connect as a follow-up.
        placeBlueprintOnActiveGraph(choice.blueprintId, flow);
        setDragMenu(null);
        return;
      } else if (choice.kind === 'hublike') {
        data = { kind: choice.which };
        if (choice.which === 'hub') {
          newHandle = isFromSource ? HUB_IN_HANDLE : HUB_OUT_HANDLE;
        } else if (choice.which === 'splitter') {
          newHandle = isFromSource ? SPLITTER_IN_HANDLE : SPLITTER_OUT_HANDLES[0];
        } else {
          newHandle = isFromSource ? MERGER_IN_HANDLES[0] : MERGER_OUT_HANDLE;
        }
      } else {
        data = { kind: choice.which };
        newHandle = handleIdForInterface(choice.which);
      }

      if (!data) return;
      const newNodeId = store.getState().addNode(activeGraphId, flow, data);

      if (isFromSource) {
        commitAndAddEdge({
          source: sourceNodeId,
          sourceHandle: sourceHandleId,
          target: newNodeId,
          targetHandle: newHandle,
        });
      } else {
        commitAndAddEdge({
          source: newNodeId,
          sourceHandle: newHandle,
          target: sourceNodeId,
          targetHandle: sourceHandleId,
        });
      }

      setDragMenu(null);
    },
    [activeGraphId, commitAndAddEdge, dragMenu, store],
  );

  const isSubgraph = activeGraphId !== ROOT_GRAPH_ID;

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      cursorFlowRef.current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    },
    [screenToFlowPosition],
  );

  // If a trigger node is given and it isn't already selected, act on that node
  // alone; otherwise act on the whole selection.
  const resolveTargets = useCallback((triggerNodeId?: string): Set<string> => {
    const selected = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
    if (triggerNodeId && !selected.includes(triggerNodeId)) return new Set([triggerNodeId]);
    return new Set(selected);
  }, []);

  const copyTargets = useCallback(
    (ids: Set<string>) => {
      if (ids.size === 0) return;
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      const srcNodes = g.nodes.filter((n) => ids.has(n.id));
      const srcEdges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      clipboard = {
        nodes: srcNodes.map((n) => ({
          data: structuredClone(n.data),
          position: { ...n.position },
          origId: n.id,
        })),
        edges: srcEdges.map((e) => ({
          source: e.source,
          sourceHandle: e.sourceHandle,
          target: e.target,
          targetHandle: e.targetHandle,
          itemId: e.itemId,
          rate: e.rate,
        })),
      };
    },
    [activeGraphId, store],
  );

  const copySelection = useCallback(() => {
    copyTargets(resolveTargets());
  }, [copyTargets, resolveTargets]);

  const deleteTargets = useCallback(
    (ids: Set<string>) => {
      if (ids.size === 0) return;
      for (const id of ids) store.getState().removeNode(activeGraphId, id);
    },
    [activeGraphId, store],
  );

  const pasteClipboard = useCallback(
    (targetAnchor: { x: number; y: number } | null) => {
      if (!clipboard || clipboard.nodes.length === 0) return;
      // Anchor: top-left of the copied bounding box. Offset places that anchor
      // at targetAnchor (cursor for Ctrl+V) or original+offset (Ctrl+D).
      const minX = Math.min(...clipboard.nodes.map((n) => n.position.x));
      const minY = Math.min(...clipboard.nodes.map((n) => n.position.y));
      const anchor = targetAnchor ?? {
        x: minX + DUPLICATE_OFFSET.x,
        y: minY + DUPLICATE_OFFSET.y,
      };
      const dx = anchor.x - minX;
      const dy = anchor.y - minY;
      const oldToNew = new Map<string, string>();
      for (const n of clipboard.nodes) {
        const newId = store.getState().addNode(
          activeGraphId,
          { x: n.position.x + dx, y: n.position.y + dy },
          structuredClone(n.data),
        );
        oldToNew.set(n.origId, newId);
      }
      for (const e of clipboard.edges) {
        const src = oldToNew.get(e.source);
        const tgt = oldToNew.get(e.target);
        if (!src || !tgt) continue;
        store.getState().addEdge(activeGraphId, {
          source: src,
          sourceHandle: e.sourceHandle,
          target: tgt,
          targetHandle: e.targetHandle,
          itemId: e.itemId,
          rate: e.rate,
        });
      }
    },
    [activeGraphId, store],
  );

  const duplicateTargets = useCallback(
    (ids: Set<string>) => {
      copyTargets(ids);
      pasteClipboard(null);
    },
    [copyTargets, pasteClipboard],
  );

  // Keep handlers in a ref so the window keydown listener is mounted once and
  // doesn't churn when callback identities change (selection, activeGraphId).
  const keyHandlersRef = useRef({ copySelection, pasteClipboard, duplicateTargets, resolveTargets });
  keyHandlersRef.current = { copySelection, pasteClipboard, duplicateTargets, resolveTargets };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const h = keyHandlersRef.current;
      switch (e.key.toLowerCase()) {
        case 'c':
          h.copySelection();
          e.preventDefault();
          return;
        case 'v':
          h.pasteClipboard(cursorFlowRef.current);
          e.preventDefault();
          return;
        case 'd':
          h.duplicateTargets(h.resolveTargets());
          e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setNodeMenu({ screen: { x: event.clientX, y: event.clientY }, nodeId: node.id });
  }, []);

  // Shift-drag box selection renders a NodesSelection overlay that swallows
  // right-clicks, so onNodeContextMenu never fires. Route those through the
  // same menu using any selected node as the trigger — resolveTargets will
  // expand to the full selection.
  const onSelectionContextMenu = useCallback((event: React.MouseEvent, nodes: Node[]) => {
    event.preventDefault();
    if (nodes.length === 0) return;
    setNodeMenu({ screen: { x: event.clientX, y: event.clientY }, nodeId: nodes[0].id });
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    setEdgeMenu({ screen: { x: event.clientX, y: event.clientY }, edgeId: edge.id });
  }, []);

  const nodeMenuTargets = nodeMenu ? resolveTargets(nodeMenu.nodeId) : new Set<string>();

  // Recipe controls only render when the context menu targets a single recipe node.
  const nodeMenuRecipe = (() => {
    if (!nodeMenu || nodeMenuTargets.size !== 1) return null;
    const only = [...nodeMenuTargets][0];
    const node = activeGraph?.nodes.find((n) => n.id === only);
    if (!node || node.data.kind !== 'recipe') return null;
    const recipe = gameData.recipes[node.data.recipeId];
    if (!recipe) return null;
    const machine = gameData.machines[recipe.machineId];
    // Primary product = first non-byproduct; fall back to first product.
    const primary = recipe.products.find((p) => !p.isByproduct) ?? recipe.products[0];
    const primaryItem = primary ? gameData.items[primary.itemId] : undefined;
    const baseRate = primary
      ? itemsPerMinute(recipe, primary.amount, 1, node.data.count) *
        somersloopMultiplier(recipe, node.data, gameData)
      : 0;
    return {
      nodeId: only,
      data: node.data,
      powerShardSlots: machine?.powerShardSlots ?? 0,
      somersloopSlots: machine?.somersloopSlots ?? 0,
      powerMW: nodePowerMW(recipe, node.data, gameData),
      primary: primary && primaryItem
        ? { baseRate, itemName: primaryItem.name, itemIcon: primaryItem.icon }
        : null,
    };
  })();

  const updateRecipeNodeData = useCallback(
    (nodeId: string, patch: Partial<Omit<RecipeNodeData, 'kind'>>) => {
      const g = store.getState().graphs[activeGraphId];
      const node = g?.nodes.find((n) => n.id === nodeId);
      if (!node || node.data.kind !== 'recipe') return;
      store.getState().updateNode(activeGraphId, nodeId, {
        data: { ...node.data, ...patch },
      });
    },
    [activeGraphId, store],
  );

  const updateBlueprintNodeData = useCallback(
    (nodeId: string, patch: Partial<Omit<BlueprintNodeData, 'kind' | 'blueprintId'>>) => {
      const g = store.getState().graphs[activeGraphId];
      const node = g?.nodes.find((n) => n.id === nodeId);
      if (!node || node.data.kind !== 'blueprint') return;
      store.getState().updateNode(activeGraphId, nodeId, {
        data: { ...node.data, ...patch },
      });
    },
    [activeGraphId, store],
  );

  const nodeMenuBlueprint = (() => {
    if (!nodeMenu || nodeMenuTargets.size !== 1) return null;
    const only = [...nodeMenuTargets][0];
    const node = activeGraph?.nodes.find((n) => n.id === only);
    if (!node || node.data.kind !== 'blueprint') return null;
    return { nodeId: only, data: node.data };
  })();

  // Factory nodes reference a subgraph in graphStore, not embedded nodes, so
  // they can't be packaged into a self-contained blueprint record.
  const selectionHasFactory = (() => {
    if (!activeGraph) return false;
    for (const id of nodeMenuTargets) {
      const n = activeGraph.nodes.find((x) => x.id === id);
      if (n?.data.kind === 'factory') return true;
    }
    return false;
  })();

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full min-h-0 min-w-0 overflow-hidden"
      onContextMenu={onCanvasContextMenu}
      onPointerMove={onPointerMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        deleteKeyCode={['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2d3445" />
        <Controls />
        <MiniMap
          maskColor="rgba(22,26,34,0.7)"
          nodeColor={() => '#fa9549'}
          style={{ background: '#1e2330' }}
        />
      </ReactFlow>
      {menu && (
        <CanvasContextMenu
          screenPosition={menu.screen}
          flowPosition={menu.flow}
          onClose={() => setMenu(null)}
          onSelectRecipe={onPickRecipe}
          onSelectBlueprint={onPickBlueprint}
          allowInterface={isSubgraph}
          onAddInterface={onAddInterface}
          onAddHublike={onAddHublike}
        />
      )}
      {nodeMenu && (
        <NodeContextMenu
          screenPosition={nodeMenu.screen}
          count={nodeMenuTargets.size}
          onClose={() => setNodeMenu(null)}
          onDelete={() => deleteTargets(nodeMenuTargets)}
          onDuplicate={() => duplicateTargets(nodeMenuTargets)}
          onExtract={
            nodeMenuTargets.size > 0 && !nodeMenuBlueprint && !selectionHasFactory
              ? () => {
                  extractSelectionToBlueprint(activeGraphId, nodeMenuTargets);
                }
              : undefined
          }
          onEdit={
            nodeMenuBlueprint
              ? () => openBlueprintForEditing(nodeMenuBlueprint.data.blueprintId)
              : undefined
          }
          recipe={
            nodeMenuRecipe
              ? {
                  clockSpeed: nodeMenuRecipe.data.clockSpeed,
                  powerShardSlots: nodeMenuRecipe.powerShardSlots,
                  somersloops: nodeMenuRecipe.data.somersloops,
                  somersloopSlots: nodeMenuRecipe.somersloopSlots,
                  powerMW: nodeMenuRecipe.powerMW,
                  count: nodeMenuRecipe.data.count,
                  primaryOutput: nodeMenuRecipe.primary ?? undefined,
                  onOverclock: (clockSpeed) =>
                    updateRecipeNodeData(nodeMenuRecipe.nodeId, { clockSpeed }),
                  onSomersloop: (somersloops) =>
                    updateRecipeNodeData(nodeMenuRecipe.nodeId, { somersloops }),
                  onCount: (count) =>
                    updateRecipeNodeData(nodeMenuRecipe.nodeId, { count }),
                }
              : undefined
          }
          blueprint={
            nodeMenuBlueprint
              ? {
                  count: nodeMenuBlueprint.data.count,
                  onCount: (n) => updateBlueprintNodeData(nodeMenuBlueprint.nodeId, { count: n }),
                }
              : undefined
          }
        />
      )}
      {edgeMenu && (
        <EdgeContextMenu
          screenPosition={edgeMenu.screen}
          onClose={() => setEdgeMenu(null)}
          onRemove={() => store.getState().removeEdge(activeGraphId, edgeMenu.edgeId)}
        />
      )}
      {dragMenu && (
        <DragDropMenu
          screenPosition={dragMenu.screen}
          itemId={dragMenu.itemId}
          handleType={dragMenu.sourceHandleType}
          allowInterface={isSubgraph}
          onClose={() => setDragMenu(null)}
          onPick={onDragDropPick}
        />
      )}
    </div>
  );
}
