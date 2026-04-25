import { AlertCircle, AlertTriangle, type LucideIcon } from 'lucide-react';
import type { Issue, IssueSeverity } from '@/lib/aggregate';
import { useUiStore } from '@/store/uiStore';
import type { GameData } from '@/data/types';
import type { Graph, GraphId, GraphNode, NodeId } from '@/models/graph';

const SEV: Record<IssueSeverity, { icon: LucideIcon; className: string }> = {
  error: { icon: AlertCircle, className: 'text-red-400' },
  warn: { icon: AlertTriangle, className: 'text-amber-400' },
};

interface Props {
  issues: Issue[];
  graph: Graph;
  graphId: GraphId;
  gameData: GameData;
}

function nodeLabel(node: GraphNode | undefined, gameData: GameData): string {
  if (!node) return 'Missing node';
  const d = node.data;
  switch (d.kind) {
    case 'recipe':
      return gameData.recipes[d.recipeId]?.name ?? d.recipeId;
    case 'factory':
      return d.label || 'Factory';
    case 'blueprint':
      return 'Blueprint';
    case 'input':
      return (
        d.label || (d.itemId ? gameData.items[d.itemId]?.name ?? d.itemId : 'Input')
      );
    case 'output':
      return (
        d.label || (d.itemId ? gameData.items[d.itemId]?.name ?? d.itemId : 'Output')
      );
    case 'hub':
      return d.label || 'Hub';
    case 'splitter':
      return d.label || 'Splitter';
    case 'merger':
      return d.label || 'Merger';
  }
}

export default function IssuesSection({ issues, graph, graphId, gameData }: Props) {
  const navigateToNode = useUiStore((s) => s.navigateToNode);
  if (issues.length === 0) return null;

  const nodeById = new Map<NodeId, GraphNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  return (
    <div>
      {issues.map((issue, i) => {
        const sev = SEV[issue.severity];
        const Icon = sev.icon;
        const label = nodeLabel(nodeById.get(issue.nodeId), gameData);
        return (
          <button
            key={`${issue.kind}-${issue.nodeId}-${i}`}
            onClick={() => navigateToNode(graphId, issue.nodeId)}
            className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-panel-hi"
            title="Open in canvas"
          >
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${sev.className}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[#e6e8ee]">{label}</div>
              <div className="text-[#9aa2b8]">{issue.message}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
