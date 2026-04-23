import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import AppShell from './components/layout/AppShell';
import { loadBlueprintsOnce, subscribeAutosave } from './data/blueprintPersistence';

export default function App() {
  useEffect(() => {
    let dispose: (() => void) | null = null;
    void loadBlueprintsOnce().then(() => {
      dispose = subscribeAutosave();
    });
    return () => {
      dispose?.();
    };
  }, []);

  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}
