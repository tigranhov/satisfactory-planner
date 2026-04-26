import { memo } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { CheckCircle2, HelpCircle, Trash2 } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import { handleIdForSink } from '@/models/factory';
import { statusBorderClass } from '@/lib/nodeStatus';
import type { SinkNodeData } from '@/models/graph';
import type { RateEdgeData } from '@/models/flow';

const gameData = loadGameData();

function SinkNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as SinkNodeData;
  const item = nodeData.sinkItemId ? gameData.items[nodeData.sinkItemId] : undefined;
  const committed = !!nodeData.sinkItemId;

  const edges = useEdges();

  let inflowRate = 0;
  for (const e of edges) {
    if (e.target !== id) continue;
    const eData = e.data as RateEdgeData | undefined;
    inflowRate += eData?.rate ?? 0;
  }

  const points = item?.sinkPoints ?? 0;
  const ptsPerMin = inflowRate > 0 && points > 0 ? Math.round(inflowRate * points) : null;

  const borderActive = committed ? 'border-cyan-500/60' : 'border-[#4a5068]';
  const borderClass = statusBorderClass(nodeData.status, !!selected, borderActive);

  return (
    <div
      className={`flex min-w-[200px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${borderClass}`}
    >
      <Trash2
        className={`h-3.5 w-3.5 shrink-0 ${committed ? 'text-cyan-300' : 'text-[#6b7388]'}`}
      />
      {item ? (
        <IconOrLabel iconBasename={item.icon} name={item.name} />
      ) : (
        <HelpCircle className="h-5 w-5 shrink-0 text-[#6b7388]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-[#9aa2b8]">
          {item?.name ?? 'Sink'}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          {!committed
            ? 'Connect to set type'
            : ptsPerMin == null
              ? points <= 0
                ? 'No sink value'
                : '— pts/min'
              : `${ptsPerMin.toLocaleString()} pts/min`}
        </div>
      </div>
      {nodeData.status === 'built' && (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      )}
      <Handle
        id={handleIdForSink()}
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-panel !bg-accent"
      />
    </div>
  );
}

export default memo(SinkNode);
