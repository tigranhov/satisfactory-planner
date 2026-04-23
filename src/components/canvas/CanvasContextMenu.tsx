import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Package,
  Search,
  Waypoints,
  Wrench,
} from 'lucide-react';
import { loadGameData, getAllItemsSorted, getRecipesProducing } from '@/data/loader';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import { useBlueprintStore } from '@/store/blueprintStore';
import { canPlaceBlueprint } from '@/hooks/useBlueprintEditorBridge';
import { useActiveGraphId } from '@/hooks/useActiveGraph';
import type { Item, Recipe } from '@/data/types';
import type { Blueprint } from '@/models/blueprint';

const gameData = loadGameData();

// Items that at least one non-manual recipe produces. Built once per module load.
const gameProducibleItems: Item[] = (() => {
  const out: Item[] = [];
  for (const item of Object.values(gameData.items)) {
    const recipes = getRecipesProducing(gameData, item.id).filter((r) => !r.manualOnly);
    if (recipes.length > 0) out.push(item);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
})();

const allItems: Item[] = getAllItemsSorted(gameData);

type Mode = 'recipe' | 'blueprint' | 'input' | 'output';

type RecipeRow = { kind: 'recipe'; recipe: Recipe };
type BlueprintRow = { kind: 'blueprint'; bp: Blueprint };
type ItemRow = { kind: 'item'; item: Item };

type RecipePickRow = RecipeRow | BlueprintRow;
type TopRow = ItemRow | BlueprintRow;

// Precomputed item-row arrays — constant across the app lifetime.
const allItemRows: TopRow[] = allItems.map<TopRow>((item) => ({ kind: 'item', item }));
const recipeItemRows: TopRow[] = gameProducibleItems.map<TopRow>((item) => ({ kind: 'item', item }));

interface Props {
  screenPosition: { x: number; y: number };
  flowPosition: { x: number; y: number };
  onClose: () => void;
  onSelectRecipe: (recipeId: string, flowPosition: { x: number; y: number }) => void;
  onSelectBlueprint?: (blueprintId: string, flowPosition: { x: number; y: number }) => void;
  allowInterface?: boolean;
  onSelectInterface?: (
    kind: 'input' | 'output',
    itemId: string,
    flowPosition: { x: number; y: number },
  ) => void;
  // Utility nodes place instantly from the always-visible side strip; each
  // kind has its own callback. Add more as splitters / mergers land.
  onAddHub?: (flowPosition: { x: number; y: number }) => void;
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
  onSelectInterface,
  onAddHub,
}: Props) {
  const [mode, setMode] = useState<Mode>('recipe');
  const [query, setQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeGraphId = useActiveGraphId();
  const blueprints = useBlueprintStore((s) => s.blueprints);

  useEffect(() => inputRef.current?.focus(), [selectedItem, mode]);

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
        if (n.data.kind === 'output') outputs.add(n.data.itemId);
      }
      for (const itemId of outputs) {
        const arr = map.get(itemId) ?? [];
        arr.push(bp);
        map.set(itemId, arr);
      }
    }
    return map;
  }, [placeableBlueprints]);

  const blueprintRows = useMemo<TopRow[]>(
    () => placeableBlueprints.map((bp) => ({ kind: 'blueprint', bp })),
    [placeableBlueprints],
  );

  const rowsByMode: Record<Mode, TopRow[]> = {
    recipe: recipeItemRows,
    blueprint: blueprintRows,
    input: allItemRows,
    output: allItemRows,
  };

  // Input/Output tabs are hidden when allowInterface is false — skip filtering
  // their ~200-item arrays on every keystroke in that case.
  const filteredByMode = useMemo<Record<Mode, TopRow[]>>(() => {
    const empty: TopRow[] = [];
    return {
      recipe: filterByName(rowsByMode.recipe, query),
      blueprint: filterByName(rowsByMode.blueprint, query),
      input: allowInterface ? filterByName(rowsByMode.input, query) : empty,
      output: allowInterface ? filterByName(rowsByMode.output, query) : empty,
    };
    // rowsByMode is a plain object rebuilt every render; depending on its
    // source arrays avoids unnecessary filter runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprintRows, query, allowInterface]);

  const filteredTopRows = filteredByMode[mode];

  const rowsForItem = useMemo<RecipePickRow[]>(() => {
    if (!selectedItem || mode !== 'recipe') return [];
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
  }, [selectedItem, mode, blueprintsByOutputItem]);

  const filteredRecipeRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rowsForItem;
    return rowsForItem.filter((row) => {
      const name = row.kind === 'recipe' ? row.recipe.name : row.bp.name;
      return name.toLowerCase().includes(q);
    });
  }, [query, rowsForItem]);

  const showingRecipes = mode === 'recipe' && !!selectedItem;
  const rowCount = showingRecipes ? filteredRecipeRows.length : filteredTopRows.length;

  // Auto-switch Recipe ↔ Blueprint when the active query has no hits in the
  // current tab but the sibling tab does. Input/Output are excluded — those
  // modes are explicitly chosen. The `autoSwitchedForRef` guard fires at most
  // once per distinct query so a manual tab click isn't immediately undone.
  const autoSwitchedForRef = useRef<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      autoSwitchedForRef.current = null;
      return;
    }
    if (showingRecipes) return;
    if (autoSwitchedForRef.current === q) return;
    if (filteredTopRows.length > 0) return;
    if (mode === 'recipe' && filteredByMode.blueprint.length > 0) {
      autoSwitchedForRef.current = q;
      setMode('blueprint');
    } else if (mode === 'blueprint' && filteredByMode.recipe.length > 0) {
      autoSwitchedForRef.current = q;
      setMode('recipe');
    }
  }, [mode, query, filteredTopRows.length, filteredByMode, showingRecipes]);

  useEffect(() => setActiveIndex(0), [query, selectedItem, mode]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pickItemRow = (item: Item) => {
    if (mode === 'recipe') {
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
      return;
    }
    if (mode === 'input' || mode === 'output') {
      onSelectInterface?.(mode, item.id, flowPosition);
    }
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

  const MODE_PLACEHOLDER: Record<Mode, string> = {
    recipe: 'Search items...',
    blueprint: 'Search blueprints...',
    input: 'Search items for Input...',
    output: 'Search items for Output...',
  };
  const searchPlaceholder = showingRecipes
    ? 'Filter recipes and blueprints...'
    : MODE_PLACEHOLDER[mode];

  const MODE_HEADER: Record<Mode, string> = {
    recipe: 'Add recipe',
    blueprint: 'Add blueprint',
    input: 'Add input',
    output: 'Add output',
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W, height: MENU_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex min-w-0 flex-1 flex-col">
      {!showingRecipes && (
        <div className="flex gap-1 border-b border-border bg-panel-hi p-1.5">
          <ModeButton
            current={mode}
            value="recipe"
            onSelect={setMode}
            icon={<Wrench className="h-3 w-3" />}
            badge={filteredByMode.recipe.length}
          >
            Recipe
          </ModeButton>
          <ModeButton
            current={mode}
            value="blueprint"
            onSelect={setMode}
            icon={<Package className="h-3 w-3" />}
            badge={filteredByMode.blueprint.length}
          >
            Blueprint
          </ModeButton>
          {allowInterface && (
            <>
              <ModeButton
                current={mode}
                value="input"
                onSelect={setMode}
                icon={<ArrowRightFromLine className="h-3 w-3" />}
              >
                Input
              </ModeButton>
              <ModeButton
                current={mode}
                value="output"
                onSelect={setMode}
                icon={<ArrowLeftFromLine className="h-3 w-3" />}
              >
                Output
              </ModeButton>
            </>
          )}
        </div>
      )}

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
          <span className="text-xs uppercase tracking-wider text-[#6b7388]">
            {MODE_HEADER[mode]}
          </span>
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
      <div className="flex w-9 flex-col items-center gap-1 border-l border-border bg-panel-hi py-1.5">
        <button
          onClick={() => {
            onAddHub?.(flowPosition);
            onClose();
          }}
          title="Add Hub"
          className="flex h-7 w-7 items-center justify-center rounded text-[#9aa2b8] hover:bg-panel hover:text-amber-300"
        >
          <Waypoints className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface PickerRowProps {
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  children: React.ReactNode;
}

function PickerRow({ index, active, onHover, onPick, children }: PickerRowProps) {
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

function ItemRowButton({ item, index, active, onHover, onPick }: ItemRowProps) {
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <IconOrLabel iconBasename={item.icon} name={item.name} />
      <span className="truncate">{item.name}</span>
    </PickerRow>
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
  const { recipe } = row;
  const machine = gameData.machines[recipe.machineId];
  const product = selectedItem
    ? recipe.products.find((p) => p.itemId === selectedItem.id)
    : undefined;
  const isByproduct = product?.isByproduct ?? false;
  const rate = product ? (product.amount * 60) / recipe.durationSec : 0;
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
          {isByproduct && (
            <span className="shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wider text-[#6b7388]">
              Byproduct
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
      <span className="shrink-0 text-[10px] text-[#6b7388]">{rate.toFixed(1)}/min</span>
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

function BlueprintRowButton({ bp, index, active, onHover, onPick }: BlueprintRowProps) {
  const inputNames: string[] = [];
  const outputNames: string[] = [];
  for (const n of bp.nodes) {
    if (n.data.kind === 'input') {
      inputNames.push(gameData.items[n.data.itemId]?.name ?? n.data.itemId);
    } else if (n.data.kind === 'output') {
      outputNames.push(gameData.items[n.data.itemId]?.name ?? n.data.itemId);
    }
  }
  return (
    <PickerRow index={index} active={active} onHover={onHover} onPick={onPick}>
      <Package className="h-5 w-5 shrink-0 text-sky-300" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{bp.name}</span>
          <span className="shrink-0 rounded border border-sky-400/60 bg-sky-500/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
            BP
          </span>
        </div>
        <div className="truncate text-[10px] text-[#6b7388]">
          {inputNames.join(' + ') || '—'}
          {' → '}
          {outputNames.join(' + ') || '—'}
        </div>
      </div>
    </PickerRow>
  );
}

interface ModeButtonProps {
  current: Mode;
  value: Mode;
  onSelect: (m: Mode) => void;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}

function ModeButton({ current, value, onSelect, icon, badge, children }: ModeButtonProps) {
  const active = current === value;
  const showBadge = badge !== undefined;
  return (
    <button
      onClick={() => onSelect(value)}
      className={`flex flex-1 items-center justify-center gap-1 rounded py-1 text-[11px] transition-colors ${
        active
          ? 'bg-accent text-[#1b1410]'
          : 'text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]'
      }`}
    >
      {icon}
      {children}
      {showBadge && badge > 0 && (
        <span
          className={`ml-0.5 rounded px-1 text-[9px] font-medium ${
            active ? 'bg-[#1b1410]/20 text-[#1b1410]' : 'bg-panel text-[#6b7388]'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
