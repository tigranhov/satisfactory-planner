import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { loadGameData, getRecipeList } from '@/data/loader';
import { resolveIconUrl } from '@/data/icons';
import type { Recipe } from '@/data/types';

const gameData = loadGameData();

export default function Sidebar() {
  const [query, setQuery] = useState('');

  const recipes = useMemo(() => {
    const all = getRecipeList(gameData);
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((r) => r.name.toLowerCase().includes(q));
  }, [query]);

  const handleDragStart = (event: React.DragEvent, recipe: Recipe) => {
    event.dataTransfer.setData('application/x-recipe-id', recipe.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-panel">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7388]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes..."
            className="w-full rounded border border-border bg-panel-hi py-1.5 pl-8 pr-2 text-sm text-[#e6e8ee] outline-none focus:border-accent"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 text-xs uppercase tracking-wider text-[#6b7388]">Recipes</div>
        {recipes.map((r) => {
          const primaryItem =
            gameData.items[r.products[0]?.itemId ?? r.ingredients[0]?.itemId ?? ''];
          const iconUrl = resolveIconUrl(primaryItem?.icon);
          return (
            <div
              key={r.id}
              draggable
              onDragStart={(e) => handleDragStart(e, r)}
              className="mb-1 flex cursor-grab select-none items-center gap-2 rounded border border-border bg-panel-hi px-2 py-1.5 text-sm hover:border-accent"
            >
              {iconUrl && (
                <img
                  src={iconUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded object-contain"
                  draggable={false}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="truncate text-xs text-[#6b7388]">
                  {r.ingredients.map((i) => gameData.items[i.itemId]?.name).join(' + ')}
                  {' → '}
                  {r.products.map((p) => gameData.items[p.itemId]?.name).join(' + ')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
