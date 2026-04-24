import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Split } from 'lucide-react';
import { SPLITTER_IN_HANDLE, SPLITTER_OUT_HANDLES } from '@/models/factory';
import type { HandleFlow } from '@/models/flow';
import type { SplitterNodeData } from '@/models/graph';
import HubLikeCard from './HubLikeCard';
import { HANDLE_STRIP_TOPS } from './handleStrip';

interface SplitterRenderData extends SplitterNodeData {
  currentItemId?: string | null;
  handleFlows?: Record<string, HandleFlow>;
}

function Handles() {
  return (
    <>
      <Handle
        id={SPLITTER_IN_HANDLE}
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-panel !bg-cyan-400"
      />
      {SPLITTER_OUT_HANDLES.map((id, i) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={Position.Right}
          style={{ top: HANDLE_STRIP_TOPS[i] }}
          className="!h-3 !w-3 !border-2 !border-panel !bg-cyan-400"
        />
      ))}
    </>
  );
}

function SplitterNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as SplitterRenderData;
  const itemId = nodeData.currentItemId ?? null;
  const throughput = nodeData.handleFlows?.[SPLITTER_IN_HANDLE]?.supply ?? 0;

  return (
    <HubLikeCard
      selected={!!selected}
      itemId={itemId}
      kindIcon={Split}
      activeBorderClass="border-cyan-500/60"
      activeIconClass="text-cyan-300"
      label={nodeData.label}
      fallbackName="Splitter"
      setFooter={`Split · ${throughput.toFixed(1)}/min`}
      unsetFooter="Splitter · 1 → 3"
      status={nodeData.status}
    >
      <Handles />
    </HubLikeCard>
  );
}

export default memo(SplitterNode);
