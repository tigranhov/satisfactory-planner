export type ItemId = string;
export type RecipeId = string;
export type MachineId = string;

export type ItemForm = 'solid' | 'fluid' | 'gas';
export type Purity = 'impure' | 'normal' | 'pure';
export type MachineCategory =
  | 'manufacturer'
  | 'extractor'
  | 'generator'
  | 'logistics'
  | 'misc';

export type ItemCategory = 'ores' | 'parts' | 'fluids' | 'biomass' | 'fuels' | 'other';

export interface Item {
  id: ItemId;
  name: string;
  icon: string;
  form: ItemForm;
  stackSize?: number;
  energyMJ?: number;
  sinkPoints?: number;
  category?: ItemCategory;
}

export interface RecipeIO {
  itemId: ItemId;
  amount: number;
  isByproduct?: boolean;
}

export interface Recipe {
  id: RecipeId;
  name: string;
  ingredients: RecipeIO[];
  products: RecipeIO[];
  durationSec: number;
  machineId: MachineId;
  producedIn: MachineId[];
  powerMW: number;
  variablePowerMW?: { min: number; max: number };
  alternate: boolean;
  manualOnly?: boolean;
  isPowerGeneration?: boolean;
  generatedPowerMW?: number;
  isExtraction?: boolean;
  resourceId?: ItemId;
}

export interface Machine {
  id: MachineId;
  name: string;
  icon: string;
  category: MachineCategory;
  powerMW: number;
  isVariablePower?: boolean;
  powerShardSlots: number;
  somersloopSlots: number;
  producesPower?: boolean;
  buildCost?: RecipeIO[];
}

export interface ResourceNodeDefaults {
  purities: Record<Purity, number>;
  extractorCycleSec: Record<MachineId, number>;
}

export interface GameData {
  items: Record<ItemId, Item>;
  recipes: Record<RecipeId, Recipe>;
  machines: Record<MachineId, Machine>;
  resourceDefaults: ResourceNodeDefaults;
  meta: { gameVersion: string; source: 'docs' | 'sample' };
}
