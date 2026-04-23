interface Props {
  powerMW: number;
}

// Generators emit negative power (they produce it). Manufacturers consume.
export default function PowerReadout({ powerMW }: Props) {
  const producing = powerMW < 0;
  const magnitude = Math.abs(powerMW);
  return (
    <span>
      <span className="text-[#6b7388]">{producing ? 'Generates ' : 'Power '}</span>
      <span
        className={`font-medium tabular-nums ${producing ? 'text-green-400' : 'text-amber-400'}`}
      >
        {magnitude.toFixed(1)} MW
      </span>
    </span>
  );
}
