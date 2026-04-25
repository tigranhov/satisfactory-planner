import type { GameData, Recipe } from '@/data/types';
import type { Graph, GraphNode, NodeData, NodeId, RecipeNodeData } from './graph';

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

// All handle-id prefixes live here. itemId lives at parts[1] for ifaceIn
// (2 segments) and at parts[2] for recipeIn/Out and subgraphIn/Out. Hub
// handles are static — itemId is not encoded in the handle string because
// the hub's item is derived from incident edges.
const HANDLE_PREFIX = {
  recipeIn: 'in',
  recipeOut: 'out',
  ifaceIn: 'bpin',
  ifaceOut: 'bpout',
  subgraphIn: 'bpi-in',
  subgraphOut: 'bpi-out',
  hubIn: 'hub-in',
  hubOut: 'hub-out',
  splitterIn: 'split-in',
  splitterOut: 'split-out',
  mergerIn: 'merge-in',
  mergerOut: 'merge-out',
  targetIn: 'target-in',
} as const;

const SOURCE_HANDLE_PREFIXES: readonly string[] = [
  HANDLE_PREFIX.recipeOut,
  HANDLE_PREFIX.ifaceIn,
  HANDLE_PREFIX.subgraphOut,
];

export function handleIdForIngredient(recipeId: string, itemId: string, index: number) {
  return `${HANDLE_PREFIX.recipeIn}:${recipeId}:${itemId}:${index}`;
}

export function handleIdForProduct(recipeId: string, itemId: string, index: number) {
  return `${HANDLE_PREFIX.recipeOut}:${recipeId}:${itemId}:${index}`;
}

export function handleIdForInterface(kind: 'input' | 'output', itemId?: string) {
  const prefix = kind === 'input' ? HANDLE_PREFIX.ifaceIn : HANDLE_PREFIX.ifaceOut;
  return itemId ? `${prefix}:${itemId}` : prefix;
}

export function handleIdForTarget(itemId?: string) {
  return itemId ? `${HANDLE_PREFIX.targetIn}:${itemId}` : HANDLE_PREFIX.targetIn;
}

export const HUB_IN_HANDLE = HANDLE_PREFIX.hubIn;
export const HUB_OUT_HANDLE = HANDLE_PREFIX.hubOut;

export const SPLITTER_IN_HANDLE = HANDLE_PREFIX.splitterIn;
export const SPLITTER_OUT_HANDLES = [
  `${HANDLE_PREFIX.splitterOut}-0`,
  `${HANDLE_PREFIX.splitterOut}-1`,
  `${HANDLE_PREFIX.splitterOut}-2`,
] as const;

export const MERGER_IN_HANDLES = [
  `${HANDLE_PREFIX.mergerIn}-0`,
  `${HANDLE_PREFIX.mergerIn}-1`,
  `${HANDLE_PREFIX.mergerIn}-2`,
] as const;
export const MERGER_OUT_HANDLE = HANDLE_PREFIX.mergerOut;

export type HublikeKind = 'hub' | 'splitter' | 'merger';

export function isHublikeKind(kind: NodeData['kind']): kind is HublikeKind {
  return kind === 'hub' || kind === 'splitter' || kind === 'merger';
}

// A hub-like's "item type" is derived from whatever flows through it — i.e.
// the itemId shared by its incident edges. Returns null when the node is
// disconnected, which UI treats as the "?" unset state.
export function hublikeItemFromEdges(graph: Graph, nodeId: NodeId): string | null {
  for (const e of graph.edges) {
    if (e.source === nodeId || e.target === nodeId) return e.itemId || null;
  }
  return null;
}

// Resolve the item carried by a specific port on a specific node. Empty
// string means "item is not yet committed" (disconnected hub-like or a
// fresh Input/Output with no itemId set). Callers either filter by this
// item (drag-drop menu) or validate connection endpoints against it.
export function itemIdForHandle(
  graph: Graph,
  node: GraphNode,
  handleId: string | null | undefined,
  side: 'source' | 'target',
): string {
  if (isHublikeKind(node.data.kind)) {
    return hublikeItemFromEdges(graph, node.id) ?? '';
  }
  if (node.data.kind === 'input' || node.data.kind === 'output') {
    return node.data.itemId ?? '';
  }
  if (node.data.kind === 'target') {
    return node.data.targetItemId ?? '';
  }
  return side === 'source'
    ? itemIdFromSourceHandle(handleId ?? '')
    : itemIdFromTargetHandle(handleId ?? '');
}

// Subgraph-instance handles: blueprint and factory instance nodes share this
// wire format so flow.ts can treat them uniformly.
export function handleIdForSubgraphInput(internalNodeId: string, itemId: string) {
  return `${HANDLE_PREFIX.subgraphIn}:${internalNodeId}:${itemId}`;
}

export function handleIdForSubgraphOutput(internalNodeId: string, itemId: string) {
  return `${HANDLE_PREFIX.subgraphOut}:${internalNodeId}:${itemId}`;
}

export function internalNodeIdFromSubgraphHandle(handleId: string): string | null {
  const parts = handleId.split(':');
  const prefix = parts[0];
  if (
    (prefix === HANDLE_PREFIX.subgraphIn || prefix === HANDLE_PREFIX.subgraphOut) &&
    parts.length >= 3
  ) {
    return parts[1];
  }
  return null;
}

export function itemIdFromSourceHandle(handleId: string): string {
  const parts = handleId.split(':');
  if (!SOURCE_HANDLE_PREFIXES.includes(parts[0])) return '';
  // recipeOut: out:recipeId:itemId:idx / bpInstOut: bpi-out:internalId:itemId
  // / ifaceIn: bpin:itemId (2 segments).
  return parts[0] === HANDLE_PREFIX.ifaceIn ? parts[1] ?? '' : parts[2] ?? '';
}

export function itemIdFromTargetHandle(handleId: string): string {
  const parts = handleId.split(':');
  switch (parts[0]) {
    case HANDLE_PREFIX.recipeIn: // in:recipeId:itemId:idx
    case HANDLE_PREFIX.subgraphIn: // bpi-in:internalId:itemId
      return parts[2] ?? '';
    case HANDLE_PREFIX.ifaceOut: // bpout:itemId
      return parts[1] ?? '';
    default:
      return '';
  }
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
