import { useGraphStore } from '@/store/graphStore';
import { selectActiveGraphId, useNavigationStore } from '@/store/navigationStore';

export function useActiveGraphId() {
  return useNavigationStore(selectActiveGraphId);
}

export function useActiveGraph() {
  const id = useActiveGraphId();
  return useGraphStore((s) => s.graphs[id]);
}
