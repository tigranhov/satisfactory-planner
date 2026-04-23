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
import RateEdge from './edges/RateEdge';
import CanvasContextMenu from './CanvasContextMenu';
import NodeContextMenu from './NodeContextMenu';
import { computeFlows, type HandleFlow, type SubgraphResolver } from '@/models/flow';
import { useSubgraphResolver } from '@/hooks/useSubgraphResolver';
import {
  hubItemIdFromEdges,
  itemIdFromSourceHandle,
  itemIdFromTargetHandle,
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

const nodeTypes = {
  recipe: RecipeNode,
  factory: FactoryNode,
  input: InterfaceNode,
  output: InterfaceNode,
  blueprint: BlueprintNode,
  hub: HubNode,
};
const edgeTypes = { rate: RateEdge };

function graphToFlow(graph: Graph, resolver: SubgraphResolver): { nodes: Node[]; edges: Edge[] } {
  const flows = computeFlows(graph, gameData, resolver);
  // Single edge pass → hub item by node. Avoids scanning graph.edges once per
  // hub during the node map below (H×E → O(E)).
  const hubIds = new Set<string>();
  for (const n of graph.nodes) if (n.data.kind === 'hub') hubIds.add(n.id);
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
    if (n.data.kind === 'hub') extra.currentItemId = hubItemByNode.get(n.id) ?? null;
    return {
      id: n.id,
      position: n.position,
      type: n.data.kind,
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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      // Endpoint itemIds come from the handle string for fixed-item nodes
      // (recipes, interface boundaries, subgraphs). For hubs — whose item
      // is derived from incident edges — we look at the hub's existing
      // connections. Empty string means "no item committed yet".
      const sourceNode = g.nodes.find((n) => n.id === connection.source);
      const targetNode = g.nodes.find((n) => n.id === connection.target);
      const sourceItemId =
        sourceNode?.data.kind === 'hub'
          ? hubItemIdFromEdges(g, sourceNode.id) ?? ''
          : itemIdFromSourceHandle(connection.sourceHandle ?? '');
      const targetItemId =
        targetNode?.data.kind === 'hub'
          ? hubItemIdFromEdges(g, targetNode.id) ?? ''
          : itemIdFromTargetHandle(connection.targetHandle ?? '');
      // Reject connections where both ends disagree on item.
      if (sourceItemId && targetItemId && sourceItemId !== targetItemId) return;
      // Reject two unset hubs connected together — there's no item to carry.
      const itemId = sourceItemId || targetItemId;
      if (!itemId) return;
      const newEdge: Omit<GraphEdge, 'id'> = {
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? '',
        target: connection.target,
        targetHandle: connection.targetHandle ?? '',
        itemId,
        rate: 0,
      };
      store.getState().addEdge(activeGraphId, newEdge);
    },
    [activeGraphId, store],
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

  const onPickInterface = useCallback(
    (kind: 'input' | 'output', itemId: string, position: { x: number; y: number }) => {
      if (!gameData.items[itemId]) return;
      store.getState().addNode(activeGraphId, position, { kind, itemId });
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

  const onAddHub = useCallback(
    (position: { x: number; y: number }) => {
      store.getState().addNode(activeGraphId, position, { kind: 'hub' });
      setMenu(null);
    },
    [activeGraphId, store],
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
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
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
          onSelectInterface={onPickInterface}
          onAddHub={onAddHub}
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
                  primaryOutput: nodeMenuRecipe.primary ?? undefined,
                  onOverclock: (clockSpeed) =>
                    updateRecipeNodeData(nodeMenuRecipe.nodeId, { clockSpeed }),
                  onSomersloop: (somersloops) =>
                    updateRecipeNodeData(nodeMenuRecipe.nodeId, { somersloops }),
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
    </div>
  );
}
