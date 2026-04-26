import type { Recipe } from '@/data/types';

// Standard recipes first, then alternates; alphabetical within each group.
// Pickers across the app sort recipe lists this way so the canonical recipe
// always wins the top slot. Returns a new sorted array — input is unchanged.
export function sortRecipes(recipes: readonly Recipe[]): Recipe[] {
  return recipes.slice().sort((a, b) => {
    if (a.alternate !== b.alternate) return a.alternate ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}
