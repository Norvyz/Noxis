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
const voiceMatcher = require("../services/voiceMatcher");
const systemCommandHandler = require("../services/systemCommandHandler");
const companionService = require("../services/companionService");
const fileLearningService = require("../services/fileLearningService");
const voskService = require("../services/voskService");
const systemService = require("../services/systemService");
const appScanner = require("./appScanner");

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

    // Iniciar comportamiento companion (habla sola, detecta apps, recordatorios)
    if (config.companionEnabled !== false) {
      companionService.start((msg) => {
        const w = windows.getMainWindow();
        if (w) w.webContents.send("show-message", msg);
      }, config);
    }

    // Escaneo automático de apps instaladas (background, 5s después del inicio)
    setTimeout(async () => {
      try {
        if (appScanner.shouldRescan()) {
          console.log("[MAIN] Iniciando escaneo automático de apps...");
          const index = await appScanner.rescanApps();
          console.log(`[MAIN] Escaneo completado: ${index.apps.length} apps detectadas`);
        } else {
          console.log("[MAIN] Índice de apps reciente, saltando escaneo");
        }
      } catch (err) {
        console.error("[MAIN] Error en escaneo de apps:", err.message);
      }
    }, 5000);
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

app.on("before-quit", () => {
  companionService.stop();
});

// ---------------------------------------------------------------
// IPC: ventana principal (widget)
// ---------------------------------------------------------------

ipcMain.handle("get-response", async (event, rawText) => {
  const win = windows.getMainWindow();
  console.log("[MAIN] get-response:", rawText, "| estado:", voiceState);

  // 0) Si hay confirmación o volumen pendiente, procesar SIN requerir wake word
  if (systemCommandHandler.hasPending() || systemCommandHandler.hasPendingVolume()) {
    const sysResponse = await systemCommandHandler.handleCommand(
      rawText, config,
      (msg) => win?.webContents.send("show-message", msg),
      win
    );
    if (sysResponse !== null) {
      console.log("[MAIN] Respuesta pendiente (sin wake):", sysResponse);
      return sysResponse;
    }
  }

  const hasWake = conversationService.isWakeWordDetected(rawText, config);

  // Si Noxis está oculta en la bandeja ("descansa") y le hablan por su nombre,
  // vuelve a aparecer en pantalla. Igual seguimos procesando el comando.
  if (hasWake && win && !win.isVisible()) {
    win.show();
    console.log("[MAIN] → volvió a aparecer (estaba oculta en la bandeja)");
  }

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

  // 3.5) "Noxis descansa" → se oculta en la bandeja pero SIGUE escuchando.
  // No entra en modo dormida: si le hablan por su nombre, vuelve a aparecer
  // (se maneja arriba con win.show() cuando hasWake y estaba oculta).
  if (hasWake && /^(descansa|descansar|descansamo|descansemos|descansame)\b/.test(text)) {
    win?.hide();
    console.log("[MAIN] → oculta en la bandeja, sigo escuchando");
    return "Ok, me escondo en la bandeja 🙂 Sigo escuchándote, decime mi nombre y aparezco de nuevo.";
  }

  // 3.6) Matching de comandos con el nuevo sistema (cascada exacto→fuzzy).
  // Solo aplica si se mencionó el nombre de Noxis.
  if (hasWake) {
    const identified = voiceMatcher.identifyCommand(text, config);
    if (identified) {
      console.log("[MAIN] Comando identificado:", identified.command, "| operando:", identified.operand, "| confianza:", identified.confidence);

      // Abrir/cerrar app: cruzar operando con diccionario de apps
      if ((identified.command === "open" || identified.command === "close") && identified.operand) {
        const appMatch = voiceMatcher.identifyApp(identified.operand);
        if (appMatch) {
          // 1) Buscar en config manual (prioridad)
          const exePath = (config.apps || []).find(
            (a) => a.keyword && voiceMatcher.normalize(a.keyword) === voiceMatcher.normalize(appMatch.canonical)
          );
          if (identified.command === "open") {
            if (exePath && exePath.executablePath) {
              const { exec } = require("child_process");
              exec(`"${exePath.executablePath}"`, (err) => {
                if (err) console.error("[MAIN] Error abriendo app:", err.message);
              });
              return `Abriendo ${appMatch.canonical} 🚀`;
            }
            // 2) Fallback: buscar en índice automático de apps instaladas
            const autoMatch = appScanner.findInIndex(appMatch.canonical);
            if (autoMatch) {
              if (autoMatch.exePath) {
                const { exec } = require("child_process");
                exec(`"${autoMatch.exePath}"`, (err) => {
                  if (err) console.error("[MAIN] Error abriendo app (auto):", err.message);
                });
                return `Abriendo ${autoMatch.name} 🚀`;
              }
              if (autoMatch.appId) {
                const { exec } = require("child_process");
                exec(`Start-Process "shell:AppsFolder\\${autoMatch.appId}"`, (err) => {
                  if (err) console.error("[MAIN] Error abriendo app UWP:", err.message);
                });
                return `Abriendo ${autoMatch.name} 🚀`;
              }
            }
            return `No encontré "${appMatch.canonical}". Agregala en Configuración → Apps para poder abrirla.`;
          }
          if (identified.command === "close") {
            const result = await systemService.closeApp(appMatch.exeName);
            if (result.ok) return `Cerré ${appMatch.canonical} ✅`;
            if (result.reason === "not-found") return `No encontré ${appMatch.canonical} abierto 😕`;
            return `No pude cerrar ${appMatch.canonical} 😕`;
          }
        }
      }

      // Crear carpeta con ubicación
      if (identified.command === "create" && identified.operand) {
        const locMatch = voiceMatcher.identifyLocation(identified.operand);
        if (locMatch) {
          const folderName = identified.operand
            .replace(new RegExp(voiceMatcher.normalize(locMatch.canonical), "g"), "")
            .replace(/\ben\b|\bsobre\b|\bal\b/g, "")
            .trim();
          if (folderName) {
            const result = await systemService.createFolder(folderName, locMatch.canonical);
            if (result.ok) {
              const locLabel = locMatch.canonical || "escritorio";
              if (result.exists) return `Ya existe una carpeta "${result.name}" en ${locLabel} 📁`;
              return `Carpeta "${result.name}" creada en ${locLabel} 📁`;
            }
            return `No pude crear la carpeta 😕 ${result.reason || ""}`;
          }
        }
      }

      // Volumen: extraer número
      if (["volumeUp", "volumeDown", "setVolume"].includes(identified.command)) {
        const num = voiceMatcher.extractNumber(text);
        if (num !== null) {
          if (identified.command === "setVolume") {
            const result = await systemService.setVolume(num);
            if (result && result.ok) return `Volumen ajustado a ${num}% 🔊`;
            return "No pude ajustar el volumen 😕";
          }
          if (identified.command === "volumeUp") {
            const result = await systemService.setVolume(num, "up");
            if (result && result.ok) return `Volumen subido a ${num}% 🔊`;
            return "No pude subir el volumen 😕";
          }
          if (identified.command === "volumeDown") {
            const result = await systemService.setVolume(num, "down");
            if (result && result.ok) return `Volumen bajado a ${num}% 🔊`;
            return "No pude bajar el volumen 😕";
          }
        }
      }

      // Mover ventana
      if (identified.command === "move" || identified.command === "corner") {
        const CORNER_MAP = {
          "arriba": "top", "superior": "top", "abajo": "bottom", "inferior": "bottom",
          "izquierda": "left", "izq": "left", "izqda": "left",
          "derecha": "right", "der": "right", "dcha": "right",
          "centro": "center", "medio": "center", "mitad": "center"
        };
        const operandTokens = voiceMatcher.tokensOf(identified.operand || text);
        let vertical = null, horizontal = null;
        for (const t of operandTokens) {
          if (["arriba", "superior"].includes(t)) vertical = "top";
          if (["abajo", "inferior"].includes(t)) vertical = "bottom";
          if (["izquierda", "izq", "izqda"].includes(t)) horizontal = "left";
          if (["derecha", "der", "dcha"].includes(t)) horizontal = "right";
          if (["centro", "medio", "mitad"].includes(t)) { vertical = "center"; horizontal = "center"; }
        }
        let corner = null;
        if (vertical === "center" && horizontal === "center") corner = "center";
        else if (vertical && horizontal) corner = `${vertical}-${horizontal}`;
        else if (vertical) corner = `${vertical}-center`;
        else if (horizontal) corner = `center-${horizontal}`;

        if (corner) {
          const result = systemService.moveWindowToCorner(win, corner);
          if (result.ok) {
            const labels = {
              "top-left": "esquina superior izquierda", "top-right": "esquina superior derecha",
              "bottom-left": "esquina inferior izquierda", "bottom-right": "esquina inferior derecha",
              "center": "el centro"
            };
            return `Me moví a ${labels[corner]} 📍`;
          }
          return "No pude moverme 😕";
        }
      }
    }
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

  // 5) Comandos del sistema SOLO si se mencionó el nombre
  if (hasWake) {
    const sysResponse = await systemCommandHandler.handleCommand(
      text, config,
      (msg) => win?.webContents.send("show-message", msg),
      win
    );
    if (sysResponse !== null) {
      console.log("[MAIN] Respuesta del sistema:", sysResponse);
      return sysResponse;
    }
  }

  // 6) Conversación normal (con o sin nombre)
  const response = conversationService.getConversationalResponse(text, config);
  if (response) {
    console.log("[MAIN] Respuesta conversacional:", response);
    return response;
  }

  // 7) Sin patrón: si la llamaron por nombre hay feedback; si no, silencio
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

// Guarda la posición del chat de texto dentro de la ventana (persistente)
ipcMain.handle("chat:save-position", (event, pos) => {
  if (!pos || typeof pos.left !== "number" || typeof pos.top !== "number") return false;
  config.chatPosition = {
    left: Math.round(pos.left),
    top: Math.round(pos.top)
  };
  return configService.save(config);
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

// Lista los dispositivos de salida de audio para el selector de config
ipcMain.handle("audio:list-outputs", () => systemService.listAudioOutputs());

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
    companionService.updateConfig(config);
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

// ---------------------------------------------------------------
// IPC: Aprendizaje de archivos
// ---------------------------------------------------------------

// Seleccionar carpeta para aprendizaje
ipcMain.handle("learn:choose-folder", async () => {
  const win = windows.getConfigWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Seleccionar carpeta para aprender vocabulario"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Analizar carpeta y extraer palabras
ipcMain.handle("learn:analyze", async (event, folderPath, options) => {
  const win = windows.getConfigWindow();
  const result = await fileLearningService.analyzeFolder(folderPath, {
    includeSubfolders: options?.includeSubfolders || false,
    minFrequency: options?.minFrequency || 3,
    onProgress: (current, total, fileName) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("learn:progress", { current, total, fileName });
      }
    }
  });
  // Guardar palabras aprendidas en dictionary.json
  if (result.words.length > 0) {
    fileLearningService.saveLearnedWords(result.words);
  }
  return result;
});

// Obtener palabras aprendidas
ipcMain.handle("learn:get-words", () => {
  return fileLearningService.getLearnedWords();
});

// Eliminar una palabra aprendida
ipcMain.handle("learn:remove-word", (event, word) => {
  return fileLearningService.removeLearnedWord(word);
});

// Borrar todas las palabras aprendidas
ipcMain.handle("learn:clear-all", () => {
  return fileLearningService.clearLearnedWords();
});

// ---------------------------------------------------------------
// IPC: Escaneo automático de apps
// ---------------------------------------------------------------

ipcMain.handle("app-scan:rescan", async (event) => {
  const win = windows.getConfigWindow();
  try {
    const index = await appScanner.rescanApps((msg) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("app-scan:progress", msg);
      }
    });
    return index;
  } catch (err) {
    console.error("[MAIN] Error reescaneando apps:", err.message);
    return { lastScan: null, apps: [] };
  }
});

ipcMain.handle("app-scan:get-index", () => {
  return appScanner.loadIndex();
});

ipcMain.handle("app-scan:should-rescan", () => {
  return appScanner.shouldRescan();
});

// ---------------------------------------------------------------
// IPC: Control de ventana de configuración (frameless)
// ---------------------------------------------------------------

ipcMain.handle("config-window:minimize", () => {
  const win = windows.getConfigWindow();
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle("config-window:close", () => {
  const win = windows.getConfigWindow();
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle("config-window:is-maximized", () => {
  const win = windows.getConfigWindow();
  return win ? win.isMaximized() : false;
});

ipcMain.handle("config-window:toggle-maximize", () => {
  const win = windows.getConfigWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
