import { useRef } from 'react';
import { Copy, Package, Pencil, Sigma, Trash2, TrendingUp, Wand2 } from 'lucide-react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import CountEditor from './editors/CountEditor';
import OverclockEditor from './editors/OverclockEditor';
import PurityEditor from './editors/PurityEditor';
import SomersloopEditor from './editors/SomersloopEditor';
import InlineItemText from '@/components/ui/InlineItemText';
import type { NodeStatus } from '@/models/graph';
import type { Purity } from '@/data/types';

export interface RecipeControls {
  clockSpeed: number;
  powerShardSlots: number;
  somersloops: number;
  somersloopSlots: number;
  powerMW: number;
  count: number;
  primaryOutput?: { baseRate: number; itemName: string; itemIcon?: string };
  // Extractors only — both fields are present together.
  purity?: Purity;
  onPurity?: (purity: Purity) => void;
  onOverclock: (clockSpeed: number) => void;
  onSomersloop: (somersloops: number) => void;
  onCount: (count: number) => void;
}

export interface BlueprintControls {
  count: number;
  description?: string;
  onCount: (count: number) => void;
}

export interface FactoryControls {
  label: string;
  onLabelChange: (label: string) => void;
}

interface Props {
  screenPosition: { x: number; y: number };
  count: number;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExtract?: () => void;
  onEdit?: () => void;
  onAutoFill?: () => void;
  onOptimize?: () => void;
  onYield?: () => void;
  status?: NodeStatus;
  onStatusChange?: (status: NodeStatus | undefined) => void;
  note?: string;
  onNoteChange?: (note: string) => void;
  recipe?: RecipeControls;
  blueprint?: BlueprintControls;
  factory?: FactoryControls;
}

export default function NodeContextMenu({
  screenPosition,
  count,
  onClose,
  onDelete,
  onDuplicate,
  onExtract,
  onEdit,
  onAutoFill,
  onOptimize,
  onYield,
  status,
  onStatusChange,
  note,
  onNoteChange,
  recipe,
  blueprint,
  factory,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(rootRef, onClose, { escape: true });

  const showNote = status !== undefined && !!onNoteChange;
  const noteH = showNote ? 90 : 0;

  const MENU_W = 300;
  // Conservative upper bound for clamp positioning; real height is content-driven.
  const MENU_H = (recipe ? 400 : blueprint ? 200 : factory ? 136 : 88) + noteH;
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
          {onAutoFill && (
            <button
              onClick={() => {
                onAutoFill();
                onClose();
              }}
              title="Auto-fill inputs"
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-accent"
            >
              <Wand2 className="h-4 w-4" />
            </button>
          )}
          {onOptimize && (
            <button
              onClick={() => {
                onOptimize();
                onClose();
              }}
              title="Optimize chain"
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-accent"
            >
              <Sigma className="h-4 w-4" />
            </button>
          )}
          {onYield && (
            <button
              onClick={() => {
                onYield();
                onClose();
              }}
              title="Maximize output…"
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-emerald-300"
            >
              <TrendingUp className="h-4 w-4" />
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => {
                onEdit();
                onClose();
              }}
              title="Edit blueprint"
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-accent"
            >
              <Pencil className="h-4 w-4" />
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
              <Package className="h-4 w-4" />
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
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              onDelete();
              onClose();
            }}
            title="Delete (Del)"
            className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {onStatusChange && (
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          <StatusButton
            active={status === undefined}
            label="None"
            onClick={() => onStatusChange(undefined)}
          />
          <StatusButton
            active={status === 'planned'}
            label="Planned"
            onClick={() => onStatusChange('planned')}
          />
          <StatusButton
            active={status === 'built'}
            label="Built"
            onClick={() => onStatusChange('built')}
          />
        </div>
      )}

      {showNote && (
        <div className="border-b border-border px-3 py-2">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6b7388]">
            Task note
          </label>
          <textarea
            value={note ?? ''}
            onChange={(e) => onNoteChange?.(e.target.value)}
            placeholder="Describe what's left to do, parts list, notes…"
            rows={3}
            className="w-full resize-none rounded border border-border bg-panel-hi px-2 py-1 text-xs outline-none focus:border-accent"
          />
        </div>
      )}

      {recipe && (
        <>
          <CountEditor count={recipe.count} onChange={recipe.onCount} />
          {recipe.purity && recipe.onPurity && (
            <>
              <div className="border-t border-border" />
              <PurityEditor purity={recipe.purity} onChange={recipe.onPurity} />
            </>
          )}
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

      {blueprint && (
        <>
          <CountEditor count={blueprint.count} onChange={blueprint.onCount} />
          {blueprint.description && (
            <div className="border-t border-border px-3 py-2 text-xs text-[#9aa2b8]">
              <InlineItemText text={blueprint.description} />
            </div>
          )}
        </>
      )}

      {factory && (
        <div className="px-3 py-2">
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6b7388]">
            Name
          </label>
          <input
            type="text"
            value={factory.label}
            onChange={(e) => factory.onLabelChange(e.target.value)}
            className="w-full rounded border border-border bg-panel-hi px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  );
}

interface StatusButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function StatusButton({ active, label, onClick }: StatusButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
        active ? 'bg-panel-hi text-accent' : 'text-[#9aa2b8] hover:bg-panel-hi'
      }`}
    >
      {label}
    </button>
  );
}
