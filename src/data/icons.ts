// Resolves icon basenames (e.g. `desc-aluminumingot-c_64.png`) to bundled asset
// URLs. Vite picks up every PNG under `src/data/icons/` at build time, hashes it,
// and exposes the URL as the default import — so we glob them once at module
// load and index by basename for O(1) lookup.
//
// Icons are fetched at sync time by `scripts/sync-gamedata.ts` from
// greeny/SatisfactoryTools.

const modules = import.meta.glob<string>('./icons/*.png', {
  eager: true,
  import: 'default',
});

const byBasename = new Map<string, string>();
for (const [modPath, url] of Object.entries(modules)) {
  const basename = modPath.slice(modPath.lastIndexOf('/') + 1);
  byBasename.set(basename, url);
}

export function resolveIconUrl(basename: string | undefined): string | undefined {
  if (!basename) return undefined;
  return byBasename.get(basename);
}
