import type { Purity } from '@/data/types';

export const PURITY_ORDER: readonly Purity[] = ['impure', 'normal', 'pure'];

export const PURITY_LABEL: Record<Purity, string> = {
  impure: 'Impure',
  normal: 'Normal',
  pure: 'Pure',
};

export function formatPurityMultiplier(multiplier: number): string {
  return `×${multiplier.toFixed(1)}`;
}
