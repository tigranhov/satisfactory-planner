import type { GameData, ItemId, Recipe, RecipeId } from '@/data/types';

// Per-recipe change between current chain and optimizer's pick. Swaps pair
// "removed recipe" + "added recipe" that produce the same primary item, so the
// UI can present them as a single substitution row instead of two unrelated
// add/remove lines.
export type RecipeDiffEntry =
  | { kind: 'swap'; from: Recipe; to: Recipe; before: number; after: number }
  | { kind: 'rateChanged'; recipe: Recipe; before: number; after: number }
  | { kind: 'added'; recipe: Recipe; rate: number }
  | { kind: 'removed'; recipe: Recipe; rate: number };

export interface RecipeDiff {
  swaps: RecipeDiffEntry[];
  rateChanges: RecipeDiffEntry[];
  added: RecipeDiffEntry[];
  removed: RecipeDiffEntry[];
  keptCount: number;
}

const RATE_EPS = 1e-3;

function primaryItem(recipe: Recipe): ItemId | null {
  return (recipe.products.find((p) => !p.isByproduct) ?? recipe.products[0])?.itemId ?? null;
}

export function buildRecipeDiff(
  current: Map<RecipeId, number>,
  optimal: Map<RecipeId, number>,
  gameData: GameData,
): RecipeDiff {
  const result: RecipeDiff = {
    swaps: [],
    rateChanges: [],
    added: [],
    removed: [],
    keptCount: 0,
  };

  const onlyCurrent = new Map<RecipeId, number>();
  const onlyOptimal = new Map<RecipeId, number>();

  for (const [id, before] of current) {
    const recipe = gameData.recipes[id];
    if (!recipe) continue;
    if (optimal.has(id)) {
      const after = optimal.get(id) ?? 0;
      if (Math.abs(after - before) > RATE_EPS) {
        result.rateChanges.push({ kind: 'rateChanged', recipe, before, after });
      } else {
        result.keptCount += 1;
      }
    } else {
      onlyCurrent.set(id, before);
    }
  }
  for (const [id, after] of optimal) {
    if (!current.has(id) && gameData.recipes[id]) onlyOptimal.set(id, after);
  }

  // Pair removed + added by primary product → swap. A multi-recipe-per-item
  // chain (rare) gets the first N pairs as swaps; leftovers fall through to
  // pure add/remove rows.
  const optByProduct = new Map<ItemId, RecipeId[]>();
  for (const id of onlyOptimal.keys()) {
    const item = primaryItem(gameData.recipes[id]);
    if (!item) continue;
    const arr = optByProduct.get(item) ?? [];
    arr.push(id);
    optByProduct.set(item, arr);
  }

  for (const [removedId, before] of onlyCurrent) {
    const removedRecipe = gameData.recipes[removedId];
    const item = primaryItem(removedRecipe);
    const candidates = item ? optByProduct.get(item) : undefined;
    if (candidates && candidates.length > 0) {
      const addedId = candidates.shift()!;
      const addedRecipe = gameData.recipes[addedId];
      result.swaps.push({
        kind: 'swap',
        from: removedRecipe,
        to: addedRecipe,
        before,
        after: onlyOptimal.get(addedId) ?? 0,
      });
      onlyOptimal.delete(addedId);
    } else {
      result.removed.push({ kind: 'removed', recipe: removedRecipe, rate: before });
    }
  }

  for (const [addedId, rate] of onlyOptimal) {
    result.added.push({ kind: 'added', recipe: gameData.recipes[addedId], rate });
  }

  return result;
}
