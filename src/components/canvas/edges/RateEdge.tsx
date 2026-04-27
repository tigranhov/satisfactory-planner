import { useCallback, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { FLOW_EPS, type RateEdgeData } from '@/models/flow';
import { useUiStore } from '@/store/uiStore';
import { useGraphStore } from '@/store/graphStore';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import {
  beginHistoryTransaction,
  commitHistoryTransaction,
  abortHistoryTransaction,
} from '@/store/historyStore';
import { buildEdgePath } from '@/lib/edgeStyle';

type EdgeState = 'idle' | 'short' | 'exact' | 'surplus';

const EDGE_STYLES: Record<EdgeState, { stroke?: string; labelClass: string }> = {
  idle: { labelClass: 'border-border bg-panel text-[#e6e8ee]' },
  short: { stroke: '#f97316', labelClass: 'border-orange-500 bg-panel text-orange-400' },
  exact: { stroke: '#22c55e', labelClass: 'border-green-500 bg-panel text-green-400' },
  surplus: { stroke: '#3b82f6', labelClass: 'border-blue-500 bg-panel text-blue-400' },
};

function classify(data: RateEdgeData | undefined): EdgeState {
  const rate = data?.rate ?? 0;
  if (rate <= FLOW_EPS) return 'idle';
  if ((data?.satisfaction ?? 1) < 1 - FLOW_EPS) return 'short';
  if (Math.abs((data?.sourceUtilization ?? 0) - 1) < FLOW_EPS) return 'exact';
  return 'surplus';
}

export default function RateEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeStyle = useUiStore((s) => s.edgeStyle);
  const activeGraphId = useActiveGraphId();
  const setEdgeLabelOffset = useGraphStore((s) => s.setEdgeLabelOffset);
  const { screenToFlowPosition } = useReactFlow();

  const d = data as RateEdgeData | undefined;
  const persistedOffset = d?.labelOffset;

  // Drag-time offset is held in state for re-render and mirrored to a ref so
  // pointerup can read the latest value without a stale-closure dance.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startFlow: { x: number; y: number };
    startOffset: { x: number; y: number };
    moved: boolean;
    latestOffset: { x: number; y: number };
  } | null>(null);

  const activeOffset = dragOffset ?? persistedOffset;
  const [edgePath, labelX, labelY, , midY] = buildEdgePath(
    edgeStyle,
    { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition },
    { offset: activeOffset },
  );

  const { stroke, labelClass } = EDGE_STYLES[classify(d)];
  const rate = d?.rate ?? 0;

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Right-click must fall through to the edge context menu.
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const startOffset = persistedOffset ? { ...persistedOffset } : { x: 0, y: 0 };
      dragRef.current = {
        startFlow,
        startOffset,
        moved: false,
        latestOffset: startOffset,
      };
      setDragOffset(startOffset);
      setIsDragging(true);
      beginHistoryTransaction();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [persistedOffset, screenToFlowPosition],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const cur = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const dx = cur.x - drag.startFlow.x;
      const dy = cur.y - drag.startFlow.y;
      const next = { x: drag.startOffset.x + dx, y: drag.startOffset.y + dy };
      // Ctrl/Cmd locks Y to whichever endpoint handle is closer to the cursor,
      // mirroring the node align-drag in src/lib/alignDrag.ts.
      if (e.ctrlKey || e.metaKey) {
        const anchorY =
          Math.abs(sourceY - cur.y) <= Math.abs(targetY - cur.y) ? sourceY : targetY;
        next.y = anchorY - midY;
      }
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;
      drag.latestOffset = next;
      setDragOffset(next);
    },
    [midY, screenToFlowPosition, sourceY, targetY],
  );

  const finishDrag = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragOffset(null);
      setIsDragging(false);
      if (!drag) return;
      if (commit && drag.moved) {
        setEdgeLabelOffset(activeGraphId, id, drag.latestOffset);
        commitHistoryTransaction();
      } else {
        abortHistoryTransaction();
      }
    },
    [activeGraphId, id, setEdgeLabelOffset],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      e.stopPropagation();
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      finishDrag(true);
    },
    [finishDrag],
  );

  const onPointerCancel = useCallback(() => {
    if (!dragRef.current) return;
    finishDrag(false);
  }, [finishDrag]);

  // Double-click clears the offset so users can recover from an accidental drag.
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!persistedOffset) return;
      e.stopPropagation();
      beginHistoryTransaction();
      setEdgeLabelOffset(activeGraphId, id, undefined);
      commitHistoryTransaction();
    },
    [activeGraphId, id, persistedOffset, setEdgeLabelOffset],
  );

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={stroke ? { stroke } : undefined} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
          className={`rounded border px-1.5 py-0.5 text-[10px] ${labelClass}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          title="Drag to reroute. Double-click to reset."
        >
          {rate.toFixed(1)}/min
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
