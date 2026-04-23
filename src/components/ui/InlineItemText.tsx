import type { ReactNode } from 'react';
import IconOrLabel from './IconOrLabel';
import { getItemByNameOrId, loadGameData } from '@/data/loader';

const gameData = loadGameData();
// ::Iron Ore::, ::iron-ore::, etc. Inner token can't contain colons so
// accidental `:foo:bar:` spans don't greedy-merge into one tag.
const PATTERN = /::([^:]+?)::/g;

interface Props {
  text: string;
  className?: string;
}

export default function InlineItemText({ text, className }: Props) {
  if (!text.includes('::')) {
    return <span className={className}>{text}</span>;
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const item = getItemByNameOrId(gameData, match[1]);
    if (item) {
      parts.push(
        <IconOrLabel
          key={`${start}-${item.id}`}
          iconBasename={item.icon}
          name={item.name}
          className="inline-block h-4 w-4 rounded align-[-0.2em]"
        />,
      );
    } else {
      parts.push(match[0]);
    }
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
}
