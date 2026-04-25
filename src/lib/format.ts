// Format a float with up to `maxDecimals` decimals, stripping trailing zeros
// and a dangling decimal point (so 100 → "100", 45.45450 → "45.4545").
export function formatNumber(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}/min`;
}
