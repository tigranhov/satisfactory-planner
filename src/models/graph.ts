import type { ItemId, RecipeId } from '@/data/types';

export type GraphId = string;
export type NodeId = string;
export type EdgeId = string;

export type NodeKind =
  | 'recipe'
  | 'factory'
  | 'input'
  | 'output'
  | 'blueprint'
  | 'hub'
  | 'splitter'
  | 'merger';

// Task tracking: `planned` = user intends to build, `built` = built in-game.
// Absent on every node by default; existing saves load with `undefined`.
export type NodeStatus = 'planned' | 'built';

interface BaseNodeData {
  status?: NodeStatus;
  taskNote?: string;
}

export interface RecipeNodeData extends BaseNodeData {
  kind: 'recipe';
  recipeId: RecipeId;
  clockSpeed: number; // 0.01 - 2.5 (1.0 = 100%)
  count: number;
  somersloops: number; // 0..machine.somersloopSlots
}

export interface FactoryNodeData extends BaseNodeData {
  kind: 'factory';
  factoryGraphId: GraphId;
  label: string;
}

// Input/Output boundary nodes start itemless (like hub-likes) and commit
// to a specific item the first time they're connected. Once committed,
// `itemId` is persisted so handle ids stay stable and the subgraph surface
// can expose them as typed ports.
export interface InterfaceNodeData extends BaseNodeData {
  kind: 'input' | 'output';
  itemId?: ItemId;
  label?: string;
}

// `blueprintId` is a BlueprintId (defined in models/blueprint.ts) but kept as
// a plain string here to avoid a graph.ts ↔ blueprint.ts import cycle.
export interface BlueprintNodeData extends BaseNodeData {
  kind: 'blueprint';
  blueprintId: string;
  count: number;
}

// Hub-like passthroughs (hub, splitter, merger) are itemless in their stored
// form — the item they carry is derived from incident edges at render/connect
// time. A disconnected hub-like is an "unset" node and displays as a `?`.
// See hublikeItemFromEdges.
export interface HubNodeData extends BaseNodeData {
  kind: 'hub';
  label?: string;
}

export interface SplitterNodeData extends BaseNodeData {
  kind: 'splitter';
  label?: string;
}

export interface MergerNodeData extends BaseNodeData {
  kind: 'merger';
  label?: string;
}

export type NodeData =
  | RecipeNodeData
  | FactoryNodeData
  | InterfaceNodeData
  | BlueprintNodeData
  | HubNodeData
  | SplitterNodeData
  | MergerNodeData;

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
