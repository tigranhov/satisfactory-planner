import type { GameData, Recipe } from '@/data/types';
import type { RecipeNodeData } from './graph';

export function itemsPerMinute(recipe: Recipe, amount: number, clockSpeed = 1, count = 1) {
  return (amount * 60) / recipe.durationSec * clockSpeed * count;
}

// Somersloops amplify products additively: 1 sloop at half-slots => 1.5x output.
export function somersloopBoost(sloops: number, slots: number): number {
  if (slots <= 0 || sloops <= 0) return 1;
  return 1 + sloops / slots;
}

export function somersloopMultiplier(recipe: Recipe, node: RecipeNodeData, data: GameData) {
  const slots = data.machines[recipe.machineId]?.somersloopSlots ?? 0;
  return somersloopBoost(node.somersloops, slots);
}

export function recipeInputs(recipe: Recipe, node: RecipeNodeData) {
  return recipe.ingredients.map((io) => ({
    itemId: io.itemId,
    rate: itemsPerMinute(recipe, io.amount, node.clockSpeed, node.count),
  }));
}

export function recipeOutputs(recipe: Recipe, node: RecipeNodeData, data: GameData) {
  const mult = somersloopMultiplier(recipe, node, data);
  return recipe.products.map((io) => ({
    itemId: io.itemId,
    rate: itemsPerMinute(recipe, io.amount, node.clockSpeed, node.count) * mult,
  }));
}

export function nodePowerMW(recipe: Recipe, node: RecipeNodeData, data: GameData) {
  if (recipe.isPowerGeneration && recipe.generatedPowerMW) {
    // Negative = produced. Generators scale clock^1.3 in-game.
    return -recipe.generatedPowerMW * node.count * Math.pow(node.clockSpeed, 1.3);
  }
  const boost = somersloopMultiplier(recipe, node, data);
  // Manufacturers scale clock^1.6; somersloops square the power cost.
  return recipe.powerMW * node.count * Math.pow(node.clockSpeed, 1.6) * Math.pow(boost, 2);
}

// All handle-id prefixes live here. Every format places itemId at parts[2]
// so itemIdFromSourceHandle works uniformly across source handles.
const HANDLE_PREFIX = {
  recipeIn: 'in',
  recipeOut: 'out',
  ifaceIn: 'bpin',
  ifaceOut: 'bpout',
  bpInstIn: 'bpi-in',
  bpInstOut: 'bpi-out',
} as const;

const SOURCE_HANDLE_PREFIXES: readonly string[] = [
  HANDLE_PREFIX.recipeOut,
  HANDLE_PREFIX.ifaceIn,
  HANDLE_PREFIX.bpInstOut,
];

export function handleIdForIngredient(recipeId: string, itemId: string, index: number) {
  return `${HANDLE_PREFIX.recipeIn}:${recipeId}:${itemId}:${index}`;
}

export function handleIdForProduct(recipeId: string, itemId: string, index: number) {
  return `${HANDLE_PREFIX.recipeOut}:${recipeId}:${itemId}:${index}`;
}

export function handleIdForInterface(kind: 'input' | 'output', itemId: string) {
  const prefix = kind === 'input' ? HANDLE_PREFIX.ifaceIn : HANDLE_PREFIX.ifaceOut;
  return `${prefix}:${itemId}`;
}

export function handleIdForBlueprintInput(internalNodeId: string, itemId: string) {
  return `${HANDLE_PREFIX.bpInstIn}:${internalNodeId}:${itemId}`;
}

export function handleIdForBlueprintOutput(internalNodeId: string, itemId: string) {
  return `${HANDLE_PREFIX.bpInstOut}:${internalNodeId}:${itemId}`;
}

export function internalNodeIdFromBlueprintHandle(handleId: string): string | null {
  const parts = handleId.split(':');
  const prefix = parts[0];
  if (
    (prefix === HANDLE_PREFIX.bpInstIn || prefix === HANDLE_PREFIX.bpInstOut) &&
    parts.length >= 3
  ) {
    return parts[1];
  }
  return null;
}

export function itemIdFromSourceHandle(handleId: string): string {
  const parts = handleId.split(':');
  if (!SOURCE_HANDLE_PREFIXES.includes(parts[0])) return '';
  // recipeOut: out:recipeId:itemId:idx / ifaceIn: bpin:itemId (idx=1)
  // / bpInstOut: bpi-out:internalId:itemId
  return parts[0] === HANDLE_PREFIX.ifaceIn ? parts[1] ?? '' : parts[2] ?? '';
}

export function handleIndexFromId(handleId: string): number | null {
  const parts = handleId.split(':');
  if (parts.length < 4) return null;
  const idx = Number(parts[3]);
  return Number.isFinite(idx) ? idx : null;
}

export function lookupRecipeForNode(data: GameData, node: RecipeNodeData) {
  return data.recipes[node.recipeId];
}
