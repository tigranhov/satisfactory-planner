import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import AppShell from './components/layout/AppShell';
import { loadBlueprintsOnce, subscribeAutosave } from './data/blueprintPersistence';
import {
  loadProjectBootstrap,
  subscribeProjectAutosave,
} from './data/projectPersistence';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposeBlueprints: (() => void) | null = null;
    let disposeProject: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      await Promise.all([loadBlueprintsOnce(), loadProjectBootstrap()]);
      if (cancelled) return;
      disposeBlueprints = subscribeAutosave();
      disposeProject = subscribeProjectAutosave();
      setReady(true);
    })().catch((err) => {
      console.error('[boot]', err);
      setReady(true);
    });

    return () => {
      cancelled = true;
      disposeBlueprints?.();
      disposeProject?.();
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas text-sm text-[#6b7388]">
        Loading...
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}
