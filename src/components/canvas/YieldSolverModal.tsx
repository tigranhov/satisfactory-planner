import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, X } from 'lucide-react';
import { loadGameData, getProducibleItems } from '@/data/loader';
import {
  gatherYieldScope,
  optimizeForTarget,
  optimizeYield,
  reachableProducts,
  relevantAuxItems,
  type YieldResult,
  type YieldScope,
  type YieldSolution,
} from '@/lib/yieldSolver';
import { applyMinInputChain, applyYieldChain } from '@/lib/yieldApply';
import { computeClockSplit } from '@/lib/autoFill';
import { formatNumber, formatRate } from '@/lib/format';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { useUiStore } from '@/store/uiStore';
import type { GraphId } from '@/models/graph';
import type { GameData, ItemId, RecipeId } from '@/data/types';

const gameData = loadGameData();
const producibleItemList = getProducibleItems(gameData);

// Items produced by any extraction recipe (Water, Iron Ore, Coal, Sulfur, …).
// These are unlimited in-game, so we offer them as free auxiliary supply with
// a large cap. Without this, "Crude Oil → Turbofuel" would fail because
// Compacted Coal can't reach Coal from the user's input set.
const AUX_RATE = 1e9;
const auxiliaryItems: Set<ItemId> = (() => {
  const out = new Set<ItemId>();
  for (const recipe of Object.values(gameData.recipes)) {
    if (!recipe.isExtraction) continue;
    for (const p of recipe.products) out.add(p.itemId);
  }
  return out;
})();

export type YieldDirection = 'maxOutput' | 'minInput';

export interface YieldSource {
  nodeId: string;
  itemId: ItemId;
  defaultRate: number;
  // Source-side handle on `nodeId` carrying `itemId`. Apply wires the new
  // chain off this handle.
  // - maxOutput: the handle is producer-side (extractor product / Input out).
  // - minInput: the handle is consumer-side (Output in / Sink in / Target in).
  handle: string;
  // Position drives the cascade layout for placed recipe nodes.
  position: { x: number; y: number };
  // Default 'maxOutput'. 'minInput' flips the modal — locked output (the
  // node's item), user enters target rate, LP minimizes raw intake, build
  // cascades LEFT into the node.
  direction?: YieldDirection;
}

interface Props {
  open: boolean;
  graphId: GraphId;
  source: YieldSource | null;
  onClose: () => void;
}

interface InputRow {
  itemId: ItemId;
  rate: number;
  // Locked rows can't be removed and their item can't be changed — the modal's
  // entry-point source is always row 0 with locked=true.
  locked: boolean;
}

interface SolvedOutput {
  result: YieldResult;
  scope: YieldScope | null;
}

// In min-input mode, "allRaw" charges every auxiliary equally (current LP
// default — minimizes total raw items). A specific item id charges only that
// item, mirroring the forward direction's source-only optimization (e.g. pick
// "crude-oil" to get the same recipe choice the maxOutput modal would).
type MinInputObjective = 'allRaw' | ItemId;

export default function YieldSolverModal({ open, graphId, source, onClose }: Props) {
  const [rows, setRows] = useState<InputRow[]>([]);
  const [pinned, setPinned] = useState<ItemId[]>([]);
  const [focused, setFocused] = useState<ItemId | null>(null);
  const [results, setResults] = useState<Map<ItemId, SolvedOutput>>(new Map());
  const [buildError, setBuildError] = useState<string | null>(null);
  const [minObjective, setMinObjective] = useState<MinInputObjective>('allRaw');

  useEffect(() => {
    if (!open || !source) return;
    setRows([{ itemId: source.itemId, rate: source.defaultRate, locked: true }]);
    if (source.direction === 'minInput') {
      // The output is the source's item, locked. Pin + focus it so the result
      // detail renders immediately on Solve without the user picking anything.
      setPinned([source.itemId]);
      setFocused(source.itemId);
    } else {
      setPinned([]);
      setFocused(null);
    }
    setResults(new Map());
    setBuildError(null);
    setMinObjective('allRaw');
  }, [open, source]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const direction: YieldDirection = source?.direction ?? 'maxOutput';
  const sourceItem = source ? gameData.items[source.itemId] : undefined;
  const sourceRow = rows[0];

  // Build the LP input map. In maxOutput mode rows carry user-set caps that
  // become real constraints. In minInput mode the rows aren't user-facing —
  // we just feed every auxiliary at unlimited supply so the BFS reaches the
  // target item.
  const inputsMap = useMemo(() => {
    const map = new Map<ItemId, number>();
    if (direction === 'maxOutput') {
      for (const row of rows) map.set(row.itemId, row.rate);
    }
    for (const aux of auxiliaryItems) {
      if (!map.has(aux)) map.set(aux, AUX_RATE);
    }
    return map;
  }, [rows, direction]);

  // For maxOutput we want a *source-dependent* reachable set: items reachable
  // with the source minus items reachable from auxiliaries (and other input
  // rows) alone. Without this, an Iron Ore aux trivially produces unlimited
  // Iron Ingot regardless of the Crude Oil source — the picker would happily
  // surface Iron Ingot and the LP would solve to absurd numbers because the
  // source isn't on the critical path.
  const reachableSet = useMemo(() => {
    if (!source) return new Set<ItemId>();
    const withSource = reachableProducts(inputsMap.keys(), gameData);
    if (direction === 'minInput') return withSource;
    const withoutSource = new Set<ItemId>();
    for (const id of inputsMap.keys()) {
      if (id !== source.itemId) withoutSource.add(id);
    }
    const auxOnly = reachableProducts(withoutSource, gameData);
    const sourceDependent = new Set<ItemId>();
    for (const id of withSource) {
      if (!auxOnly.has(id)) sourceDependent.add(id);
    }
    return sourceDependent;
  }, [source, direction, inputsMap]);

  const outputOptions = useMemo(() => {
    const rowItemIds = new Set(rows.map((r) => r.itemId));
    const pinnedSet = new Set(pinned);
    return producibleItemList.filter(
      (it) => !rowItemIds.has(it.id) && !pinnedSet.has(it.id) && reachableSet.has(it.id),
    );
  }, [rows, reachableSet, pinned]);

  // In min-input mode, narrow the "Optimize for" picker to items the chain
  // might actually consume — runs the LP a few times and collects the
  // auxiliaries that show up in any optimum. Static BFS alone is too
  // generous (Steel Canister alt drags Iron Ore into Turbofuel scope).
  // Uses a unit target rate so the result depends only on the chain's
  // structure, not on what the user typed.
  const minObjectiveOptions = useMemo(() => {
    if (direction !== 'minInput' || !source) return [];
    const minInputScope = gatherYieldScope(inputsMap, source.itemId, gameData);
    if (!minInputScope) return [];
    const aux = relevantAuxItems(minInputScope, gameData, 1);
    return Array.from(aux)
      .map((id) => gameData.items[id])
      .filter((it): it is NonNullable<typeof it> => !!it)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [direction, source, inputsMap]);

  // Any item not already in rows is fair game as a constrained input — base
  // resources, intermediates, even end products. Auxiliaries (extraction
  // items) still default to unlimited supply when not listed; any other item
  // not in rows is simply absent from the LP (no supply variable).
  const addableItems = useMemo(() => {
    const taken = new Set(rows.map((r) => r.itemId));
    const items = Object.values(gameData.items).filter((it) => !taken.has(it.id));
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  if (!open || !source) return null;

  const updateRow = (idx: number, patch: Partial<InputRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    // Inputs changed → existing results are stale.
    setResults(new Map());
    setBuildError(null);
  };
  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setResults(new Map());
  };
  const addRow = (itemId: ItemId) => {
    setRows((prev) => [...prev, { itemId, rate: 60, locked: false }]);
    setResults(new Map());
  };

  const solveFor = (itemId: ItemId): SolvedOutput => {
    const nextScope = gatherYieldScope(inputsMap, itemId, gameData);
    if (!nextScope) {
      return {
        scope: null,
        result: { feasible: false, message: 'Output is not reachable from these inputs.' },
      };
    }
    if (direction === 'minInput') {
      const costs =
        minObjective === 'allRaw' ? null : new Map<ItemId, number>([[minObjective, 1]]);
      return {
        scope: nextScope,
        result: optimizeForTarget(nextScope, sourceRow?.rate ?? 0, gameData, costs),
      };
    }
    return { scope: nextScope, result: optimizeYield(nextScope, gameData) };
  };

  const addOutput = (itemId: ItemId) => {
    setBuildError(null);
    setPinned((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
    setResults((prev) => {
      const next = new Map(prev);
      next.set(itemId, solveFor(itemId));
      return next;
    });
    if (focused === null) setFocused(itemId);
  };

  const removeOutput = (itemId: ItemId) => {
    setPinned((prev) => prev.filter((id) => id !== itemId));
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
    setFocused((prev) => (prev === itemId ? null : prev));
  };

  // Re-run every pinned output against the current inputs. Used after the
  // user edits rates and wants the comparison refreshed in one click.
  const handleResolveAll = () => {
    setBuildError(null);
    const next = new Map<ItemId, SolvedOutput>();
    for (const id of pinned) next.set(id, solveFor(id));
    setResults(next);
  };

  const handleBuild = () => {
    if (!focused) return;
    const entry = results.get(focused);
    if (!entry || !entry.result.feasible || !entry.scope) return;
    const { gridSize, snapToGrid } = useUiStore.getState();
    const apply = direction === 'minInput' ? applyMinInputChain : applyYieldChain;
    const outcome = apply(graphId, source, entry.scope, entry.result, gameData, {
      gridSize,
      snapToGrid,
    });
    if (outcome.ok) {
      onClose();
    } else {
      setBuildError(outcome.reason ?? 'Build failed.');
    }
  };

  const focusedEntry = focused ? results.get(focused) : undefined;
  const focusedItem = focused ? gameData.items[focused] : undefined;
  const canBuild = !!focusedEntry && focusedEntry.result.feasible && !!focusedEntry.scope;
  const showCompare = pinned.length >= 2 && !focused;
  const sourceRateOk = (sourceRow?.rate ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[85vh] w-[720px] flex-col overflow-hidden rounded-md border border-border bg-panel text-sm shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border bg-panel-hi px-4 py-3">
          <TrendingUp className="h-4 w-4 text-emerald-300" />
          <span className="font-medium">
            {direction === 'minInput' ? 'Plan chain to produce' : 'Maximize output from'}
          </span>
          <IconOrLabel
            iconBasename={sourceItem?.icon}
            name={sourceItem?.name ?? source.itemId}
            className="h-5 w-5 rounded"
          />
          <span>{sourceItem?.name ?? source.itemId}</span>
          <button
            onClick={onClose}
            title="Close"
            className="ml-auto rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {direction === 'maxOutput' ? (
          <div className="space-y-2 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-[#6b7388]">Inputs</span>
              {addableItems.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addRow(e.target.value as ItemId);
                  }}
                  className="rounded border border-border bg-panel-hi px-2 py-0.5 text-[10px] text-[#9aa2b8] outline-none focus:border-accent"
                >
                  <option value="">+ Add input…</option>
                  {addableItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {rows.map((row, idx) => {
              const item = gameData.items[row.itemId];
              return (
                <div key={row.itemId} className="flex items-center gap-2">
                  <IconOrLabel
                    iconBasename={item?.icon}
                    name={item?.name ?? row.itemId}
                    className="h-4 w-4 rounded"
                  />
                  <span className="min-w-[120px] text-xs">{item?.name ?? row.itemId}</span>
                  <input
                    type="number"
                    value={row.rate}
                    onChange={(e) => updateRow(idx, { rate: Number(e.target.value) || 0 })}
                    min={0}
                    step={1}
                    className="w-24 rounded border border-border bg-panel-hi px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                  <span className="text-xs text-[#9aa2b8]">/min</span>
                  {!row.locked && (
                    <button
                      onClick={() => removeRow(idx)}
                      title="Remove input"
                      className="ml-auto rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-[#6b7388]">
                Target rate
              </span>
              <input
                type="number"
                value={sourceRow?.rate ?? 0}
                onChange={(e) => updateRow(0, { rate: Number(e.target.value) || 0 })}
                min={0}
                step={1}
                className="w-24 rounded border border-border bg-panel-hi px-2 py-1 text-sm outline-none focus:border-accent"
              />
              <span className="text-xs text-[#9aa2b8]">{sourceItem?.name ?? source.itemId}/min</span>
              <button
                onClick={handleResolveAll}
                disabled={!sourceRateOk}
                className="ml-auto rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1b1410] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Solve
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-[#6b7388]">
                Optimize for
              </span>
              <select
                value={minObjective}
                onChange={(e) => {
                  setMinObjective(e.target.value as MinInputObjective);
                  setResults(new Map());
                }}
                className="flex-1 rounded border border-border bg-panel-hi px-2 py-1 text-xs outline-none focus:border-accent"
              >
                <option value="allRaw">Total raw (every input weighted equally)</option>
                {minObjectiveOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    Minimize {item.name} only
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {direction === 'maxOutput' && (
        <div className="space-y-2 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[#6b7388]">
              Outputs to maximize
            </span>
            {pinned.length > 0 && (
              <button
                onClick={handleResolveAll}
                disabled={!sourceRateOk}
                title="Re-solve all outputs against current inputs"
                className="rounded border border-border bg-panel-hi px-2 py-0.5 text-[10px] text-[#9aa2b8] hover:text-accent disabled:opacity-40"
              >
                Re-solve all
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pinned.map((id) => {
              const item = gameData.items[id];
              const entry = results.get(id);
              const isFocused = id === focused;
              return (
                <button
                  key={id}
                  onClick={() => setFocused(id)}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                    isFocused
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-panel-hi hover:border-accent/40'
                  }`}
                >
                  <IconOrLabel iconBasename={item?.icon} name={item?.name ?? id} className="h-4 w-4 rounded" />
                  <span>{item?.name ?? id}</span>
                  {entry?.result.feasible && (
                    <span className="text-[10px] text-[#9aa2b8]">
                      {formatRate(entry.result.outputRate)}
                    </span>
                  )}
                  {entry && !entry.result.feasible && (
                    <span className="text-[10px] text-amber-300">×</span>
                  )}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOutput(id);
                    }}
                    className="ml-1 rounded p-0.5 text-[#6b7388] hover:bg-panel hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
            {outputOptions.length > 0 && sourceRateOk && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addOutput(e.target.value as ItemId);
                  e.target.value = '';
                }}
                className="rounded border border-border bg-panel-hi px-2 py-1 text-xs text-[#9aa2b8] outline-none focus:border-accent"
              >
                <option value="">+ Add output…</option>
                {outputOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            {pinned.length >= 2 && focused !== null && (
              <button
                onClick={() => setFocused(null)}
                className="ml-auto rounded border border-border bg-panel-hi px-2 py-1 text-[10px] text-[#9aa2b8] hover:text-accent"
              >
                ← Back to comparison
              </button>
            )}
          </div>
        </div>
        )}

        <div className="border-b border-border px-4 py-1.5 text-[10px] text-[#6b7388]">
          {direction === 'minInput'
            ? 'Auxiliary inputs (Water, Coal, Iron Ore, Sulfur, …) are treated as raw supply with cost 1 each.'
            : 'Auxiliary inputs not listed above (Water, Coal, Iron Ore, Sulfur, …) default to free supply.'}
        </div>

        <div className="flex-1 overflow-y-auto">
          {pinned.length === 0 && (
            <div className="px-4 py-3 text-xs text-[#6b7388]">
              Pick one or more outputs above. Add a second to compare side-by-side.
            </div>
          )}
          {showCompare && (
            <ComparisonView
              pinned={pinned}
              results={results}
              gameData={gameData}
              onFocus={setFocused}
            />
          )}
          {!showCompare && focusedEntry && !focusedEntry.result.feasible && (
            <div className="m-4 rounded border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              {focusedEntry.result.message}
            </div>
          )}
          {!showCompare && focusedEntry && focusedEntry.result.feasible && focusedItem && (
            <SolutionView
              solution={focusedEntry.result}
              source={source}
              sourceItemName={sourceItem?.name ?? source.itemId}
              outputItem={focusedItem}
              gameData={gameData}
            />
          )}
        </div>

        {canBuild && (
          <div className="flex items-center gap-3 border-t border-border bg-panel-hi px-4 py-2">
            {buildError && <span className="text-xs text-amber-300">{buildError}</span>}
            <button
              onClick={handleBuild}
              className="ml-auto rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1b1410] hover:opacity-90"
            >
              Build chain
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ComparisonViewProps {
  pinned: ItemId[];
  results: Map<ItemId, SolvedOutput>;
  gameData: GameData;
  onFocus: (itemId: ItemId) => void;
}

function ComparisonView({ pinned, results, gameData, onFocus }: ComparisonViewProps) {
  // Sorted by max output rate descending — feasible first, then infeasible.
  const rows = useMemo(() => {
    const out = pinned.map((id) => ({ id, entry: results.get(id) }));
    out.sort((a, b) => {
      const aFeas = a.entry?.result.feasible ?? false;
      const bFeas = b.entry?.result.feasible ?? false;
      if (aFeas !== bFeas) return aFeas ? -1 : 1;
      const aRate = a.entry?.result.feasible ? a.entry.result.outputRate : 0;
      const bRate = b.entry?.result.feasible ? b.entry.result.outputRate : 0;
      return bRate - aRate;
    });
    return out;
  }, [pinned, results]);

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-[#6b7388]">
        Comparison — click a row for full detail
      </div>
      <div className="overflow-hidden rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-panel-hi text-[10px] uppercase tracking-wider text-[#6b7388]">
            <tr>
              <th className="px-3 py-1.5 text-left">Output</th>
              <th className="px-3 py-1.5 text-right">Max rate</th>
              <th className="px-3 py-1.5 text-right">Power</th>
              <th className="px-3 py-1.5 text-right">Build</th>
              <th className="px-3 py-1.5 text-right">Recipes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, entry }) => {
              const item = gameData.items[id];
              const feasible = entry?.result.feasible;
              return (
                <tr
                  key={id}
                  onClick={() => onFocus(id)}
                  className="cursor-pointer border-t border-border hover:bg-panel-hi"
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <IconOrLabel iconBasename={item?.icon} name={item?.name ?? id} className="h-4 w-4 rounded" />
                      <span>{item?.name ?? id}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium">
                    {feasible && entry ? formatRate(entry.result.outputRate) : (
                      <span className="text-amber-300">infeasible</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#9aa2b8]">
                    {feasible && entry ? `${formatNumber(entry.result.totals.powerMW, 1)} MW` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#9aa2b8]">
                    {feasible && entry ? formatNumber(entry.result.totals.buildCostScalar, 0) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#9aa2b8]">
                    {feasible && entry ? entry.result.recipeRates.size : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SolutionViewProps {
  solution: YieldSolution;
  source: YieldSource;
  sourceItemName: string;
  outputItem: { id: string; name: string; icon?: string };
  gameData: GameData;
}

function SolutionView({ solution, source, sourceItemName, outputItem, gameData }: SolutionViewProps) {
  const sourceUsage = solution.inputUsage.get(source.itemId) ?? 0;
  // Auxiliaries the chain actually consumed (Water, Coal, etc.) — show so the
  // user knows what other resources the chain depends on.
  const auxUsage = useMemo(() => {
    const out: { itemId: ItemId; rate: number; name: string; icon?: string }[] = [];
    for (const [itemId, rate] of solution.inputUsage) {
      if (itemId === source.itemId) continue;
      const item = gameData.items[itemId];
      out.push({ itemId, rate, name: item?.name ?? itemId, icon: item?.icon });
    }
    return out.sort((a, b) => b.rate - a.rate);
  }, [solution.inputUsage, source.itemId, gameData]);

  const surplusRows = useMemo(() => {
    const out: { itemId: ItemId; rate: number; name: string; icon?: string; isPrimary: boolean }[] = [];
    for (const [itemId, rate] of solution.surplus) {
      const item = gameData.items[itemId];
      out.push({
        itemId,
        rate,
        name: item?.name ?? itemId,
        icon: item?.icon,
        isPrimary: itemId === outputItem.id,
      });
    }
    return out.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return b.rate - a.rate;
    });
  }, [solution.surplus, outputItem.id, gameData]);

  return (
    <div className="space-y-3 px-4 py-3">
      {/* Output banner */}
      <div className="flex items-center gap-3 rounded border border-emerald-400/30 bg-emerald-500/5 px-3 py-2">
        <IconOrLabel iconBasename={outputItem.icon} name={outputItem.name} className="h-7 w-7 rounded" />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300">Max output</div>
          <div className="text-base font-semibold">
            {outputItem.name} — {formatRate(solution.outputRate)}
          </div>
        </div>
        <div className="text-right text-[10px] text-[#9aa2b8]">
          <div>{formatNumber(solution.totals.powerMW, 1)} MW</div>
          <div>{formatNumber(solution.totals.buildCostScalar, 0)} parts</div>
        </div>
      </div>

      {/* Recipe rows */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">Recipes</div>
        {[...solution.recipeRates]
          .sort(([, a], [, b]) => b - a)
          .map(([recipeId, machinesAt100]) => (
            <RecipeRow
              key={recipeId}
              recipeId={recipeId}
              machinesAt100={machinesAt100}
              gameData={gameData}
            />
          ))}
      </div>

      {/* Input usage */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">Input usage</div>
        <div className="flex items-center justify-between rounded border border-border bg-panel-hi px-3 py-1.5 text-xs">
          <span>
            {sourceItemName}: <span className="font-medium">{formatRate(sourceUsage)}</span>
            <span className="ml-1 text-[#6b7388]">of {formatRate(source.defaultRate || sourceUsage)} available</span>
          </span>
        </div>
        {auxUsage.length > 0 && (
          <div className="rounded border border-border bg-panel-hi px-3 py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[#6b7388]">Auxiliaries consumed</div>
            <div className="flex flex-wrap gap-2">
              {auxUsage.map((aux) => (
                <div key={aux.itemId} className="flex items-center gap-1 text-xs">
                  <IconOrLabel iconBasename={aux.icon} name={aux.name} className="h-4 w-4 rounded" />
                  <span>{aux.name}</span>
                  <span className="text-[#9aa2b8]">{formatRate(aux.rate)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Surplus / byproducts */}
      {surplusRows.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">Output + byproducts</div>
          <div className="rounded border border-border bg-panel-hi px-3 py-1.5">
            <div className="flex flex-wrap gap-3">
              {surplusRows.map((row) => (
                <div key={row.itemId} className="flex items-center gap-1 text-xs">
                  <IconOrLabel iconBasename={row.icon} name={row.name} className="h-4 w-4 rounded" />
                  <span className={row.isPrimary ? 'font-medium text-emerald-200' : ''}>{row.name}</span>
                  <span className="text-[#9aa2b8]">{formatRate(row.rate)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface RecipeRowProps {
  recipeId: RecipeId;
  // LP "machines at 100%" (i.e. count × clockSpeed).
  machinesAt100: number;
  gameData: GameData;
}

function RecipeRow({ recipeId, machinesAt100, gameData }: RecipeRowProps) {
  const recipe = gameData.recipes[recipeId];
  if (!recipe) return null;
  const machine = gameData.machines[recipe.machineId];
  const split = computeClockSplit(machinesAt100, 1, 'uniform')[0] ?? { count: 1, clockSpeed: 1 };
  const primary = recipe.products.find((p) => !p.isByproduct) ?? recipe.products[0];
  const primaryRate = primary
    ? (primary.amount * 60) / recipe.durationSec * machinesAt100
    : 0;

  return (
    <div className="flex items-center gap-2 rounded border border-border bg-panel-hi px-3 py-1.5">
      <IconOrLabel iconBasename={machine?.icon} name={machine?.name ?? '?'} className="h-5 w-5 rounded" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{recipe.name}</span>
          {recipe.alternate && (
            <span className="shrink-0 rounded border border-accent/40 px-1 text-[9px] uppercase tracking-wider text-accent">
              Alt
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#6b7388]">
          {split.count} × {formatNumber(split.clockSpeed * 100, 1)}% clock · {formatNumber(recipe.powerMW * machinesAt100, 1)} MW
        </div>
      </div>
      {primary && (
        <div className="text-right text-[10px] text-[#9aa2b8]">
          → {gameData.items[primary.itemId]?.name ?? primary.itemId}
          <div className="text-xs text-[#e6e8ee]">{formatRate(primaryRate)}</div>
        </div>
      )}
    </div>
  );
}
