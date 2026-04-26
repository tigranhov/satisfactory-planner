import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from '@xyflow/react';
import { useActiveGraph, useActiveGraphId } from '@/hooks/useActiveGraph';
import { useGraphStore } from '@/store/graphStore';
import {
  abortHistoryTransaction,
  beginHistoryTransaction,
  commitHistory,
  commitHistoryTransaction,
  useHistoryStore,
} from '@/store/historyStore';
import { useNavigationStore } from '@/store/navigationStore';
import { loadGameData } from '@/data/loader';
import RecipeNode from './nodes/RecipeNode';
import FactoryNode from './nodes/FactoryNode';
import InterfaceNode from './nodes/InterfaceNode';
import BlueprintNode from './nodes/BlueprintNode';
import HubNode from './nodes/HubNode';
import SplitterNode from './nodes/SplitterNode';
import MergerNode from './nodes/MergerNode';
import TargetNode from './nodes/TargetNode';
import SinkNode from './nodes/SinkNode';
import RateEdge from './edges/RateEdge';
import CanvasContextMenu from './CanvasContextMenu';
import NodeContextMenu from './NodeContextMenu';
import EdgeContextMenu from './EdgeContextMenu';
import DragDropMenu, { type DragDropChoice } from './DragDropMenu';
import AutoFillModal from './AutoFillModal';
import {
  applyAutoFillResult,
  computeAutoFill,
  describeIngredients,
  type InputSelection,
  type OccupiedRect,
} from '@/lib/autoFill';
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
  handleIdForTarget,
  handleIdForSink,
  handleIdForSubgraphInput,
  handleIdForSubgraphOutput,
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
  NodeStatus,
  RecipeNodeData,
} from '@/models/graph';
import { useUiStore, getClockStrategy, getGroupingStrategy } from '@/store/uiStore';
import { isEditableTarget } from '@/lib/dom';
import {
  centerOnCursor,
  estimateNodeHeight,
  estimateNodeWidth,
  kindFromReactFlowType,
  snapPosition,
} from '@/lib/canvasPlacement';
import { computeAlignedY } from '@/lib/alignDrag';

// Session-scoped clipboard of copied nodes + their internal edges. Stored at
// module scope so it survives component remounts (e.g. navigating subgraphs).
interface ClipboardPayload {
  nodes: Array<{ data: NodeData; position: { x: number; y: number }; origId: string }>;
  edges: Array<Omit<GraphEdge, 'id'>>;
}
let clipboard: ClipboardPayload | null = null;

const DUPLICATE_OFFSET = { x: 40, y: 40 };

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
  target: TargetNode,
  sink: SinkNode,
};

type ReactFlowNodeType = keyof typeof nodeTypes;

function reactFlowTypeForKind(kind: NodeData['kind']): ReactFlowNodeType {
  return kind === 'input' || kind === 'output' ? 'interface' : kind;
}
const edgeTypes = { rate: RateEdge };

function singleSelectedNodeOfKind<K extends NodeData['kind']>(
  graph: Graph | undefined,
  targets: Set<string>,
  kind: K,
): { nodeId: string; data: Extract<NodeData, { kind: K }> } | null {
  if (targets.size !== 1) return null;
  const only = [...targets][0];
  const node = graph?.nodes.find((n) => n.id === only);
  if (!node || node.data.kind !== kind) return null;
  return { nodeId: only, data: node.data as Extract<NodeData, { kind: K }> };
}

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

export default function GraphCanvas() {
  const activeGraphId = useActiveGraphId();
  const activeGraph = useActiveGraph();
  const resolver = useSubgraphResolver();
  // Subscribe to the whole maps so the effect re-runs when a nested subgraph
  // changes — the active graph's own reference doesn't change then.
  const graphs = useGraphStore((s) => s.graphs);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const store = useGraphStore;
  const enter = useNavigationStore((s) => s.enter);
  const { screenToFlowPosition, setCenter, getInternalNode } = useReactFlow();
  const pendingFocusNodeId = useUiStore((s) => s.pendingFocusNodeId);
  const clearPendingFocus = useUiStore((s) => s.clearPendingFocus);
  const clockStrategy = useUiStore((s) => s.clockStrategy);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const gridSize = useUiStore((s) => s.gridSize);
  const snapGridTuple = useMemo<[number, number]>(() => [gridSize, gridSize], [gridSize]);
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
  const [autoFillTarget, setAutoFillTarget] = useState<{ nodeId: string } | null>(null);
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

  // Tasks panel cross-graph click sets a pending focus id; once the target
  // node has rendered into React Flow's state (possibly after a graph jump),
  // pan to it and clear the pending marker so repeat clicks re-fire cleanly.
  useEffect(() => {
    if (!pendingFocusNodeId) return;
    const target = nodes.find((n) => n.id === pendingFocusNodeId);
    if (!target) return;
    const cx = target.position.x + (target.measured?.width ?? 120) / 2;
    const cy = target.position.y + (target.measured?.height ?? 80) / 2;
    setCenter(cx, cy, { zoom: 1.2, duration: 400 });
    clearPendingFocus();
  }, [nodes, pendingFocusNodeId, setCenter, clearPendingFocus]);

  // `startY` is the no-edges fallback Y when align-drag can't anchor.
  // `active` flips on first override so onNodeDragStop knows to pull final
  // position from nodesRef (our override) instead of the dragged-Node payload
  // (React Flow's grid-snapped value).
  const alignDragRef = useRef<{ startY: number; active: boolean } | null>(null);

  // dragStartPositions captures positions before the drag so dragStop can
  // detect "no movement" and abort the history transaction on a click-no-drag.
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }> | null>(null);

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    alignDragRef.current = { startY: node.position.y, active: false };
    dragStartPositionsRef.current = new Map(nodesRef.current.map((n) => [n.id, { ...n.position }]));
    beginHistoryTransaction();
  }, []);

  const onNodeDrag = useCallback(
    (event: React.MouseEvent, node: Node, dragged: Node[]) => {
      if (dragged.length !== 1) return;
      if (!event.ctrlKey && !event.metaKey) return;
      const internal = getInternalNode(node.id);
      if (!internal) return;
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      const cursorFlow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const aligned = computeAlignedY({
        draggedNode: internal,
        internalNodeById: getInternalNode,
        edges: g.edges,
        cursorFlowY: cursorFlow.y,
      });
      const targetY = aligned ?? alignDragRef.current?.startY ?? node.position.y;
      if (targetY === node.position.y) return;
      if (alignDragRef.current) alignDragRef.current.active = true;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === node.id ? { ...n, position: { x: n.position.x, y: targetY } } : n,
        ),
      );
    },
    [activeGraphId, getInternalNode, screenToFlowPosition, setNodes, store],
  );

  // For an align-drag, dragged[i].position carries React Flow's grid-snapped
  // Y, not our override. Pull the rendered Y from nodesRef instead.
  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, _node: Node, dragged: Node[]) => {
      const wasAligning = alignDragRef.current?.active === true;
      alignDragRef.current = null;
      const startPositions = dragStartPositionsRef.current;
      dragStartPositionsRef.current = null;
      const state = store.getState();
      const renderedById = wasAligning
        ? new Map(nodesRef.current.map((n) => [n.id, n.position]))
        : null;
      let moved = false;
      for (const n of dragged) {
        const pos = renderedById?.get(n.id) ?? n.position;
        const start = startPositions?.get(n.id);
        if (!start || start.x !== pos.x || start.y !== pos.y) moved = true;
        state.updateNode(activeGraphId, n.id, { position: pos });
      }
      if (moved) commitHistoryTransaction();
      else abortHistoryTransaction();
    },
    [activeGraphId, store],
  );

  // A Delete-key press on a node fires onNodesDelete + onEdgesDelete (one for
  // the node, one for its cascaded edges). Open a single transaction that the
  // next microtask commits so both handlers land in one undo entry.
  const ensureDeleteTransaction = useCallback(() => {
    if (useHistoryStore.getState().staged) return;
    beginHistoryTransaction();
    queueMicrotask(() => commitHistoryTransaction());
  }, []);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (deleted.length === 0) return;
      ensureDeleteTransaction();
      for (const n of deleted) store.getState().removeNode(activeGraphId, n.id);
    },
    [activeGraphId, ensureDeleteTransaction, store],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return;
      ensureDeleteTransaction();
      for (const e of deleted) store.getState().removeEdge(activeGraphId, e.id);
    },
    [activeGraphId, ensureDeleteTransaction, store],
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
      if (targetNode.data.kind === 'target' && !targetNode.data.targetItemId) {
        store.getState().updateNode(activeGraphId, targetNode.id, {
          data: { ...targetNode.data, targetItemId: itemId },
        });
        targetHandle = handleIdForTarget(itemId);
      }
      if (targetNode.data.kind === 'sink' && !targetNode.data.sinkItemId) {
        store.getState().updateNode(activeGraphId, targetNode.id, {
          data: { ...targetNode.data, sinkItemId: itemId },
        });
        targetHandle = handleIdForSink();
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
      beginHistoryTransaction();
      const ok = commitAndAddEdge({
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      });
      if (ok) commitHistoryTransaction();
      else abortHistoryTransaction();
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
    (recipeId: string, cursor: { x: number; y: number }) => {
      if (!gameData.recipes[recipeId]) return;
      const position = centerOnCursor(cursor, 'recipe', gridSize, snapToGrid);
      commitHistory();
      store.getState().addNode(activeGraphId, position, {
        kind: 'recipe',
        recipeId,
        clockSpeed: 1,
        count: 1,
        somersloops: 0,
      });
      setMenu(null);
    },
    [activeGraphId, store, gridSize, snapToGrid],
  );

  const onAddInterface = useCallback(
    (kind: 'input' | 'output', cursor: { x: number; y: number }) => {
      const position = centerOnCursor(cursor, kind, gridSize, snapToGrid);
      commitHistory();
      store.getState().addNode(activeGraphId, position, { kind });
      setMenu(null);
    },
    [activeGraphId, store, gridSize, snapToGrid],
  );

  const onPickBlueprint = useCallback(
    (blueprintId: string, cursor: { x: number; y: number }) => {
      const position = centerOnCursor(cursor, 'blueprint', gridSize, snapToGrid);
      commitHistory();
      placeBlueprintOnActiveGraph(blueprintId, position);
      setMenu(null);
    },
    [gridSize, snapToGrid],
  );

  const onAddHublike = useCallback(
    (kind: 'hub' | 'splitter' | 'merger', cursor: { x: number; y: number }) => {
      const position = centerOnCursor(cursor, kind, gridSize, snapToGrid);
      commitHistory();
      store.getState().addNode(activeGraphId, position, { kind });
      setMenu(null);
    },
    [activeGraphId, store, gridSize, snapToGrid],
  );

  const onAddTarget = useCallback(
    (cursor: { x: number; y: number }) => {
      const position = centerOnCursor(cursor, 'target', gridSize, snapToGrid);
      commitHistory();
      store.getState().addNode(activeGraphId, position, {
        kind: 'target',
        targetCount: 1000,
      });
      setMenu(null);
    },
    [activeGraphId, store, gridSize, snapToGrid],
  );

  const onAddSink = useCallback(
    (cursor: { x: number; y: number }) => {
      const position = centerOnCursor(cursor, 'sink', gridSize, snapToGrid);
      commitHistory();
      store.getState().addNode(activeGraphId, position, { kind: 'sink' });
      setMenu(null);
    },
    [activeGraphId, store, gridSize, snapToGrid],
  );

  // Place a new node at the drop position and wire it to the dragged handle
  // via the shared commitAndAddEdge path. For interface / hub-likes that
  // land without a committed item, the unset handle form is used —
  // commitAndAddEdge will itemize it on the first connection.
  const onDragDropPick = useCallback(
    (choice: DragDropChoice) => {
      if (!dragMenu) return;
      commitHistory();
      const { flow, sourceNodeId, sourceHandleId, sourceHandleType, itemId: dragItemId } = dragMenu;
      const isFromSource = sourceHandleType === 'source';
      // When the drag was unset the picker collects the user's item choice
      // on stage A and passes it back as `resolvedItemId`. Committed drags
      // already have dragMenu.itemId set.
      const choiceItemId =
        (choice.kind === 'recipe' || choice.kind === 'blueprint'
          ? choice.resolvedItemId
          : undefined) || dragItemId;

      let data: NodeData | null = null;
      let newHandle = '';
      if (choice.kind === 'recipe') {
        const recipe = gameData.recipes[choice.recipeId];
        if (!recipe) return;
        data = { kind: 'recipe', recipeId: choice.recipeId, clockSpeed: 1, count: 1, somersloops: 0 };
        if (isFromSource) {
          const list = recipe.ingredients;
          const idx = choiceItemId ? list.findIndex((i) => i.itemId === choiceItemId) : 0;
          const io = idx >= 0 ? list[idx] : list[0];
          if (!io) return;
          newHandle = handleIdForIngredient(recipe.id, io.itemId, idx >= 0 ? idx : 0);
        } else {
          const list = recipe.products;
          const idx = choiceItemId ? list.findIndex((p) => p.itemId === choiceItemId) : 0;
          const io = idx >= 0 ? list[idx] : list[0];
          if (!io) return;
          newHandle = handleIdForProduct(recipe.id, io.itemId, idx >= 0 ? idx : 0);
        }
      } else if (choice.kind === 'blueprint') {
        // Blueprint nodes expose subgraph handles at `bpi-in:<id>:<itemId>` /
        // `bpi-out:<id>:<itemId>`, one per matching Input/Output boundary
        // inside the blueprint. Find the boundary node that matches our
        // direction + item and wire to its outer handle.
        const bpGraph = resolver(choice.blueprintId);
        const bpAnchor = centerOnCursor(flow, 'blueprint', gridSize, snapToGrid);
        if (!bpGraph || !choiceItemId) {
          placeBlueprintOnActiveGraph(choice.blueprintId, bpAnchor);
          setDragMenu(null);
          return;
        }
        const boundaryKind = isFromSource ? 'input' : 'output';
        const boundary = bpGraph.nodes.find(
          (n) => n.data.kind === boundaryKind && n.data.itemId === choiceItemId,
        );
        const newNodeId = placeBlueprintOnActiveGraph(choice.blueprintId, bpAnchor);
        if (!newNodeId || !boundary) {
          setDragMenu(null);
          return;
        }
        const bpHandle =
          boundaryKind === 'input'
            ? handleIdForSubgraphInput(boundary.id, choiceItemId)
            : handleIdForSubgraphOutput(boundary.id, choiceItemId);
        if (isFromSource) {
          commitAndAddEdge({
            source: sourceNodeId,
            sourceHandle: sourceHandleId,
            target: newNodeId,
            targetHandle: bpHandle,
          });
        } else {
          commitAndAddEdge({
            source: newNodeId,
            sourceHandle: bpHandle,
            target: sourceNodeId,
            targetHandle: sourceHandleId,
          });
        }
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
      } else if (choice.kind === 'target') {
        // Target only has an input handle, so it's only reachable from a
        // source-handle drag. Pre-commit targetItemId when we know the item;
        // otherwise commitAndAddEdge will set it on first connection.
        data = { kind: 'target', targetCount: 1000, targetItemId: choiceItemId };
        newHandle = handleIdForTarget(choiceItemId);
      } else if (choice.kind === 'sink') {
        // Same single-input shape as Target — source-drag only.
        data = { kind: 'sink', sinkItemId: choiceItemId };
        newHandle = handleIdForSink();
      } else {
        data = { kind: choice.which };
        newHandle = handleIdForInterface(choice.which);
      }

      if (!data) return;
      const position = centerOnCursor(flow, data.kind, gridSize, snapToGrid);
      const newNodeId = store.getState().addNode(activeGraphId, position, data);

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
    [activeGraphId, commitAndAddEdge, dragMenu, resolver, store, gridSize, snapToGrid],
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
      commitHistory();
      for (const id of ids) store.getState().removeNode(activeGraphId, id);
    },
    [activeGraphId, store],
  );

  const pasteClipboard = useCallback(
    (targetAnchor: { x: number; y: number } | null) => {
      if (!clipboard || clipboard.nodes.length === 0) return;
      commitHistory();
      // Anchor: top-left of the copied bounding box. Offset places that anchor
      // at targetAnchor (cursor for Ctrl+V) or original+offset (Ctrl+D).
      const minX = Math.min(...clipboard.nodes.map((n) => n.position.x));
      const minY = Math.min(...clipboard.nodes.map((n) => n.position.y));
      const rawAnchor = targetAnchor ?? {
        x: minX + DUPLICATE_OFFSET.x,
        y: minY + DUPLICATE_OFFSET.y,
      };
      // Snap the anchor only — preserves relative offsets so a carefully-laid
      // group stays intact, just nudges as a unit onto a grid intersection.
      const anchor = snapPosition(rawAnchor, gridSize, snapToGrid);
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
    [activeGraphId, store, gridSize, snapToGrid],
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
          return;
        case 'z':
          // Ctrl/Cmd+Shift+Z = redo, plain Ctrl/Cmd+Z = undo.
          if (e.shiftKey) useHistoryStore.getState().redo();
          else useHistoryStore.getState().undo();
          e.preventDefault();
          return;
        case 'y':
          // Windows redo alias.
          useHistoryStore.getState().redo();
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

  const nodeMenuRecipe = (() => {
    const base = singleSelectedNodeOfKind(activeGraph, nodeMenuTargets, 'recipe');
    if (!base) return null;
    const recipe = gameData.recipes[base.data.recipeId];
    if (!recipe) return null;
    const machine = gameData.machines[recipe.machineId];
    // Primary product = first non-byproduct; fall back to first product.
    const primary = recipe.products.find((p) => !p.isByproduct) ?? recipe.products[0];
    const primaryItem = primary ? gameData.items[primary.itemId] : undefined;
    const baseRate = primary
      ? itemsPerMinute(recipe, primary.amount, 1, base.data.count) *
        somersloopMultiplier(recipe, base.data, gameData)
      : 0;
    return {
      nodeId: base.nodeId,
      data: base.data,
      powerShardSlots: machine?.powerShardSlots ?? 0,
      somersloopSlots: machine?.somersloopSlots ?? 0,
      powerMW: nodePowerMW(recipe, base.data, gameData),
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
      commitHistory();
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
      commitHistory();
      store.getState().updateNode(activeGraphId, nodeId, {
        data: { ...node.data, ...patch },
      });
    },
    [activeGraphId, store],
  );

  // Renaming a factory node keeps the node label and its referenced subgraph
  // in lockstep so the project switcher and canvas label don't diverge.
  const renameFactoryNode = useCallback(
    (nodeId: string, label: string) => {
      const g = store.getState().graphs[activeGraphId];
      const node = g?.nodes.find((n) => n.id === nodeId);
      if (!node || node.data.kind !== 'factory') return;
      commitHistory();
      store.getState().updateNode(activeGraphId, nodeId, {
        data: { ...node.data, label },
      });
      store.getState().renameGraph(node.data.factoryGraphId, label);
    },
    [activeGraphId, store],
  );

  const applyAutoFill = useCallback(
    (targetNodeId: string, selections: InputSelection[]) => {
      const g = store.getState().graphs[activeGraphId];
      const target = g?.nodes.find((n) => n.id === targetNodeId);
      if (!target) return;
      commitHistory();
      // React Flow already measured existing nodes; feed those rects to the
      // layout so new nodes stack past (not onto) whatever is already placed.
      const occupied: OccupiedRect[] = nodesRef.current.map((n) => ({
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? estimateNodeWidth(kindFromReactFlowType(n.type)),
        height: n.measured?.height ?? estimateNodeHeight(kindFromReactFlowType(n.type)),
      }));
      const result = computeAutoFill(targetNodeId, target.position, selections, gameData, {
        clockStrategy: getClockStrategy(),
        grouping: getGroupingStrategy(),
        occupied,
      });
      applyAutoFillResult(result, (nodeSpecs, edgesFrom) => {
        const snapped = nodeSpecs.map((spec) => ({
          ...spec,
          position: snapPosition(spec.position, gridSize, snapToGrid),
        }));
        store.getState().addNodesAndEdges(activeGraphId, snapped, edgesFrom);
      });
    },
    [activeGraphId, store, gridSize, snapToGrid],
  );

  const nodeMenuBlueprint = (() => {
    const base = singleSelectedNodeOfKind(activeGraph, nodeMenuTargets, 'blueprint');
    if (!base) return null;
    return { ...base, description: blueprints[base.data.blueprintId]?.description };
  })();

  const nodeMenuFactory = singleSelectedNodeOfKind(activeGraph, nodeMenuTargets, 'factory');

  // Auto-fill shows only when the menu targets a single recipe node that has
  // at least one disconnected, non-raw ingredient we can actually fill.
  // Memoized so the ingredient scan doesn't re-run on every unrelated render.
  const nodeMenuAutoFillable = useMemo(() => {
    if (!nodeMenuRecipe || !activeGraph) return false;
    const recipe = gameData.recipes[nodeMenuRecipe.data.recipeId];
    if (!recipe) return false;
    const rows = describeIngredients(
      recipe,
      nodeMenuRecipe.data,
      activeGraph.edges,
      nodeMenuRecipe.nodeId,
      gameData,
    );
    return rows.some((r) => !r.connected && !r.raw && r.availableRecipes.length > 0);
  }, [nodeMenuRecipe, activeGraph]);

  // Shared helper for the per-node-field bulk edits driven by the context
  // menu — lets setNodeStatus / setNodeNote stay one-liners.
  const patchNodesData = useCallback(
    (nodeIds: Set<string>, patch: (data: NodeData) => Partial<NodeData>) => {
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      commitHistory();
      for (const id of nodeIds) {
        const node = g.nodes.find((n) => n.id === id);
        if (!node) continue;
        store.getState().updateNode(activeGraphId, id, {
          data: { ...node.data, ...patch(node.data) } as NodeData,
        });
      }
    },
    [activeGraphId, store],
  );

  const setNodeStatus = useCallback(
    (nodeIds: Set<string>, status: NodeStatus | undefined) =>
      patchNodesData(nodeIds, () => ({ status })),
    [patchNodesData],
  );

  const setNodeNote = useCallback(
    (nodeIds: Set<string>, note: string) =>
      patchNodesData(nodeIds, () => ({ taskNote: note.length === 0 ? undefined : note })),
    [patchNodesData],
  );

  // Collapse to `undefined` when the selection is mixed so the row shows no
  // single state — clicking any option then writes that state to all targets.
  const nodeMenuStatus: NodeStatus | undefined = (() => {
    if (nodeMenuTargets.size === 0) return undefined;
    const first = [...nodeMenuTargets][0];
    const firstStatus = activeGraph?.nodes.find((n) => n.id === first)?.data.status;
    for (const id of nodeMenuTargets) {
      const s = activeGraph?.nodes.find((n) => n.id === id)?.data.status;
      if (s !== firstStatus) return undefined;
    }
    return firstStatus;
  })();

  // Only expose the note editor for a single-selected node — showing one note
  // for a mixed selection would lose data on edit.
  const nodeMenuNote: string | undefined =
    nodeMenuTargets.size === 1
      ? activeGraph?.nodes.find((n) => n.id === [...nodeMenuTargets][0])?.data.taskNote
      : undefined;

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
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        deleteKeyCode={['Delete', 'Backspace']}
        proOptions={{ hideAttribution: true }}
        snapToGrid={snapToGrid}
        snapGrid={snapGridTuple}
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
          onAddTarget={onAddTarget}
          onAddSink={onAddSink}
        />
      )}
      {nodeMenu && (
        <NodeContextMenu
          screenPosition={nodeMenu.screen}
          count={nodeMenuTargets.size}
          onClose={() => setNodeMenu(null)}
          onDelete={() => deleteTargets(nodeMenuTargets)}
          onDuplicate={() => duplicateTargets(nodeMenuTargets)}
          status={nodeMenuStatus}
          onStatusChange={(s) => setNodeStatus(nodeMenuTargets, s)}
          note={nodeMenuNote}
          onNoteChange={
            nodeMenuTargets.size === 1
              ? (v) => setNodeNote(nodeMenuTargets, v)
              : undefined
          }
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
          onAutoFill={
            nodeMenuRecipe && nodeMenuAutoFillable
              ? () => setAutoFillTarget({ nodeId: nodeMenuRecipe.nodeId })
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
                  description: nodeMenuBlueprint.description,
                  onCount: (n) => updateBlueprintNodeData(nodeMenuBlueprint.nodeId, { count: n }),
                }
              : undefined
          }
          factory={
            nodeMenuFactory
              ? {
                  label: nodeMenuFactory.data.label,
                  onLabelChange: (label) => renameFactoryNode(nodeMenuFactory.nodeId, label),
                }
              : undefined
          }
        />
      )}
      {edgeMenu && (
        <EdgeContextMenu
          screenPosition={edgeMenu.screen}
          onClose={() => setEdgeMenu(null)}
          onRemove={() => {
            commitHistory();
            store.getState().removeEdge(activeGraphId, edgeMenu.edgeId);
          }}
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
      <AutoFillModal
        open={!!autoFillTarget}
        graphId={activeGraphId}
        targetNodeId={autoFillTarget?.nodeId ?? null}
        clockStrategy={clockStrategy}
        onClose={() => setAutoFillTarget(null)}
        onConfirm={(selections) => {
          if (autoFillTarget) applyAutoFill(autoFillTarget.nodeId, selections);
          setAutoFillTarget(null);
        }}
      />
    </div>
  );
}
