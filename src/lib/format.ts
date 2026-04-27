// Format a float with up to `maxDecimals` decimals, stripping trailing zeros
// and a dangling decimal point (so 100 → "100", 45.45450 → "45.4545").
export function formatNumber(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}/min`;
}

export function formatBottleneckTitle(actual: number, nominal: number, bottleneck: number): string {
  return `Producing ${formatRate(actual)} — throttled to ${Math.round(
    bottleneck * 100,
  )}% by an undersupplied input. Capacity: ${formatRate(nominal)}.`;
}

// Compact duration formatter, two units max: "<1m", "Xm", "Xh Ym", "Xd Yh".
// Returns "—" for non-positive / non-finite inputs so callers can use it
// directly as a placeholder.
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.ceil(minutes)}m`;
  const totalHours = minutes / 60;
  if (totalHours < 48) {
    const h = Math.floor(totalHours);
    const m = Math.round(minutes - h * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const totalDays = totalHours / 24;
  const d = Math.floor(totalDays);
  const h = Math.round(totalHours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}
