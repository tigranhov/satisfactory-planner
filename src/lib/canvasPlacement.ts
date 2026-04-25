import type { NodeData } from '@/models/graph';

type NodeKind = NodeData['kind'];

// React Flow's `nodeTypes` map keys 'input' and 'output' both onto 'interface'
// (so the library's built-in light-theme defaults don't render). Translate
// back to NodeKind for size estimation. Width/height are identical for input
// and output, so collapsing them onto 'input' is lossless here.
export function kindFromReactFlowType(type: string | undefined): NodeKind | undefined {
  if (type === 'interface') return 'input';
  return type as NodeKind | undefined;
}

// React Flow stores node `position` as the top-left of the node, but users
// expect new nodes to spawn centered on the cursor. The kind-aware estimates
// below are conservative pre-measure widths so the offset is at least close
// to the eventual layout — once React Flow measures the node it lays out
// from the same position so the visible center may shift slightly. Good
// enough for a UX that prefers "near the cursor" over "exactly centered".
export function estimateNodeWidth(kind: NodeKind | undefined): number {
  if (kind === 'input' || kind === 'output') return 180;
  if (kind === 'hub' || kind === 'splitter' || kind === 'merger') return 200;
  if (kind === 'target') return 220;
  return 260;
}

export function estimateNodeHeight(kind: NodeKind | undefined): number {
  if (kind === 'input' || kind === 'output') return 72;
  if (kind === 'hub' || kind === 'splitter' || kind === 'merger') return 80;
  return 180;
}

export interface FlowPos {
  x: number;
  y: number;
}

export function snapPosition(pos: FlowPos, gridSize: number, enabled: boolean): FlowPos {
  if (!enabled || gridSize <= 0) return pos;
  return {
    x: Math.round(pos.x / gridSize) * gridSize,
    y: Math.round(pos.y / gridSize) * gridSize,
  };
}

export function centerOnCursor(
  cursor: FlowPos,
  kind: NodeKind | undefined,
  gridSize: number,
  snapEnabled: boolean,
): FlowPos {
  const w = estimateNodeWidth(kind);
  const h = estimateNodeHeight(kind);
  return snapPosition({ x: cursor.x - w / 2, y: cursor.y - h / 2 }, gridSize, snapEnabled);
}
