import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { Layers } from 'lucide-react';
import { useGraphStore } from '@/store/graphStore';
import type { CompositeNodeData } from '@/models/graph';

function CompositeNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CompositeNodeData;
  const subGraph = useGraphStore((s) => s.graphs[nodeData.subGraphId]);

  const inputs = subGraph?.nodes.filter((n) => n.data.kind === 'input') ?? [];
  const outputs = subGraph?.nodes.filter((n) => n.data.kind === 'output') ?? [];

  return (
    <div
      className={`min-w-[200px] rounded-md border-2 border-dashed bg-panel text-sm shadow-lg ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-md border-b border-border bg-panel-hi px-3 py-1.5">
        <Layers className="h-4 w-4 text-accent" />
        <span className="font-medium">{nodeData.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-0 py-1 min-h-[40px]">
        <div className="relative">
          {inputs.length === 0 && (
            <div className="px-3 py-1 text-[10px] italic text-[#6b7388]">no inputs</div>
          )}
          {inputs.map((n, i) => (
            <div key={n.id} className="relative py-1 pl-3 pr-2 text-xs">
              <Handle
                id={`sub-in-${n.id}`}
                type="target"
                position={Position.Left}
                style={{ top: `${20 + i * 24}px` }}
                className="!bg-panel-hi !border-accent"
              />
              <span>{n.data.kind === 'input' ? n.data.itemId : ''}</span>
            </div>
          ))}
        </div>
        <div className="relative text-right">
          {outputs.length === 0 && (
            <div className="px-3 py-1 text-[10px] italic text-[#6b7388]">no outputs</div>
          )}
          {outputs.map((n, i) => (
            <div key={n.id} className="relative py-1 pl-2 pr-3 text-xs">
              <Handle
                id={`sub-out-${n.id}`}
                type="source"
                position={Position.Right}
                style={{ top: `${20 + i * 24}px` }}
                className="!bg-panel-hi !border-accent"
              />
              <span>{n.data.kind === 'output' ? n.data.itemId : ''}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-b-md border-t border-border bg-panel-hi px-3 py-1 text-[10px] text-[#6b7388]">
        Double-click to open
      </div>
    </div>
  );
}

export default memo(CompositeNode);
