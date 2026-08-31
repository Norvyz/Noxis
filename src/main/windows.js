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

function createMainWindow(config) {
  config = config || {};
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 460; // antes 320: más ancho para que la burbuja pueda crecer horizontal en vez de hacer scroll
  const winH = 780; // antes 340/430: deja espacio arriba (burbuja) Y abajo de la mascota (chat), ver style.css
  const margin = 40;

  let x = screenW - winW - margin;
  let y = screenH - winH - margin;
  const corner = config.startCorner || "bottom-right";
  if (corner === "bottom-left") {
    x = margin;
    y = screenH - winH - margin;
  } else if (corner === "top-right") {
    x = screenW - winW - margin;
    y = margin;
  } else if (corner === "top-left") {
    x = margin;
    y = margin;
  }

  y = Math.max(margin, y);

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: !config.showInTaskbar,
    alwaysOnTop: !!config.alwaysOnTop,
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
    width: 960,
    height: 640,
    minWidth: 960,
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