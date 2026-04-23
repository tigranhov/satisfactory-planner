import { useBlueprintStore } from '@/store/blueprintStore';
import type { Blueprint } from '@/models/blueprint';

const DEBOUNCE_MS = 300;

export async function loadBlueprintsOnce(): Promise<void> {
  const api = window.api;
  if (!api?.isElectron) {
    // Web build or preload missing — mark hydrated so consumers don't stall.
    useBlueprintStore.getState().hydrate([]);
    return;
  }
  try {
    const loaded = await api.loadBlueprints();
    useBlueprintStore.getState().hydrate(Array.isArray(loaded) ? loaded : []);
  } catch (err) {
    console.error('[blueprints] load failed', err);
    useBlueprintStore.getState().hydrate([]);
  }
}

export function subscribeAutosave(): () => void {
  const api = window.api;
  if (!api?.isElectron) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSnapshot: Record<string, Blueprint> | null = null;

  const unsubscribe = useBlueprintStore.subscribe((state) => {
    if (!state.loaded) return;
    if (state.blueprints === lastSnapshot) return;
    lastSnapshot = state.blueprints;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      api.saveBlueprints(Object.values(state.blueprints)).catch((err) => {
        console.error('[blueprints] save failed', err);
      });
    }, DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
