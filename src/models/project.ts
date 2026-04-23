import type { Graph, GraphId } from './graph';

export type ProjectId = string;

// Lightweight summary kept in the index; the full `graphs` payload lives in
// each project's own JSON file.
export interface ProjectSummary {
  id: ProjectId;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project extends ProjectSummary {
  graphs: Record<GraphId, Graph>;
}

export interface ProjectFileV1 {
  version: 1;
  project: Project;
}

export interface ProjectIndexV1 {
  version: 1;
  activeProjectId: ProjectId | null;
  projects: ProjectSummary[];
}
