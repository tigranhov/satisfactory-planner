import { create } from 'zustand';
import type { Graph, GraphEdge, GraphId, GraphNode, NodeData, NodeId } from '@/models/graph';
import { newEdgeId, newGraphId, newNodeId, ROOT_GRAPH_ID } from '@/lib/ids';

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
  removeEdge: (graphId: GraphId, edgeId: string) => void;
  setNodes: (graphId: GraphId, nodes: GraphNode[]) => void;
  setEdges: (graphId: GraphId, edges: GraphEdge[]) => void;
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
      return {
        graphs: {
          ...s.graphs,
          [graphId]: {
            ...g,
            nodes: g.nodes.filter((n) => n.id !== nodeId),
            edges: g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
          },
        },
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

  removeEdge: (graphId, edgeId) =>
    set((s) => {
      const g = s.graphs[graphId];
      if (!g) return s;
      return {
        graphs: { ...s.graphs, [graphId]: { ...g, edges: g.edges.filter((e) => e.id !== edgeId) } },
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
}));
