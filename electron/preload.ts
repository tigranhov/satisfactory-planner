import { contextBridge, ipcRenderer } from 'electron';

const api = {
  saveProject: (payload: unknown) => ipcRenderer.invoke('project:save', payload),
  loadProject: () => ipcRenderer.invoke('project:load'),
  listRecentProjects: () => ipcRenderer.invoke('project:listRecent'),
  isElectron: true as const,
};

contextBridge.exposeInMainWorld('api', api);

export type PlannerApi = typeof api;
