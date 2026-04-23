import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
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
import CompositeNode from './nodes/CompositeNode';
import RateEdge from './edges/RateEdge';
import CanvasContextMenu from './CanvasContextMenu';
import NodeContextMenu from './NodeContextMenu';
import { computeFlows, type HandleFlow } from '@/models/flow';
import type { Graph, GraphEdge, NodeData } from '@/models/graph';

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

const nodeTypes = { recipe: RecipeNode, composite: CompositeNode };
const edgeTypes = { rate: RateEdge };

function graphToFlow(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const flows = computeFlows(graph, gameData);
  const nodes: Node[] = graph.nodes.map((n) => {
    const handleMap = flows.targetHandles.get(n.id);
    const handleFlows: Record<string, HandleFlow> = {};
    if (handleMap) for (const [hid, hf] of handleMap) handleFlows[hid] = hf;
    return {
      id: n.id,
      position: n.position,
      type: n.data.kind,
      data: { ...(n.data as unknown as Record<string, unknown>), handleFlows },
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
    const { nodes: srcNodes, edges: srcEdges } = graphToFlow(activeGraph);
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return srcNodes.map((n) => {
        const existing = byId.get(n.id);
        return existing ? { ...existing, position: n.position, data: n.data, type: n.type } : n;
      });
    });
    setEdges(srcEdges);
  }, [activeGraph, setNodes, setEdges]);

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
      // Infer itemId from the source handle id (format: "out:recipeId:itemId:index")
      const parts = (connection.sourceHandle ?? '').split(':');
      const itemId = parts.length >= 3 ? parts[2] : '';
      // Use React Flow's addEdge to produce a well-formed id we can reuse
      const next = addEdge(connection, [] as Edge[]);
      const added = next[0];
      const newEdge: Omit<GraphEdge, 'id'> = {
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? '',
        target: connection.target,
        targetHandle: connection.targetHandle ?? '',
        itemId,
        rate: 0,
      };
      store.getState().addEdge(activeGraphId, newEdge);
      void added;
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
      if (node.type === 'composite') {
        const subGraphId = (node.data as { subGraphId?: string }).subGraphId;
        if (subGraphId) enter(subGraphId);
      }
    },
    [enter],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

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
      });
      setMenu(null);
    },
    [activeGraphId, store],
  );

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

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const recipeId = event.dataTransfer.getData('application/x-recipe-id');
      if (!recipeId) return;
      const recipe = gameData.recipes[recipeId];
      if (!recipe) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      store.getState().addNode(activeGraphId, position, {
        kind: 'recipe',
        recipeId,
        clockSpeed: 1,
        count: 1,
      });
    },
    [activeGraphId, screenToFlowPosition, store],
  );

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full min-h-0 min-w-0 overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
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
        />
      )}
      {nodeMenu && (
        <NodeContextMenu
          screenPosition={nodeMenu.screen}
          count={nodeMenuTargets.size}
          onClose={() => setNodeMenu(null)}
          onDelete={() => deleteTargets(nodeMenuTargets)}
          onDuplicate={() => duplicateTargets(nodeMenuTargets)}
        />
      )}
    </div>
  );
}
