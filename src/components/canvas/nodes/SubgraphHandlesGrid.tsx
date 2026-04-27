import ItemHandle from '../handles/ItemHandle';
import { loadGameData } from '@/data/loader';
import {
  handleIdForSubgraphInput,
  handleIdForSubgraphOutput,
} from '@/models/factory';
import {
  FLOW_EPS,
  inputBottleneck,
  type GraphInterfaceRates,
  type HandleFlow,
} from '@/models/flow';
import { formatBottleneckTitle, formatRate } from '@/lib/format';
import type { InterfaceNodeData } from '@/models/graph';

const gameData = loadGameData();

interface Props {
  nodeId: string;
  rates: GraphInterfaceRates;
  // Outer count multiplier — blueprint instances scale their subgraph; factory
  // instances always pass 1.
  count: number;
  handleFlows?: Record<string, HandleFlow>;
}

// Two-column handle grid used by both BlueprintNode and FactoryNode. Left
// column is target handles per Input, right column is source handles per
// Output. Rates come pre-computed from graphInterfaceRates.
export default function SubgraphHandlesGrid({ nodeId, rates, count, handleFlows }: Props) {
  const { inputNodes, outputNodes } = rates;

  const renderItem = (fallback: string, data: InterfaceNodeData) => {
    const item = data.itemId ? gameData.items[data.itemId] : undefined;
    return {
      item,
      name: item?.name ?? data.itemId ?? fallback,
      icon: item?.icon ?? '?',
    };
  };

  const inputHandleIds: string[] = [];
  for (const n of inputNodes) {
    const iface = n.data as InterfaceNodeData;
    if (iface.itemId) inputHandleIds.push(handleIdForSubgraphInput(n.id, iface.itemId));
  }
  const bottleneck = inputBottleneck(handleFlows, inputHandleIds);
  const isBottlenecked = bottleneck < 1 - FLOW_EPS;

  return (
    <div className="grid min-h-[32px] grid-cols-2 gap-0 py-1">
      <div>
        {inputNodes.length === 0 && (
          <div className="px-3 py-1 text-[10px] italic text-[#6b7388]">no inputs</div>
        )}
        {inputNodes.map((n) => {
          const iface = n.data as InterfaceNodeData;
          if (!iface.itemId) return null;
          const { name, icon } = renderItem('input', iface);
          const rate = (rates.inputs.get(n.id) ?? 0) * count;
          const handleId = handleIdForSubgraphInput(n.id, iface.itemId);
          return (
            <ItemHandle
              key={n.id}
              id={handleId}
              nodeId={nodeId}
              side="left"
              itemName={name}
              itemIcon={icon}
              rateLabel={`${rate.toFixed(1)}/min`}
              satisfaction={handleFlows?.[handleId]?.satisfaction}
            />
          );
        })}
      </div>
      <div>
        {outputNodes.length === 0 && (
          <div className="px-3 py-1 text-[10px] italic text-[#6b7388]">no outputs</div>
        )}
        {outputNodes.map((n) => {
          const iface = n.data as InterfaceNodeData;
          if (!iface.itemId) return null;
          const { name, icon } = renderItem('output', iface);
          const nominal = (rates.outputs.get(n.id) ?? 0) * count;
          const actual = nominal * bottleneck;
          return (
            <ItemHandle
              key={n.id}
              id={handleIdForSubgraphOutput(n.id, iface.itemId)}
              nodeId={nodeId}
              side="right"
              itemName={name}
              itemIcon={icon}
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
  );
}

