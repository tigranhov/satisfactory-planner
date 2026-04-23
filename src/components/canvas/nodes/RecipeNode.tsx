import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
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
  const outputs = recipeOutputs(recipe, nodeData);
  const machine = gameData.machines[recipe.machineId];

  return (
    <div
      className={`min-w-[220px] rounded-md border bg-panel text-sm shadow-lg ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-md border-b border-border bg-panel-hi px-3 py-1.5">
        <IconOrLabel iconBasename={machine?.icon} name={machine?.name ?? '?'} bgClassName="bg-panel" />
        <span className="font-medium">{recipe.name}</span>
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
