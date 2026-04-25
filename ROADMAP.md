# Roadmap

Future features for Satisfactory Planner. Ordered by intended priority — items toward the top should land first. Each entry is a sketch, not a fixed scope; revisit before implementation.

## 1. Mouse back/forward buttons drive navigation history

Most mice expose Back / Forward thumb buttons (the same pair browsers use). When pressed inside the app, they should walk the navigation stack: Back pops to the parent graph, Forward re-enters a graph the user just popped out of. Mirrors browser-history UX for drilling into and out of factory subgraphs.

**Notes**
- Browser exposes these as `mouseup` with `event.button === 3` (back) and `4` (forward), or via `auxclick`. Listen at `document` level, `preventDefault()` to suppress browser's own navigation.
- `navigationStore` (`src/store/navigationStore.ts`) is a pure stack today; pop discards future. Refactor to a history-with-cursor model: keep a `back` and `forward` array. `enter()` pushes to back and clears forward; `back()` moves top-of-back onto forward; `forward()` reverses. `popTo(depth)` should also clear forward.
- Disable handlers when an input/textarea has focus so the user can browse history without leaving an editor mid-edit.

## 2. Target node — time-to-reach calculator

A new node kind that takes one input and a target count (e.g. "5000 Modular Engines"). It displays the time required to reach the target given the current inflow rate (or "—" if disconnected / 0 rate). Useful for planning long-running stockpile goals.

**Notes**
- New `kind: 'target'` in `NodeData` (`src/models/graph.ts`) with `{ targetItemId?: ItemId; targetCount: number }`. itemId commits on first connection like Input/Output ports.
- One target-handle that accepts any item. Inflow rate computed by `computeFlows`; time = `targetCount / rate`. Render with friendly units (minutes, hours, days; "∞" if rate ≤ 0).
- **Lower priority in the create-node menu.** When dragging from empty space or right-clicking the canvas, this kind should appear at the *end* of the kind list, not alongside primary kinds (recipe, factory, blueprint).
- Should NOT count toward power / machines / build-cost summaries — it's an annotation, not a producing/consuming entity. Confirm `aggregate.ts` walkers skip it.

## 3. Grid-snapped node movement + center-on-cursor placement

Two related canvas-UX wins:

- **Grid snap.** When dragging nodes, snap to a fixed grid step so groups of nodes line up cleanly without manual nudging. Toggleable from Settings (some users prefer freeform). React Flow has built-in support: `snapToGrid` + `snapGrid={[step, step]}` props on `<ReactFlow>`.
- **Center-on-cursor placement.** Today, when you right-click empty canvas → Add Node, the node spawns with its *top-left corner* at the cursor. The node should instead spawn *centered* on the cursor — that's where the user's eye is. Same fix for drag-from-empty-space placements.

**Notes**
- New `uiStore` field `snapToGrid: boolean` (persisted) plus a configurable `gridSize: number` (default 16 or 20px). Settings modal gets a toggle + size selector.
- Pass `snapToGrid` and `snapGrid` into `<ReactFlow>` in `src/components/canvas/GraphCanvas.tsx` (~line 950 area). React Flow handles the snap during `onNodesChange`.
- Snap also applies when *creating* a node — round the spawn position to the nearest grid step.
- Center-on-cursor: `estimateNodeWidth` / `estimateNodeHeight` already exist (`src/components/canvas/GraphCanvas.tsx` ~line 114). Subtract `width/2` and `height/2` from the spawn flow position before calling `addNode`. Audit every site that places a new node: right-click context menu, drag-drop picker, auto-fill, blueprint placement, paste, factory creation in TopBar.
- Edge case: drag-drop placement uses `flow` from `screenToFlowPosition` of the drop point — same offset trick applies.

## 4. Edge style selection from Settings

Let the user pick the edge line style: **Bezier** (current default), **Straight**, **Step**, **Smoothstep**. Some users find bezier visually noisy; straight or step makes large factories more legible.

**Notes**
- New `uiStore` field `edgeStyle: 'bezier' | 'straight' | 'step' | 'smoothstep'` (persisted). Default `'bezier'`.
- React Flow's edge `type` controls the path. Today `RateEdge` is custom (`src/components/canvas/edges/RateEdge.tsx`) — likely renders a bezier path via `getBezierPath`. Refactor to call the appropriate path-builder from `@xyflow/react` based on the setting:
  - `getBezierPath`, `getStraightPath`, `getSmoothStepPath` (covers `step` with `borderRadius: 0`).
- Setting lives in the Settings modal alongside clock strategy + grouping strategy (`src/components/layout/SettingsModal.tsx`). Dropdown of four options with a small preview mini-edge for each.
- All existing rate / satisfaction styling stays the same — only the path geometry changes.

## 5. Sink node — absorbs items, contributes sink points to global info

A new node kind mirroring the in-game AWESOME Sink: a single input that consumes items without propagating them. Solves the closed-loop blueprint problem (rotors that never leave the factory should be "sunk" so they don't show in surplus). Adds a project-level **Sink points / min** readout in the global Info panel, computed from `Item.sinkPoints` (already present in game data, `src/data/types.ts:23`).

**Notes**
- New `kind: 'sink'` in `NodeData`. No itemId — accepts anything routed into it.
- Aggregator: items routed into a sink count as consumed at that level (so they net out and don't appear as surplus). In `effectiveBoundary` / `immediateFlow`, treat a sink edge's rate as consumption of that item.
- New aggregator `globalSinkPoints(graph, gameData, resolver)` summing `inflowRate × item.sinkPoints` across every sink node in the project. Surface in the global Info panel as a separate row alongside Power.
- Visual: distinct color/icon (in-game Sink is a teal pyramid). Accepts any-item input; renders the item flowing in via the edge label.

## 6. Undo / redo for editor actions

Standard `Ctrl+Z` / `Ctrl+Shift+Z` (also `Ctrl+Y`) for editor mutations. Distinct from feature 1 — that's navigation history; this is *editing* history.

**Notes**
- Wrap `graphStore` mutations in a history ring buffer. Each entry: a snapshot or an inverse-patch of the graph(s) that changed.
- **Coalesce continuous mutations.** A drag of N nodes generates N position updates per frame; that should collapse into ONE undo entry, not N hundred. Bucket by 250-500ms quiescence on the same actor (e.g. drag-end commits the entry).
- Bounded history (~100 entries) to cap memory.
- Cross-store atomicity: some actions touch graph + blueprint stores together (extract blueprint). Either record across stores or block during multi-store transactions.
- Don't undo navigation, panel toggles, or other UI state — only graph mutations.

## 7. Bulk edit on multi-selection

When 2+ nodes are selected on the canvas, surface a small action toolbar (or expand the right-click menu) with batch operations:
- Set clock speed for all selected recipe nodes
- Set count
- Set somersloops (only valid where target machines have slots)
- Mark all as Planned / Built / clear status
- Apply a color tag (see #13)

**Notes**
- Skip operations that don't apply to the selection — if the selection mixes recipe and hub-like nodes, hide "set clock". Show a count next to the toolbar ("Editing 8 nodes").
- React Flow already exposes selection state; subscribe to it for the toolbar visibility.
- Each bulk operation is one undo entry (per #6).

## 8. Recipe-alternate optimizer

Given a target output (e.g. "60 Modular Frames/min") and the set of alternate recipes the user has unlocked, find the recipe chain that minimizes a chosen objective:
- Raw resource intake (default)
- Power consumption
- Build cost
- A specific resource (e.g. "minimize Coal usage")

**Notes**
- Linear programming problem over the recipe graph: variables = recipe rates, constraints = target output + non-negativity, objective = chosen sum.
- JS solvers: `glpk.js` (GLPK compiled to WASM), `jsLPSolver` (smaller, simpler problems). GLPK handles the size we'd see.
- Surface as a panel: pick target item + rate + objective, see proposed chain, then "Place" to drop the machines into the canvas. Reuse the auto-fill placement code (`src/lib/autoFill.ts`).
- Needs a notion of "unlocked alternates" — a project-level setting or default to "all alts allowed."

## 9. Logistics layer — belt / pipe tier annotations

Each edge gets a required belt or pipe tier based on its rate. Annotate the edge with the minimum tier number / icon, and warn if an edge exceeds the highest tier the user has placed at the project level. Belt and pipe counts feed into the build-cost summary.

**Notes**
- Solid items: belts. Mk1=60, Mk2=120, Mk3=270, Mk4=480, Mk5=780, Mk6=1200 items/min (Update 8).
- Fluids: pipes. Mk1=300, Mk2=600 m³/min.
- Item form (solid vs fluid) already in `Item.form` (`src/data/types.ts:5`).
- Tier annotation: small badge on the edge, color-graded.
- Project-level setting: max belt tier unlocked, max pipe tier unlocked. Warn (red badge) when edge exceeds.
- Build-cost integration: add belt count to `plannedBuildCost`; needs a length estimate or just assume a constant per-edge cost for v1.

## 10. Canvas search and filter

`Ctrl+F` / `Cmd+F` opens a search bar. Fuzzy-match node labels, recipe names, factory names, and blueprint names. Result list with arrow keys; `Enter` pans/zooms to the selected node and highlights it briefly.

**Notes**
- Reuse `pendingFocusNodeId` mechanism (`src/store/uiStore.ts:97-100`) for the pan-and-zoom — same path the Tasks panel and Issues section use.
- Searching across all graphs (not just active) is more useful: results group by graph, click jumps both navigation and node.
- Light fuzzy matcher: `fuse.js` or a 50-line Levenshtein. Items / recipes are bounded so naive substring + score is fine.

## 11. Import blueprints from a Satisfactory save file

Read a `.sav`, list all in-game blueprints found, and for each one let the user designate which items act as inputs and outputs. Generate a `Blueprint` record (with the buildings as recipe nodes + the declared Input/Output ports) into `blueprintStore`.

**Notes**
- `.sav` parsing is non-trivial but solved — community parsers exist (e.g. `SatisfactorySaveEditor`, `Sav2Json`, `satisfactory-save-parser` on npm). Pick one that ships TypeScript or has stable JSON output.
- Most blueprints just contain buildings; the "interface" (what items cross the boundary) isn't stored. Hence the user-driven I/O designation step.
- UI: a modal showing detected blueprints with previews (machine list per blueprint). For each: item dropdowns to mark "this is an input" / "this is an output", with rates auto-derived from the recipes inside.
- Live in main process (Node fs access for `.sav`) → IPC channel that returns parsed blueprints. New IPC handler in `electron/main.ts`.
- Out of scope for v1: importing the full base layout (just blueprints).

## 12. Per-project notes panel

A free-form markdown pad scoped to the project — for "this project's overall plan" notes that don't belong on a specific node.

**Notes**
- Add `notes?: string` to `ProjectFileV1` (`src/models/project.ts`). Additive — old saves load with `undefined`, no schema bump needed.
- Toggle from TopBar (or stash inside the existing project switcher dropdown).
- Render markdown read-only, edit raw on click. A small markdown library (`marked` or `markdown-it`) would do; a textarea with `<pre>`-display when not editing is fine for v1.
- Persisted alongside the project, not in localStorage — so it's part of what gets shared / synced.

## 13. Color-coded factory tags

Each FactoryNode and BlueprintNode can be assigned a color from a small palette. The color tints the node's border or a header stripe in the parent graph, giving visual grouping beyond labels.

**Notes**
- Add `colorTag?: string` to `FactoryNodeData` and `BlueprintNodeData` (`src/models/graph.ts`). Use a small enum of palette names ('blue', 'green', etc.) so the renderer maps them to consistent CSS, not user-entered hex strings.
- Picker UI: in the right-click context menu, a row of colored swatches + a "clear" option.
- Optional: filter the canvas / panels by tag.
- Pairs naturally with bulk edit (#7) — apply tag to all selected.
