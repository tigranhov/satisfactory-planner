import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { CheckCircle2, Mountain, Sparkles, Zap } from 'lucide-react';
import ItemHandle from '../handles/ItemHandle';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import {
  handleIdForIngredient,
  handleIdForProduct,
  recipeInputs,
  recipeOutputs,
} from '@/models/factory';
import { FLOW_EPS, inputBottleneck, type HandleFlow } from '@/models/flow';
import type { RecipeNodeData } from '@/models/graph';
import { PURITY_LABEL, formatPurityMultiplier } from '@/lib/purity';
import type { Purity } from '@/data/types';
import { statusBorderClass } from '@/lib/nodeStatus';
import { formatBottleneckTitle, formatNumber, formatRate } from '@/lib/format';

// Keep all three class strings literal so Tailwind JIT picks them up.
const PURITY_CHIP_CLASS: Record<Purity, string> = {
  impure: 'border-amber-500/50 text-amber-300',
  normal: 'border-sky-500/50 text-sky-300',
  pure: 'border-emerald-500/50 text-emerald-300',
};

const gameData = loadGameData();

function RecipeNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as RecipeNodeData & {
    handleFlows?: Record<string, HandleFlow>;
  };
  const recipe = gameData.recipes[nodeData.recipeId];
  if (!recipe) return null;

  const inputs = recipeInputs(recipe, nodeData);
  const outputs = recipeOutputs(recipe, nodeData, gameData);
  const machine = gameData.machines[recipe.machineId];
  const clockPct = nodeData.clockSpeed * 100;
  const showClock = Math.abs(clockPct - 100) > 1e-4;
  const clockLabel = formatNumber(clockPct, 4);
  const sloopSlots = machine?.somersloopSlots ?? 0;
  const showSloops = nodeData.somersloops > 0 && sloopSlots > 0;
  const clockColor =
    clockPct > 100 ? 'text-accent border-accent/40' : 'text-sky-400 border-sky-500/40';
  const count = Math.max(1, nodeData.count);
  const purity: Purity | undefined = recipe.isExtraction
    ? nodeData.purity ?? 'normal'
    : undefined;
  const purityMult = purity ? gameData.resourceDefaults.purities[purity] ?? 1 : 1;

  const inputHandleIds = recipe.ingredients.map((io, i) =>
    handleIdForIngredient(recipe.id, io.itemId, i),
  );
  const bottleneck = inputBottleneck(nodeData.handleFlows, inputHandleIds);
  const isBottlenecked = bottleneck < 1 - FLOW_EPS;

  return (
    <div
      className={`min-w-[220px] rounded-md border bg-panel text-sm shadow-lg ${statusBorderClass(
        nodeData.status,
        !!selected,
        'border-border',
      )}`}
    >
      <div className="flex items-center gap-2 rounded-t-md border-b border-border bg-panel-hi px-3 py-1.5">
        <IconOrLabel iconBasename={machine?.icon} name={machine?.name ?? '?'} bgClassName="bg-panel" />
        <span className="truncate font-medium" title={recipe.name}>
          {recipe.isExtraction ? machine?.name ?? recipe.name : recipe.name}
        </span>
        {nodeData.status === 'built' && (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {purity && (
            <Chip
              palette={PURITY_CHIP_CLASS[purity]}
              title={`Resource purity: ${PURITY_LABEL[purity]} (${formatPurityMultiplier(purityMult)})`}
              icon={<Mountain className="h-3 w-3" />}
            >
              {PURITY_LABEL[purity]}
            </Chip>
          )}
          {showClock && (
            <Chip palette={clockColor} title={`Clock speed: ${clockLabel}%`} icon={<Zap className="h-3 w-3" />}>
              {clockLabel}%
            </Chip>
          )}
          {showSloops && (
            <Chip
              palette="border-fuchsia-500/40 text-fuchsia-400"
              title={`Somersloops: ${nodeData.somersloops}/${sloopSlots}`}
              icon={<Sparkles className="h-3 w-3" />}
            >
              {nodeData.somersloops}/{sloopSlots}
            </Chip>
          )}
          <Chip palette="border-border text-[#9aa2b8]" title={`Machine count: ${count}`}>
            ×{count}
          </Chip>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-0 py-1">
        <div>
          {recipe.ingredients.map((io, i) => {
            const item = gameData.items[io.itemId];
            const handleId = inputHandleIds[i];
            return (
              <ItemHandle
                key={`in-${i}`}
                id={handleId}
                nodeId={id}
                side="left"
                itemName={item?.name ?? io.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={formatRate(inputs[i].rate)}
                satisfaction={nodeData.handleFlows?.[handleId]?.satisfaction}
              />
            );
          })}
        </div>
        <div>
          {recipe.products.map((io, i) => {
            const item = gameData.items[io.itemId];
            const nominal = outputs[i].rate;
            const actual = nominal * bottleneck;
            return (
              <ItemHandle
                key={`out-${i}`}
                id={handleIdForProduct(recipe.id, io.itemId, i)}
                nodeId={id}
                side="right"
                itemName={item?.name ?? io.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={formatRate(actual)}
                rateTitle={
                  isBottlenecked ? formatBottleneckTitle(actual, nominal, bottleneck) : undefined
                }
                satisfaction={isBottlenecked ? bottleneck : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(RecipeNode);

interface ChipProps {
  palette: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function Chip({ palette, title, icon, children }: ChipProps) {
  return (
    <span
      className={`flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium ${palette}`}
      title={title}
    >
      {icon}
      {children}
    </span>
  );
}
