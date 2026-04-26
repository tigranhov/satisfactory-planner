import { ArrowLeft, ArrowRight } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';

interface Props {
  // Uppercase label. Parent picks a "verb + item" form ("Add" / "Consume") when
  // an item is shown alongside, vs. the full form ("Add node" / "Consume item")
  // when no chip is shown.
  label: string;
  item?: { name: string; icon?: string };
  // Right-aligned "{N} options" counter (stage B only).
  optionCount?: number;
  onBack?: () => void;
}

export default function PickerHeader({ label, item, optionCount, onBack }: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel-hi px-3 py-2">
      {onBack ? (
        <button
          onClick={onBack}
          title="Back (Esc)"
          className="rounded p-0.5 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      ) : (
        <ArrowRight className="h-3.5 w-3.5 text-accent" />
      )}
      <span className="text-xs uppercase tracking-wider text-[#9aa2b8]">{label}</span>
      {item && (
        <>
          <IconOrLabel
            iconBasename={item.icon}
            name={item.name}
            className="h-4 w-4 rounded"
          />
          <span className="truncate text-xs font-medium">{item.name}</span>
        </>
      )}
      {optionCount !== undefined && (
        <span className="ml-auto text-xs text-[#6b7388]">
          {optionCount} option{optionCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}
