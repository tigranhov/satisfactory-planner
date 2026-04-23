# Releases

The app ships as a Windows NSIS installer via GitHub Releases. Installed
copies check `tigranhov/satisfactory-planner`'s latest release on boot and
auto-download any newer version — a "Restart to update" chip appears in the
top bar when the download finishes.

## Cutting a release

1. Make sure `main` is clean and CI-green locally (`bun run typecheck`,
   `bun run lint`).
2. Bump the version. Use semver appropriate to the change:
   ```sh
   npm version patch   # 0.1.0 -> 0.1.1
   npm version minor   # 0.1.0 -> 0.2.0
   npm version major   # 0.1.0 -> 1.0.0
   ```
   `npm version` commits the `package.json` change and creates a matching
   annotated tag (`v0.1.1`, etc.).
3. Push the tag (this also pushes the commit):
   ```sh
   git push --follow-tags
   ```
4. The `Release` workflow picks up the `v*` tag, builds the installer on
   `windows-latest`, and publishes a draft GitHub Release with
   `Satisfactory.Planner.Setup.<version>.exe` plus the `latest.yml` metadata
   file that `electron-updater` reads.
5. Go to the repo's Releases page, review the draft (edit the notes if
   needed), and **publish**. Once published, installed clients pick up the
   update on their next launch.

## Local installer build (no publish)

```sh
bun run dist
```

Output lands in `release/` — hand it to a tester or install it yourself.

## How auto-update works

On each app launch (packaged builds only), `electron-updater` queries
`https://github.com/tigranhov/satisfactory-planner/releases/latest` for the
newest release. If the version in `latest.yml` is higher than the installed
build, it streams the `.exe` delta into the app's user data directory in the
background, then surfaces the "Restart to update" chip in the top bar.
Clicking it quits the app and swaps in the new binary via the NSIS installer
uninstall/install hook.

Nothing happens in development builds (`app.isPackaged === false`) — the
updater short-circuits without any network traffic.

## Notes

- **Unsigned installer**: the app isn't code-signed yet, so Windows SmartScreen
  will warn on first launch ("Windows protected your PC"). Users click
  "More info" → "Run anyway". An EV or OV certificate clears this later.
- **Per-user install**: `nsis.perMachine=false`, so no admin prompt and each
  user gets their own copy in `%LOCALAPPDATA%\Programs\Satisfactory Planner`.
  User data (projects + blueprints) lives under
  `%APPDATA%\Satisfactory Planner`.
- **Rollback**: if a release turns out broken, delete or mark it "pre-release"
  in the GitHub UI, and installed clients will stop offering it.
