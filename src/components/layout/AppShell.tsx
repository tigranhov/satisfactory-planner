import { useState } from 'react';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import Inspector from './Inspector';
import GraphCanvas from '../canvas/GraphCanvas';

export default function AppShell() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  return (
    <div className="grid h-full w-full grid-rows-[48px_minmax(0,1fr)] bg-canvas text-[#e6e8ee]">
      <TopBar />
      <div className="grid grid-cols-[240px_minmax(0,1fr)_320px] overflow-hidden">
        <Sidebar />
        <GraphCanvas onSelectNode={setSelectedNodeId} />
        <Inspector selectedNodeId={selectedNodeId} />
      </div>
    </div>
  );
}
