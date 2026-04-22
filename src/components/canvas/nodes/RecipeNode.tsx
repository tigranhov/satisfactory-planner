import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import ItemHandle from '../handles/ItemHandle';
import { loadGameData } from '@/data/loader';
import {
  handleIdForIngredient,
  handleIdForProduct,
  nodePowerMW,
  recipeInputs,
  recipeOutputs,
} from '@/models/factory';
import type { RecipeNodeData } from '@/models/graph';

const gameData = loadGameData();

function RecipeNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as RecipeNodeData;
  const recipe = gameData.recipes[nodeData.recipeId];
  if (!recipe) return null;

  const inputs = recipeInputs(recipe, nodeData);
  const outputs = recipeOutputs(recipe, nodeData);
  const power = nodePowerMW(recipe, nodeData);

  return (
    <div
      className={`min-w-[220px] rounded-md border bg-panel text-sm shadow-lg ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between rounded-t-md border-b border-border bg-panel-hi px-3 py-1.5">
        <span className="font-medium">{recipe.name}</span>
        <span className="text-[10px] text-[#6b7388]">
          ×{nodeData.count} @ {Math.round(nodeData.clockSpeed * 100)}%
        </span>
      </div>
      <div className="grid grid-cols-2 gap-0 py-1">
        <div>
          {recipe.ingredients.map((io, i) => {
            const item = gameData.items[io.itemId];
            const rate = inputs[i].rate;
            return (
              <ItemHandle
                key={`in-${i}`}
                id={handleIdForIngredient(recipe.id, io.itemId, i)}
                side="left"
                itemName={item?.name ?? io.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={`${rate.toFixed(1)}/min`}
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
                side="right"
                itemName={item?.name ?? io.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={`${rate.toFixed(1)}/min`}
              />
            );
          })}
        </div>
      </div>
      <div className="rounded-b-md border-t border-border bg-panel-hi px-3 py-1 text-[10px] text-[#6b7388]">
        {power < 0 ? (
          <span className="text-accent">
            +{Math.abs(power).toFixed(1)} MW · generating
          </span>
        ) : (
          <>
            {power.toFixed(1)} MW · {gameData.machines[recipe.machineId]?.name}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(RecipeNode);
