import { useState } from 'react';
import { BookOpen, ChevronRight, Save, FolderOpen, Plus } from 'lucide-react';
import { useGraphStore } from '@/store/graphStore';
import { useNavigationStore } from '@/store/navigationStore';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import { newGraphId } from '@/lib/ids';
import BlueprintBook from '@/components/blueprints/BlueprintBook';

export default function TopBar() {
  const [bookOpen, setBookOpen] = useState(false);
  const stack = useNavigationStore((s) => s.stack);
  const popTo = useNavigationStore((s) => s.popTo);
  const graphs = useGraphStore((s) => s.graphs);
  const activeGraphId = useActiveGraphId();
  const addNodeToActive = useGraphStore((s) => s.addNode);
  const graphsState = useGraphStore.getState;

  const handleAddComposite = () => {
    const subId = newGraphId();
    // Register the new subgraph
    useGraphStore.setState((s) => ({
      graphs: {
        ...s.graphs,
        [subId]: { id: subId, name: 'Subgraph', nodes: [], edges: [] },
      },
    }));
    addNodeToActive(activeGraphId, { x: 200, y: 200 }, {
      kind: 'composite',
      subGraphId: subId,
      label: 'Subgraph',
    });
    // Keep ref to avoid unused warning
    void graphsState;
  };

  return (
    <div className="flex items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex items-center gap-2 text-sm">
        {stack.map((id, i) => {
          const name = graphs[id]?.name ?? id;
          const isLast = i === stack.length - 1;
          return (
            <div key={`${id}-${i}`} className="flex items-center gap-2">
              <button
                onClick={() => popTo(i)}
                className={`rounded px-2 py-1 hover:bg-panel-hi ${
                  isLast ? 'text-accent' : 'text-[#e6e8ee]'
                }`}
              >
                {name}
              </button>
              {!isLast && <ChevronRight className="h-4 w-4 text-[#6b7388]" />}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setBookOpen(true)}
          className="flex items-center gap-1 rounded bg-panel-hi px-3 py-1 text-sm hover:bg-border"
          title="Open blueprint library"
        >
          <BookOpen className="h-4 w-4" />
          Blueprints
        </button>
        <button
          onClick={handleAddComposite}
          className="flex items-center gap-1 rounded bg-panel-hi px-3 py-1 text-sm hover:bg-border"
          title="Add composite (nested) node"
        >
          <Plus className="h-4 w-4" />
          Composite
        </button>
        <button
          className="flex items-center gap-1 rounded bg-panel-hi px-3 py-1 text-sm hover:bg-border"
          disabled
          title="Not implemented yet"
        >
          <FolderOpen className="h-4 w-4" />
          Open
        </button>
        <button
          className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-sm text-[#1b1410] hover:bg-accent-hi"
          disabled
          title="Not implemented yet"
        >
          <Save className="h-4 w-4" />
          Save
        </button>
      </div>
      <BlueprintBook open={bookOpen} onClose={() => setBookOpen(false)} />
    </div>
  );
}
