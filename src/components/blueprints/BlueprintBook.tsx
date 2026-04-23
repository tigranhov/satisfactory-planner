import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Package, Plus, Search, Trash2, X } from 'lucide-react';
import { useBlueprintStore } from '@/store/blueprintStore';
import { loadGameData } from '@/data/loader';
import IconOrLabel from '@/components/ui/IconOrLabel';
import type { Blueprint } from '@/models/blueprint';

const gameData = loadGameData();

interface Props {
  open: boolean;
  onClose: () => void;
}

function deriveIcon(bp: Blueprint): { iconBasename?: string; name: string } {
  const explicit = bp.iconItemId ? gameData.items[bp.iconItemId] : undefined;
  if (explicit) return { iconBasename: explicit.icon, name: explicit.name };
  const outputNode = bp.nodes.find((n) => n.data.kind === 'output');
  if (outputNode && outputNode.data.kind === 'output') {
    const item = gameData.items[outputNode.data.itemId];
    if (item) return { iconBasename: item.icon, name: item.name };
  }
  return { name: bp.name };
}

export default function BlueprintBook({ open, onClose }: Props) {
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const loaded = useBlueprintStore((s) => s.loaded);
  const addBlueprint = useBlueprintStore((s) => s.addBlueprint);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const list = useMemo(() => {
    const all = Object.values(blueprints).sort((a, b) => b.updatedAt - a.updatedAt);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((bp) => {
      if (bp.name.toLowerCase().includes(q)) return true;
      if (bp.description?.toLowerCase().includes(q)) return true;
      if (bp.tags?.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [blueprints, query]);

  const handleNew = () => {
    addBlueprint({
      name: 'Untitled blueprint',
      description: '',
      tags: [],
      nodes: [],
      edges: [],
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[640px] w-[960px] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border bg-panel-hi px-4 py-2.5">
          <Package className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Blueprints</span>
          <div className="relative ml-4 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6b7388]" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, description, or tag..."
              className="w-full rounded border border-border bg-panel py-1 pl-7 pr-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={handleNew}
            className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs font-medium text-[#1b1410] hover:bg-accent-hi"
          >
            <Plus className="h-3.5 w-3.5" />
            New Blueprint
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!loaded && (
            <div className="flex h-full items-center justify-center text-sm text-[#6b7388]">
              Loading library...
            </div>
          )}
          {loaded && list.length === 0 && query === '' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[#6b7388]">
              <Package className="h-10 w-10 opacity-40" />
              <div>No blueprints yet.</div>
              <button
                onClick={handleNew}
                className="mt-2 rounded bg-accent px-3 py-1 text-xs font-medium text-[#1b1410] hover:bg-accent-hi"
              >
                Create your first blueprint
              </button>
            </div>
          )}
          {loaded && list.length === 0 && query !== '' && (
            <div className="flex h-full items-center justify-center text-sm text-[#6b7388]">
              No blueprints match &ldquo;{query}&rdquo;.
            </div>
          )}
          {loaded && list.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {list.map((bp) => (
                <BlueprintCard key={bp.id} blueprint={bp} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  blueprint: Blueprint;
}

function BlueprintCard({ blueprint }: CardProps) {
  const updateBlueprint = useBlueprintStore((s) => s.updateBlueprint);
  const removeBlueprint = useBlueprintStore((s) => s.removeBlueprint);
  const addBlueprint = useBlueprintStore((s) => s.addBlueprint);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(blueprint.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(blueprint.description ?? '');

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== blueprint.name) {
      updateBlueprint(blueprint.id, { name: trimmed });
    } else {
      setNameDraft(blueprint.name);
    }
    setEditingName(false);
  };

  const commitDesc = () => {
    const trimmed = descDraft.trim();
    if (trimmed !== (blueprint.description ?? '')) {
      updateBlueprint(blueprint.id, { description: trimmed });
    }
    setEditingDesc(false);
  };

  const handleTagsChange = (value: string) => {
    const tags = value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    updateBlueprint(blueprint.id, { tags });
  };

  const duplicate = () => {
    addBlueprint({
      name: `${blueprint.name} copy`,
      description: blueprint.description,
      tags: blueprint.tags,
      iconItemId: blueprint.iconItemId,
      nodes: structuredClone(blueprint.nodes),
      edges: structuredClone(blueprint.edges),
    });
  };

  const del = () => {
    if (window.confirm(`Delete blueprint "${blueprint.name}"? This cannot be undone.`)) {
      removeBlueprint(blueprint.id);
    }
  };

  const icon = deriveIcon(blueprint);
  const nodeCount = blueprint.nodes.length;

  return (
    <div className="group flex flex-col gap-2 rounded-md border border-border bg-panel-hi p-3 hover:border-accent/50">
      <div className="flex items-start gap-2">
        <IconOrLabel
          iconBasename={icon.iconBasename}
          name={icon.name}
          className="h-10 w-10 rounded shrink-0"
        />
        <div className="min-w-0 flex-1">
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setNameDraft(blueprint.name);
                  setEditingName(false);
                }
              }}
              className="w-full rounded border border-accent bg-panel px-1 py-0.5 text-sm font-medium outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(blueprint.name);
                setEditingName(true);
              }}
              className="block w-full truncate text-left text-sm font-medium hover:text-accent"
              title="Click to rename"
            >
              {blueprint.name}
            </button>
          )}
          <div className="text-[10px] text-[#6b7388]">
            {nodeCount === 0 ? 'Empty' : `${nodeCount} node${nodeCount === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={duplicate}
            className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
            title="Duplicate"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={del}
            className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editingDesc ? (
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={commitDesc}
          autoFocus
          rows={2}
          placeholder="Description..."
          className="w-full rounded border border-accent bg-panel px-1.5 py-1 text-[11px] outline-none"
        />
      ) : (
        <button
          onClick={() => {
            setDescDraft(blueprint.description ?? '');
            setEditingDesc(true);
          }}
          className="text-left text-[11px] text-[#9aa2b8] hover:text-[#e6e8ee]"
          title="Click to edit description"
        >
          {blueprint.description || <span className="italic text-[#6b7388]">Add description...</span>}
        </button>
      )}

      <input
        type="text"
        defaultValue={(blueprint.tags ?? []).join(', ')}
        onBlur={(e) => handleTagsChange(e.target.value)}
        placeholder="tags, comma separated"
        className="rounded border border-border bg-panel px-1.5 py-0.5 text-[10px] outline-none focus:border-accent"
      />
    </div>
  );
}
