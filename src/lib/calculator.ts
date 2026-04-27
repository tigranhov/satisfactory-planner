import type { GameData, ItemId, Recipe, RecipeId } from '@/data/types';
import { getRecipesProducing } from '@/data/loader';

// 'raw' tells the calculator to stop recursing on this item — it becomes
// part of the raw-demand totals. Any other string is a chosen recipe id.
export type RecipeChoice = RecipeId | 'raw';

export interface CalcChildLink {
  ingredientIndex: number;
  node: CalcTreeNode;
}

export interface CalcTreeNode {
  // Stable path key built from ancestor itemIds. Used for expand state so two
  // occurrences of the same item under different parents are independent.
  path: string;
  itemId: ItemId;
  // Total count of this item required at this position in the tree. Calculator
  // works in pure quantities — no time dimension. To make Q of `itemId`, you
  // need (ingredient.amount / output.amount) × Q of each ingredient.
  quantity: number;
  // Number of recipe runs needed to produce `quantity` of `itemId` (fractional).
  // undefined when raw.
  recipeRuns?: number;
  recipeId: RecipeChoice;
  // Recipe candidates for the picker dropdown. Empty for items with no
  // non-manual recipes (treated as raw automatically).
  availableRecipes: Recipe[];
  children: CalcChildLink[];
  // True when the same itemId appears in its own ancestor chain — recursion
  // stops to avoid infinite descent on rare loops in the data (e.g. recycled
  // plastic alts depending on rubber alts that recycle plastic).
  cyclic?: boolean;
}

export interface CalcChoices {
  // Per-item recipe selection. Missing key → auto-default to first non-manual
  // producing recipe (loader sorts non-alternates first).
  byItem: Record<ItemId, RecipeChoice>;
}

export function defaultRecipeFor(itemId: ItemId, gameData: GameData): RecipeChoice {
  const recipes = getRecipesProducing(gameData, itemId).filter((r) => !r.manualOnly);
  if (recipes.length === 0) return 'raw';
  return recipes[0].id;
}

export function buildCalcTree(
  itemId: ItemId,
  quantity: number,
  choices: CalcChoices,
  gameData: GameData,
  ancestors: Set<ItemId> = new Set(),
  pathPrefix = '',
): CalcTreeNode {
  const path = pathPrefix ? `${pathPrefix}>${itemId}` : itemId;
  const availableRecipes = getRecipesProducing(gameData, itemId).filter((r) => !r.manualOnly);

  if (ancestors.has(itemId)) {
    return {
      path,
      itemId,
      quantity,
      recipeId: 'raw',
      availableRecipes,
      children: [],
      cyclic: true,
    };
  }

  let chosen: RecipeChoice =
    choices.byItem[itemId] ?? defaultRecipeFor(itemId, gameData);
  // Stale choice (recipe gone after data refresh) → fall back to default.
  if (chosen !== 'raw' && !availableRecipes.find((r) => r.id === chosen)) {
    chosen = defaultRecipeFor(itemId, gameData);
  }
  if (availableRecipes.length === 0) chosen = 'raw';

  if (chosen === 'raw') {
    return { path, itemId, quantity, recipeId: 'raw', availableRecipes, children: [] };
  }

  const recipe = gameData.recipes[chosen];
  if (!recipe) {
    return { path, itemId, quantity, recipeId: 'raw', availableRecipes, children: [] };
  }

  const product = recipe.products.find((p) => p.itemId === itemId);
  const outputAmount = product?.amount ?? 0;
  const recipeRuns = outputAmount > 0 ? quantity / outputAmount : 0;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(itemId);

  const children: CalcChildLink[] = recipe.ingredients.map((ing, idx) => {
    const childQty = ing.amount * recipeRuns;
    return {
      ingredientIndex: idx,
      node: buildCalcTree(ing.itemId, childQty, choices, gameData, nextAncestors, path),
    };
  });

  return {
    path,
    itemId,
    quantity,
    recipeId: chosen,
    recipeRuns,
    availableRecipes,
    children,
  };
}

export function walkCalcTree(node: CalcTreeNode, visit: (n: CalcTreeNode) => void): void {
  visit(node);
  for (const c of node.children) walkCalcTree(c.node, visit);
}

export interface CalcAggregate {
  // Items consumed at any leaf (recipeId === 'raw'). Drives the Raw materials panel.
  rawTotals: Map<ItemId, number>;
  // Items produced as byproducts somewhere in the tree, with total quantity
  // (recipe.byproductAmount × recipeRuns summed across the tree).
  byproductTotals: Map<ItemId, number>;
}

export function aggregateTrees(
  trees: CalcTreeNode[],
  gameData: GameData,
): CalcAggregate {
  const rawTotals = new Map<ItemId, number>();
  const byproductTotals = new Map<ItemId, number>();
  for (const t of trees) {
    walkCalcTree(t, (n) => {
      if (n.recipeId === 'raw') {
        if (n.quantity > 0) {
          rawTotals.set(n.itemId, (rawTotals.get(n.itemId) ?? 0) + n.quantity);
        }
        return;
      }
      const recipe = gameData.recipes[n.recipeId];
      if (!recipe || !n.recipeRuns) return;
      for (const p of recipe.products) {
        if (p.itemId === n.itemId) continue;
        if (!p.isByproduct) continue;
        const amt = p.amount * n.recipeRuns;
        byproductTotals.set(
          p.itemId,
          (byproductTotals.get(p.itemId) ?? 0) + amt,
        );
      }
    });
  }
  return { rawTotals, byproductTotals };
}
