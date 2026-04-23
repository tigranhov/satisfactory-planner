import { useRef, useCallback, useEffect } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { useBlueprintStore } from '@/store/blueprintStore';
import { graphFromBlueprint, type SubgraphResolver } from '@/models/flow';

// Returns a stable resolver that looks up a subgraph by id from either the
// graphStore (factories) or the blueprintStore (blueprints). The callback
// identity never changes — store reads go through refs — so consuming memos
// and useEffects don't churn on every node/blueprint mutation. Cache
// invalidation instead rides on the referenced Graph objects themselves, which
// both stores replace only when their specific entry changes.
export function useSubgraphResolver(): SubgraphResolver {
  const graphs = useGraphStore((s) => s.graphs);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const graphsRef = useRef(graphs);
  const blueprintsRef = useRef(blueprints);
  useEffect(() => {
    graphsRef.current = graphs;
  }, [graphs]);
  useEffect(() => {
    blueprintsRef.current = blueprints;
  }, [blueprints]);
  return useCallback((id) => {
    const g = graphsRef.current[id];
    if (g) return g;
    const bp = blueprintsRef.current[id];
    return bp ? graphFromBlueprint(bp) : undefined;
  }, []);
}
