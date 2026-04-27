import type { GameData, Recipe } from '@/data/types';
import type { GraphEdge, NodeId, RecipeNodeData } from '@/models/graph';
import {
  handleIdForIngredient,
  handleIdForProduct,
  itemsPerMinute,
} from '@/models/factory';
import { getRecipesProducing } from '@/data/loader';

export type ClockStrategy = 'partial-last' | 'uniform';
export type GroupingStrategy = 'combined' | 'split';

// One disconnected ingredient resolved to the user's choice of upstream recipe.
export interface InputSelection {
  ingredientIndex: number; // index into target recipe's ingredients
  itemId: string;
  demandRate: number; // items/min the target asks for
  recipeId: string; // user-chosen upstream recipe
  targetHandleId: string;
}

export interface AutoFillNode {
  position: { x: number; y: number };
  data: RecipeNodeData;
}

export type AutoFillEdge = Omit<GraphEdge, 'id'>;

// Axis-aligned bounding box of an existing canvas node. Passed in by the
// caller (which reads React Flow's measured dims) so the layout can avoid
// overlapping anything already placed.
export interface OccupiedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoFillResult {
  nodes: AutoFillNode[];
  edges: AutoFillEdge[];
}

const MIN_CLOCK = 0.01;
const MAX_CLOCK = 1.0; // no overclocking — honors "stay at 100%" decision
const LAYOUT_X_OFFSET = 360;
const NEW_NODE_WIDTH = 260;
// Height estimate for a freshly-placed recipe node. Typical recipe nodes
// render around 100-130px tall; slight overestimate keeps a small visible
// gutter between stacked nodes without an explicit padding knob.
const NEW_NODE_HEIGHT = 120;

// Returns one or two buckets describing how many machines run at what clock.
// `partial-last` gives N-1 at 100% and 1 at the remainder; collapses to a
// single bucket when N === 1. `uniform` always returns one bucket.
export function computeClockSplit(
  demand: number,
  baseRateAt100: number,
  strategy: ClockStrategy,
): Array<{ count: number; clockSpeed: number }> {
  if (demand <= 0 || baseRateAt100 <= 0) return [];
  const exact = demand / baseRateAt100;
  const N = Math.max(1, Math.ceil(exact));

  if (strategy === 'uniform') {
    const clock = clampClock(demand / (N * baseRateAt100));
    return [{ count: N, clockSpeed: clock }];
  }

  // partial-last
  if (N === 1) {
    return [{ count: 1, clockSpeed: clampClock(exact) }];
  }
  const remainder = clampClock(exact - (N - 1));
  // When demand divides the base rate evenly the remainder lands at 100%,
  // which is indistinguishable from the main bucket — collapse so combined
  // mode doesn't emit two identical nodes side by side.
  if (remainder >= MAX_CLOCK - 1e-6) {
    return [{ count: N, clockSpeed: MAX_CLOCK }];
  }
  return [
    { count: N - 1, clockSpeed: MAX_CLOCK },
    { count: 1, clockSpeed: remainder },
  ];
}

// LP rate ("machines at 100%") → discrete count + clockSpeed via the shared
// uniform splitter. One bucket — the whole rate carried by `count` machines
// running at the same clock. Shared between optimizerApply and yieldApply.
export function discretizeRate(rate: number): { count: number; clockSpeed: number } {
  if (rate <= 0) return { count: 0, clockSpeed: 1 };
  const split = computeClockSplit(rate, 1, 'uniform')[0];
  return split ?? { count: 1, clockSpeed: 1 };
}

// True when every recipe producing this item is an extraction recipe, or when
// none exist. Raw inputs need a miner the app can't parameterise safely, so
// auto-fill skips them.
export function isRawInput(gameData: GameData, itemId: string): boolean {
  const recipes = getRecipesProducing(gameData, itemId);
  if (recipes.length === 0) return true;
  return recipes.every((r) => r.isExtraction === true);
}

// Filters `getRecipesProducing` to entries suitable for auto-fill (producing
// machines only — no extraction, no manual-only crafting).
export function getAutoFillRecipes(gameData: GameData, itemId: string): Recipe[] {
  return getRecipesProducing(gameData, itemId).filter(
    (r) => !r.isExtraction && !r.manualOnly,
  );
}

// Base items/min that ONE machine running the given recipe at 100% produces
// of the specified item. Returns 0 when the recipe doesn't list that item or
// when the product amount is non-positive.
export function baseRateFor(recipe: Recipe, itemId: string): number {
  const match = recipe.products.find((p) => p.itemId === itemId);
  if (!match || match.amount <= 0) return 0;
  return itemsPerMinute(recipe, match.amount, 1, 1);
}

export interface AutoFillOptions {
  clockStrategy: ClockStrategy;
  grouping: GroupingStrategy;
  // Existing canvas rects to avoid when stacking new nodes. Defaults to empty.
  occupied?: OccupiedRect[];
}

// Builds the list of new nodes and edges needed to satisfy the inputs. Each
// upstream machine connects to the target's ingredient handle directly —
// `computeFlows` water-fills demand across parallel edges so no Merger is
// needed. `grouping: 'combined'` emits one node per clock bucket with
// count=bucket.count; `'split'` emits one node per machine (count=1).
//
// Layout: all new nodes form a single vertical column to the left of the
// target, stacked top-to-bottom in ingredient order. `occupied` lets the
// stacker skip past rectangles that already live on the canvas so we don't
// drop a new recipe node on top of an existing one.
export function computeAutoFill(
  targetNodeId: NodeId,
  targetPosition: { x: number; y: number },
  inputs: InputSelection[],
  gameData: GameData,
  options: AutoFillOptions,
): AutoFillResult {
  const { clockStrategy, grouping, occupied = [] } = options;
  const nodes: AutoFillNode[] = [];
  const edges: AutoFillEdge[] = [];
  const columnX = targetPosition.x - LAYOUT_X_OFFSET;
  // Working copy so we can mark newly-placed positions as occupied for the
  // next node in this same run without mutating the caller's array.
  const occupiedLive: OccupiedRect[] = [...occupied];
  let cursorY = targetPosition.y;

  for (const sel of inputs) {
    const recipe = gameData.recipes[sel.recipeId];
    if (!recipe) continue;
    const base = baseRateFor(recipe, sel.itemId);
    if (base <= 0) continue;

    const buckets = computeClockSplit(sel.demandRate, base, clockStrategy);
    const productMatchIndex = recipe.products.findIndex((p) => p.itemId === sel.itemId);
    if (productMatchIndex < 0) continue;
    const sourceHandle = handleIdForProduct(recipe.id, sel.itemId, productMatchIndex);

    for (const bucket of buckets) {
      const emissions = grouping === 'combined' ? 1 : bucket.count;
      const perNodeCount = grouping === 'combined' ? bucket.count : 1;
      for (let i = 0; i < emissions; i++) {
        const y = findNextFreeY(
          columnX,
          cursorY,
          NEW_NODE_WIDTH,
          NEW_NODE_HEIGHT,
          occupiedLive,
        );
        const position = { x: columnX, y };
        const data: RecipeNodeData = {
          kind: 'recipe',
          recipeId: recipe.id,
          clockSpeed: bucket.clockSpeed,
          count: perNodeCount,
          somersloops: 0,
        };
        nodes.push({ position, data });
        edges.push({
          source: indexPlaceholder(nodes.length - 1),
          sourceHandle,
          target: targetNodeId,
          targetHandle: sel.targetHandleId,
          itemId: sel.itemId,
          rate: base * bucket.clockSpeed * perNodeCount,
        });
        occupiedLive.push({
          x: columnX,
          y,
          width: NEW_NODE_WIDTH,
          height: NEW_NODE_HEIGHT,
        });
        cursorY = y + NEW_NODE_HEIGHT;
      }
    }
  }

  return { nodes, edges };
}

// Walks down from `y` until the proposed rect clears every occupied rect.
// Re-scans after each bump because jumping past one rect may push us into
// another directly below.
function findNextFreeY(
  x: number,
  y: number,
  width: number,
  height: number,
  occupied: OccupiedRect[],
): number {
  let current = y;
  let moved = true;
  while (moved) {
    moved = false;
    for (const r of occupied) {
      const overlaps =
        x < r.x + r.width &&
        x + width > r.x &&
        current < r.y + r.height &&
        current + height > r.y;
      if (overlaps) {
        current = r.y + r.height;
        moved = true;
      }
    }
  }
  return current;
}

// Edge `source` placeholders reference nodes by emission index until the
// caller hands back real ids. Kept internal so misuse stays contained.
const PLACEHOLDER_PREFIX = '__autofill-pending:';
function indexPlaceholder(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}`;
}
function resolvePlaceholder(value: string): number | null {
  if (!value.startsWith(PLACEHOLDER_PREFIX)) return null;
  const n = Number(value.slice(PLACEHOLDER_PREFIX.length));
  return Number.isFinite(n) ? n : null;
}

// Dispatches an AutoFillResult through a batch callback. The callback is
// handed the node specs plus a second callback that, given the real ids of
// the inserted nodes, returns the edges with placeholder sources swapped
// for real ids. Keeps the placeholder protocol private to this module.
export function applyAutoFillResult(
  result: AutoFillResult,
  batch: (
    nodeSpecs: Array<{ position: { x: number; y: number }; data: RecipeNodeData }>,
    edgesFrom: (newIds: NodeId[]) => AutoFillEdge[],
  ) => void,
): void {
  batch(result.nodes, (newIds) => {
    const out: AutoFillEdge[] = [];
    for (const e of result.edges) {
      const idx = resolvePlaceholder(e.source);
      if (idx === null || idx >= newIds.length) continue;
      out.push({ ...e, source: newIds[idx] });
    }
    return out;
  });
}

// Scan the active graph for any edge targeting the given (nodeId, handleId).
// Used by the caller to decide which ingredients are already satisfied.
export function isHandleConnected(
  edges: GraphEdge[],
  nodeId: NodeId,
  handleId: string,
): boolean {
  return edges.some((e) => e.target === nodeId && e.targetHandle === handleId);
}

// Convenience: expand the target's ingredient list into what the auto-fill
// modal needs — one entry per ingredient index with its handle id, demand
// rate, and classification (raw vs. fillable).
export interface IngredientRow {
  ingredientIndex: number;
  itemId: string;
  demandRate: number;
  targetHandleId: string;
  connected: boolean;
  raw: boolean;
  availableRecipes: Recipe[];
}

export function describeIngredients(
  recipe: Recipe,
  nodeData: RecipeNodeData,
  edges: GraphEdge[],
  targetNodeId: NodeId,
  gameData: GameData,
): IngredientRow[] {
  return recipe.ingredients.map((io, index) => {
    const targetHandleId = handleIdForIngredient(recipe.id, io.itemId, index);
    const raw = isRawInput(gameData, io.itemId);
    return {
      ingredientIndex: index,
      itemId: io.itemId,
      demandRate: itemsPerMinute(recipe, io.amount, nodeData.clockSpeed, nodeData.count),
      targetHandleId,
      connected: isHandleConnected(edges, targetNodeId, targetHandleId),
      raw,
      availableRecipes: raw ? [] : getAutoFillRecipes(gameData, io.itemId),
    };
  });
}

function clampClock(value: number): number {
  if (!Number.isFinite(value)) return MIN_CLOCK;
  return Math.max(MIN_CLOCK, Math.min(MAX_CLOCK, value));
}
