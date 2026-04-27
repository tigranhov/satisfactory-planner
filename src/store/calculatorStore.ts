import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { ItemId } from '@/data/types';
import type { RecipeChoice } from '@/lib/calculator';

// Session-scoped calculator state. Not persisted to disk — closing and
// reopening the modal keeps state, reloading the app resets it.
//
// The calculator is intentionally orthogonal to projects/blueprints: it's a
// scratch tool for "how much raw X to hit a target", not part of a saved
// build. If users ask for persistence later, mirror the uiStore pattern.

export interface CalculatorTarget {
  id: string;
  itemId: ItemId;
  // Total count of this item the user wants to produce. The calculator works
  // in pure quantities — no time dimension — so this is "I want N of X" and
  // the tree shows how many of every input it takes.
  quantity: number;
}

interface CalculatorState {
  targets: CalculatorTarget[];
  // Per-item recipe override. Missing keys → auto-default in buildCalcTree.
  recipeByItem: Record<ItemId, RecipeChoice>;
  // Tree expansion is keyed by tree path, not itemId, so the same item under
  // different parents expands independently.
  expanded: Record<string, boolean>;

  addTarget: (itemId: ItemId, quantity: number) => void;
  setTargetItem: (id: string, itemId: ItemId) => void;
  setTargetQuantity: (id: string, quantity: number) => void;
  removeTarget: (id: string) => void;
  setRecipeChoice: (itemId: ItemId, choice: RecipeChoice) => void;
  resetRecipeChoice: (itemId: ItemId) => void;
  setExpanded: (path: string, open: boolean) => void;
  expandAll: (paths: string[]) => void;
  collapseAll: () => void;
  reset: () => void;
}

export const useCalculatorStore = create<CalculatorState>((set) => ({
  targets: [],
  recipeByItem: {},
  expanded: {},

  addTarget: (itemId, quantity) =>
    set((s) => ({
      targets: [...s.targets, { id: nanoid(8), itemId, quantity }],
    })),

  setTargetItem: (id, itemId) =>
    set((s) => ({
      targets: s.targets.map((t) => (t.id === id ? { ...t, itemId } : t)),
    })),

  setTargetQuantity: (id, quantity) =>
    set((s) => ({
      targets: s.targets.map((t) => (t.id === id ? { ...t, quantity } : t)),
    })),

  removeTarget: (id) =>
    set((s) => ({ targets: s.targets.filter((t) => t.id !== id) })),

  setRecipeChoice: (itemId, choice) =>
    set((s) => {
      if (s.recipeByItem[itemId] === choice) return s;
      return { recipeByItem: { ...s.recipeByItem, [itemId]: choice } };
    }),

  resetRecipeChoice: (itemId) =>
    set((s) => {
      if (!(itemId in s.recipeByItem)) return s;
      const next = { ...s.recipeByItem };
      delete next[itemId];
      return { recipeByItem: next };
    }),

  setExpanded: (path, open) =>
    set((s) => {
      if (s.expanded[path] === open) return s;
      return { expanded: { ...s.expanded, [path]: open } };
    }),

  expandAll: (paths) =>
    set((s) => {
      const next = { ...s.expanded };
      for (const p of paths) next[p] = true;
      return { expanded: next };
    }),

  collapseAll: () => set({ expanded: {} }),

  reset: () => set({ targets: [], recipeByItem: {}, expanded: {} }),
}));
