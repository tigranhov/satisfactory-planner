import { useMemo } from 'react';
import { Gauge, X } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useUiStore } from '@/store/uiStore';
import { useActiveGraph, useActiveGraphId } from '@/hooks/useActiveGraph';
import { useSubgraphResolver } from '@/hooks/useSubgraphResolver';
import { loadGameData } from '@/data/loader';
import { ROOT_GRAPH_ID } from '@/lib/ids';
import {
  globalFinalOutputs,
  globalRawInputs,
  globalSinkPoints,
  globalSurplus,
  somersloopUsage,
  subgraphIO,
  subgraphIssues,
  subgraphMachines,
  subgraphPower,
  totalMachineCount,
} from '@/lib/aggregate';
import CollapsibleSection from './CollapsibleSection';
import PowerSection from './sections/PowerSection';
import IOSection from './sections/IOSection';
import MachinesSection from './sections/MachinesSection';
import IssuesSection from './sections/IssuesSection';
import SomersloopSection from './sections/SomersloopSection';
import GlobalSection from './sections/GlobalSection';

const gameData = loadGameData();

function formatPower(consumptionMW: number): string {
  if (consumptionMW >= 1000) return `${(consumptionMW / 1000).toFixed(2)} GW`;
  return `${consumptionMW.toFixed(0)} MW`;
}

export default function InfoPanel() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setInfoPanelOpen = useUiStore((s) => s.setInfoPanelOpen);
  const graph = useActiveGraph();
  const activeGraphId = useActiveGraphId();
  const resolver = useSubgraphResolver();

  const isGlobal = activeGraphId === ROOT_GRAPH_ID;

  const power = useMemo(
    () => subgraphPower(graph, gameData, resolver),
    [graph, resolver],
  );
  const io = useMemo(
    () => (isGlobal ? null : subgraphIO(graph, gameData, resolver)),
    [graph, resolver, isGlobal],
  );
  const machines = useMemo(
    () => (isGlobal ? null : subgraphMachines(graph, gameData, resolver)),
    [graph, resolver, isGlobal],
  );
  const issues = useMemo(
    () => (isGlobal ? null : subgraphIssues(graph, gameData, resolver)),
    [graph, resolver, isGlobal],
  );
  const sloops = useMemo(
    () => (isGlobal ? null : somersloopUsage(graph, gameData)),
    [graph, isGlobal],
  );
  const rawInputs = useMemo(
    () => (isGlobal ? globalRawInputs(graph, gameData, resolver) : null),
    [graph, resolver, isGlobal],
  );
  const finalOutputs = useMemo(
    () => (isGlobal ? globalFinalOutputs(graph, gameData, resolver) : null),
    [graph, resolver, isGlobal],
  );
  const projectSurplus = useMemo(
    () => (isGlobal ? globalSurplus(graph, gameData, resolver) : null),
    [graph, resolver, isGlobal],
  );
  const sinkPointsPerMin = useMemo(
    () => (isGlobal ? globalSinkPoints(graph, gameData, resolver) : 0),
    [graph, resolver, isGlobal],
  );

  const machineTotal = machines ? totalMachineCount(machines) : 0;
  const issueCount = issues?.length ?? 0;

  const handleClose = () => {
    if (activeProjectId) setInfoPanelOpen(activeProjectId, false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-panel-hi px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="h-4 w-4 text-accent" />
          {isGlobal ? 'Project overview' : 'Factory overview'}
        </div>
        <button
          onClick={handleClose}
          title="Close info panel"
          className="rounded p-1 text-[#9aa2b8] hover:bg-panel hover:text-[#e6e8ee]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs">
        <span className="font-medium tabular-nums text-amber-400">
          {formatPower(power.consumptionMW)}
        </span>
        {!isGlobal && machines && (
          <>
            <span className="text-[#6b7388]">·</span>
            <span className="tabular-nums text-[#e6e8ee]">
              {machineTotal} {machineTotal === 1 ? 'machine' : 'machines'}
            </span>
          </>
        )}
        {issueCount > 0 && (
          <>
            <span className="text-[#6b7388]">·</span>
            <span className="font-medium text-red-400">
              {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <CollapsibleSection id="power" title="Power" defaultOpen={false}>
          <PowerSection summary={power} />
        </CollapsibleSection>

        {isGlobal ? (
          rawInputs &&
          finalOutputs &&
          projectSurplus && (
            <GlobalSection
              rawInputs={rawInputs}
              finalOutputs={finalOutputs}
              surplus={projectSurplus}
              sinkPointsPerMin={sinkPointsPerMin}
              gameData={gameData}
            />
          )
        ) : (
          <>
            {io && (
              <CollapsibleSection
                id="io"
                title={io.source === 'ports' ? 'Material flow' : 'Material flow (net)'}
                defaultOpen
                trailing={
                  io.surplus.size > 0
                    ? `${io.outputs.size} out · ${io.inputs.size} in · ${io.surplus.size} surplus`
                    : `${io.outputs.size} out · ${io.inputs.size} in`
                }
              >
                <IOSection summary={io} gameData={gameData} />
              </CollapsibleSection>
            )}
            {machines && machines.length > 0 && (
              <CollapsibleSection
                id="machines"
                title="Machines"
                defaultOpen={false}
                trailing={`${machineTotal} total`}
              >
                <MachinesSection groups={machines} gameData={gameData} />
              </CollapsibleSection>
            )}
            {sloops && sloops.usage.length > 0 && (
              <CollapsibleSection
                id="somersloops"
                title="Somersloops"
                defaultOpen
                trailing={`${sloops.totalSloops} in ${sloops.machineCount} ${
                  sloops.machineCount === 1 ? 'machine' : 'machines'
                }`}
              >
                <SomersloopSection
                  usage={sloops.usage}
                  graphId={activeGraphId}
                  gameData={gameData}
                />
              </CollapsibleSection>
            )}
            {graph && issues && issues.length > 0 && (
              <CollapsibleSection
                id="issues"
                title="Issues"
                defaultOpen
                trailing={`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`}
              >
                <IssuesSection
                  issues={issues}
                  graph={graph}
                  graphId={activeGraphId}
                  gameData={gameData}
                />
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
