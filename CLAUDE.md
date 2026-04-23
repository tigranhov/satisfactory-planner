# Claude working notes

## Keep the dev server running

At the first code edit in a session, start `bun run dev` in the background and leave it running. `electron-vite dev` has HMR — the Electron window auto-reloads on every file change, so you do **not** need to restart or re-run it after edits. Only start it once per session; if it's already running, leave it alone.

If a change requires a full restart (main-process code, preload, native deps, config like `vite.config.ts` / `electron.vite.config.ts`), say so explicitly and ask before killing the process.
