import type { GameData, ItemId, RecipeId } from '@/data/types';
import type { GraphEdge, GraphId, NodeData, NodeId } from '@/models/graph';
import {
  handleIdForIngredient,
  handleIdForInterface,
  handleIdForProduct,
  handleIdForSink,
  itemsPerMinute,
} from '@/models/factory';
import { useGraphStore } from '@/store/graphStore';
import { commitHistory } from '@/store/historyStore';
import { discretizeRate } from './autoFill';
import { snapPosition } from './canvasPlacement';
import type { YieldScope, YieldSolution } from './yieldSolver';

const COLUMN_SPACING = 360;
const ROW_SPACING = 200;

interface SourceNodeRef {
  nodeId: NodeId;
  itemId: ItemId;
  // Outgoing handle id for the source's `itemId`. Differs by node kind.
  handle: string;
  position: { x: number; y: number };
}

// Assign a column index to each used recipe. Source items are depth 0;
// auxiliaries (anything not produced by another used recipe and not in
// inputs) are also depth 0. A recipe's depth = max(ingredient depth) + 1.
// Iterates to a fixed point — chain may have alts that interlock so we
// can't pure-topological-sort, but the LP solution is acyclic in practice.
function assignDepths(
  scope: YieldScope,
  usedRecipes: Set<RecipeId>,
  gameData: GameData,
): Map<RecipeId, number> {
  const itemDepth = new Map<ItemId, number>();
  for (const item of scope.inputs.keys()) itemDepth.set(item, 0);

  const producedByChain = new Set<ItemId>();
  for (const recipeId of usedRecipes) {
    const recipe = gameData.recipes[recipeId];
    if (!recipe) continue;
    for (const p of recipe.products) producedByChain.add(p.itemId);
  }

  const recipeDepth = new Map<RecipeId, number>();
  let changed = true;
  let iter = 0;
  while (changed && iter < 32) {
    changed = false;
    iter++;
    for (const recipeId of usedRecipes) {
      const recipe = gameData.recipes[recipeId];
      if (!recipe) continue;
      let maxIngDepth = 0;
      let unresolved = false;
      for (const ing of recipe.ingredients) {
        const d = itemDepth.get(ing.itemId);
        if (d !== undefined) {
          if (d > maxIngDepth) maxIngDepth = d;
          continue;
        }
        if (producedByChain.has(ing.itemId)) {
          // Internal item but no depth assigned yet — wait another iteration.
          unresolved = true;
          break;
        }
        // Not in chain and not in inputs → auxiliary (Water/Coal/etc), depth 0.
      }
      if (unresolved) continue;
      const d = maxIngDepth + 1;
      const prev = recipeDepth.get(recipeId);
      if (prev !== undefined && prev <= d) continue;
      recipeDepth.set(recipeId, d);
      for (const p of recipe.products) {
        const prevItem = itemDepth.get(p.itemId);
        if (prevItem === undefined || d < prevItem) {
          itemDepth.set(p.itemId, d);
          changed = true;
        }
      }
      changed = true;
    }
  }

  // Anything still unresolved (cyclical interlock, rare) drops to the
  // rightmost known column + 1 so the chain still places.
  const maxKnown = [...recipeDepth.values()].reduce((a, b) => Math.max(a, b), 1);
  for (const recipeId of usedRecipes) {
    if (!recipeDepth.has(recipeId)) recipeDepth.set(recipeId, maxKnown + 1);
  }
  return recipeDepth;
}

interface PlacedRecipe {
  recipeId: RecipeId;
  count: number;
  clockSpeed: number;
  // Index into the eventual newIds array returned from addNodesAndEdges.
  insertIndex: number;
  position: { x: number; y: number };
}

export interface ApplyYieldResult {
  ok: boolean;
  reason?: string;
  newNodeIds?: NodeId[];
}

interface ApplyOptions {
  gridSize: number;
  snapToGrid: boolean;
}

export function applyYieldChain(
  graphId: GraphId,
  source: SourceNodeRef,
  scope: YieldScope,
  solution: YieldSolution,
  gameData: GameData,
  options: ApplyOptions,
): ApplyYieldResult {
  if (solution.recipeRates.size === 0) {
    return { ok: false, reason: 'No recipes to place — output rate is zero.' };
  }

  const usedRecipes = new Set(solution.recipeRates.keys());
  const recipeDepth = assignDepths(scope, usedRecipes, gameData);

  // Group recipes by depth for column placement.
  const byDepth = new Map<number, RecipeId[]>();
  for (const [recipeId, d] of recipeDepth) {
    const arr = byDepth.get(d) ?? [];
    arr.push(recipeId);
    byDepth.set(d, arr);
  }
  const maxDepth = [...byDepth.keys()].reduce((a, b) => Math.max(a, b), 1);

  // Build placement specs in column order. Vertical center per column based on
  // the source's y so the chain reads horizontally.
  const placedSpecs: PlacedRecipe[] = [];
  const nodeSpecs: Array<{ position: { x: number; y: number }; data: NodeData }> = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const recipes = byDepth.get(depth);
    if (!recipes) continue;
    recipes.sort();
    const x = source.position.x + COLUMN_SPACING * depth;
    const totalRows = recipes.length;
    const startY = source.position.y - ((totalRows - 1) * ROW_SPACING) / 2;
    recipes.forEach((recipeId, idx) => {
      const machines = solution.recipeRates.get(recipeId) ?? 0;
      const { count, clockSpeed } = discretizeRate(machines);
      if (count <= 0) return;
      const position = snapPosition(
        { x, y: startY + idx * ROW_SPACING },
        options.gridSize,
        options.snapToGrid,
      );
      const data: NodeData = {
        kind: 'recipe',
        recipeId,
        count,
        clockSpeed,
        somersloops: 0,
      };
      placedSpecs.push({
        recipeId,
        count,
        clockSpeed,
        insertIndex: nodeSpecs.length,
        position,
      });
      nodeSpecs.push({ position, data });
    });
  }

  // Output node for the maximized item, plus Sink nodes for every byproduct
  // surplus (anything in solution.surplus that isn't the primary output).
  const outputColumnX = source.position.x + COLUMN_SPACING * (maxDepth + 1);
  const sinkRefs: { itemId: ItemId; insertIndex: number }[] = [];
  const outputItem = scope.outputItemId;
  let outputInsertIndex = -1;
  {
    let row = 0;
    // Primary output first.
    const snapAt = (y: number) =>
      snapPosition({ x: outputColumnX, y }, options.gridSize, options.snapToGrid);
    if (solution.surplus.has(outputItem) || solution.outputRate > 0) {
      outputInsertIndex = nodeSpecs.length;
      nodeSpecs.push({
        position: snapAt(source.position.y + row * ROW_SPACING),
        data: { kind: 'output', itemId: outputItem },
      });
      row++;
    }
    for (const [itemId] of solution.surplus) {
      if (itemId === outputItem) continue;
      sinkRefs.push({ itemId, insertIndex: nodeSpecs.length });
      nodeSpecs.push({
        position: snapAt(source.position.y + row * ROW_SPACING),
        data: { kind: 'sink', sinkItemId: itemId },
      });
      row++;
    }
  }

  // Compute per-recipe rates for products / ingredients so edges carry
  // sensible pre-flow numbers (flow.ts recomputes on render anyway).
  const productionByItem = new Map<ItemId, { recipeId: RecipeId; rate: number; productIndex: number }[]>();
  const consumptionByItem = new Map<ItemId, { recipeId: RecipeId; rate: number; ingredientIndex: number }[]>();
  for (const spec of placedSpecs) {
    const recipe = gameData.recipes[spec.recipeId];
    if (!recipe) continue;
    recipe.products.forEach((p, i) => {
      const rate = itemsPerMinute(recipe, p.amount, spec.clockSpeed, spec.count);
      const arr = productionByItem.get(p.itemId) ?? [];
      arr.push({ recipeId: spec.recipeId, rate, productIndex: i });
      productionByItem.set(p.itemId, arr);
    });
    recipe.ingredients.forEach((ing, i) => {
      const rate = itemsPerMinute(recipe, ing.amount, spec.clockSpeed, spec.count);
      const arr = consumptionByItem.get(ing.itemId) ?? [];
      arr.push({ recipeId: spec.recipeId, rate, ingredientIndex: i });
      consumptionByItem.set(ing.itemId, arr);
    });
  }

  const placedByRecipeId = new Map(placedSpecs.map((s) => [s.recipeId, s]));

  // Build edges. Caller of addNodesAndEdges receives newIds for the inserted
  // nodes only — the source node is pre-existing, referenced by its real id.
  const edges = (newIds: NodeId[]): Array<Omit<GraphEdge, 'id'>> => {
    const out: Array<Omit<GraphEdge, 'id'>> = [];
    const idForRecipe = (recipeId: RecipeId): NodeId | undefined => {
      const spec = placedByRecipeId.get(recipeId);
      return spec ? newIds[spec.insertIndex] : undefined;
    };

    // Source → recipes consuming source.itemId. Spread the source rate evenly
    // across consumers proportional to their demand.
    const sourceConsumers = consumptionByItem.get(source.itemId);
    if (sourceConsumers) {
      const totalDemand = sourceConsumers.reduce((s, c) => s + c.rate, 0);
      const used = solution.inputUsage.get(source.itemId) ?? totalDemand;
      for (const consumer of sourceConsumers) {
        const recipe = gameData.recipes[consumer.recipeId];
        if (!recipe) continue;
        const targetId = idForRecipe(consumer.recipeId);
        if (!targetId) continue;
        const share =
          totalDemand > 0 ? (used * consumer.rate) / totalDemand : 0;
        out.push({
          source: source.nodeId,
          sourceHandle: source.handle,
          target: targetId,
          targetHandle: handleIdForIngredient(
            consumer.recipeId,
            source.itemId,
            consumer.ingredientIndex,
          ),
          itemId: source.itemId,
          rate: share,
        });
      }
    }

    // Internal item flows: every item produced by some chain recipe and
    // consumed by another. Route the largest producer to each consumer at the
    // consumer's full rate.
    for (const [itemId, consumers] of consumptionByItem) {
      if (itemId === source.itemId) continue;
      const producers = productionByItem.get(itemId);
      if (!producers || producers.length === 0) continue;
      const dominant = producers.reduce((a, b) => (a.rate >= b.rate ? a : b));
      const dominantId = idForRecipe(dominant.recipeId);
      if (!dominantId) continue;
      for (const consumer of consumers) {
        const consumerId = idForRecipe(consumer.recipeId);
        if (!consumerId) continue;
        out.push({
          source: dominantId,
          sourceHandle: handleIdForProduct(dominant.recipeId, itemId, dominant.productIndex),
          target: consumerId,
          targetHandle: handleIdForIngredient(consumer.recipeId, itemId, consumer.ingredientIndex),
          itemId,
          rate: consumer.rate,
        });
      }
    }

    // Producer → Output for the primary maximized item.
    if (outputInsertIndex >= 0) {
      const producers = productionByItem.get(outputItem);
      if (producers && producers.length > 0) {
        const dominant = producers.reduce((a, b) => (a.rate >= b.rate ? a : b));
        const dominantId = idForRecipe(dominant.recipeId);
        const outputId = newIds[outputInsertIndex];
        if (dominantId && outputId) {
          out.push({
            source: dominantId,
            sourceHandle: handleIdForProduct(dominant.recipeId, outputItem, dominant.productIndex),
            target: outputId,
            targetHandle: handleIdForInterface('output', outputItem),
            itemId: outputItem,
            rate: solution.outputRate,
          });
        }
      }
    }

    // Producer → Sink for each byproduct.
    for (const sink of sinkRefs) {
      const producers = productionByItem.get(sink.itemId);
      if (!producers || producers.length === 0) continue;
      const dominant = producers.reduce((a, b) => (a.rate >= b.rate ? a : b));
      const dominantId = idForRecipe(dominant.recipeId);
      const sinkId = newIds[sink.insertIndex];
      if (!dominantId || !sinkId) continue;
      out.push({
        source: dominantId,
        sourceHandle: handleIdForProduct(dominant.recipeId, sink.itemId, dominant.productIndex),
        target: sinkId,
        targetHandle: handleIdForSink(),
        itemId: sink.itemId,
        rate: solution.surplus.get(sink.itemId) ?? 0,
      });
    }

    return out;
  };

  commitHistory();
  const newNodeIds = useGraphStore.getState().addNodesAndEdges(graphId, nodeSpecs, edges);
  return { ok: true, newNodeIds };
}

// Mirror of applyYieldChain for the min-input direction. The "source" here is
// the *destination* of the chain — an Output / Sink / Target node that wants
// the item produced. Recipes cascade to the LEFT of it; raw resources land on
// new Input boundary nodes at the far left so the user can wire them to real
// extractors later. Edges flow right toward the existing target.
export function applyMinInputChain(
  graphId: GraphId,
  source: SourceNodeRef,
  scope: YieldScope,
  solution: YieldSolution,
  gameData: GameData,
  options: ApplyOptions,
): ApplyYieldResult {
  if (solution.recipeRates.size === 0) {
    return { ok: false, reason: 'No recipes to place — target rate is zero.' };
  }

  const usedRecipes = new Set(solution.recipeRates.keys());
  const recipeDepth = assignDepths(scope, usedRecipes, gameData);

  const byDepth = new Map<number, RecipeId[]>();
  for (const [recipeId, d] of recipeDepth) {
    const arr = byDepth.get(d) ?? [];
    arr.push(recipeId);
    byDepth.set(d, arr);
  }
  const maxDepth = [...byDepth.keys()].reduce((a, b) => Math.max(a, b), 1);

  const placedSpecs: PlacedRecipe[] = [];
  const nodeSpecs: Array<{ position: { x: number; y: number }; data: NodeData }> = [];

  // Recipe columns: depth 1 sits closest to the target, depth maxDepth is the
  // far-left edge where raw resources enter.
  for (let depth = 1; depth <= maxDepth; depth++) {
    const recipes = byDepth.get(depth);
    if (!recipes) continue;
    recipes.sort();
    const x = source.position.x - COLUMN_SPACING * depth;
    const totalRows = recipes.length;
    const startY = source.position.y - ((totalRows - 1) * ROW_SPACING) / 2;
    recipes.forEach((recipeId, idx) => {
      const machines = solution.recipeRates.get(recipeId) ?? 0;
      const { count, clockSpeed } = discretizeRate(machines);
      if (count <= 0) return;
      const position = snapPosition(
        { x, y: startY + idx * ROW_SPACING },
        options.gridSize,
        options.snapToGrid,
      );
      const data: NodeData = {
        kind: 'recipe',
        recipeId,
        count,
        clockSpeed,
        somersloops: 0,
      };
      placedSpecs.push({
        recipeId,
        count,
        clockSpeed,
        insertIndex: nodeSpecs.length,
        position,
      });
      nodeSpecs.push({ position, data });
    });
  }

  // Raw resource Input nodes: one per actually-consumed raw item, placed at
  // the far-left column. User wires these to real extractors / ports.
  const rawInputColumnX = source.position.x - COLUMN_SPACING * (maxDepth + 1);
  const rawInputRefs: { itemId: ItemId; insertIndex: number }[] = [];
  let rawRow = 0;
  for (const [itemId] of solution.inputUsage) {
    rawInputRefs.push({ itemId, insertIndex: nodeSpecs.length });
    nodeSpecs.push({
      position: snapPosition(
        { x: rawInputColumnX, y: source.position.y + rawRow * ROW_SPACING },
        options.gridSize,
        options.snapToGrid,
      ),
      data: { kind: 'input', itemId },
    });
    rawRow++;
  }

  // Sink nodes for byproducts (anything in surplus that isn't the target item
  // itself — that one flows into the existing target node).
  const byproductSinks: { itemId: ItemId; insertIndex: number }[] = [];
  let sinkRow = -1;
  for (const [itemId] of solution.surplus) {
    if (itemId === scope.outputItemId) continue;
    byproductSinks.push({ itemId, insertIndex: nodeSpecs.length });
    nodeSpecs.push({
      position: snapPosition(
        { x: source.position.x, y: source.position.y + sinkRow * ROW_SPACING },
        options.gridSize,
        options.snapToGrid,
      ),
      data: { kind: 'sink', sinkItemId: itemId },
    });
    sinkRow--;
  }

  const productionByItem = new Map<ItemId, { recipeId: RecipeId; rate: number; productIndex: number }[]>();
  const consumptionByItem = new Map<ItemId, { recipeId: RecipeId; rate: number; ingredientIndex: number }[]>();
  for (const spec of placedSpecs) {
    const recipe = gameData.recipes[spec.recipeId];
    if (!recipe) continue;
    recipe.products.forEach((p, i) => {
      const rate = itemsPerMinute(recipe, p.amount, spec.clockSpeed, spec.count);
      const arr = productionByItem.get(p.itemId) ?? [];
      arr.push({ recipeId: spec.recipeId, rate, productIndex: i });
      productionByItem.set(p.itemId, arr);
    });
    recipe.ingredients.forEach((ing, i) => {
      const rate = itemsPerMinute(recipe, ing.amount, spec.clockSpeed, spec.count);
      const arr = consumptionByItem.get(ing.itemId) ?? [];
      arr.push({ recipeId: spec.recipeId, rate, ingredientIndex: i });
      consumptionByItem.set(ing.itemId, arr);
    });
  }

  const placedByRecipeId = new Map(placedSpecs.map((s) => [s.recipeId, s]));

  const edges = (newIds: NodeId[]): Array<Omit<GraphEdge, 'id'>> => {
    const out: Array<Omit<GraphEdge, 'id'>> = [];
    const idForRecipe = (recipeId: RecipeId): NodeId | undefined => {
      const spec = placedByRecipeId.get(recipeId);
      return spec ? newIds[spec.insertIndex] : undefined;
    };

    // Internal item flows — same logic as the forward chain: dominant producer
    // routes to each consumer at the consumer's rate.
    for (const [itemId, consumers] of consumptionByItem) {
      const producers = productionByItem.get(itemId);
      if (!producers || producers.length === 0) continue;
      const dominant = producers.reduce((a, b) => (a.rate >= b.rate ? a : b));
      const dominantId = idForRecipe(dominant.recipeId);
      if (!dominantId) continue;
      for (const consumer of consumers) {
        const consumerId = idForRecipe(consumer.recipeId);
        if (!consumerId) continue;
        out.push({
          source: dominantId,
          sourceHandle: handleIdForProduct(dominant.recipeId, itemId, dominant.productIndex),
          target: consumerId,
          targetHandle: handleIdForIngredient(consumer.recipeId, itemId, consumer.ingredientIndex),
          itemId,
          rate: consumer.rate,
        });
      }
    }

    // Raw input nodes feed first-layer recipes that consume each raw item.
    for (const ref of rawInputRefs) {
      const inputNodeId = newIds[ref.insertIndex];
      const consumers = consumptionByItem.get(ref.itemId);
      if (!inputNodeId || !consumers) continue;
      // Only consumers without an internal producer need the raw input wired
      // — others are already satisfied by chain producers.
      const producers = productionByItem.get(ref.itemId);
      if (producers && producers.length > 0) continue;
      for (const consumer of consumers) {
        const consumerId = idForRecipe(consumer.recipeId);
        if (!consumerId) continue;
        out.push({
          source: inputNodeId,
          sourceHandle: handleIdForInterface('input', ref.itemId),
          target: consumerId,
          targetHandle: handleIdForIngredient(consumer.recipeId, ref.itemId, consumer.ingredientIndex),
          itemId: ref.itemId,
          rate: consumer.rate,
        });
      }
    }

    // Final stage: chain's producer of the target item → existing target node.
    const targetProducers = productionByItem.get(scope.outputItemId);
    if (targetProducers && targetProducers.length > 0) {
      const dominant = targetProducers.reduce((a, b) => (a.rate >= b.rate ? a : b));
      const dominantId = idForRecipe(dominant.recipeId);
      if (dominantId) {
        out.push({
          source: dominantId,
          sourceHandle: handleIdForProduct(dominant.recipeId, scope.outputItemId, dominant.productIndex),
          target: source.nodeId,
          targetHandle: source.handle,
          itemId: scope.outputItemId,
          rate: solution.outputRate,
        });
      }
    }

    // Byproduct sinks.
    for (const sink of byproductSinks) {
      const producers = productionByItem.get(sink.itemId);
      if (!producers || producers.length === 0) continue;
      const dominant = producers.reduce((a, b) => (a.rate >= b.rate ? a : b));
      const dominantId = idForRecipe(dominant.recipeId);
      const sinkId = newIds[sink.insertIndex];
      if (!dominantId || !sinkId) continue;
      out.push({
        source: dominantId,
        sourceHandle: handleIdForProduct(dominant.recipeId, sink.itemId, dominant.productIndex),
        target: sinkId,
        targetHandle: handleIdForSink(),
        itemId: sink.itemId,
        rate: solution.surplus.get(sink.itemId) ?? 0,
      });
    }

    return out;
  };

  commitHistory();
  const newNodeIds = useGraphStore.getState().addNodesAndEdges(graphId, nodeSpecs, edges);
  return { ok: true, newNodeIds };
}
