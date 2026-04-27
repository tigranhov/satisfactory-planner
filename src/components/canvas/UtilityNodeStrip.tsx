import type { ComponentType } from 'react';
import { LogIn, LogOut, Merge, Split, Target, Trash2, TrendingUp, Waypoints } from 'lucide-react';

export type UtilityChoice =
  | { kind: 'hublike'; which: 'hub' | 'splitter' | 'merger' }
  | { kind: 'interface'; which: 'input' | 'output' }
  | { kind: 'target' }
  | { kind: 'sink' }
  | { kind: 'yieldSolver' };

interface Props {
  // Input/Output boundary nodes are only meaningful inside a subgraph.
  allowInterface?: boolean;
  // Target/Sink only consume — only useful for canvas-add (anywhere) and
  // source-drag (looking for a consumer). A target-handle drag (looking
  // for a producer) hides them.
  showTargetSink?: boolean;
  // Drag-from-handle yield-solver entry. Only enabled when the dragged source
  // node is an extractor or Input — in those cases we know the item + rate
  // and can seed the modal directly.
  showYieldSolver?: boolean;
  onPick: (choice: UtilityChoice) => void;
}

type IconType = ComponentType<{ className?: string }>;

interface StripButton<K> {
  kind: K;
  icon: IconType;
  title: string;
  hoverClass: string;
}

const HUBLIKE_BUTTONS: StripButton<'hub' | 'splitter' | 'merger'>[] = [
  { kind: 'hub', icon: Waypoints, title: 'Add Hub', hoverClass: 'hover:text-amber-300' },
  { kind: 'splitter', icon: Split, title: 'Add Splitter (1 → 3)', hoverClass: 'hover:text-cyan-300' },
  { kind: 'merger', icon: Merge, title: 'Add Merger (3 → 1)', hoverClass: 'hover:text-cyan-300' },
];

const INTERFACE_BUTTONS: StripButton<'input' | 'output'>[] = [
  { kind: 'input', icon: LogIn, title: 'Add Input (connect to set type)', hoverClass: 'hover:text-sky-300' },
  { kind: 'output', icon: LogOut, title: 'Add Output (connect to set type)', hoverClass: 'hover:text-fuchsia-300' },
];

const STRIP_BUTTON_CLASS =
  'flex h-7 w-7 items-center justify-center rounded text-[#9aa2b8] hover:bg-panel';

export default function UtilityNodeStrip({
  allowInterface = false,
  showTargetSink = true,
  showYieldSolver = false,
  onPick,
}: Props) {
  return (
    <div className="flex w-9 flex-col items-center gap-1 border-l border-border bg-panel-hi py-1.5">
      {HUBLIKE_BUTTONS.map(({ kind, icon: Icon, title, hoverClass }) => (
        <button
          key={kind}
          onClick={() => onPick({ kind: 'hublike', which: kind })}
          title={title}
          className={`${STRIP_BUTTON_CLASS} ${hoverClass}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      {allowInterface && (
        <>
          <div className="my-0.5 h-px w-5 bg-border" />
          {INTERFACE_BUTTONS.map(({ kind, icon: Icon, title, hoverClass }) => (
            <button
              key={kind}
              onClick={() => onPick({ kind: 'interface', which: kind })}
              title={title}
              className={`${STRIP_BUTTON_CLASS} ${hoverClass}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </>
      )}
      {showTargetSink && (
        <>
          <div className="my-0.5 h-px w-5 bg-border" />
          <button
            onClick={() => onPick({ kind: 'target' })}
            title="Add Target (time-to-reach annotation)"
            className={`${STRIP_BUTTON_CLASS} hover:text-emerald-300`}
          >
            <Target className="h-4 w-4" />
          </button>
          <button
            onClick={() => onPick({ kind: 'sink' })}
            title="Add Sink (consumes items for sink points)"
            className={`${STRIP_BUTTON_CLASS} hover:text-cyan-300`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
      {showYieldSolver && (
        <>
          <div className="my-0.5 h-px w-5 bg-border" />
          <button
            onClick={() => onPick({ kind: 'yieldSolver' })}
            title="Maximize output…"
            className={`${STRIP_BUTTON_CLASS} hover:text-emerald-300`}
          >
            <TrendingUp className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
