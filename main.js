const { app, BrowserWindow, BrowserView, Menu, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const HEADLESS_FLAG = '--headless';

// Desativa a GPU automaticamente no modo headless (e quando a flag --disable-gpu
// for usada manualmente). Precisa ser feito antes do app ficar pronto.
if (process.argv.includes(HEADLESS_FLAG) || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
}
const DEFAULT_URL = 'https://www.youtube.com';
const PROFILE_PREFIX = 'persist:perfil_';
const LAYOUT_SCRIPT = `(() => {
  const placeholder = document.querySelector('.browser-placeholder');
  if (!placeholder) {
    return null;
  }
  const rect = placeholder.getBoundingClientRect();
  return {
    x: Math.floor(rect.left),
    y: Math.floor(rect.top),
    width: Math.floor(rect.width),
    height: Math.floor(rect.height)
  };
})()`;

const isHeadless = process.argv.includes(HEADLESS_FLAG);

let mainWindow;
let profilesPath;
let profiles = [];
let activeProfileId = null;
let attachedView = null;
let boundsUpdateTimer = null;

const profileViews = new Map();
const configuredPartitions = new Set();

function logHeadlessStatus() {
  if (isHeadless) {
    console.log('[Headless] Modo headless ATIVADO: todas as janelas permanecerão ocultas, mas os BrowserViews continuam carregando normalmente.');
  } else {
    console.log('[Headless] Modo headless DESATIVADO: a interface completa será exibida.');
  }
}

function logSelfTestChecklist() {
  console.log('[Auto-teste] Checklist rápido para validar as sessões persistentes:');
  console.log('  1. Criar aba A, abrir YouTube, logar; fechar app; reabrir → sessão A mantida.');
  console.log('  2. Criar aba B, abrir outro link, logar com outra conta → sessões isoladas.');
  console.log('  3. Apagar sessão apenas da aba B → sessão A permanece intacta.');
  console.log('  4. Fechar aba não apaga a sessão do disco; apenas remove a entrada de profiles.json após confirmação.');
  console.log('  5. Redimensionar a janela mantém o BrowserView ajustado ao espaço da interface.');
}

function ensureProfilesFile() {
  profilesPath = path.join(app.getPath('userData'), 'profiles.json');
  fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
  if (!fs.existsSync(profilesPath)) {
    fs.writeFileSync(profilesPath, '[]', 'utf8');
  }
}

function loadProfilesFromDisk() {
  try {
    const raw = fs.readFileSync(profilesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((profile) => ({
        id: profile.id || randomUUID(),
        name: profile.name || 'Nova Aba',
        partition: profile.partition || `${PROFILE_PREFIX}${profile.id || randomUUID()}`,
        lastUrl: profile.lastUrl || '',
        userAgent: profile.userAgent || ''
      }));
    }
  } catch (error) {
    console.error('Falha ao carregar profiles.json. Um novo arquivo vazio será utilizado.', error);
  }
  return [];
}

function persistProfiles() {
  try {
    fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf8');
  } catch (error) {
    console.error('Não foi possível salvar profiles.json:', error);
  }
}

function sendProfilesUpdate() {
  if (mainWindow?.webContents?.isDestroyed()) {
    return;
  }
  mainWindow?.webContents.send('profiles-updated', profiles);
}

function sendRuntimeOptions() {
  if (mainWindow?.webContents?.isDestroyed()) {
    return;
  }
  mainWindow?.webContents.send('runtime-options', { headless: isHeadless });
}

function sendTabError(id, message) {
  console.warn(`[Tab ${id}] ${message}`);
  if (mainWindow?.webContents?.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('tab-error', { id, message });
}

function sendSessionCleared(id) {
  if (mainWindow?.webContents?.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('session-cleared', id);
}

function sanitizeUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return DEFAULT_URL;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function getProfileById(id) {
  return profiles.find((profile) => profile.id === id) || null;
}

function configurePartition(partition) {
  if (configuredPartitions.has(partition)) {
    return session.fromPartition(partition, { cache: true });
  }
  const ses = session.fromPartition(partition, { cache: true });
  configuredPartitions.add(partition);

  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler(() => false);
  }

  if (typeof ses.setDisplayMediaRequestHandler === 'function') {
    ses.setDisplayMediaRequestHandler((_request, callback) => {
      callback({ audio: false, video: false });
    });
  }

  ses.setSpellCheckerLanguages([]);
  if (typeof ses.setCertificateVerifyProc === 'function') {
    ses.setCertificateVerifyProc((request, callback) => {
      callback(-3);
      const viewEntry = [...profileViews.entries()].find(([, candidate]) => candidate.webContents.id === request.webContentsId);
      if (viewEntry) {
        const [profileId] = viewEntry;
        sendTabError(profileId, `Certificado rejeitado ao acessar ${request.url}.`);
      }
    });
  }
  return ses;
}

function createBrowserViewForProfile(profile) {
  configurePartition(profile.partition);
  const view = new BrowserView({
    webPreferences: {
      partition: profile.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  view.webContents.setAudioMuted(isHeadless);
  view.webContents.setBackgroundThrottling(false);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  view.webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) {
      updateProfile(profile.id, { lastUrl: url });
    }
  });

  view.webContents.on('did-navigate', (_event, url) => {
    updateProfile(profile.id, { lastUrl: url });
  });

  view.webContents.on('did-redirect-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) {
      updateProfile(profile.id, { lastUrl: url });
    }
  });

  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }
    const failedUrl = validatedURL || profile.lastUrl || DEFAULT_URL;
    sendTabError(profile.id, `Falha ao carregar ${failedUrl}: ${errorDescription} (${errorCode}).`);
  });

  view.webContents.on('render-process-gone', (_event, details) => {
    sendTabError(profile.id, `Processo do YouTube foi finalizado (${details.reason}). Recarregue a aba se necessário.`);
  });

  profileViews.set(profile.id, view);
  return view;
}

function getBrowserView(profile) {
  if (profileViews.has(profile.id)) {
    return profileViews.get(profile.id);
  }
  return createBrowserViewForProfile(profile);
}

function scheduleBoundsUpdate() {
  if (boundsUpdateTimer) {
    clearTimeout(boundsUpdateTimer);
  }
  boundsUpdateTimer = setTimeout(() => {
    boundsUpdateTimer = null;
    updateBrowserViewBounds().catch((error) => {
      console.error('Falha ao atualizar bounds do BrowserView:', error);
    });
  }, 50);
}

async function updateBrowserViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const view = attachedView;
  if (!view) {
    return;
  }
  try {
    const rect = await mainWindow.webContents.executeJavaScript(LAYOUT_SCRIPT, true);
    if (!rect) {
      return;
    }
    view.setBounds(rect);
    view.setAutoResize({ width: true, height: true });
  } catch (error) {
    if (!mainWindow?.isDestroyed()) {
      throw error;
    }
  }
}

function updateProfile(id, changes, { notify = true } = {}) {
  const profile = getProfileById(id);
  if (!profile) {
    return null;
  }
  Object.assign(profile, changes);
  persistProfiles();
  if (notify) {
    sendProfilesUpdate();
  }
  return profile;
}

async function loadUrlForProfile(profile, url) {
  const targetUrl = sanitizeUrl(url);
  const view = getBrowserView(profile);
  const customAgent = profile.userAgent?.trim();
  try {
    if (customAgent) {
      view.webContents.setUserAgent(customAgent);
      await view.webContents.loadURL(targetUrl, { userAgent: customAgent });
    } else {
      const ses = session.fromPartition(profile.partition, { cache: true });
      view.webContents.setUserAgent(ses.getUserAgent());
      await view.webContents.loadURL(targetUrl);
    }
  } catch (error) {
    sendTabError(profile.id, `Não foi possível navegar para ${targetUrl}: ${error.message}`);
  }
}

async function setActiveProfile(id) {
  const profile = getProfileById(id);
  if (!profile || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  activeProfileId = id;
  const view = getBrowserView(profile);

  if (attachedView !== view) {
    try {
      mainWindow.setBrowserView(view);
    } catch (error) {
      console.error('Falha ao anexar BrowserView:', error);
    }
    attachedView = view;
  }

  const currentUrl = view.webContents.getURL();
  if (!currentUrl || currentUrl === 'about:blank') {
    loadUrlForProfile(profile, profile.lastUrl || DEFAULT_URL);
  }

  scheduleBoundsUpdate();
  return true;
}

async function clearProfileSession(id) {
  const profile = getProfileById(id);
  if (!profile) {
    return false;
  }
  const ses = session.fromPartition(profile.partition, { cache: true });
  try {
    await ses.clearStorageData({});
    await ses.clearCache();
    sendSessionCleared(id);
    console.log(`[Sessões] Armazenamento limpo para ${profile.name || profile.id}.`);
    return true;
  } catch (error) {
    sendTabError(id, `Falha ao limpar a sessão: ${error.message}`);
    return false;
  }
}

async function removeProfile(id, { prompt = true } = {}) {
  const profile = getProfileById(id);
  if (!profile) {
    return false;
  }

  if (prompt && mainWindow && !mainWindow.isDestroyed()) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancelar', 'Fechar Aba'],
      defaultId: 1,
      cancelId: 0,
      title: 'Fechar Aba',
      message: 'Fechar a aba remove a entrada de profiles.json, mas mantém a sessão no disco. Deseja continuar?'
    });
    if (response !== 1) {
      return false;
    }
  }

  const view = profileViews.get(id);
  if (view) {
    if (attachedView === view && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.removeBrowserView(view);
      } catch (error) {
        console.error('Falha ao remover BrowserView ativo:', error);
      }
      attachedView = null;
    }
    profileViews.delete(id);
    try {
      view.destroy();
    } catch (error) {
      console.error('Erro ao destruir BrowserView:', error);
    }
  }

  profiles = profiles.filter((item) => item.id !== id);
  persistProfiles();
  sendProfilesUpdate();

  if (activeProfileId === id) {
    activeProfileId = null;
    if (profiles.length) {
      await setActiveProfile(profiles[0].id);
    }
  }

  return true;
}

function toggleHeadless(enable) {
  const args = process.argv.slice(1).filter((arg) => arg !== HEADLESS_FLAG);
  if (enable) {
    args.push(HEADLESS_FLAG);
    console.log('[Headless] Recarregando aplicativo em modo headless.');
  } else {
    console.log('[Headless] Recarregando aplicativo com interface visível.');
  }
  app.relaunch({ args });
  app.exit(0);
}

function buildMenu() {
  const modeMenu = {
    label: 'Modo',
    submenu: [
      {
        label: 'Ativar Modo Headless',
        enabled: !isHeadless,
        click: () => toggleHeadless(true)
      },
      {
        label: 'Desativar Modo Headless',
        enabled: isHeadless,
        click: () => toggleHeadless(false)
      }
    ]
  };

  const template = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push(modeMenu);
  template.push({ role: 'editMenu' });
  template.push({ role: 'viewMenu' });
  template.push({ role: 'windowMenu' });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow() {
  logHeadlessStatus();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: !isHeadless,
    frame: !isHeadless,
    skipTaskbar: isHeadless,
    backgroundColor: '#05060a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (!isHeadless) {
    mainWindow.once('ready-to-show', () => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow.show();
      }
    });
  }

  mainWindow.webContents.once('did-finish-load', () => {
    sendRuntimeOptions();
    sendProfilesUpdate();
    if (!activeProfileId && profiles.length) {
      setActiveProfile(profiles[0].id);
    }
  });

  mainWindow.on('resize', scheduleBoundsUpdate);
  mainWindow.on('move', scheduleBoundsUpdate);

  mainWindow.on('closed', () => {
    mainWindow = null;
    attachedView = null;
  });
}

function handleIpc() {
  ipcMain.handle('get-profiles', () => profiles);

  ipcMain.handle('create-profile', async (_event, payload = {}) => {
    const id = randomUUID();
    const partition = `${PROFILE_PREFIX}${id}`;
    const name = (payload.name || '').trim() || `Perfil ${profiles.length + 1}`;
    const profile = {
      id,
      name,
      partition,
      lastUrl: '',
      userAgent: ''
    };

    profiles.push(profile);
    const initialUrl = sanitizeUrl(payload.url) || DEFAULT_URL;
    profile.lastUrl = initialUrl;
    persistProfiles();
    sendProfilesUpdate();
    loadUrlForProfile(profile, initialUrl);
    return profile;
  });

  ipcMain.handle('rename-profile', (_event, payload = {}) => {
    const { id, name } = payload;
    const profile = updateProfile(id, { name: (name || '').trim() || 'Sem nome' });
    return profile;
  });

  ipcMain.handle('activate-profile', async (_event, id) => {
    const result = await setActiveProfile(id);
    if (result) {
      scheduleBoundsUpdate();
    }
    return result;
  });

  ipcMain.handle('close-profile', async (_event, id) => removeProfile(id, { prompt: true }));

  ipcMain.handle('navigate-profile', async (_event, payload = {}) => {
    const { id, url } = payload;
    const profile = getProfileById(id);
    if (!profile) {
      return false;
    }
    const targetUrl = sanitizeUrl(url);
    updateProfile(id, { lastUrl: targetUrl });
    await loadUrlForProfile(profile, targetUrl);
    return true;
  });

  ipcMain.handle('clear-profile-session', async (_event, id) => clearProfileSession(id));

  ipcMain.handle('set-profile-user-agent', async (_event, payload = {}) => {
    const { id, userAgent } = payload;
    const profile = getProfileById(id);
    if (!profile) {
      return false;
    }
    const trimmed = (userAgent || '').trim();
    updateProfile(id, { userAgent: trimmed });
    const view = profileViews.get(id);
    if (view) {
      if (trimmed) {
        view.webContents.setUserAgent(trimmed);
      } else {
        const ses = session.fromPartition(profile.partition, { cache: true });
        view.webContents.setUserAgent(ses.getUserAgent());
      }
    }
    return true;
  });

  ipcMain.handle('show-tab-context-menu', (_event, id) => {
    const profile = getProfileById(id);
    if (!profile || !mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    const menu = Menu.buildFromTemplate([
      {
        label: 'Apagar Sessão desta Aba',
        click: () => {
          clearProfileSession(id);
        }
      },
      {
        label: 'Fechar Aba',
        click: () => {
          removeProfile(id, { prompt: true });
        }
      }
    ]);
    menu.popup({ window: mainWindow });
    return true;
  });

  ipcMain.handle('get-runtime-options', () => ({ headless: isHeadless }));
}

app.whenReady().then(() => {
  ensureProfilesFile();
  profiles = loadProfilesFromDisk();
  buildMenu();
  createMainWindow();
  handleIpc();
  logSelfTestChecklist();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('certificate-error', (event, webContents, url) => {
  event.preventDefault();
  const entry = [...profileViews.entries()].find(([, view]) => view.webContents === webContents);
  if (entry) {
    const [profileId] = entry;
    sendTabError(profileId, `Certificado inválido bloqueado para ${url}.`);
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

