import { useEffect, useRef } from 'react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import type { Purity, Recipe } from '@/data/types';
import { loadGameData } from '@/data/loader';
import { PURITY_LABEL, PURITY_ORDER, formatPurityMultiplier } from '@/lib/purity';
import PickerHeader from './PickerHeader';

interface Props {
  recipe: Recipe;
  // Called with the user's purity pick. The picker doesn't add the node itself
  // — the caller decides how to commit.
  onPick: (purity: Purity) => void;
  onBack: () => void;
}

// Literal Tailwind class strings — JIT requires the full class name in source,
// so each variant has its own static row instead of templating.
const BUTTON_CLASS: Record<Purity, string> = {
  impure:
    'border-border bg-panel-hi hover:border-amber-400/60 hover:bg-amber-500/10 focus:border-amber-400 focus:bg-amber-500/15 focus:outline-none',
  normal:
    'border-border bg-panel-hi hover:border-sky-400/60 hover:bg-sky-500/10 focus:border-sky-400 focus:bg-sky-500/15 focus:outline-none',
  pure:
    'border-border bg-panel-hi hover:border-emerald-400/60 hover:bg-emerald-500/10 focus:border-emerald-400 focus:bg-emerald-500/15 focus:outline-none',
};

const TEXT_CLASS: Record<Purity, string> = {
  impure: 'text-amber-300',
  normal: 'text-sky-300',
  pure: 'text-emerald-300',
};

const gameData = loadGameData();

// Stage shown after the user selects an extractor recipe so a node is never
// placed without an explicit purity choice. Owns its header + back button so
// CanvasContextMenu and DragDropMenu can drop it in unchanged.
export default function PurityPickerStrip({ recipe, onPick, onBack }: Props) {
  const machine = gameData.machines[recipe.machineId];
  const product = recipe.products[0];
  const productItem = product ? gameData.items[product.itemId] : undefined;
  const baseRate = product ? (product.amount * 60) / recipe.durationSec : 0;

  // Focus Normal so Enter commits the default in one keystroke.
  const normalRef = useRef<HTMLButtonElement>(null);
  useEffect(() => normalRef.current?.focus(), [recipe.id]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PickerHeader
        label="Pick purity"
        item={machine ? { name: recipe.name, icon: machine.icon } : undefined}
        onBack={onBack}
      />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="px-1 text-[11px] text-[#9aa2b8]">
          Pick the resource node purity for this extractor. You can change it
          later by right-clicking the node.
        </p>
        <div className="flex flex-col gap-1.5">
          {PURITY_ORDER.map((value) => {
            const mult = gameData.resourceDefaults.purities[value] ?? 1;
            const rate = baseRate * mult;
            return (
              <button
                key={value}
                ref={value === 'normal' ? normalRef : undefined}
                onClick={() => onPick(value)}
                className={`flex items-center gap-2 rounded border px-3 py-2 text-left text-xs transition-colors ${BUTTON_CLASS[value]}`}
              >
                <span
                  className={`flex w-16 shrink-0 flex-col text-[11px] font-semibold ${TEXT_CLASS[value]}`}
                >
                  {PURITY_LABEL[value]}
                  <span className="text-[10px] font-normal opacity-70">
                    {formatPurityMultiplier(mult)}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums text-[#9aa2b8]">
                  {productItem && (
                    <IconOrLabel
                      iconBasename={productItem.icon}
                      name={productItem.name}
                      className="h-4 w-4 rounded"
                    />
                  )}
                  <span className="text-[#e6e8ee]">{rate.toFixed(1)}</span>
                  <span className="text-[#6b7388]">/min</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-auto px-1 text-[10px] text-[#6b7388]">
          Enter selects Normal · Esc cancels
        </p>
      </div>
    </div>
  );
}
