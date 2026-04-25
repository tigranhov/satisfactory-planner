import type { MachineGroup } from '@/lib/aggregate';
import type { GameData } from '@/data/types';
import IconOrLabel from '@/components/ui/IconOrLabel';

interface Props {
  groups: MachineGroup[];
  gameData: GameData;
}

function formatCount(count: number): string {
  if (Number.isInteger(count)) return String(count);
  return count.toFixed(2).replace(/\.?0+$/, '');
}

function clockBadge(clockSpeed: number): { label: string; className: string } | null {
  if (Math.abs(clockSpeed - 1) < 1e-6) return null;
  const pct = (clockSpeed * 100).toFixed(0);
  if (clockSpeed > 1) {
    return { label: `${pct}%`, className: 'text-amber-400' };
  }
  return { label: `${pct}%`, className: 'text-sky-400' };
}

export default function MachinesSection({ groups, gameData }: Props) {
  if (groups.length === 0) return null;

  return (
    <div>
      {groups.map((g) => {
        const machine = gameData.machines[g.machineId];
        const recipe = gameData.recipes[g.recipeId];
        const machineName = machine?.name ?? g.machineId;
        const recipeName = recipe?.name ?? g.recipeId;
        const badge = clockBadge(g.clockSpeed);
        return (
          <div
            key={`${g.machineId}::${g.recipeId}::${g.clockSpeed.toFixed(3)}`}
            className="flex items-center gap-2 px-3 py-1 text-xs"
          >
            <span className="shrink-0 font-medium tabular-nums text-[#e6e8ee]">
              {formatCount(g.count)}×
            </span>
            <IconOrLabel
              iconBasename={machine?.icon}
              name={machineName}
              className="inline-block h-4 w-4 rounded"
            />
            <span className="min-w-0 flex-1 truncate text-[#9aa2b8]">
              <span className="text-[#e6e8ee]">{machineName}</span>
              <span className="px-1 text-[#6b7388]">·</span>
              <span>{recipeName}</span>
            </span>
            {badge && (
              <span className={`shrink-0 font-medium tabular-nums ${badge.className}`}>
                {badge.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
