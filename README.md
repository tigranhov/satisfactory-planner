# Satisfactory Planner

A node-graph factory planner for [Satisfactory](https://www.satisfactorygame.com/) — build your production lines as a graph, let the tool compute item flow, and spot bottlenecks before you break ground in-game.

Ships as a Windows desktop app with auto-updates from GitHub Releases. Game data tracks Satisfactory 1.0 via [SatisfactoryTools](https://github.com/greeny/SatisfactoryTools).

## Features

- **Recipe nodes** — place any recipe; per-node clock speed, machine count, and somersloop slots. Power draw and boosted output rates are computed live.
- **Flow calculation** — demand-driven, source-capped. Edges colour-code as **green / blue / orange** for exact / surplus / shortage, so mismatches are obvious at a glance.
- **Factory nodes (nested subgraphs)** — collapse a whole sub-chain into a single node with input/output ports; double-click to drill in, breadcrumb back out. Arbitrary depth.
- **Blueprint library** — reusable parameterised sub-assemblies with a count multiplier, persisted across projects. Extract any canvas selection into a blueprint; drop blueprints into other graphs from the picker.
- **Hub node** — a pass-through junction with one "fat" input + one "fat" output handle, each accepting many connections. Item type is inferred from the first connected edge (no upfront item pick). Declutters one-source-to-many (or many-to-one) factory layouts without drawing N×M edges.
- **Multi-project** — each project autosaves to its own file under `%APPDATA%\Satisfactory Planner`. Project switcher in the top bar; rename / create / delete inline.
- **Right-click everywhere** — canvas right-click opens a recipe / blueprint / input / output picker with a utility sidebar for hub and future splitter/merger. Node right-click opens count / overclock / somersloop controls.
- **Clipboard** — `Ctrl+C`, `Ctrl+V`, `Ctrl+D`, `Delete`, `Backspace` all work across nodes and selections.
- **Auto-update** — installed copies check GitHub Releases on launch and surface a "Restart to update" chip when a newer version is downloaded.

## Install

Head to [Releases](https://github.com/tigranhov/satisfactory-planner/releases) and grab the latest `Satisfactory Planner Setup <version>.exe`. Double-click to install; Windows SmartScreen will warn on first launch (the app isn't code-signed yet) — click **More info → Run anyway**.

The installer is per-user (no admin prompt), installs to `%LOCALAPPDATA%\Programs\Satisfactory Planner`, and adds a desktop + Start Menu shortcut. Uninstall via Settings → Apps.

Once installed, the app self-updates: each launch queries GitHub for a newer release, downloads it in the background, and prompts you to restart via a top-bar chip.

## Usage

**First launch** creates a project called "Untitled" and drops you on an empty canvas. Everything is saved automatically as you work.

### Basics

- **Right-click the canvas** → pick **Recipe** (type an item name, then pick a recipe or blueprint producing it), **Blueprint**, **Input / Output** (only inside subgraphs), or use the **right-side utility strip** to drop a Hub.
- **Drag from a handle** on one node to a handle on another to create an edge. The tool validates item-match and rejects mismatches.
- **Right-click a node** → delete, duplicate, extract selection to blueprint, edit overclock / somersloop / machine count.
- **Double-click a factory or blueprint node** → drill into its subgraph. Use the breadcrumb to pop back out.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Del` / `Backspace` | Delete selected nodes / edges |
| `Ctrl+C` | Copy selection |
| `Ctrl+V` | Paste at cursor |
| `Ctrl+D` | Duplicate selection |
| `Escape` | Close any open picker / context menu |
| Double-click | Enter a factory or blueprint subgraph |

### Hub tips

Hubs default to `?` (unset). They adopt the first connected edge's item and stick. Disconnect all edges and the hub resets to `?`. Under shortage, outgoing flow is distributed proportionally to each consumer's demand — useful when one smelter feeds several assemblers and you want to see exactly which one gets starved.

## Acknowledgements

- Game data from [SatisfactoryTools](https://github.com/greeny/SatisfactoryTools) — the canonical community dataset.
- [Coffee Stain Studios](https://www.coffeestainstudios.com/) for making Satisfactory.

Not affiliated with Coffee Stain Studios. Satisfactory is a trademark of Coffee Stain Publishing AB.
