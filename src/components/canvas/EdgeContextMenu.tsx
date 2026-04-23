import { useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';

interface Props {
  screenPosition: { x: number; y: number };
  onClose: () => void;
  onRemove: () => void;
}

export default function EdgeContextMenu({ screenPosition, onClose, onRemove }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(rootRef, onClose, { escape: true });

  const MENU_W = 180;
  const MENU_H = 40;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  return (
    <div
      ref={rootRef}
      className="fixed z-50 overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={() => {
          onRemove();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#e6e8ee] hover:bg-panel-hi hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove connection
      </button>
    </div>
  );
}
