import type { SomersloopUsageRow } from '@/lib/aggregate';
import type { GameData } from '@/data/types';
import type { GraphId } from '@/models/graph';
import { useUiStore } from '@/store/uiStore';

interface Props {
  usage: SomersloopUsageRow[];
  graphId: GraphId;
  gameData: GameData;
}

export default function SomersloopSection({ usage, graphId, gameData }: Props) {
  const navigateToNode = useUiStore((s) => s.navigateToNode);
  if (usage.length === 0) return null;

  return (
    <div>
      {usage.map((u) => {
        const recipeName = gameData.recipes[u.recipeId]?.name ?? u.recipeId;
        return (
          <button
            key={u.nodeId}
            onClick={() => navigateToNode(graphId, u.nodeId)}
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-panel-hi"
            title="Open in canvas"
          >
            <span className="shrink-0 font-medium tabular-nums text-fuchsia-400">
              {u.somersloops}/{u.slots}
            </span>
            <span className="min-w-0 flex-1 truncate text-[#e6e8ee]">{recipeName}</span>
            <span className="shrink-0 font-medium tabular-nums text-fuchsia-400">
              +{u.boostPct.toFixed(0)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
