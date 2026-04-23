import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

export type UpdaterStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; releaseNotes?: string }
  | { phase: 'none' }
  | { phase: 'downloading'; percent: number }
  | { phase: 'downloaded'; version: string; releaseNotes?: string }
  | { phase: 'error'; message: string };

let lastStatus: UpdaterStatus = { phase: 'idle' };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function broadcast(status: UpdaterStatus) {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', status);
  }
}

export function setupAutoUpdater() {
  if (!app.isPackaged) {
    ipcMain.handle('updater:getStatus', () => ({ phase: 'idle' }) as UpdaterStatus);
    ipcMain.handle('updater:check', () => ({ phase: 'idle' }) as UpdaterStatus);
    ipcMain.handle('updater:quitAndInstall', () => undefined);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => broadcast({ phase: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    broadcast({
      phase: 'available',
      version: info.version,
      releaseNotes: coerceReleaseNotes(info.releaseNotes),
    }),
  );
  autoUpdater.on('update-not-available', () => broadcast({ phase: 'none' }));
  autoUpdater.on('download-progress', (p) =>
    broadcast({ phase: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({
      phase: 'downloaded',
      version: info.version,
      releaseNotes: coerceReleaseNotes(info.releaseNotes),
    }),
  );
  autoUpdater.on('error', (err) => broadcast({ phase: 'error', message: errorMessage(err) }));

  ipcMain.handle('updater:getStatus', () => lastStatus);

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      broadcast({ phase: 'error', message: errorMessage(err) });
    }
    return lastStatus;
  });

  ipcMain.handle('updater:quitAndInstall', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((err) => {
    broadcast({ phase: 'error', message: errorMessage(err) });
  });
}

function coerceReleaseNotes(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? entry : entry?.note ?? ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return undefined;
}
