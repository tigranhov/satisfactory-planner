---
name: release
description: Analyze commits since the last release tag, suggest a semver bump, draft a changelog entry, execute the tag-and-publish flow, and remind the user to publish the draft GitHub Release.
---

# Release

Invoke when the user asks to cut a release ("ship a release", "release it", "cut v0.2", "tag new version", etc.). The skill proposes a version bump based on commits since the last release, drafts a `CHANGELOG.md` entry, confirms both with the user, then drives the full publish flow including syncing the changelog into the GitHub Release body.

Full human-facing reference: `RELEASES.md`. Canonical changelog: `CHANGELOG.md`.

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

## Step 3: Present the suggestion + draft a changelog entry

Show the user:

- The commit list since the last tag (shortlog with subjects).
- The proposed bump and the specific commits / rules that pushed it there (e.g. "minor because commit `4f4770c Add blueprint library` introduced a new user-facing surface").
- The resulting version (`current` → `proposed`).
- **A drafted `CHANGELOG.md` entry for the proposed version.** Follow the format already used in `CHANGELOG.md` (Keep a Changelog-ish: `## [X.Y.Z] - YYYY-MM-DD`, then `### Added` / `### Changed` / `### Fixed` / `### Removed` sections as applicable). Rewrite commit subjects into user-facing language — skip internal refactors, comment cleanups, and docs/skill edits unless they materially affect users. One bullet per user-observable change, not one bullet per commit.

Ask for confirmation of both the bump AND the changelog entry. Accept edits to either (user may know context you don't, or want the phrasing rewritten). If this is the first release (no prior tag), skip bump selection and confirm the current `package.json` version will be tagged as-is — still draft a changelog entry.

## Step 4: Pre-flight checks

Before tagging:

1. `bun run typecheck` — blocker on failure.
2. `bun run lint` — blocker on failure.
3. If `git log origin/main..HEAD` shows unpushed commits, `git push origin main` first. The workflow runs against the pushed tagged commit — a tag without its parent commit pushed will fail to resolve.
4. If the diff since last tag touches `electron/main.ts`, `electron/preload.ts`, `electron/updater.ts`, the `build` block in `package.json`, or `.github/workflows/release.yml`, warn the user and ask whether to smoke-test via `bun run dist` before tagging. Those paths aren't covered by `bun run dev`, and a broken installer blocks the update chain for every existing client. Do not run `bun run dist` automatically — it's heavy and produces large output; just offer.

## Step 5: Execute

### 5a. Update `CHANGELOG.md`

Replace the `## [Unreleased]` placeholder with the new section header (`## [X.Y.Z] - YYYY-MM-DD`) and add a fresh empty `## [Unreleased]` above it. Add or update the two comparison links at the bottom of the file (`[Unreleased]: …/compare/vX.Y.Z...HEAD` and `[X.Y.Z]: …/compare/vPREV...vX.Y.Z`).

Stage and commit as its own commit **before** the version bump so the tag on the bump commit already has the changelog history behind it:

```sh
git add CHANGELOG.md
git commit -m "Changelog for vX.Y.Z"
```

### 5b. Bump + tag

Two shapes, depending on whether `package.json` already matches the target version. Note: this repo uses Bun, so `npm` is not installed — use `bun pm version` which behaves identically (edits `package.json`, creates a commit, creates the tag).

#### Standard bump (existing version ≠ target)

```sh
bun pm version <patch|minor|major>   # edits package.json, commits, creates v<X.Y.Z> tag
git push --follow-tags               # pushes the bump commit AND the tag
```

#### First release (existing version already matches target, no prior tag)

```sh
git tag -a v<X.Y.Z> -m "v<X.Y.Z> — <short summary>"
git push origin v<X.Y.Z>
```

Use the second shape only when `package.json` already declares the target version AND no prior `v*` tag exists. Never hand-roll a tag that disagrees with `package.json`.

## Step 6: Watch + sync release notes + post-release reminders

Right after pushing the tag:

1. Run `gh run list --workflow=release.yml --limit 1` (or `gh run view <id>`) to confirm the workflow started.
2. Offer to schedule a wake-up to check `gh run view <id>` after ~4 minutes so you can report success/failure without the user polling.
3. Once the workflow has created the draft release, sync the changelog section into the GitHub Release body so the Releases page shows the same entry users see in `CHANGELOG.md`. Two extraction gotchas to avoid:
   - A range pattern (`/start/,/start_or_other_header/`) is broken — its end-marker matches the start line itself, so you get only the header.
   - The variable-based awk form (`awk -v V="X.Y.Z" '$0 ~ "^## \\[" V ...'`) hits Bash + awk escape-stripping on Windows (gawk warns "escape sequence `\[' treated as plain `['" and matches zero lines).

   Use the hardcoded-pattern form with awk's literal-regex syntax (`/.../` slashes need single-backslash escapes only — Bash doesn't strip them inside single quotes):
   ```sh
   # Replace the version numbers below with the new and previous tag.
   awk '/^## \[0\.9\.0\]/{flag=1} flag && /^## \[0\.8\.0\]/{exit} flag' \
     CHANGELOG.md > notes-v0.9.0.md
   ```
   Verify the file contains more than one line (`wc -l notes-v0.9.0.md`) before uploading — if it has only the header, the extraction failed silently. Write the file to a path inside the repo or an absolute Windows path; do not write to `/tmp` from the Write tool and read it from Bash, since their `/tmp` resolution can differ on Windows. Then:
   ```sh
   gh release edit vX.Y.Z --notes-file notes-vX.Y.Z.md
   ```
   After the edit, confirm with `gh release view vX.Y.Z --json body --jq '.body' | head -5` — the body should start with `## [X.Y.Z]` followed by the changelog sections, not just the header line. This works for both draft and published releases and doesn't require `--draft=false`. Clean up the temp file with `rm notes-vX.Y.Z.md` after upload.
4. Tell the user two things:
   - **Publish the draft.** The workflow uploads to a draft GitHub Release. `electron-updater` only sees **published** releases via `/releases/latest`, so installed clients won't download anything until the user clicks "Publish release" on the Releases page. Every future release needs the same manual publish step. (The agent is explicitly forbidden from flipping draft → published; see "What Claude may / may not do".)
   - **Actions permissions.** If the publish step fails with 403, tell the user to flip the repo's **Settings → Actions → General → Workflow permissions** to "Read and write permissions" and re-run.

## What Claude may / may not do

- **May**: run `bun pm version` / `npm version`, `git tag`, `git push`, `git push origin <tag>`, `gh release edit --notes-file`. These are authorized by the user's "cut a release" request.
- **May**: update `CHANGELOG.md` and commit it as part of the release flow.
- **Must not**: flip a draft release to published (`gh release edit --draft=false`) — that triggers `electron-updater` auto-updates on every installed client. Always remind the user to publish the draft manually.
- **Must not**: force-push tags (`git push -f <tag>`), delete tags, or amend published commits. If a release is botched, cut a new patch version instead of rewriting history.
- **Must not**: skip typecheck / lint before tagging. A failed CI run wastes a version number and leaves a broken draft the user has to clean up.
- **Must not**: bump to `1.0.0` without the user explicitly asking, even if the major-change rules would technically justify it. Surface the recommendation, confirm first.
