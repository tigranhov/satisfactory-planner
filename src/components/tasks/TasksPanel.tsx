import { useMemo } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Factory,
  Hammer,
  Layers,
  LogIn,
  LogOut,
  Merge,
  Package,
  Split,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useGraphStore } from '@/store/graphStore';
import { useBlueprintStore } from '@/store/blueprintStore';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { loadGameData } from '@/data/loader';
import InlineItemText from '@/components/ui/InlineItemText';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { ROOT_GRAPH_ID } from '@/lib/ids';
import {
  buildCostForNode,
  plannedBuildCost,
  sortItemsByValue,
  type PlannedBuildCost,
} from '@/lib/aggregate';
import { formatNumber } from '@/lib/format';
import type { GraphId, GraphNode, NodeData } from '@/models/graph';
import type { RecipeIO } from '@/data/types';

const gameData = loadGameData();

interface NodeDisplay {
  icon: LucideIcon;
  label: string;
}

function describeNode(data: NodeData, blueprintName: (id: string) => string | undefined): NodeDisplay {
  switch (data.kind) {
    case 'recipe':
      return { icon: Factory, label: gameData.recipes[data.recipeId]?.name ?? data.recipeId };
    case 'factory':
      return { icon: Layers, label: data.label || 'Factory' };
    case 'blueprint':
      return { icon: Package, label: blueprintName(data.blueprintId) ?? 'Missing blueprint' };
    case 'input':
      return {
        icon: LogIn,
        label: data.label || (data.itemId ? gameData.items[data.itemId]?.name ?? data.itemId : 'Input'),
      };
    case 'output':
      return {
        icon: LogOut,
        label: data.label || (data.itemId ? gameData.items[data.itemId]?.name ?? data.itemId : 'Output'),
      };
    case 'hub':
      return { icon: Waypoints, label: data.label || 'Hub' };
    case 'splitter':
      return { icon: Split, label: data.label || 'Splitter' };
    case 'merger':
      return { icon: Merge, label: data.label || 'Merger' };
  }
}

export default function TasksPanel() {
  const graphs = useGraphStore((s) => s.graphs);
  const updateNode = useGraphStore((s) => s.updateNode);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setTaskPanelOpen = useUiStore((s) => s.setTaskPanelOpen);
  const navigateToNode = useUiStore((s) => s.navigateToNode);
  const costOpen = useUiStore((s) => s.infoSectionsOpen['tasks-cost'] ?? false);
  const setInfoSectionOpen = useUiStore((s) => s.setInfoSectionOpen);

  const blueprintName = (id: string) => blueprints[id]?.name;

  const costData = useMemo(() => plannedBuildCost(graphs, gameData), [graphs]);

  const markBuilt = (graphId: GraphId, node: GraphNode) => {
    updateNode(graphId, node.id, { data: { ...node.data, status: 'built' } });
  };

  const { sections, builtCount, totalTagged } = useMemo(() => {
    // Show root first, then subgraphs in stable id order so the panel doesn't
    // reshuffle as other state changes.
    const graphIds: GraphId[] = [
      ROOT_GRAPH_ID,
      ...Object.keys(graphs).filter((id) => id !== ROOT_GRAPH_ID).sort(),
    ];
    let built = 0;
    let tagged = 0;
    const sections: Array<{ graphId: GraphId; graphName: string; nodes: GraphNode[] }> = [];
    for (const graphId of graphIds) {
      const g = graphs[graphId];
      if (!g) continue;
      const planned: GraphNode[] = [];
      for (const n of g.nodes) {
        if (n.data.status === 'planned') {
          planned.push(n);
          tagged += 1;
        } else if (n.data.status === 'built') {
          built += 1;
          tagged += 1;
        }
      }
      if (planned.length > 0) {
        planned.sort((a, b) => a.position.y - b.position.y);
        sections.push({ graphId, graphName: g.name, nodes: planned });
      }
    }
    return { sections, builtCount: built, totalTagged: tagged };
  }, [graphs]);

  const handleClose = () => {
    if (activeProjectId) setTaskPanelOpen(activeProjectId, false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-panel-hi px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          Tasks
        </div>
        <button
          onClick={handleClose}
          title="Close tasks panel"
          className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="border-b border-border px-3 py-2 text-xs text-[#9aa2b8]">
        {totalTagged === 0 ? (
          <span>No tagged nodes yet. Right-click a node to mark it Planned or Built.</span>
        ) : (
          <span>
            Built: <span className="font-medium text-[#e6e8ee]">{builtCount}</span> /{' '}
            {totalTagged} tagged
          </span>
        )}
      </div>

      <CostSummary
        cost={costData}
        open={costOpen}
        onToggle={() => setInfoSectionOpen('tasks-cost', !costOpen)}
      />

      <div className="flex-1 overflow-y-auto">
        {sections.length === 0 && totalTagged > 0 && (
          <div className="px-3 py-4 text-xs text-[#6b7388]">
            All tagged nodes are marked Built. Nothing left to plan.
          </div>
        )}
        {sections.map((section) => (
          <div key={section.graphId} className="border-b border-border/60 last:border-b-0">
            <div className="bg-panel-hi/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#6b7388]">
              <InlineItemText text={section.graphName} />
            </div>
            {section.nodes.map((node) => {
              const { icon: Icon, label } = describeNode(node.data, blueprintName);
              const note = node.data.taskNote;
              const cost = buildCostForNode(node, gameData);
              return (
                <div
                  key={node.id}
                  className="group flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-panel-hi"
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <button
                    onClick={() => navigateToNode(section.graphId, node.id)}
                    className="min-w-0 flex-1 text-left"
                    title="Open in canvas"
                  >
                    <div className="truncate">
                      <InlineItemText text={label} />
                    </div>
                    {note && (
                      <div
                        className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[11px] text-[#9aa2b8]"
                        title={note}
                      >
                        {note}
                      </div>
                    )}
                    {cost && cost.length > 0 && <TaskCostLine cost={cost} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markBuilt(section.graphId, node);
                    }}
                    title="Mark built"
                    className="mt-0.5 shrink-0 rounded p-1 text-[#6b7388] opacity-0 hover:bg-panel hover:text-emerald-400 group-hover:opacity-100"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CostSummary({
  cost,
  open,
  onToggle,
}: {
  cost: PlannedBuildCost;
  open: boolean;
  onToggle: () => void;
}) {
  const items = useMemo(() => sortItemsByValue(cost.summary, gameData), [cost]);
  if (items.length === 0) return null;
  const ChevIcon = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 bg-panel-hi/40 px-3 py-1.5 text-left text-[11px] text-[#9aa2b8] hover:bg-panel-hi"
        title="Toggle planned build cost"
      >
        <span className="flex items-center gap-1.5">
          <Hammer className="h-3 w-3 text-accent" />
          <span className="font-medium uppercase tracking-wider text-[10px]">
            Build cost
          </span>
          <span className="text-[#6b7388]">({items.length} resources)</span>
        </span>
        <ChevIcon className="h-3.5 w-3.5 text-[#6b7388]" />
      </button>
      {open && (
        <div className="px-3 py-1.5">
          {items.map((row) => (
            <div
              key={row.itemId}
              className="flex items-center justify-between gap-2 py-0.5 text-xs"
            >
              <div className="flex min-w-0 items-center gap-2">
                <IconOrLabel
                  iconBasename={row.icon}
                  name={row.name}
                  className="inline-block h-4 w-4 rounded"
                />
                <span className="truncate text-[#e6e8ee]">{row.name}</span>
              </div>
              <span className="shrink-0 font-medium tabular-nums text-[#e6e8ee]">
                {formatNumber(row.value, 1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCostLine({ cost }: { cost: RecipeIO[] }) {
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[#6b7388]">
      {cost.map((io, idx) => {
        const item = gameData.items[io.itemId];
        return (
          <span key={`${io.itemId}-${idx}`} className="inline-flex items-center gap-1">
            <IconOrLabel
              iconBasename={item?.icon}
              name={item?.name ?? io.itemId}
              className="inline-block h-3 w-3 rounded"
            />
            <span className="tabular-nums">{formatNumber(io.amount, 1)}</span>
          </span>
        );
      })}
    </div>
  );
}
