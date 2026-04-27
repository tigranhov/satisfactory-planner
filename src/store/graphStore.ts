import { create } from 'zustand';
import type { Graph, GraphEdge, GraphId, GraphNode, NodeData, NodeId } from '@/models/graph';
import { newEdgeId, newGraphId, newNodeId, ROOT_GRAPH_ID } from '@/lib/ids';

// Input/Output nodes commit to an itemId on their first connection. When the
// last edge goes away, drop the commitment so the node can accept a different
// item next time — mirrors the derived-from-edges behavior of hub-likes.
function resetOrphanInterfaces(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  let hasCommittedInterface = false;
  for (const n of nodes) {
    if ((n.data.kind === 'input' || n.data.kind === 'output') && n.data.itemId) {
      hasCommittedInterface = true;
      break;
    }
  }
  if (!hasCommittedInterface) return nodes;

  const connected = new Set<NodeId>();
  for (const e of edges) {
    connected.add(e.source);
    connected.add(e.target);
  }
  let changed = false;
  const next = nodes.map((n) => {
    if (n.data.kind !== 'input' && n.data.kind !== 'output') return n;
    if (!n.data.itemId) return n;
    if (connected.has(n.id)) return n;
    changed = true;
    return { ...n, data: { ...n.data, itemId: undefined } };
  });
  return changed ? next : nodes;
}

interface GraphState {
  graphs: Record<GraphId, Graph>;
  addGraph: (name: string, parentNodeId?: NodeId) => GraphId;
  registerGraph: (id: GraphId, name: string) => void;
  renameGraph: (graphId: GraphId, name: string) => void;
  replaceGraphs: (graphs: Record<GraphId, Graph>) => void;
  addNode: (graphId: GraphId, position: { x: number; y: number }, data: NodeData) => NodeId;
  updateNode: (graphId: GraphId, nodeId: NodeId, patch: Partial<GraphNode>) => void;
  removeNode: (graphId: GraphId, nodeId: NodeId) => void;
  addEdge: (graphId: GraphId, edge: Omit<GraphEdge, 'id'>) => void;
  // Batch-insert: the caller receives the new node ids in order so it can
  // stitch into edges it builds from them. Edges reference real node ids.
  // One `set` call drives a single subscriber notification regardless of
  // batch size — important for auto-fill which places many nodes at once.
  addNodesAndEdges: (
    graphId: GraphId,
    nodes: Array<{ position: { x: number; y: number }; data: NodeData }>,
    edgesFrom: (newIds: NodeId[]) => Array<Omit<GraphEdge, 'id'>>,
  ) => NodeId[];
  removeEdge: (graphId: GraphId, edgeId: string) => void;
  setNodes: (graphId: GraphId, nodes: GraphNode[]) => void;
  setEdges: (graphId: GraphId, edges: GraphEdge[]) => void;
  setEdgeLabelOffset: (
    graphId: GraphId,
    edgeId: string,
    offset: { x: number; y: number } | undefined,
  ) => void;
}

const rootGraph: Graph = {
  id: ROOT_GRAPH_ID,
  name: 'Root',
  nodes: [],
  edges: [],
};

export const useGraphStore = create<GraphState>((set) => ({
  graphs: { [ROOT_GRAPH_ID]: rootGraph },

  addGraph: (name, parentNodeId) => {
    const id = newGraphId();
    set((s) => ({
      graphs: { ...s.graphs, [id]: { id, name, parentNodeId, nodes: [], edges: [] } },
    }));
    return id;
  },

  registerGraph: (id, name) =>
    set((s) => {
      if (s.graphs[id]) return s;
      return { graphs: { ...s.graphs, [id]: { id, name, nodes: [], edges: [] } } };
    }),

  renameGraph: (graphId, name) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g || g.name === name) return s;
      return { graphs: { ...s.graphs, [graphId]: { ...g, name } } };
    }),

  replaceGraphs: (graphs) =>
    set(() => {
      if (graphs[ROOT_GRAPH_ID]) return { graphs };
      return { graphs: { ...graphs, [ROOT_GRAPH_ID]: rootGraph } };
    }),

  addNode: (graphId, position, data) => {
    const id = newNodeId();
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      return {
        graphs: {
          ...s.graphs,
          [graphId]: { ...g, nodes: [...g.nodes, { id, position, data }] },
        },
      };
    });
    return id;
  },

  updateNode: (graphId, nodeId, patch) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      return {
        graphs: {
          ...s.graphs,
          [graphId]: {
            ...g,
            nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
          },
        },
      };
    }),

  removeNode: (graphId, nodeId) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      const nextEdges = g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      const nextNodes = resetOrphanInterfaces(
        g.nodes.filter((n) => n.id !== nodeId),
        nextEdges,
      );
      return {
        graphs: { ...s.graphs, [graphId]: { ...g, nodes: nextNodes, edges: nextEdges } },
      };
    }),

  addEdge: (graphId, edge) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      return {
        graphs: {
          ...s.graphs,
          [graphId]: { ...g, edges: [...g.edges, { ...edge, id: newEdgeId() }] },
        },
      };
    }),

  addNodesAndEdges: (graphId, nodesSpec, edgesFrom) => {
    const ids: NodeId[] = [];
    for (let i = 0; i < nodesSpec.length; i++) ids.push(newNodeId());
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      const addedNodes: GraphNode[] = nodesSpec.map((n, i) => ({
        id: ids[i],
        position: n.position,
        data: n.data,
      }));
      const addedEdges: GraphEdge[] = edgesFrom(ids).map((e) => ({
        ...e,
        id: newEdgeId(),
      }));
      return {
        graphs: {
          ...s.graphs,
          [graphId]: {
            ...g,
            nodes: [...g.nodes, ...addedNodes],
            edges: [...g.edges, ...addedEdges],
          },
        },
      };
    });
    return ids;
  },

  removeEdge: (graphId, edgeId) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      const nextEdges = g.edges.filter((e) => e.id !== edgeId);
      const nextNodes = resetOrphanInterfaces(g.nodes, nextEdges);
      return {
        graphs: { ...s.graphs, [graphId]: { ...g, nodes: nextNodes, edges: nextEdges } },
      };
    }),

  setNodes: (graphId, nodes) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      return { graphs: { ...s.graphs, [graphId]: { ...g, nodes } } };
    }),

  setEdges: (graphId, edges) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      return { graphs: { ...s.graphs, [graphId]: { ...g, edges } } };
    }),

  setEdgeLabelOffset: (graphId, edgeId, offset) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      let changed = false;
      const nextEdges = g.edges.map((e) => {
        if (e.id !== edgeId) return e;
        const cur = e.labelOffset;
        if (!offset) {
          if (!cur) return e;
          changed = true;
          const next: GraphEdge = { ...e };
          delete next.labelOffset;
          return next;
        }
        if (cur && cur.x === offset.x && cur.y === offset.y) return e;
        changed = true;
        return { ...e, labelOffset: { x: offset.x, y: offset.y } };
      });
      if (!changed) return s;
      return { graphs: { ...s.graphs, [graphId]: { ...g, edges: nextEdges } } };
    }),
}));
