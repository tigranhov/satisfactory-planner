import { create } from 'zustand';
import { useNavigationStore } from '@/store/navigationStore';
import type { GraphId, NodeId } from '@/models/graph';
import type { ProjectId } from '@/models/project';

// Persisted via the same IPC + filesystem pattern as projects/blueprints
// (`window.api.saveUiState` → `userData/ui-state.json`). Falls back to
// localStorage for the web build (when window.api is undefined).
//
// History: this used to live entirely in localStorage, but Chromium's
// leveldb-backed localStorage silently fails when the userData directory
// is locked (stale Electron process, double-launched dev server, AV).
// Switching to fs.writeFile via IPC removes the failure mode.
const STORAGE_KEY = 'sp.uiState.v1';
const SAVE_DEBOUNCE_MS = 250;

export type ClockStrategy = 'partial-last' | 'uniform';
export type GroupingStrategy = 'combined' | 'split';
export type GridSize = 10 | 20 | 40;
export type EdgeStyle = 'bezier' | 'straight' | 'step' | 'smoothstep';

export interface PersistedUiShape {
  taskPanelOpenByProject: Record<ProjectId, boolean>;
  infoPanelOpenByProject: Record<ProjectId, boolean>;
  infoSectionsOpen: Record<string, boolean>;
  clockStrategy: ClockStrategy;
  groupingStrategy: GroupingStrategy;
  snapToGrid: boolean;
  gridSize: GridSize;
  edgeStyle: EdgeStyle;
}

const DEFAULT_PERSISTED: PersistedUiShape = {
  taskPanelOpenByProject: {},
  infoPanelOpenByProject: {},
  infoSectionsOpen: {},
  clockStrategy: 'partial-last',
  groupingStrategy: 'combined',
  snapToGrid: false,
  gridSize: 20,
  edgeStyle: 'bezier',
};

function mergeWithDefaults(parsed: Partial<PersistedUiShape>): PersistedUiShape {
  return {
    taskPanelOpenByProject: parsed.taskPanelOpenByProject ?? {},
    infoPanelOpenByProject: parsed.infoPanelOpenByProject ?? {},
    infoSectionsOpen: parsed.infoSectionsOpen ?? {},
    clockStrategy: parsed.clockStrategy ?? DEFAULT_PERSISTED.clockStrategy,
    groupingStrategy: parsed.groupingStrategy ?? DEFAULT_PERSISTED.groupingStrategy,
    snapToGrid: parsed.snapToGrid ?? DEFAULT_PERSISTED.snapToGrid,
    gridSize: parsed.gridSize ?? DEFAULT_PERSISTED.gridSize,
    edgeStyle: parsed.edgeStyle ?? DEFAULT_PERSISTED.edgeStyle,
  };
}

function readLocalStorage(): PersistedUiShape | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeWithDefaults(JSON.parse(raw) as Partial<PersistedUiShape>);
  } catch {
    return null;
  }
}

function writeLocalStorage(state: PersistedUiShape): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / SecurityError — recoverable */
  }
}

function clearLocalStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface UiState extends PersistedUiShape {
  pendingFocusNodeId: NodeId | null;
  // Modal-open flags live here (not in PersistedUiShape — per-session) so the
  // global Back/Forward listener can suppress navigation while a modal is up.
  bookOpen: boolean;
  settingsOpen: boolean;
  calculatorOpen: boolean;

  setTaskPanelOpen: (projectId: ProjectId, open: boolean) => void;
  setInfoPanelOpen: (projectId: ProjectId, open: boolean) => void;
  setInfoSectionOpen: (sectionId: string, open: boolean) => void;
  setClockStrategy: (strategy: ClockStrategy) => void;
  setGroupingStrategy: (strategy: GroupingStrategy) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setGridSize: (size: GridSize) => void;
  setEdgeStyle: (style: EdgeStyle) => void;
  setBookOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCalculatorOpen: (open: boolean) => void;
  clearPendingFocus: () => void;
  navigateToNode: (graphId: GraphId, nodeId: NodeId) => void;
}

function extractPersisted(s: UiState): PersistedUiShape {
  return {
    taskPanelOpenByProject: s.taskPanelOpenByProject,
    infoPanelOpenByProject: s.infoPanelOpenByProject,
    infoSectionsOpen: s.infoSectionsOpen,
    clockStrategy: s.clockStrategy,
    groupingStrategy: s.groupingStrategy,
    snapToGrid: s.snapToGrid,
    gridSize: s.gridSize,
    edgeStyle: s.edgeStyle,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Set true on the first user-initiated change; an in-flight load that
// completes after a user change must NOT overwrite the user's edit.
let userDirtied = false;

function schedulePersist(): void {
  userDirtied = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, SAVE_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  const state = extractPersisted(useUiStore.getState());
  const api = typeof window !== 'undefined' ? window.api : undefined;
  if (api) {
    try {
      await api.saveUiState(state);
    } catch (err) {
      console.error('[uiState save]', err);
    }
  } else {
    writeLocalStorage(state);
  }
}

export const useUiStore = create<UiState>((set) => ({
  ...DEFAULT_PERSISTED,
  pendingFocusNodeId: null,
  bookOpen: false,
  settingsOpen: false,
  calculatorOpen: false,

  setTaskPanelOpen: (projectId, open) =>
    set((s) => {
      if (s.taskPanelOpenByProject[projectId] === open) return s;
      schedulePersist();
      return {
        taskPanelOpenByProject: { ...s.taskPanelOpenByProject, [projectId]: open },
      };
    }),

  setInfoPanelOpen: (projectId, open) =>
    set((s) => {
      if (s.infoPanelOpenByProject[projectId] === open) return s;
      schedulePersist();
      return {
        infoPanelOpenByProject: { ...s.infoPanelOpenByProject, [projectId]: open },
      };
    }),

  setInfoSectionOpen: (sectionId, open) =>
    set((s) => {
      if (s.infoSectionsOpen[sectionId] === open) return s;
      schedulePersist();
      return {
        infoSectionsOpen: { ...s.infoSectionsOpen, [sectionId]: open },
      };
    }),

  setClockStrategy: (strategy) =>
    set((s) => {
      if (s.clockStrategy === strategy) return s;
      schedulePersist();
      return { clockStrategy: strategy };
    }),

  setGroupingStrategy: (strategy) =>
    set((s) => {
      if (s.groupingStrategy === strategy) return s;
      schedulePersist();
      return { groupingStrategy: strategy };
    }),

  setSnapToGrid: (enabled) =>
    set((s) => {
      if (s.snapToGrid === enabled) return s;
      schedulePersist();
      return { snapToGrid: enabled };
    }),

  setGridSize: (size) =>
    set((s) => {
      if (s.gridSize === size) return s;
      schedulePersist();
      return { gridSize: size };
    }),

  setEdgeStyle: (style) =>
    set((s) => {
      if (s.edgeStyle === style) return s;
      schedulePersist();
      return { edgeStyle: style };
    }),

  setBookOpen: (open) =>
    set((s) => (s.bookOpen === open ? s : { bookOpen: open })),

  setSettingsOpen: (open) =>
    set((s) => (s.settingsOpen === open ? s : { settingsOpen: open })),

  setCalculatorOpen: (open) =>
    set((s) => (s.calculatorOpen === open ? s : { calculatorOpen: open })),

  clearPendingFocus: () => set({ pendingFocusNodeId: null }),

  navigateToNode: (graphId, nodeId) => {
    useNavigationStore.getState().jumpTo(graphId);
    set({ pendingFocusNodeId: nodeId });
  },
}));

async function initLoad(): Promise<void> {
  const api = typeof window !== 'undefined' ? window.api : undefined;
  if (!api) {
    if (userDirtied) return;
    const fromLs = readLocalStorage();
    if (fromLs) useUiStore.setState(fromLs);
    return;
  }

  try {
    const loaded = await api.loadUiState();
    if (userDirtied) return;
    if (loaded) {
      useUiStore.setState(mergeWithDefaults(loaded));
      return;
    }
    // No file yet — migrate from legacy localStorage if present.
    const fromLs = readLocalStorage();
    if (!fromLs) return;
    useUiStore.setState(fromLs);
    try {
      await api.saveUiState(fromLs);
      clearLocalStorage();
    } catch (err) {
      console.error('[uiState migrate]', err);
    }
  } catch (err) {
    console.error('[uiState load]', err);
  }
}

void initLoad();

// Flush a pending debounced save before the window closes — without this, a
// setting toggled within SAVE_DEBOUNCE_MS of quitting would be dropped.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    void persistNow();
  });
}

export const getClockStrategy = (): ClockStrategy => useUiStore.getState().clockStrategy;
export const getGroupingStrategy = (): GroupingStrategy =>
  useUiStore.getState().groupingStrategy;
export const getSnapToGrid = (): boolean => useUiStore.getState().snapToGrid;
export const getGridSize = (): GridSize => useUiStore.getState().gridSize;
export const getEdgeStyle = (): EdgeStyle => useUiStore.getState().edgeStyle;
