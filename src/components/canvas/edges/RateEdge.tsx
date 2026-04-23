import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const rate = (data as { rate?: number } | undefined)?.rate ?? 0;
  const overbudget = (data as { overbudget?: boolean } | undefined)?.overbudget ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={overbudget ? { stroke: '#ef4444' } : undefined}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          className={`rounded border px-1.5 py-0.5 text-[10px] ${
            overbudget
              ? 'border-red-500 bg-panel text-red-400'
              : 'border-border bg-panel text-[#e6e8ee]'
          }`}
        >
          {rate.toFixed(1)}/min
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
