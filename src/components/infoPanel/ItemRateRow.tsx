import IconOrLabel from '@/components/ui/IconOrLabel';
import { formatRate } from '@/lib/format';

interface Props {
  name: string;
  icon: string | undefined;
  rate: number;
  rateClass?: string;
}

export default function ItemRateRow({ name, icon, rate, rateClass }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <IconOrLabel
          iconBasename={icon}
          name={name}
          className="inline-block h-4 w-4 rounded"
        />
        <span className="truncate text-[#e6e8ee]">{name}</span>
      </div>
      <span className={`shrink-0 font-medium tabular-nums ${rateClass ?? 'text-[#e6e8ee]'}`}>
        {formatRate(rate)}
      </span>
    </div>
  );
}
