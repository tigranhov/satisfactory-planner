import { useCallback, useEffect, useRef } from 'react';
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
import { computeEdgeFlows } from '@/models/flow';
import type { Graph, GraphEdge } from '@/models/graph';

const gameData = loadGameData();

const nodeTypes = { recipe: RecipeNode, composite: CompositeNode };
const edgeTypes = { rate: RateEdge };

function graphToFlow(graph: Graph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    type: n.data.kind,
    data: n.data as unknown as Record<string, unknown>,
  }));
  const flows = computeEdgeFlows(graph, gameData);
  const edges: Edge[] = graph.edges.map((e) => {
    const flow = flows.get(e.id);
    return {
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      type: 'rate',
      data: { rate: flow?.rate ?? 0, overbudget: flow?.overbudget ?? false, itemId: e.itemId },
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
    <div ref={wrapperRef} className="relative h-full w-full min-h-0 min-w-0 overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
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
    </div>
  );
}
