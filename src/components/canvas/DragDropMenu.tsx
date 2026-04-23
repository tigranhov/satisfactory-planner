import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Merge, Search, Split, Waypoints } from 'lucide-react';
import {
  getRecipesConsuming,
  getRecipesProducing,
  loadGameData,
} from '@/data/loader';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import { useBlueprintStore } from '@/store/blueprintStore';
import { canPlaceBlueprint } from '@/hooks/useBlueprintEditorBridge';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import { PickerRow, BlueprintRowButton } from './CanvasContextMenu';
import type { Recipe } from '@/data/types';
import type { Blueprint } from '@/models/blueprint';
import type { HublikeKind } from '@/models/factory';
import type { InterfaceNodeData } from '@/models/graph';

const gameData = loadGameData();

type InterfaceKind = InterfaceNodeData['kind'];

export type DragDropChoice =
  | { kind: 'recipe'; recipeId: string }
  | { kind: 'blueprint'; blueprintId: string }
  | { kind: 'hublike'; which: HublikeKind }
  | { kind: 'interface'; which: InterfaceKind };

interface Props {
  screenPosition: { x: number; y: number };
  // Item the dragged handle carries. '' means the source is an unset
  // hub-like or a fresh Input/Output — show the unfiltered picker.
  itemId: string;
  // 'source' means the user is dragging OUT of a source handle (looking
  // for something that consumes the item). 'target' means dragging INTO
  // a target (looking for a producer).
  handleType: 'source' | 'target';
  allowInterface?: boolean;
  onClose: () => void;
  onPick: (choice: DragDropChoice) => void;
}

// Flat, indexable candidate list drives both rendering and keyboard nav.
type Candidate =
  | { kind: 'interface'; which: InterfaceKind }
  | { kind: 'hublike'; which: HublikeKind }
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'blueprint'; bp: Blueprint };

export default function DragDropMenu({
  screenPosition,
  itemId,
  handleType,
  allowInterface = false,
  onClose,
  onPick,
}: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeGraphId = useActiveGraphId();
  const blueprints = useBlueprintStore((s) => s.blueprints);

  usePopoverDismiss(rootRef, onClose, { escape: true });

  useEffect(() => inputRef.current?.focus(), []);

  const item = itemId ? gameData.items[itemId] : undefined;
  // Drag from a SOURCE handle wants a consumer of the item; drag from a
  // TARGET handle wants a producer. When the source is unset ('' item),
  // this flag only affects the Input/Output shortcut direction.
  const lookingFor: 'consumer' | 'producer' = handleType === 'source' ? 'consumer' : 'producer';
  // An unset source means the user is dragging from a hub-like with no
  // committed item, or a fresh Input/Output. Show everything — the first
  // edge will commit the item on both ends via commitAndAddEdge.
  const isUnset = !itemId;

  const placeableBlueprints = useMemo(() => {
    const out: Blueprint[] = [];
    for (const bp of Object.values(blueprints)) {
      if (canPlaceBlueprint(bp.id, activeGraphId)) out.push(bp);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [blueprints, activeGraphId]);

  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    // An unset drag can't commit an interface node to any particular item,
    // so hide the I/O shortcut in that case — the user would get a port
    // with no type and no downstream meaning.
    if (allowInterface && !isUnset) {
      out.push({ kind: 'interface', which: lookingFor === 'consumer' ? 'output' : 'input' });
    }
    out.push({ kind: 'hublike', which: 'hub' });
    out.push({ kind: 'hublike', which: 'splitter' });
    out.push({ kind: 'hublike', which: 'merger' });
    if (isUnset) {
      for (const r of Object.values(gameData.recipes)) {
        if (!r.manualOnly) out.push({ kind: 'recipe', recipe: r });
      }
    } else {
      const recipes =
        lookingFor === 'consumer'
          ? getRecipesConsuming(gameData, itemId)
          : getRecipesProducing(gameData, itemId);
      for (const r of recipes) {
        if (!r.manualOnly) out.push({ kind: 'recipe', recipe: r });
      }
    }
    const matchKind = lookingFor === 'consumer' ? 'input' : 'output';
    for (const bp of placeableBlueprints) {
      if (isUnset) {
        out.push({ kind: 'blueprint', bp });
        continue;
      }
      const matches = bp.nodes.some(
        (n) => n.data.kind === matchKind && n.data.itemId === itemId,
      );
      if (matches) out.push({ kind: 'blueprint', bp });
    }
    return out;
  }, [allowInterface, isUnset, itemId, lookingFor, placeableBlueprints]);

  const filtered = useMemo<Candidate[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      if (c.kind === 'recipe') return c.recipe.name.toLowerCase().includes(q);
      if (c.kind === 'blueprint') return c.bp.name.toLowerCase().includes(q);
      if (c.kind === 'hublike') return c.which.includes(q);
      if (c.kind === 'interface') return c.which.includes(q);
      return false;
    });
  }, [query, candidates]);

  useEffect(() => setActiveIndex(0), [query, itemId, handleType]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pick = (c: Candidate) => {
    if (c.kind === 'recipe') onPick({ kind: 'recipe', recipeId: c.recipe.id });
    else if (c.kind === 'blueprint') onPick({ kind: 'blueprint', blueprintId: c.bp.id });
    else if (c.kind === 'hublike') onPick({ kind: 'hublike', which: c.which });
    else onPick({ kind: 'interface', which: c.which });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[activeIndex];
      if (c) pick(c);
    }
  };

  const MENU_W = 340;
  const MENU_H = 420;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W, height: MENU_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Header item={item} lookingFor={lookingFor} isUnset={isUnset} />
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7388]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search..."
          className="w-full rounded border border-border bg-panel-hi py-1.5 pl-8 pr-2 text-sm text-[#e6e8ee] outline-none focus:border-accent"
        />
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {filtered.length === 0 && (
          <div className="p-3 text-center text-xs text-[#6b7388]">No matches</div>
        )}
        {filtered.map((c, i) => {
          const active = i === activeIndex;
          const hover = () => setActiveIndex(i);
          const onPickRow = () => pick(c);
          if (c.kind === 'interface') {
            const accent = c.which === 'input' ? 'text-sky-300' : 'text-fuchsia-300';
            return (
              <SimpleRow
                key={`iface-${c.which}`}
                index={i}
                active={active}
                iconNode={
                  <div className={`flex h-5 w-5 items-center justify-center rounded bg-panel-hi ${accent}`}>
                    {c.which === 'input' ? '⇥' : '↦'}
                  </div>
                }
                title={c.which === 'input' ? 'New Input' : 'New Output'}
                subtitle={item ? `carries ${item.name}` : 'boundary port'}
                onHover={hover}
                onPick={onPickRow}
              />
            );
          }
          if (c.kind === 'hublike') {
            const { Icon, label, subtitle, tint } = HUBLIKE_ROW_PRESET[c.which];
            return (
              <SimpleRow
                key={`hub-${c.which}`}
                index={i}
                active={active}
                iconNode={<Icon className={`h-4 w-4 ${tint}`} />}
                title={label}
                subtitle={subtitle}
                onHover={hover}
                onPick={onPickRow}
              />
            );
          }
          if (c.kind === 'recipe') {
            return (
              <RecipeRow
                key={`rec-${c.recipe.id}`}
                index={i}
                active={active}
                recipe={c.recipe}
                itemId={itemId}
                lookingFor={lookingFor}
                onHover={hover}
                onPick={onPickRow}
              />
            );
          }
          return (
            <BlueprintRowButton
              key={`bp-${c.bp.id}`}
              bp={c.bp}
              index={i}
              active={active}
              onHover={hover}
              onPick={onPickRow}
            />
          );
        })}
      </div>
    </div>
  );
}

function Header({
  item,
  lookingFor,
  isUnset,
}: {
  item: { name: string; icon?: string } | undefined;
  lookingFor: 'consumer' | 'producer';
  isUnset: boolean;
}) {
  const label = isUnset
    ? 'Connect to'
    : lookingFor === 'consumer'
      ? 'Consume'
      : 'Produce';
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel-hi px-3 py-2">
      <ArrowRight className="h-3.5 w-3.5 text-accent" />
      <span className="text-xs uppercase tracking-wider text-[#9aa2b8]">{label}</span>
      {item && (
        <>
          <IconOrLabel
            iconBasename={item.icon}
            name={item.name}
            className="h-4 w-4 rounded"
          />
          <span className="truncate text-xs font-medium">{item.name}</span>
        </>
      )}
    </div>
  );
}

function SimpleRow({
  index,
  active,
  iconNode,
  title,
  subtitle,
  onHover,
  onPick,
}: {
  index: number;
  active: boolean;
  iconNode: React.ReactNode;
  title: string;
  subtitle: string;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">{iconNode}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-[10px] text-[#6b7388]">{subtitle}</div>
      </div>
    </PickerRow>
  );
}

const HUBLIKE_ROW_PRESET: Record<HublikeKind, { Icon: typeof Waypoints; label: string; subtitle: string; tint: string }> = {
  hub: { Icon: Waypoints, label: 'Hub', subtitle: 'single-item passthrough', tint: 'text-amber-300' },
  splitter: { Icon: Split, label: 'Splitter', subtitle: '1 → 3 on-demand split', tint: 'text-cyan-300' },
  merger: { Icon: Merge, label: 'Merger', subtitle: '3 → 1 combine', tint: 'text-cyan-300' },
};

function RecipeRow({
  index,
  active,
  recipe,
  itemId,
  lookingFor,
  onHover,
  onPick,
}: {
  index: number;
  active: boolean;
  recipe: Recipe;
  itemId: string;
  lookingFor: 'consumer' | 'producer';
  onHover: () => void;
  onPick: () => void;
}) {
  const machine = gameData.machines[recipe.machineId];
  const io = itemId
    ? lookingFor === 'producer'
      ? recipe.products.find((p) => p.itemId === itemId)
      : recipe.ingredients.find((i) => i.itemId === itemId)
    : undefined;
  const rate = io ? (io.amount * 60) / recipe.durationSec : 0;
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <IconOrLabel iconBasename={machine?.icon} name={machine?.name ?? '?'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{recipe.name}</span>
          {recipe.alternate && (
            <span className="shrink-0 rounded border border-accent/40 px-1 text-[9px] uppercase tracking-wider text-accent">
              Alt
            </span>
          )}
        </div>
        <div className="truncate text-[10px] text-[#6b7388]">
          {recipe.ingredients
            .map((ing) => gameData.items[ing.itemId]?.name ?? ing.itemId)
            .join(' + ') || '—'}
          {' → '}
          {recipe.products
            .map((p) => gameData.items[p.itemId]?.name ?? p.itemId)
            .join(' + ')}
        </div>
      </div>
      {io && <span className="shrink-0 text-[10px] text-[#6b7388]">{rate.toFixed(1)}/min</span>}
    </PickerRow>
  );
}
