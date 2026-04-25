import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Wand2, X } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import { useGraphStore } from '@/store/graphStore';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { PickerRow, RecipeRowContent } from './CanvasContextMenu';
import {
  baseRateFor,
  computeClockSplit,
  describeIngredients,
  type ClockStrategy,
  type InputSelection,
  type IngredientRow,
} from '@/lib/autoFill';
import { formatNumber } from '@/lib/format';
import type { GraphId, NodeId, RecipeNodeData } from '@/models/graph';
import type { Recipe } from '@/data/types';

const gameData = loadGameData();

interface Props {
  open: boolean;
  graphId: GraphId;
  targetNodeId: NodeId | null;
  clockStrategy: ClockStrategy;
  onClose: () => void;
  onConfirm: (selections: InputSelection[]) => void;
}

export default function AutoFillModal({
  open,
  graphId,
  targetNodeId,
  clockStrategy,
  onClose,
  onConfirm,
}: Props) {
  const graph = useGraphStore((s) => s.graphs[graphId]);

  const target = targetNodeId
    ? graph?.nodes.find((n) => n.id === targetNodeId)
    : undefined;
  const recipe =
    target && target.data.kind === 'recipe'
      ? gameData.recipes[target.data.recipeId]
      : undefined;

  const rows: IngredientRow[] = useMemo(() => {
    if (!target || !recipe || target.data.kind !== 'recipe') return [];
    return describeIngredients(recipe, target.data, graph.edges, target.id, gameData);
  }, [target, recipe, graph]);

  const fillableRows = rows.filter((r) => !r.connected && !r.raw && r.availableRecipes.length > 0);
  const recipeData = target?.data.kind === 'recipe' ? (target.data as RecipeNodeData) : null;
  const targetCountIsZero = !!recipeData && recipeData.count <= 0;

  // Per-row recipe selection, keyed by ingredient index. Defaults to the first
  // entry from `availableRecipes` (the loader sorts non-alternate recipes
  // ahead of alternates, matching user intuition).
  const [choices, setChoices] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!open) return;
    const next: Record<number, string> = {};
    for (const row of fillableRows) {
      next[row.ingredientIndex] = row.availableRecipes[0]!.id;
    }
    setChoices(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetNodeId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !target || !recipe) return null;

  const canPlace = fillableRows.length > 0 && !targetCountIsZero;

  const handleConfirm = () => {
    const selections: InputSelection[] = fillableRows
      .map((row) => {
        const recipeId = choices[row.ingredientIndex] ?? row.availableRecipes[0]!.id;
        return {
          ingredientIndex: row.ingredientIndex,
          itemId: row.itemId,
          demandRate: row.demandRate,
          recipeId,
          targetHandleId: row.targetHandleId,
        };
      })
      .filter((sel) => !!sel.recipeId);
    onConfirm(selections);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="flex w-[560px] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border bg-panel-hi px-4 py-2.5">
          <Wand2 className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Auto-fill inputs</span>
          <span className="ml-2 truncate text-xs text-[#9aa2b8]">{recipe.name}</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {targetCountIsZero && (
            <div className="border-b border-border bg-amber-900/20 px-4 py-2 text-xs text-amber-200">
              This node&rsquo;s machine count is 0. Set a positive count before auto-filling.
            </div>
          )}
          {rows.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-[#6b7388]">
              This recipe has no ingredients.
            </div>
          )}
          {rows.map((row) => (
            <IngredientRowView
              key={row.ingredientIndex}
              row={row}
              choice={choices[row.ingredientIndex]}
              clockStrategy={clockStrategy}
              onChoiceChange={(id) =>
                setChoices((prev) => ({ ...prev, [row.ingredientIndex]: id }))
              }
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel-hi px-4 py-2">
          <button
            onClick={onClose}
            className="rounded bg-panel px-3 py-1 text-xs text-[#9aa2b8] hover:text-[#e6e8ee]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canPlace}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-[#1b1410] hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-50"
          >
            Place
          </button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  row: IngredientRow;
  choice: string | undefined;
  clockStrategy: ClockStrategy;
  onChoiceChange: (recipeId: string) => void;
}

function IngredientRowView({ row, choice, clockStrategy, onChoiceChange }: RowProps) {
  const item = gameData.items[row.itemId];
  const itemName = item?.name ?? row.itemId;

  if (row.connected) {
    return (
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2 opacity-60">
        <IconOrLabel iconBasename={item?.icon} name={itemName} className="h-8 w-8 rounded" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{itemName}</div>
          <div className="text-[11px] text-[#6b7388]">Already connected — skipped</div>
        </div>
      </div>
    );
  }

  if (row.raw || row.availableRecipes.length === 0) {
    return (
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2 opacity-60">
        <IconOrLabel iconBasename={item?.icon} name={itemName} className="h-8 w-8 rounded" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{itemName}</div>
          <div className="text-[11px] text-[#6b7388]">
            {row.raw ? 'Raw resource — place a miner manually' : 'No non-extraction recipes produce this item'}
          </div>
        </div>
      </div>
    );
  }

  const selectedId = choice ?? row.availableRecipes[0]!.id;
  const selectedRecipe = row.availableRecipes.find((r) => r.id === selectedId);
  const plan = selectedRecipe
    ? computeClockSplit(row.demandRate, baseRateFor(selectedRecipe, row.itemId), clockStrategy)
    : [];

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 px-4 py-2">
      <div className="flex items-center gap-3">
        <IconOrLabel iconBasename={item?.icon} name={itemName} className="h-8 w-8 rounded" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{itemName}</div>
          <div className="text-[11px] text-[#9aa2b8] tabular-nums">
            {formatNumber(row.demandRate, 2)} /min needed
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-[#6b7388]">Recipe</label>
        <RecipePicker
          recipes={row.availableRecipes}
          selectedId={selectedId}
          onSelect={onChoiceChange}
        />
      </div>
      <div className="text-[11px] text-[#9aa2b8]">
        Plan: {plan.length === 0 ? '—' : plan.map(describeBucket).join(' + ')}
      </div>
    </div>
  );
}

function describeBucket(bucket: { count: number; clockSpeed: number }): string {
  const pct = formatNumber(bucket.clockSpeed * 100, 2);
  return `${bucket.count}× @${pct}%`;
}

interface RecipePickerProps {
  recipes: Recipe[];
  selectedId: string;
  onSelect: (recipeId: string) => void;
}

// The popover renders via a portal so it escapes the modal's overflow:hidden
// container and floats above the layout instead of forcing the ingredient
// row's body to grow (and gaining a nested scrollbar). Position is
// recomputed from the button's rect on open and as the user scrolls.
function RecipePicker({ recipes, selectedId, onSelect }: RecipePickerProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss([buttonRef, popoverRef], () => setOpen(false), { escape: true });

  useLayoutEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  const selected = recipes.find((r) => r.id === selectedId) ?? recipes[0];
  if (!selected) return null;

  return (
    <div className="flex-1">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded border border-border bg-panel-hi px-2 py-1 text-xs hover:border-accent/50"
      >
        <RecipeRowContent recipe={selected} />
        <ChevronDown className="h-3 w-3 shrink-0 text-[#6b7388]" />
      </button>
      {open && rect &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              maxHeight: 'min(70vh, 600px)',
            }}
            className="z-[60] overflow-y-auto rounded-md border border-border bg-panel p-1 shadow-xl"
          >
            {recipes.map((r, i) => (
              <PickerRow
                key={r.id}
                index={i}
                active={r.id === selectedId}
                onHover={() => {}}
                onPick={() => {
                  onSelect(r.id);
                  setOpen(false);
                }}
              >
                <RecipeRowContent recipe={r} />
              </PickerRow>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
