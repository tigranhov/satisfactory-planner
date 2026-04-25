import { memo, useEffect, useState } from 'react';
import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { CheckCircle2, HelpCircle, Target } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import { handleIdForTarget } from '@/models/factory';
import { useGraphStore } from '@/store/graphStore';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import { statusBorderClass } from '@/lib/nodeStatus';
import { formatDuration } from '@/lib/format';
import type { TargetNodeData } from '@/models/graph';
import type { RateEdgeData } from '@/models/flow';

const gameData = loadGameData();

function TargetNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TargetNodeData;
  const item = nodeData.targetItemId ? gameData.items[nodeData.targetItemId] : undefined;
  const committed = !!nodeData.targetItemId;

  const activeGraphId = useActiveGraphId();
  const updateNode = useGraphStore((s) => s.updateNode);
  const edges = useEdges();

  const [draft, setDraft] = useState(String(nodeData.targetCount));
  useEffect(() => setDraft(String(nodeData.targetCount)), [nodeData.targetCount]);

  let inflowRate = 0;
  for (const e of edges) {
    if (e.target !== id) continue;
    const eData = e.data as RateEdgeData | undefined;
    inflowRate += eData?.rate ?? 0;
  }

  const eta = nodeData.targetCount > 0 && inflowRate > 0
    ? formatDuration(nodeData.targetCount / inflowRate)
    : '—';

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(nodeData.targetCount));
      return;
    }
    const next = Math.floor(parsed);
    if (next === nodeData.targetCount) return;
    updateNode(activeGraphId, id, { data: { ...nodeData, targetCount: next } });
  };

  const borderActive = committed ? 'border-emerald-500/60' : 'border-[#4a5068]';
  const borderClass = statusBorderClass(nodeData.status, !!selected, borderActive);

  return (
    <div
      className={`flex min-w-[200px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${borderClass}`}
    >
      <Target
        className={`h-3.5 w-3.5 shrink-0 ${committed ? 'text-emerald-400' : 'text-[#6b7388]'}`}
      />
      {item ? (
        <IconOrLabel iconBasename={item.icon} name={item.name} />
      ) : (
        <HelpCircle className="h-5 w-5 shrink-0 text-[#6b7388]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <input
            type="number"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraft(String(nodeData.targetCount));
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="nodrag w-20 rounded border border-border bg-panel-hi px-1 py-0.5 text-xs tabular-nums text-[#e6e8ee] outline-none focus:border-accent"
          />
          <span className="truncate text-xs text-[#9aa2b8]">
            {item?.name ?? (committed ? '' : 'Target')}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          {committed ? `ETA ${eta}` : 'Connect to set type'}
        </div>
      </div>
      {nodeData.status === 'built' && (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      )}
      <Handle
        id={handleIdForTarget(nodeData.targetItemId)}
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-panel !bg-accent"
      />
    </div>
  );
}

export default memo(TargetNode);
