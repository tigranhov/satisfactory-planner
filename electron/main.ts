import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { setupAutoUpdater } from './updater';

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
  setupAutoUpdater();
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

function projectsDir() {
  return join(app.getPath('userData'), 'projects');
}

function projectIndexPath() {
  return join(projectsDir(), 'index.json');
}

function projectFilePath(id: string) {
  return join(projectsDir(), `${id}.json`);
}

// Guards against path traversal — only ids matching the nanoid shape from
// `lib/ids.ts` (`p_` + 10 chars of nanoid alphabet) touch the filesystem.
const PROJECT_ID_RE = /^p_[A-Za-z0-9_-]{10}$/;

function registerIpcHandlers() {
  ipcMain.handle('projects:loadIndex', async () => {
    const file = projectIndexPath();
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      console.error('[projects:loadIndex]', err);
      return null;
    }
  });

  ipcMain.handle('projects:saveIndex', async (_event, index: unknown) => {
    await fs.mkdir(projectsDir(), { recursive: true });
    await fs.writeFile(projectIndexPath(), JSON.stringify(index, null, 2), 'utf8');
  });

  ipcMain.handle('projects:loadProject', async (_event, id: string) => {
    if (!PROJECT_ID_RE.test(id)) throw new Error(`Invalid project id: ${id}`);
    const file = projectFilePath(id);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      console.error('[projects:loadProject]', err);
      return null;
    }
  });

  ipcMain.handle('projects:saveProject', async (_event, id: string, payload: unknown) => {
    if (!PROJECT_ID_RE.test(id)) throw new Error(`Invalid project id: ${id}`);
    await fs.mkdir(projectsDir(), { recursive: true });
    await fs.writeFile(projectFilePath(id), JSON.stringify(payload, null, 2), 'utf8');
  });

  ipcMain.handle('projects:deleteProject', async (_event, id: string) => {
    if (!PROJECT_ID_RE.test(id)) throw new Error(`Invalid project id: ${id}`);
    try {
      await fs.unlink(projectFilePath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
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
