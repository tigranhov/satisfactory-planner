import { useRef } from 'react';
import { Copy, Package, Pencil, Trash2 } from 'lucide-react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import CountEditor from './editors/CountEditor';
import OverclockEditor from './editors/OverclockEditor';
import SomersloopEditor from './editors/SomersloopEditor';

export interface RecipeControls {
  clockSpeed: number;
  powerShardSlots: number;
  somersloops: number;
  somersloopSlots: number;
  powerMW: number;
  count: number;
  primaryOutput?: { baseRate: number; itemName: string; itemIcon?: string };
  onOverclock: (clockSpeed: number) => void;
  onSomersloop: (somersloops: number) => void;
  onCount: (count: number) => void;
}

export interface BlueprintControls {
  count: number;
  onCount: (count: number) => void;
}

interface Props {
  screenPosition: { x: number; y: number };
  count: number;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExtract?: () => void;
  onEdit?: () => void;
  recipe?: RecipeControls;
  blueprint?: BlueprintControls;
}

export default function NodeContextMenu({
  screenPosition,
  count,
  onClose,
  onDelete,
  onDuplicate,
  onExtract,
  onEdit,
  recipe,
  blueprint,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(rootRef, onClose, { escape: true });

  const MENU_W = 300;
  // Conservative upper bound for clamp positioning; real height is content-driven.
  const MENU_H = recipe ? 360 : blueprint ? 120 : 48;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  return (
    <div
      ref={rootRef}
      className="fixed z-50 overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between border-b border-border bg-panel-hi px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          {count > 1 ? `${count} nodes selected` : 'Node'}
        </span>
        <div className="flex items-center gap-1">
          {onEdit && (
            <button
              onClick={() => {
                onEdit();
                onClose();
              }}
              title="Edit blueprint"
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onExtract && (
            <button
              onClick={() => {
                onExtract();
                onClose();
              }}
              title="Extract to blueprint"
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-accent"
            >
              <Package className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              onDuplicate();
              onClose();
            }}
            title="Duplicate (Ctrl+D)"
            className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              onDelete();
              onClose();
            }}
            title="Delete (Del)"
            className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {recipe && (
        <>
          <CountEditor count={recipe.count} onChange={recipe.onCount} />
          <div className="border-t border-border" />
          <OverclockEditor
            clockSpeed={recipe.clockSpeed}
            powerShardSlots={recipe.powerShardSlots}
            powerMW={recipe.powerMW}
            primaryOutput={recipe.primaryOutput}
            onChange={recipe.onOverclock}
          />
          <div className="border-t border-border" />
          <SomersloopEditor
            somersloops={recipe.somersloops}
            slots={recipe.somersloopSlots}
            powerMW={recipe.powerMW}
            onChange={recipe.onSomersloop}
          />
        </>
      )}

      {blueprint && <CountEditor count={blueprint.count} onChange={blueprint.onCount} />}
    </div>
  );
}
