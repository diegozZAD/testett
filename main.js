const { app, BrowserWindow, BrowserView, Menu } = require('electron');
const path = require('path');

const HEADLESS_FLAG = '--headless';
const isHeadless = process.argv.includes(HEADLESS_FLAG);

let mainWindow;
let browserView;

function logModeStatus() {
  if (isHeadless) {
    console.log('[Headless] Modo headless ATIVADO: a janela principal permanecerá oculta, mas os BrowserViews continuam em execução.');
  } else {
    console.log('[Headless] Modo headless DESATIVADO: a interface será exibida normalmente.');
  }
}

function createWindow() {
  logModeStatus();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !isHeadless,
    frame: !isHeadless,
    skipTaskbar: isHeadless,
    backgroundColor: '#1f1f1f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      `document.body.classList.toggle('headless', ${isHeadless});
       const status = document.getElementById('status');
       if (status) {
         status.textContent = ${isHeadless ? "'Modo headless está ATIVADO.'" : "'Modo headless está DESATIVADO.'"};
       }
       const log = document.getElementById('log');
       if (log) {
         const item = document.createElement('li');
         item.textContent = ${isHeadless ? "'Headless ativo: reiniciado com --headless.'" : "'Headless desativado: reiniciado sem --headless.'"};
         log.appendChild(item);
       }
      `
    );
  });

  if (!isHeadless) {
    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });
  }

  setupBrowserView();

  mainWindow.on('resize', updateBrowserViewBounds);
  mainWindow.on('closed', () => {
    browserView = null;
    mainWindow = null;
  });
}

function setupBrowserView() {
  browserView = new BrowserView({
    webPreferences: {
      partition: 'persist:demo-profile'
    }
  });

  mainWindow.setBrowserView(browserView);
  updateBrowserViewBounds();
  browserView.webContents.loadURL('https://www.youtube.com');
}

function updateBrowserViewBounds() {
  if (!mainWindow || !browserView) {
    return;
  }

  const { width, height } = mainWindow.getContentBounds();
  const headerHeight = 140;

  browserView.setBounds({
    x: 0,
    y: headerHeight,
    width,
    height: Math.max(height - headerHeight, 0)
  });
  browserView.setAutoResize({ width: true, height: true });
}

function toggleHeadless(enable) {
  const args = process.argv.slice(1).filter((arg) => arg !== HEADLESS_FLAG);
  if (enable) {
    args.push(HEADLESS_FLAG);
  }

  const message = enable
    ? '[Headless] Recarregando aplicativo em modo headless.'
    : '[Headless] Recarregando aplicativo em modo com interface.';
  console.log(message);

  app.relaunch({ args });
  app.exit(0);
}

function buildMenu() {
  const template = [
    {
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
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
