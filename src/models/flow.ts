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
  // Hub rates are dynamic (derived from connected edges) and computed inline
  // in computeFlows where the edge-rate map is in scope.
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

// Topological sort of hub nodes using only hub→hub edges. Returns hubs in
// upstream-first order; reverse it for downstream-first. A cycle collapses
// to insertion order (with a warning) — hub cycles aren't a supported shape.
function topoSortHubs(
  hubs: GraphNode[],
  edges: readonly GraphEdge[],
  nodeById: Map<string, GraphNode>,
): GraphNode[] {
  const hubIds = new Set(hubs.map((h) => h.id));
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const h of hubs) {
    adj.set(h.id, []);
    inDeg.set(h.id, 0);
  }
  for (const e of edges) {
    if (!hubIds.has(e.source) || !hubIds.has(e.target) || e.source === e.target) continue;
    adj.get(e.source)!.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);
  const ordered: GraphNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const n = nodeById.get(id);
    if (n) ordered.push(n);
    for (const next of adj.get(id) ?? []) {
      const d = (inDeg.get(next) ?? 0) - 1;
      inDeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (ordered.length !== hubs.length) {
    console.warn('[flow] hub-to-hub cycle detected; falling back to insertion order');
    return hubs;
  }
  return ordered;
}

const NO_RESOLVER: SubgraphResolver = () => undefined;

// Demand-driven + source-capped flow:
//   1a. Each non-hub target handle splits its demand across incoming edges
//       (or, for Input/Output boundaries with demand=Infinity, inherits
//       each source's capacity).
//   1b. Hubs are processed in reverse topological order: each hub's input
//       edges take rate = sum(out-edges) / N. hubInDemand caches the
//       pre-scaling total for Phase 3 reporting.
//   2a. Non-hub source handles scale their outgoing edges down if over
//       capacity. Taps (Input source handle) have no cap.
//   2b. Hub source handles do the same, in forward topological order, so
//       upstream hub scaling settles before downstream hubs read capacity.
//   3.  Per target handle: demand, supply, satisfaction; edges inherit
//       the target's satisfaction ratio.
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
  // hub input demand (pre-Phase-2 scaling) — reported in Phase 3 so
  // shortage is detected against the consumers' original ask, not the
  // post-cap delivery.
  const hubInDemand = new Map<NodeId, number>();

  // A hub's input-handle demand mirrors its output-side load, and its
  // output-handle capacity mirrors its input-side supply — hence the
  // map inversion.
  const hubRate = (nodeId: NodeId, side: 'in' | 'out'): number => {
    const map = side === 'in' ? bySource.get(nodeId) : byTarget.get(nodeId);
    if (!map) return 0;
    let sum = 0;
    for (const group of map.values()) {
      for (const e of group) sum += edgeRate.get(e.id) ?? 0;
    }
    return sum;
  };
  const rateOf = (node: GraphNode | undefined, handleId: string, side: 'in' | 'out'): number => {
    if (node?.data.kind === 'hub') return hubRate(node.id, side);
    return handleRate(node, data, resolver, handleId, side);
  };

  // Phase 1a
  for (const [nodeId, byHandle] of byTarget) {
    const node = nodeById.get(nodeId);
    if (node?.data.kind === 'hub') continue;
    for (const [handleId, group] of byHandle) {
      const demand = rateOf(node, handleId, 'in');
      if (demand === Number.POSITIVE_INFINITY) {
        for (const e of group) {
          const src = nodeById.get(e.source);
          const cap = rateOf(src, e.sourceHandle, 'out');
          edgeRate.set(e.id, Number.isFinite(cap) ? cap : 0);
        }
        continue;
      }
      const per = group.length ? demand / group.length : 0;
      for (const e of group) edgeRate.set(e.id, per);
    }
  }

  // Phase 1b
  const hubs = graph.nodes.filter((n) => n.data.kind === 'hub');
  const hubsForward = hubs.length ? topoSortHubs(hubs, graph.edges, nodeById) : [];
  const hubsReverse = hubsForward.slice().reverse();
  for (const hub of hubsReverse) {
    let totalDemand = 0;
    const sh = bySource.get(hub.id);
    if (sh) {
      for (const group of sh.values()) {
        for (const e of group) totalDemand += edgeRate.get(e.id) ?? 0;
      }
    }
    hubInDemand.set(hub.id, totalDemand);
    const th = byTarget.get(hub.id);
    if (!th) continue;
    for (const group of th.values()) {
      const per = group.length ? totalDemand / group.length : 0;
      for (const e of group) edgeRate.set(e.id, per);
    }
  }

  const edgeSourceUtil = new Map<string, number>();
  const scaleSource = (group: GraphEdge[], capacity: number) => {
    const sum = group.reduce((s, e) => s + (edgeRate.get(e.id) ?? 0), 0);
    const util = capacity > FLOW_EPS ? sum / capacity : sum > FLOW_EPS ? Infinity : 0;
    for (const e of group) edgeSourceUtil.set(e.id, util);
    if (sum > capacity + FLOW_EPS && sum > 0) {
      const scale = capacity / sum;
      for (const e of group) edgeRate.set(e.id, (edgeRate.get(e.id) ?? 0) * scale);
    }
  };

  // Phase 2a
  for (const [nodeId, byHandle] of bySource) {
    const node = nodeById.get(nodeId);
    if (node?.data.kind === 'hub') continue;
    for (const [handleId, group] of byHandle) {
      const capacity = rateOf(node, handleId, 'out');
      if (capacity === Number.POSITIVE_INFINITY) {
        for (const e of group) edgeSourceUtil.set(e.id, 0);
        continue;
      }
      scaleSource(group, capacity);
    }
  }

  // Phase 2b
  for (const hub of hubsForward) {
    const byHandle = bySource.get(hub.id);
    if (!byHandle) continue;
    const capacity = hubRate(hub.id, 'out');
    for (const [, group] of byHandle) scaleSource(group, capacity);
  }

  // Phase 3
  for (const [nodeId, byHandle] of byTarget) {
    const node = nodeById.get(nodeId);
    let handleMap = targetHandles.get(nodeId);
    if (!handleMap) targetHandles.set(nodeId, (handleMap = new Map()));
    for (const [handleId, group] of byHandle) {
      const demand =
        node?.data.kind === 'hub'
          ? hubInDemand.get(node.id) ?? 0
          : rateOf(node, handleId, 'in');
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
