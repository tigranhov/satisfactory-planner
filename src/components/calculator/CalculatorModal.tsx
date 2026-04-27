import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Calculator as CalculatorIcon,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { getAllItemsSorted, loadGameData } from '@/data/loader';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { useCalculatorStore } from '@/store/calculatorStore';
import {
  aggregateTrees,
  buildCalcTree,
  walkCalcTree,
  type CalcTreeNode,
  type RecipeChoice,
} from '@/lib/calculator';
import { formatNumber } from '@/lib/format';
import type { Item, Recipe } from '@/data/types';
import { PickerRow, RecipeRowContent } from '@/components/canvas/CanvasContextMenu';

const gameData = loadGameData();
const ALL_ITEMS: Item[] = getAllItemsSorted(gameData);

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CalculatorModal({ open, onClose }: Props) {
  const targets = useCalculatorStore((s) => s.targets);
  const recipeByItem = useCalculatorStore((s) => s.recipeByItem);
  const expanded = useCalculatorStore((s) => s.expanded);
  const addTarget = useCalculatorStore((s) => s.addTarget);
  const setTargetItem = useCalculatorStore((s) => s.setTargetItem);
  const setTargetQuantity = useCalculatorStore((s) => s.setTargetQuantity);
  const removeTarget = useCalculatorStore((s) => s.removeTarget);
  const setRecipeChoice = useCalculatorStore((s) => s.setRecipeChoice);
  const resetRecipeChoice = useCalculatorStore((s) => s.resetRecipeChoice);
  const setExpanded = useCalculatorStore((s) => s.setExpanded);
  const expandAll = useCalculatorStore((s) => s.expandAll);
  const collapseAll = useCalculatorStore((s) => s.collapseAll);
  const reset = useCalculatorStore((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Recompute the trees whenever inputs change. Cheap relative to render.
  const trees = useMemo<CalcTreeNode[]>(() => {
    return targets.map((t) =>
      buildCalcTree(t.itemId, t.quantity, { byItem: recipeByItem }, gameData),
    );
  }, [targets, recipeByItem]);

  const aggregate = useMemo(() => aggregateTrees(trees, gameData), [trees]);

  const allPaths = useMemo(() => {
    const paths: string[] = [];
    for (const t of trees) walkCalcTree(t, (n) => paths.push(n.path));
    return paths;
  }, [trees]);

  const sortedRaw = useMemo(
    () =>
      Array.from(aggregate.rawTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([itemId, qty]) => ({ itemId, qty, item: gameData.items[itemId] })),
    [aggregate.rawTotals],
  );

  const sortedByproducts = useMemo(
    () =>
      Array.from(aggregate.byproductTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([itemId, qty]) => ({ itemId, qty, item: gameData.items[itemId] })),
    [aggregate.byproductTotals],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[720px] w-[1040px] max-w-[95vw] max-h-[92vh] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border bg-panel-hi px-4 py-2.5">
          <CalculatorIcon className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Calculator</span>
          <span className="ml-2 text-[11px] text-[#6b7388]">
            Compute total raw inputs needed to produce a target quantity
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => expandAll(allPaths)}
              disabled={trees.length === 0}
              className="rounded bg-panel px-2 py-1 text-[11px] text-[#9aa2b8] hover:text-[#e6e8ee] disabled:opacity-40"
              title="Expand every node"
            >
              Expand all
            </button>
            <button
              onClick={() => collapseAll()}
              disabled={trees.length === 0}
              className="rounded bg-panel px-2 py-1 text-[11px] text-[#9aa2b8] hover:text-[#e6e8ee] disabled:opacity-40"
              title="Collapse every node"
            >
              Collapse all
            </button>
            <button
              onClick={reset}
              disabled={targets.length === 0}
              className="flex items-center gap-1 rounded bg-panel px-2 py-1 text-[11px] text-[#9aa2b8] hover:text-[#e6e8ee] disabled:opacity-40"
              title="Clear targets and recipe overrides"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_300px] overflow-hidden">
          <div className="flex flex-col overflow-hidden">
            <TargetsSection
              onAdd={(itemId) => addTarget(itemId, 100)}
              targets={targets.map((t) => ({
                ...t,
                item: gameData.items[t.itemId],
              }))}
              onItemChange={setTargetItem}
              onQuantityChange={setTargetQuantity}
              onRemove={removeTarget}
            />

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {targets.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-[#6b7388]">
                  <CalculatorIcon className="h-10 w-10 opacity-40" />
                  <div>Add a target above to see the breakdown.</div>
                </div>
              ) : (
                trees.map((tree) => (
                  <TreeBlock
                    key={tree.path}
                    node={tree}
                    expanded={expanded}
                    onToggle={(path, open) => setExpanded(path, open)}
                    onRecipeChange={setRecipeChoice}
                    onResetChoice={resetRecipeChoice}
                    isRoot
                  />
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 overflow-y-auto border-l border-border bg-panel-hi/40 px-3 py-3">
            <SummarySection title="Raw materials" emptyText="No raw inputs yet — add a target.">
              {sortedRaw.length === 0
                ? null
                : sortedRaw.map(({ itemId, qty, item }) => (
                    <QtyPill
                      key={itemId}
                      icon={item?.icon}
                      name={item?.name ?? itemId}
                      qty={qty}
                    />
                  ))}
            </SummarySection>

            {sortedByproducts.length > 0 && (
              <SummarySection title="Byproducts" emptyText="">
                {sortedByproducts.map(({ itemId, qty, item }) => (
                  <QtyPill
                    key={itemId}
                    icon={item?.icon}
                    name={item?.name ?? itemId}
                    qty={qty}
                    muted
                  />
                ))}
              </SummarySection>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TargetRow {
  id: string;
  itemId: string;
  quantity: number;
  item: Item | undefined;
}

interface TargetsSectionProps {
  targets: TargetRow[];
  onAdd: (itemId: string) => void;
  onItemChange: (id: string, itemId: string) => void;
  onQuantityChange: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
}

function TargetsSection({
  targets,
  onAdd,
  onItemChange,
  onQuantityChange,
  onRemove,
}: TargetsSectionProps) {
  return (
    <div className="border-b border-border bg-panel-hi/30 px-4 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-[#6b7388]">
        Targets
      </div>
      <div className="flex flex-col gap-1.5">
        {targets.map((t) => (
          <TargetRowView
            key={t.id}
            target={t}
            onItemChange={(itemId) => onItemChange(t.id, itemId)}
            onQuantityChange={(qty) => onQuantityChange(t.id, qty)}
            onRemove={() => onRemove(t.id)}
          />
        ))}
        <ItemPickerButton
          buttonLabel={
            <span className="flex items-center gap-1.5 text-[11px] text-[#9aa2b8]">
              <Plus className="h-3.5 w-3.5" />
              Add target
            </span>
          }
          onPick={(item) => onAdd(item.id)}
          buttonClass="self-start rounded border border-dashed border-border px-3 py-1 hover:border-accent/50 hover:bg-panel-hi"
          items={ALL_ITEMS}
        />
      </div>
    </div>
  );
}

interface TargetRowViewProps {
  target: TargetRow;
  onItemChange: (itemId: string) => void;
  onQuantityChange: (qty: number) => void;
  onRemove: () => void;
}

function TargetRowView({
  target,
  onItemChange,
  onQuantityChange,
  onRemove,
}: TargetRowViewProps) {
  const [draft, setDraft] = useState(formatNumber(target.quantity, 4));
  useEffect(() => {
    setDraft(formatNumber(target.quantity, 4));
  }, [target.quantity]);

  const commit = () => {
    const parsed = parseFloat(draft);
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    onQuantityChange(next);
    setDraft(formatNumber(next, 4));
  };

  return (
    <div className="flex items-center gap-2 rounded border border-border bg-panel-hi/60 px-2 py-1.5">
      <ItemPickerButton
        buttonClass="flex items-center gap-2 rounded bg-panel px-2 py-1 text-xs text-[#e6e8ee] hover:bg-panel-hi"
        buttonLabel={
          <>
            <IconOrLabel
              iconBasename={target.item?.icon}
              name={target.item?.name ?? target.itemId}
              className="h-5 w-5 rounded"
            />
            <span className="max-w-[180px] truncate">
              {target.item?.name ?? target.itemId}
            </span>
            <ChevronDown className="h-3 w-3 text-[#6b7388]" />
          </>
        }
        onPick={(item) => onItemChange(item.id)}
        items={ALL_ITEMS}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-24 rounded border border-border bg-panel px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-accent"
        />
        <span className="text-[10px] text-[#6b7388]">items</span>
        <button
          onClick={onRemove}
          className="ml-1 rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-red-400"
          title="Remove target"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface TreeBlockProps {
  node: CalcTreeNode;
  expanded: Record<string, boolean>;
  isRoot?: boolean;
  onToggle: (path: string, open: boolean) => void;
  onRecipeChange: (itemId: string, choice: RecipeChoice) => void;
  onResetChoice: (itemId: string) => void;
}

function TreeBlock({
  node,
  expanded,
  isRoot,
  onToggle,
  onRecipeChange,
  onResetChoice,
}: TreeBlockProps) {
  const item = gameData.items[node.itemId];
  // Roots default to expanded so a freshly added target shows its first level
  // immediately; descendants default to collapsed to keep the tree readable.
  const isOpen = expanded[node.path] ?? !!isRoot;
  const hasChildren = node.children.length > 0;

  return (
    <div
      className={
        isRoot
          ? 'mb-3 overflow-hidden rounded-md border border-border bg-panel-hi/30'
          : ''
      }
    >
      <div
        className={
          isRoot
            ? 'flex flex-col gap-1.5 border-b border-border bg-panel-hi/60 px-3 py-2'
            : 'flex flex-col gap-1.5 px-2 py-1.5 hover:bg-panel-hi/30'
        }
      >
        <div className="flex items-center gap-2">
          {hasChildren ? (
            <button
              onClick={() => onToggle(node.path, !isOpen)}
              className="rounded p-0.5 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
              title={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="inline-block h-3.5 w-3.5 shrink-0" />
          )}
          <IconOrLabel
            iconBasename={item?.icon}
            name={item?.name ?? node.itemId}
            className="h-6 w-6 shrink-0 rounded"
          />
          <span className="truncate text-xs font-medium">
            {item?.name ?? node.itemId}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-[#9aa2b8]">
            {formatNumber(node.quantity, 3)}
          </span>
          {node.cyclic && (
            <span
              className="shrink-0 rounded border border-amber-400/40 px-1 text-[9px] uppercase tracking-wider text-amber-300"
              title="This item appears in its own dependency chain — recursion stopped."
            >
              cyclic
            </span>
          )}
          {node.recipeId === 'raw' && !node.cyclic && (
            <span className="shrink-0 rounded border border-border bg-panel/60 px-1 text-[9px] uppercase tracking-wider text-[#6b7388]">
              raw
            </span>
          )}
        </div>

        {node.availableRecipes.length > 0 && !node.cyclic && (
          <div className="flex items-center gap-2 pl-6">
            <span className="text-[10px] uppercase tracking-wider text-[#6b7388]">
              Recipe
            </span>
            <RecipeChoicePicker
              itemId={node.itemId}
              currentChoice={node.recipeId}
              recipes={node.availableRecipes}
              onChange={(choice) => onRecipeChange(node.itemId, choice)}
              onReset={() => onResetChoice(node.itemId)}
            />
          </div>
        )}
      </div>

      {isOpen && hasChildren && (
        <div className={isRoot ? 'pl-3 pr-1 py-1' : 'pl-3'}>
          {node.children.map((c) => (
            <TreeBlock
              key={c.node.path}
              node={c.node}
              expanded={expanded}
              onToggle={onToggle}
              onRecipeChange={onRecipeChange}
              onResetChoice={onResetChoice}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RecipeChoicePickerProps {
  itemId: string;
  currentChoice: RecipeChoice;
  recipes: Recipe[];
  onChange: (choice: RecipeChoice) => void;
  onReset: () => void;
}

// Item-keyed recipe override. Same dropdown pattern as AutoFillModal — render
// via portal so the popover floats over the modal scroll region. Adds a
// "Treat as raw" option, since the calculator lets users prune any branch.
function RecipeChoicePicker({
  currentChoice,
  recipes,
  onChange,
  onReset,
}: RecipeChoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss([buttonRef, popoverRef], () => setOpen(false), {
    escape: true,
  });

  useLayoutEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  const selected =
    currentChoice !== 'raw' ? recipes.find((r) => r.id === currentChoice) : undefined;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="flex flex-1 items-center gap-2 rounded border border-border bg-panel px-2 py-1 text-[11px] hover:border-accent/50"
      >
        {selected ? (
          <RecipeRowContent recipe={selected} />
        ) : (
          <span className="truncate text-[#9aa2b8]">Treat as raw</span>
        )}
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-[#6b7388]" />
      </button>
      {open && rect &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              maxHeight: 'min(60vh, 480px)',
            }}
            className="z-[60] overflow-y-auto rounded-md border border-border bg-panel p-1 shadow-xl"
          >
            {recipes.map((r, i) => (
              <PickerRow
                key={r.id}
                index={i}
                active={r.id === currentChoice}
                onHover={() => {}}
                onPick={() => {
                  onChange(r.id);
                  setOpen(false);
                }}
              >
                <RecipeRowContent recipe={r} />
              </PickerRow>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              onClick={() => {
                onChange('raw');
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                currentChoice === 'raw' ? 'bg-panel-hi text-accent' : 'text-[#9aa2b8]'
              } hover:bg-panel-hi`}
            >
              Treat as raw
              <span className="ml-auto text-[10px] text-[#6b7388]">
                Stop breakdown — count this item in raw demand
              </span>
            </button>
            <button
              onClick={() => {
                onReset();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-[#9aa2b8] hover:bg-panel-hi"
            >
              Reset to default
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

interface ItemPickerButtonProps {
  buttonLabel: React.ReactNode;
  buttonClass?: string;
  onPick: (item: Item) => void;
  items: Item[];
}

// Compact item picker — button + searchable popover — used for both adding new
// targets and changing an existing target's item. Lists every item (not just
// producible) so users can also model raw mining demand directly.
function ItemPickerButton({
  buttonLabel,
  buttonClass,
  onPick,
  items,
}: ItemPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss([buttonRef, popoverRef], () => setOpen(false), {
    escape: true,
  });

  useLayoutEffect(() => {
    if (!open) return;
    const updateRect = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    };
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Microtask ensures focus survives the layout pass.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (item: Item) => {
    onPick(item);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[activeIndex];
      if (it) commit(it);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
      >
        {buttonLabel}
      </button>
      {open && rect &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              maxHeight: 'min(60vh, 420px)',
            }}
            className="z-[60] flex flex-col overflow-hidden rounded-md border border-border bg-panel shadow-xl"
          >
            <div className="relative border-b border-border p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6b7388]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search items..."
                className="w-full rounded border border-border bg-panel-hi py-1 pl-7 pr-2 text-xs outline-none focus:border-accent"
              />
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <div className="p-3 text-center text-xs text-[#6b7388]">No items match</div>
              ) : (
                filtered.map((it, i) => (
                  <button
                    key={it.id}
                    data-index={i}
                    onClick={() => commit(it)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                      i === activeIndex ? 'bg-panel-hi' : ''
                    }`}
                  >
                    <IconOrLabel iconBasename={it.icon} name={it.name} />
                    <span className="truncate">{it.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

interface SummarySectionProps {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}

function SummarySection({ title, emptyText, children }: SummarySectionProps) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#6b7388]">
        {title}
      </div>
      {children ?? (
        <div className="text-[11px] italic text-[#6b7388]">{emptyText}</div>
      )}
    </div>
  );
}

interface QtyPillProps {
  icon: string | undefined;
  name: string;
  qty: number;
  muted?: boolean;
}

function QtyPill({ icon, name, qty, muted }: QtyPillProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-panel ${
        muted ? 'text-[#9aa2b8]' : 'text-[#e6e8ee]'
      }`}
    >
      <IconOrLabel iconBasename={icon} name={name} className="h-5 w-5 shrink-0 rounded" />
      <span className="truncate">{name}</span>
      <span className="ml-auto shrink-0 tabular-nums">{formatNumber(qty, 3)}</span>
    </div>
  );
}
