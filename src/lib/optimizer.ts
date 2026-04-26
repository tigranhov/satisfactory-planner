import solver from 'javascript-lp-solver';
import type { GameData, ItemId, RecipeId } from '@/data/types';
import type { OptimizerScope } from './optimizerScope';

export type OptimizerObjective =
  | { kind: 'raw' }
  | { kind: 'power' }
  | { kind: 'buildCost' }
  | { kind: 'item'; itemId: ItemId };

export interface OptimizerSolution {
  feasible: true;
  // Per-recipe rate in "100% machines" — multiply by perMachineRates to get items/min.
  recipeRates: Map<RecipeId, number>;
  // Per-item supply pulled from the boundary (items/min).
  boundarySupply: Map<ItemId, number>;
  totals: {
    rawIntake: number;
    powerMW: number;
    buildCostScalar: number;
  };
}

export interface OptimizerError {
  feasible: false;
  message: string;
}

export type OptimizerResult = OptimizerSolution | OptimizerError;

const VAR_RECIPE_PREFIX = 'r:';
const VAR_SUPPLY_PREFIX = 's:';
const CONSTRAINT_ITEM_PREFIX = 'item:';
const OBJECTIVE_KEY = 'objective';

// Tiny per-unit cost on candidate recipes that aren't in the current chain.
// Breaks LP ties (multiple solutions tied on the primary objective) toward
// preserving the user's existing recipes — otherwise the solver picks
// arbitrarily and may swap into an equally-good option that's worse on
// secondary metrics like power. Small enough to never override a real saving.
const STAY_CURRENT_BIAS = 1e-4;

function recipeBuildCostScalar(recipeId: RecipeId, gameData: GameData): number {
  const recipe = gameData.recipes[recipeId];
  if (!recipe) return 0;
  const machine = gameData.machines[recipe.machineId];
  if (!machine?.buildCost) return 0;
  return machine.buildCost.reduce((sum, io) => sum + io.amount, 0);
}

// Cost contribution of one unit of this candidate recipe under the given
// objective. For raw / specific-item modes the cost is 0 here — the cost
// lives on the supply variables instead.
function recipeObjectiveCost(
  recipeId: RecipeId,
  objective: OptimizerObjective,
  gameData: GameData,
): number {
  if (objective.kind === 'power') return gameData.recipes[recipeId]?.powerMW ?? 0;
  if (objective.kind === 'buildCost') return recipeBuildCostScalar(recipeId, gameData);
  return 0;
}

// Cost of one unit of supply for this boundary item. Raw mode = 1 across the
// board; specific-item = 1 only for the chosen item; power / build modes
// don't charge supply.
function supplyObjectiveCost(itemId: ItemId, objective: OptimizerObjective): number {
  if (objective.kind === 'raw') return 1;
  if (objective.kind === 'item') return objective.itemId === itemId ? 1 : 0;
  return 0;
}

export function optimize(
  scope: OptimizerScope,
  objective: OptimizerObjective,
  gameData: GameData,
): OptimizerResult {
  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};

  // Per-item balance constraints. Target: equal target rate. Internal
  // (non-target): >= 0 so the LP may produce surplus (cheaper than forcing
  // exact balance, and accommodates byproducts naturally). Boundary items
  // get == 0: production (always 0 by definition) + supply - consumption = 0
  // — supply equals what the LP needs to pull from outside.
  const targetItemKey = `${CONSTRAINT_ITEM_PREFIX}${scope.target.itemId}`;
  for (const itemId of scope.internalItems) {
    const key = `${CONSTRAINT_ITEM_PREFIX}${itemId}`;
    if (itemId === scope.target.itemId) {
      constraints[key] = { equal: scope.target.rate };
    } else {
      constraints[key] = { min: 0 };
    }
  }
  for (const itemId of scope.boundaryItems) {
    const key = `${CONSTRAINT_ITEM_PREFIX}${itemId}`;
    if (!constraints[key]) constraints[key] = { equal: 0 };
  }

  const currentRecipeIds = new Set<RecipeId>(scope.chain.map((c) => c.recipeId));

  // Recipe variables: each contributes (products − ingredients) to its item
  // balances. The LP constrains them ≥ 0 implicitly (jsLPSolver default for
  // non-`unrestricted` variables).
  for (const candidate of scope.candidates.values()) {
    const coeffs: Record<string, number> = {};
    let cost = recipeObjectiveCost(candidate.recipeId, objective, gameData);
    if (!currentRecipeIds.has(candidate.recipeId)) cost += STAY_CURRENT_BIAS;
    coeffs[OBJECTIVE_KEY] = cost;
    for (const p of candidate.products) {
      const key = `${CONSTRAINT_ITEM_PREFIX}${p.itemId}`;
      coeffs[key] = (coeffs[key] ?? 0) + p.rate;
    }
    for (const ing of candidate.ingredients) {
      const key = `${CONSTRAINT_ITEM_PREFIX}${ing.itemId}`;
      coeffs[key] = (coeffs[key] ?? 0) - ing.rate;
    }
    variables[`${VAR_RECIPE_PREFIX}${candidate.recipeId}`] = coeffs;
  }

  // Supply variables: positive contribution to the boundary item balance,
  // cost per unit per the objective.
  for (const itemId of scope.boundaryItems) {
    const coeffs: Record<string, number> = {};
    coeffs[OBJECTIVE_KEY] = supplyObjectiveCost(itemId, objective);
    coeffs[`${CONSTRAINT_ITEM_PREFIX}${itemId}`] = 1;
    variables[`${VAR_SUPPLY_PREFIX}${itemId}`] = coeffs;
  }

  // Sanity: target item must be producible by at least one candidate.
  if (!constraints[targetItemKey]) {
    return { feasible: false, message: 'Target item not produced by any candidate recipe.' };
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
    return { feasible: false, message: 'No feasible recipe combination for this target.' };
  }

  const recipeRates = new Map<RecipeId, number>();
  const boundarySupply = new Map<ItemId, number>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number') continue;
    if (key.startsWith(VAR_RECIPE_PREFIX)) {
      const id = key.slice(VAR_RECIPE_PREFIX.length);
      if (value > 1e-9) recipeRates.set(id, value);
    } else if (key.startsWith(VAR_SUPPLY_PREFIX)) {
      const id = key.slice(VAR_SUPPLY_PREFIX.length);
      if (value > 1e-9) boundarySupply.set(id, value);
    }
  }

  let powerMW = 0;
  let buildCostScalar = 0;
  for (const [recipeId, rate] of recipeRates) {
    const recipe = gameData.recipes[recipeId];
    if (!recipe) continue;
    powerMW += recipe.powerMW * rate;
    buildCostScalar += recipeBuildCostScalar(recipeId, gameData) * rate;
  }
  let rawIntake = 0;
  for (const value of boundarySupply.values()) rawIntake += value;

  return {
    feasible: true,
    recipeRates,
    boundarySupply,
    totals: { rawIntake, powerMW, buildCostScalar },
  };
}
