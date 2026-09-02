import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createLogger } from './logger';
import { registerIpc } from './ipc';

const isDev = !app.isPackaged;

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    await window.loadURL('http://localhost:5173');
  } else {
    // tsconfig.electron.json has rootDir ".", so this file compiles to
    // dist-electron/electron/main.js — two levels below the project root,
    // where SvelteKit's adapter-static output lives in build/.
    await window.loadFile(path.join(__dirname, '../../build/index.html'));
  }

  return window;
}

app.whenReady().then(async () => {
  const logger = createLogger(app.getPath('userData'));
  const window = await createWindow();
  registerIpc({ userDataDir: app.getPath('userData'), window, logger });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
