const { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Uncomment the block below to disable hardware acceleration before the app is ready.
// if (process.argv.includes('--disable-gpu')) {
//   app.disableHardwareAcceleration();
// }

const SIDEBAR_WIDTH = 260;
const TOPBAR_HEIGHT = 56;
const CONTROL_PANEL_HEIGHT = 220;

const PROFILES_FILENAME = 'profiles.json';
let profilesFilePath;

let mainWindow;
let activeTabId = null;
const tabs = new Map(); // id -> { profile, view }

const defaultUrl = 'https://www.youtube.com';

function ensureProfilesFile() {
  if (!profilesFilePath) {
    profilesFilePath = path.join(app.getPath('userData'), PROFILES_FILENAME);
  }

  try {
    if (!fs.existsSync(profilesFilePath)) {
      fs.writeFileSync(profilesFilePath, JSON.stringify([], null, 2), 'utf-8');
    }
    const raw = fs.readFileSync(profilesFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (error) {
    console.error('Failed to read profiles file:', error);
    return [];
  }
}

function persistProfiles(profiles) {
  if (!profilesFilePath) {
    profilesFilePath = path.join(app.getPath('userData'), PROFILES_FILENAME);
  }
  try {
    fs.writeFileSync(profilesFilePath, JSON.stringify(profiles, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write profiles file:', error);
  }
}

function getProfiles() {
  return ensureProfilesFile();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'YouTube Multi-Session',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log('[Self-Test] 1) Criar aba A (partition A), abrir YouTube, logar; fechar app; reabrir app → sessão A mantida.');
  console.log('[Self-Test] 2) Criar aba B (partition B), abrir outro link do YouTube, logar com outra conta → sessão separada da A.');
  console.log('[Self-Test] 3) “Apagar Sessão desta Aba” limpa apenas a B (A fica intacta).');
  console.log('[Self-Test] 4) Fechar aba não apaga sessão; apenas removê-la do profiles.json quando eu confirmar.');
  console.log('[Self-Test] 5) Redimensionar janela mantém o BrowserView ajustado.');

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    if (activeTabId && tabs.has(activeTabId)) {
      const { view } = tabs.get(activeTabId);
      adjustViewBounds(view);
    }
  });

  mainWindow.on('closed', () => {
    tabs.forEach(({ view }) => {
      view.webContents.removeAllListeners();
    });
    tabs.clear();
    mainWindow = null;
  });
}

function adjustViewBounds(view) {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  view.setBounds({
    x: SIDEBAR_WIDTH,
    y: TOPBAR_HEIGHT + CONTROL_PANEL_HEIGHT,
    width: Math.max(width - SIDEBAR_WIDTH, 0),
    height: Math.max(height - (TOPBAR_HEIGHT + CONTROL_PANEL_HEIGHT), 0)
  });
  view.setAutoResize({ width: true, height: true });
}

function createBrowserView(profile) {
  const view = new BrowserView({
    webPreferences: {
      partition: profile.partition,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (profile.userAgent && profile.userAgent.trim()) {
    view.webContents.setUserAgent(profile.userAgent.trim());
  }

  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const handleNavigation = (event, url) => {
    updateProfile(profile.id, { lastUrl: url });
  };

  view.webContents.on('did-navigate', handleNavigation);
  view.webContents.on('did-navigate-in-page', handleNavigation);

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (mainWindow) {
      mainWindow.webContents.send('tab-error', {
        id: profile.id,
        message: `Falha ao carregar ${validatedURL || 'página'}: ${errorDescription} (${errorCode})`
      });
    }
  });

  if (profile.lastUrl) {
    view.webContents.loadURL(profile.lastUrl).catch((error) => {
      console.error('Failed to load last URL for profile', profile.id, error);
    });
  }

  return view;
}

function attachView(tabId) {
  if (!mainWindow) return;
  const tabData = tabs.get(tabId);
  if (!tabData) return;

  const { view } = tabData;

  if (mainWindow.getBrowserView() === view) {
    adjustViewBounds(view);
    return;
  }

  if (mainWindow.getBrowserView()) {
    mainWindow.setBrowserView(null);
  }

  mainWindow.setBrowserView(view);
  adjustViewBounds(view);
  activeTabId = tabId;
}

function detachActiveView() {
  if (!mainWindow) return;
  const currentView = mainWindow.getBrowserView();
  if (currentView) {
    mainWindow.setBrowserView(null);
  }
  activeTabId = null;
}

function updateProfile(id, updates) {
  const profiles = getProfiles();
  const index = profiles.findIndex((profile) => profile.id === id);
  if (index === -1) return;
  const updatedProfile = { ...profiles[index], ...updates };
  profiles[index] = updatedProfile;
  persistProfiles(profiles);

  if (tabs.has(id)) {
    tabs.get(id).profile = updatedProfile;
  }

  if (mainWindow) {
    mainWindow.webContents.send('profiles-updated', profiles);
  }
}

function createProfile(name, url) {
  const profiles = getProfiles();
  const id = `perfil_${uuidv4()}`;
  const partition = `persist:${id}`; // Persist partition keeps cookies/localStorage isolated per tab.
  const profile = {
    id,
    name: name || 'Nova Aba',
    partition,
    lastUrl: '',
    userAgent: ''
  };
  profiles.push(profile);
  persistProfiles(profiles);
  const view = createBrowserView(profile);
  tabs.set(id, { profile, view });

  if (url) {
    view.webContents.loadURL(url).catch((error) => {
      console.error('Failed to load initial URL for profile', id, error);
    });
    updateProfile(id, { lastUrl: url });
  }

  attachView(id);
  if (mainWindow) {
    mainWindow.webContents.send('profiles-updated', profiles);
  }
  return profile;
}

function removeProfile(id) {
  const profiles = getProfiles();
  const filtered = profiles.filter((profile) => profile.id !== id);
  persistProfiles(filtered);
  if (tabs.has(id)) {
    const { view } = tabs.get(id);
    if (mainWindow && mainWindow.getBrowserView() === view) {
      detachActiveView();
    }
    view.webContents.removeAllListeners();
    view.destroy(); // BrowserView destruído, mas os dados do partition continuam no disco.
    tabs.delete(id);
  }
  if (mainWindow) {
    mainWindow.webContents.send('profiles-updated', filtered);
  }
  if (!activeTabId && filtered.length > 0) {
    attachView(filtered[0].id);
  }
}

function clearProfileSession(id) {
  const profile = getProfiles().find((p) => p.id === id);
  if (!profile) return;
  const targetSession = session.fromPartition(profile.partition);
  return targetSession.clearStorageData({}).then(() => {
    targetSession.clearCache().catch(() => {});
    updateProfile(id, { lastUrl: '' });
  });
}

async function ensureTab(id) {
  if (!tabs.has(id)) {
    const profile = getProfiles().find((p) => p.id === id);
    if (!profile) return null;
    const view = createBrowserView(profile);
    tabs.set(id, { profile, view });
  }
  return tabs.get(id);
}

app.whenReady().then(() => {
  profilesFilePath = path.join(app.getPath('userData'), PROFILES_FILENAME);
  const profiles = getProfiles();

  createMainWindow();

  profiles.forEach((profile) => {
    const view = createBrowserView(profile);
    tabs.set(profile.id, { profile, view });
  });

  if (profiles.length > 0) {
    attachView(profiles[0].id);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-profiles', async () => {
  return getProfiles();
});

ipcMain.handle('create-profile', async (event, { name, url }) => {
  return createProfile(name, url || defaultUrl);
});

ipcMain.handle('rename-profile', async (event, { id, name }) => {
  updateProfile(id, { name });
  return getProfiles();
});

ipcMain.handle('activate-profile', async (event, id) => {
  const tab = await ensureTab(id);
  if (!tab) return null;
  attachView(id);
  return id;
});

ipcMain.handle('close-profile', async (event, id) => {
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancelar', 'Fechar Aba'],
    defaultId: 1,
    cancelId: 0,
    title: 'Fechar Aba',
    message: 'Fechar esta aba? A sessão permanecerá salva nesta partição.'
  });
  if (response.response === 1) {
    removeProfile(id);
  }
  return getProfiles();
});

ipcMain.handle('navigate-profile', async (event, { id, url }) => {
  const tabData = await ensureTab(id);
  if (!tabData) return;
  try {
    await tabData.view.webContents.loadURL(url);
    updateProfile(id, { lastUrl: url });
  } catch (error) {
    console.error('Failed navigation request for', id, error);
    if (mainWindow) {
      mainWindow.webContents.send('tab-error', {
        id,
        message: `Falha ao navegar: ${error.message}`
      });
    }
  }
});

ipcMain.handle('clear-profile-session', async (event, id) => {
  await clearProfileSession(id);
  if (mainWindow) {
    mainWindow.webContents.send('session-cleared', id);
  }
  return getProfiles();
});

ipcMain.handle('set-profile-user-agent', async (event, { id, userAgent }) => {
  updateProfile(id, { userAgent });
  if (tabs.has(id)) {
    const { view } = tabs.get(id);
    if (userAgent && userAgent.trim()) {
      view.webContents.setUserAgent(userAgent.trim());
    } else {
      view.webContents.setUserAgent('');
    }
  }
  return getProfiles();
});

ipcMain.handle('show-tab-context-menu', async (event, id) => {
  const template = [
    {
      label: 'Apagar Sessão desta Aba',
      click: () => {
        clearProfileSession(id).then(() => {
          if (mainWindow) {
            mainWindow.webContents.send('session-cleared', id);
          }
        });
      }
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});
