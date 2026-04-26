import type { ItemId } from '@/data/types';
import type { GameData } from '@/data/types';
import { sortItemsByValue, type SortedItem } from '@/lib/aggregate';
import CollapsibleSection, { type InfoSectionId } from '../CollapsibleSection';
import ItemRateRow from '../ItemRateRow';

interface Props {
  rawInputs: Map<ItemId, number>;
  finalOutputs: Map<ItemId, number>;
  surplus: Map<ItemId, number>;
  sinkPointsPerMin: number;
  gameData: GameData;
}

function CollapsibleItemList({
  id,
  title,
  items,
  rateClass,
  defaultOpen = true,
}: {
  id: InfoSectionId;
  title: string;
  items: SortedItem[];
  rateClass: string;
  defaultOpen?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <CollapsibleSection
      id={id}
      title={title}
      trailing={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      defaultOpen={defaultOpen}
    >
      {items.map((row) => (
        <ItemRateRow
          key={`${id}-${row.itemId}`}
          name={row.name}
          icon={row.icon}
          rate={row.value}
          rateClass={rateClass}
        />
      ))}
    </CollapsibleSection>
  );
}

export default function GlobalSection({
  rawInputs,
  finalOutputs,
  surplus,
  sinkPointsPerMin,
  gameData,
}: Props) {
  const inputs = sortItemsByValue(rawInputs, gameData);
  const outputs = sortItemsByValue(finalOutputs, gameData);
  const over = sortItemsByValue(surplus, gameData);

  if (
    inputs.length === 0 &&
    outputs.length === 0 &&
    over.length === 0 &&
    sinkPointsPerMin <= 0
  ) {
    return (
      <div className="px-3 py-4 text-xs text-[#6b7388]">
        Add factories with extractors and recipes to see project-wide flow.
      </div>
    );
  }

  return (
    <>
      {sinkPointsPerMin > 0 && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
          <span className="text-[#9aa2b8]">Sink points / min</span>
          <span className="font-medium tabular-nums text-cyan-400">
            {Math.round(sinkPointsPerMin).toLocaleString()}
          </span>
        </div>
      )}
      <CollapsibleItemList
        id="global-inputs"
        title="Raw world inputs"
        items={inputs}
        rateClass="text-amber-400"
      />
      <CollapsibleItemList
        id="global-outputs"
        title="Final outputs"
        items={outputs}
        rateClass="text-green-400"
      />
      <CollapsibleItemList
        id="global-surplus"
        title="Internal surplus"
        items={over}
        rateClass="text-sky-400"
        defaultOpen={false}
      />
    </>
  );
}
