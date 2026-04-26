import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Minus, Plus, Sigma, Sliders, X } from 'lucide-react';
import { loadGameData } from '@/data/loader';
import { useGraphStore } from '@/store/graphStore';
import {
  currentChainMetrics,
  gatherUpstreamScope,
  type CurrentChainMetrics,
  type OptimizerScope,
} from '@/lib/optimizerScope';
import { optimize, type OptimizerObjective, type OptimizerResult } from '@/lib/optimizer';
import { applyOptimization, canApplyDiff } from '@/lib/optimizerApply';
import { buildRecipeDiff, type RecipeDiff } from '@/lib/optimizerDiff';
import { formatNumber } from '@/lib/format';
import IconOrLabel from '@/components/ui/IconOrLabel';
import type { GraphId, NodeId } from '@/models/graph';
import type { Recipe } from '@/data/types';

type ObjectiveKind = 'raw' | 'power' | 'buildCost';

const OBJECTIVE_LABELS: Record<ObjectiveKind, string> = {
  raw: 'Raw resources (minimize boundary intake)',
  power: 'Power (minimize MW)',
  buildCost: 'Build cost (minimize total parts)',
};

const gameData = loadGameData();

interface Props {
  open: boolean;
  graphId: GraphId;
  targetNodeId: NodeId | null;
  onClose: () => void;
}

export default function OptimizeChainModal({ open, graphId, targetNodeId, onClose }: Props) {
  const graph = useGraphStore((s) => s.graphs[graphId]);

  const scope = useMemo(() => {
    if (!open || !targetNodeId || !graph) return null;
    return gatherUpstreamScope(graph, targetNodeId, gameData);
  }, [open, targetNodeId, graph]);

  const current = useMemo(() => {
    if (!scope || !graph) return null;
    return currentChainMetrics(scope, gameData, graph);
  }, [scope, graph]);

  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [objective, setObjective] = useState<ObjectiveKind>('raw');
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setObjective('raw');
      setApplyError(null);
    }
  }, [open]);

  useEffect(() => {
    setResult(null);
    setApplyError(null);
  }, [objective]);

  const diff = useMemo(() => {
    if (!result || !result.feasible || !current) return null;
    return buildRecipeDiff(current.recipeRates, result.recipeRates, gameData);
  }, [result, current]);

  const applyCheck = diff ? canApplyDiff(diff) : null;
  const totalChanges = diff
    ? diff.swaps.length + diff.rateChanges.length + diff.added.length + diff.removed.length
    : 0;
  const applyEnabled = !!diff && !!applyCheck?.ok && totalChanges > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const targetItem = scope ? gameData.items[scope.target.itemId] : undefined;

  const handleSolve = () => {
    if (!scope) return;
    const obj: OptimizerObjective = { kind: objective };
    setResult(optimize(scope, obj, gameData));
    setApplyError(null);
  };

  const handleApply = () => {
    if (!scope || !result || !result.feasible || !diff) return;
    const outcome = applyOptimization(graphId, scope, diff, gameData);
    if (outcome.ok) {
      onClose();
    } else {
      setApplyError(outcome.reason);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="flex w-[640px] max-w-[95vw] max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border bg-panel-hi px-4 py-2.5">
          <Sigma className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Optimize chain</span>
          {scope && targetItem && (
            <span className="ml-2 truncate text-xs text-[#9aa2b8]">
              {scope.chain.length} recipe{scope.chain.length === 1 ? '' : 's'} →{' '}
              {targetItem.name} @ {formatNumber(scope.target.rate, 2)}/min
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!scope && (
            <div className="px-4 py-6 text-center text-xs text-[#6b7388]">
              Select a recipe or output node with a connected upstream chain to optimize.
            </div>
          )}
          {scope && (
            <div className="border-b border-border px-4 py-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-[#6b7388]">
                Objective
              </div>
              <div className="flex flex-col gap-1">
                {(['raw', 'power', 'buildCost'] as const).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setObjective(kind)}
                    className={`rounded border px-2 py-1 text-left text-xs ${
                      objective === kind
                        ? 'border-accent/60 bg-accent/10 text-[#e6e8ee]'
                        : 'border-border text-[#9aa2b8] hover:border-accent/40 hover:text-[#e6e8ee]'
                    }`}
                  >
                    {OBJECTIVE_LABELS[kind]}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-[#6b7388]">
                {scope.candidates.size} candidate recipe{scope.candidates.size === 1 ? '' : 's'} ·{' '}
                {scope.boundaryItems.size} boundary item
                {scope.boundaryItems.size === 1 ? '' : 's'}
              </div>
              {applyCheck && !applyCheck.ok && (
                <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-200/80">
                  {applyCheck.reason}
                </div>
              )}
              {scope.hasSloops && (
                <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-200/80">
                  Somersloops detected on chain nodes. They&rsquo;re excluded from the
                  optimizer&rsquo;s rate / power / build calculations — chain rates are
                  reported as if no sloops were installed. Applying a swap will clear
                  sloops on swapped recipes (you can re-add them after).
                </div>
              )}
              {applyError && (
                <div className="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
                  {applyError}
                </div>
              )}
            </div>
          )}
          {scope && current && result && result.feasible && diff && (
            <SolutionView scope={scope} current={current} result={result} diff={diff} />
          )}
          {result && !result.feasible && (
            <div className="px-4 py-6 text-center text-xs text-red-300">{result.message}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-panel-hi px-4 py-2">
          <button
            onClick={onClose}
            className="rounded bg-panel px-3 py-1 text-xs text-[#9aa2b8] hover:text-[#e6e8ee]"
          >
            Close
          </button>
          <button
            onClick={handleSolve}
            disabled={!scope}
            className="rounded bg-panel px-3 py-1 text-xs text-[#9aa2b8] hover:text-[#e6e8ee] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Solve
          </button>
          <button
            onClick={handleApply}
            disabled={!applyEnabled}
            title={
              applyCheck && !applyCheck.ok
                ? applyCheck.reason
                : totalChanges === 0
                ? 'Nothing to apply'
                : 'Apply changes (Ctrl+Z to undo)'
            }
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-[#1b1410] hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function SolutionView({
  scope,
  current,
  result,
  diff,
}: {
  scope: OptimizerScope;
  current: CurrentChainMetrics;
  result: Extract<OptimizerResult, { feasible: true }>;
  diff: RecipeDiff;
}) {
  const supplyRows = useMemo(() => {
    const itemIds = new Set<string>([
      ...current.boundaryConsumption.keys(),
      ...result.boundarySupply.keys(),
    ]);
    return [...itemIds]
      .map((id) => ({
        item: gameData.items[id],
        before: current.boundaryConsumption.get(id) ?? 0,
        after: result.boundarySupply.get(id) ?? 0,
      }))
      .filter((row) => row.item)
      .sort((a, b) => Math.max(b.before, b.after) - Math.max(a.before, a.after));
  }, [current, result]);

  const currentRaw = useMemo(
    () => [...current.boundaryConsumption.values()].reduce((s, v) => s + v, 0),
    [current],
  );
  const totalChanges =
    diff.swaps.length + diff.rateChanges.length + diff.added.length + diff.removed.length;

  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-[#6b7388]">
          <span>Recipe changes ({totalChanges})</span>
          {diff.keptCount > 0 && (
            <span className="text-[#6b7388] normal-case">
              {diff.keptCount} unchanged
            </span>
          )}
        </div>
        {totalChanges === 0 && (
          <div className="text-xs text-[#9aa2b8]">
            Already optimal for this objective — nothing to change.
          </div>
        )}
        <RecipeDiffSection diff={diff} />
      </div>
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[10px] uppercase tracking-wider text-[#6b7388]">
          <span>Boundary intake</span>
          <span className="w-20 text-right">Current</span>
          <span className="w-20 text-right">Optimal</span>
        </div>
        {supplyRows.length === 0 && (
          <div className="text-xs text-[#6b7388]">No boundary items.</div>
        )}
        {supplyRows.map(({ item, before, after }) => (
          <div
            key={item.id}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-1 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <IconOrLabel iconBasename={item.icon} name={item.name} className="h-4 w-4 rounded" />
              <span className="truncate">{item.name}</span>
            </div>
            <span className="w-20 text-right tabular-nums text-[#9aa2b8]">
              {before > 0 ? `${formatNumber(before, 2)}/min` : '—'}
            </span>
            <DeltaCell before={before} after={after} unit="/min" />
          </div>
        ))}
      </div>
      <div className="px-4 py-3 text-xs">
        <TotalsRow
          label="Total raw intake"
          before={currentRaw}
          after={result.totals.rawIntake}
          unit="/min"
        />
        <TotalsRow
          label="Power"
          before={current.powerMW}
          after={result.totals.powerMW}
          unit=" MW"
        />
        <TotalsRow
          label="Build cost (parts)"
          before={current.buildCostScalar}
          after={result.totals.buildCostScalar}
          unit=""
          decimals={0}
        />
        <div className="mt-2 text-[10px] text-[#6b7388]">
          Scope: {scope.candidates.size} candidates · {scope.boundaryItems.size} boundary item
          {scope.boundaryItems.size === 1 ? '' : 's'}. Power and build cost are computed at 100%
          clocks; the optimizer doesn&rsquo;t pick clock speeds.
        </div>
      </div>
    </>
  );
}

function RecipeDiffSection({ diff }: { diff: RecipeDiff }) {
  return (
    <div className="flex flex-col gap-2">
      {diff.swaps.length > 0 && (
        <DiffGroup label="Swap" tone="text-amber-300">
          {diff.swaps.map((entry, i) => {
            if (entry.kind !== 'swap') return null;
            return (
              <div
                key={`swap-${i}`}
                className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 py-0.5 text-xs"
              >
                <RecipeName recipe={entry.from} muted />
                <span className="w-14 text-right tabular-nums text-[#6b7388]">
                  ×{formatNumber(entry.before, 2)}
                </span>
                <ArrowRight className="h-3 w-3 text-amber-300" />
                <RecipeName recipe={entry.to} />
                <span className="w-14 text-right tabular-nums text-amber-300">
                  ×{formatNumber(entry.after, 2)}
                </span>
              </div>
            );
          })}
        </DiffGroup>
      )}
      {diff.rateChanges.length > 0 && (
        <DiffGroup label="Adjust rate" tone="text-sky-300" icon={Sliders}>
          {diff.rateChanges.map((entry, i) => {
            if (entry.kind !== 'rateChanged') return null;
            return (
              <div
                key={`rate-${i}`}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-0.5 text-xs"
              >
                <RecipeName recipe={entry.recipe} />
                <span className="w-14 text-right tabular-nums text-[#6b7388]">
                  ×{formatNumber(entry.before, 2)}
                </span>
                <ArrowRight className="h-3 w-3 text-sky-300" />
                <span className="w-14 text-right tabular-nums text-sky-300">
                  ×{formatNumber(entry.after, 2)}
                </span>
              </div>
            );
          })}
        </DiffGroup>
      )}
      {diff.added.length > 0 && (
        <DiffGroup label="Add" tone="text-emerald-400" icon={Plus}>
          {diff.added.map((entry, i) => {
            if (entry.kind !== 'added') return null;
            return (
              <div
                key={`add-${i}`}
                className="flex items-center justify-between gap-2 py-0.5 text-xs"
              >
                <RecipeName recipe={entry.recipe} />
                <span className="tabular-nums text-emerald-400">
                  ×{formatNumber(entry.rate, 2)}
                </span>
              </div>
            );
          })}
        </DiffGroup>
      )}
      {diff.removed.length > 0 && (
        <DiffGroup label="Remove" tone="text-red-400" icon={Minus}>
          {diff.removed.map((entry, i) => {
            if (entry.kind !== 'removed') return null;
            return (
              <div
                key={`rm-${i}`}
                className="flex items-center justify-between gap-2 py-0.5 text-xs"
              >
                <RecipeName recipe={entry.recipe} />
                <span className="tabular-nums text-red-400">×{formatNumber(entry.rate, 2)}</span>
              </div>
            );
          })}
        </DiffGroup>
      )}
    </div>
  );
}

function DiffGroup({
  label,
  tone,
  icon: Icon,
  children,
}: {
  label: string;
  tone: string;
  icon?: typeof Plus;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider ${tone}`}>
        {Icon && <Icon className="h-3 w-3" />}
        <span>{label}</span>
      </div>
      <div className="rounded border border-border/50 bg-panel-hi/40 px-2 py-1">{children}</div>
    </div>
  );
}

function RecipeName({ recipe, muted = false }: { recipe: Recipe; muted?: boolean }) {
  return (
    <span className={`truncate text-xs ${muted ? 'text-[#6b7388] line-through' : ''}`}>
      {recipe.name}
      {recipe.alternate && (
        <span
          className={`ml-1 rounded px-1 text-[10px] ${
            muted ? 'bg-amber-500/10 text-amber-400/60' : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          alt
        </span>
      )}
    </span>
  );
}

function DeltaCell({ before, after, unit }: { before: number; after: number; unit: string }) {
  const tone = deltaTone(before, after);
  return (
    <span className={`w-20 text-right tabular-nums ${tone}`}>
      {after > 0 ? `${formatNumber(after, 2)}${unit}` : '—'}
    </span>
  );
}

function TotalsRow({
  label,
  before,
  after,
  unit,
  decimals = 2,
}: {
  label: string;
  before: number;
  after: number;
  unit: string;
  decimals?: number;
}) {
  const tone = deltaTone(before, after);
  const delta = before > 0 ? ((after - before) / before) * 100 : null;
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-0.5">
      <span className="text-[#9aa2b8]">{label}</span>
      <span className="w-20 text-right tabular-nums text-[#9aa2b8]">
        {formatNumber(before, decimals)}
        {unit}
      </span>
      <span className={`w-20 text-right tabular-nums ${tone}`}>
        {formatNumber(after, decimals)}
        {unit}
      </span>
      <span className={`w-14 text-right tabular-nums text-[10px] ${tone}`}>
        {delta === null ? '' : `${delta > 0 ? '+' : ''}${formatNumber(delta, 0)}%`}
      </span>
    </div>
  );
}

function deltaTone(before: number, after: number): string {
  if (before <= 1e-9 && after <= 1e-9) return 'text-[#9aa2b8]';
  if (after < before - 1e-9) return 'text-emerald-400';
  if (after > before + 1e-9) return 'text-red-400';
  return 'text-[#9aa2b8]';
}
