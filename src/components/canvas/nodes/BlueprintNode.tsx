import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Package } from 'lucide-react';
import SubgraphHandlesGrid from './SubgraphHandlesGrid';
import { loadGameData } from '@/data/loader';
import { useBlueprintStore } from '@/store/blueprintStore';
import { graphFromBlueprint, graphInterfaceRates } from '@/models/flow';
import { useSubgraphResolver } from '@/hooks/useSubgraphResolver';
import type { HandleFlow } from '@/models/flow';
import type { BlueprintNodeData } from '@/models/graph';

const gameData = loadGameData();

function BlueprintNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as BlueprintNodeData & {
    handleFlows?: Record<string, HandleFlow>;
  };
  const bp = useBlueprintStore((s) => s.blueprints[nodeData.blueprintId]);
  const resolver = useSubgraphResolver();

  if (!bp) {
    return (
      <div className="min-w-[220px] rounded-md border border-red-500/60 bg-panel px-3 py-2 text-sm text-red-400 shadow-lg">
        Missing blueprint
      </div>
    );
  }

  const rates = graphInterfaceRates(graphFromBlueprint(bp), gameData, resolver);
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
      <SubgraphHandlesGrid
        nodeId={id}
        rates={rates}
        count={count}
        handleFlows={nodeData.handleFlows}
      />
    </div>
  );
}

export default memo(BlueprintNode);
