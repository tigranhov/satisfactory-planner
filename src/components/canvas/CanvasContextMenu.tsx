import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Package, Search } from 'lucide-react';
import { loadGameData, getProducibleItems, getRecipesProducing } from '@/data/loader';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import { useBlueprintStore } from '@/store/blueprintStore';
import { canPlaceBlueprint } from '@/hooks/useBlueprintEditorBridge';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import UtilityNodeStrip, { type UtilityChoice } from './UtilityNodeStrip';
import type { Item, Recipe } from '@/data/types';
import type { Blueprint } from '@/models/blueprint';

const gameData = loadGameData();

// Items that at least one non-manual recipe produces.
const gameProducibleItems: Item[] = getProducibleItems(gameData);

type RecipeRow = { kind: 'recipe'; recipe: Recipe };
type BlueprintRow = { kind: 'blueprint'; bp: Blueprint };
type ItemRow = { kind: 'item'; item: Item };

type RecipePickRow = RecipeRow | BlueprintRow;
type TopRow = ItemRow | BlueprintRow;

// Precomputed item-row array — constant across the app lifetime.
const recipeItemRows: TopRow[] = gameProducibleItems.map<TopRow>((item) => ({ kind: 'item', item }));

interface Props {
  screenPosition: { x: number; y: number };
  flowPosition: { x: number; y: number };
  onClose: () => void;
  onSelectRecipe: (recipeId: string, flowPosition: { x: number; y: number }) => void;
  onSelectBlueprint?: (blueprintId: string, flowPosition: { x: number; y: number }) => void;
  // Input/Output boundary nodes are only meaningful inside a subgraph.
  allowInterface?: boolean;
  onAddInterface?: (
    kind: 'input' | 'output',
    flowPosition: { x: number; y: number },
  ) => void;
  // Utility nodes (hub / splitter / merger) place instantly from the
  // always-visible side strip.
  onAddHublike?: (
    kind: 'hub' | 'splitter' | 'merger',
    flowPosition: { x: number; y: number },
  ) => void;
  onAddTarget?: (flowPosition: { x: number; y: number }) => void;
  onAddSink?: (flowPosition: { x: number; y: number }) => void;
}

function filterByName(rows: TopRow[], query: string): TopRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const name = row.kind === 'blueprint' ? row.bp.name : row.item.name;
    return name.toLowerCase().includes(q);
  });
}

export default function CanvasContextMenu({
  screenPosition,
  flowPosition,
  onClose,
  onSelectRecipe,
  onSelectBlueprint,
  allowInterface = false,
  onAddInterface,
  onAddHublike,
  onAddTarget,
  onAddSink,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeGraphId = useActiveGraphId();
  const blueprints = useBlueprintStore((s) => s.blueprints);

  useEffect(() => inputRef.current?.focus(), [selectedItem]);

  usePopoverDismiss(rootRef, onClose);

  const placeableBlueprints = useMemo(() => {
    const out: Blueprint[] = [];
    for (const bp of Object.values(blueprints)) {
      if (canPlaceBlueprint(bp.id, activeGraphId)) out.push(bp);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [blueprints, activeGraphId]);

  const blueprintsByOutputItem = useMemo(() => {
    const map = new Map<string, Blueprint[]>();
    for (const bp of placeableBlueprints) {
      const outputs = new Set<string>();
      for (const n of bp.nodes) {
        if (n.data.kind === 'output' && n.data.itemId) outputs.add(n.data.itemId);
      }
      for (const itemId of outputs) {
        const arr = map.get(itemId) ?? [];
        arr.push(bp);
        map.set(itemId, arr);
      }
    }
    return map;
  }, [placeableBlueprints]);

  // Stage A: items (recipe-producible) interleaved with placeable blueprints.
  // Items lead — they're the most common path; blueprints follow alphabetically
  // and carry the BP badge so they're visually distinct in the mixed list.
  const topRows = useMemo<TopRow[]>(() => {
    const bpRows: TopRow[] = placeableBlueprints.map((bp) => ({ kind: 'blueprint', bp }));
    return [...recipeItemRows, ...bpRows];
  }, [placeableBlueprints]);

  const filteredTopRows = useMemo(() => filterByName(topRows, query), [topRows, query]);

  const rowsForItem = useMemo<RecipePickRow[]>(() => {
    if (!selectedItem) return [];
    const bps = (blueprintsByOutputItem.get(selectedItem.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const recipes = getRecipesProducing(gameData, selectedItem.id)
      .filter((r) => !r.manualOnly)
      .slice()
      .sort((a, b) => {
        if (a.alternate !== b.alternate) return a.alternate ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    return [
      ...bps.map<RecipePickRow>((bp) => ({ kind: 'blueprint', bp })),
      ...recipes.map<RecipePickRow>((recipe) => ({ kind: 'recipe', recipe })),
    ];
  }, [selectedItem, blueprintsByOutputItem]);

  const filteredRecipeRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rowsForItem;
    return rowsForItem.filter((row) => {
      const name = row.kind === 'recipe' ? row.recipe.name : row.bp.name;
      return name.toLowerCase().includes(q);
    });
  }, [query, rowsForItem]);

  const showingRecipes = !!selectedItem;
  const rowCount = showingRecipes ? filteredRecipeRows.length : filteredTopRows.length;

  useEffect(() => setActiveIndex(0), [query, selectedItem]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pickItemRow = (item: Item) => {
    const recipes = getRecipesProducing(gameData, item.id).filter((r) => !r.manualOnly);
    const bps = blueprintsByOutputItem.get(item.id) ?? [];
    const total = recipes.length + bps.length;
    if (total === 1) {
      if (bps.length === 1) onSelectBlueprint?.(bps[0].id, flowPosition);
      else onSelectRecipe(recipes[0].id, flowPosition);
      return;
    }
    setSelectedItem(item);
    setQuery('');
  };

  const pickTopRow = (row: TopRow) => {
    if (row.kind === 'blueprint') onSelectBlueprint?.(row.bp.id, flowPosition);
    else pickItemRow(row.item);
  };

  const pickRecipeRow = (row: RecipePickRow) => {
    if (row.kind === 'recipe') onSelectRecipe(row.recipe.id, flowPosition);
    else onSelectBlueprint?.(row.bp.id, flowPosition);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selectedItem) {
        setSelectedItem(null);
        setQuery('');
      } else {
        onClose();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(rowCount - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showingRecipes) {
        const row = filteredRecipeRows[activeIndex];
        if (row) pickRecipeRow(row);
      } else {
        const row = filteredTopRows[activeIndex];
        if (row) pickTopRow(row);
      }
      return;
    }
    if (e.key === 'Backspace' && query === '' && selectedItem) {
      e.preventDefault();
      setSelectedItem(null);
    }
  };

  const MENU_W = 380;
  const MENU_H = 440;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  const searchPlaceholder = showingRecipes
    ? 'Filter recipes and blueprints...'
    : 'Search items and blueprints...';

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W, height: MENU_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-panel-hi px-2 py-1.5">
        {showingRecipes && selectedItem ? (
          <>
            <button
              onClick={() => {
                setSelectedItem(null);
                setQuery('');
              }}
              className="rounded p-1 text-[#6b7388] hover:bg-panel hover:text-[#e6e8ee]"
              title="Back (Esc)"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <IconOrLabel iconBasename={selectedItem.icon} name={selectedItem.name} />
            <span className="truncate font-medium">{selectedItem.name}</span>
            <span className="ml-auto text-xs text-[#6b7388]">
              {rowsForItem.length} option{rowsForItem.length === 1 ? '' : 's'}
            </span>
          </>
        ) : (
          <span className="text-xs uppercase tracking-wider text-[#6b7388]">Add node</span>
        )}
      </div>

      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7388]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder}
          className="w-full rounded border border-border bg-panel-hi py-1.5 pl-8 pr-2 text-sm text-[#e6e8ee] outline-none focus:border-accent"
        />
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {rowCount === 0 && (
          <div className="p-3 text-center text-xs text-[#6b7388]">No matches</div>
        )}
        {!showingRecipes &&
          filteredTopRows.map((row, i) =>
            row.kind === 'blueprint' ? (
              <BlueprintRowButton
                key={`bp-${row.bp.id}`}
                bp={row.bp}
                index={i}
                active={i === activeIndex}
                onHover={() => setActiveIndex(i)}
                onPick={() => pickTopRow(row)}
              />
            ) : (
              <ItemRowButton
                key={`item-${row.item.id}`}
                item={row.item}
                index={i}
                active={i === activeIndex}
                onHover={() => setActiveIndex(i)}
                onPick={() => pickTopRow(row)}
              />
            ),
          )}
        {showingRecipes &&
          filteredRecipeRows.map((row, i) =>
            row.kind === 'blueprint' ? (
              <BlueprintRowButton
                key={`bp-${row.bp.id}`}
                bp={row.bp}
                index={i}
                active={i === activeIndex}
                onHover={() => setActiveIndex(i)}
                onPick={() => pickRecipeRow(row)}
              />
            ) : (
              <RecipeRowButton
                key={`rec-${row.recipe.id}`}
                row={row}
                index={i}
                active={i === activeIndex}
                selectedItem={selectedItem}
                onHover={() => setActiveIndex(i)}
                onPick={() => pickRecipeRow(row)}
              />
            ),
          )}
      </div>
      </div>
      <UtilityNodeStrip
        allowInterface={allowInterface}
        onPick={(choice) => {
          dispatchUtility(choice, {
            onAddHublike,
            onAddInterface,
            onAddTarget,
            onAddSink,
            flowPosition,
          });
          onClose();
        }}
      />
    </div>
  );
}

interface DispatchHandlers {
  onAddHublike?: (
    kind: 'hub' | 'splitter' | 'merger',
    flowPosition: { x: number; y: number },
  ) => void;
  onAddInterface?: (
    kind: 'input' | 'output',
    flowPosition: { x: number; y: number },
  ) => void;
  onAddTarget?: (flowPosition: { x: number; y: number }) => void;
  onAddSink?: (flowPosition: { x: number; y: number }) => void;
  flowPosition: { x: number; y: number };
}

function dispatchUtility(choice: UtilityChoice, h: DispatchHandlers): void {
  if (choice.kind === 'hublike') h.onAddHublike?.(choice.which, h.flowPosition);
  else if (choice.kind === 'interface') h.onAddInterface?.(choice.which, h.flowPosition);
  else if (choice.kind === 'target') h.onAddTarget?.(h.flowPosition);
  else h.onAddSink?.(h.flowPosition);
}

interface PickerRowProps {
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  children: React.ReactNode;
}

export function PickerRow({ index, active, onHover, onPick, children }: PickerRowProps) {
  return (
    <button
      data-index={index}
      onClick={onPick}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
        active ? 'bg-panel-hi' : ''
      }`}
    >
      {children}
    </button>
  );
}

interface ItemRowProps {
  item: Item;
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

export function ItemRowButton({ item, index, active, onHover, onPick }: ItemRowProps) {
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <IconOrLabel iconBasename={item.icon} name={item.name} />
      <span className="truncate">{item.name}</span>
    </PickerRow>
  );
}

interface RecipeRowContentProps {
  recipe: Recipe;
  // `itemId` scopes rate + badge computation to a specific item. `side`
  // selects product-side (producer/target-drag) or ingredient-side
  // (consumer/source-drag) — product-side is also where the Byproduct badge
  // can surface.
  itemId?: string;
  side?: 'producer' | 'consumer';
  showIngredientPreview?: boolean;
  showRate?: boolean;
}

// JSX fragment of a recipe row (machine icon + name + Alt/Byproduct badges +
// optional ingredient→product preview + rate). Shared by RecipeRowButton
// here, DragDropMenu's RecipeRow, and AutoFillModal's RecipePicker so the
// three surfaces render recipes identically.
export function RecipeRowContent({
  recipe,
  itemId,
  side = 'producer',
  showIngredientPreview = false,
  showRate = false,
}: RecipeRowContentProps) {
  const machine = gameData.machines[recipe.machineId];
  const io = itemId
    ? side === 'producer'
      ? recipe.products.find((p) => p.itemId === itemId)
      : recipe.ingredients.find((i) => i.itemId === itemId)
    : undefined;
  const isByproduct = side === 'producer' && !!io && 'isByproduct' in io && io.isByproduct === true;
  const rate = io ? (io.amount * 60) / recipe.durationSec : 0;
  return (
    <>
      <IconOrLabel iconBasename={machine?.icon} name={machine?.name ?? '?'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{recipe.name}</span>
          {recipe.alternate && (
            <span className="shrink-0 rounded border border-accent/40 px-1 text-[9px] uppercase tracking-wider text-accent">
              Alt
            </span>
          )}
          {isByproduct && (
            <span className="shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wider text-[#6b7388]">
              Byproduct
            </span>
          )}
        </div>
        {showIngredientPreview && (
          <div className="truncate text-[10px] text-[#6b7388]">
            {recipe.ingredients
              .map((ing) => gameData.items[ing.itemId]?.name ?? ing.itemId)
              .join(' + ') || '—'}
            {' → '}
            {recipe.products
              .map((p) => gameData.items[p.itemId]?.name ?? p.itemId)
              .join(' + ')}
          </div>
        )}
      </div>
      {showRate && io && (
        <span className="shrink-0 text-[10px] text-[#6b7388]">{rate.toFixed(1)}/min</span>
      )}
    </>
  );
}

interface RecipeRowProps {
  row: RecipeRow;
  index: number;
  active: boolean;
  selectedItem: Item | null;
  onHover: () => void;
  onPick: () => void;
}

function RecipeRowButton({ row, index, active, selectedItem, onHover, onPick }: RecipeRowProps) {
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <RecipeRowContent
        recipe={row.recipe}
        itemId={selectedItem?.id}
        side="producer"
        showIngredientPreview
        showRate
      />
    </PickerRow>
  );
}

interface BlueprintRowProps {
  bp: Blueprint;
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

export function BlueprintRowButton({ bp, index, active, onHover, onPick }: BlueprintRowProps) {
  const inputItems: Item[] = [];
  const outputItems: Item[] = [];
  for (const n of bp.nodes) {
    if (n.data.kind !== 'input' && n.data.kind !== 'output') continue;
    if (!n.data.itemId) continue;
    const item = gameData.items[n.data.itemId];
    if (!item) continue;
    if (n.data.kind === 'input') inputItems.push(item);
    else outputItems.push(item);
  }
  // Explicit override first; else the first output item; else fall back to the
  // generic package glyph below.
  const primary =
    (bp.iconItemId && gameData.items[bp.iconItemId]) || outputItems[0] || inputItems[0];

  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      {primary ? (
        <IconOrLabel iconBasename={primary.icon} name={primary.name} />
      ) : (
        <Package className="h-5 w-5 shrink-0 text-sky-300" />
      )}
      <span className="min-w-0 flex-1 truncate">{bp.name}</span>
      {inputItems.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-0.5 border-l border-border pl-1.5"
          title={`Inputs: ${inputItems.map((i) => i.name).join(', ')}`}
        >
          {inputItems.map((item, i) => (
            <IconOrLabel
              key={`${item.id}-${i}`}
              iconBasename={item.icon}
              name={item.name}
              className="h-4 w-4 shrink-0 rounded"
            />
          ))}
        </div>
      )}
      <span className="shrink-0 rounded border border-sky-400/60 bg-sky-500/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
        BP
      </span>
    </PickerRow>
  );
}

