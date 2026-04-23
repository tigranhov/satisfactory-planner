import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Package } from 'lucide-react';
import ItemHandle from '../handles/ItemHandle';
import { loadGameData } from '@/data/loader';
import { useBlueprintStore } from '@/store/blueprintStore';
import {
  handleIdForBlueprintInput,
  handleIdForBlueprintOutput,
} from '@/models/factory';
import { blueprintInterfaceRates } from '@/models/flow';
import type { HandleFlow } from '@/models/flow';
import type { BlueprintNodeData, InterfaceNodeData } from '@/models/graph';

const gameData = loadGameData();

function BlueprintNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as BlueprintNodeData & {
    handleFlows?: Record<string, HandleFlow>;
  };
  const bp = useBlueprintStore((s) => s.blueprints[nodeData.blueprintId]);
  const blueprints = useBlueprintStore((s) => s.blueprints);

  if (!bp) {
    return (
      <div className="min-w-[220px] rounded-md border border-red-500/60 bg-panel px-3 py-2 text-sm text-red-400 shadow-lg">
        Missing blueprint
      </div>
    );
  }

  const rates = blueprintInterfaceRates(bp, gameData, blueprints);
  const { inputNodes: inputs, outputNodes: outputs } = rates;
  const count = Math.max(1, nodeData.count);

  return (
    <div
      className={`min-w-[240px] rounded-md border-2 bg-[#15253c] text-sm shadow-lg ${
        selected ? 'border-sky-400' : 'border-sky-500/50'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-md border-b border-sky-600/40 bg-[#1e3554] px-3 py-1.5">
        <Package className="h-4 w-4 shrink-0 text-sky-300" />
        <span className="truncate font-medium text-sky-50">{bp.name}</span>
        <span
          className="ml-auto flex shrink-0 items-center rounded border border-sky-400/50 px-1 py-0.5 text-[10px] font-medium text-sky-200"
          title={`Instance count: ${count}`}
        >
          ×{count}
        </span>
      </div>
      <div className="grid min-h-[32px] grid-cols-2 gap-0 py-1">
        <div>
          {inputs.length === 0 && (
            <div className="px-3 py-1 text-[10px] italic text-[#6b7388]">no inputs</div>
          )}
          {inputs.map((n) => {
            const iface = n.data as InterfaceNodeData;
            const item = gameData.items[iface.itemId];
            const rate = (rates.inputs.get(n.id) ?? 0) * count;
            const handleId = handleIdForBlueprintInput(n.id, iface.itemId);
            return (
              <ItemHandle
                key={n.id}
                id={handleId}
                nodeId={id}
                side="left"
                itemName={item?.name ?? iface.itemId}
                itemIcon={item?.icon ?? '?'}
                rateLabel={`${rate.toFixed(1)}/min`}
                satisfaction={nodeData.handleFlows?.[handleId]?.satisfaction}
              />
            );
          })}
        </div>
        <div>
          {outputs.length === 0 && (
            <div className="px-3 py-1 text-[10px] italic text-[#6b7388]">no outputs</div>
          )}
          {outputs.map((n) => {
            const iface = n.data as InterfaceNodeData;
            const item = gameData.items[iface.itemId];
            const rate = (rates.outputs.get(n.id) ?? 0) * count;
            return (
              <ItemHandle
                key={n.id}
                id={handleIdForBlueprintOutput(n.id, iface.itemId)}
                nodeId={id}
                side="right"
                itemName={item?.name ?? iface.itemId}
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

export default memo(BlueprintNode);
