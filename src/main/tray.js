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
