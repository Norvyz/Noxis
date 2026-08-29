const { app, ipcMain, dialog, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const windows = require("./windows");
const { createTray } = require("./tray");

const configService = require("../services/configService");
const packService = require("../services/packService");
const conversationService = require("../services/conversationService");
const voskService = require("../services/voskService");
const soundService = require("../services/soundService");

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
let voskServiceStart = null;
let voiceState = "active"; 

function reloadConfig() {
  config = configService.load();
  return config;
}

app.whenReady().then(() => {
  reloadConfig();


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
    await voskServiceStart;
    if (config.allowMicrophone && !voskService.getModelUrl()) {
      win.webContents.send(
        "show-message",
        "Ahora mismo no puedo escucharte 🔊 Para configurarlo entra a Configuración: con click derecho sobre mí, o con la flechita ↑ de la barra de tareas (ícono de Noxis) → Configuración. Ahí eliges el modelo Estándar o Preciso."
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

  if (process.platform !== "darwin") {

  }
});


ipcMain.handle("get-response", async (event, rawText) => {
  const win = windows.getMainWindow();
  console.log("[MAIN] get-response:", rawText, "| estado:", voiceState);

  const hasWake = conversationService.isWakeWordDetected(rawText, config);


  if (hasWake && conversationService.isDeactivateCommand(rawText, config)) {
    voiceState = "dormant";
    win?.webContents.send("voice-state", "dormant");
    console.log("[MAIN] → modo dormida");
    return "Ok, dejo de escuchar 💤 Llámame por mi nombre para activarme.";
  }


  if (voiceState === "dormant") {
    if (!hasWake) {
      console.log("[MAIN] dormida + sin nombre → silencio");
      return "";
    }
    voiceState = "active";
    win?.webContents.send("voice-state", "active");
    console.log("[MAIN] → despertó con nombre");

    if (conversationService.isWakeCommand(rawText, config)) {
      return conversationService.getWakeResponse(config);
    }
  }


  let text = rawText.trim();
  if (hasWake) {
    text = conversationService.stripWakeWord(rawText, config);
    console.log("[MAIN] Texto tras stripWakeWord:", text);
  }

  if (hasWake) {
    const packResponse = await packService.handleCommand(
      text,
      config,
      (msg) => {
        win?.webContents.send("show-message", msg);
      },
      () => {

        win?.webContents.send("action-highlight");
      }
    );
    if (packResponse !== null) {
      console.log("[MAIN] Respuesta de pack:", packResponse);
      return packResponse;
    }
  }

  const response = conversationService.getConversationalResponse(text, config);
  if (response) {
    console.log("[MAIN] Respuesta conversacional:", response);
    return response;
  }

  if (hasWake) {
    return conversationService.getNamedFallback();
  }
  console.log("[MAIN] Sin nombre y sin patrón → silencio");
  return "";
});

ipcMain.handle("open-config-window", () => {
  windows.createConfigWindow();
});

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

ipcMain.handle("model:set-active", (event, type) => {
  if (type !== "small" && type !== "precise") return false;
  config.voiceModel = type;
  configService.save(config);
  voskService.setActiveType(type);
  windows.getMainWindow()?.webContents.send("config-updated", config);
  return true;
});

ipcMain.handle("model:download", (event, type) => {
  if (type !== "small" && type !== "precise") return false;
  Promise.resolve(voskService.download(type)).catch((err) => {
    console.error("[MAIN] Error descargando modelo:", err.message);
  });
  return true;
});


ipcMain.handle("grammar:get", () => conversationService.buildGrammar(config));

ipcMain.handle("config:get", () => reloadConfig());


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

ipcMain.handle("config:choose-sound", async () => {
  const win = windows.getConfigWindow();
  const result = await dialog.showOpenDialog(win, {
    filters: [
      { name: "Audio", extensions: ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "webm"] },
      { name: "Todos los archivos", extensions: ["*"] }
    ],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("sound:preview", (event, filePath) => {
  return soundService.previewSound(filePath);
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

ipcMain.handle("open-external", (event, url) => {
  if (typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});
