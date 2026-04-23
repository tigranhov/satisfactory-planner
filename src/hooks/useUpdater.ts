import { useEffect, useState } from 'react';
import type { UpdaterStatus } from '../../electron/updater';

export type { UpdaterStatus };

// Mirrors the main-process auto-updater status. Subscribes on mount; no-ops
// in non-Electron environments.
export function useUpdater(): UpdaterStatus {
  const [status, setStatus] = useState<UpdaterStatus>({ phase: 'idle' });

  useEffect(() => {
    const api = window.api;
    if (!api?.isElectron) return;
    let cancelled = false;
    // Subscribe first so we don't miss broadcasts that arrive while the
    // getStatus IPC round-trip is in flight. The fetched snapshot only wins
    // if nothing has been broadcast yet (phase still === 'idle').
    const off = api.onUpdaterStatus((s) => {
      if (!cancelled) setStatus(s);
    });
    void api.getUpdaterStatus().then((s) => {
      if (cancelled) return;
      setStatus((prev) => (prev.phase === 'idle' ? s : prev));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return status;
}
