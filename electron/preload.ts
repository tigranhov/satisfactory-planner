import { contextBridge, ipcRenderer } from 'electron';
import type { Blueprint } from '../src/models/blueprint';

const api = {
  saveProject: (payload: unknown) => ipcRenderer.invoke('project:save', payload),
  loadProject: () => ipcRenderer.invoke('project:load'),
  listRecentProjects: () => ipcRenderer.invoke('project:listRecent'),
  loadBlueprints: () =>
    ipcRenderer.invoke('blueprints:load') as Promise<Blueprint[]>,
  saveBlueprints: (blueprints: Blueprint[]) =>
    ipcRenderer.invoke('blueprints:save', blueprints) as Promise<void>,
  isElectron: true as const,
};

contextBridge.exposeInMainWorld('api', api);

export type PlannerApi = typeof api;
