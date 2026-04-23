import { Handle, Position, useReactFlow } from '@xyflow/react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { FLOW_EPS } from '@/models/flow';

interface Props {
  id: string;
  nodeId: string;
  side: 'left' | 'right';
  itemName: string;
  itemIcon: string;
  rateLabel?: string;
  satisfaction?: number;
}

export default function ItemHandle({
  id,
  nodeId,
  side,
  itemName,
  itemIcon,
  rateLabel,
  satisfaction,
}: Props) {
  const isLeft = side === 'left';
  const { getEdges, deleteElements } = useReactFlow();

  const disconnect = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const attached = getEdges().filter((e) =>
      isLeft
        ? e.target === nodeId && e.targetHandle === id
        : e.source === nodeId && e.sourceHandle === id,
    );
    if (attached.length > 0) {
      void deleteElements({ edges: attached.map((e) => ({ id: e.id })) });
    }
  };

  const isShort = satisfaction != null && satisfaction < 1 - FLOW_EPS;

  return (
    <div
      className={`relative flex items-center gap-1 py-0.5 text-xs ${
        isLeft ? 'pl-1 pr-1' : 'flex-row-reverse pl-1 pr-1 text-right'
      }`}
    >
      {/* The icon IS the handle: an absolute-positioned Handle covers it so users can
          drag directly from the icon to create connections. */}
      <div className="relative h-5 w-5 shrink-0" title={itemName} onContextMenu={disconnect}>
        <IconOrLabel iconBasename={itemIcon} name={itemName} />
        <Handle
          id={id}
          type={isLeft ? 'target' : 'source'}
          position={isLeft ? Position.Left : Position.Right}
          className="!absolute !inset-0 !h-full !w-full !min-h-0 !min-w-0 !rounded !border-0 !bg-transparent !transform-none"
          style={{ top: 0, left: 0, right: 'auto', bottom: 'auto', transform: 'none' }}
        />
      </div>
      {rateLabel && (
        <span className="text-[10px] text-[#6b7388]">
          {rateLabel}
          {isShort && (
            <span className="ml-1 text-orange-400">
              ({Math.round((satisfaction ?? 0) * 100)}%)
            </span>
          )}
        </span>
      )}
    </div>
  );
}
