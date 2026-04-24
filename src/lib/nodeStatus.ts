import type { NodeStatus } from '@/models/graph';

// Composes a node's outer border className from selection + status. Selection
// always wins so click/hover affordances stay consistent; then `built` (solid
// emerald), then `planned` (dashed amber), then the per-node-kind fallback for
// the untagged baseline. `selectedClass` defaults to the app-wide accent but
// nodes with their own palette (blueprint = sky) can override it.
export function statusBorderClass(
  status: NodeStatus | undefined,
  selected: boolean,
  fallback: string,
  selectedClass: string = 'border-accent',
): string {
  if (selected) return selectedClass;
  if (status === 'built') return 'border-2 border-emerald-500';
  if (status === 'planned') return 'border-2 border-dashed border-amber-400/70';
  return fallback;
}
