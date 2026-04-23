import { useMemo, useRef, useState } from 'react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { useGraphStore } from '@/store/graphStore';
import { useNavigationStore } from '@/store/navigationStore';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import { useProjectStore } from '@/store/projectStore';
import { newGraphId } from '@/lib/ids';
import BlueprintBook from '@/components/blueprints/BlueprintBook';
import {
  createProjectPersistent,
  deleteProjectPersistent,
  renameActiveProjectPersistent,
  switchProjectPersistent,
} from '@/data/projectPersistence';
import { useUpdater } from '@/hooks/useUpdater';

export default function TopBar() {
  const [bookOpen, setBookOpen] = useState(false);
  const stack = useNavigationStore((s) => s.stack);
  const popTo = useNavigationStore((s) => s.popTo);
  const graphs = useGraphStore((s) => s.graphs);
  const activeGraphId = useActiveGraphId();
  const addNodeToActive = useGraphStore((s) => s.addNode);
  const registerGraph = useGraphStore((s) => s.registerGraph);

  const handleAddFactory = () => {
    const factoryGraphId = newGraphId();
    registerGraph(factoryGraphId, 'Factory');
    addNodeToActive(activeGraphId, { x: 200, y: 200 }, {
      kind: 'factory',
      factoryGraphId,
      label: 'Factory',
    });
  };

  return (
    <div className="flex items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex items-center gap-2 text-sm">
        <ProjectSwitcher />
        <span className="mx-1 h-5 w-px bg-border" />
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
        <UpdateChip />
        <button
          onClick={() => setBookOpen(true)}
          className="flex items-center gap-1 rounded bg-panel-hi px-3 py-1 text-sm hover:bg-border"
          title="Open blueprint library"
        >
          <BookOpen className="h-4 w-4" />
          Blueprints
        </button>
        <button
          onClick={handleAddFactory}
          className="flex items-center gap-1 rounded bg-panel-hi px-3 py-1 text-sm hover:bg-border"
          title="Add nested factory"
        >
          <Plus className="h-4 w-4" />
          Factory
        </button>
      </div>
      <BlueprintBook open={bookOpen} onClose={() => setBookOpen(false)} />
    </div>
  );
}

function UpdateChip() {
  const status = useUpdater();

  if (status.phase === 'downloaded') {
    return (
      <button
        onClick={() => void window.api?.quitAndInstallUpdate()}
        title={`Update ${status.version} ready — click to restart and install`}
        className="flex items-center gap-1.5 rounded border border-accent bg-accent/10 px-3 py-1 text-sm font-medium text-accent hover:bg-accent/20"
      >
        <RotateCw className="h-3.5 w-3.5" />
        Restart to update
      </button>
    );
  }

  if (status.phase === 'downloading') {
    return (
      <div
        title={`Downloading update ${status.percent}%`}
        className="flex items-center gap-1.5 rounded border border-border px-3 py-1 text-xs text-[#9aa2b8]"
      >
        <Download className="h-3.5 w-3.5 animate-pulse" />
        {status.percent}%
      </div>
    );
  }

  if (status.phase === 'error') {
    return (
      <div
        title={`Update check failed: ${status.message}`}
        className="flex items-center gap-1.5 rounded border border-red-500/50 px-3 py-1 text-xs text-red-400"
      >
        Update failed
      </div>
    );
  }

  return null;
}

function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );
  const active = activeProjectId ? projects[activeProjectId] : null;

  usePopoverDismiss(rootRef, () => setOpen(false), { escape: true });

  const handleCreate = async () => {
    await createProjectPersistent('Untitled');
    setOpen(false);
  };

  const handleSwitch = async (id: string) => {
    await switchProjectPersistent(id);
    setOpen(false);
  };

  const startRename = () => {
    if (!active) return;
    setNameDraft(active.name);
    setRenaming(true);
    setOpen(false);
  };

  const commitRename = async () => {
    const trimmed = nameDraft.trim();
    if (active && trimmed && trimmed !== active.name) {
      await renameActiveProjectPersistent(active.id, trimmed);
    }
    setRenaming(false);
  };

  const handleDelete = async () => {
    if (!active) return;
    if (!window.confirm(`Delete project "${active.name}"? This cannot be undone.`)) return;
    await deleteProjectPersistent(active.id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      {renaming && active ? (
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="w-[180px] rounded border border-accent bg-panel-hi px-2 py-1 text-sm outline-none"
        />
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded bg-panel-hi px-3 py-1 text-sm hover:bg-border"
          title="Switch project"
        >
          <Folder className="h-4 w-4 text-accent" />
          <span className="truncate max-w-[160px]">{active?.name ?? 'No project'}</span>
          <ChevronDown className="h-3.5 w-3.5 text-[#6b7388]" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[260px] rounded-md border border-border bg-panel shadow-xl">
          <div className="max-h-[280px] overflow-y-auto p-1">
            {sorted.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <button
                  key={p.id}
                  onClick={() => void handleSwitch(p.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-panel-hi ${
                    isActive ? 'text-accent' : 'text-[#e6e8ee]'
                  }`}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-accent" />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border p-1">
            <button
              onClick={() => void handleCreate()}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#e6e8ee] hover:bg-panel-hi"
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </button>
            <button
              onClick={startRename}
              disabled={!active}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#e6e8ee] hover:bg-panel-hi disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename active
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={!active}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-400 hover:bg-panel-hi disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete active
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
