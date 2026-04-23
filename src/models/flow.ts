import type { GameData } from '@/data/types';
import type { Graph, GraphEdge, GraphNode, RecipeNodeData } from '@/models/graph';
import { handleIndexFromId, recipeInputs, recipeOutputs } from './factory';

export interface EdgeFlow {
  rate: number;
  overbudget: boolean;
}

function handleRate(
  node: GraphNode | undefined,
  data: GameData,
  handleId: string,
  side: 'in' | 'out',
): number {
  if (!node || node.data.kind !== 'recipe') return 0;
  const recipe = data.recipes[(node.data as RecipeNodeData).recipeId];
  if (!recipe) return 0;
  const io =
    side === 'in'
      ? recipeInputs(recipe, node.data as RecipeNodeData)
      : recipeOutputs(recipe, node.data as RecipeNodeData);
  const index = handleIndexFromId(handleId);
  return index != null && io[index] ? io[index].rate : 0;
}

// Nested map keyed by [nodeId][handleId] — avoids string-separator collisions
// that a flat `${nodeId}|${handleId}` key would risk.
function groupEdges(edges: GraphEdge[], by: 'target' | 'source') {
  const out = new Map<string, Map<string, GraphEdge[]>>();
  for (const e of edges) {
    const nodeId = by === 'target' ? e.target : e.source;
    const handleId = by === 'target' ? e.targetHandle : e.sourceHandle;
    let byHandle = out.get(nodeId);
    if (!byHandle) out.set(nodeId, (byHandle = new Map()));
    const arr = byHandle.get(handleId);
    if (arr) arr.push(e);
    else byHandle.set(handleId, [e]);
  }
  return out;
}

export function computeEdgeFlows(graph: Graph, data: GameData): Map<string, EdgeFlow> {
  const result = new Map<string, EdgeFlow>();
  if (graph.edges.length === 0) return result;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const byTarget = groupEdges(graph.edges, 'target');
  for (const [nodeId, byHandle] of byTarget) {
    const node = nodeById.get(nodeId);
    for (const [handleId, edges] of byHandle) {
      const demand = handleRate(node, data, handleId, 'in');
      const per = demand / edges.length;
      for (const e of edges) result.set(e.id, { rate: per, overbudget: false });
    }
  }

  const bySource = groupEdges(graph.edges, 'source');
  for (const [nodeId, byHandle] of bySource) {
    const node = nodeById.get(nodeId);
    for (const [handleId, edges] of byHandle) {
      const capacity = handleRate(node, data, handleId, 'out');
      const sum = edges.reduce((s, e) => s + (result.get(e.id)?.rate ?? 0), 0);
      if (sum > capacity + 1e-6) {
        for (const e of edges) {
          const prev = result.get(e.id);
          if (prev) result.set(e.id, { ...prev, overbudget: true });
        }
      }
    }
  }

  return result;
}
