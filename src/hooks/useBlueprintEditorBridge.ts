import { useEffect } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { useBlueprintStore } from '@/store/blueprintStore';
import { useActiveGraphId } from './useActiveGraph';
import { useNavigationStore, selectActiveGraphId } from '@/store/navigationStore';
import { newEdgeId, newNodeId } from '@/lib/ids';
import {
  handleIdForBlueprintInput,
  handleIdForBlueprintOutput,
  handleIdForInterface,
} from '@/models/factory';
import type { Blueprint, BlueprintId } from '@/models/blueprint';
import type { GraphEdge, GraphNode, NodeId } from '@/models/graph';

// When a blueprint is being edited (its id lives at the top of the navigation
// stack and as a graph in graphStore), mirror graph changes back into the
// blueprint record so the autosave layer persists them.
export function useBlueprintEditorBridge() {
  const activeGraphId = useActiveGraphId();

  useEffect(() => {
    const initial = useBlueprintStore.getState().blueprints[activeGraphId];
    if (!initial) return;

    return useGraphStore.subscribe((state) => {
      const g = state.graphs[activeGraphId];
      if (!g) return;
      const current = useBlueprintStore.getState().blueprints[activeGraphId];
      if (!current) return;
      if (g.nodes === current.nodes && g.edges === current.edges) return;
      useBlueprintStore.getState().updateBlueprint(activeGraphId, {
        nodes: g.nodes,
        edges: g.edges,
      });
    });
  }, [activeGraphId]);
}

// True when placing `candidateId` inside `hostId` would create a reference
// cycle — i.e. `candidateId`'s internal subgraph (transitively) already
// contains `hostId`.
function blueprintTransitivelyContains(
  bp: Blueprint,
  targetId: BlueprintId,
  pool: Record<BlueprintId, Blueprint>,
  seen = new Set<BlueprintId>(),
): boolean {
  if (seen.has(bp.id)) return false;
  seen.add(bp.id);
  for (const n of bp.nodes) {
    if (n.data.kind !== 'blueprint') continue;
    if (n.data.blueprintId === targetId) return true;
    const child = pool[n.data.blueprintId];
    if (child && blueprintTransitivelyContains(child, targetId, pool, seen)) return true;
  }
  return false;
}

// Whether placing `blueprintId` into `hostGraphId` is safe (no self-insertion
// or transitive cycle). The host is "safe" by default if it's not a blueprint
// itself (i.e. the project root graph).
export function canPlaceBlueprint(blueprintId: BlueprintId, hostGraphId: string): boolean {
  const pool = useBlueprintStore.getState().blueprints;
  const bp = pool[blueprintId];
  if (!bp) return false;
  const hostBp = pool[hostGraphId];
  if (!hostBp) return true;
  if (blueprintId === hostGraphId) return false;
  return !blueprintTransitivelyContains(bp, hostGraphId, pool);
}

// Drop a blueprint instance into whatever graph is currently active. Blocks
// self-insertion and deeper cycles; returns the new node id on success.
export function placeBlueprintOnActiveGraph(
  blueprintId: BlueprintId,
  position: { x: number; y: number } = { x: 0, y: 0 },
): string | null {
  const activeGraphId = selectActiveGraphId(useNavigationStore.getState());
  if (!activeGraphId) return null;
  if (!canPlaceBlueprint(blueprintId, activeGraphId)) return null;
  return useGraphStore.getState().addNode(activeGraphId, position, {
    kind: 'blueprint',
    blueprintId,
    count: 1,
  });
}

// Extract a multi-node selection from `sourceGraphId` into a brand-new
// blueprint. Edges that crossed the selection boundary are rewired through
// generated Input/Output interface nodes so the new blueprint's outer handles
// replay the same topology. Returns the new blueprint id, or null if the
// request was invalid.
export function extractSelectionToBlueprint(
  sourceGraphId: string,
  selection: Set<NodeId>,
): BlueprintId | null {
  if (selection.size === 0) return null;
  const gs = useGraphStore.getState();
  const src = gs.graphs[sourceGraphId];
  if (!src) return null;

  const selectedNodes = src.nodes.filter((n) => selection.has(n.id));
  if (selectedNodes.length === 0) return null;

  const internalNodes: GraphNode[] = selectedNodes.map((n) => ({
    id: n.id,
    position: { ...n.position },
    data: structuredClone(n.data),
  }));

  const internalNodeById = new Map(internalNodes.map((n) => [n.id, n]));
  const internalEdges: GraphEdge[] = [];
  type Direction = 'in' | 'out';
  const boundaryEdges: Array<{ dir: Direction; edge: GraphEdge }> = [];

  for (const e of src.edges) {
    const sIn = selection.has(e.source);
    const tIn = selection.has(e.target);
    if (sIn && tIn) internalEdges.push({ ...e });
    else if (!sIn && tIn) boundaryEdges.push({ dir: 'in', edge: e });
    else if (sIn && !tIn) boundaryEdges.push({ dir: 'out', edge: e });
  }

  // Outer stubs target (dir='in') or source (dir='out') the yet-to-be-created
  // blueprint-instance node — discriminator avoids sentinel strings.
  type OuterStub =
    | {
        dir: 'in';
        outerSource: NodeId;
        outerSourceHandle: string;
        bpTargetHandle: string;
        itemId: string;
        rate: number;
      }
    | {
        dir: 'out';
        outerTarget: NodeId;
        outerTargetHandle: string;
        bpSourceHandle: string;
        itemId: string;
        rate: number;
      };

  const outerStubs: OuterStub[] = [];
  const generatedIo: GraphNode[] = [];
  const generatedInternalEdges: GraphEdge[] = [];

  for (const { dir, edge: be } of boundaryEdges) {
    const pivotId = dir === 'in' ? be.target : be.source;
    const pivot = internalNodeById.get(pivotId);
    const dxSign = dir === 'in' ? -1 : 1;
    const pos = pivot
      ? { x: pivot.position.x + dxSign * 220, y: pivot.position.y }
      : { x: 0, y: 0 };
    const ifaceKind = dir === 'in' ? 'input' : 'output';
    const ifaceId = newNodeId();
    generatedIo.push({
      id: ifaceId,
      position: pos,
      data: { kind: ifaceKind, itemId: be.itemId },
    });
    const ifaceHandle = handleIdForInterface(ifaceKind, be.itemId);
    if (dir === 'in') {
      generatedInternalEdges.push({
        id: newEdgeId(),
        source: ifaceId,
        sourceHandle: ifaceHandle,
        target: be.target,
        targetHandle: be.targetHandle,
        itemId: be.itemId,
        rate: be.rate,
      });
      outerStubs.push({
        dir: 'in',
        outerSource: be.source,
        outerSourceHandle: be.sourceHandle,
        bpTargetHandle: handleIdForBlueprintInput(ifaceId, be.itemId),
        itemId: be.itemId,
        rate: be.rate,
      });
    } else {
      generatedInternalEdges.push({
        id: newEdgeId(),
        source: be.source,
        sourceHandle: be.sourceHandle,
        target: ifaceId,
        targetHandle: ifaceHandle,
        itemId: be.itemId,
        rate: be.rate,
      });
      outerStubs.push({
        dir: 'out',
        outerTarget: be.target,
        outerTargetHandle: be.targetHandle,
        bpSourceHandle: handleIdForBlueprintOutput(ifaceId, be.itemId),
        itemId: be.itemId,
        rate: be.rate,
      });
    }
  }

  const blueprintId = useBlueprintStore.getState().addBlueprint({
    name: 'Extracted blueprint',
    description: '',
    tags: [],
    nodes: [...internalNodes, ...generatedIo],
    edges: [...internalEdges, ...generatedInternalEdges],
  });

  const centroid = {
    x:
      selectedNodes.reduce((s, n) => s + n.position.x, 0) / selectedNodes.length,
    y:
      selectedNodes.reduce((s, n) => s + n.position.y, 0) / selectedNodes.length,
  };

  for (const id of selection) {
    useGraphStore.getState().removeNode(sourceGraphId, id);
  }

  const bpInstanceId = useGraphStore.getState().addNode(sourceGraphId, centroid, {
    kind: 'blueprint',
    blueprintId,
    count: 1,
  });

  for (const stub of outerStubs) {
    const edge: Omit<GraphEdge, 'id'> =
      stub.dir === 'in'
        ? {
            source: stub.outerSource,
            sourceHandle: stub.outerSourceHandle,
            target: bpInstanceId,
            targetHandle: stub.bpTargetHandle,
            itemId: stub.itemId,
            rate: stub.rate,
          }
        : {
            source: bpInstanceId,
            sourceHandle: stub.bpSourceHandle,
            target: stub.outerTarget,
            targetHandle: stub.outerTargetHandle,
            itemId: stub.itemId,
            rate: stub.rate,
          };
    useGraphStore.getState().addEdge(sourceGraphId, edge);
  }

  return blueprintId;
}

// Open a blueprint's internal subgraph for editing. Ensures the graph exists
// in graphStore under the blueprint's id, then pushes it onto the navigation
// stack so the canvas switches to it.
export function openBlueprintForEditing(blueprintId: string) {
  const bp = useBlueprintStore.getState().blueprints[blueprintId];
  if (!bp) return;
  useGraphStore.setState((s) => {
    const existing = s.graphs[blueprintId];
    const next = {
      id: blueprintId,
      name: bp.name,
      nodes: bp.nodes,
      edges: bp.edges,
    };
    if (
      existing &&
      existing.name === next.name &&
      existing.nodes === next.nodes &&
      existing.edges === next.edges
    ) {
      return s;
    }
    return { graphs: { ...s.graphs, [blueprintId]: next } };
  });
  useNavigationStore.getState().enter(blueprintId);
}

