import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowLeftFromLine, ArrowRightFromLine } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import { handleIdForInterface } from '@/models/factory';
import type { InterfaceNodeData } from '@/models/graph';

const gameData = loadGameData();

function InterfaceNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as InterfaceNodeData;
  const item = gameData.items[nodeData.itemId];
  const isInput = nodeData.kind === 'input';

  return (
    <div
      className={`flex min-w-[160px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${
        selected ? 'border-accent' : isInput ? 'border-sky-500/60' : 'border-fuchsia-500/60'
      }`}
    >
      {isInput ? (
        <ArrowRightFromLine className="h-3.5 w-3.5 shrink-0 text-sky-400" />
      ) : (
        <ArrowLeftFromLine className="h-3.5 w-3.5 shrink-0 text-fuchsia-400" />
      )}
      <IconOrLabel iconBasename={item?.icon} name={item?.name ?? nodeData.itemId} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{nodeData.label || item?.name || nodeData.itemId}</div>
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          {isInput ? 'Input' : 'Output'}
        </div>
      </div>
      <Handle
        id={handleIdForInterface(nodeData.kind, nodeData.itemId)}
        type={isInput ? 'source' : 'target'}
        position={isInput ? Position.Right : Position.Left}
        className="!h-3 !w-3 !border-2 !border-panel !bg-accent"
      />
    </div>
  );
}

export default memo(InterfaceNode);
