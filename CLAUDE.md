# Claude working notes

## Keep the dev server running

At the first code edit in a session, start `bun run dev` in the background and leave it running. `electron-vite dev` has HMR — the Electron window auto-reloads on every file change, so you do **not** need to restart or re-run it after edits. Only start it once per session; if it's already running, leave it alone.

If a change requires a full restart (main-process code, preload, native deps, config like `vite.config.ts` / `electron.vite.config.ts`), say so explicitly and ask before killing the process.

## Cutting a release

Follow this exact sequence when the user asks to ship a new version. Full rationale lives in `RELEASES.md`; this is the operational cheat sheet.

### Versioning

- **Tags are `v<semver>` and must match `package.json` `version`.** The GitHub Actions workflow (`.github/workflows/release.yml`) triggers on `v*` tag push and builds the Windows installer via `electron-builder --publish always`.
- **Before tagging**, `main` must be clean (`git status` clean, `bun run typecheck`, `bun run lint`) and pushed to `origin/main`. The workflow runs against the tagged commit — untyped or lint-failing code breaks the release.
- **Bumping via `npm version <patch|minor|major>`** is the preferred flow after the first release — it edits `package.json`, commits, and creates the matching annotated tag in one step:
  ```sh
  npm version patch            # 0.1.0 → 0.1.1
  git push --follow-tags       # pushes the commit AND the tag
  ```
- **First release of a given `package.json` version** (e.g. `0.1.0` fresh from scaffolding) is tagged directly without bumping:
  ```sh
  git tag -a v0.1.0 -m "v0.1.0 — <short summary>"
  git push origin v0.1.0
  ```
  Only use this shape when `package.json` already matches — never hand-roll a tag that disagrees with `package.json`.

### Which bump

- **patch (`0.1.0 → 0.1.1`)**: bug fixes, polish, simplify passes, internal refactors with no behavior change.
- **minor (`0.1.0 → 0.2.0`)**: new features, new UI surfaces, new models or stores, new persistence formats that are backward-compatible.
- **major (`0.1.0 → 1.0.0`)**: breaking data-format changes (old project/blueprint JSONs can't round-trip), or a deliberate stability milestone. Don't jump to 1.0.0 without the user explicitly asking.

### After the tag is pushed

1. The `Release` workflow at `.github/workflows/release.yml` runs on `windows-latest`. Expect ~3–6 minutes.
2. It creates a **draft** GitHub Release with `Satisfactory Planner Setup <version>.exe` and `latest.yml` attached.
3. **Tell the user to publish the draft.** Drafts are invisible to `electron-updater`: installed clients only see published releases via `/releases/latest`. Neither the initial download nor the update chain works until Publish is clicked.
4. If Actions fails with a 403 on upload, it's the repo's "Workflow permissions" set to read-only — the user needs to flip to "Read and write permissions" in Settings → Actions → General, then re-run the workflow.

### What you (Claude) should and should NOT do

- You may bump the version (`npm version patch`) and create+push tags when the user explicitly asks to cut a release.
- You may run `git push` and `git push origin <tag>`. These are externally visible but authorized by the release request.
- You must NOT click "Publish release" on the draft — that's a GitHub UI action the user does, and the permission context is different. Always remind the user to publish the draft.
- You must NOT modify published releases, force-push tags (`git push -f <tag>`), or delete tags. If a release is botched, cut a new patch version rather than rewriting history.
- Do NOT skip the typecheck / lint step before tagging; a failed CI build wastes a version number and leaves a broken draft that the user has to clean up.

### Smoke-test locally before tagging if the release changes distribution

For changes that touch `electron/main.ts`, `electron/preload.ts`, `electron-builder` config in `package.json`, or the `Release` workflow itself, run `bun run dist` locally first and hand-test the installer in `release/` before tagging. Those paths aren't exercised by `bun run dev`, so a broken installer is the first thing users would see on update.
