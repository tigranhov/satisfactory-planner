import { useMemo } from 'react';
import {
  Check,
  CheckCircle2,
  Factory,
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
import { ROOT_GRAPH_ID } from '@/lib/ids';
import type { GraphId, GraphNode, NodeData } from '@/models/graph';

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

  const blueprintName = (id: string) => blueprints[id]?.name;

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
