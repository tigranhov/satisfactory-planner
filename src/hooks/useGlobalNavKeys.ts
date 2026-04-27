import { useEffect } from 'react';
import { useNavigationStore } from '@/store/navigationStore';
import { useUiStore } from '@/store/uiStore';
import { isEditableTarget } from '@/lib/dom';

// MouseEvent.button values for the standard 5-button mouse thumb cluster.
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

const isModalOpen = (): boolean => {
  const s = useUiStore.getState();
  return s.bookOpen || s.settingsOpen || s.calculatorOpen;
};

// Browser-style history navigation:
//   - Mouse thumb buttons via auxclick.
//   - Alt+ArrowLeft / Alt+ArrowRight (matches Chrome/Firefox shortcut).
// Suppressed while editing text or while a modal is open.
export function useGlobalNavKeys(): void {
  useEffect(() => {
    const onAuxClick = (e: MouseEvent) => {
      if (e.button !== MOUSE_BACK && e.button !== MOUSE_FORWARD) return;
      if (isEditableTarget(e.target)) return;
      if (isModalOpen()) return;
      e.preventDefault();
      const nav = useNavigationStore.getState();
      if (e.button === MOUSE_BACK) nav.goBack();
      else nav.goForward();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isEditableTarget(e.target)) return;
      if (isModalOpen()) return;
      e.preventDefault();
      const nav = useNavigationStore.getState();
      if (e.key === 'ArrowLeft') nav.goBack();
      else nav.goForward();
    };

    window.addEventListener('auxclick', onAuxClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
