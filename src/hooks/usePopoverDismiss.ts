import { useEffect, type RefObject } from 'react';

// Close a popover on: mousedown outside (capture phase so React Flow's own
// handlers can't swallow the event), window blur, and optionally Escape.
// Pass an array of refs when the popover is split across DOM subtrees
// (e.g. a trigger button and a portaled popup) so clicks inside either
// don't count as "outside".
export function usePopoverDismiss(
  refs: RefObject<HTMLElement | null> | Array<RefObject<HTMLElement | null>>,
  onClose: () => void,
  options: { escape?: boolean } = {},
) {
  const escape = options.escape ?? false;
  useEffect(() => {
    const refList = Array.isArray(refs) ? refs : [refs];
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      for (const ref of refList) {
        if (ref.current?.contains(target)) return;
      }
      onClose();
    };
    const onBlur = () => onClose();
    const onKey = escape
      ? (e: KeyboardEvent) => {
          if (e.key === 'Escape') onClose();
        }
      : null;
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    if (onKey) window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
      if (onKey) window.removeEventListener('keydown', onKey);
    };
  }, [refs, onClose, escape]);
}
