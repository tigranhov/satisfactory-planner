import type { GameData, ItemId, RecipeId } from '@/data/types';
import type { GraphEdge, GraphId, NodeId, RecipeNodeData } from '@/models/graph';
import { handleIdForIngredient, handleIdForProduct, itemsPerMinute } from '@/models/factory';
import { useGraphStore } from '@/store/graphStore';
import { commitHistory } from '@/store/historyStore';
import { newEdgeId } from './ids';
import { discretizeRate } from './autoFill';
import type { OptimizerScope } from './optimizerScope';
import type { RecipeDiff } from './optimizerDiff';

export type ApplyResult = { ok: true } | { ok: false; reason: string };

// Whether the current diff is something the apply path supports. Pure adds and
// removes need new-node placement / dangling-edge cleanup that v0.2 doesn't
// model — surface a clear refusal up front so the user knows it's a feature
// gap, not a silent failure.
export function canApplyDiff(diff: RecipeDiff): ApplyResult {
  if (diff.added.length > 0 || diff.removed.length > 0) {
    return {
      ok: false,
      reason:
        "Apply doesn't yet handle add or remove changes — they need manual placement. Swap and rate adjustment apply automatically.",
    };
  }
  return { ok: true };
}

interface NodeAction {
  oldRecipeId: RecipeId;
  newRecipeId: RecipeId;
  count: number;
  clockSpeed: number;
}

function buildNodeActions(
  scope: OptimizerScope,
  diff: RecipeDiff,
): Map<NodeId, NodeAction> {
  const entryByRecipe = new Map(scope.chain.map((c) => [c.recipeId, c] as const));
  const actions = new Map<NodeId, NodeAction>();
  for (const swap of diff.swaps) {
    if (swap.kind !== 'swap') continue;
    const entry = entryByRecipe.get(swap.from.id);
    if (!entry) continue;
    const { count, clockSpeed } = discretizeRate(swap.after);
    actions.set(entry.nodeId, {
      oldRecipeId: swap.from.id,
      newRecipeId: swap.to.id,
      count,
      clockSpeed,
    });
  }
  for (const rc of diff.rateChanges) {
    if (rc.kind !== 'rateChanged') continue;
    const entry = entryByRecipe.get(rc.recipe.id);
    if (!entry) continue;
    const { count, clockSpeed } = discretizeRate(rc.after);
    actions.set(entry.nodeId, {
      oldRecipeId: rc.recipe.id,
      newRecipeId: rc.recipe.id,
      count,
      clockSpeed,
    });
  }
  return actions;
}

interface ChainSlot {
  nodeId: NodeId;
  recipeId: RecipeId;
  count: number;
  clockSpeed: number;
}

function chainStateAfterApply(
  scope: OptimizerScope,
  actions: Map<NodeId, NodeAction>,
): ChainSlot[] {
  return scope.chain.map((entry) => {
    const action = actions.get(entry.nodeId);
    return {
      nodeId: entry.nodeId,
      recipeId: action?.newRecipeId ?? entry.recipeId,
      count: action?.count ?? entry.count,
      clockSpeed: action?.clockSpeed ?? entry.clockSpeed,
    };
  });
}

interface FlowEndpoint {
  nodeId: NodeId;
  handle: string;
  rate: number;
}

// Per-item production / consumption maps over the post-apply chain. Drives
// internal edge rebuilding and boundary-edge retargeting.
function flowsByItem(chain: ChainSlot[], gameData: GameData) {
  const production = new Map<ItemId, FlowEndpoint[]>();
  const consumption = new Map<ItemId, FlowEndpoint[]>();
  for (const slot of chain) {
    const recipe = gameData.recipes[slot.recipeId];
    if (!recipe) continue;
    for (let i = 0; i < recipe.products.length; i++) {
      const p = recipe.products[i];
      const rate = itemsPerMinute(recipe, p.amount, slot.clockSpeed, slot.count);
      if (rate <= 0) continue;
      const arr = production.get(p.itemId) ?? [];
      arr.push({
        nodeId: slot.nodeId,
        handle: handleIdForProduct(slot.recipeId, p.itemId, i),
        rate,
      });
      production.set(p.itemId, arr);
    }
    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ing = recipe.ingredients[i];
      const rate = itemsPerMinute(recipe, ing.amount, slot.clockSpeed, slot.count);
      if (rate <= 0) continue;
      const arr = consumption.get(ing.itemId) ?? [];
      arr.push({
        nodeId: slot.nodeId,
        handle: handleIdForIngredient(slot.recipeId, ing.itemId, i),
        rate,
      });
      consumption.set(ing.itemId, arr);
    }
  }
  return { production, consumption };
}

// Pick the largest endpoint to anchor a preserved boundary edge to. Multi-
// consumer / multi-producer items are rare in chain-sized graphs; v0.2 routes
// the whole edge to the dominant endpoint and lets internal edges absorb the
// cross-flow.
function primaryEndpoint(
  flows: Map<ItemId, FlowEndpoint[]>,
  itemId: ItemId,
): FlowEndpoint | null {
  const list = flows.get(itemId);
  if (!list || list.length === 0) return null;
  return list.reduce((best, ep) => (ep.rate > best.rate ? ep : best), list[0]);
}

export function applyOptimization(
  graphId: GraphId,
  scope: OptimizerScope,
  diff: RecipeDiff,
  gameData: GameData,
): ApplyResult {
  const check = canApplyDiff(diff);
  if (!check.ok) return check;

  const store = useGraphStore.getState();
  const graph = store.graphs[graphId];
  if (!graph) return { ok: false, reason: 'Graph not found.' };

  const actions = buildNodeActions(scope, diff);
  if (actions.size === 0) return { ok: true };

  commitHistory();

  const chainIds = new Set(scope.chain.map((c) => c.nodeId));
  const newChain = chainStateAfterApply(scope, actions);
  const { production, consumption } = flowsByItem(newChain, gameData);

  // Rewrite chain nodes in-place. Same node ids preserve user positions and
  // any external state attached to them; only the recipe + sizing changes.
  const newNodes = graph.nodes.map((node) => {
    if (!chainIds.has(node.id)) return node;
    const action = actions.get(node.id);
    if (!action) return node;
    if (node.data.kind !== 'recipe') return node;
    return {
      ...node,
      data: {
        ...(node.data as RecipeNodeData),
        recipeId: action.newRecipeId,
        count: action.count,
        clockSpeed: action.clockSpeed,
        // Recipe identity changed (or rate changed) — drop sloops since the
        // user explicitly excluded them from the optimization. They can re-add.
        somersloops: action.oldRecipeId === action.newRecipeId
          ? (node.data as RecipeNodeData).somersloops
          : 0,
      },
    };
  });

  // Three-way edge classification: internal (chain↔chain) edges drop and get
  // rebuilt from the post-apply flow; boundary edges (one endpoint outside the
  // chain) get retargeted/source-rewritten to whatever consumer/producer the
  // new chain has for the same item; everything else is unrelated, untouched.
  const keptEdges: GraphEdge[] = [];
  const claimedBoundary = new Set<string>();
  for (const edge of graph.edges) {
    const sourceInChain = chainIds.has(edge.source);
    const targetInChain = chainIds.has(edge.target);
    if (sourceInChain && targetInChain) continue; // rebuilt below
    if (!sourceInChain && !targetInChain) {
      keptEdges.push(edge);
      continue;
    }

    if (!sourceInChain && targetInChain) {
      // Boundary IN: source supplies edge.itemId from outside the chain. Find
      // the new consumer of that item; if none, the new chain doesn't need it
      // and we drop the edge.
      const consumer = primaryEndpoint(consumption, edge.itemId);
      if (!consumer) continue;
      keptEdges.push({
        ...edge,
        target: consumer.nodeId,
        targetHandle: consumer.handle,
      });
      claimedBoundary.add(`in:${edge.itemId}`);
      continue;
    }

    // Boundary OUT
    const producer = primaryEndpoint(production, edge.itemId);
    if (!producer) continue;
    keptEdges.push({
      ...edge,
      source: producer.nodeId,
      sourceHandle: producer.handle,
    });
    claimedBoundary.add(`out:${edge.itemId}`);
  }

  // Rebuild internal edges. For each item produced and consumed within the
  // chain, route the largest producer to each consumer at the consumer's rate.
  // Edge rate is recomputed by flow.ts on render — we pre-fill with consumer
  // rate so the field has a sensible value before the next compute pass.
  const newEdges: GraphEdge[] = [...keptEdges];
  for (const itemId of scope.internalItems) {
    const consumers = consumption.get(itemId);
    if (!consumers || consumers.length === 0) continue;
    const producer = primaryEndpoint(production, itemId);
    if (!producer) continue;
    for (const consumer of consumers) {
      newEdges.push({
        id: newEdgeId(),
        source: producer.nodeId,
        sourceHandle: producer.handle,
        target: consumer.nodeId,
        targetHandle: consumer.handle,
        itemId,
        rate: consumer.rate,
      });
    }
  }

  const allGraphs = useGraphStore.getState().graphs;
  useGraphStore.getState().replaceGraphs({
    ...allGraphs,
    [graphId]: { ...graph, nodes: newNodes, edges: newEdges },
  });

  return { ok: true };
}
