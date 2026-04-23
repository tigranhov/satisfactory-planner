import { useGraphStore } from '@/store/graphStore';
import { useProjectStore } from '@/store/projectStore';
import { useNavigationStore } from '@/store/navigationStore';
import { ROOT_GRAPH_ID } from '@/lib/ids';
import type { Graph, GraphId } from '@/models/graph';
import type { ProjectId, ProjectIndexV1, ProjectSummary } from '@/models/project';

const DEBOUNCE_MS = 300;

function emptyRoot(): Graph {
  return { id: ROOT_GRAPH_ID, name: 'Root', nodes: [], edges: [] };
}

// IPC errors are swallowed so a stale Electron main can't block UI state
// mutations; errors still surface in the console for diagnosis.
async function writeIndex(): Promise<void> {
  const api = window.api;
  if (!api?.isElectron) return;
  const { projects, activeProjectId } = useProjectStore.getState();
  const index: ProjectIndexV1 = {
    version: 1,
    activeProjectId,
    projects: Object.values(projects),
  };
  try {
    await api.saveProjectIndex(index);
  } catch (err) {
    console.error('[projects] index save failed', err);
  }
}

async function writeActiveProject(): Promise<void> {
  const api = window.api;
  if (!api?.isElectron) return;
  const { activeProjectId, projects } = useProjectStore.getState();
  if (!activeProjectId) return;
  const summary = projects[activeProjectId];
  if (!summary) return;
  const graphs = useGraphStore.getState().graphs;
  try {
    await api.saveProject(activeProjectId, {
      version: 1,
      project: { ...summary, graphs },
    });
  } catch (err) {
    console.error('[projects] project save failed', err);
  }
}

// Tracks the debounced save state so explicit operations (switch, bootstrap)
// can prime the snapshot and prevent a "save back what we just loaded" tick.
interface AutosaveRef {
  lastSnapshot: Record<GraphId, Graph> | null;
  timer: ReturnType<typeof setTimeout> | null;
}
let autosaveRef: AutosaveRef | null = null;

function primeAutosaveSnapshot() {
  if (!autosaveRef) return;
  autosaveRef.lastSnapshot = useGraphStore.getState().graphs;
  if (autosaveRef.timer) {
    clearTimeout(autosaveRef.timer);
    autosaveRef.timer = null;
  }
}

export async function loadProjectBootstrap(): Promise<void> {
  const api = window.api;
  if (!api?.isElectron) {
    const id = seedFirstRunProject();
    useProjectStore.getState().setActiveProject(id);
    return;
  }

  const index = await safeLoadIndex();
  if (!index || index.projects.length === 0) {
    await bootstrapFirstRun();
    return;
  }

  const activeId = index.activeProjectId ?? index.projects[0]?.id ?? null;
  useProjectStore.getState().hydrate({
    projects: index.projects,
    activeProjectId: activeId,
  });
  if (activeId) {
    const file = await api.loadProject(activeId);
    if (file?.project.graphs) {
      useGraphStore.getState().replaceGraphs(file.project.graphs);
      useNavigationStore.getState().reset();
    }
  }
}

async function bootstrapFirstRun(): Promise<void> {
  const id = seedFirstRunProject();
  useProjectStore.getState().hydrate({
    projects: [useProjectStore.getState().projects[id]],
    activeProjectId: id,
  });
  await Promise.all([writeActiveProject(), writeIndex()]);
}

async function safeLoadIndex(): Promise<ProjectIndexV1 | null> {
  try {
    return await window.api!.loadProjectIndex();
  } catch (err) {
    console.error('[projects] load index failed', err);
    return null;
  }
}

function seedFirstRunProject(): ProjectId {
  useGraphStore.getState().replaceGraphs({ [ROOT_GRAPH_ID]: emptyRoot() });
  useNavigationStore.getState().reset();
  return useProjectStore.getState().createProject('Untitled');
}

export function subscribeProjectAutosave(): () => void {
  const api = window.api;
  if (!api?.isElectron) return () => {};

  const ref: AutosaveRef = { lastSnapshot: null, timer: null };
  autosaveRef = ref;

  const unsubscribe = useGraphStore.subscribe((state) => {
    const { activeProjectId, loaded } = useProjectStore.getState();
    if (!loaded || !activeProjectId) return;
    if (state.graphs === ref.lastSnapshot) return;
    ref.lastSnapshot = state.graphs;
    if (ref.timer) clearTimeout(ref.timer);
    ref.timer = setTimeout(() => {
      ref.timer = null;
      void writeActiveProject();
    }, DEBOUNCE_MS);
  });

  return () => {
    if (ref.timer) clearTimeout(ref.timer);
    if (autosaveRef === ref) autosaveRef = null;
    unsubscribe();
  };
}

export async function renameActiveProjectPersistent(id: ProjectId, name: string): Promise<void> {
  useProjectStore.getState().renameProject(id, name);
  await Promise.all([writeIndex(), writeActiveProject()]);
}

export async function createProjectPersistent(name: string): Promise<ProjectId> {
  await flushActiveProjectNow();
  const id = useProjectStore.getState().createProject(name);
  useProjectStore.getState().setActiveProject(id);
  useGraphStore.getState().replaceGraphs({ [ROOT_GRAPH_ID]: emptyRoot() });
  useNavigationStore.getState().reset();
  primeAutosaveSnapshot();
  await Promise.all([writeActiveProject(), writeIndex()]);
  return id;
}

export async function switchProjectPersistent(id: ProjectId): Promise<void> {
  const { activeProjectId, projects } = useProjectStore.getState();
  if (id === activeProjectId) return;
  if (!projects[id]) return;
  await flushActiveProjectNow();
  useProjectStore.getState().setActiveProject(id);
  const api = window.api;
  const nextGraphs =
    api?.isElectron
      ? (await api.loadProject(id))?.project.graphs ?? { [ROOT_GRAPH_ID]: emptyRoot() }
      : { [ROOT_GRAPH_ID]: emptyRoot() };
  useGraphStore.getState().replaceGraphs(nextGraphs);
  useNavigationStore.getState().reset();
  primeAutosaveSnapshot();
  await writeIndex();
}

export async function deleteProjectPersistent(id: ProjectId): Promise<void> {
  const api = window.api;
  const { activeProjectId, projects } = useProjectStore.getState();
  const remaining = Object.values(projects).filter((p: ProjectSummary) => p.id !== id);
  useProjectStore.getState().removeProject(id);
  if (api?.isElectron) {
    await api.deleteProject(id).catch((err) => console.error('[projects] delete failed', err));
  }
  if (activeProjectId === id) {
    const fallback = remaining[0]?.id;
    if (fallback) {
      await switchProjectPersistent(fallback);
      return;
    }
    await createProjectPersistent('Untitled');
    return;
  }
  await writeIndex();
}

export async function flushActiveProjectNow(): Promise<void> {
  const api = window.api;
  if (!api?.isElectron) return;
  await writeActiveProject();
}
