import TopBar from './TopBar';
import GraphCanvas from '../canvas/GraphCanvas';
import { useBlueprintEditorBridge } from '@/hooks/useBlueprintEditorBridge';

export default function AppShell() {
  useBlueprintEditorBridge();

  return (
    <div className="grid h-full w-full grid-rows-[48px_minmax(0,1fr)] bg-canvas text-[#e6e8ee]">
      <TopBar />
      <div className="overflow-hidden">
        <GraphCanvas />
      </div>
    </div>
  );
}
