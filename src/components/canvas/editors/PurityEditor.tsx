import { Mountain } from 'lucide-react';
import type { Purity } from '@/data/types';
import { loadGameData } from '@/data/loader';
import { PURITY_LABEL, PURITY_ORDER, formatPurityMultiplier } from '@/lib/purity';

interface Props {
  purity: Purity;
  onChange: (purity: Purity) => void;
}

// Literal Tailwind class strings — JIT requires the full class name in source.
const ACTIVE_CLASS: Record<Purity, string> = {
  impure: 'border-amber-400 bg-amber-500/20 text-amber-200',
  normal: 'border-sky-400 bg-sky-500/20 text-sky-200',
  pure: 'border-emerald-400 bg-emerald-500/20 text-emerald-200',
};

const gameData = loadGameData();

export default function PurityEditor({ purity, onChange }: Props) {
  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5">
        <Mountain className="h-3.5 w-3.5 text-sky-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-[#6b7388]">
          Resource Purity
        </span>
      </div>
      <div className="flex gap-1">
        {PURITY_ORDER.map((value) => {
          const active = value === purity;
          const mult = gameData.resourceDefaults.purities[value] ?? 1;
          const multLabel = formatPurityMultiplier(mult);
          return (
            <button
              key={value}
              onClick={() => onChange(value)}
              className={`flex flex-1 flex-col items-center justify-center rounded border py-1 text-[10px] font-medium transition-colors ${
                active ? ACTIVE_CLASS[value] : 'border-border bg-panel-hi text-[#9aa2b8] hover:border-accent/40'
              }`}
              title={`${PURITY_LABEL[value]} node — ${multLabel} base extraction`}
            >
              <span>{PURITY_LABEL[value]}</span>
              <span className="tabular-nums opacity-80">{multLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
