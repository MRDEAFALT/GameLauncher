// ----- Imports -----
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ====== EDIT THIS to your Games directory ======
const baseDir = 'C:\\Users\\Jackson\\Desktop\\GameLauncher\\Games';
// ===============================================

// ----- Single-instance guard (prevents 2 launchers) -----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => {
  if (global.mainWindow) {
    if (global.mainWindow.isMinimized()) global.mainWindow.restore();
    global.mainWindow.focus();
  }
});

// ----- Globals -----
global.mainWindow = null;
let activeGameProcess = null;   // for .exe games
let activeGameWindow  = null;   // for web games (BrowserWindow)
let activeGameName    = null;

// ----- Config (favorites, etc.) -----
const CONFIG_PATH = path.join(app.getPath('userData'), 'game-launcher-config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { favorites: [] }; }
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ----- Main window -----
function createWindow() {
  global.mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  global.mainWindow.loadFile('index.html');
}

// ----- Status → renderer -----
function sendStatus() {
  if (!global.mainWindow) return;
  global.mainWindow.webContents.send('game-status', {
    running: !!(activeGameProcess || activeGameWindow),
    name: activeGameName || null,
  });
}

// ----- Auto-updater wiring -----
function wireUpdater() {
  function sendUpdate(channel, payload = {}) {
    if (global.mainWindow) global.mainWindow.webContents.send(channel, payload);
  }
  autoUpdater.on('checking-for-update', () => sendUpdate('upd:status', { state: 'checking' }));
  autoUpdater.on('update-available',    (info) => sendUpdate('upd:status', { state: 'available', info }));
  autoUpdater.on('update-not-available',() => sendUpdate('upd:status', { state: 'none' }));
  autoUpdater.on('download-progress',   (p)    => sendUpdate('upd:progress', p));
  autoUpdater.on('update-downloaded',   ()     => sendUpdate('upd:status', { state: 'ready' }));
  autoUpdater.on('error',               (e)    => sendUpdate('upd:status', { state: 'error', message: e?.message }));

  // 🔒 Force-close the app before installing the update (prevents “close app manually” dialog)
  autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall(false, true);
    app.quit();
  });

  ipcMain.on('upd:installNow', () => autoUpdater.quitAndInstall(false, true));
}

// ----- App ready -----
app.whenReady().then(() => {
  createWindow();
  wireUpdater();

  // Give UI a moment to paint, then check for updates
  setTimeout(() => {
    try { autoUpdater.checkForUpdatesAndNotify(); } catch {}
  }, 5000);
});

// ----- Detect how to launch a given game folder -----
function detectGameKind(folderPath) {
  // Returns { kind: 'exe' | 'web-local' | 'web-remote' | 'unknown', target: string|null }
  try {
    const files = fs.readdirSync(folderPath);

    // (A) Any HTML at top level
    const htmlTop = files.find(f => f.toLowerCase().endsWith('.html'));
    if (htmlTop) return { kind: 'web-local', target: path.join(folderPath, htmlTop) };

    // (B) index.html inside common subfolders
    const subDirs = ['web', 'www', 'build', 'dist', 'public'];
    for (const dir of subDirs) {
      const p = path.join(folderPath, dir, 'index.html');
      if (fs.existsSync(p)) return { kind: 'web-local', target: p };
    }

    // (C) .url shortcut
    const urlFile = files.find(f => f.toLowerCase().endsWith('.url'));
    if (urlFile) {
      try {
        const ini = fs.readFileSync(path.join(folderPath, urlFile), 'utf8');
        const m = ini.match(/^\s*URL\s*=\s*(.+)\s*$/im);
        if (m) return { kind: 'web-remote', target: m[1].trim() };
      } catch {}
    }

    // (D) First .exe
    const exe = files.find(f => f.toLowerCase().endsWith('.exe'));
    if (exe) return { kind: 'exe', target: path.join(folderPath, exe) };

  } catch {}
  return { kind: 'unknown', target: null };
}

// ----- IPC: status -----
ipcMain.handle('getStatus', async () => ({
  running: !!(activeGameProcess || activeGameWindow),
  name: activeGameName || null,
}));

// ----- IPC: list games (with favorites & cover) -----
ipcMain.handle('getGames', async () => {
  const cfg = readConfig();
  if (!fs.existsSync(baseDir)) return [];

  const folders = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const folderPath = path.join(baseDir, d.name);
      let image = null;
      try {
        const files = fs.readdirSync(folderPath);
        const prefer = /(icon|cover|logo|banner|thumb|thumbnail|splash)/i;
        const isImg  = /\.(png|jpe?g|webp|gif|bmp|ico)$/i;
        let imageFile = files.find(f => prefer.test(f) && isImg.test(f));
        if (!imageFile) imageFile = files.find(f => isImg.test(f));
        if (imageFile) image = path.join(folderPath, imageFile);
      } catch {}
      return {
        name: d.name,
        image,
        isFavorite: (cfg.favorites || []).includes(d.name),
        absPath: folderPath,
      };
    });

  folders.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return folders;
});

// ----- IPC: toggle favorite -----
ipcMain.handle('toggleFavorite', async (_e, gameName) => {
  const cfg = readConfig();
  cfg.favorites = cfg.favorites || [];
  const i = cfg.favorites.indexOf(gameName);
  if (i >= 0) cfg.favorites.splice(i, 1);
  else cfg.favorites.push(gameName);
  writeConfig(cfg);
  return { ok: true, favorites: cfg.favorites };
});

// ----- IPC: import ZIP -----
ipcMain.handle('importZip', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Select a game ZIP',
    properties: ['openFile'],
    filters: [{ name: 'ZIP archives', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePaths?.[0]) return { ok: false, reason: 'canceled' };

  const zipPath = res.filePaths[0];
  const baseName = path.basename(zipPath, path.extname(zipPath)).trim();
  fs.mkdirSync(baseDir, { recursive: true });

  // Unique output folder
  let outDir = path.join(baseDir, baseName);
  let n = 1;
  while (fs.existsSync(outDir)) {
    n += 1;
    outDir = path.join(baseDir, `${baseName} (${n})`);
  }

  const ps = spawn('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${outDir}"`
  ], { windowsHide: true });

  return await new Promise((resolve) => {
    let stderr = '';
    ps.stderr.on('data', d => { stderr += d.toString(); });
    ps.on('close', (code) => {
      if (code === 0 && fs.existsSync(outDir)) resolve({ ok: true, folder: outDir });
      else resolve({ ok: false, reason: stderr || `Expand-Archive exit code ${code}` });
    });
  });
});

// ----- IPC: remove game (NEW) -----
ipcMain.handle('removeGame', async (_e, gameName) => {
  try {
    if (!gameName) return { ok: false, reason: 'No game name' };
    // If the game is running, block delete
    if (activeGameName === gameName && (activeGameProcess || activeGameWindow)) {
      return { ok: false, reason: 'Game is running. Stop it first.' };
    }
    const targetDir = path.join(baseDir, gameName);
    if (!fs.existsSync(targetDir)) return { ok: false, reason: 'Game folder not found' };

    // Remove from favorites config
    const cfg = readConfig();
    cfg.favorites = (cfg.favorites || []).filter(n => n !== gameName);
    writeConfig(cfg);

    // Delete the folder recursively
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message || 'Delete failed' };
  }
});

// ----- IPC: launch game (single-instance; exe or web) -----
ipcMain.on('launchGame', (_evt, gameName) => {
  if (activeGameProcess || activeGameWindow) { sendStatus(); return; }

  const gamePath = path.join(baseDir, gameName);
  const { kind, target } = detectGameKind(gamePath);
  if (!target) return;

  activeGameName = gameName;
  sendStatus();

  if (kind === 'exe') {
    const child = execFile(target, { cwd: gamePath }, (err) => {
      if (err) console.error('Game exit error:', err.message);
    });
    activeGameProcess = child;
    child.on('close', () => {
      activeGameProcess = null;
      activeGameName = null;
      sendStatus();
    });
    return;
  }

  if (kind === 'web-local' || kind === 'web-remote') {
    activeGameWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      title: activeGameName,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        webSecurity: false,
        allowRunningInsecureContent: false,
      }
    });

    if (kind === 'web-local') activeGameWindow.loadFile(target);
    else activeGameWindow.loadURL(target);

    activeGameWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    activeGameWindow.on('closed', () => {
      activeGameWindow = null;
      activeGameName = null;
      sendStatus();
    });
    return;
  }
});

// ----- IPC: stop game -----
ipcMain.on('stopGame', () => {
  if (activeGameProcess) { try { activeGameProcess.kill(); } catch {} }
  else if (activeGameWindow) { try { activeGameWindow.close(); } catch {} }
});

// ----- Quit when main window closes (Windows style) -----
app.on('window-all-closed', () => app.quit());
