import { useRef } from 'react';
import { Copy, Minus, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import OverclockEditor from './editors/OverclockEditor';
import SomersloopEditor from './editors/SomersloopEditor';

export interface RecipeControls {
  clockSpeed: number;
  powerShardSlots: number;
  somersloops: number;
  somersloopSlots: number;
  powerMW: number;
  primaryOutput?: { baseRate: number; itemName: string; itemIcon?: string };
  onOverclock: (clockSpeed: number) => void;
  onSomersloop: (somersloops: number) => void;
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
  const MENU_H = recipe ? 320 : blueprint ? 120 : 48;
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

      {blueprint && (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-xs uppercase tracking-wider text-[#6b7388]">Count</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => blueprint.onCount(Math.max(1, blueprint.count - 1))}
              disabled={blueprint.count <= 1}
              className="rounded border border-border p-1 text-[#9aa2b8] hover:bg-panel-hi hover:text-[#e6e8ee] disabled:opacity-40"
              title="Decrease"
            >
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="number"
              min={1}
              value={blueprint.count}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) blueprint.onCount(Math.floor(n));
              }}
              className="w-14 rounded border border-border bg-panel-hi px-2 py-0.5 text-center text-sm outline-none focus:border-accent"
            />
            <button
              onClick={() => blueprint.onCount(blueprint.count + 1)}
              className="rounded border border-border p-1 text-[#9aa2b8] hover:bg-panel-hi hover:text-[#e6e8ee]"
              title="Increase"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
