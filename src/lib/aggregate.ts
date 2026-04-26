import type { GameData, ItemId, MachineId, RecipeId, RecipeIO } from '@/data/types';
import type { Graph, GraphId, GraphNode, NodeId, RecipeNodeData, SinkNodeData } from '@/models/graph';
import { computeFlows, graphInterfaceRates, type EdgeFlow, type SubgraphResolver } from '@/models/flow';
import {
  nodePowerMW,
  lookupRecipeForNode,
  recipeInputs,
  recipeOutputs,
  somersloopBoost,
} from '@/models/factory';

// Overclocking and underclocking are intentional config, not problems —
// they're surfaced as a clock badge on Machines rows instead.
export type IssueKind = 'unsatisfied' | 'disconnected-port' | 'orphan';
export type IssueSeverity = 'error' | 'warn';

export interface Issue {
  kind: IssueKind;
  severity: IssueSeverity;
  nodeId: NodeId;
  message: string;
}

export interface PowerSummary {
  consumptionMW: number;
  generationMW: number;
  netMW: number;
  avgClockPct: number;
}

export type IOSource = 'ports' | 'net';

export interface IOSummary {
  inputs: Map<ItemId, number>;
  outputs: Map<ItemId, number>;
  // Items that are both produced AND consumed inside the scope, with net > 0.
  // These are intermediates with extra production — distinguishing them from
  // "pure" outputs (produced and never consumed) avoids the user-facing trap
  // where over-building a part by 5/min surfaces it as a "final output."
  surplus: Map<ItemId, number>;
  source: IOSource;
}

// Tolerance for treating an item as balanced. Absolute floor of 0.01/min plus
// 0.1% of gross production to absorb floating-point noise on large flows.
function balanceTolerance(produced: number): number {
  return Math.max(0.01, produced * 0.001);
}

export interface MachineGroup {
  machineId: MachineId;
  recipeId: RecipeId;
  clockSpeed: number;
  count: number;
}

export interface SomersloopSummary {
  usage: SomersloopUsageRow[];
  totalSloops: number;
  machineCount: number;
}

export interface SomersloopUsageRow {
  nodeId: NodeId;
  recipeId: RecipeId;
  somersloops: number;
  slots: number;
  boostPct: number;
}

export interface PlannedBuildCost {
  summary: Map<ItemId, number>;
  perNode: Map<NodeId, RecipeIO[]>;
}

export interface SortedItem {
  itemId: ItemId;
  value: number;
  name: string;
  icon: string | undefined;
}

export function sortItemsByValue(
  map: Map<ItemId, number>,
  gameData: GameData,
): SortedItem[] {
  return Array.from(map.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([itemId, value]) => ({
      itemId,
      value,
      name: gameData.items[itemId]?.name ?? itemId,
      icon: gameData.items[itemId]?.icon,
    }));
}

// Visit every recipe node reachable from `graph`, descending into factory
// and blueprint instances. `multiplier` accumulates blueprint counts so a
// 3× blueprint instance's recipes count three times. `path` is depth-scoped
// to allow the same blueprint id to be visited at sibling positions while
// still breaking true cycles.
export function walkRecipeNodes(
  graph: Graph | undefined,
  resolver: SubgraphResolver,
  visit: (node: GraphNode, multiplier: number) => void,
  multiplier = 1,
  path: Set<string> = new Set(),
): void {
  if (!graph || path.has(graph.id)) return;
  path.add(graph.id);
  for (const node of graph.nodes) {
    if (node.data.kind === 'recipe') {
      visit(node, multiplier);
    } else if (node.data.kind === 'factory') {
      const sub = resolver(node.data.factoryGraphId);
      if (sub) walkRecipeNodes(sub, resolver, visit, multiplier, path);
    } else if (node.data.kind === 'blueprint') {
      const sub = resolver(node.data.blueprintId);
      const count = Math.max(0, node.data.count ?? 1);
      if (sub && count > 0) walkRecipeNodes(sub, resolver, visit, multiplier * count, path);
    }
  }
  path.delete(graph.id);
}

export function subgraphPower(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): PowerSummary {
  let consumption = 0;
  let generation = 0;
  let clockWeighted = 0;
  let weightTotal = 0;
  walkRecipeNodes(graph, resolver, (node, mult) => {
    const data = node.data as RecipeNodeData;
    const recipe = lookupRecipeForNode(gameData, data);
    if (!recipe) return;
    const power = nodePowerMW(recipe, data, gameData) * mult;
    if (power < 0) generation += -power;
    else consumption += power;
    const weight = (data.count || 0) * mult;
    if (weight > 0) {
      clockWeighted += data.clockSpeed * 100 * weight;
      weightTotal += weight;
    }
  });
  return {
    consumptionMW: consumption,
    generationMW: generation,
    netMW: generation - consumption,
    avgClockPct: weightTotal > 0 ? clockWeighted / weightTotal : 0,
  };
}

// Visit every sink node reachable from `graph`, recursing into factory and
// blueprint instances the same way `walkRecipeNodes` does so a 3× blueprint
// counts its internal sinks three times. The visitor receives the graph the
// node lives in (`parent`) so callers can read incident-edge rates from
// `computeFlows(parent, ...)` without re-walking.
export function walkSinkNodes(
  graph: Graph | undefined,
  resolver: SubgraphResolver,
  visit: (parent: Graph, node: GraphNode, multiplier: number) => void,
  multiplier = 1,
  path: Set<string> = new Set(),
): void {
  if (!graph || path.has(graph.id)) return;
  path.add(graph.id);
  for (const node of graph.nodes) {
    if (node.data.kind === 'sink') {
      visit(graph, node, multiplier);
    } else if (node.data.kind === 'factory') {
      const sub = resolver(node.data.factoryGraphId);
      if (sub) walkSinkNodes(sub, resolver, visit, multiplier, path);
    } else if (node.data.kind === 'blueprint') {
      const sub = resolver(node.data.blueprintId);
      const count = Math.max(0, node.data.count ?? 1);
      if (sub && count > 0) walkSinkNodes(sub, resolver, visit, multiplier * count, path);
    }
  }
  path.delete(graph.id);
}

// Project-level AWESOME Sink points / minute: for every sink node anywhere in
// the project, sum (inflow rate × Item.sinkPoints), with blueprint count as a
// multiplier. A sink with an item lacking sinkPoints contributes 0.
export function globalSinkPoints(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): number {
  if (!graph) return 0;
  let total = 0;
  walkSinkNodes(graph, resolver, (parent, node, mult) => {
    const data = node.data as SinkNodeData;
    if (!data.sinkItemId) return;
    const points = gameData.items[data.sinkItemId]?.sinkPoints ?? 0;
    if (points <= 0) return;
    const flow = computeFlows(parent, gameData, resolver);
    let rate = 0;
    for (const e of parent.edges) {
      if (e.target !== node.id) continue;
      rate += flow.edges.get(e.id)?.rate ?? 0;
    }
    total += rate * points * mult;
  });
  return total;
}

// Items extracted from the world: outputs of any recipe with isExtraction set
// (miners, oil extractors, water extractors, etc.), recursed across the project.
export function globalRawInputs(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): Map<ItemId, number> {
  const out = new Map<ItemId, number>();
  walkRecipeNodes(graph, resolver, (node, mult) => {
    const data = node.data as RecipeNodeData;
    const recipe = lookupRecipeForNode(gameData, data);
    if (!recipe || !recipe.isExtraction) return;
    for (const io of recipeOutputs(recipe, data, gameData)) {
      out.set(io.itemId, (out.get(io.itemId) ?? 0) + io.rate * mult);
    }
  });
  return out;
}

// Aggregate produced/consumed at the immediate level of `graph`. Recipes
// directly under `graph` contribute their raw I/O. Nested factory and
// blueprint instances contribute only what crosses THEIR boundary (their
// `effectiveBoundary` exports/imports), so internal-only items in a nested
// subgraph stay invisible to the parent — matching what physically happens
// in the game when a closed-loop blueprint never routes a byproduct to its
// boundary.
interface BoundaryResult {
  exports: Map<ItemId, number>;
  imports: Map<ItemId, number>;
}

// Per-call-tree memoization of effectiveBoundary so a project with N
// instances of the same blueprint computes that boundary once, not N times.
// Cache scope is one call tree: passed through recursion, never module-level
// (avoids staleness across edits — the parent's Graph reference changes when
// any of its nodes change, but not when a referenced sub-graph mutates).
type BoundaryCache = Map<string, BoundaryResult>;

function immediateFlow(
  graph: Graph,
  gameData: GameData,
  resolver: SubgraphResolver,
  cache: BoundaryCache,
  visited: Set<string>,
): { produced: Map<ItemId, number>; consumed: Map<ItemId, number> } {
  const produced = new Map<ItemId, number>();
  const consumed = new Map<ItemId, number>();
  // Lazy — only graphs with a sink node pay the (memoized) computeFlows call.
  let edgeRates: Map<string, EdgeFlow> | null = null;
  const sinkInflow = (edgeId: string): number => {
    if (!edgeRates) edgeRates = computeFlows(graph, gameData, resolver).edges;
    return edgeRates.get(edgeId)?.rate ?? 0;
  };
  for (const node of graph.nodes) {
    if (node.data.kind === 'recipe') {
      const data = node.data as RecipeNodeData;
      const recipe = lookupRecipeForNode(gameData, data);
      if (!recipe) continue;
      for (const io of recipeOutputs(recipe, data, gameData)) {
        produced.set(io.itemId, (produced.get(io.itemId) ?? 0) + io.rate);
      }
      for (const io of recipeInputs(recipe, data)) {
        consumed.set(io.itemId, (consumed.get(io.itemId) ?? 0) + io.rate);
      }
    } else if (node.data.kind === 'factory') {
      const sub = resolver(node.data.factoryGraphId);
      if (!sub) continue;
      const inner = effectiveBoundary(sub, gameData, resolver, cache, visited);
      for (const [itemId, rate] of inner.exports) {
        produced.set(itemId, (produced.get(itemId) ?? 0) + rate);
      }
      for (const [itemId, rate] of inner.imports) {
        consumed.set(itemId, (consumed.get(itemId) ?? 0) + rate);
      }
    } else if (node.data.kind === 'blueprint') {
      const sub = resolver(node.data.blueprintId);
      const count = Math.max(0, node.data.count ?? 1);
      if (!sub || count <= 0) continue;
      const inner = effectiveBoundary(sub, gameData, resolver, cache, visited);
      for (const [itemId, rate] of inner.exports) {
        produced.set(itemId, (produced.get(itemId) ?? 0) + rate * count);
      }
      for (const [itemId, rate] of inner.imports) {
        consumed.set(itemId, (consumed.get(itemId) ?? 0) + rate * count);
      }
    } else if (node.data.kind === 'sink') {
      // A sink consumes whatever its incoming edges actually deliver. Without
      // this branch a closed-loop byproduct routed into a sink would still
      // surface as project-level surplus.
      for (const e of graph.edges) {
        if (e.target !== node.id || !e.itemId) continue;
        const rate = sinkInflow(e.id);
        if (rate <= 1e-6) continue;
        consumed.set(e.itemId, (consumed.get(e.itemId) ?? 0) + rate);
      }
    }
  }
  return { produced, consumed };
}

// What a subgraph contributes to its parent: items that actually cross its
// boundary. With ports declared, the port rates ARE the boundary. Without,
// fall back to net flow: items net-produced cross out, net-consumed cross in,
// balanced items stay internal.
function effectiveBoundary(
  graph: Graph,
  gameData: GameData,
  resolver: SubgraphResolver,
  cache: BoundaryCache = new Map(),
  visited: Set<string> = new Set(),
): BoundaryResult {
  const cached = cache.get(graph.id);
  if (cached) return cached;
  if (visited.has(graph.id)) return { exports: new Map(), imports: new Map() };
  visited.add(graph.id);

  const hasPorts = graph.nodes.some(
    (n) => n.data.kind === 'input' || n.data.kind === 'output',
  );

  let result: BoundaryResult;

  if (hasPorts) {
    const rates = graphInterfaceRates(graph, gameData, resolver);
    const exports = new Map<ItemId, number>();
    const imports = new Map<ItemId, number>();
    for (const node of rates.outputNodes) {
      if (node.data.kind !== 'output') continue;
      const itemId = node.data.itemId;
      if (!itemId) continue;
      const rate = rates.outputs.get(node.id) ?? 0;
      if (rate > 1e-6) exports.set(itemId, (exports.get(itemId) ?? 0) + rate);
    }
    for (const node of rates.inputNodes) {
      if (node.data.kind !== 'input') continue;
      const itemId = node.data.itemId;
      if (!itemId) continue;
      const rate = rates.inputs.get(node.id) ?? 0;
      if (rate > 1e-6) imports.set(itemId, (imports.get(itemId) ?? 0) + rate);
    }
    result = { exports, imports };
  } else {
    const { produced, consumed } = immediateFlow(graph, gameData, resolver, cache, visited);
    const exports = new Map<ItemId, number>();
    const imports = new Map<ItemId, number>();
    for (const [itemId, p] of produced) {
      if (p <= 1e-6) continue;
      const c = consumed.get(itemId) ?? 0;
      const tol = balanceTolerance(p);
      if (c <= 1e-6) exports.set(itemId, p);
      else if (p - c > tol) exports.set(itemId, p - c);
    }
    for (const [itemId, c] of consumed) {
      if (c <= 1e-6) continue;
      const p = produced.get(itemId) ?? 0;
      const tol = balanceTolerance(p > 0 ? p : c);
      if (p <= 1e-6) imports.set(itemId, c);
      else if (c - p > tol) imports.set(itemId, c - p);
    }
    result = { exports, imports };
  }

  visited.delete(graph.id);
  cache.set(graph.id, result);
  return result;
}

// Project-level final outputs: items produced somewhere but consumed nowhere
// at the project level. Sub-factory boundaries are respected via
// `immediateFlow` — items kept internal to a sub-factory (e.g., a closed-loop
// blueprint that never routes a byproduct to its boundary) don't bubble up
// to the project view.
export function globalFinalOutputs(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): Map<ItemId, number> {
  const out = new Map<ItemId, number>();
  if (!graph) return out;
  const { produced, consumed } = immediateFlow(graph, gameData, resolver, new Map(), new Set());
  for (const [itemId, p] of produced) {
    if (p <= 1e-6) continue;
    const c = consumed.get(itemId) ?? 0;
    if (c <= 1e-6) out.set(itemId, p);
  }
  return out;
}

// Project-level intermediates whose production exceeds consumption AT THE
// PROJECT level. Closed-loop internals (a sub-factory consumes its own
// byproduct without exporting it) don't appear here — `immediateFlow`
// treats sub-factories as boundary contributors only.
export function globalSurplus(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): Map<ItemId, number> {
  const out = new Map<ItemId, number>();
  if (!graph) return out;
  const { produced, consumed } = immediateFlow(graph, gameData, resolver, new Map(), new Set());
  for (const [itemId, p] of produced) {
    const c = consumed.get(itemId) ?? 0;
    if (c <= 1e-6) continue;
    const net = p - c;
    if (net > balanceTolerance(p)) out.set(itemId, net);
  }
  return out;
}

// Material flow at THIS subgraph's level, split into three categories so
// over-built intermediates don't masquerade as final outputs.
//   - `outputs`: items produced inside but consumed by NO contributor at this
//     level (recipes raw + nested sub-factory boundaries).
//   - `inputs`: items consumed inside but produced by no contributor, plus
//     intermediates whose consumption exceeds production (the deficit).
//   - `surplus`: intermediates (produced AND consumed at this level) with
//     net production > 0.
//
// Sub-factory internals are hidden behind their boundary: a closed-loop
// blueprint that never routes a byproduct out doesn't expose that byproduct
// at this level. To see closed-loop internals, drill into the subgraph.
export function subgraphIO(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): IOSummary {
  if (!graph) {
    return { inputs: new Map(), outputs: new Map(), surplus: new Map(), source: 'net' };
  }
  const hasPorts = graph.nodes.some(
    (n) => n.data.kind === 'input' || n.data.kind === 'output',
  );
  const { produced, consumed } = immediateFlow(graph, gameData, resolver, new Map(), new Set());

  // Surplus is defined relative to internal flow regardless of port mode —
  // even with ports declared, an over-built intermediate is still useful to
  // surface so the user knows where to dial back.
  const surplus = new Map<ItemId, number>();
  for (const [itemId, p] of produced) {
    const c = consumed.get(itemId) ?? 0;
    if (c <= 1e-6) continue;
    const net = p - c;
    if (net > balanceTolerance(p)) surplus.set(itemId, net);
  }

  if (hasPorts) {
    const rates = graphInterfaceRates(graph, gameData, resolver);
    const inputs = new Map<ItemId, number>();
    for (const node of rates.inputNodes) {
      if (node.data.kind !== 'input') continue;
      const itemId = node.data.itemId;
      if (!itemId) continue;
      const rate = rates.inputs.get(node.id) ?? 0;
      if (rate > 1e-6) inputs.set(itemId, (inputs.get(itemId) ?? 0) + rate);
    }
    const outputs = new Map<ItemId, number>();
    for (const node of rates.outputNodes) {
      if (node.data.kind !== 'output') continue;
      const itemId = node.data.itemId;
      if (!itemId) continue;
      const rate = rates.outputs.get(node.id) ?? 0;
      if (rate > 1e-6) outputs.set(itemId, (outputs.get(itemId) ?? 0) + rate);
    }
    // Drop surplus entries that the user already declared via an output port —
    // showing them in both Outputs and Surplus would double-count.
    for (const itemId of outputs.keys()) surplus.delete(itemId);
    return { inputs, outputs, surplus, source: 'ports' };
  }

  const inputs = new Map<ItemId, number>();
  const outputs = new Map<ItemId, number>();

  // Pure outputs: produced and never consumed.
  for (const [itemId, p] of produced) {
    if (p <= 1e-6) continue;
    const c = consumed.get(itemId) ?? 0;
    if (c <= 1e-6) outputs.set(itemId, p);
  }
  // Pure inputs (never produced) + intermediate deficits (consumed > produced).
  for (const [itemId, c] of consumed) {
    if (c <= 1e-6) continue;
    const p = produced.get(itemId) ?? 0;
    if (p <= 1e-6) {
      inputs.set(itemId, c);
    } else {
      const deficit = c - p;
      if (deficit > balanceTolerance(p)) inputs.set(itemId, deficit);
    }
  }

  return { inputs, outputs, surplus, source: 'net' };
}

// Build cost is collected only for nodes the user has explicitly tagged
// `planned`. Only recipe nodes have a machine + count, so factory/blueprint/
// hub-like instances are skipped — players plan those at the recipe level.
export function buildCostForNode(
  node: GraphNode,
  gameData: GameData,
): RecipeIO[] | null {
  if (node.data.kind !== 'recipe') return null;
  const data = node.data as RecipeNodeData;
  const recipe = gameData.recipes[data.recipeId];
  if (!recipe) return null;
  const machine = gameData.machines[recipe.machineId];
  const buildCost = machine?.buildCost;
  if (!buildCost || buildCost.length === 0) return null;
  const count = Math.max(0, data.count || 0);
  if (count === 0) return [];
  return buildCost.map((io) => ({ itemId: io.itemId, amount: io.amount * count }));
}

export function plannedBuildCost(
  graphs: Record<GraphId, Graph | undefined>,
  gameData: GameData,
): PlannedBuildCost {
  const summary = new Map<ItemId, number>();
  const perNode = new Map<NodeId, RecipeIO[]>();
  for (const graphId of Object.keys(graphs)) {
    const g = graphs[graphId];
    if (!g) continue;
    for (const node of g.nodes) {
      if (node.data.status !== 'planned') continue;
      const cost = buildCostForNode(node, gameData);
      if (!cost) continue;
      perNode.set(node.id, cost);
      for (const io of cost) {
        if (io.amount <= 0) continue;
        summary.set(io.itemId, (summary.get(io.itemId) ?? 0) + io.amount);
      }
    }
  }
  return { summary, perNode };
}

// Non-recursive on purpose — click-to-jump targets a node in the current
// graph, so a nested-factory's somersloops are surfaced after the user drills in.
export function somersloopUsage(
  graph: Graph | undefined,
  gameData: GameData,
): SomersloopSummary {
  if (!graph) return { usage: [], totalSloops: 0, machineCount: 0 };
  const usage: SomersloopUsageRow[] = [];
  let totalSloops = 0;
  for (const node of graph.nodes) {
    if (node.data.kind !== 'recipe') continue;
    const data = node.data as RecipeNodeData;
    if ((data.somersloops ?? 0) <= 0) continue;
    const recipe = gameData.recipes[data.recipeId];
    if (!recipe) continue;
    const slots = gameData.machines[recipe.machineId]?.somersloopSlots ?? 0;
    const boost = somersloopBoost(data.somersloops, slots);
    usage.push({
      nodeId: node.id,
      recipeId: data.recipeId,
      somersloops: data.somersloops,
      slots,
      boostPct: (boost - 1) * 100,
    });
    totalSloops += data.somersloops;
  }
  return { usage, totalSloops, machineCount: usage.length };
}

const SEV_RANK: Record<IssueSeverity, number> = { error: 0, warn: 1 };

// Issues are scoped to the current graph only — not recursive — so click-to-jump
// can land the user on the offending node directly. Nested-factory issues
// surface only after the user drills into that subgraph.
export function subgraphIssues(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): Issue[] {
  if (!graph) return [];
  const issues: Issue[] = [];
  const flow = computeFlows(graph, gameData, resolver);

  // Per-node edge counts feed the disconnected-port / orphan checks.
  const incident = new Map<NodeId, number>();
  for (const e of graph.edges) {
    incident.set(e.source, (incident.get(e.source) ?? 0) + 1);
    incident.set(e.target, (incident.get(e.target) ?? 0) + 1);
  }

  // Collapse multi-handle shortfalls into one issue per node so the list
  // stays readable on big graphs.
  const unsatisfiedNodes = new Set<NodeId>();
  for (const [nodeId, handles] of flow.targetHandles) {
    for (const hf of handles.values()) {
      if (hf.demand > 1e-6 && hf.satisfaction < 1 - 1e-3) {
        unsatisfiedNodes.add(nodeId);
        break;
      }
    }
  }
  for (const nodeId of unsatisfiedNodes) {
    issues.push({
      kind: 'unsatisfied',
      severity: 'error',
      nodeId,
      message: 'Unsatisfied input demand',
    });
  }

  for (const node of graph.nodes) {
    const count = incident.get(node.id) ?? 0;
    const kind = node.data.kind;
    if (kind === 'input' || kind === 'output') {
      if (count === 0) {
        issues.push({
          kind: 'disconnected-port',
          severity: 'warn',
          nodeId: node.id,
          message: kind === 'input' ? 'Disconnected input port' : 'Disconnected output port',
        });
      }
    } else if (count === 0) {
      issues.push({
        kind: 'orphan',
        severity: 'warn',
        nodeId: node.id,
        message: 'No connections',
      });
    }
  }

  return issues.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}

export function subgraphMachines(
  graph: Graph | undefined,
  gameData: GameData,
  resolver: SubgraphResolver,
): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();
  walkRecipeNodes(graph, resolver, (node, mult) => {
    const data = node.data as RecipeNodeData;
    const recipe = gameData.recipes[data.recipeId];
    if (!recipe) return;
    // Bucket clock to 3 decimals so 1.0 and 1.0000001 collapse together but
    // 100% and 250% become separate rows — clock is a config dimension.
    const clockKey = data.clockSpeed.toFixed(3);
    const key = `${recipe.machineId}::${data.recipeId}::${clockKey}`;
    const existing = groups.get(key);
    const count = (data.count || 0) * mult;
    if (existing) existing.count += count;
    else
      groups.set(key, {
        machineId: recipe.machineId,
        recipeId: data.recipeId,
        clockSpeed: data.clockSpeed,
        count,
      });
  });
  return Array.from(groups.values()).sort((a, b) => {
    const am = gameData.machines[a.machineId]?.name ?? a.machineId;
    const bm = gameData.machines[b.machineId]?.name ?? b.machineId;
    if (am !== bm) return am.localeCompare(bm);
    const ar = gameData.recipes[a.recipeId]?.name ?? a.recipeId;
    const br = gameData.recipes[b.recipeId]?.name ?? b.recipeId;
    if (ar !== br) return ar.localeCompare(br);
    return a.clockSpeed - b.clockSpeed;
  });
}

export function totalMachineCount(groups: MachineGroup[]): number {
  let total = 0;
  for (const g of groups) total += g.count;
  return total;
}
