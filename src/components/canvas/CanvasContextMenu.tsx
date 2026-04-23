import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftFromLine, ArrowRightFromLine, Package, Search } from 'lucide-react';
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

type Mode = 'recipe' | 'input' | 'output';

type RecipeRow = { kind: 'recipe'; recipe: Recipe };
type BlueprintRow = { kind: 'blueprint'; bp: Blueprint };
type PickerRow = RecipeRow | BlueprintRow;

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
}

export default function CanvasContextMenu({
  screenPosition,
  flowPosition,
  onClose,
  onSelectRecipe,
  onSelectBlueprint,
  allowInterface = false,
  onSelectInterface,
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

  // Index blueprints by each output item so picker lookups are O(1).
  // Blueprints that'd create a cycle on the current host graph are filtered out.
  const blueprintsByOutputItem = useMemo(() => {
    const map = new Map<string, Blueprint[]>();
    for (const bp of Object.values(blueprints)) {
      if (!canPlaceBlueprint(bp.id, activeGraphId)) continue;
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
  }, [blueprints, activeGraphId]);

  // Items producible by either a game recipe or a blueprint output.
  const producibleItems = useMemo(() => {
    if (blueprintsByOutputItem.size === 0) return gameProducibleItems;
    const byId = new Map<string, Item>();
    for (const it of gameProducibleItems) byId.set(it.id, it);
    for (const itemId of blueprintsByOutputItem.keys()) {
      if (!byId.has(itemId)) {
        const it = gameData.items[itemId];
        if (it) byId.set(itemId, it);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [blueprintsByOutputItem]);

  const itemsForMode = mode === 'recipe' ? producibleItems : allItems;

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return itemsForMode;
    return itemsForMode.filter((i) => i.name.toLowerCase().includes(q));
  }, [query, itemsForMode]);

  const rowsForItem = useMemo<PickerRow[]>(() => {
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
      ...bps.map<PickerRow>((bp) => ({ kind: 'blueprint', bp })),
      ...recipes.map<PickerRow>((recipe) => ({ kind: 'recipe', recipe })),
    ];
  }, [selectedItem, mode, blueprintsByOutputItem]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rowsForItem;
    return rowsForItem.filter((row) => {
      const name = row.kind === 'recipe' ? row.recipe.name : row.bp.name;
      return name.toLowerCase().includes(q);
    });
  }, [query, rowsForItem]);

  const showingRecipes = mode === 'recipe' && !!selectedItem;
  const rows = showingRecipes ? filteredRows : filteredItems;

  useEffect(() => setActiveIndex(0), [query, selectedItem, mode]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pickItem = (item: Item) => {
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
    onSelectInterface?.(mode, item.id, flowPosition);
  };

  const pickRow = (row: PickerRow) => {
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
      setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIndex];
      if (!row) return;
      if (showingRecipes) pickRow(row as PickerRow);
      else pickItem(row as Item);
      return;
    }
    if (e.key === 'Backspace' && query === '' && selectedItem) {
      e.preventDefault();
      setSelectedItem(null);
    }
  };

  const MENU_W = 340;
  const MENU_H = 440;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  const MODE_PLACEHOLDER: Record<Mode, string> = {
    recipe: 'Search items...',
    input: 'Search items for Input...',
    output: 'Search items for Output...',
  };
  const searchPlaceholder = showingRecipes
    ? 'Filter recipes and blueprints...'
    : MODE_PLACEHOLDER[mode];

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W, height: MENU_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {allowInterface && !showingRecipes && (
        <div className="flex gap-1 border-b border-border bg-panel-hi p-1.5">
          <ModeButton current={mode} value="recipe" onSelect={setMode} icon={<Package className="h-3 w-3" />}>
            Recipe
          </ModeButton>
          <ModeButton current={mode} value="input" onSelect={setMode} icon={<ArrowRightFromLine className="h-3 w-3" />}>
            Input
          </ModeButton>
          <ModeButton current={mode} value="output" onSelect={setMode} icon={<ArrowLeftFromLine className="h-3 w-3" />}>
            Output
          </ModeButton>
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
            {mode === 'recipe' ? 'Add recipe' : mode === 'input' ? 'Add input' : 'Add output'}
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

      <div ref={listRef} className="flex-1 overflow-y-auto p-1">
        {rows.length === 0 && (
          <div className="p-3 text-center text-xs text-[#6b7388]">No matches</div>
        )}
        {!showingRecipes &&
          (rows as Item[]).map((item, i) => (
            <button
              key={item.id}
              data-index={i}
              onClick={() => pickItem(item)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                i === activeIndex ? 'bg-panel-hi' : ''
              }`}
            >
              <IconOrLabel iconBasename={item.icon} name={item.name} />
              <span className="truncate">{item.name}</span>
            </button>
          ))}
        {showingRecipes &&
          (rows as PickerRow[]).map((row, i) =>
            row.kind === 'blueprint' ? (
              <BlueprintRowButton
                key={`bp-${row.bp.id}`}
                row={row}
                index={i}
                active={i === activeIndex}
                onHover={() => setActiveIndex(i)}
                onPick={() => pickRow(row)}
              />
            ) : (
              <RecipeRowButton
                key={`rec-${row.recipe.id}`}
                row={row}
                index={i}
                active={i === activeIndex}
                selectedItem={selectedItem}
                onHover={() => setActiveIndex(i)}
                onPick={() => pickRow(row)}
              />
            ),
          )}
      </div>
    </div>
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
    <button
      data-index={index}
      onClick={onPick}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
        active ? 'bg-panel-hi' : ''
      }`}
    >
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
    </button>
  );
}

interface BlueprintRowProps {
  row: BlueprintRow;
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function BlueprintRowButton({ row, index, active, onHover, onPick }: BlueprintRowProps) {
  const { bp } = row;
  const inputs = bp.nodes.filter((n) => n.data.kind === 'input');
  const outputs = bp.nodes.filter((n) => n.data.kind === 'output');
  const inputNames = inputs
    .map((n) => (n.data.kind === 'input' ? gameData.items[n.data.itemId]?.name ?? n.data.itemId : ''))
    .filter(Boolean);
  const outputNames = outputs
    .map((n) => (n.data.kind === 'output' ? gameData.items[n.data.itemId]?.name ?? n.data.itemId : ''))
    .filter(Boolean);
  return (
    <button
      data-index={index}
      onClick={onPick}
      onMouseEnter={onHover}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
        active ? 'bg-panel-hi' : ''
      }`}
    >
      <Package className="h-5 w-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{bp.name}</span>
          <span className="shrink-0 rounded border border-accent/60 bg-accent/10 px-1 text-[9px] font-semibold uppercase tracking-wider text-accent">
            BP
          </span>
        </div>
        <div className="truncate text-[10px] text-[#6b7388]">
          {inputNames.join(' + ') || '—'}
          {' → '}
          {outputNames.join(' + ') || '—'}
        </div>
      </div>
    </button>
  );
}

interface ModeButtonProps {
  current: Mode;
  value: Mode;
  onSelect: (m: Mode) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function ModeButton({ current, value, onSelect, icon, children }: ModeButtonProps) {
  const active = current === value;
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
    </button>
  );
}
