import type { IOSummary, SortedItem } from '@/lib/aggregate';
import { sortItemsByValue } from '@/lib/aggregate';
import type { GameData } from '@/data/types';
import ItemRateRow from '../ItemRateRow';

interface Props {
  summary: IOSummary;
  gameData: GameData;
}

function Section({
  title,
  items,
  rateClass,
  prefix,
  hint,
}: {
  title: string;
  items: SortedItem[];
  rateClass: string;
  prefix: string;
  hint?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="pt-1">
      <div
        className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-[#6b7388]"
        title={hint}
      >
        {title}
      </div>
      {items.map((row) => (
        <ItemRateRow
          key={`${prefix}-${row.itemId}`}
          name={row.name}
          icon={row.icon}
          rate={row.value}
          rateClass={rateClass}
        />
      ))}
    </div>
  );
}

export default function IOSection({ summary, gameData }: Props) {
  const inputs = sortItemsByValue(summary.inputs, gameData);
  const outputs = sortItemsByValue(summary.outputs, gameData);
  const surplus = sortItemsByValue(summary.surplus, gameData);

  if (inputs.length === 0 && outputs.length === 0 && surplus.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-[#6b7388]">
        No net flow. Add recipes or place Input/Output ports to declare a boundary.
      </div>
    );
  }

  return (
    <div>
      {summary.source === 'net' && (
        <div className="px-3 pt-1.5 text-[10px] italic text-[#6b7388]">
          Computed from net flow. Place Input/Output ports for an explicit boundary.
        </div>
      )}
      <Section title="Final outputs" items={outputs} rateClass="text-green-400" prefix="o" />
      <Section title="Inputs needed" items={inputs} rateClass="text-amber-400" prefix="i" />
      <Section
        title="Internal surplus"
        items={surplus}
        rateClass="text-sky-400"
        prefix="s"
        hint="Items both produced and consumed inside, with extra production left over"
      />
    </div>
  );
}
