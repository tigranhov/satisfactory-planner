import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { HelpCircle, LogIn, LogOut } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import InlineItemText from '@/components/ui/InlineItemText';
import { loadGameData } from '@/data/loader';
import { handleIdForInterface } from '@/models/factory';
import type { InterfaceNodeData } from '@/models/graph';

const gameData = loadGameData();

function InterfaceNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as InterfaceNodeData;
  const isInput = nodeData.kind === 'input';
  const item = nodeData.itemId ? gameData.items[nodeData.itemId] : undefined;
  const committed = !!nodeData.itemId;

  const borderActive = isInput ? 'border-sky-500/60' : 'border-fuchsia-500/60';
  const borderClass = selected
    ? 'border-accent'
    : committed
      ? borderActive
      : 'border-[#4a5068]';

  return (
    <div
      className={`flex min-w-[160px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${borderClass}`}
    >
      {isInput ? (
        <LogIn className={`h-3.5 w-3.5 shrink-0 ${committed ? 'text-sky-400' : 'text-[#6b7388]'}`} />
      ) : (
        <LogOut className={`h-3.5 w-3.5 shrink-0 ${committed ? 'text-fuchsia-400' : 'text-[#6b7388]'}`} />
      )}
      {item ? (
        <IconOrLabel iconBasename={item.icon} name={item.name} />
      ) : (
        <HelpCircle className="h-5 w-5 shrink-0 text-[#6b7388]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {nodeData.label ? (
            <InlineItemText text={nodeData.label} />
          ) : (
            item?.name ?? (isInput ? 'Input' : 'Output')
          )}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          {isInput ? 'Input' : 'Output'}
          {!committed && ' · connect to set type'}
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
