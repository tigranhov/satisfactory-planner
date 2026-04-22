import { ReactFlowProvider } from '@xyflow/react';
import AppShell from './components/layout/AppShell';

export default function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}
