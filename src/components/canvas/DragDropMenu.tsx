import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  getConsumableItems,
  getProducibleItems,
  getRecipesConsuming,
  getRecipesProducing,
  loadGameData,
} from '@/data/loader';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import { useBlueprintStore } from '@/store/blueprintStore';
import { canPlaceBlueprint } from '@/hooks/useBlueprintEditorBridge';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import {
  BlueprintRowButton,
  ItemRowButton,
  PickerRow,
  RecipeRowContent,
} from './CanvasContextMenu';
import PickerHeader from './PickerHeader';
import UtilityNodeStrip, { type UtilityChoice } from './UtilityNodeStrip';
import type { Item, Recipe } from '@/data/types';
import type { Blueprint } from '@/models/blueprint';
import type { HublikeKind } from '@/models/factory';
import type { InterfaceNodeData } from '@/models/graph';

const gameData = loadGameData();

type InterfaceKind = InterfaceNodeData['kind'];

export type DragDropChoice =
  | { kind: 'recipe'; recipeId: string; resolvedItemId?: string }
  | { kind: 'blueprint'; blueprintId: string; resolvedItemId?: string }
  | { kind: 'hublike'; which: HublikeKind }
  | { kind: 'interface'; which: InterfaceKind }
  | { kind: 'target'; resolvedItemId?: string }
  | { kind: 'sink'; resolvedItemId?: string };

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
// Utility-node kinds (hublike/interface/target/sink) live in the side strip,
// not the searchable list — see UtilityNodeStrip.
type Candidate =
  | { kind: 'item'; item: Item }
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'blueprint'; bp: Blueprint };

// Items to surface per drag direction: consumers for source-drags (we want
// something that uses the item), producers for target-drags (we want
// something that makes it). Indices live in loader.ts — computed once.
const itemsByDirection: { consumer: Item[]; producer: Item[] } = {
  consumer: getConsumableItems(gameData),
  producer: getProducibleItems(gameData),
};

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
  // When the drag started from an unset handle the user picks the item
  // first, then the recipe — mirroring the right-click canvas menu. This
  // holds the item chosen on the first screen.
  const [pickedItem, setPickedItem] = useState<Item | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeGraphId = useActiveGraphId();
  const blueprints = useBlueprintStore((s) => s.blueprints);

  // Esc routing is handled in onKeyDown so stage B can step back to stage A
  // before closing — same shape as CanvasContextMenu.
  usePopoverDismiss(rootRef, onClose);

  useEffect(() => inputRef.current?.focus(), [pickedItem]);

  // The committed itemId (if any) or the one the user picked on stage A.
  const effectiveItemId = itemId || pickedItem?.id || '';
  const item = effectiveItemId ? gameData.items[effectiveItemId] : undefined;
  // Drag from a SOURCE handle wants a consumer of the item; drag from a
  // TARGET handle wants a producer. When the source is unset ('' item),
  // this flag only affects the Input/Output shortcut direction.
  const lookingFor: 'consumer' | 'producer' = handleType === 'source' ? 'consumer' : 'producer';
  // True if the handle hasn't committed to any item yet (hub-like without
  // connections, or fresh Input/Output). Stage A of the picker resolves this.
  const isUnset = !itemId;
  const needsItemPick = isUnset && !pickedItem;

  const placeableBlueprints = useMemo(() => {
    const out: Blueprint[] = [];
    for (const bp of Object.values(blueprints)) {
      if (canPlaceBlueprint(bp.id, activeGraphId)) out.push(bp);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [blueprints, activeGraphId]);

  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    // Stage A: unset handle, no item chosen yet. User picks an item first;
    // producers or consumers of that item drive stage B. Placeable blueprints
    // surface as direct shortcuts since they're itemless-compatible.
    if (needsItemPick) {
      for (const it of itemsByDirection[lookingFor]) out.push({ kind: 'item', item: it });
      for (const bp of placeableBlueprints) out.push({ kind: 'blueprint', bp });
      return out;
    }

    // Stage B: we know the item (committed or picked in stage A).
    // Recipes first — the most common choice when dragging from a handle.
    // Loader returns these alternates-last, so no extra sort needed.
    const recipes =
      lookingFor === 'consumer'
        ? getRecipesConsuming(gameData, effectiveItemId)
        : getRecipesProducing(gameData, effectiveItemId);
    for (const r of recipes) {
      if (!r.manualOnly) out.push({ kind: 'recipe', recipe: r });
    }
    const matchKind = lookingFor === 'consumer' ? 'input' : 'output';
    for (const bp of placeableBlueprints) {
      const matches = bp.nodes.some(
        (n) => n.data.kind === matchKind && n.data.itemId === effectiveItemId,
      );
      if (matches) out.push({ kind: 'blueprint', bp });
    }
    return out;
  }, [needsItemPick, effectiveItemId, lookingFor, placeableBlueprints]);

  const filtered = useMemo<Candidate[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      if (c.kind === 'item') return c.item.name.toLowerCase().includes(q);
      if (c.kind === 'recipe') return c.recipe.name.toLowerCase().includes(q);
      return c.bp.name.toLowerCase().includes(q);
    });
  }, [query, candidates]);

  useEffect(() => setActiveIndex(0), [query, itemId, handleType, pickedItem]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pick = (c: Candidate) => {
    if (c.kind === 'item') {
      // Stage-A item pick advances to stage B without calling onPick.
      setPickedItem(c.item);
      setQuery('');
      return;
    }
    const resolvedItemId = effectiveItemId || undefined;
    if (c.kind === 'recipe') onPick({ kind: 'recipe', recipeId: c.recipe.id, resolvedItemId });
    else onPick({ kind: 'blueprint', blueprintId: c.bp.id, resolvedItemId });
  };

  const pickUtility = (choice: UtilityChoice) => {
    const resolvedItemId = effectiveItemId || undefined;
    if (choice.kind === 'hublike') onPick({ kind: 'hublike', which: choice.which });
    else if (choice.kind === 'interface') onPick({ kind: 'interface', which: choice.which });
    else if (choice.kind === 'target') onPick({ kind: 'target', resolvedItemId });
    else onPick({ kind: 'sink', resolvedItemId });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Stage B → stage A; only an unset-handle drag has a stage A to fall
      // back to (committed-handle drags skip straight to stage B).
      if (pickedItem) {
        setPickedItem(null);
        setQuery('');
      } else {
        onClose();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[activeIndex];
      if (c) pick(c);
      return;
    }
    if (e.key === 'Backspace' && query === '' && pickedItem) {
      e.preventDefault();
      setPickedItem(null);
    }
  };

  const MENU_W = 380;
  const MENU_H = 440;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W, height: MENU_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <PickerHeader
          label={HEADER_LABEL[needsItemPick ? 'browse' : 'item'][lookingFor]}
          item={item}
          optionCount={needsItemPick ? undefined : candidates.length}
          onBack={pickedItem ? () => { setPickedItem(null); setQuery(''); } : undefined}
        />
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7388]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={needsItemPick ? 'Search items...' : 'Search...'}
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
            if (c.kind === 'item') {
              return (
                <ItemRowButton
                  key={`item-${c.item.id}`}
                  item={c.item}
                  index={i}
                  active={active}
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
      <UtilityNodeStrip
        allowInterface={allowInterface}
        showTargetSink={lookingFor === 'consumer'}
        onPick={pickUtility}
      />
    </div>
  );
}

const HEADER_LABEL: Record<'browse' | 'item', Record<'consumer' | 'producer', string>> = {
  browse: { consumer: 'Consume item', producer: 'Produce item' },
  item: { consumer: 'Consume', producer: 'Produce' },
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
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <RecipeRowContent
        recipe={recipe}
        itemId={itemId || undefined}
        side={lookingFor}
        showIngredientPreview
        showRate
      />
    </PickerRow>
  );
}
