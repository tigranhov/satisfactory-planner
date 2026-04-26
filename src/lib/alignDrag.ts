import type { InternalNode, Node } from '@xyflow/react';
import type { GraphEdge } from '@/models/graph';

// Hold Cmd/Ctrl while dragging a single node to lock vertical motion to a
// connected handle's Y. Every incident edge (incoming or outgoing) becomes a
// candidate: each yields the Y at which the dragged node's local handle would
// align with the partner's handle. We pick the candidate whose anchor Y is
// closest to the cursor, so the user drifts up/down to switch which
// connection the node snaps to — works the same regardless of direction.
//
// Returns null when there are no incident edges — caller should lock Y at
// the drag-start position instead.
export interface AlignDragArgs {
  draggedNode: InternalNode<Node>;
  internalNodeById: (id: string) => InternalNode<Node> | undefined;
  edges: GraphEdge[];
  cursorFlowY: number;
}

interface Candidate {
  // Where the dragged node's `position.y` should be set so the chosen handle
  // pair lines up.
  snappedNodeY: number;
  // Absolute Y of the alignment anchor, used to pick the closest candidate to
  // the cursor.
  anchorY: number;
}

function handleCenterY(node: InternalNode<Node>, handleY: number, handleHeight: number): number {
  // `position.y` is the rendered top-left; handle x/y are relative to it.
  return node.position.y + handleY + handleHeight / 2;
}

function relativeHandleCenterY(handleY: number, handleHeight: number): number {
  return handleY + handleHeight / 2;
}

export function computeAlignedY({
  draggedNode,
  internalNodeById,
  edges,
  cursorFlowY,
}: AlignDragArgs): number | null {
  const incidentEdges: GraphEdge[] = [];
  for (const e of edges) {
    if (e.source === draggedNode.id || e.target === draggedNode.id) incidentEdges.push(e);
  }
  if (incidentEdges.length === 0) return null;

  const draggedTargetHandles = draggedNode.internals.handleBounds?.target ?? [];
  const draggedSourceHandles = draggedNode.internals.handleBounds?.source ?? [];

  const candidates: Candidate[] = [];

  for (const edge of incidentEdges) {
    const isIncoming = edge.target === draggedNode.id;
    const draggedHandles = isIncoming ? draggedTargetHandles : draggedSourceHandles;
    const draggedHandleId = isIncoming ? edge.targetHandle : edge.sourceHandle;
    const draggedHandle = draggedHandles.find((h) => h.id === draggedHandleId);
    if (!draggedHandle) continue;

    const partnerId = isIncoming ? edge.source : edge.target;
    const partnerNode = internalNodeById(partnerId);
    if (!partnerNode) continue;
    const partnerHandles =
      (isIncoming
        ? partnerNode.internals.handleBounds?.source
        : partnerNode.internals.handleBounds?.target) ?? [];
    const partnerHandleId = isIncoming ? edge.sourceHandle : edge.targetHandle;
    const partnerHandle = partnerHandles.find((h) => h.id === partnerHandleId);
    if (!partnerHandle) continue;

    const anchorY = handleCenterY(partnerNode, partnerHandle.y, partnerHandle.height);
    const snappedNodeY = anchorY - relativeHandleCenterY(draggedHandle.y, draggedHandle.height);
    candidates.push({ snappedNodeY, anchorY });
  }

  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestDist = Math.abs(best.anchorY - cursorFlowY);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(candidates[i].anchorY - cursorFlowY);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }
  return best.snappedNodeY;
}
