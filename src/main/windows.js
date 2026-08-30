// Noxis
// Copyright (C) 2026 Norvyz
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

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
  const winW = 320;
  const winH = 340;
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
