import solver from 'javascript-lp-solver';
import type { GameData, ItemId, RecipeId } from '@/data/types';
import type { RecipeNodeData } from '@/models/graph';
import { recipeInputs, recipeOutputs } from '@/models/factory';
import type { CandidateRecipe } from './optimizerScope';

// Synthetic node — same shape the existing optimizer uses to compute "one
// 100% machine" rates. Sloops are zero by construction; the LP is linear
// and can't model the asymmetric product-only multiplier.
const UNIT_NODE: RecipeNodeData = {
  kind: 'recipe',
  recipeId: '',
  clockSpeed: 1,
  count: 1,
  somersloops: 0,
};

export interface YieldScope {
  // Capped boundary supply, items/min per input.
  inputs: Map<ItemId, number>;
  outputItemId: ItemId;
  // Every reachable item that isn't an input. The output item must be in here
  // for the scope to be solvable.
  internalItems: Set<ItemId>;
  // Forward-BFS-reachable non-extraction non-manual recipes whose ingredients
  // are all reachable from inputs.
  candidates: Map<RecipeId, CandidateRecipe>;
}

export interface YieldSolution {
  feasible: true;
  // Per-recipe rate in "100% machines".
  recipeRates: Map<RecipeId, number>;
  // Per-input items/min consumed (≤ cap by construction).
  inputUsage: Map<ItemId, number>;
  // Items the chain produces beyond what's consumed internally — keyed by
  // itemId. Includes the output item itself.
  surplus: Map<ItemId, number>;
  outputRate: number;
  totals: { powerMW: number; buildCostScalar: number };
}

export interface YieldError {
  feasible: false;
  message: string;
}

export type YieldResult = YieldSolution | YieldError;

interface ReachState {
  reachable: Set<ItemId>;
  candidates: Map<RecipeId, CandidateRecipe>;
}

// Forward BFS: a recipe joins the candidate set when all its ingredients are
// reachable. Initially only `inputs` are reachable; each new candidate marks
// its products reachable, which may unlock further recipes. Iterates to a
// fixed point.
function buildReach(inputItems: Iterable<ItemId>, gameData: GameData): ReachState {
  const reachable = new Set<ItemId>(inputItems);
  const candidates = new Map<RecipeId, CandidateRecipe>();
  const recipeList = Object.values(gameData.recipes);

  let grew = true;
  while (grew) {
    grew = false;
    for (const recipe of recipeList) {
      if (recipe.manualOnly || recipe.isExtraction) continue;
      if (candidates.has(recipe.id)) continue;
      const ingredients = recipeInputs(recipe, UNIT_NODE);
      const allReachable = ingredients.every((ing) => reachable.has(ing.itemId));
      if (!allReachable) continue;
      const products = recipeOutputs(recipe, UNIT_NODE, gameData);
      candidates.set(recipe.id, {
        recipeId: recipe.id,
        ingredients,
        products,
        powerMW: recipe.powerMW,
      });
      for (const p of products) {
        if (!reachable.has(p.itemId)) {
          reachable.add(p.itemId);
          grew = true;
        }
      }
    }
  }
  return { reachable, candidates };
}

// Items the given input set can produce — input items themselves plus every
// product of any recipe whose ingredients are reachable. The yield modal uses
// this to filter the output picker to actually-feasible candidates.
export function reachableProducts(
  inputs: Iterable<ItemId>,
  gameData: GameData,
): Set<ItemId> {
  return buildReach(inputs, gameData).reachable;
}

// Auxiliary inputs the chain might actually consume — derived by running the
// LP a handful of times and unioning the inputUsage of each optimum. Static
// graph traversal alone is too generous: alt recipes like "Steel Canister"
// (Steel Ingot → Empty Canister) drag Iron Ore into a Turbofuel chain even
// though the LP would never pick that route. Asking the LP directly is the
// only way to know what's actually used.
export function relevantAuxItems(
  scope: YieldScope,
  gameData: GameData,
  targetRate: number,
): Set<ItemId> {
  const result = new Set<ItemId>();
  if (targetRate <= 0) return result;

  // Round 1 — total raw. Items used in this optimum are definitely relevant.
  const totalRaw = optimizeForTarget(scope, targetRate, gameData);
  if (!totalRaw.feasible) return result;
  for (const id of totalRaw.inputUsage.keys()) result.add(id);

  // Round 2 — for each item from round 1, prioritize it. The resulting
  // optimum may pick an alternative chain that uses *different* auxiliaries
  // (e.g. minimizing Crude Oil for Turbofuel switches into the Diluted-Fuel
  // + Compacted-Coal route, which adds Coal). Union those in too so the
  // picker covers the chain's Pareto frontier without enumerating every
  // possible cost configuration.
  const seeds = [...result];
  for (const aux of seeds) {
    const costMap = new Map<ItemId, number>([[aux, 1]]);
    const r = optimizeForTarget(scope, targetRate, gameData, costMap);
    if (!r.feasible) continue;
    for (const id of r.inputUsage.keys()) result.add(id);
  }
  return result;
}

// Builds the full LP scope for a single output target. Returns null when the
// requested output is unreachable from the inputs.
export function gatherYieldScope(
  inputs: Map<ItemId, number>,
  outputItemId: ItemId,
  gameData: GameData,
): YieldScope | null {
  if (inputs.has(outputItemId)) return null;
  const { reachable, candidates } = buildReach(inputs.keys(), gameData);
  if (!reachable.has(outputItemId)) return null;

  const internalItems = new Set<ItemId>();
  for (const item of reachable) {
    if (!inputs.has(item)) internalItems.add(item);
  }
  return { inputs, outputItemId, internalItems, candidates };
}

const VAR_RECIPE_PREFIX = 'r:';
const VAR_SUPPLY_PREFIX = 's:';
const CONSTRAINT_ITEM_PREFIX = 'item:';
const CONSTRAINT_CAP_PREFIX = 'cap:';
const OBJECTIVE_KEY = 'objective';

function recipeBuildCostScalar(recipeId: RecipeId, gameData: GameData): number {
  const recipe = gameData.recipes[recipeId];
  if (!recipe) return 0;
  const machine = gameData.machines[recipe.machineId];
  if (!machine?.buildCost) return 0;
  return machine.buildCost.reduce((sum, io) => sum + io.amount, 0);
}

// LP: maximize the output item's net production rate subject to per-input
// supply caps. Variables — recipe rates (≥ 0) and per-input supply (≥ 0,
// capped by a `cap:` constraint). Item balances — inputs equal 0 (supply −
// consumption); everything else ≥ 0 (surplus permitted, byproducts drain
// freely). Objective coefficient on each recipe is its net production of
// `outputItemId` per unit machine, so `raw.result` is the maximized output.
export function optimizeYield(scope: YieldScope, gameData: GameData): YieldResult {
  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};

  for (const itemId of scope.internalItems) {
    constraints[`${CONSTRAINT_ITEM_PREFIX}${itemId}`] = { min: 0 };
  }
  for (const itemId of scope.inputs.keys()) {
    constraints[`${CONSTRAINT_ITEM_PREFIX}${itemId}`] = { equal: 0 };
  }

  for (const candidate of scope.candidates.values()) {
    const coeffs: Record<string, number> = {};
    let outputNet = 0;
    for (const p of candidate.products) {
      const key = `${CONSTRAINT_ITEM_PREFIX}${p.itemId}`;
      coeffs[key] = (coeffs[key] ?? 0) + p.rate;
      if (p.itemId === scope.outputItemId) outputNet += p.rate;
    }
    for (const ing of candidate.ingredients) {
      const key = `${CONSTRAINT_ITEM_PREFIX}${ing.itemId}`;
      coeffs[key] = (coeffs[key] ?? 0) - ing.rate;
      if (ing.itemId === scope.outputItemId) outputNet -= ing.rate;
    }
    coeffs[OBJECTIVE_KEY] = outputNet;
    variables[`${VAR_RECIPE_PREFIX}${candidate.recipeId}`] = coeffs;
  }

  for (const [itemId, cap] of scope.inputs) {
    const supplyVar = `${VAR_SUPPLY_PREFIX}${itemId}`;
    const capKey = `${CONSTRAINT_CAP_PREFIX}${itemId}`;
    constraints[capKey] = { max: cap };
    variables[supplyVar] = {
      [OBJECTIVE_KEY]: 0,
      [`${CONSTRAINT_ITEM_PREFIX}${itemId}`]: 1,
      [capKey]: 1,
    };
  }

  type SolveResult = {
    feasible?: boolean;
    bounded?: boolean;
    result?: number;
    [key: string]: number | boolean | undefined;
  };
  const raw = solver.Solve({
    optimize: OBJECTIVE_KEY,
    opType: 'max',
    constraints,
    variables,
  }) as SolveResult;

  if (!raw.feasible) {
    return { feasible: false, message: 'No feasible chain produces this output from the given inputs.' };
  }

  const recipeRates = new Map<RecipeId, number>();
  const inputUsage = new Map<ItemId, number>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number') continue;
    if (key.startsWith(VAR_RECIPE_PREFIX)) {
      const id = key.slice(VAR_RECIPE_PREFIX.length);
      if (value > 1e-9) recipeRates.set(id, value);
    } else if (key.startsWith(VAR_SUPPLY_PREFIX)) {
      const id = key.slice(VAR_SUPPLY_PREFIX.length);
      if (value > 1e-9) inputUsage.set(id, value);
    }
  }

  // Surplus = production − consumption per item across the chosen rates.
  // Useful for placing Sink nodes on byproducts in apply.
  const surplus = new Map<ItemId, number>();
  for (const [recipeId, rate] of recipeRates) {
    const candidate = scope.candidates.get(recipeId);
    if (!candidate) continue;
    for (const p of candidate.products) {
      surplus.set(p.itemId, (surplus.get(p.itemId) ?? 0) + p.rate * rate);
    }
    for (const ing of candidate.ingredients) {
      surplus.set(ing.itemId, (surplus.get(ing.itemId) ?? 0) - ing.rate * rate);
    }
  }
  for (const itemId of scope.inputs.keys()) surplus.delete(itemId);
  for (const [itemId, value] of [...surplus]) {
    if (value <= 1e-9) surplus.delete(itemId);
  }

  let powerMW = 0;
  let buildCostScalar = 0;
  for (const [recipeId, rate] of recipeRates) {
    const recipe = gameData.recipes[recipeId];
    if (!recipe) continue;
    powerMW += recipe.powerMW * rate;
    buildCostScalar += recipeBuildCostScalar(recipeId, gameData) * rate;
  }

  return {
    feasible: true,
    recipeRates,
    inputUsage,
    surplus,
    outputRate: raw.result ?? 0,
    totals: { powerMW, buildCostScalar },
  };
}

// Inverse direction: target item must be produced at exactly `targetRate`.
// Objective is the user-supplied cost map applied to per-input supply
// variables. `null` (default) costs every input at +1, matching "minimize
// total raw items consumed". A `Map` lets the caller weight specific items
// — e.g. `{crude-oil: 1}` mirrors the forward direction's source-only
// optimization, picking the most CO-efficient chain even if total raw is
// higher.
export function optimizeForTarget(
  scope: YieldScope,
  targetRate: number,
  gameData: GameData,
  costs: Map<ItemId, number> | null = null,
): YieldResult {
  if (targetRate <= 0) {
    return { feasible: false, message: 'Target rate must be greater than zero.' };
  }

  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};

  for (const itemId of scope.internalItems) {
    if (itemId === scope.outputItemId) {
      constraints[`${CONSTRAINT_ITEM_PREFIX}${itemId}`] = { equal: targetRate };
    } else {
      constraints[`${CONSTRAINT_ITEM_PREFIX}${itemId}`] = { min: 0 };
    }
  }
  for (const itemId of scope.inputs.keys()) {
    constraints[`${CONSTRAINT_ITEM_PREFIX}${itemId}`] = { equal: 0 };
  }

  for (const candidate of scope.candidates.values()) {
    const coeffs: Record<string, number> = {};
    for (const p of candidate.products) {
      const key = `${CONSTRAINT_ITEM_PREFIX}${p.itemId}`;
      coeffs[key] = (coeffs[key] ?? 0) + p.rate;
    }
    for (const ing of candidate.ingredients) {
      const key = `${CONSTRAINT_ITEM_PREFIX}${ing.itemId}`;
      coeffs[key] = (coeffs[key] ?? 0) - ing.rate;
    }
    coeffs[OBJECTIVE_KEY] = 0;
    variables[`${VAR_RECIPE_PREFIX}${candidate.recipeId}`] = coeffs;
  }

  // Tiny tie-breaker for non-target auxes when the user picked a specific
  // cost item. Without it, all other supplies are free and the LP can leave
  // gratuitous recipes (Iron Plate, Heavy Modular Frame, …) running because
  // they don't change the primary objective — the epsilon costs every aux,
  // so any unused recipe gets pruned without overriding the user's pick.
  const TIEBREAK_EPSILON = 1e-6;
  for (const itemId of scope.inputs.keys()) {
    let cost: number;
    if (costs) {
      cost = costs.get(itemId) ?? TIEBREAK_EPSILON;
    } else {
      cost = 1;
    }
    variables[`${VAR_SUPPLY_PREFIX}${itemId}`] = {
      [OBJECTIVE_KEY]: cost,
      [`${CONSTRAINT_ITEM_PREFIX}${itemId}`]: 1,
    };
  }

  type SolveResult = {
    feasible?: boolean;
    bounded?: boolean;
    result?: number;
    [key: string]: number | boolean | undefined;
  };
  const raw = solver.Solve({
    optimize: OBJECTIVE_KEY,
    opType: 'min',
    constraints,
    variables,
  }) as SolveResult;

  if (!raw.feasible) {
    return { feasible: false, message: 'No feasible chain produces this target rate.' };
  }

  const recipeRates = new Map<RecipeId, number>();
  const inputUsage = new Map<ItemId, number>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number') continue;
    if (key.startsWith(VAR_RECIPE_PREFIX)) {
      const id = key.slice(VAR_RECIPE_PREFIX.length);
      if (value > 1e-9) recipeRates.set(id, value);
    } else if (key.startsWith(VAR_SUPPLY_PREFIX)) {
      const id = key.slice(VAR_SUPPLY_PREFIX.length);
      if (value > 1e-9) inputUsage.set(id, value);
    }
  }

  const surplus = new Map<ItemId, number>();
  for (const [recipeId, rate] of recipeRates) {
    const candidate = scope.candidates.get(recipeId);
    if (!candidate) continue;
    for (const p of candidate.products) {
      surplus.set(p.itemId, (surplus.get(p.itemId) ?? 0) + p.rate * rate);
    }
    for (const ing of candidate.ingredients) {
      surplus.set(ing.itemId, (surplus.get(ing.itemId) ?? 0) - ing.rate * rate);
    }
  }
  for (const itemId of scope.inputs.keys()) surplus.delete(itemId);
  // Output's "surplus" is exactly targetRate; keep it to mirror optimizeYield's
  // semantics where the primary output is included in the surplus map.
  for (const [itemId, value] of [...surplus]) {
    if (value <= 1e-9) surplus.delete(itemId);
  }

  let powerMW = 0;
  let buildCostScalar = 0;
  for (const [recipeId, rate] of recipeRates) {
    const recipe = gameData.recipes[recipeId];
    if (!recipe) continue;
    powerMW += recipe.powerMW * rate;
    buildCostScalar += recipeBuildCostScalar(recipeId, gameData) * rate;
  }

  return {
    feasible: true,
    recipeRates,
    inputUsage,
    surplus,
    outputRate: targetRate,
    totals: { powerMW, buildCostScalar },
  };
}
