import { useRef } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';

interface Action {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  screenPosition: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  count: number;
}

export default function NodeContextMenu({
  screenPosition,
  onClose,
  onDelete,
  onDuplicate,
  count,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss(rootRef, onClose, { escape: true });

  const actions: Action[] = [
    {
      label: 'Duplicate',
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: () => {
        onDuplicate();
        onClose();
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => {
        onDelete();
        onClose();
      },
    },
  ];

  const MENU_W = 180;
  const MENU_H = actions.length * 32 + (count > 1 ? 24 : 0) + 8;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  return (
    <div
      ref={rootRef}
      className="fixed z-50 overflow-hidden rounded-md border border-border bg-panel py-1 text-sm shadow-xl"
      style={{ left, top, width: MENU_W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {count > 1 && (
        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[#6b7388]">
          {count} nodes selected
        </div>
      )}
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onSelect}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel-hi ${
            a.danger ? 'text-red-400' : 'text-[#e6e8ee]'
          }`}
        >
          {a.icon}
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}
