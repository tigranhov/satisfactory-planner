import type { GameData } from '@/data/types';
import type {
  BlueprintNodeData,
  FactoryNodeData,
  Graph,
  GraphEdge,
  GraphNode,
  NodeId,
  RecipeNodeData,
} from '@/models/graph';
import type { Blueprint } from '@/models/blueprint';
import {
  handleIndexFromId,
  internalNodeIdFromSubgraphHandle,
  recipeInputs,
  recipeOutputs,
} from './factory';

export const FLOW_EPS = 1e-6;

// Resolves a subgraph id to its Graph. Both blueprint ids and factory graph
// ids flow through the same resolver so flow.ts stays agnostic about where
// a subgraph lives (blueprint library vs graphStore).
export type SubgraphResolver = (id: string) => Graph | undefined;

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
  resolver: SubgraphResolver,
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
  if (node.data.kind === 'input' && side === 'out') return Number.POSITIVE_INFINITY;
  if (node.data.kind === 'output' && side === 'in') return Number.POSITIVE_INFINITY;
  if (node.data.kind === 'blueprint') {
    const bp = node.data as BlueprintNodeData;
    return subgraphHandleRate(bp.blueprintId, bp.count, handleId, side, data, resolver);
  }
  if (node.data.kind === 'factory') {
    const fac = node.data as FactoryNodeData;
    return subgraphHandleRate(fac.factoryGraphId, 1, handleId, side, data, resolver);
  }
  return 0;
}

function subgraphHandleRate(
  subgraphId: string,
  outerCount: number,
  handleId: string,
  side: 'in' | 'out',
  data: GameData,
  resolver: SubgraphResolver,
): number {
  const g = resolver(subgraphId);
  if (!g) return 0;
  const internalId = internalNodeIdFromSubgraphHandle(handleId);
  if (!internalId) return 0;
  const rates = graphInterfaceRates(g, data, resolver);
  const map = side === 'in' ? rates.inputs : rates.outputs;
  return (map.get(internalId) ?? 0) * Math.max(0, outerCount);
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

const NO_RESOLVER: SubgraphResolver = () => undefined;

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
  resolver: SubgraphResolver = NO_RESOLVER,
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
      const demand = handleRate(node, data, resolver, handleId, 'in');
      if (demand === Number.POSITIVE_INFINITY) {
        for (const e of group) {
          const src = nodeById.get(e.source);
          const cap = handleRate(src, data, resolver, e.sourceHandle, 'out');
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
      const capacity = handleRate(node, data, resolver, handleId, 'out');
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
      const demand = handleRate(node, data, resolver, handleId, 'in');
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

export interface GraphInterfaceRates {
  inputs: Map<NodeId, number>;
  outputs: Map<NodeId, number>;
  inputNodes: GraphNode[];
  outputNodes: GraphNode[];
}

// Memoized on the Graph reference. Blueprint and factory stores both emit
// fresh Graph objects on every edit, so WeakMap entries invalidate naturally.
const graphRateCache = new WeakMap<Graph, GraphInterfaceRates>();

export function graphInterfaceRates(
  graph: Graph,
  data: GameData,
  resolver: SubgraphResolver = NO_RESOLVER,
): GraphInterfaceRates {
  const cached = graphRateCache.get(graph);
  if (cached) return cached;
  const result = computeFlows(graph, data, resolver);
  const inputs = new Map<NodeId, number>();
  const outputs = new Map<NodeId, number>();
  const inputNodes: GraphNode[] = [];
  const outputNodes: GraphNode[] = [];
  for (const n of graph.nodes) {
    if (n.data.kind === 'input') {
      inputNodes.push(n);
      let sum = 0;
      for (const e of graph.edges) {
        if (e.source === n.id) sum += result.edges.get(e.id)?.rate ?? 0;
      }
      inputs.set(n.id, sum);
    } else if (n.data.kind === 'output') {
      outputNodes.push(n);
      let sum = 0;
      for (const e of graph.edges) {
        if (e.target === n.id) sum += result.edges.get(e.id)?.rate ?? 0;
      }
      outputs.set(n.id, sum);
    }
  }
  const entry: GraphInterfaceRates = { inputs, outputs, inputNodes, outputNodes };
  graphRateCache.set(graph, entry);
  return entry;
}

// Synthesizes a Graph from a Blueprint record (memoized so the resolver and
// flow cache see a stable object identity across repeated lookups).
const blueprintGraphCache = new WeakMap<Blueprint, Graph>();
export function graphFromBlueprint(bp: Blueprint): Graph {
  let g = blueprintGraphCache.get(bp);
  if (!g) {
    g = { id: bp.id, name: bp.name, nodes: bp.nodes, edges: bp.edges };
    blueprintGraphCache.set(bp, g);
  }
  return g;
}
