---
name: release
description: Analyze commits since the last release tag, suggest a semver bump, execute the tag-and-publish flow, and remind the user to publish the draft GitHub Release.
---

# Release

Invoke when the user asks to cut a release ("ship a release", "release it", "cut v0.2", "tag new version", etc.). The skill proposes a version bump based on commits since the last release, confirms with the user, then drives the full publish flow.

Full human-facing reference: `RELEASES.md`.

## Step 1: Gather state

Run in parallel:

- `git status` — must be clean before tagging.
- `git describe --tags --abbrev=0 --match 'v*'` — last release tag. If this errors with "No names found", treat the current version as the first release and skip the bump (use the existing `package.json` version).
- `jq -r .version package.json` — current declared version.
- `git log <lasttag>..HEAD --oneline` — commits under consideration.
- `git diff <lasttag>..HEAD --stat` — files changed, for bump-scoring.
- `git log origin/main..HEAD --oneline` — confirm local commits are pushed; if not, push before tagging.

If `git status` shows a dirty tree: stop and tell the user to commit or stash. Never cut a release from a dirty tree.

## Step 2: Score the bump

Walk the commit subjects from Step 1 and the file list, apply the rules below, and land on the highest applicable bump (major > minor > patch).

### Major (`X+1.0.0`) — breaking change

Trigger on **any** of:

- Commit subject contains `BREAKING CHANGE`, `breaking:`, `major:`, or a `!:` marker (conventional-commits style).
- Data-format changes that would invalidate existing on-disk state: alterations to `src/models/project.ts`, `src/models/blueprint.ts`, `src/models/graph.ts` that rename/remove fields, change their types, or rename the discriminator on a union (e.g. `kind` values).
- Changes to `ProjectFileV1` / `ProjectIndexV1` / `BlueprintFileV1` `version` literal — that's an explicit schema bump.
- Changes to IPC handler names in `electron/main.ts` that aren't additive (renaming or removing channels), since shipped clients would break.
- Deleting an exported function/hook other apps (including the app's own persisted state loader) depend on.

Do **not** auto-suggest major on structural rename commits unless the user confirms — ask first.

### Minor (`X.Y+1.0`) — new feature

Trigger on **any** of:

- New user-facing capability: a new UI surface, a new node kind, a new store, a new persistence feature, a new window or modal.
- New top-level exports from models/stores.
- New Electron IPC channels (additive).
- New workflow or CI job.
- A subject that starts with `Add ` for something the user directly interacts with.

### Patch (`X.Y.Z+1`) — everything else

Default. Fixes, simplify passes, internal refactors, dependency bumps, renames that don't cross serialized boundaries, comment cleanup, CLAUDE.md / RELEASES.md edits.

### Commit-subject heuristics (tie-breakers)

- `Add X …` → minor if X is user-facing, patch if X is internal.
- `Rename A → B` → patch unless the rename crosses a persisted-format boundary (then major, with user confirmation).
- `Fix …` / `Simplify` / `Trim` / `Drop` / `Document` / `Ignore` → patch.
- `Remove the X` → patch if X is dead code, minor if X was a user-facing feature, major if X was a persisted field.

## Step 3: Present the suggestion

Show the user:

- The commit list since the last tag (shortlog with subjects).
- The proposed bump and the specific commits / rules that pushed it there (e.g. "minor because commit `4f4770c Add blueprint library` introduced a new user-facing surface").
- The resulting version (`current` → `proposed`).

Ask for confirmation — accept a redirect to a different bump (the user may know context you don't, like "this minor actually needs to be major because we changed the project JSON layout").

If this is the first release (no prior tag), skip bump selection and confirm the current `package.json` version will be tagged as-is.

## Step 4: Pre-flight checks

Before tagging:

1. `bun run typecheck` — blocker on failure.
2. `bun run lint` — blocker on failure.
3. If `git log origin/main..HEAD` shows unpushed commits, `git push origin main` first. The workflow runs against the pushed tagged commit — a tag without its parent commit pushed will fail to resolve.
4. If the diff since last tag touches `electron/main.ts`, `electron/preload.ts`, `electron/updater.ts`, the `build` block in `package.json`, or `.github/workflows/release.yml`, warn the user and ask whether to smoke-test via `bun run dist` before tagging. Those paths aren't covered by `bun run dev`, and a broken installer blocks the update chain for every existing client. Do not run `bun run dist` automatically — it's heavy and produces large output; just offer.

## Step 5: Execute

Two shapes, depending on whether `package.json` already matches the target version.

### Standard bump (existing version ≠ target)

```sh
npm version <patch|minor|major>   # edits package.json, commits, creates v<X.Y.Z> tag
git push --follow-tags            # pushes the bump commit AND the tag
```

### First release (existing version already matches target, no prior tag)

```sh
git tag -a v<X.Y.Z> -m "v<X.Y.Z> — <short summary>"
git push origin v<X.Y.Z>
```

Use the second shape only when `package.json` already declares the target version AND no prior `v*` tag exists. Never hand-roll a tag that disagrees with `package.json`.

## Step 6: Watch + post-release reminders

Right after pushing the tag:

1. Run `gh run list --workflow=release.yml --limit 1` (or `gh run view <id>`) to confirm the workflow started.
2. Tell the user two things:
   - **Publish the draft.** The workflow uploads to a draft GitHub Release. `electron-updater` only sees **published** releases via `/releases/latest`, so installed clients won't download anything until the user clicks "Publish release" on the Releases page. Every future release needs the same manual publish step.
   - **Actions permissions.** If the publish step fails with 403, tell the user to flip the repo's **Settings → Actions → General → Workflow permissions** to "Read and write permissions" and re-run.
3. Offer to schedule a wake-up to check `gh run view <id>` after ~4 minutes so you can report success/failure without the user polling.

## What Claude may / may not do

- **May**: run `npm version`, `git tag`, `git push`, `git push origin <tag>`. These are authorized by the user's "cut a release" request.
- **Must not**: click "Publish release" on the draft — that's a GitHub UI action. Always remind the user.
- **Must not**: force-push tags (`git push -f <tag>`), delete tags, or amend published commits. If a release is botched, cut a new patch version instead of rewriting history.
- **Must not**: skip typecheck / lint before tagging. A failed CI run wastes a version number and leaves a broken draft the user has to clean up.
- **Must not**: bump to `1.0.0` without the user explicitly asking, even if the major-change rules would technically justify it. Surface the recommendation, confirm first.
