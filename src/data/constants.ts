import type { MachineId, Purity, ResourceNodeDefaults } from './types';

// Resource-node purity multipliers. Applied on top of the extractor base rate.
// (normal = 1.0 is the baseline used when synthesizing extractor recipes.)
export const PURITY_MULTIPLIERS: Record<Purity, number> = {
  impure: 0.5,
  normal: 1.0,
  pure: 2.0,
};

// Miner base extraction rate (items per minute at 100% clock, normal purity).
// Mk1 = 60/min, Mk2 = 120/min, Mk3 = 240/min. We store the cycle duration in
// seconds: items-per-min = 60 / durationSec (with amount=1 in the recipe).
export const EXTRACTOR_CYCLE_SEC: Record<MachineId, number> = {
  'miner-mk1': 1.0,
  'miner-mk2': 0.5,
  'miner-mk3': 0.25,
  'water-extractor': 0.5,
  'oil-extractor': 1.0,
  'resource-well-pressurizer': 0.5,
};

// Somersloop slot counts per machine. Source:
// https://satisfactory.wiki.gg/wiki/Somersloop  (verify per-patch; game-UI authoritative)
// Generators and extractors do not accept somersloops — default 0.
export const SOMERSLOOP_SLOTS: Record<MachineId, number> = {
  smelter: 1,
  foundry: 1,
  constructor: 1,
  assembler: 2,
  manufacturer: 4,
  refinery: 2,
  packager: 1,
  blender: 4,
  'particle-accelerator': 4,
  'quantum-encoder': 4,
  'converter-machine': 2,
};

// Power-shard slot default rule. Generators get 0, everything else gets 3.
export function defaultPowerShardSlots(category: string): number {
  return category === 'generator' ? 0 : 3;
}

// 2-letter icon placeholder: first letter of each word, max two letters.
export function iconLabelFromName(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const DEFAULT_RESOURCE_DEFAULTS: ResourceNodeDefaults = {
  purities: PURITY_MULTIPLIERS,
  extractorCycleSec: EXTRACTOR_CYCLE_SEC,
};
