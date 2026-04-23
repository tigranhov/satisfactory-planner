import type { GameData } from '@/data/types';
import type { Graph, GraphEdge, GraphNode, RecipeNodeData } from '@/models/graph';
import { handleIndexFromId, recipeInputs, recipeOutputs } from './factory';

export const FLOW_EPS = 1e-6;

export interface EdgeFlow {
  rate: number;
  satisfaction: number;
  sourceUtilization: number;
}

// Shape of the `data` object attached to RateEdge nodes in React Flow.
export interface RateEdgeData extends EdgeFlow {
  itemId: string;
}

export interface HandleFlow {
  supply: number;
  demand: number;
  satisfaction: number;
}

export interface FlowResult {
  edges: Map<string, EdgeFlow>;
  targetHandles: Map<string, Map<string, HandleFlow>>;
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

// Demand-driven + source-capped flow:
//   1. Split each target handle's demand equally across its incoming edges.
//   2. If a source handle's outgoing requests exceed its capacity, scale those
//      edges down proportionally.
//   3. Re-measure each target handle's actual supply and derive satisfaction.
//      Edges inherit their target handle's satisfaction ratio.
export function computeFlows(graph: Graph, data: GameData): FlowResult {
  const edges = new Map<string, EdgeFlow>();
  const targetHandles = new Map<string, Map<string, HandleFlow>>();
  if (graph.edges.length === 0) return { edges, targetHandles };

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const byTarget = groupEdges(graph.edges, 'target');
  const bySource = groupEdges(graph.edges, 'source');

  const edgeRate = new Map<string, number>();
  for (const [nodeId, byHandle] of byTarget) {
    const node = nodeById.get(nodeId);
    for (const [handleId, group] of byHandle) {
      const demand = handleRate(node, data, handleId, 'in');
      const per = group.length ? demand / group.length : 0;
      for (const e of group) edgeRate.set(e.id, per);
    }
  }

  const edgeSourceUtil = new Map<string, number>();
  for (const [nodeId, byHandle] of bySource) {
    const node = nodeById.get(nodeId);
    for (const [handleId, group] of byHandle) {
      const capacity = handleRate(node, data, handleId, 'out');
      const sum = group.reduce((s, e) => s + (edgeRate.get(e.id) ?? 0), 0);
      // Zero-capacity source with positive demand is infinitely over-subscribed.
      const util = capacity > FLOW_EPS ? sum / capacity : sum > FLOW_EPS ? Infinity : 0;
      for (const e of group) edgeSourceUtil.set(e.id, util);
      if (sum > capacity + FLOW_EPS && sum > 0) {
        const scale = capacity / sum;
        for (const e of group) edgeRate.set(e.id, (edgeRate.get(e.id) ?? 0) * scale);
      }
    }
  }

  for (const [nodeId, byHandle] of byTarget) {
    const node = nodeById.get(nodeId);
    let handleMap = targetHandles.get(nodeId);
    if (!handleMap) targetHandles.set(nodeId, (handleMap = new Map()));
    for (const [handleId, group] of byHandle) {
      const demand = handleRate(node, data, handleId, 'in');
      const supply = group.reduce((s, e) => s + (edgeRate.get(e.id) ?? 0), 0);
      const satisfaction = demand > FLOW_EPS ? Math.min(1, supply / demand) : 1;
      handleMap.set(handleId, { supply, demand, satisfaction });
      for (const e of group) {
        edges.set(e.id, {
          rate: edgeRate.get(e.id) ?? 0,
          satisfaction,
          sourceUtilization: edgeSourceUtil.get(e.id) ?? 0,
        });
      }
    }
  }

  return { edges, targetHandles };
}
