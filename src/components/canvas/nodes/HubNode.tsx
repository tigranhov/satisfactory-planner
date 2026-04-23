import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { HelpCircle, Waypoints } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import { HUB_IN_HANDLE, HUB_OUT_HANDLE } from '@/models/factory';
import type { HandleFlow } from '@/models/flow';
import type { HubNodeData } from '@/models/graph';

const gameData = loadGameData();

// currentItemId is injected by GraphCanvas.graphToFlow — derived from edges
// so the same hub node flips its displayed type as connections change.
interface HubRenderData extends HubNodeData {
  currentItemId?: string | null;
  handleFlows?: Record<string, HandleFlow>;
}

function FatHandles() {
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

  if (!itemId) {
    return (
      <div
        className={`flex min-w-[180px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${
          selected ? 'border-accent' : 'border-[#4a5068]'
        }`}
      >
        <FatHandles />
        <Waypoints className="h-3.5 w-3.5 shrink-0 text-[#6b7388]" />
        <HelpCircle className="h-5 w-5 shrink-0 text-[#6b7388]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{nodeData.label || 'Unset hub'}</div>
          <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
            Hub · connect to set type
          </div>
        </div>
      </div>
    );
  }

  const item = gameData.items[itemId];
  const throughput = nodeData.handleFlows?.[HUB_IN_HANDLE]?.supply ?? 0;

  return (
    <div
      className={`flex min-w-[180px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${
        selected ? 'border-accent' : 'border-amber-500/60'
      }`}
    >
      <FatHandles />
      <Waypoints className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      <IconOrLabel iconBasename={item?.icon} name={item?.name ?? itemId} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{nodeData.label || item?.name || itemId}</div>
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          Hub · {throughput.toFixed(1)}/min
        </div>
      </div>
    </div>
  );
}

export default memo(HubNode);
