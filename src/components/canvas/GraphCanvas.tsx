import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useActiveGraph, useActiveGraphId } from '@/hooks/useActiveGraph';
import { useGraphStore } from '@/store/graphStore';
import { useNavigationStore } from '@/store/navigationStore';
import { loadGameData } from '@/data/loader';
import RecipeNode from './nodes/RecipeNode';
import CompositeNode from './nodes/CompositeNode';
import RateEdge from './edges/RateEdge';
import type { Graph, GraphEdge, GraphNode } from '@/models/graph';

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
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    type: 'rate',
    data: { rate: e.rate, itemId: e.itemId },
  }));
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

  const flow = useMemo(() => (activeGraph ? graphToFlow(activeGraph) : { nodes: [], edges: [] }), [
    activeGraph,
  ]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      // Apply position/remove/select changes to our store.
      const updatedNodes: GraphNode[] = g.nodes
        .map((node) => {
          const change = changes.find((c) => 'id' in c && c.id === node.id);
          if (!change) return node;
          if (change.type === 'position' && change.position) {
            return { ...node, position: change.position };
          }
          if (change.type === 'remove') return null;
          return node;
        })
        .filter(Boolean) as GraphNode[];
      store.getState().setNodes(activeGraphId, updatedNodes);
    },
    [activeGraphId, store],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const g = store.getState().graphs[activeGraphId];
      if (!g) return;
      const removed = new Set(
        changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id),
      );
      if (removed.size === 0) return;
      store
        .getState()
        .setEdges(activeGraphId, g.edges.filter((e) => !removed.has(e.id)));
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
    <div ref={wrapperRef} className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
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
