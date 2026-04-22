import { create } from 'zustand';
import type { GraphId } from '@/models/graph';
import { ROOT_GRAPH_ID } from '@/lib/ids';

interface NavigationState {
  stack: GraphId[]; // top of stack is the active graph
  enter: (graphId: GraphId) => void;
  popTo: (depth: number) => void; // 0 = root
  reset: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  stack: [ROOT_GRAPH_ID],
  enter: (graphId) => set((s) => ({ stack: [...s.stack, graphId] })),
  popTo: (depth) => set((s) => ({ stack: s.stack.slice(0, depth + 1) })),
  reset: () => set({ stack: [ROOT_GRAPH_ID] }),
}));

export const selectActiveGraphId = (s: NavigationState) => s.stack[s.stack.length - 1];
