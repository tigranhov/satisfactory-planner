import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { HelpCircle } from 'lucide-react';
import IconOrLabel from '@/components/ui/IconOrLabel';
import { loadGameData } from '@/data/loader';

const gameData = loadGameData();

interface Props {
  selected: boolean;
  itemId: string | null;
  kindIcon: LucideIcon;
  activeBorderClass: string;
  activeIconClass: string;
  label?: string;
  fallbackName: string;
  setFooter: string;
  unsetFooter: string;
  children: ReactNode;
}

export default function HubLikeCard({
  selected,
  itemId,
  kindIcon: Icon,
  activeBorderClass,
  activeIconClass,
  label,
  fallbackName,
  setFooter,
  unsetFooter,
  children,
}: Props) {
  const item = itemId ? gameData.items[itemId] : undefined;
  const borderClass = selected
    ? 'border-accent'
    : itemId
      ? activeBorderClass
      : 'border-[#4a5068]';
  const iconClass = itemId ? activeIconClass : 'text-[#6b7388]';
  return (
    <div
      className={`relative flex h-[72px] min-w-[180px] items-center gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg ${borderClass}`}
    >
      {children}
      <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
      {item ? (
        <IconOrLabel iconBasename={item.icon} name={item.name} />
      ) : (
        <HelpCircle className="h-5 w-5 shrink-0 text-[#6b7388]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">
          {label || item?.name || fallbackName}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#6b7388]">
          {itemId ? setFooter : unsetFooter}
        </div>
      </div>
    </div>
  );
}
