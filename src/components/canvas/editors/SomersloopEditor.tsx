import { Sparkles } from 'lucide-react';
import PowerReadout from './PowerReadout';

interface Props {
  somersloops: number;
  slots: number;
  powerMW: number;
  onChange: (somersloops: number) => void;
}

export default function SomersloopEditor({ somersloops, slots, powerMW, onChange }: Props) {
  if (slots <= 0) {
    return (
      <div className="px-3 py-2 text-[10px] text-[#6b7388]">
        <div className="mb-1 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-xs font-medium uppercase tracking-wider">Somersloops</span>
        </div>
        Not supported by this machine.
      </div>
    );
  }

  const count = Math.max(0, Math.min(slots, somersloops));
  const rateMult = 1 + count / slots;

  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-[#6b7388]">
          Somersloops
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-fuchsia-300">
          {count} <span className="text-[#6b7388]">/ {slots}</span>
        </span>
      </div>

      <div className="mb-2 flex gap-1">
        {Array.from({ length: slots + 1 }, (_, i) => {
          const active = i === count;
          const filled = i > 0 && i <= count;
          return (
            <button
              key={i}
              onClick={() => onChange(i)}
              className={`flex h-8 flex-1 flex-col items-center justify-center rounded border text-[10px] transition-all ${
                active
                  ? 'border-fuchsia-400 bg-fuchsia-500/20'
                  : filled
                  ? 'border-fuchsia-500/50 bg-fuchsia-500/5'
                  : 'border-border bg-panel-hi hover:border-fuchsia-500/40'
              }`}
              title={`${i} / ${slots}`}
            >
              {i === 0 ? (
                <span className="text-[#6b7388]">Off</span>
              ) : (
                <Sparkles
                  className={`h-3.5 w-3.5 ${filled ? 'text-fuchsia-400' : 'text-[#6b7388]'}`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-[10px]">
        <div>
          <span className="text-[#6b7388]">Output </span>
          <span className="font-medium text-fuchsia-400 tabular-nums">×{rateMult.toFixed(2)}</span>
        </div>
        <div className="ml-auto">
          <PowerReadout powerMW={powerMW} />
        </div>
      </div>
    </div>
  );
}
