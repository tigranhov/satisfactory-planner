import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { FLOW_EPS, type RateEdgeData } from '@/models/flow';
import { useUiStore } from '@/store/uiStore';
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
  const [edgePath, labelX, labelY] = buildEdgePath(edgeStyle, {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const d = data as RateEdgeData | undefined;
  const { stroke, labelClass } = EDGE_STYLES[classify(d)];
  const rate = d?.rate ?? 0;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={stroke ? { stroke } : undefined} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className={`rounded border px-1.5 py-0.5 text-[10px] ${labelClass}`}
        >
          {rate.toFixed(1)}/min
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
