# satisfactory-planner

Node-graph factory planner for Satisfactory, with nested canvases (Unreal-Blueprint style).

## Stack

- Electron + React 18 + TypeScript
- [@xyflow/react](https://reactflow.dev) for the node graph
- Zustand for state, Tailwind for styling
- Vite (via `electron-vite`) for dev tooling, `electron-builder` for Windows installers

## Scripts

```bash
npm install            # install deps
npm run dev            # start Electron + Vite dev server
npm run typecheck      # tsc --noEmit
npm run build          # build renderer + electron bundles
npm run build:web      # build static web bundle (dist-web/) for GitHub Pages
npm run dist           # build + package Windows installer (release/)
```

## Layout

```
electron/        Electron main + preload (IPC stubs for save/load)
src/
  components/
    layout/      AppShell, TopBar, Sidebar, Inspector
    canvas/      GraphCanvas, RecipeNode, CompositeNode, RateEdge, ItemHandle
  data/          Game data types, sample.json, loader, Docs.json normalize stub
  models/        Graph/Edge/Node models, recipe rate math, calc stubs
  store/         Zustand stores (graphs + nested-canvas navigation)
  hooks/         useActiveGraph
  lib/           id generators
  styles/        globals.css (Tailwind + React Flow theme)
```

## Scaffold scope

What works:

- Three-pane layout with breadcrumb navigation
- Searchable recipe palette (drag onto canvas to place a node)
- RecipeNode renders ingredient handles on the left, product handles on the right,
  drag-to-connect between handles creates an edge with a live rate label
- Inspector edits clock speed and building count with power rollup
- CompositeNode: add via TopBar button, double-click to enter a nested canvas,
  click breadcrumb to pop back out

Deferred (clear extension points in the code):

- Real Docs.json import — `src/data/normalize.ts` documents the mapping
- Persistence — IPC stubs in `electron/main.ts` return "not implemented"
- Steam Cloud / greenworks — preload API is ready to extend
- Rate propagation math — `src/models/calc.ts#propagateRates`
- Subgraph I/O aggregation — `src/models/calc.ts#aggregateSubgraph`
- Undo/redo, real item icons, tests

## Deploy web build to GitHub Pages

```bash
npm run build:web
# Publish dist-web/ via your preferred action, e.g. peaceiris/actions-gh-pages
```
