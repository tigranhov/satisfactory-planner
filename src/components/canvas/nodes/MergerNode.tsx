import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Merge } from 'lucide-react';
import { MERGER_IN_HANDLES, MERGER_OUT_HANDLE } from '@/models/factory';
import type { HandleFlow } from '@/models/flow';
import type { MergerNodeData } from '@/models/graph';
import HubLikeCard from './HubLikeCard';
import { HANDLE_STRIP_TOPS } from './handleStrip';

interface MergerRenderData extends MergerNodeData {
  currentItemId?: string | null;
  handleFlows?: Record<string, HandleFlow>;
}

function Handles() {
  return (
    <>
      {MERGER_IN_HANDLES.map((id, i) => (
        <Handle
          key={id}
          id={id}
          type="target"
          position={Position.Left}
          style={{ top: HANDLE_STRIP_TOPS[i] }}
          className="!h-3 !w-3 !border-2 !border-panel !bg-cyan-400"
        />
      ))}
      <Handle
        id={MERGER_OUT_HANDLE}
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-panel !bg-cyan-400"
      />
    </>
  );
}

function MergerNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MergerRenderData;
  const itemId = nodeData.currentItemId ?? null;
  const throughput = MERGER_IN_HANDLES.reduce(
    (sum, hid) => sum + (nodeData.handleFlows?.[hid]?.supply ?? 0),
    0,
  );

  return (
    <HubLikeCard
      selected={!!selected}
      itemId={itemId}
      kindIcon={Merge}
      activeBorderClass="border-cyan-500/60"
      activeIconClass="text-cyan-300"
      label={nodeData.label}
      fallbackName="Merger"
      setFooter={`Merge · ${throughput.toFixed(1)}/min`}
      unsetFooter="Merger · 3 → 1"
    >
      <Handles />
    </HubLikeCard>
  );
}

export default memo(MergerNode);
