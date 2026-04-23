import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import PowerReadout from './PowerReadout';

interface Props {
  clockSpeed: number;
  powerShardSlots: number;
  powerMW: number;
  primaryOutput?: { baseRate: number; itemName: string; itemIcon?: string };
  onChange: (clockSpeed: number) => void;
}

const PRESETS = [25, 50, 100, 150, 200, 250];

export default function OverclockEditor({
  clockSpeed,
  powerShardSlots,
  powerMW,
  primaryOutput,
  onChange,
}: Props) {
  const pct = Math.round(clockSpeed * 100);
  const maxPct = 100 + 50 * Math.max(powerShardSlots, 0);
  const maxDecimals = 4;

  const applyPct = (next: number) => {
    const clamped = Math.max(1, Math.min(maxPct, Math.round(next)));
    onChange(clamped / 100);
  };

  // Target-rate input: authoritative text mirrors the clock; local editing state
  // lets users type "4" on their way to "45" without the clock snapping mid-type.
  const currentRate = primaryOutput ? primaryOutput.baseRate * (pct / 100) : 0;
  const rateDisplay = formatRate(currentRate, maxDecimals);
  const [rateText, setRateText] = useState(rateDisplay);
  useEffect(() => setRateText(rateDisplay), [rateDisplay]);

  const commitRate = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0 || !primaryOutput) return;
    applyPct((parsed / primaryOutput.baseRate) * 100);
  };

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-medium uppercase tracking-wider text-[#6b7388]">
          Clock Speed
        </span>
        <input
          type="number"
          min={1}
          max={maxPct}
          value={pct}
          onChange={(e) => applyPct(Number(e.target.value) || 1)}
          className="ml-auto w-16 rounded border border-border bg-panel-hi px-1.5 py-0.5 text-right text-sm font-semibold tabular-nums outline-none focus:border-accent"
        />
        <span className="text-xs text-[#6b7388]">%</span>
      </div>

      <input
        type="range"
        min={1}
        max={maxPct}
        value={pct}
        onChange={(e) => applyPct(Number(e.target.value))}
        className="mb-2 w-full accent-accent"
      />

      <div className="mb-2 grid grid-cols-6 gap-1">
        {PRESETS.filter((p) => p <= maxPct).map((p) => (
          <button
            key={p}
            onClick={() => applyPct(p)}
            className={`rounded border py-1 text-[10px] font-medium transition-colors ${
              pct === p
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-panel-hi text-[#e6e8ee] hover:border-accent/50'
            }`}
          >
            {p}%
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[10px]">
        {primaryOutput ? (
          <>
            <IconOrLabel
              iconBasename={primaryOutput.itemIcon}
              name={primaryOutput.itemName}
              className="h-4 w-4 rounded"
            />
            <input
              type="text"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => {
                setRateText(e.target.value);
                commitRate(e.target.value);
              }}
              title={primaryOutput.itemName}
              className="w-20 rounded border border-border bg-panel-hi px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:border-accent"
            />
            <span className="text-[#6b7388]">/min</span>
          </>
        ) : (
          <div>
            <span className="text-[#6b7388]">Rate </span>
            <span className="font-medium text-sky-400 tabular-nums">×{(pct / 100).toFixed(2)}</span>
          </div>
        )}
        <div className="ml-auto">
          <PowerReadout powerMW={powerMW} />
        </div>
      </div>
    </div>
  );
}

function formatRate(rate: number, maxDecimals: number): string {
  if (!Number.isFinite(rate)) return '0';
  const fixed = rate.toFixed(maxDecimals);
  // Strip trailing zeros and trailing dot.
  return fixed.replace(/\.?0+$/, '');
}
