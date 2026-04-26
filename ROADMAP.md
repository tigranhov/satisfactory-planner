# Roadmap

Future features for Satisfactory Planner. Ordered by intended priority — items toward the top should land first. Each entry is a sketch, not a fixed scope; revisit before implementation.

## 1. Bulk edit on multi-selection

When 2+ nodes are selected on the canvas, surface a small action toolbar (or expand the right-click menu) with batch operations:
- Set clock speed for all selected recipe nodes
- Set count
- Set somersloops (only valid where target machines have slots)
- Mark all as Planned / Built / clear status
- Apply a color tag (see #7)

**Notes**
- Skip operations that don't apply to the selection — if the selection mixes recipe and hub-like nodes, hide "set clock". Show a count next to the toolbar ("Editing 8 nodes").
- React Flow already exposes selection state; subscribe to it for the toolbar visibility.
- Each bulk operation is one undo entry.

## 2. Recipe-alternate optimizer

User selects a node, opens **Optimize chain…**, picks an objective. Solver proposes recipe swaps / clock changes / node add-removes; user accepts the whole diff or accepts/rejects per-change with a re-solve in between. In-canvas overlay highlights the proposed changes so the user can see them spatially before accepting.

Objectives: raw intake, power, build cost, or a specific item.

**Notes**
- LP over recipe rates `x_r ≥ 0`. Target node's current output rate becomes the LP target. Objective = chosen scalar sum.
- **Boundary = current graph's leftmost inputs**, not raw resources. If Iron Ingot already has a supply (Input port, upstream recipe), that supply is treated as fixed — the optimizer doesn't try to re-derive iron ingots from ore. Stops the upstream walk at Input ports, sub-graph boundaries, and any node not in the selected scope.
- **Byproducts**: if a byproduct can be converted back into a chain-relevant main product (e.g. heavy-oil residue → fuel), the LP considers that conversion as a candidate recipe. If not convertible, route it through a Sink node. Fluid byproducts with no sink path get converted to a sinkable solid first (residue → petroleum coke / rubber / plastic) then sunk.
- JS solvers: `jsLPSolver` (small, in-tree-friendly) for v1; `glpk.js` (WASM) as fallback if numerics get tight.
- **Apply UX**: `Accept all` button + per-change controls (each change has Accept / Reject; rejecting one triggers a re-solve with that swap forbidden). Single undo entry per session of accepted changes.
- Diff pairing: match by `recipeId` first (kept / rate-changed), then by produced item (swap), leftovers are pure add/remove. Multi-product byproduct handling is the trickiest case to surface in the diff list.
- Reuse `computeAutoFill` placement for new nodes, anchored near their replaced counterparts so the user's layout survives.
- Needs a notion of "unlocked alternates" — a project-level setting or default to "all alts allowed."

## 3. Logistics layer — belt / pipe tier annotations

Each edge gets a required belt or pipe tier based on its rate. Annotate the edge with the minimum tier number / icon, and warn if an edge exceeds the highest tier the user has placed at the project level. Belt and pipe counts feed into the build-cost summary.

**Notes**
- Solid items: belts. Mk1=60, Mk2=120, Mk3=270, Mk4=480, Mk5=780, Mk6=1200 items/min (Update 8).
- Fluids: pipes. Mk1=300, Mk2=600 m³/min.
- Item form (solid vs fluid) already in `Item.form` (`src/data/types.ts:5`).
- Tier annotation: small badge on the edge, color-graded.
- Project-level setting: max belt tier unlocked, max pipe tier unlocked. Warn (red badge) when edge exceeds.
- Build-cost integration: add belt count to `plannedBuildCost`; needs a length estimate or just assume a constant per-edge cost for v1.

## 4. Canvas search and filter

`Ctrl+F` / `Cmd+F` opens a search bar. Fuzzy-match node labels, recipe names, factory names, and blueprint names. Result list with arrow keys; `Enter` pans/zooms to the selected node and highlights it briefly.

**Notes**
- Reuse `pendingFocusNodeId` mechanism (`src/store/uiStore.ts:97-100`) for the pan-and-zoom — same path the Tasks panel and Issues section use.
- Searching across all graphs (not just active) is more useful: results group by graph, click jumps both navigation and node.
- Light fuzzy matcher: `fuse.js` or a 50-line Levenshtein. Items / recipes are bounded so naive substring + score is fine.

## 5. Import blueprints from a Satisfactory save file

Read a `.sav`, list all in-game blueprints found, and for each one let the user designate which items act as inputs and outputs. Generate a `Blueprint` record (with the buildings as recipe nodes + the declared Input/Output ports) into `blueprintStore`.

**Notes**
- `.sav` parsing is non-trivial but solved — community parsers exist (e.g. `SatisfactorySaveEditor`, `Sav2Json`, `satisfactory-save-parser` on npm). Pick one that ships TypeScript or has stable JSON output.
- Most blueprints just contain buildings; the "interface" (what items cross the boundary) isn't stored. Hence the user-driven I/O designation step.
- UI: a modal showing detected blueprints with previews (machine list per blueprint). For each: item dropdowns to mark "this is an input" / "this is an output", with rates auto-derived from the recipes inside.
- Live in main process (Node fs access for `.sav`) → IPC channel that returns parsed blueprints. New IPC handler in `electron/main.ts`.
- Out of scope for v1: importing the full base layout (just blueprints).

## 6. Per-project notes panel

A free-form markdown pad scoped to the project — for "this project's overall plan" notes that don't belong on a specific node.

**Notes**
- Add `notes?: string` to `ProjectFileV1` (`src/models/project.ts`). Additive — old saves load with `undefined`, no schema bump needed.
- Toggle from TopBar (or stash inside the existing project switcher dropdown).
- Render markdown read-only, edit raw on click. A small markdown library (`marked` or `markdown-it`) would do; a textarea with `<pre>`-display when not editing is fine for v1.
- Persisted alongside the project, not in localStorage — so it's part of what gets shared / synced.

## 7. Color-coded factory tags

Each FactoryNode and BlueprintNode can be assigned a color from a small palette. The color tints the node's border or a header stripe in the parent graph, giving visual grouping beyond labels.

**Notes**
- Add `colorTag?: string` to `FactoryNodeData` and `BlueprintNodeData` (`src/models/graph.ts`). Use a small enum of palette names ('blue', 'green', etc.) so the renderer maps them to consistent CSS, not user-entered hex strings.
- Picker UI: in the right-click context menu, a row of colored swatches + a "clear" option.
- Optional: filter the canvas / panels by tag.
- Pairs naturally with bulk edit (#1) — apply tag to all selected.
