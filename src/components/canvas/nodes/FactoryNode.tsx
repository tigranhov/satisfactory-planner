import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Layers } from 'lucide-react';
import SubgraphHandlesGrid from './SubgraphHandlesGrid';
import { loadGameData } from '@/data/loader';
import { useGraphStore } from '@/store/graphStore';
import { graphInterfaceRates } from '@/models/flow';
import { useSubgraphResolver } from '@/hooks/useSubgraphResolver';
import type { HandleFlow } from '@/models/flow';
import type { FactoryNodeData } from '@/models/graph';

const gameData = loadGameData();

function FactoryNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FactoryNodeData & {
    handleFlows?: Record<string, HandleFlow>;
  };
  const subGraph = useGraphStore((s) => s.graphs[nodeData.factoryGraphId]);
  const resolver = useSubgraphResolver();

  if (!subGraph) {
    return (
      <div className="min-w-[220px] rounded-md border border-red-500/60 bg-panel px-3 py-2 text-sm text-red-400 shadow-lg">
        Missing factory
      </div>
    );
  }

  const rates = graphInterfaceRates(subGraph, gameData, resolver);

  return (
    <div
      className={`min-w-[240px] rounded-md border-2 border-dashed bg-panel text-sm shadow-lg ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-md border-b border-border bg-panel-hi px-3 py-1.5">
        <Layers className="h-4 w-4 shrink-0 text-accent" />
        <span className="truncate font-medium">{nodeData.label}</span>
      </div>
      <SubgraphHandlesGrid nodeId={id} rates={rates} count={1} handleFlows={nodeData.handleFlows} />
      <div className="rounded-b-md border-t border-border bg-panel-hi px-3 py-1 text-[10px] text-[#6b7388]">
        Double-click to open
      </div>
    </div>
  );
}

export default memo(FactoryNode);
