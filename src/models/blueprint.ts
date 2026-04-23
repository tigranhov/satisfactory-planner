import type { ItemId } from '@/data/types';
import type { GraphEdge, GraphNode } from './graph';

export type BlueprintId = string;

export interface Blueprint {
  id: BlueprintId;
  name: string;
  description?: string;
  tags?: string[];
  // Explicit override; else derived at read-time from the first Output node's itemId.
  iconItemId?: ItemId;
  nodes: GraphNode[];
  edges: GraphEdge[];
  createdAt: number;
  updatedAt: number;
}

export interface BlueprintFileV1 {
  version: 1;
  blueprints: Blueprint[];
}
