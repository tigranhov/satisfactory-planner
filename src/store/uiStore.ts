import { create } from 'zustand';
import { useNavigationStore } from '@/store/navigationStore';
import type { GraphId, NodeId } from '@/models/graph';
import type { ProjectId } from '@/models/project';

// Transient + per-project UI state. Persisted to localStorage instead of the
// project JSON file so transient bits don't pollute shareable saves.
const STORAGE_KEY = 'sp.uiState.v1';

export type ClockStrategy = 'partial-last' | 'uniform';
export type GroupingStrategy = 'combined' | 'split';
export type GridSize = 10 | 20 | 40;

interface PersistedShape {
  taskPanelOpenByProject: Record<ProjectId, boolean>;
  infoPanelOpenByProject: Record<ProjectId, boolean>;
  infoSectionsOpen: Record<string, boolean>;
  clockStrategy: ClockStrategy;
  groupingStrategy: GroupingStrategy;
  snapToGrid: boolean;
  gridSize: GridSize;
}

const DEFAULT_PERSISTED: PersistedShape = {
  taskPanelOpenByProject: {},
  infoPanelOpenByProject: {},
  infoSectionsOpen: {},
  clockStrategy: 'partial-last',
  groupingStrategy: 'combined',
  snapToGrid: false,
  gridSize: 20,
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
      snapToGrid: parsed.snapToGrid ?? DEFAULT_PERSISTED.snapToGrid,
      gridSize: parsed.gridSize ?? DEFAULT_PERSISTED.gridSize,
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
    snapToGrid: state.snapToGrid,
    gridSize: state.gridSize,
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
  snapToGrid: boolean;
  gridSize: GridSize;
  pendingFocusNodeId: NodeId | null;
  // Modal-open flags live here (not in PersistedShape — per-session) so the
  // global Back/Forward listener can suppress navigation while a modal is up.
  bookOpen: boolean;
  settingsOpen: boolean;

  setTaskPanelOpen: (projectId: ProjectId, open: boolean) => void;
  setInfoPanelOpen: (projectId: ProjectId, open: boolean) => void;
  setInfoSectionOpen: (sectionId: string, open: boolean) => void;
  setClockStrategy: (strategy: ClockStrategy) => void;
  setGroupingStrategy: (strategy: GroupingStrategy) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setGridSize: (size: GridSize) => void;
  setBookOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  clearPendingFocus: () => void;
  navigateToNode: (graphId: GraphId, nodeId: NodeId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  ...loadPersisted(),
  pendingFocusNodeId: null,
  bookOpen: false,
  settingsOpen: false,

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

  setSnapToGrid: (enabled) =>
    set((s) => {
      if (s.snapToGrid === enabled) return s;
      savePersisted(s, { snapToGrid: enabled });
      return { snapToGrid: enabled };
    }),

  setGridSize: (size) =>
    set((s) => {
      if (s.gridSize === size) return s;
      savePersisted(s, { gridSize: size });
      return { gridSize: size };
    }),

  setBookOpen: (open) =>
    set((s) => (s.bookOpen === open ? s : { bookOpen: open })),

  setSettingsOpen: (open) =>
    set((s) => (s.settingsOpen === open ? s : { settingsOpen: open })),

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
export const getSnapToGrid = (): boolean => useUiStore.getState().snapToGrid;
export const getGridSize = (): GridSize => useUiStore.getState().gridSize;
