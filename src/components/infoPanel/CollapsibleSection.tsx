import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';

export type InfoSectionId =
  | 'power'
  | 'io'
  | 'machines'
  | 'somersloops'
  | 'issues'
  | 'global-inputs'
  | 'global-outputs'
  | 'global-surplus'
  | 'tasks-cost';

interface Props {
  id: InfoSectionId;
  title: string;
  trailing?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function CollapsibleSection({
  id,
  title,
  trailing,
  defaultOpen = true,
  children,
}: Props) {
  const stored = useUiStore((s) => s.infoSectionsOpen[id]);
  const set = useUiStore((s) => s.setInfoSectionOpen);
  const open = stored ?? defaultOpen;
  const Chev = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-b border-border/60">
      <button
        onClick={() => set(id, !open)}
        className="flex w-full items-center justify-between gap-2 bg-panel-hi/40 px-3 py-1.5 text-left hover:bg-panel-hi"
      >
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#9aa2b8]">
          <Chev className="h-3 w-3 text-[#6b7388]" />
          {title}
        </span>
        {trailing && (
          <span className="text-[11px] normal-case tracking-normal text-[#6b7388]">
            {trailing}
          </span>
        )}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}
