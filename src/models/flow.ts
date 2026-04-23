import type { GameData } from '@/data/types';
import type {
  BlueprintNodeData,
  Graph,
  GraphEdge,
  GraphNode,
  NodeId,
  RecipeNodeData,
} from '@/models/graph';
import type { Blueprint, BlueprintId } from '@/models/blueprint';
import {
  handleIndexFromId,
  internalNodeIdFromBlueprintHandle,
  recipeInputs,
  recipeOutputs,
} from './factory';

export const FLOW_EPS = 1e-6;

export type BlueprintLookup = Record<BlueprintId, Blueprint>;

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
  blueprints: BlueprintLookup,
  handleId: string,
  side: 'in' | 'out',
): number {
  if (!node) return 0;
  if (node.data.kind === 'recipe') {
    const recipe = data.recipes[(node.data as RecipeNodeData).recipeId];
    if (!recipe) return 0;
    const io =
      side === 'in'
        ? recipeInputs(recipe, node.data as RecipeNodeData)
        : recipeOutputs(recipe, node.data as RecipeNodeData, data);
    const index = handleIndexFromId(handleId);
    return index != null && io[index] ? io[index].rate : 0;
  }
  // Input source is an infinite tap; Output target is an infinite sink.
  // computeFlows recognizes Infinity and propagates from the other edge end.
  if (node.data.kind === 'input' && side === 'out') return Number.POSITIVE_INFINITY;
  if (node.data.kind === 'output' && side === 'in') return Number.POSITIVE_INFINITY;
  if (node.data.kind === 'blueprint') {
    return blueprintHandleRate(node.data as BlueprintNodeData, handleId, side, data, blueprints);
  }
  return 0;
}

function blueprintHandleRate(
  bpData: BlueprintNodeData,
  handleId: string,
  side: 'in' | 'out',
  data: GameData,
  blueprints: BlueprintLookup,
): number {
  const bp = blueprints[bpData.blueprintId];
  if (!bp) return 0;
  const internalId = internalNodeIdFromBlueprintHandle(handleId);
  if (!internalId) return 0;
  const rates = blueprintInterfaceRates(bp, data, blueprints);
  const map = side === 'in' ? rates.inputs : rates.outputs;
  return (map.get(internalId) ?? 0) * Math.max(0, bpData.count);
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

function satisfactionFor(demand: number, supply: number): number {
  if (demand === Number.POSITIVE_INFINITY) return 1;
  if (demand <= FLOW_EPS) return 1;
  return Math.min(1, supply / demand);
}

// Demand-driven + source-capped flow:
//   1. Split each target handle's demand equally across its incoming edges.
//      If the target is a pass-through sink (Input/Output with demand=Infinity),
//      each edge instead inherits its source handle's capacity.
//   2. If a source handle's outgoing requests exceed its capacity, scale those
//      edges down proportionally. Taps (Input source handle) have no cap.
//   3. Re-measure each target handle's actual supply and derive satisfaction.
//      Edges inherit their target handle's satisfaction ratio.
export function computeFlows(
  graph: Graph,
  data: GameData,
  blueprints: BlueprintLookup = {},
): FlowResult {
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
      const demand = handleRate(node, data, blueprints, handleId, 'in');
      if (demand === Number.POSITIVE_INFINITY) {
        for (const e of group) {
          const src = nodeById.get(e.source);
          const cap = handleRate(src, data, blueprints, e.sourceHandle, 'out');
          edgeRate.set(e.id, Number.isFinite(cap) ? cap : 0);
        }
        continue;
      }
      const per = group.length ? demand / group.length : 0;
      for (const e of group) edgeRate.set(e.id, per);
    }
  }

  const edgeSourceUtil = new Map<string, number>();
  for (const [nodeId, byHandle] of bySource) {
    const node = nodeById.get(nodeId);
    for (const [handleId, group] of byHandle) {
      const capacity = handleRate(node, data, blueprints, handleId, 'out');
      if (capacity === Number.POSITIVE_INFINITY) {
        for (const e of group) edgeSourceUtil.set(e.id, 0);
        continue;
      }
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
      const demand = handleRate(node, data, blueprints, handleId, 'in');
      const supply = group.reduce((s, e) => s + (edgeRate.get(e.id) ?? 0), 0);
      const satisfaction = satisfactionFor(demand, supply);
      const reportedDemand = demand === Number.POSITIVE_INFINITY ? supply : demand;
      handleMap.set(handleId, { supply, demand: reportedDemand, satisfaction });
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

export interface BlueprintInterfaceRates {
  inputs: Map<NodeId, number>;
  outputs: Map<NodeId, number>;
  inputNodes: GraphNode[];
  outputNodes: GraphNode[];
}

// Memoized on the blueprint record reference — the store emits a new record
// on every edit, so the WeakMap entry invalidates automatically.
const blueprintRateCache = new WeakMap<Blueprint, BlueprintInterfaceRates>();

export function blueprintInterfaceRates(
  bp: Blueprint,
  data: GameData,
  blueprints: BlueprintLookup = {},
): BlueprintInterfaceRates {
  const cached = blueprintRateCache.get(bp);
  if (cached) return cached;

  const subgraph: Graph = { id: bp.id, name: bp.name, nodes: bp.nodes, edges: bp.edges };
  const result = computeFlows(subgraph, data, blueprints);
  const inputs = new Map<NodeId, number>();
  const outputs = new Map<NodeId, number>();
  const inputNodes: GraphNode[] = [];
  const outputNodes: GraphNode[] = [];
  for (const n of bp.nodes) {
    if (n.data.kind === 'input') {
      inputNodes.push(n);
      let sum = 0;
      for (const e of bp.edges) {
        if (e.source === n.id) sum += result.edges.get(e.id)?.rate ?? 0;
      }
      inputs.set(n.id, sum);
    } else if (n.data.kind === 'output') {
      outputNodes.push(n);
      let sum = 0;
      for (const e of bp.edges) {
        if (e.target === n.id) sum += result.edges.get(e.id)?.rate ?? 0;
      }
      outputs.set(n.id, sum);
    }
  }
  const entry: BlueprintInterfaceRates = { inputs, outputs, inputNodes, outputNodes };
  blueprintRateCache.set(bp, entry);
  return entry;
}
