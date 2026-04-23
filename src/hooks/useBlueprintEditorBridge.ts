import { useEffect } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { useBlueprintStore } from '@/store/blueprintStore';
import { useActiveGraphId } from './useActiveGraph';
import { useNavigationStore } from '@/store/navigationStore';

// When a blueprint is being edited (its id lives at the top of the navigation
// stack and as a graph in graphStore), mirror graph changes back into the
// blueprint record so the autosave layer persists them.
export function useBlueprintEditorBridge() {
  const activeGraphId = useActiveGraphId();

  useEffect(() => {
    const initial = useBlueprintStore.getState().blueprints[activeGraphId];
    if (!initial) return;

    return useGraphStore.subscribe((state) => {
      const g = state.graphs[activeGraphId];
      if (!g) return;
      const current = useBlueprintStore.getState().blueprints[activeGraphId];
      if (!current) return;
      if (g.nodes === current.nodes && g.edges === current.edges) return;
      useBlueprintStore.getState().updateBlueprint(activeGraphId, {
        nodes: g.nodes,
        edges: g.edges,
      });
    });
  }, [activeGraphId]);
}

// Open a blueprint's internal subgraph for editing. Ensures the graph exists
// in graphStore under the blueprint's id, then pushes it onto the navigation
// stack so the canvas switches to it.
export function openBlueprintForEditing(blueprintId: string) {
  const bp = useBlueprintStore.getState().blueprints[blueprintId];
  if (!bp) return;
  useGraphStore.setState((s) => {
    const existing = s.graphs[blueprintId];
    const next = {
      id: blueprintId,
      name: bp.name,
      nodes: bp.nodes,
      edges: bp.edges,
    };
    if (
      existing &&
      existing.name === next.name &&
      existing.nodes === next.nodes &&
      existing.edges === next.edges
    ) {
      return s;
    }
    return { graphs: { ...s.graphs, [blueprintId]: next } };
  });
  useNavigationStore.getState().enter(blueprintId);
}

