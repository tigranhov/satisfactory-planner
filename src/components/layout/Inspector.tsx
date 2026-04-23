import { useActiveGraph } from '@/hooks/useActiveGraph';
import { useGraphStore } from '@/store/graphStore';
import { useBlueprintStore } from '@/store/blueprintStore';
import { loadGameData } from '@/data/loader';
import { nodePowerMW, type HublikeKind } from '@/models/factory';
import PowerReadout from '@/components/canvas/editors/PowerReadout';

const gameData = loadGameData();

const HUBLIKE_DESCRIPTIONS: Record<HublikeKind, string> = {
  hub: 'Hub node — item type is set by the first connection.',
  splitter:
    'Splitter — splits on demand across 3 outputs. Unused capacity backs up the input line, matching in-game behavior.',
  merger:
    'Merger — combines up to 3 inputs into a single output. Downstream throttling backs pressure up through all inputs.',
};

interface Props {
  selectedNodeId: string | null;
}

export default function Inspector({ selectedNodeId }: Props) {
  const activeGraph = useActiveGraph();
  const updateNode = useGraphStore((s) => s.updateNode);
  const selectedNode = activeGraph?.nodes.find((n) => n.id === selectedNodeId);
  const selectedBlueprintId =
    selectedNode?.data.kind === 'blueprint' ? selectedNode.data.blueprintId : null;
  const selectedBlueprint = useBlueprintStore((s) =>
    selectedBlueprintId ? s.blueprints[selectedBlueprintId] : undefined,
  );

  if (!activeGraph || !selectedNodeId) {
    return (
      <div className="border-l border-border bg-panel p-4 text-sm text-[#6b7388]">
        Select a node to inspect.
      </div>
    );
  }

  const node = activeGraph.nodes.find((n) => n.id === selectedNodeId);
  if (!node) {
    return (
      <div className="border-l border-border bg-panel p-4 text-sm text-[#6b7388]">
        No node selected.
      </div>
    );
  }

  if (node.data.kind === 'recipe') {
    const recipeData = node.data;
    const recipe = gameData.recipes[recipeData.recipeId];
    const power = nodePowerMW(recipe, recipeData, gameData);
    return (
      <div className="flex h-full flex-col border-l border-border bg-panel p-4 text-sm">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#6b7388]">Recipe Node</div>
        <div className="mb-3 text-lg font-medium">{recipe.name}</div>
        <label className="mb-2 text-xs">Count</label>
        <input
          type="number"
          min={1}
          value={recipeData.count}
          onChange={(e) => {
            const count = Math.max(1, Number(e.target.value) || 1);
            updateNode(activeGraph.id, node.id, {
              data: { ...recipeData, count },
            });
          }}
          className="mb-3 rounded border border-border bg-panel-hi px-2 py-1 outline-none focus:border-accent"
        />
        <label className="mb-2 text-xs">Clock Speed</label>
        <input
          type="number"
          step={0.05}
          min={0.01}
          max={2.5}
          value={recipeData.clockSpeed}
          onChange={(e) => {
            const clockSpeed = Math.min(2.5, Math.max(0.01, Number(e.target.value) || 1));
            updateNode(activeGraph.id, node.id, {
              data: { ...recipeData, clockSpeed },
            });
          }}
          className="mb-3 rounded border border-border bg-panel-hi px-2 py-1 outline-none focus:border-accent"
        />
        <div className="mt-2 border-t border-border pt-2 text-xs text-[#6b7388]">
          <div>Machine: {gameData.machines[recipe.machineId]?.name}</div>
          <div>
            <PowerReadout powerMW={power} />
          </div>
          <div>Duration: {recipe.durationSec}s</div>
        </div>
      </div>
    );
  }

  if (node.data.kind === 'factory') {
    const facData = node.data;
    const renameFactory = (label: string) => {
      updateNode(activeGraph.id, node.id, { data: { ...facData, label } });
      useGraphStore.getState().renameGraph(facData.factoryGraphId, label);
    };
    return (
      <div className="flex h-full flex-col border-l border-border bg-panel p-4 text-sm">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#6b7388]">Factory Node</div>
        <label className="mb-2 text-xs">Name</label>
        <input
          type="text"
          value={facData.label}
          onChange={(e) => renameFactory(e.target.value)}
          className="mb-3 rounded border border-border bg-panel-hi px-2 py-1 text-lg font-medium outline-none focus:border-accent"
        />
        <div className="mt-2 text-xs text-[#6b7388]">
          Double-click the node on the canvas to open its subgraph.
        </div>
      </div>
    );
  }

  if (node.data.kind === 'blueprint') {
    const bpData = node.data;
    const bp = selectedBlueprint;
    return (
      <div className="flex h-full flex-col border-l border-border bg-panel p-4 text-sm">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#6b7388]">Blueprint Node</div>
        <div className="mb-3 text-lg font-medium">{bp?.name ?? 'Missing blueprint'}</div>
        <label className="mb-2 text-xs">Count</label>
        <input
          type="number"
          min={1}
          value={bpData.count}
          onChange={(e) => {
            const count = Math.max(1, Math.floor(Number(e.target.value) || 1));
            updateNode(activeGraph.id, node.id, {
              data: { ...bpData, count },
            });
          }}
          className="mb-3 rounded border border-border bg-panel-hi px-2 py-1 outline-none focus:border-accent"
        />
        {bp?.description && (
          <div className="mt-2 border-t border-border pt-2 text-xs text-[#9aa2b8]">
            {bp.description}
          </div>
        )}
      </div>
    );
  }

  const { kind } = node.data;
  if (kind === 'hub' || kind === 'splitter' || kind === 'merger') {
    return (
      <div className="border-l border-border bg-panel p-4 text-sm text-[#6b7388]">
        {HUBLIKE_DESCRIPTIONS[kind]}
      </div>
    );
  }

  return (
    <div className="border-l border-border bg-panel p-4 text-sm text-[#6b7388]">
      Interface node ({node.data.kind}): {node.data.itemId}
    </div>
  );
}
