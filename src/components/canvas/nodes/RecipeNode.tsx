import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Sparkles, Zap } from 'lucide-react';
import ItemHandle from '../handles/ItemHandle';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';
import {
  handleIdForIngredient,
  handleIdForProduct,
  recipeInputs,
  recipeOutputs,
} from '@/models/factory';
import type { HandleFlow } from '@/models/flow';
import type { RecipeNodeData } from '@/models/graph';

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
  const clockPct = Math.round(nodeData.clockSpeed * 100);
  const showClock = clockPct !== 100;
  const sloopSlots = machine?.somersloopSlots ?? 0;
  const showSloops = nodeData.somersloops > 0 && sloopSlots > 0;
  const clockColor =
    clockPct > 100 ? 'text-accent border-accent/40' : 'text-sky-400 border-sky-500/40';
  const count = Math.max(1, nodeData.count);

  return (
    <div
      className={`min-w-[220px] rounded-md border bg-panel text-sm shadow-lg ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-md border-b border-border bg-panel-hi px-3 py-1.5">
        <IconOrLabel iconBasename={machine?.icon} name={machine?.name ?? '?'} bgClassName="bg-panel" />
        <span className="truncate font-medium">{recipe.name}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {showClock && (
            <Chip palette={clockColor} title={`Clock speed: ${clockPct}%`} icon={<Zap className="h-3 w-3" />}>
              {clockPct}%
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
            const rate = inputs[i].rate;
            const handleId = handleIdForIngredient(recipe.id, io.itemId, i);
            return (
              <ItemHandle
                key={`in-${i}`}
                id={handleId}
                nodeId={id}
                side="left"
                itemName={item?.name ?? io.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={`${rate.toFixed(1)}/min`}
                satisfaction={nodeData.handleFlows?.[handleId]?.satisfaction}
              />
            );
          })}
        </div>
        <div>
          {recipe.products.map((io, i) => {
            const item = gameData.items[io.itemId];
            const rate = outputs[i].rate;
            return (
              <ItemHandle
                key={`out-${i}`}
                id={handleIdForProduct(recipe.id, io.itemId, i)}
                nodeId={id}
                side="right"
                itemName={item?.name ?? io.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={`${rate.toFixed(1)}/min`}
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
