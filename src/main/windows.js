const path = require("path");
const { BrowserWindow, screen, globalShortcut, nativeImage } = require("electron");

let mainWindow = null;
let configWindow = null;

const ICON_ICO = path.join(__dirname, "../../assets/logo/LogoCircular.ico");
const ICON_PNG = path.join(__dirname, "../../assets/logo/LogoCircular.png");
const FALLBACK = path.join(__dirname, "../../assets/logo/LogoCircular.ico");

function trayIcon() {
  const candidates = [ICON_ICO, ICON_PNG, FALLBACK];
  for (const p of candidates) {
    let img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      // Fuerza tamaño de bandeja (evita que Windows re-escale de más y se vea borroso)
      img = img.resize({ width: 16, height: 16, quality: "best" });
      return img;
    }
  }
  return null;
}

module.exports = {
  createMainWindow,
  createConfigWindow,
  getMainWindow,
  getConfigWindow,
  getIconPath,
  setWindowIcon
};

function getIconPath() {
  const img = nativeImage.createFromPath(ICON_ICO);
  if (!img.isEmpty()) return ICON_ICO;
  return ICON_PNG;
}

function setWindowIcon() {
  const img = nativeImage.createFromPath(ICON_PNG);
  if (img.isEmpty()) return;
  if (mainWindow) mainWindow.setIcon(img);
  if (configWindow) configWindow.setIcon(img);
}

function createMainWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 320;
  const winH = 340;

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: screenW - winW - 40,
    y: screenH - winH - 40,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: false,
    hasShadow: false,
    icon: getIconPath(), // Ícono de la ventana principal
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.setMenuBarVisibility(false);

  // Consola/DevTools deshabilitadas para el usuario final
  mainWindow.webContents.on("devtools-opened", () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.on("blur", () => {
    if (mainWindow) mainWindow.moveAbove && mainWindow.moveAbove;
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return configWindow;
  }

  configWindow = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    resizable: true,
    title: "Configuración - Noxis",
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/configPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      sandbox: false
    }
  });

  configWindow.setMenuBarVisibility(false);
  configWindow.loadFile(path.join(__dirname, "../renderer/config.html"));

  // Consola/DevTools deshabilitadas para el usuario final
  configWindow.webContents.on("devtools-opened", () => {
    configWindow.webContents.closeDevTools();
  });

  configWindow.on("closed", () => {
    configWindow = null;
  });

  return configWindow;
}

function getMainWindow() {
  return mainWindow;
}

function getConfigWindow() {
  return configWindow;
}
