import { create } from 'zustand';
import { useNavigationStore } from '@/store/navigationStore';
import type { GraphId, NodeId } from '@/models/graph';
import type { ProjectId } from '@/models/project';

// Transient + per-project UI state. Persisted to localStorage instead of the
// project JSON file so transient bits don't pollute shareable saves.
const STORAGE_KEY = 'sp.uiState.v1';

export type ClockStrategy = 'partial-last' | 'uniform';
export type GroupingStrategy = 'combined' | 'split';

interface PersistedShape {
  taskPanelOpenByProject: Record<ProjectId, boolean>;
  infoPanelOpenByProject: Record<ProjectId, boolean>;
  infoSectionsOpen: Record<string, boolean>;
  clockStrategy: ClockStrategy;
  groupingStrategy: GroupingStrategy;
}

const DEFAULT_PERSISTED: PersistedShape = {
  taskPanelOpenByProject: {},
  infoPanelOpenByProject: {},
  infoSectionsOpen: {},
  clockStrategy: 'partial-last',
  groupingStrategy: 'combined',
};

function loadPersisted(): PersistedShape {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PERSISTED };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERSISTED };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return {
      taskPanelOpenByProject: parsed.taskPanelOpenByProject ?? {},
      infoPanelOpenByProject: parsed.infoPanelOpenByProject ?? {},
      infoSectionsOpen: parsed.infoSectionsOpen ?? {},
      clockStrategy: parsed.clockStrategy ?? DEFAULT_PERSISTED.clockStrategy,
      groupingStrategy: parsed.groupingStrategy ?? DEFAULT_PERSISTED.groupingStrategy,
    };
  } catch {
    return { ...DEFAULT_PERSISTED };
  }
}

function savePersisted(state: PersistedShape, patch: Partial<PersistedShape> = {}): void {
  if (typeof localStorage === 'undefined') return;
  const next: PersistedShape = {
    taskPanelOpenByProject: state.taskPanelOpenByProject,
    infoPanelOpenByProject: state.infoPanelOpenByProject,
    infoSectionsOpen: state.infoSectionsOpen,
    clockStrategy: state.clockStrategy,
    groupingStrategy: state.groupingStrategy,
    ...patch,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota or SecurityError — safe to ignore, UI state is recoverable */
  }
}

interface UiState {
  taskPanelOpenByProject: Record<ProjectId, boolean>;
  infoPanelOpenByProject: Record<ProjectId, boolean>;
  infoSectionsOpen: Record<string, boolean>;
  clockStrategy: ClockStrategy;
  groupingStrategy: GroupingStrategy;
  pendingFocusNodeId: NodeId | null;

  setTaskPanelOpen: (projectId: ProjectId, open: boolean) => void;
  setInfoPanelOpen: (projectId: ProjectId, open: boolean) => void;
  setInfoSectionOpen: (sectionId: string, open: boolean) => void;
  setClockStrategy: (strategy: ClockStrategy) => void;
  setGroupingStrategy: (strategy: GroupingStrategy) => void;
  clearPendingFocus: () => void;
  navigateToNode: (graphId: GraphId, nodeId: NodeId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  ...loadPersisted(),
  pendingFocusNodeId: null,

  setTaskPanelOpen: (projectId, open) =>
    set((s) => {
      if (s.taskPanelOpenByProject[projectId] === open) return s;
      const next = { ...s.taskPanelOpenByProject, [projectId]: open };
      savePersisted(s, { taskPanelOpenByProject: next });
      return { taskPanelOpenByProject: next };
    }),

  setInfoPanelOpen: (projectId, open) =>
    set((s) => {
      if (s.infoPanelOpenByProject[projectId] === open) return s;
      const next = { ...s.infoPanelOpenByProject, [projectId]: open };
      savePersisted(s, { infoPanelOpenByProject: next });
      return { infoPanelOpenByProject: next };
    }),

  setInfoSectionOpen: (sectionId, open) =>
    set((s) => {
      if (s.infoSectionsOpen[sectionId] === open) return s;
      const next = { ...s.infoSectionsOpen, [sectionId]: open };
      savePersisted(s, { infoSectionsOpen: next });
      return { infoSectionsOpen: next };
    }),

  setClockStrategy: (strategy) =>
    set((s) => {
      if (s.clockStrategy === strategy) return s;
      savePersisted(s, { clockStrategy: strategy });
      return { clockStrategy: strategy };
    }),

  setGroupingStrategy: (strategy) =>
    set((s) => {
      if (s.groupingStrategy === strategy) return s;
      savePersisted(s, { groupingStrategy: strategy });
      return { groupingStrategy: strategy };
    }),

  clearPendingFocus: () => set({ pendingFocusNodeId: null }),

  navigateToNode: (graphId, nodeId) => {
    useNavigationStore.getState().jumpTo(graphId);
    set({ pendingFocusNodeId: nodeId });
  },
}));

// Exposed for non-reactive reads (e.g. auto-fill dispatch needs current
// strategy without subscribing).
export const getClockStrategy = (): ClockStrategy => useUiStore.getState().clockStrategy;
export const getGroupingStrategy = (): GroupingStrategy =>
  useUiStore.getState().groupingStrategy;
