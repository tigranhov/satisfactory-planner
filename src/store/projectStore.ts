import { create } from 'zustand';
import { newProjectId } from '@/lib/ids';
import type { ProjectId, ProjectSummary } from '@/models/project';

interface ProjectState {
  projects: Record<ProjectId, ProjectSummary>;
  activeProjectId: ProjectId | null;
  loaded: boolean;

  hydrate: (payload: { projects: ProjectSummary[]; activeProjectId: ProjectId | null }) => void;

  createProject: (name: string) => ProjectId;
  renameProject: (id: ProjectId, name: string) => void;
  removeProject: (id: ProjectId) => void;
  touchProject: (id: ProjectId) => void;
  setActiveProject: (id: ProjectId | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: {},
  activeProjectId: null,
  loaded: false,

  hydrate: ({ projects, activeProjectId }) =>
    set(() => ({
      projects: Object.fromEntries(projects.map((p) => [p.id, p])),
      activeProjectId,
      loaded: true,
    })),

  createProject: (name) => {
    const id = newProjectId();
    const now = Date.now();
    const summary: ProjectSummary = { id, name, createdAt: now, updatedAt: now };
    set((s) => ({ projects: { ...s.projects, [id]: summary } }));
    return id;
  },

  renameProject: (id, name) =>
    set((s) => {
      const existing = s.projects[id];
      if (!existing || existing.name === name) return s;
      return {
        projects: {
          ...s.projects,
          [id]: { ...existing, name, updatedAt: Date.now() },
        },
      };
    }),

  removeProject: (id) =>
    set((s) => {
      if (!(id in s.projects)) return s;
      const next = { ...s.projects };
      delete next[id];
      const activeProjectId = s.activeProjectId === id ? null : s.activeProjectId;
      return { projects: next, activeProjectId };
    }),

  touchProject: (id) =>
    set((s) => {
      const existing = s.projects[id];
      if (!existing) return s;
      return {
        projects: {
          ...s.projects,
          [id]: { ...existing, updatedAt: Date.now() },
        },
      };
    }),

  setActiveProject: (id) =>
    set((s) => (s.activeProjectId === id ? s : { activeProjectId: id })),
}));
