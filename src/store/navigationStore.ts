import { create } from 'zustand';
import type { GraphId } from '@/models/graph';
import { ROOT_GRAPH_ID } from '@/lib/ids';

const HISTORY_CAP = 100;

const stacksEqual = (a: GraphId[], b: GraphId[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const pushBounded = (arr: GraphId[][], entry: GraphId[]): GraphId[][] => {
  const next = [...arr, entry];
  if (next.length > HISTORY_CAP) next.shift();
  return next;
};

interface NavigationState {
  stack: GraphId[]; // top of stack is the active graph
  // Browser-style history: `back` holds prior stacks (oldest first), `forward`
  // holds stacks that goBack() popped off so a subsequent goForward() can
  // restore them. Any non-Back/Forward navigation clears `forward`.
  back: GraphId[][];
  forward: GraphId[][];

  enter: (graphId: GraphId) => void;
  popTo: (depth: number) => void; // 0 = root
  reset: () => void;
  jumpTo: (graphId: GraphId) => void;
  goBack: () => void;
  goForward: () => void;
}

const navigated = (
  s: NavigationState,
  newStack: GraphId[],
): Pick<NavigationState, 'stack' | 'back' | 'forward'> | null => {
  if (stacksEqual(s.stack, newStack)) return null;
  return {
    stack: newStack,
    back: pushBounded(s.back, s.stack),
    forward: [],
  };
};

export const useNavigationStore = create<NavigationState>((set) => ({
  stack: [ROOT_GRAPH_ID],
  back: [],
  forward: [],

  enter: (graphId) => set((s) => navigated(s, [...s.stack, graphId]) ?? s),

  popTo: (depth) => set((s) => navigated(s, s.stack.slice(0, depth + 1)) ?? s),

  // Graphs form a 2-level tree (root → factory subgraphs), so any non-root
  // graph's stack is exactly [ROOT, graphId]. Used by the Tasks panel and
  // Issues section to jump across graphs without replaying drill-down history.
  jumpTo: (graphId) =>
    set((s) =>
      navigated(s, graphId === ROOT_GRAPH_ID ? [ROOT_GRAPH_ID] : [ROOT_GRAPH_ID, graphId]) ?? s,
    ),

  // Switching projects resets navigation entirely — different project means a
  // fresh history with no past or future to walk into.
  reset: () =>
    set((s) => {
      if (
        stacksEqual(s.stack, [ROOT_GRAPH_ID]) &&
        s.back.length === 0 &&
        s.forward.length === 0
      ) {
        return s;
      }
      return { stack: [ROOT_GRAPH_ID], back: [], forward: [] };
    }),

  goBack: () =>
    set((s) => {
      if (s.back.length === 0) return s;
      const target = s.back[s.back.length - 1];
      return {
        stack: target,
        back: s.back.slice(0, -1),
        forward: pushBounded(s.forward, s.stack),
      };
    }),

  goForward: () =>
    set((s) => {
      if (s.forward.length === 0) return s;
      const target = s.forward[s.forward.length - 1];
      return {
        stack: target,
        back: pushBounded(s.back, s.stack),
        forward: s.forward.slice(0, -1),
      };
    }),
}));

export const selectActiveGraphId = (s: NavigationState) => s.stack[s.stack.length - 1];
