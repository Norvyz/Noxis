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

// src/main/tray.js
// Equivalente a InitNotifyIcon() de MainWindow.xaml.cs

const path = require("path");
const { Tray, Menu, app, nativeImage } = require("electron");
const windows = require("./windows");

let tray = null;

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

function createTray() {
  const icon = trayIcon();
  if (!icon) {
    console.error("[Tray] No se encontró un ícono válido para la bandeja");
    return null;
  }
  tray = new Tray(icon);
  tray.setToolTip("Noxis");

  const menu = Menu.buildFromTemplate([
    {
      label: "Configuración",
      click: () => windows.createConfigWindow()
    },
    {
      label: "Mostrar / Ocultar",
      click: () => {
        const win = windows.getMainWindow();
        if (!win) return;
        win.isVisible() ? win.hide() : win.show();
      }
    },
    { type: "separator" },
    {
      label: "Cerrar Noxis",
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(menu);

  tray.on("double-click", () => {
    windows.getMainWindow()?.show();
  });

  return tray;
}

module.exports = { createTray };
