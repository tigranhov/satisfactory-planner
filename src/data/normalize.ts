// Converts the SatisfactoryTools `data.json` (https://github.com/greeny/SatisfactoryTools)
// into our internal GameData shape.
//
// Why SatisfactoryTools and not satisfactory-docs-parser?
// The npm package `satisfactory-docs-parser` (lydianlights) was last updated in
// Jan 2023 and crashes on Satisfactory 1.0's split per-locale files (the blueprint
// class-name format changed from bare strings to `Class'/Path/Class_C'` wrappers
// and some recipes have `mIngredients: null`). The SatisfactoryTools repo is
// actively maintained (last push 2026-03-29) and ships a normalized `data/data.json`.
// We pull that file at sync time and map its shape to ours — no parsing of Docs.json.
//
// Source shape (top-level keys):
//   items[className]      — { slug, name, className, stackSize, sinkPoints, energyValue, liquid }
//   recipes[className]    — { slug, name, className, alternate, time, inMachine, inHand,
//                             inWorkshop, ingredients[], products[], producedIn[],
//                             isVariablePower, minPower, maxPower }
//   resources[className]  — { item: className, speed }  (subset of items that spawn as nodes)
//   buildings[className]  — { slug, name, className, metadata: { powerConsumption,
//                             powerConsumptionExponent, manufacturingSpeed } }
//   generators[className] — { className, fuel[], powerProduction, powerProductionExponent,
//                             waterToPowerRatio }
//   miners[className]     — { className, allowedResources[], allowLiquids, allowSolids,
//                             itemsPerCycle, extractCycleTime }

import type { GameData, Item, ItemCategory, Machine, Recipe, RecipeIO, ItemForm } from './types';
import {
  DEFAULT_RESOURCE_DEFAULTS,
  SOMERSLOOP_SLOTS,
  defaultPowerShardSlots,
  iconFileFromClassName,
} from './constants';
import { toSlug } from '@/lib/ids';

interface StItem {
  slug: string;
  name: string;
  className: string;
  stackSize: number;
  sinkPoints: number;
  energyValue: number;
  liquid: boolean;
}

interface StRecipeIO {
  item: string;
  amount: number;
}

interface StRecipe {
  slug: string;
  name: string;
  className: string;
  alternate: boolean;
  time: number;
  inHand: boolean;
  inWorkshop: boolean;
  inMachine: boolean;
  forBuilding: boolean;
  manualTimeMultiplier: number;
  ingredients: StRecipeIO[];
  products: StRecipeIO[];
  producedIn: string[];
  isVariablePower: boolean;
  minPower: number;
  maxPower: number;
}

interface StResource {
  item: string;
  speed: number;
}

interface StBuilding {
  slug: string;
  name: string;
  className: string;
  categories: string[];
  metadata?: {
    powerConsumption?: number;
    powerConsumptionExponent?: number;
    manufacturingSpeed?: number;
  };
}

interface StGenerator {
  className: string;
  fuel: string[];
  powerProduction: number;
  powerProductionExponent: number;
  waterToPowerRatio: number;
}

interface StMiner {
  className: string;
  allowedResources: string[];
  allowLiquids: boolean;
  allowSolids: boolean;
  itemsPerCycle: number;
  extractCycleTime: number;
}

export interface SatisfactoryToolsData {
  items: Record<string, StItem>;
  recipes: Record<string, StRecipe>;
  resources: Record<string, StResource>;
  buildings: Record<string, StBuilding>;
  generators: Record<string, StGenerator>;
  miners: Record<string, StMiner>;
}

function detectItemForm(item: StItem): ItemForm {
  if (!item.liquid) return 'solid';
  return /gas|nitrogen|vapor|oxygen/i.test(item.name) ? 'gas' : 'fluid';
}

function itemCategory(
  item: StItem,
  isResource: boolean,
  isFuel: boolean,
  isBiomass: boolean,
): ItemCategory {
  if (isResource) return 'ores';
  if (item.liquid) return 'fluids';
  if (isBiomass) return 'biomass';
  if (isFuel) return 'fuels';
  return 'parts';
}

export function normalize(src: SatisfactoryToolsData, gameVersion = 'st-master'): GameData {
  // --- 1. Build lookups from source className → things we need to resolve later.
  const buildingByClass = new Map<string, StBuilding>();
  for (const b of Object.values(src.buildings)) buildingByClass.set(b.className, b);

  const itemByClass = new Map<string, StItem>();
  for (const i of Object.values(src.items)) itemByClass.set(i.className, i);

  const itemSlugByClass = new Map<string, string>();
  for (const [className, src_item] of Object.entries(src.items)) {
    itemSlugByClass.set(className, src_item.slug);
  }

  const resourceItemClasses = new Set<string>(Object.keys(src.resources));

  // A fuel item is one referenced by any generator's `fuel` array.
  const fuelItemClasses = new Set<string>();
  for (const g of Object.values(src.generators)) for (const f of g.fuel) fuelItemClasses.add(f);

  // Biomass heuristic: items named "Biomass", "Wood", "Leaves", "Mycelia", "Fabric", etc.
  // SatisfactoryTools doesn't expose an `isBiomass` flag; we infer from fuel used by the
  // Biomass Burner. Everything accepted by Desc_GeneratorBiomass_C counts.
  const biomassItemClasses = new Set<string>(src.generators.Desc_GeneratorBiomass_C?.fuel ?? []);

  // Map product class name to its building recipe ingredients.
  const buildCostsByClass = new Map<string, RecipeIO[]>();
  for (const r of Object.values(src.recipes)) {
    if (!r.forBuilding) continue;
    const buildingClass = r.products[0]?.item;
    if (buildingClass) {
      const ingredients = r.ingredients.map((i) => {
        const itemId = itemSlugByClass.get(i.item);
        if (!itemId) throw new Error(`building recipe ${r.slug}: unknown item ${i.item}`);
        return { itemId, amount: i.amount };
      });
      buildCostsByClass.set(buildingClass, ingredients);
    }
  }

  // --- 2. Items.
  const items: Record<string, Item> = {};
  for (const src_item of Object.values(src.items)) {
    const form = detectItemForm(src_item);
    const isResource = resourceItemClasses.has(src_item.className);
    const isFuel = fuelItemClasses.has(src_item.className);
    const isBiomass = biomassItemClasses.has(src_item.className);
    items[src_item.slug] = {
      id: src_item.slug,
      name: src_item.name,
      icon: iconFileFromClassName(src_item.className),
      form,
      stackSize: src_item.liquid ? undefined : src_item.stackSize,
      sinkPoints: src_item.sinkPoints || undefined,
      energyMJ: src_item.energyValue || undefined,
      category: itemCategory(src_item, isResource, isFuel, isBiomass),
    };
  }

  // --- 3. Machines (manufacturers + miners + generators).
  const machines: Record<string, Machine> = {};
  const machineSlugByClass = new Map<string, string>();

  // Collect the set of building classNames actually referenced as `producedIn` by any
  // machine-craftable recipe — this naturally filters out walls/supports/etc. that
  // technically have a `manufacturingSpeed` field but aren't real manufacturers.
  const producerClasses = new Set<string>();
  for (const r of Object.values(src.recipes)) {
    if (!r.inMachine || r.forBuilding) continue;
    for (const cls of r.producedIn) producerClasses.add(cls);
  }

  for (const b of Object.values(src.buildings)) {
    if (!producerClasses.has(b.className)) continue;
    machines[b.slug] = {
      id: b.slug,
      name: b.name,
      icon: iconFileFromClassName(b.className),
      category: 'manufacturer',
      powerMW: b.metadata?.powerConsumption ?? 0,
      isVariablePower:
        b.metadata?.powerConsumptionExponent !== undefined &&
        b.metadata?.powerConsumptionExponent !== 1.6,
      powerShardSlots: defaultPowerShardSlots('manufacturer'),
      somersloopSlots: SOMERSLOOP_SLOTS[b.slug] ?? 0,
      buildCost: buildCostsByClass.get(b.className),
    };
    machineSlugByClass.set(b.className, b.slug);
  }

  // Miners/extractors: we synthesize machine entries from the miners table.
  // For power/build metadata, fall back to any building entry that matches the same className.
  for (const m of Object.values(src.miners)) {
    const building = buildingByClass.get(m.className);
    const name = building?.name ?? m.className.replace(/^Desc_|_C$/g, '');
    const slug = building?.slug ?? toSlug(name);
    machines[slug] = {
      id: slug,
      name,
      icon: iconFileFromClassName(m.className),
      category: 'extractor',
      powerMW: building?.metadata?.powerConsumption ?? 0,
      powerShardSlots: defaultPowerShardSlots('extractor'),
      somersloopSlots: 0,
      buildCost: buildCostsByClass.get(m.className),
    };
    machineSlugByClass.set(m.className, slug);
  }

  // Generators: same treatment.
  for (const g of Object.values(src.generators)) {
    const building = buildingByClass.get(g.className);
    const name = building?.name ?? g.className.replace(/^Desc_|_C$/g, '');
    const slug = building?.slug ?? toSlug(name);
    machines[slug] = {
      id: slug,
      name,
      icon: iconFileFromClassName(g.className),
      category: 'generator',
      powerMW: g.powerProduction,
      powerShardSlots: defaultPowerShardSlots('generator'),
      somersloopSlots: 0,
      producesPower: true,
      buildCost: buildCostsByClass.get(g.className),
    };
    machineSlugByClass.set(g.className, slug);
  }

  // Logistics machines (Splitter, Merger, etc.)
  for (const b of Object.values(src.buildings)) {
    if (machines[b.slug]) continue;
    const isLogistics =
      b.className.includes('Splitter') ||
      b.className.includes('Merger') ||
      b.className.includes('Conveyor') ||
      b.className.includes('Pipeline');

    if (isLogistics && buildCostsByClass.has(b.className)) {
      machines[b.slug] = {
        id: b.slug,
        name: b.name,
        icon: iconFileFromClassName(b.className),
        category: 'logistics',
        powerMW: b.metadata?.powerConsumption ?? 0,
        powerShardSlots: 0,
        somersloopSlots: 0,
        buildCost: buildCostsByClass.get(b.className),
      };
      machineSlugByClass.set(b.className, b.slug);
    }
  }

  // --- 4. Production recipes (machine-only; skip hand/workshop/build-gun).
  const recipes: Record<string, Recipe> = {};
  for (const r of Object.values(src.recipes)) {
    if (!r.inMachine) continue;
    if (r.forBuilding) continue;

    const producers = r.producedIn
      .map((cls) => machineSlugByClass.get(cls))
      .filter((x): x is string => Boolean(x));
    if (producers.length === 0) continue;

    const mapIO = (arr: StRecipeIO[], markByproduct: boolean): RecipeIO[] =>
      arr.map((q, idx) => {
        const itemId = itemSlugByClass.get(q.item);
        if (!itemId) throw new Error(`recipe ${r.slug}: unknown item ${q.item}`);
        const io: RecipeIO = { itemId, amount: q.amount };
        if (markByproduct && idx > 0) io.isByproduct = true;
        return io;
      });

    const machineId = producers[0];
    const machine = machines[machineId];
    const nominalPower = r.isVariablePower
      ? (r.minPower + r.maxPower) / 2 // particle accelerator etc. — use mean
      : machine.powerMW;
    recipes[r.slug] = {
      id: r.slug,
      name: r.name,
      ingredients: mapIO(r.ingredients, false),
      products: mapIO(r.products, true),
      durationSec: r.time,
      machineId,
      producedIn: producers,
      powerMW: nominalPower,
      variablePowerMW: r.isVariablePower ? { min: r.minPower, max: r.maxPower } : undefined,
      alternate: r.alternate,
    };
  }

  // --- 5. Synthesize generator recipes — one per (generator × fuel).
  for (const g of Object.values(src.generators)) {
    const machineId = machineSlugByClass.get(g.className);
    if (!machineId) continue;
    const waterRatio = g.waterToPowerRatio ?? 0; // m³ water per MW-min
    const waterId = itemSlugByClass.get('Desc_Water_C');

    for (const fuelClass of g.fuel) {
      const fuelId = itemSlugByClass.get(fuelClass);
      if (!fuelId) continue;
      const fuelItem = items[fuelId];
      if (!fuelItem?.energyMJ) continue;

      const durationSec = fuelItem.energyMJ / g.powerProduction;
      const ingredients: RecipeIO[] = [{ itemId: fuelId, amount: 1 }];
      if (waterRatio > 0 && waterId) {
        // waterToPowerRatio is **liters per MW per second** (verified against game
        // values — coal plant at 75 MW × ratio 10 → 45 m³/min water ✓).
        // Total m³ = MW × seconds × ratio / 1000.
        const waterAmount = (g.powerProduction * durationSec * waterRatio) / 1000;
        if (waterAmount > 0) ingredients.push({ itemId: waterId, amount: waterAmount });
      }

      const id = `gen-${machineId}-${fuelId}`;
      recipes[id] = {
        id,
        name: `${machines[machineId].name} · ${fuelItem.name}`,
        ingredients,
        products: [],
        durationSec,
        machineId,
        producedIn: [machineId],
        powerMW: 0,
        generatedPowerMW: g.powerProduction,
        isPowerGeneration: true,
        alternate: false,
      };
    }
  }

  // --- 6. Synthesize extractor recipes — one per (miner × allowed resource) at baseline.
  //        For solid miners itemsPerCycle is 1 raw unit; for liquid extractors it's in
  //        the game's centiliter-like scale (2000 for oil pump = 2 m³/cycle).
  for (const m of Object.values(src.miners)) {
    const machineId = machineSlugByClass.get(m.className);
    if (!machineId) continue;

    for (const resourceClass of m.allowedResources) {
      const itemId = itemSlugByClass.get(resourceClass);
      if (!itemId) continue;
      const item = items[itemId];
      if (!item) continue;
      if (item.form !== 'solid' && !m.allowLiquids) continue;
      if (item.form === 'solid' && !m.allowSolids) continue;

      const rawPerCycle = m.itemsPerCycle;
      const amount = item.form === 'solid' ? rawPerCycle : rawPerCycle / 1000;

      const id = `ext-${machineId}-${itemId}`;
      recipes[id] = {
        id,
        name: `${machines[machineId].name} · ${item.name}`,
        ingredients: [],
        products: [{ itemId, amount }],
        durationSec: m.extractCycleTime,
        machineId,
        producedIn: [machineId],
        powerMW: machines[machineId].powerMW,
        isExtraction: true,
        resourceId: itemId,
        alternate: false,
      };
    }
  }

  // --- 7. Validate referenced machineIds and itemIds.
  for (const r of Object.values(recipes)) {
    if (!machines[r.machineId]) throw new Error(`recipe ${r.id}: missing machine ${r.machineId}`);
    for (const io of [...r.ingredients, ...r.products]) {
      if (!items[io.itemId]) throw new Error(`recipe ${r.id}: missing item ${io.itemId}`);
    }
  }

  return {
    items,
    recipes,
    machines,
    resourceDefaults: DEFAULT_RESOURCE_DEFAULTS,
    meta: { gameVersion, source: 'docs' },
  };
}
