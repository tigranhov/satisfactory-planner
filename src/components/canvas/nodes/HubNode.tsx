import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Waypoints } from 'lucide-react';
import { HUB_IN_HANDLE, HUB_OUT_HANDLE } from '@/models/factory';
import type { HandleFlow } from '@/models/flow';
import type { HubNodeData } from '@/models/graph';
import HubLikeCard from './HubLikeCard';

interface HubRenderData extends HubNodeData {
  currentItemId?: string | null;
  handleFlows?: Record<string, HandleFlow>;
}

function Handles() {
  return (
    <>
      <Handle
        id={HUB_IN_HANDLE}
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-panel !bg-accent"
      />
      <Handle
        id={HUB_OUT_HANDLE}
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-panel !bg-accent"
      />
    </>
  );
}

function HubNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as HubRenderData;
  const itemId = nodeData.currentItemId ?? null;
  const throughput = nodeData.handleFlows?.[HUB_IN_HANDLE]?.supply ?? 0;

  return (
    <HubLikeCard
      selected={!!selected}
      itemId={itemId}
      kindIcon={Waypoints}
      activeBorderClass="border-amber-500/60"
      activeIconClass="text-amber-400"
      label={nodeData.label}
      fallbackName="Unset hub"
      setFooter={`Hub · ${throughput.toFixed(1)}/min`}
      unsetFooter="Hub · connect to set type"
      status={nodeData.status}
    >
      <Handles />
    </HubLikeCard>
  );
}

export default memo(HubNode);
