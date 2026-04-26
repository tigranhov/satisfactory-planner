import { create } from 'zustand';
import type { Blueprint, BlueprintId } from '@/models/blueprint';
import { newBlueprintId } from '@/lib/ids';

interface BlueprintState {
  blueprints: Record<BlueprintId, Blueprint>;
  loaded: boolean;
  hydrate: (bps: Blueprint[]) => void;
  replaceBlueprints: (blueprints: Record<BlueprintId, Blueprint>) => void;
  addBlueprint: (
    bp: Omit<Blueprint, 'id' | 'createdAt' | 'updatedAt'>,
  ) => BlueprintId;
  updateBlueprint: (
    id: BlueprintId,
    patch: Partial<Omit<Blueprint, 'id' | 'createdAt'>>,
  ) => void;
  removeBlueprint: (id: BlueprintId) => void;
}

export const useBlueprintStore = create<BlueprintState>((set) => ({
  blueprints: {},
  loaded: false,

  hydrate: (bps) =>
    set(() => ({
      blueprints: Object.fromEntries(bps.map((bp) => [bp.id, bp])),
      loaded: true,
    })),

  replaceBlueprints: (blueprints) => set(() => ({ blueprints })),

  addBlueprint: (bp) => {
    const id = newBlueprintId();
    const now = Date.now();
    const record: Blueprint = { ...bp, id, createdAt: now, updatedAt: now };
    set((s) => ({ blueprints: { ...s.blueprints, [id]: record } }));
    return id;
  },

  updateBlueprint: (id, patch) =>
    set((s) => {
      const existing = s.blueprints[id];
      if (!existing) return s;
      return {
        blueprints: {
          ...s.blueprints,
          [id]: { ...existing, ...patch, id, updatedAt: Date.now() },
        },
      };
    }),

  removeBlueprint: (id) =>
    set((s) => {
      if (!(id in s.blueprints)) return s;
      const next = { ...s.blueprints };
      delete next[id];
      return { blueprints: next };
    }),
}));
