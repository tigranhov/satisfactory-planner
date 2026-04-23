import type { GameData } from '@/data/types';
import type { Graph } from './graph';

// Propagates rates along edges based on recipe throughput.
// Stub: future implementation will topo-sort the graph, push rates from
// producers, balance consumers, and flag deficits / surpluses.
export function propagateRates(_data: GameData, graph: Graph): Graph {
  return graph;
}

// Aggregates a factory subgraph's net I/O so the parent factory node
// can expose matching handles and show rollup numbers.
// Stub: returns empty aggregation.
export function aggregateSubgraph(_data: GameData, _graph: Graph) {
  return {
    netInputs: [] as { itemId: string; rate: number }[],
    netOutputs: [] as { itemId: string; rate: number }[],
    powerMW: 0,
  };
}
