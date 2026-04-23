import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#161a22',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function blueprintsFilePath() {
  return join(app.getPath('userData'), 'blueprints.json');
}

function registerIpcHandlers() {
  ipcMain.handle('project:save', async (_event, _payload: unknown) => {
    throw new Error('not implemented');
  });
  ipcMain.handle('project:load', async () => {
    throw new Error('not implemented');
  });
  ipcMain.handle('project:listRecent', async () => {
    throw new Error('not implemented');
  });

  ipcMain.handle('blueprints:load', async () => {
    const file = blueprintsFilePath();
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.blueprints)) {
        return parsed.blueprints as unknown[];
      }
      return [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      // Bad JSON or unreadable — surface to renderer as empty rather than crash.
      console.error('[blueprints:load]', err);
      return [];
    }
  });

  ipcMain.handle('blueprints:save', async (_event, blueprints: unknown[]) => {
    const file = blueprintsFilePath();
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const payload = JSON.stringify({ version: 1, blueprints }, null, 2);
    await fs.writeFile(file, payload, 'utf8');
  });
}
