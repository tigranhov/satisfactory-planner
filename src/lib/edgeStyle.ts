import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Position,
} from '@xyflow/react';
import type { EdgeStyle } from '@/store/uiStore';

interface PathParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
}

interface BuildOptions {
  // User-set offset from the natural midpoint, in flow coords. The path is
  // routed through midpoint+offset as two sub-paths in the same edge style.
  offset?: { x: number; y: number };
}

// Returns [path, labelX, labelY, midX, midY]. labelX/Y is where the rate
// label renders (waypoint when offset is set, else the natural midpoint).
// midX/Y is always the natural midpoint — callers use it to translate
// absolute anchor positions back to an offset (e.g. ctrl-snap).
export function buildEdgePath(
  style: EdgeStyle,
  p: PathParams,
  options: BuildOptions = {},
): [string, number, number, number, number] {
  const [naturalPath, midX, midY] = singlePath(style, p);
  const offset = options.offset;
  if (!offset) return [naturalPath, midX, midY, midX, midY];
  const wx = midX + offset.x;
  const wy = midY + offset.y;
  const [first] = singlePath(style, { ...p, targetX: wx, targetY: wy });
  const [second] = singlePath(style, { ...p, sourceX: wx, sourceY: wy });
  return [`${first} ${second}`, wx, wy, midX, midY];
}

function singlePath(style: EdgeStyle, p: PathParams): [string, number, number] {
  switch (style) {
    case 'straight': {
      const [path, lx, ly] = getStraightPath({
        sourceX: p.sourceX,
        sourceY: p.sourceY,
        targetX: p.targetX,
        targetY: p.targetY,
      });
      return [path, lx, ly];
    }
    case 'step': {
      const [path, lx, ly] = getSmoothStepPath({ ...p, borderRadius: 0 });
      return [path, lx, ly];
    }
    case 'smoothstep': {
      const [path, lx, ly] = getSmoothStepPath(p);
      return [path, lx, ly];
    }
    case 'bezier':
    default: {
      const [path, lx, ly] = getBezierPath(p);
      return [path, lx, ly];
    }
  }
}
