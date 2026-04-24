import TopBar from './TopBar';
import GraphCanvas from '../canvas/GraphCanvas';
import TasksPanel from '../tasks/TasksPanel';
import { useBlueprintEditorBridge } from '@/hooks/useBlueprintEditorBridge';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';

export default function AppShell() {
  useBlueprintEditorBridge();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const panelOpen = useUiStore((s) =>
    activeProjectId ? !!s.taskPanelOpenByProject[activeProjectId] : false,
  );

  return (
    <div className="grid h-full w-full grid-rows-[48px_minmax(0,1fr)] bg-canvas text-[#e6e8ee]">
      <TopBar />
      <div
        className={`grid overflow-hidden ${
          panelOpen ? 'grid-cols-[260px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]'
        }`}
      >
        {panelOpen && <TasksPanel />}
        <GraphCanvas />
      </div>
    </div>
  );
}
