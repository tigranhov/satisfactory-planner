import { Handle, Position } from '@xyflow/react';

interface Props {
  id: string;
  side: 'left' | 'right';
  itemName: string;
  itemIcon: string;
  rateLabel?: string;
}

export default function ItemHandle({ id, side, itemName, itemIcon, rateLabel }: Props) {
  const isLeft = side === 'left';
  return (
    <div
      className={`relative flex items-center gap-2 py-1 text-xs ${
        isLeft ? 'pl-3 pr-2' : 'flex-row-reverse pl-2 pr-3 text-right'
      }`}
    >
      <Handle
        id={id}
        type={isLeft ? 'target' : 'source'}
        position={isLeft ? Position.Left : Position.Right}
        className="!bg-panel-hi !border-accent"
      />
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-panel-hi text-[10px] font-bold text-accent">
        {itemIcon}
      </span>
      <span className="flex-1 text-[#e6e8ee]">{itemName}</span>
      {rateLabel && <span className="text-[10px] text-[#6b7388]">{rateLabel}</span>}
    </div>
  );
}
