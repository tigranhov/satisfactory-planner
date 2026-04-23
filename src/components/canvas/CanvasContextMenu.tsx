import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { loadGameData, getRecipesProducing } from '@/data/loader';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { clampMenuPosition } from '@/lib/popover';
import type { Item, Recipe } from '@/data/types';

const gameData = loadGameData();

// Items that at least one non-manual recipe produces. Built once per module load.
const producibleItems: Item[] = (() => {
  const out: Item[] = [];
  for (const item of Object.values(gameData.items)) {
    const recipes = getRecipesProducing(gameData, item.id).filter((r) => !r.manualOnly);
    if (recipes.length > 0) out.push(item);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
})();

interface Props {
  screenPosition: { x: number; y: number };
  flowPosition: { x: number; y: number };
  onClose: () => void;
  onSelectRecipe: (recipeId: string, flowPosition: { x: number; y: number }) => void;
}

export default function CanvasContextMenu({
  screenPosition,
  flowPosition,
  onClose,
  onSelectRecipe,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), [selectedItem]);

  usePopoverDismiss(rootRef, onClose);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return producibleItems;
    return producibleItems.filter((i) => i.name.toLowerCase().includes(q));
  }, [query]);

  const recipesForItem = useMemo(() => {
    if (!selectedItem) return [] as Recipe[];
    const all = getRecipesProducing(gameData, selectedItem.id).filter((r) => !r.manualOnly);
    // Keep standard recipes first, alternates after.
    return [...all].sort((a, b) => {
      if (a.alternate !== b.alternate) return a.alternate ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [selectedItem]);

  const filteredRecipes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipesForItem;
    return recipesForItem.filter((r) => r.name.toLowerCase().includes(q));
  }, [query, recipesForItem]);

  const rows = selectedItem ? filteredRecipes : filteredItems;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, selectedItem]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pickItem = (item: Item) => {
    const recipes = getRecipesProducing(gameData, item.id).filter((r) => !r.manualOnly);
    if (recipes.length === 1) {
      onSelectRecipe(recipes[0].id, flowPosition);
      return;
    }
    setSelectedItem(item);
    setQuery('');
  };

  const pickRecipe = (recipe: Recipe) => {
    onSelectRecipe(recipe.id, flowPosition);
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
      if (selectedItem) pickRecipe(row as Recipe);
      else pickItem(row as Item);
      return;
    }
    if (e.key === 'Backspace' && query === '' && selectedItem) {
      e.preventDefault();
      setSelectedItem(null);
    }
  };

  const MENU_W = 340;
  const MENU_H = 400;
  const { left, top } = clampMenuPosition(screenPosition, { width: MENU_W, height: MENU_H });

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-border bg-panel text-sm shadow-xl"
      style={{ left, top, width: MENU_W, height: MENU_H }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2 border-b border-border bg-panel-hi px-2 py-1.5">
        {selectedItem ? (
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
              {recipesForItem.length} recipe{recipesForItem.length === 1 ? '' : 's'}
            </span>
          </>
        ) : (
          <span className="text-xs uppercase tracking-wider text-[#6b7388]">Add recipe</span>
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
          placeholder={selectedItem ? 'Filter recipes...' : 'Search items...'}
          className="w-full rounded border border-border bg-panel-hi py-1.5 pl-8 pr-2 text-sm text-[#e6e8ee] outline-none focus:border-accent"
        />
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-1">
        {rows.length === 0 && (
          <div className="p-3 text-center text-xs text-[#6b7388]">No matches</div>
        )}
        {!selectedItem &&
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
        {selectedItem &&
          (rows as Recipe[]).map((recipe, i) => {
            const machine = gameData.machines[recipe.machineId];
            const product = recipe.products.find((p) => p.itemId === selectedItem.id);
            const isByproduct = product?.isByproduct ?? false;
            const rate = product ? (product.amount * 60) / recipe.durationSec : 0;
            return (
              <button
                key={recipe.id}
                data-index={i}
                onClick={() => pickRecipe(recipe)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                  i === activeIndex ? 'bg-panel-hi' : ''
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
          })}
      </div>
    </div>
  );
}
