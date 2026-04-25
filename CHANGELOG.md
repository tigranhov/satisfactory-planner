# Changelog

All notable user-facing changes to Satisfactory Planner are documented here. The
format loosely follows [Keep a Changelog](https://keepachangelog.com/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-04-25

### Added
- **Factory Info panel.** New right-side sidebar with two scope modes:
  inside a factory it rolls up power, machines, somersloops, and issues;
  at the project root it stays trimmed to overall power and material
  flow. Toggle from a new Info button in the top bar; section
  open/closed state persists across sessions.
- **Three-way material flow.** Items are split into Final outputs
  (produced, never consumed), Inputs needed (pure inputs plus
  intermediate deficits), and Internal surplus (intermediates with extra
  production). Tolerance absorbs floating-point noise so balanced
  intermediates don't flicker into surplus.
- **Hierarchical project roll-up.** Each factory and blueprint instance
  contributes only what crosses its boundary — declared via
  Input/Output ports, or net flow when no ports exist. A closed-loop
  blueprint whose byproducts never reach a port stops leaking those
  items into the project view.
- **Build cost in Tasks.** Top-of-panel collapsible summary of total
  resources for every node tagged Planned, plus a compact per-task cost
  preview under each task name.
- **Issues section** with click-to-jump: unsatisfied demand,
  disconnected Input/Output ports, and orphan nodes link straight to the
  offending node on the canvas. Over- and underclocked recipes surface
  as colored % badges on Machines rows rather than as issues.
- **Somersloop usage section.** Lists every node with somersloops
  installed and its boost percentage; click to jump.

## [0.7.0] - 2026-04-25

### Added
- **Auto-fill inputs.** Right-click a recipe node with disconnected
  ingredients to open a picker — choose a producing recipe per missing
  input and the upstream machines are placed and wired automatically. Two
  settings shape the layout: clock strategy (N−1 at 100% + 1 partial vs.
  all uniform) and node grouping (combine same-clock machines into one
  count-based node vs. one node per machine).
- New Settings modal opened from a gear icon in the top bar.
- Drag-from-handle picker now starts with item selection when the source
  has no committed item, mirroring the right-click canvas menu. Drags
  from a committed item still jump straight to the recipe list.
- Right-click on a blueprint tile in the library opens the same actions
  menu as the three-dot button.

### Changed
- Recipe selectors order standard recipes ahead of alternates, with a
  small orange "Alt" badge replacing the "Alternate:" name prefix.
- Clock speeds accept fractional percentages — dial in the exact setting
  for 10 iron rods/min instead of snapping to the nearest integer percent.

### Fixed
- Demand distribution across parallel feeder edges now water-fills, so a
  target fed by 15 + 15 + 10 producers receives the full 40/min instead
  of being clipped to 36.67.
- Dragging a multi-node selection now persists every moved node — groups
  stay together instead of spreading apart on each release.
- Picking a blueprint from the drag-from-handle picker now wires its
  matching outer handle to the source.

## [0.6.0] - 2026-04-24

### Added
- Per-node task tracking. Right-click a node to tag it Planned (dashed amber
  border) or Built (solid emerald border + check icon). Untagged nodes render
  unchanged, so projects that don't engage with the feature see no visual
  change.
- Per-task notes. When a node is tagged, the context menu shows a small
  textarea for a free-form description that surfaces as the task's subtitle
  in the Tasks panel.
- Collapsible Tasks panel, toggled from a new Tasks button in the top bar.
  Lists every planned node across all graphs in the project grouped by graph
  name. Each row click jumps to the graph and centers the canvas on the node;
  a hover-revealed check button marks the task built in one click.
- Progress readout in the Tasks panel header shows `Built: X / N tagged`
  rolled up across the whole project.

## [0.5.0] - 2026-04-24

### Added
- Factory nodes can be renamed from the right-click context menu; the rename
  cascades to the underlying subgraph so the project switcher stays in sync.
- Blueprint description shows as a footer in the blueprint node's context menu.
- Right-clicking a shift-drag box selection now opens the node context menu.

### Changed
- Removed the right-side inspector panel. Its controls (factory rename,
  blueprint description) moved into the node context menu and the canvas fills
  the full window width.

### Fixed
- Right-clicks on shift-drag selections were previously swallowed by React
  Flow's selection overlay; the context menu now opens in that case too.

## [0.4.0] - 2026-04-24

### Added
- Drag a node handle onto empty canvas to open a placement menu pre-filtered to
  recipes and blueprints that match the handle's item type.
- Inline item icons render alongside item names throughout the UI.
- Hub-like nodes (hub, splitter, merger) surface dedicated input/output ports
  that can be addressed individually.

## [0.3.0] - 2026-04-23

### Added
- Splitter and merger passthrough nodes that mirror in-game flow behavior.
- Right-click an edge to remove it without touching the endpoint nodes.

## [0.2.0] - 2026-04-23

### Added
- Recipe nodes display their machine count, editable from the context menu.
- Hub pass-through node for routing items with conservation-aware flow.

### Changed
- README rewritten as end-user documentation.

## [0.1.1] - 2026-04-23

### Changed
- Stripped the default Electron application menu — the app is keyboard-driven
  and didn't need the File/Edit/View/… menu bar.

## [0.1.0] - 2026-04-23

Initial release.

### Added
- Electron + React + React Flow factory planning app scaffold.
- Satisfactory 1.0 recipe, item, and building data imported from
  SatisfactoryTools.
- Interactive recipe nodes with demand-driven edge flow computation.
- Edge flow classification: surplus, exact, shortage.
- Canvas context menus and clipboard shortcuts (Ctrl+C / Ctrl+V / Ctrl+D,
  Delete, Backspace).
- Overclock and somersloop editing on recipe nodes.
- Blueprint library: create, rename, duplicate, delete, extract canvas
  selection to a blueprint.
- Blueprint drill-in editor with Input and Output boundary nodes.
- Blueprint canvas nodes, picker integration, and an extract action on the
  node context menu.
- Factory (formerly Composite) nested-subgraph nodes with aggregated I/O rates
  and a trimmed picker surface.
- Multi-project autosave with per-project files under `%APPDATA%\Satisfactory Planner`.
- GitHub Releases auto-update via `electron-updater`, surfacing a
  "Restart to update" chip when a new installer has been downloaded.

[Unreleased]: https://github.com/tigranhov/satisfactory-planner/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tigranhov/satisfactory-planner/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/tigranhov/satisfactory-planner/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tigranhov/satisfactory-planner/releases/tag/v0.1.0
