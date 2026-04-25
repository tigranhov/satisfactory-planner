import type { GameData, Item, Recipe } from './types';
import generated from './gamedata.generated.json';

const data = generated as unknown as GameData;

export function loadGameData(): GameData {
  return data;
}

export function getItem(d: GameData, id: string): Item | undefined {
  return d.items[id];
}

export function getRecipe(d: GameData, id: string): Recipe | undefined {
  return d.recipes[id];
}

export function getMachine(d: GameData, id: string) {
  return d.machines[id];
}

// Memoized indices — rebuilt only when the GameData reference changes.
let indexKey: GameData | null = null;
let recipesProducing: Map<string, Recipe[]> = new Map();
let recipesConsuming: Map<string, Recipe[]> = new Map();
let recipesByMachine: Map<string, Recipe[]> = new Map();
let itemsByCategory: Record<string, Item[]> = {};
let sortedRecipeList: Recipe[] = [];
let sortedItemList: Item[] = [];
let producibleItems: Item[] = [];
let consumableItems: Item[] = [];
let itemNameLower: Map<string, string> = new Map();
let recipeNameLower: Map<string, string> = new Map();
let itemByNameLower: Map<string, Item> = new Map();

function rebuildIndices(d: GameData) {
  if (indexKey === d) return;
  indexKey = d;

  recipesProducing = new Map();
  recipesConsuming = new Map();
  recipesByMachine = new Map();
  itemsByCategory = {};
  itemNameLower = new Map();
  recipeNameLower = new Map();
  itemByNameLower = new Map();

  for (const recipe of Object.values(d.recipes)) {
    recipeNameLower.set(recipe.id, recipe.name.toLowerCase());
    for (const p of recipe.products) {
      const arr = recipesProducing.get(p.itemId) ?? [];
      arr.push(recipe);
      recipesProducing.set(p.itemId, arr);
    }
    for (const i of recipe.ingredients) {
      const arr = recipesConsuming.get(i.itemId) ?? [];
      arr.push(recipe);
      recipesConsuming.set(i.itemId, arr);
    }
    const byMachine = recipesByMachine.get(recipe.machineId) ?? [];
    byMachine.push(recipe);
    recipesByMachine.set(recipe.machineId, byMachine);
  }

  for (const item of Object.values(d.items)) {
    const lower = item.name.toLowerCase();
    itemNameLower.set(item.id, lower);
    itemByNameLower.set(lower, item);
    const cat = item.category ?? 'other';
    (itemsByCategory[cat] ??= []).push(item);
  }
  for (const cat of Object.keys(itemsByCategory)) {
    itemsByCategory[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  sortedItemList = Object.values(d.items).sort((a, b) => a.name.localeCompare(b.name));

  sortedRecipeList = Object.values(d.recipes)
    .filter((r) => !r.manualOnly)
    .sort(recipeDefaultFirst);

  // recipesProducing/Consuming are built in raw iteration order above; sort
  // each bucket so callers (auto-fill picker, drag-drop menu) get standard
  // recipes ahead of alternates and a stable alphabetical tail.
  for (const arr of recipesProducing.values()) arr.sort(recipeDefaultFirst);
  for (const arr of recipesConsuming.values()) arr.sort(recipeDefaultFirst);
  for (const arr of recipesByMachine.values()) arr.sort(recipeDefaultFirst);

  // Items with at least one non-manual recipe on the producing or consuming
  // side. Drives the first-stage pickers in CanvasContextMenu and DragDropMenu.
  producibleItems = buildItemBucket(d, recipesProducing);
  consumableItems = buildItemBucket(d, recipesConsuming);
}

function buildItemBucket(d: GameData, index: Map<string, Recipe[]>): Item[] {
  const out: Item[] = [];
  for (const item of Object.values(d.items)) {
    const list = index.get(item.id);
    if (list && list.some((r) => !r.manualOnly)) out.push(item);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function recipeDefaultFirst(a: Recipe, b: Recipe): number {
  if (a.alternate !== b.alternate) return a.alternate ? 1 : -1;
  return a.name.localeCompare(b.name);
}

export function getRecipeList(d: GameData): Recipe[] {
  rebuildIndices(d);
  return sortedRecipeList;
}

export function getRecipesProducing(d: GameData, itemId: string): Recipe[] {
  rebuildIndices(d);
  return recipesProducing.get(itemId) ?? [];
}

export function getRecipesConsuming(d: GameData, itemId: string): Recipe[] {
  rebuildIndices(d);
  return recipesConsuming.get(itemId) ?? [];
}

export function getRecipesByMachine(d: GameData, machineId: string): Recipe[] {
  rebuildIndices(d);
  return recipesByMachine.get(machineId) ?? [];
}

export function getItemsByCategory(d: GameData): Record<string, Item[]> {
  rebuildIndices(d);
  return itemsByCategory;
}

export function getProducibleItems(d: GameData): Item[] {
  rebuildIndices(d);
  return producibleItems;
}

export function getConsumableItems(d: GameData): Item[] {
  rebuildIndices(d);
  return consumableItems;
}

export function getAllItemsSorted(d: GameData): Item[] {
  rebuildIndices(d);
  return sortedItemList;
}

// Case-insensitive name match first, then item id fallback. Used by the
// `::Iron Ore::` inline icon markup where users type a display name but
// ids are the stable key when names collide or shift.
export function getItemByNameOrId(d: GameData, token: string): Item | undefined {
  rebuildIndices(d);
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  return itemByNameLower.get(trimmed.toLowerCase()) ?? d.items[trimmed];
}

export function searchRecipes(d: GameData, query: string): Recipe[] {
  rebuildIndices(d);
  const q = query.trim().toLowerCase();
  if (!q) return sortedRecipeList;
  return sortedRecipeList.filter((r) => {
    if (recipeNameLower.get(r.id)?.includes(q)) return true;
    for (const io of r.ingredients) {
      if (itemNameLower.get(io.itemId)?.includes(q)) return true;
    }
    for (const io of r.products) {
      if (itemNameLower.get(io.itemId)?.includes(q)) return true;
    }
    return false;
  });
}
