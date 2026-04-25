import TopBar from './TopBar';
import GraphCanvas from '../canvas/GraphCanvas';
import TasksPanel from '../tasks/TasksPanel';
import InfoPanel from '../infoPanel/InfoPanel';
import { useBlueprintEditorBridge } from '@/hooks/useBlueprintEditorBridge';
import { useGlobalNavKeys } from '@/hooks/useGlobalNavKeys';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';

export default function AppShell() {
  useBlueprintEditorBridge();
  useGlobalNavKeys();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const tasksOpen = useUiStore((s) =>
    activeProjectId ? !!s.taskPanelOpenByProject[activeProjectId] : false,
  );
  const infoOpen = useUiStore((s) =>
    activeProjectId ? !!s.infoPanelOpenByProject[activeProjectId] : false,
  );

  const gridTemplateColumns = [
    tasksOpen ? '260px' : null,
    'minmax(0,1fr)',
    infoOpen ? '280px' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="grid h-full w-full grid-rows-[48px_minmax(0,1fr)] bg-canvas text-[#e6e8ee]">
      <TopBar />
      <div className="grid overflow-hidden" style={{ gridTemplateColumns }}>
        {tasksOpen && <TasksPanel />}
        <GraphCanvas />
        {infoOpen && <InfoPanel />}
      </div>
    </div>
  );
}
