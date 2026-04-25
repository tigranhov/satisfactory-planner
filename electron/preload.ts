import { contextBridge, ipcRenderer } from 'electron';
import type { Blueprint } from '../src/models/blueprint';
import type { ProjectFileV1, ProjectIndexV1 } from '../src/models/project';
import type { PersistedUiShape } from '../src/store/uiStore';
import type { UpdaterStatus } from './updater';

const api = {
  loadProjectIndex: () =>
    ipcRenderer.invoke('projects:loadIndex') as Promise<ProjectIndexV1 | null>,
  saveProjectIndex: (index: ProjectIndexV1) =>
    ipcRenderer.invoke('projects:saveIndex', index) as Promise<void>,
  loadProject: (id: string) =>
    ipcRenderer.invoke('projects:loadProject', id) as Promise<ProjectFileV1 | null>,
  saveProject: (id: string, payload: ProjectFileV1) =>
    ipcRenderer.invoke('projects:saveProject', id, payload) as Promise<void>,
  deleteProject: (id: string) =>
    ipcRenderer.invoke('projects:deleteProject', id) as Promise<void>,

  loadBlueprints: () =>
    ipcRenderer.invoke('blueprints:load') as Promise<Blueprint[]>,
  saveBlueprints: (blueprints: Blueprint[]) =>
    ipcRenderer.invoke('blueprints:save', blueprints) as Promise<void>,

  loadUiState: () =>
    ipcRenderer.invoke('uiState:load') as Promise<PersistedUiShape | null>,
  saveUiState: (state: PersistedUiShape) =>
    ipcRenderer.invoke('uiState:save', state) as Promise<void>,

  getUpdaterStatus: () =>
    ipcRenderer.invoke('updater:getStatus') as Promise<UpdaterStatus>,
  checkForUpdates: () =>
    ipcRenderer.invoke('updater:check') as Promise<UpdaterStatus>,
  quitAndInstallUpdate: () =>
    ipcRenderer.invoke('updater:quitAndInstall') as Promise<void>,
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void) => {
    const listener = (_event: unknown, status: UpdaterStatus) => cb(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.off('updater:status', listener);
  },

  isElectron: true as const,
};

contextBridge.exposeInMainWorld('api', api);

export type PlannerApi = typeof api;
