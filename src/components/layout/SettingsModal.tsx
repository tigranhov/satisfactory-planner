import { useEffect } from 'react';
import { Settings, X } from 'lucide-react';
import { Position } from '@xyflow/react';
import {
  useUiStore,
  type ClockStrategy,
  type EdgeStyle,
  type GridSize,
  type GroupingStrategy,
} from '@/store/uiStore';
import { buildEdgePath } from '@/lib/edgeStyle';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ClockOption {
  value: ClockStrategy;
  label: string;
  description: string;
}

interface GroupingOption {
  value: GroupingStrategy;
  label: string;
  description: string;
}

const CLOCK_STRATEGIES: ClockOption[] = [
  {
    value: 'partial-last',
    label: 'N−1 @ 100% + 1 partial',
    description:
      'Run as many 100% machines as fit, underclock only the last one to absorb the remainder. Fewer machines, higher power per unit.',
  },
  {
    value: 'uniform',
    label: 'All uniform',
    description:
      'Run all N machines at the same partial clock so nothing idles. More machines, lowest total power — power is superlinear with clock.',
  },
];

const GROUPING_STRATEGIES: GroupingOption[] = [
  {
    value: 'combined',
    label: 'Combine same-clock machines',
    description:
      'One node per clock bucket with its machine count. A 2×100% + 1×33% plan becomes two nodes instead of three. Tidier canvas.',
  },
  {
    value: 'split',
    label: 'One node per machine',
    description:
      'Every machine is its own recipe node with count=1. Useful when you want to tweak or annotate each machine individually.',
  },
];

interface GridSizeOption {
  value: GridSize;
  label: string;
  description: string;
}

const GRID_SIZES: GridSizeOption[] = [
  { value: 10, label: '10 px', description: 'Fine — fits dense layouts.' },
  { value: 20, label: '20 px', description: 'Default — matches the canvas dot grid.' },
  { value: 40, label: '40 px', description: 'Coarse — keeps wide nodes on rails.' },
];

interface EdgeStyleOption {
  value: EdgeStyle;
  label: string;
  description: string;
}

const EDGE_STYLE_OPTIONS: EdgeStyleOption[] = [
  { value: 'bezier', label: 'Bezier', description: 'Smooth curves. The default.' },
  { value: 'straight', label: 'Straight', description: 'Direct lines from source to target.' },
  { value: 'step', label: 'Step', description: 'Orthogonal corners, no rounding.' },
  { value: 'smoothstep', label: 'Smoothstep', description: 'Orthogonal corners, rounded.' },
];

export default function SettingsModal({ open, onClose }: Props) {
  const clockStrategy = useUiStore((s) => s.clockStrategy);
  const setClockStrategy = useUiStore((s) => s.setClockStrategy);
  const groupingStrategy = useUiStore((s) => s.groupingStrategy);
  const setGroupingStrategy = useUiStore((s) => s.setGroupingStrategy);
  const snapToGrid = useUiStore((s) => s.snapToGrid);
  const setSnapToGrid = useUiStore((s) => s.setSnapToGrid);
  const gridSize = useUiStore((s) => s.gridSize);
  const setGridSize = useUiStore((s) => s.setGridSize);
  const edgeStyle = useUiStore((s) => s.edgeStyle);
  const setEdgeStyle = useUiStore((s) => s.setEdgeStyle);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="flex w-[520px] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border bg-panel-hi px-4 py-2.5">
          <Settings className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Settings</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <SettingSection
            heading="Auto-fill clock strategy"
            blurb="How the machine count and clock speeds are computed when auto-filling a recipe node's inputs."
          >
            {CLOCK_STRATEGIES.map((opt) => (
              <StrategyButton
                key={opt.value}
                active={clockStrategy === opt.value}
                label={opt.label}
                description={opt.description}
                onClick={() => setClockStrategy(opt.value)}
              />
            ))}
          </SettingSection>

          <SettingSection
            heading="Auto-fill node grouping"
            blurb="Whether multiple same-clock machines get collapsed into one count-based node, or placed as individual nodes."
          >
            {GROUPING_STRATEGIES.map((opt) => (
              <StrategyButton
                key={opt.value}
                active={groupingStrategy === opt.value}
                label={opt.label}
                description={opt.description}
                onClick={() => setGroupingStrategy(opt.value)}
              />
            ))}
          </SettingSection>

          <SettingSection
            heading="Edge style"
            blurb="The line shape used for connections between nodes. Rate / satisfaction colors are unaffected."
          >
            {EDGE_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEdgeStyle(opt.value)}
                className={`flex items-center gap-3 rounded border px-3 py-2 text-left transition-colors ${
                  edgeStyle === opt.value
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-panel-hi hover:border-accent/50'
                }`}
              >
                <EdgeStylePreview style={opt.value} />
                <div className="flex flex-col gap-0.5">
                  <span
                    className={`text-sm font-medium ${edgeStyle === opt.value ? 'text-accent' : ''}`}
                  >
                    {opt.label}
                  </span>
                  <span className="text-[11px] text-[#9aa2b8]">{opt.description}</span>
                </div>
              </button>
            ))}
          </SettingSection>

          <SettingSection
            heading="Grid"
            blurb="Snap node positions to a fixed grid step when dragging or creating. Off by default."
          >
            <StrategyButton
              active={snapToGrid}
              label={snapToGrid ? 'Snap to grid: On' : 'Snap to grid: Off'}
              description="Click to toggle. Affects drag, paste, and new-node placement."
              onClick={() => setSnapToGrid(!snapToGrid)}
            />
            {snapToGrid && (
              <div className="flex gap-2">
                {GRID_SIZES.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGridSize(opt.value)}
                    className={`flex flex-1 flex-col gap-0.5 rounded border px-2 py-1.5 text-left transition-colors ${
                      gridSize === opt.value
                        ? 'border-accent bg-accent/10'
                        : 'border-border bg-panel-hi hover:border-accent/50'
                    }`}
                  >
                    <span
                      className={`text-xs font-medium ${gridSize === opt.value ? 'text-accent' : ''}`}
                    >
                      {opt.label}
                    </span>
                    <span className="text-[10px] text-[#9aa2b8]">{opt.description}</span>
                  </button>
                ))}
              </div>
            )}
          </SettingSection>
        </div>
      </div>
    </div>
  );
}

interface SettingSectionProps {
  heading: string;
  blurb: string;
  children: React.ReactNode;
}

function SettingSection({ heading, blurb, children }: SettingSectionProps) {
  return (
    <div>
      <div className="mb-2 text-[10px] uppercase tracking-wider text-[#6b7388]">
        {heading}
      </div>
      <div className="mb-3 text-xs text-[#9aa2b8]">{blurb}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

interface StrategyButtonProps {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}

function EdgeStylePreview({ style }: { style: EdgeStyle }) {
  const [path] = buildEdgePath(style, {
    sourceX: 4,
    sourceY: 6,
    targetX: 60,
    targetY: 22,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  });
  return (
    <svg
      viewBox="0 0 64 28"
      className="h-7 w-16 shrink-0 text-[#9aa2b8]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

function StrategyButton({ active, label, description, onClick }: StrategyButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1 rounded border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/10'
          : 'border-border bg-panel-hi hover:border-accent/50'
      }`}
    >
      <span className={`text-sm font-medium ${active ? 'text-accent' : ''}`}>{label}</span>
      <span className="text-[11px] text-[#9aa2b8]">{description}</span>
    </button>
  );
}
