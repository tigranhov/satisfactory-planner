import type { PowerSummary } from '@/lib/aggregate';

interface Props {
  summary: PowerSummary;
}

function formatMW(value: number): string {
  return `${value.toFixed(1)} MW`;
}

export default function PowerSection({ summary }: Props) {
  const { consumptionMW, generationMW, netMW, avgClockPct } = summary;
  const hasGeneration = generationMW > 0;
  const netClass = netMW >= 0 ? 'text-green-400' : 'text-red-400';
  const netPrefix = netMW > 0 ? '+' : '';
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-3 py-2 text-xs">
      <dt className="text-[#9aa2b8]">Consumption</dt>
      <dd className="font-medium tabular-nums text-amber-400">{formatMW(consumptionMW)}</dd>

      {hasGeneration && (
        <>
          <dt className="text-[#9aa2b8]">Generation</dt>
          <dd className="font-medium tabular-nums text-green-400">{formatMW(generationMW)}</dd>

          <dt className="text-[#9aa2b8]">Net</dt>
          <dd className={`font-medium tabular-nums ${netClass}`}>
            {netPrefix}
            {formatMW(netMW)}
          </dd>
        </>
      )}

      <dt className="text-[#9aa2b8]">Avg clock</dt>
      <dd className="font-medium tabular-nums text-[#e6e8ee]">{avgClockPct.toFixed(0)}%</dd>
    </dl>
  );
}
