import type { GameData, ItemId, Recipe, RecipeId } from '@/data/types';
import type { Graph, GraphEdge, GraphNode, NodeId, RecipeNodeData } from '@/models/graph';
import { getRecipesProducing } from '@/data/loader';
import { recipeInputs, recipeOutputs } from '@/models/factory';

export interface ChainRecipeEntry {
  nodeId: NodeId;
  recipeId: RecipeId;
  clockSpeed: number;
  count: number;
  somersloops: number;
  // Effective rate of one "unit" of this recipe (count=1, clock=1, no sloops)
  // — what the LP variable's coefficient against each item should multiply.
  // Per-minute on a single 100% machine.
  perMachineRates: { ingredients: ItemRate[]; products: ItemRate[] };
  // The current per-minute rates given count/clock/somersloops, used for diff.
  currentRates: { ingredients: ItemRate[]; products: ItemRate[] };
}

export interface ItemRate {
  itemId: ItemId;
  rate: number;
}

export interface OptimizerScope {
  // Recipe nodes upstream of (and including) the target, walked back through
  // recipe nodes only. Excludes the rest of the graph.
  chain: ChainRecipeEntry[];
  // Items produced by any chain recipe (the optimizer picks among alternates
  // for these).
  internalItems: Set<ItemId>;
  // Items the chain currently consumes that no chain recipe produces. These
  // become free supply variables in the LP — costed by the objective but not
  // re-derived from raw resources.
  boundaryItems: Set<ItemId>;
  // The chain's target item + the rate it should produce.
  target: { itemId: ItemId; rate: number };
  // Candidate recipes the LP can pick from: every (non-manual, non-extraction)
  // recipe that produces an internal item. Indexed by recipeId.
  candidates: Map<RecipeId, CandidateRecipe>;
  // True if any chain node has somersloops installed. Sloops are stripped from
  // every rate calculation (LP can't model the asymmetric product-only boost),
  // so the modal surfaces a warning when this is set.
  hasSloops: boolean;
}

export interface CandidateRecipe {
  recipeId: RecipeId;
  // Per-minute rates if the recipe runs once at 100% clock with no sloops.
  // Multiplied by the LP's chosen rate to get actual throughput.
  ingredients: ItemRate[];
  products: ItemRate[];
  powerMW: number;
}

function isRecipeNode(n: GraphNode | undefined): n is GraphNode & { data: RecipeNodeData } {
  return !!n && n.data.kind === 'recipe';
}

// Synthetic node at count=1, clock=1, no sloops — the LP variable's "one unit"
// of a recipe. Sloop boost is intentionally absent: the LP is linear and can't
// model the asymmetric product-only multiplier; the modal warns when chain
// nodes have sloops installed.
const UNIT_NODE: RecipeNodeData = {
  kind: 'recipe',
  recipeId: '',
  clockSpeed: 1,
  count: 1,
  somersloops: 0,
};

function perMachineRates(recipe: Recipe, gameData: GameData): {
  ingredients: ItemRate[];
  products: ItemRate[];
} {
  return {
    ingredients: recipeInputs(recipe, UNIT_NODE),
    products: recipeOutputs(recipe, UNIT_NODE, gameData),
  };
}

// Sloops are deliberately ignored (see UNIT_NODE). chainRates uses recipeInputs
// / recipeOutputs at the node's clock + count but with a zeroed-sloop view.
function chainRates(
  recipe: Recipe,
  data: RecipeNodeData,
  gameData: GameData,
): { ingredients: ItemRate[]; products: ItemRate[] } {
  const noSloop: RecipeNodeData = { ...data, somersloops: 0 };
  return {
    ingredients: recipeInputs(recipe, noSloop),
    products: recipeOutputs(recipe, noSloop, gameData),
  };
}

// Determine the chain's "output" given the user-selected target node. For a
// recipe node, the primary product (first non-byproduct) at its current rate
// is the target. Output nodes route their inbound edge's item at the inflow
// rate. Returns null if the node can't anchor an optimization (e.g. an
// uncommitted output, a hub, a factory).
function deriveTarget(
  graph: Graph,
  targetNode: GraphNode,
  gameData: GameData,
): { itemId: ItemId; rate: number } | null {
  if (targetNode.data.kind === 'recipe') {
    const recipe = gameData.recipes[targetNode.data.recipeId];
    if (!recipe) return null;
    const primary = recipe.products.find((p) => !p.isByproduct) ?? recipe.products[0];
    if (!primary) return null;
    // recipeOutputs with sloops zeroed — chain rate is the no-sloop view; the
    // user keeps existing sloops on whatever recipes survive the optimizer.
    const products = recipeOutputs(
      recipe,
      { ...targetNode.data, somersloops: 0 },
      gameData,
    );
    const primaryOut = products.find((p) => p.itemId === primary.itemId);
    if (!primaryOut) return null;
    return { itemId: primary.itemId, rate: primaryOut.rate };
  }
  if (targetNode.data.kind === 'output') {
    const itemId = targetNode.data.itemId;
    if (!itemId) return null;
    let rate = 0;
    for (const e of graph.edges) {
      if (e.target === targetNode.id) rate += e.rate;
    }
    return { itemId, rate };
  }
  return null;
}

// Whether a node is a non-extraction recipe — i.e. something the optimizer can
// reason about. Extraction recipes (miners, water extractors, oil extractors)
// represent a resource node feeding raw materials in; they're not LP candidates
// and must stop the chain walk so their products become boundary items, not
// internal items needing a (non-existent) producing candidate.
function isOptimizableRecipe(
  node: GraphNode | undefined,
  gameData: GameData,
): node is GraphNode & { data: RecipeNodeData } {
  if (!isRecipeNode(node)) return false;
  const recipe = gameData.recipes[node.data.recipeId];
  return !!recipe && !recipe.isExtraction;
}

function buildIncomingEdgeIndex(edges: GraphEdge[]): Map<NodeId, GraphEdge[]> {
  const index = new Map<NodeId, GraphEdge[]>();
  for (const e of edges) {
    const arr = index.get(e.target);
    if (arr) arr.push(e);
    else index.set(e.target, [e]);
  }
  return index;
}

// Walks back through (non-extraction) recipe nodes from the target. Stops at
// any non-recipe upstream node OR at extraction recipes — those edges become
// the chain's boundary.
function gatherChainRecipes(
  targetNodeId: NodeId,
  gameData: GameData,
  nodeById: Map<NodeId, GraphNode>,
  incomingEdges: Map<NodeId, GraphEdge[]>,
): ChainRecipeEntry[] {
  const visited = new Set<NodeId>();
  const stack: NodeId[] = [];
  const start = nodeById.get(targetNodeId);
  if (isOptimizableRecipe(start, gameData)) stack.push(targetNodeId);
  else if (start && start.data.kind === 'output') {
    for (const e of incomingEdges.get(targetNodeId) ?? []) {
      const src = nodeById.get(e.source);
      if (isOptimizableRecipe(src, gameData)) stack.push(src.id);
    }
  } else {
    return [];
  }

  const chain: ChainRecipeEntry[] = [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeById.get(id);
    if (!isOptimizableRecipe(node, gameData)) continue;
    chain.push({
      nodeId: id,
      recipeId: node.data.recipeId,
      clockSpeed: node.data.clockSpeed,
      count: node.data.count,
      somersloops: node.data.somersloops,
      perMachineRates: { ingredients: [], products: [] },
      currentRates: { ingredients: [], products: [] },
    });
    for (const e of incomingEdges.get(id) ?? []) {
      const src = nodeById.get(e.source);
      if (isOptimizableRecipe(src, gameData) && !visited.has(src.id)) stack.push(src.id);
    }
  }
  return chain;
}

export function gatherUpstreamScope(
  graph: Graph,
  targetNodeId: NodeId,
  gameData: GameData,
): OptimizerScope | null {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const targetNode = nodeById.get(targetNodeId);
  if (!targetNode) return null;

  const target = deriveTarget(graph, targetNode, gameData);
  if (!target || target.rate <= 0) return null;

  const incomingEdges = buildIncomingEdgeIndex(graph.edges);
  const chainRaw = gatherChainRecipes(targetNodeId, gameData, nodeById, incomingEdges);
  if (chainRaw.length === 0) return null;

  const chain: ChainRecipeEntry[] = chainRaw.map((entry) => {
    const recipe = gameData.recipes[entry.recipeId];
    if (!recipe) return entry;
    return {
      ...entry,
      perMachineRates: perMachineRates(recipe, gameData),
      currentRates: chainRates(recipe, nodeById.get(entry.nodeId)!.data as RecipeNodeData, gameData),
    };
  });

  const hasSloops = chain.some((entry) => entry.somersloops > 0);

  const internalItems = new Set<ItemId>();
  for (const entry of chain) {
    for (const p of entry.perMachineRates.products) internalItems.add(p.itemId);
  }

  const boundaryItems = new Set<ItemId>();
  for (const entry of chain) {
    for (const ing of entry.perMachineRates.ingredients) {
      if (!internalItems.has(ing.itemId)) boundaryItems.add(ing.itemId);
    }
  }

  // Candidate recipes: every (non-manual, non-extraction) recipe producing an
  // internal item — but only if every ingredient is already in scope. The
  // boundary is "what the current graph already consumes from outside"; we
  // don't extend it with new inputs an alternate would introduce. That keeps
  // the optimizer scoped to the existing graph instead of secretly pulling in
  // new resource chains the user hasn't placed.
  const candidates = new Map<RecipeId, CandidateRecipe>();
  for (const itemId of internalItems) {
    for (const recipe of getRecipesProducing(gameData, itemId)) {
      if (recipe.manualOnly) continue;
      if (recipe.isExtraction) continue;
      if (candidates.has(recipe.id)) continue;
      const rates = perMachineRates(recipe, gameData);
      const allIngredientsInScope = rates.ingredients.every(
        (ing) => internalItems.has(ing.itemId) || boundaryItems.has(ing.itemId),
      );
      if (!allIngredientsInScope) continue;
      candidates.set(recipe.id, {
        recipeId: recipe.id,
        ingredients: rates.ingredients,
        products: rates.products,
        powerMW: recipe.powerMW,
      });
    }
  }

  return { chain, internalItems, boundaryItems, target, candidates, hasSloops };
}

// Apples-to-apples view of the chain's current state under the same accounting
// the optimizer uses. recipeRates is in "100% machines" so it lines up with the
// LP variable. boundaryConsumption sums each boundary item's intake at current
// node settings.
export interface CurrentChainMetrics {
  recipeRates: Map<RecipeId, number>;
  boundaryConsumption: Map<ItemId, number>;
  powerMW: number;
  buildCostScalar: number;
}

export function currentChainMetrics(
  scope: OptimizerScope,
  gameData: GameData,
  graph: Graph,
): CurrentChainMetrics {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const recipeRates = new Map<RecipeId, number>();
  const boundaryConsumption = new Map<ItemId, number>();
  let powerMW = 0;
  let buildCostScalar = 0;

  for (const entry of scope.chain) {
    const recipe = gameData.recipes[entry.recipeId];
    const node = nodeById.get(entry.nodeId);
    if (!recipe || !node || node.data.kind !== 'recipe') continue;
    const data = node.data as RecipeNodeData;
    // "Machines at 100%" — count × clockSpeed. Somersloops boost products
    // (asymmetric), so a sloop-boosted display in machine-equivalents would
    // misalign ingredient consumption. Skip them for v0; the chain's actual
    // consumption is read from currentRates below, which already accounts.
    const machines100 = data.count * data.clockSpeed;
    recipeRates.set(entry.recipeId, (recipeRates.get(entry.recipeId) ?? 0) + machines100);

    for (const ing of entry.currentRates.ingredients) {
      if (!scope.boundaryItems.has(ing.itemId)) continue;
      boundaryConsumption.set(
        ing.itemId,
        (boundaryConsumption.get(ing.itemId) ?? 0) + ing.rate,
      );
    }

    // Power and build cost are reported at LP semantics (linear in machines-
    // at-100%) so they're apples-to-apples with the optimizer's totals. The
    // LP doesn't choose clock speeds — comparing against the user's actual
    // overclocked / underclocked power (clock^1.6 nonlinear) would imply
    // savings that come from de-clocking, not from the optimizer's recipe
    // choices. The Info panel still shows real power via nodePowerMW.
    powerMW += recipe.powerMW * machines100;

    const machine = gameData.machines[recipe.machineId];
    if (machine?.buildCost) {
      const partsPerMachine = machine.buildCost.reduce((s, io) => s + io.amount, 0);
      buildCostScalar += partsPerMachine * machines100;
    }
  }

  return { recipeRates, boundaryConsumption, powerMW, buildCostScalar };
}
