import { useEffect, type RefObject } from 'react';

// Close a popover on: mousedown outside (capture phase so React Flow's own
// handlers can't swallow the event), window blur, and optionally Escape.
export function usePopoverDismiss(
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { escape?: boolean } = {},
) {
  const escape = options.escape ?? false;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
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
  }, [rootRef, onClose, escape]);
}
