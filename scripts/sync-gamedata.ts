// Syncs src/data/gamedata.generated.json from SatisfactoryTools' community-maintained
// data.json (https://github.com/greeny/SatisfactoryTools). That repo is actively updated
// per Satisfactory patch and ships a normalized JSON export — we just remap its shape to
// our internal GameData.
//
// Historical note: the original plan was to parse Coffee Stain's Docs.json directly via
// the `satisfactory-docs-parser` npm package. That package (last updated Jan 2023) crashes
// on Satisfactory 1.0's blueprint-class-name format. Rather than fork and maintain the
// parser ourselves, we depend on SatisfactoryTools' upstream normalization work.
//
// Usage:
//   bun run sync-data                          # fetch latest via `gh api` + normalize
//   bun run sync-data -- --local tmp/sat-data.json   # skip fetch, use a local copy
//
// Output is written via a deterministic stableStringify so re-running produces a
// byte-identical file when the upstream hasn't changed — clean git diffs on patches.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { normalize, type SatisfactoryToolsData } from '../src/data/normalize';
import type { GameData } from '../src/data/types';

function parseArgs(argv: string[]): { local?: string; ref?: string } {
  const out: { local?: string; ref?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local' && argv[i + 1]) out.local = argv[++i];
    else if (a.startsWith('--local=')) out.local = a.slice('--local='.length);
    else if (a === '--ref' && argv[i + 1]) out.ref = argv[++i];
    else if (a.startsWith('--ref=')) out.ref = a.slice('--ref='.length);
  }
  return out;
}

function fetchViaGh(ref: string): string {
  const cmd = `gh api repos/greeny/SatisfactoryTools/contents/data/data.json?ref=${ref} -H "Accept: application/vnd.github.raw"`;
  console.log(`Fetching via: ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function resolveSource(cliLocal: string | undefined): { raw: string; ref: string } {
  if (cliLocal) {
    console.log(`Reading local: ${cliLocal}`);
    return { raw: fs.readFileSync(cliLocal, 'utf8'), ref: 'local' };
  }
  const ref = 'master';
  return { raw: fetchViaGh(ref), ref };
}

function stableStringify(value: unknown, indent = 2): string {
  const seen = new WeakSet();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return undefined;
    seen.add(v as object);
    if (Array.isArray(v)) {
      const arr = v.map(walk);
      if (arr.every((x) => x && typeof x === 'object' && 'id' in (x as Record<string, unknown>))) {
        arr.sort((a, b) => {
          const aid = String((a as { id: unknown }).id);
          const bid = String((b as { id: unknown }).id);
          return aid.localeCompare(bid);
        });
      }
      return arr;
    }
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      const mapped = walk(rec[k]);
      if (mapped !== undefined) out[k] = mapped;
    }
    return out;
  };
  return JSON.stringify(walk(value), null, indent) + '\n';
}

function sanityCheckFluids(data: GameData) {
  // Check items/min rather than per-cycle amount — long-cycle recipes (nuclear,
  // battery) legitimately consume thousands of m³ per cycle but normalized rates
  // stay under a few hundred m³/min. A rate >1000 m³/min is a clear raw-liters leak.
  for (const r of Object.values(data.recipes)) {
    for (const io of [...r.ingredients, ...r.products]) {
      const item = data.items[io.itemId];
      if (item?.form !== 'fluid') continue;
      const ratePerMin = (io.amount * 60) / r.durationSec;
      if (ratePerMin > 1000) {
        throw new Error(
          `Fluid sanity check failed: recipe ${r.id} has ${item.name} rate ${ratePerMin.toFixed(
            1,
          )}/min (>1000 — raw-liters leak?)`,
        );
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { raw, ref } = resolveSource(args.local);

  const src = JSON.parse(raw) as SatisfactoryToolsData;
  console.log('Source counts:', {
    items: Object.keys(src.items).length,
    recipes: Object.keys(src.recipes).length,
    buildings: Object.keys(src.buildings).length,
    generators: Object.keys(src.generators).length,
    miners: Object.keys(src.miners).length,
  });

  const data = normalize(src, `satisfactorytools@${ref}`);
  sanityCheckFluids(data);

  console.log('Normalized:', {
    items: Object.keys(data.items).length,
    recipes: Object.keys(data.recipes).length,
    machines: Object.keys(data.machines).length,
  });

  const outPath = path.resolve(__dirname, '../src/data/gamedata.generated.json');
  fs.writeFileSync(outPath, stableStringify(data));
  console.log(`Wrote: ${outPath}`);
}

main().catch((err) => {
  console.error('sync-gamedata failed:', err);
  process.exit(1);
});
