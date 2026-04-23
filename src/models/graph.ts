import type { ItemId, RecipeId } from '@/data/types';

export type GraphId = string;
export type NodeId = string;
export type EdgeId = string;

export type NodeKind = 'recipe' | 'factory' | 'input' | 'output' | 'blueprint';

export interface RecipeNodeData {
  kind: 'recipe';
  recipeId: RecipeId;
  clockSpeed: number; // 0.01 - 2.5 (1.0 = 100%)
  count: number;
  somersloops: number; // 0..machine.somersloopSlots
}

export interface FactoryNodeData {
  kind: 'factory';
  factoryGraphId: GraphId;
  label: string;
}

export interface InterfaceNodeData {
  kind: 'input' | 'output';
  itemId: ItemId;
  label?: string;
}

// `blueprintId` is a BlueprintId (defined in models/blueprint.ts) but kept as
// a plain string here to avoid a graph.ts ↔ blueprint.ts import cycle.
export interface BlueprintNodeData {
  kind: 'blueprint';
  blueprintId: string;
  count: number;
}

export type NodeData =
  | RecipeNodeData
  | FactoryNodeData
  | InterfaceNodeData
  | BlueprintNodeData;

export interface GraphNode {
  id: NodeId;
  position: { x: number; y: number };
  data: NodeData;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  sourceHandle: string;
  target: NodeId;
  targetHandle: string;
  itemId: ItemId;
  rate: number; // items/min, computed
}

export interface Graph {
  id: GraphId;
  name: string;
  parentNodeId?: NodeId;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
