import { useActiveGraph } from '@/hooks/useActiveGraph';
import { useGraphStore } from '@/store/graphStore';
import { loadGameData } from '@/data/loader';
import { nodePowerMW } from '@/models/factory';

const gameData = loadGameData();

interface Props {
  selectedNodeId: string | null;
}

export default function Inspector({ selectedNodeId }: Props) {
  const activeGraph = useActiveGraph();
  const updateNode = useGraphStore((s) => s.updateNode);

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
    const power = nodePowerMW(recipe, recipeData);
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
          {power < 0 ? (
            <div className="text-accent">
              Generating: {Math.abs(power).toFixed(1)} MW
            </div>
          ) : (
            <div>Power: {power.toFixed(1)} MW</div>
          )}
          <div>Duration: {recipe.durationSec}s</div>
        </div>
      </div>
    );
  }

  if (node.data.kind === 'composite') {
    return (
      <div className="flex h-full flex-col border-l border-border bg-panel p-4 text-sm">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#6b7388]">Composite Node</div>
        <div className="text-lg font-medium">{node.data.label}</div>
        <div className="mt-2 text-xs text-[#6b7388]">
          Double-click the node on the canvas to open its subgraph.
        </div>
      </div>
    );
  }

  return (
    <div className="border-l border-border bg-panel p-4 text-sm text-[#6b7388]">
      Interface node ({node.data.kind}): {node.data.itemId}
    </div>
  );
}
