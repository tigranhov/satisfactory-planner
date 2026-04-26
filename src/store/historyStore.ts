import { create } from 'zustand';
import type { Graph, GraphId } from '@/models/graph';
import type { Blueprint, BlueprintId } from '@/models/blueprint';
import { useGraphStore } from './graphStore';
import { useBlueprintStore } from './blueprintStore';

export interface HistorySnapshot {
  graphs: Record<GraphId, Graph>;
  blueprints: Record<BlueprintId, Blueprint>;
}

const CAPACITY = 100;

interface HistoryState {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  // Staging slot for multi-step transactions (e.g. drag-and-drop): callers
  // beginTransaction() before the action, commitTransaction() if anything
  // actually changed, or abortTransaction() to drop the staged snapshot.
  staged: HistorySnapshot | null;
  commit: () => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  undo: () => boolean;
  redo: () => boolean;
  clear: () => void;
}

function captureSnapshot(): HistorySnapshot {
  return {
    graphs: useGraphStore.getState().graphs,
    blueprints: useBlueprintStore.getState().blueprints,
  };
}

// Restore order matters: blueprints first, then graphs. The bridge subscribes
// to graphStore and short-circuits on `g.nodes === current.nodes`. If we
// replace graphs first, the bridge sees the snapshot's nodes against the
// current (post-action) blueprint and writes them back — wasted work that
// replaceBlueprints would immediately overwrite. Restoring blueprints first
// makes the bridge's existing reference-equality check fire and skip cleanly.
function restoreSnapshot(snap: HistorySnapshot): void {
  useBlueprintStore.getState().replaceBlueprints(snap.blueprints);
  useGraphStore.getState().replaceGraphs(snap.graphs);
}

function pushPast(past: HistorySnapshot[], snap: HistorySnapshot): HistorySnapshot[] {
  const trimmed = past.length >= CAPACITY ? past.slice(1) : past;
  return [...trimmed, snap];
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  staged: null,

  commit: () => {
    const snap = captureSnapshot();
    set((s) => ({ past: pushPast(s.past, snap), future: [] }));
  },

  beginTransaction: () => set({ staged: captureSnapshot() }),

  commitTransaction: () => {
    const staged = get().staged;
    if (!staged) return;
    set((s) => ({ past: pushPast(s.past, staged), future: [], staged: null }));
  },

  abortTransaction: () => set({ staged: null }),

  undo: () => {
    const { past } = get();
    if (past.length === 0) return false;
    const previous = past[past.length - 1];
    const current = captureSnapshot();
    set({ past: past.slice(0, -1), future: [current, ...get().future] });
    restoreSnapshot(previous);
    return true;
  },

  redo: () => {
    const { future } = get();
    if (future.length === 0) return false;
    const next = future[0];
    const current = captureSnapshot();
    set({ past: [...get().past, current], future: future.slice(1) });
    restoreSnapshot(next);
    return true;
  },

  clear: () => set({ past: [], future: [], staged: null }),
}));

// Convenience for non-React callers — every mutation site can do
// `commitHistory()` before mutating without resolving the hook.
export const commitHistory = (): void => useHistoryStore.getState().commit();
export const beginHistoryTransaction = (): void =>
  useHistoryStore.getState().beginTransaction();
export const commitHistoryTransaction = (): void =>
  useHistoryStore.getState().commitTransaction();
export const abortHistoryTransaction = (): void =>
  useHistoryStore.getState().abortTransaction();

export const selectCanUndo = (s: HistoryState): boolean => s.past.length > 0;
export const selectCanRedo = (s: HistoryState): boolean => s.future.length > 0;
