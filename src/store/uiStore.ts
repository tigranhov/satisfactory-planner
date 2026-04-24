import { create } from 'zustand';
import { useNavigationStore } from '@/store/navigationStore';
import type { GraphId, NodeId } from '@/models/graph';
import type { ProjectId } from '@/models/project';

// Transient + per-project UI state. Persisted to localStorage instead of the
// project JSON file so the panel-open bit doesn't pollute shareable saves.
const STORAGE_KEY = 'sp.uiState.v1';

interface PersistedShape {
  taskPanelOpenByProject: Record<ProjectId, boolean>;
}

function loadPersisted(): PersistedShape {
  if (typeof localStorage === 'undefined') return { taskPanelOpenByProject: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { taskPanelOpenByProject: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return { taskPanelOpenByProject: parsed.taskPanelOpenByProject ?? {} };
  } catch {
    return { taskPanelOpenByProject: {} };
  }
}

function savePersisted(state: PersistedShape): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or SecurityError — safe to ignore, UI state is recoverable */
  }
}

interface UiState {
  taskPanelOpenByProject: Record<ProjectId, boolean>;
  pendingFocusNodeId: NodeId | null;

  setTaskPanelOpen: (projectId: ProjectId, open: boolean) => void;
  clearPendingFocus: () => void;
  navigateToNode: (graphId: GraphId, nodeId: NodeId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  ...loadPersisted(),
  pendingFocusNodeId: null,

  setTaskPanelOpen: (projectId, open) =>
    set((s) => {
      const next = { ...s.taskPanelOpenByProject, [projectId]: open };
      savePersisted({ taskPanelOpenByProject: next });
      return { taskPanelOpenByProject: next };
    }),

  clearPendingFocus: () => set({ pendingFocusNodeId: null }),

  navigateToNode: (graphId, nodeId) => {
    useNavigationStore.getState().jumpTo(graphId);
    set({ pendingFocusNodeId: nodeId });
  },
}));
