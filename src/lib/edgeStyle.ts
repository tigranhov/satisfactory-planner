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

// Returns [path, labelX, labelY]. React Flow's builders also return offset
// values we don't need; trim to the three the existing edge label rendering
// uses. Sharp-corner step is `getSmoothStepPath` with borderRadius: 0 — there
// is no separate step builder.
export function buildEdgePath(style: EdgeStyle, p: PathParams): [string, number, number] {
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
