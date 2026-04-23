import { nanoid } from 'nanoid';

export const newGraphId = () => `g_${nanoid(10)}`;
export const newNodeId = () => `n_${nanoid(10)}`;
export const newEdgeId = () => `e_${nanoid(10)}`;
export const newBlueprintId = () => `bp_${nanoid(10)}`;

export const ROOT_GRAPH_ID = 'g_root';

export const toSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
