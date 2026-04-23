import { resolveIconUrl } from '@/data/icons';
import { iconLabelFromName } from '@/data/constants';

interface Props {
  iconBasename: string | undefined;
  name: string;
  className?: string;
  bgClassName?: string;
}

export default function IconOrLabel({
  iconBasename,
  name,
  className = 'h-5 w-5 rounded',
  bgClassName = 'bg-panel-hi',
}: Props) {
  const url = resolveIconUrl(iconBasename);
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        draggable={false}
        className={`${className} ${bgClassName} object-contain`}
      />
    );
  }
  return (
    <span
      className={`${className} ${bgClassName} inline-flex items-center justify-center text-[10px] font-bold text-accent`}
    >
      {iconLabelFromName(name)}
    </span>
  );
}
