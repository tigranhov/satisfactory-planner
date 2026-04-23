import { Minus, Plus } from 'lucide-react';

interface Props {
  count: number;
  onChange: (count: number) => void;
}

export default function CountEditor({ count, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-xs uppercase tracking-wider text-[#6b7388]">Count</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, count - 1))}
          disabled={count <= 1}
          className="rounded border border-border p-1 text-[#9aa2b8] hover:bg-panel-hi hover:text-[#e6e8ee] disabled:opacity-40"
          title="Decrease"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1) onChange(Math.floor(n));
          }}
          className="w-14 rounded border border-border bg-panel-hi px-2 py-0.5 text-center text-sm outline-none focus:border-accent"
        />
        <button
          onClick={() => onChange(count + 1)}
          className="rounded border border-border p-1 text-[#9aa2b8] hover:bg-panel-hi hover:text-[#e6e8ee]"
          title="Increase"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
