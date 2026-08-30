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

// src/main/main.js
// Punto de entrada. Equivalente a App.xaml.cs + MainWindow.xaml.cs (parte "orquestadora")

const { app, ipcMain, dialog, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const windows = require("./windows");
const { createTray } = require("./tray");

const configService = require("../services/configService");
const packService = require("../services/packService");
const conversationService = require("../services/conversationService");
const voskService = require("../services/voskService");

app.commandLine.appendSwitch("enable-features", "SpeechRecognition");
app.commandLine.appendSwitch("no-sandbox");

// Fijar carpeta de datos en "Noxis" (por si veníamos de "Momo")
const dataDir = path.join(app.getPath("appData"), "Noxis");
const legacyDir = path.join(app.getPath("appData"), "Momo");
if (fs.existsSync(legacyDir) && !fs.existsSync(dataDir)) {
  try {
    fs.renameSync(legacyDir, dataDir);
    console.log("[MAIN] Datos migrados de Momo → Noxis");
  } catch (err) {
    console.error("[MAIN] Error migrando datos:", err.message);
  }
}
app.setPath("userData", dataDir);

let config = null;
let voskServiceStart = null;   // promise que resuelve cuando el servidor/modelo está listo
let voiceState = "active"; // "active" | "dormant"

function reloadConfig() {
  config = configService.load();
  return config;
}

app.whenReady().then(() => {
  reloadConfig();

  // Permite getUserMedia (necesario para listar/usar el micrófono en la
  // ventana de configuración). Sin esto Electron puede bloquear el acceso.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return permission === "media";
  });

  windows.createMainWindow(config);
  createTray();

  if (config.autoStart) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  // Iniciar servidor de modelo Vosk en background (sin auto-descarga:
  // el usuario elige el modelo en Configuración). El promise se guarda
  // para que el renderer pueda esperar la URL sin condiciones de carrera.
  voskServiceStart = voskService.start(config.voiceModel)
    .then((url) => {
      console.log("[MAIN] Vosk model URL:", url);
      return url;
    })
    .catch((err) => {
      console.error("[MAIN] Error iniciando Vosk:", err.message);
      return null;
    });

  setTimeout(async () => {
    const win = windows.getMainWindow();
    if (!win) return;
    await voskServiceStart; // espera a que el servidor/modelo esté listo (o falle)
    if (config.allowMicrophone && !voskService.getModelUrl()) {
      win.webContents.send(
        "show-message",
        "Ahora mismo no puedo escucharte 🔊 Para configurarlo entra a Configuración: con click derecho sobre mí, o con la flechita ↑ de la barra de tareas (ícono de Noxis) → Configuración. Ahí puedes descargar el modelo de voz."
      );
    } else {
      win.webContents.send(
        "show-message",
        `¡Hola! Soy ${config.name} 👋 Háblame normal, o di mi nombre para abrir apps.`
      );
    }
  }, 900);

  app.on("activate", () => {
    if (!windows.getMainWindow()) windows.createMainWindow(config);
  });
});

app.on("window-all-closed", () => {
  // Noxis vive en la bandeja; no cerramos la app al cerrar la ventana.
  if (process.platform !== "darwin") {
    // en Windows/Linux dejamos correr por el tray, no llamamos app.quit()
  }
});

// ---------------------------------------------------------------
// IPC: ventana principal (widget)
// ---------------------------------------------------------------

ipcMain.handle("get-response", async (event, rawText) => {
  const win = windows.getMainWindow();
  console.log("[MAIN] get-response:", rawText, "| estado:", voiceState);

  const hasWake = conversationService.isWakeWordDetected(rawText, config);

  // 1) "Noxis desactívate" (o similar) → modo dormida
  if (hasWake && conversationService.isDeactivateCommand(rawText, config)) {
    voiceState = "dormant";
    win?.webContents.send("voice-state", "dormant");
    console.log("[MAIN] → modo dormida");
    return "Ok, dejo de escuchar 💤 Llámame por mi nombre para activarme.";
  }

  // 2) Dormida: solo reacciona al nombre, todo lo demás es silencio
  if (voiceState === "dormant") {
    if (!hasWake) {
      console.log("[MAIN] dormida + sin nombre → silencio");
      return "";
    }
    voiceState = "active";
    win?.webContents.send("voice-state", "active");
    console.log("[MAIN] → despertó con nombre");
    // Si además pide "volver/despertar/escuchar", confirma con un mensaje claro
    if (conversationService.isWakeCommand(rawText, config)) {
      return conversationService.getWakeResponse(config);
    }
  }

  // 3) Saber si se mencionó el nombre (para permitir abrir apps)
  let text = rawText.trim();
  if (hasWake) {
    text = conversationService.stripWakeWord(rawText, config);
    console.log("[MAIN] Texto tras stripWakeWord:", text);
  }

  // 4) Comandos de apps/grupos SOLO si se mencionó el nombre
  if (hasWake) {
    const packResponse = await packService.handleCommand(text, config, (msg) => {
      win?.webContents.send("show-message", msg);
    });
    if (packResponse !== null) {
      console.log("[MAIN] Respuesta de pack:", packResponse);
      return packResponse;
    }
  }

  // 5) Conversación normal (con o sin nombre)
  const response = conversationService.getConversationalResponse(text, config);
  if (response) {
    console.log("[MAIN] Respuesta conversacional:", response);
    return response;
  }

  // 6) Sin patrón: si la llamaron por nombre hay feedback; si no, silencio
  if (hasWake) {
    return conversationService.getNamedFallback();
  }
  console.log("[MAIN] Sin nombre y sin patrón → silencio");
  return "";
});

ipcMain.handle("open-config-window", () => {
  windows.createConfigWindow();
});

// Arrastre del widget: mueve la ventana a la posición del cursor.
// X/Y son coordenadas de pantalla; offsetX/offsetY = dónde se agarró la
// imagen respecto a la esquina superior de la ventana.
ipcMain.handle("drag-window", (event, screenX, screenY, offsetX, offsetY) => {
  const win = windows.getMainWindow();
  if (!win) return;
  win.setPosition(Math.round(screenX - offsetX), Math.round(screenY - offsetY));
});

ipcMain.handle("get-skin-path", () => config.skinPath);
ipcMain.handle("get-noxis-name", () => config.name);
ipcMain.handle("get-mic-enabled", () => !!config.allowMicrophone);
ipcMain.handle("get-selected-mic-id", () => config.selectedMicrophoneId || null);
ipcMain.handle("get-vosk-model-url", () => voskService.getModelUrl());
ipcMain.handle("get-vosk-status", () => voskService.getStatus());
ipcMain.handle("model:get-info", () => ({
  models: voskService.getModelInfo(),
  active: voskService.getActiveType()
}));

// Activa el modelo de voz (descargado o no) y avisa al widget
ipcMain.handle("model:set-active", (event, type) => {
  if (type !== "small") return false;
  config.voiceModel = type;
  configService.save(config);
  voskService.setActiveType(type);
  windows.getMainWindow()?.webContents.send("config-updated", config);
  return true;
});

// Descarga un modelo en background; el progreso llega por "vosk-status"
ipcMain.handle("model:download", (event, type) => {
  if (type !== "small") return false;
  Promise.resolve(voskService.download(type)).catch((err) => {
    console.error("[MAIN] Error descargando modelo:", err.message);
  });
  return true;
});

// ---------------------------------------------------------------
// IPC: ventana de configuración
// ---------------------------------------------------------------

// Vocabulario/gramática para el recognizer de Vosk (mejora la precisión)
ipcMain.handle("grammar:get", () => conversationService.buildGrammar(config));

ipcMain.handle("config:get", () => reloadConfig());

// Re-aplica las preferencias de ventana del widget (siempre encima,
// mostrar en taskbar) cada vez que cambia la configuración.
function applyWindowSettings(cfg) {
  const win = windows.getMainWindow();
  if (!win) return;
  win.setAlwaysOnTop(!!cfg.alwaysOnTop);
  win.setSkipTaskbar(!cfg.showInTaskbar);
}

ipcMain.handle("config:save", (event, newConfig) => {
  config = newConfig;
  const ok = configService.save(config);
  if (ok) {
    app.setLoginItemSettings({ openAtLogin: !!config.autoStart });
    if (config.voiceModel && config.voiceModel !== voskService.getActiveType()) {
      voskService.setActiveType(config.voiceModel);
    }
    applyWindowSettings(config);
    windows.getMainWindow()?.webContents.send("config-updated", config);
  }
  return ok;
});

ipcMain.handle("config:choose-skin", async () => {
  const win = windows.getConfigWindow();
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg", "gif"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("config:choose-executable", async () => {
  const win = windows.getConfigWindow();
  const result = await dialog.showOpenDialog(win, {
    filters: [
      { name: "Ejecutables", extensions: ["exe", "bat", "cmd", "ps1", "lnk"] },
      { name: "Todos los archivos", extensions: ["*"] }
    ],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("config:reset", () => {
  const fresh = require("../models/defaultConfig").createDefaultConfig();
  config = fresh;
  configService.save(config);
  applyWindowSettings(config);
  windows.getMainWindow()?.webContents.send("config-updated", config);
  return true;
});

ipcMain.handle("config:get-path", () => {
  return configService.getConfigPath();
});

// Abre un enlace externo en el navegador del sistema (no dentro de la app)
ipcMain.handle("open-external", (event, url) => {
  if (typeof url !== "string") return false;
  // Solo permitimos http/https (evita abrir rutas locales o protocolos raros)
  if (!/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});
