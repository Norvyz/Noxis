const { app, ipcMain, dialog, session, shell, screen, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const windows = require("./windows");
const { createTray, updateTrayState } = require("./tray");

const configService = require("../services/configService");
const packService = require("../services/packService");
const conversationService = require("../services/conversationService");
const voskService = require("../services/voskService");
const soundService = require("../services/soundService");
const reminderService = require("../services/reminderService");
const systemService = require("../services/systemService");
const visionService = require("../services/visionService");
const webService = require("../services/webService");
const proactiveService = require("../services/proactiveService");
const whisperService = require("../services/whisperService");

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
let pendingSystemAction = null; // { type: "shutdown" | "restart" }

// Cambio 2: memoria de sesión en el proceso principal (máx. 20 entradas)
let sessionHistory = [];
const MAX_SESSION_HISTORY = 20;

// Última respuesta generada por la IA local (para "copiá"/"guardá")
let lastAiText = "";

function maybeSpeakAiText(win, text) {
  const speak = !config || config.visionSpeak !== false;
  if (speak && text) {
    win?.webContents.send("speak-text", String(text));
  }
}

function aiHistory() {
  return sessionHistory.slice(-8).map((e) => ({
    role: e.role === "noxis" ? "assistant" : "user",
    content: e.text
  }));
}

// Noxis habla por su cuenta: cada X minutos suelta una frase con contexto.
function startProactiveLoop() {
  let timer = null;
  const schedule = () => {
    const base = Math.max(3, Math.min(120, Number(config && config.proactiveInterval) || 25));
    const jitter = (Math.random() * base) * 0.5;
    timer = setTimeout(async () => {
      schedule();
      try {
        const c = config || {};
        if (c.proactiveTalk === false || voiceState !== "active") return;
        const win = windows.getMainWindow();
        if (!win || win.isDestroyed()) return;
        const line = proactiveService.pickLine(new Date(), { name: c.name || "Noxis" });
        if (!line) return;
        win.webContents.send("show-message", line);
        win.webContents.send("speak-text", line);
        pushSession("noxis", line);
      } catch (err) {
        console.error("[MAIN] proactive talk:", err.message);
      }
    }, Math.max(30000, Math.round((base + jitter) * 60000)));
  };
  schedule();
  return () => { if (timer) clearTimeout(timer); };
}

function pushSession(role, text) {
  const txt = String(text || "");
  if (!txt.trim()) return;
  sessionHistory.push({ role, text: txt, ts: new Date().toISOString() });
  if (sessionHistory.length > MAX_SESSION_HISTORY) {
    sessionHistory.splice(0, sessionHistory.length - MAX_SESSION_HISTORY);
  }
}

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
  if (!config.allowMicrophone) updateTrayState("no-mic");

  visionService.setNotify((status) => {
    windows.getMainWindow()?.webContents.send("vision-status", status);
    windows.getConfigWindow()?.webContents.send("vision-status", status);
  });
  visionService.init();
  whisperService.setNotify((status) => {
    // Reusamos el canal "vosk-status": el renderer filtra por info.type.
    windows.getMainWindow()?.webContents.send("vosk-status", status);
    windows.getConfigWindow()?.webContents.send("vosk-status", status);
  });
  // Solo preparamos el modelo Whisper si está activo (evita descargar en vano).
  if (config.voiceModel === "whisper") {
    whisperService.init();
  }
  startProactiveLoop();

  if (config.autoStart) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  if (config.voiceModel === "whisper") {
    // Whisper es independiente de Vosk/Ollama: no arrancar el servidor Vosk.
    voskServiceStart = Promise.resolve(null);
    console.log("[MAIN] Modelo de voz: whisper (motor propio).");
  } else {
    voskServiceStart = voskService.start(config.voiceModel)
    .then((url) => {
      if (!url && voskService.getStatus() !== "ready") {
        // El modelo activo no está instalado: descargarlo solo, en segundo
        // plano. Al terminar, el evento "vosk-status: ready" reactiva la
        // escucha sin que el usuario tenga que hacer nada.
        console.log("[MAIN] Modelo de voz no instalado, descargando automáticamente...");
        voskService.download(config.voiceModel).catch((err) => {
          console.error("[MAIN] Auto-descarga de Vosk falló:", err.message);
        });
      }
      console.log("[MAIN] Vosk model URL:", url);
      return url;
    })
    .catch((err) => {
      console.error("[MAIN] Error iniciando Vosk:", err.message);
      return null;
    });
  }

  if (config.firstRun) {
    const onboarding = [
      {
        delay: 3500,
        msg: "Primero configura tus apps y grupos para que pueda abrirlos cuando me lo pidas 🦎"
      },
      {
        delay: 4000,
        msg: "Abre Configuración con click derecho sobre mí, o con la flechita ↑ de la barra de tareas (ícono de Noxis) → Configuración ⚙️"
      },
      {
        delay: 3500,
        msg: "Si quieres ponerme a escuchar, activa el micrófono en Configuración 🔊"
      }
    ];
    let at = 900;
    for (const step of onboarding) {
      setTimeout(async () => {
        await voskServiceStart;
        windows.getMainWindow()?.webContents.send("show-message", step.msg);
      }, at);
      at += step.delay;
    }
    setTimeout(() => {
      config.firstRun = false;
      configService.save(config);
    }, at);
  } else {
    setTimeout(async () => {
      const win = windows.getMainWindow();
      if (!win) return;
      await voskServiceStart;
      if (config.allowMicrophone && !voskService.getModelUrl()) {
        // Si el modelo aún se está descargando, ya está en curso (ver
        // voskServiceStart arriba); simplemente informamos.
        if (voskService.getStatus() === "downloading") {
          win.webContents.send(
            "show-message",
            "Estoy descargando el modelo de voz 🔊 Te aviso cuando esté lista para escucharte."
          );
        } else {
          win.webContents.send(
            "show-message",
            "Ahora mismo no puedo escucharte 🔊 Probá en Configuración la pestaña Comandos de voz y activá el modelo."
          );
        }
      } else {
        win.webContents.send(
          "show-message",
          `¡Hola! Soy ${config.name} 👋 Háblame normal, o di mi nombre para abrir apps.`
        );
      }
    }, 900);
  }

  // Cambio 4: evalua recordatorios cada segundo
  setInterval(() => {
    reminderService.tick((reminder) => {
      windows.getMainWindow()?.webContents.send(
        "show-message",
        `⏰ Recordatorio: ${reminder.text}`
      );
    });
  }, 1000);

  app.on("activate", () => {
    if (!windows.getMainWindow()) windows.createMainWindow(config);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
  }
});

// =========================================================
// Resolución de voz (intenciones + packs + dormida/despierta)
// =========================================================

async function resolveVoice(rawText, win) {
  const hasWake = conversationService.isWakeWordDetected(rawText, config);

  if (hasWake) {
    const restAfterWake = conversationService.normalize(
      conversationService.stripWakeWord(rawText, config)
    );
    // Conflicto: "apaga el pc" es comando de sistema, no "apagate" (dormir)
    const mentionsComputer = /(\bpc\b|computador|computadora|compu|equipo|ordenador)/.test(restAfterWake);
    if (!mentionsComputer && conversationService.isDeactivateCommand(rawText, config)) {
      voiceState = "dormant";
      updateTrayState("dormant");
      win?.webContents.send("voice-state", "dormant");
      console.log("[MAIN] → modo dormida");
      return { hasWake, response: "Ok, dejo de escuchar 💤 Llámame por mi nombre para activarme." };
    }
  }

  if (voiceState === "dormant") {
    if (!hasWake) {
      console.log("[MAIN] dormida + sin nombre → silencio");
      return { hasWake, response: "" };
    }
    voiceState = "active";
    updateTrayState("active");
    win?.webContents.send("voice-state", "active");
    console.log("[MAIN] → despertó con nombre");

    if (conversationService.isWakeCommand(rawText, config)) {
      return { hasWake, response: conversationService.getWakeResponse(config) };
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
      return { hasWake, response: packResponse };
    }
  }

  const ctx = { config, history: sessionHistory, hasWake };
  const detailed = conversationService.resolveIntentDetailed(text, ctx);
  if (detailed.response != null) {
    console.log("[MAIN] Intent:", detailed.id, "→", detailed.response);
    return { hasWake, response: detailed.response };
  }

  if (hasWake) {
    return { hasWake, response: conversationService.getNamedFallback() };
  }
  console.log("[MAIN] Sin nombre y sin patrón → silencio");
  return { hasWake, response: "" };
}

// =========================================================
// Entrega de respuestas (incluye strings especiales de control)
// =========================================================

const KNOWN_THEMES = ["dark", "light", "midnight", "forest", "obsidian", "sunset", "rose", "ocean"];

const THEME_NAMES = {
  light: "Claro",
  dark: "Oscuro",
  midnight: "Medianoche",
  forest: "Bosque",
  obsidian: "Obsidiana",
  sunset: "Atardecer",
  rose: "Rosa",
  ocean: "Océano"
};

const CORNER_NAMES = {
  "top-left": "superior izquierda",
  "top-right": "superior derecha",
  "bottom-left": "inferior izquierda",
  "bottom-right": "inferior derecha"
};

function applyTheme(id) {
  const theme = KNOWN_THEMES.includes(id) ? id : "dark";
  if (config.theme === theme) return theme;
  config.theme = theme;
  configService.save(config);
  windows.getMainWindow()?.webContents.send("config-updated", config);
  return theme;
}

function moveToCorner(corner) {
  const win = windows.getMainWindow();
  if (!win) return "bottom-right";
  const valid = ["top-left", "top-right", "bottom-left", "bottom-right"];
  const target = valid.includes(corner) ? corner : "bottom-right";
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const winW = 320;
  const winH = 340;
  const margin = 40;
  const positions = {
    "top-left": { x: wa.x + margin, y: wa.y + margin },
    "top-right": { x: wa.x + wa.width - winW - margin, y: wa.y + margin },
    "bottom-left": { x: wa.x + margin, y: wa.y + wa.height - winH - margin },
    "bottom-right": {
      x: wa.x + wa.width - winW - margin,
      y: wa.y + wa.height - winH - margin
    }
  };
  const pos = positions[target] || positions["bottom-right"];
  win.setPosition(Math.round(pos.x), Math.round(pos.y));
  if (config.startCorner !== target) {
    config.startCorner = target;
    configService.save(config);
  }
  return target;
}

async function openLastPack(win) {
  const key = config.lastUsedPack;
  if (!key) return "No guardé un grupo para repetir 🦎";
  const pack = (config.packs || []).find((p) => p.name === key || p.keyword === key);
  if (!pack) return "El último grupo ya no existe 🦎";
  return packService.openPack(
    pack,
    config,
    (msg) => win?.webContents.send("show-message", msg),
    () => win?.webContents.send("action-highlight")
  );
}

async function runSystemAction(cmd, win) {
  const notify = (msg) => win?.webContents.send("show-message", msg);
  switch (cmd) {
    case "volumeUp":
      await systemService.volumeUp();
      break;
    case "volumeDown":
      await systemService.volumeDown();
      break;
    case "mute":
      await systemService.muteToggle();
      break;
    case "lock":
      notify("Bloqueando pantalla 🔒");
      await systemService.lockScreen();
      break;
    case "taskmgr":
      notify("Abriendo el administrador de tareas 📊");
      await systemService.openTaskManager();
      break;
    case "explorer":
      notify("Abriendo el explorador de archivos 🗂");
      await systemService.openExplorer();
      break;
    case "emptybin":
      notify("Vaciando la papelera 🗑");
      await systemService.emptyRecycleBin();
      break;
    case "shutdown":
      pendingSystemAction = { type: "shutdown" };
      return "Apagar la PC en 5 segundos. Dime 'confirma' para proceder o 'cancela' para abortar.";
    case "restart":
      pendingSystemAction = { type: "restart" };
      return "Voy a reiniciar la PC. Dime 'confirma' para proceder o 'cancela' para abortar.";
    case "sleep":
      await systemService.sleepMode();
      break;
    default:
      break;
  }
  return "";
}

async function deliverResponse(response, win) {
  const text = String(response || "");
  if (!text) return "";

  if (text.startsWith("REMINDER:")) {
    const parts = text.slice("REMINDER:".length).split(":");
    const minutes = Math.max(1, parseInt(parts[0], 10) || 1);
    const body = parts.slice(1).join(":").trim() || "recordatorio";
    reminderService.addReminder(body, minutes);
    const when = minutes === 1 ? "1 minuto" : `${minutes} minutos`;
    return `¡Listo! Te aviso en ${when} para: ${body} ⏰`;
  }

  if (text.startsWith("THEME:")) {
    const themeId = applyTheme(text.slice("THEME:".length).trim());
    const themeName = THEME_NAMES[themeId] || themeId;
    return `¡Listo! Cambié al tema ${themeName} 🎨`;
  }

  if (text === "HIDE") {
    setTimeout(() => windows.getMainWindow()?.hide(), 500);
    return "Me escondo... doble clic en el ícono de la bandeja para volver 👋";
  }

  if (text === "SHOW") {
    const w = windows.getMainWindow();
    if (w) {
      w.show();
      w.focus();
    }
    return "¡Aquí estoy! 🦎";
  }

  if (text.startsWith("CORNER:")) {
    const corner = moveToCorner(text.slice("CORNER:".length).trim());
    const cornerName = CORNER_NAMES[corner] || corner;
    return `Me moví a la esquina ${cornerName} 📌`;
  }

  if (text === "RELOAD_CONFIG") {
    reloadConfig();
    applyWindowSettings(config);
    windows.getMainWindow()?.webContents.send("config-updated", config);
    return "";
  }

  if (text === "LAST_PACK") {
    return openLastPack(win);
  }

  if (text.startsWith("SYS:")) {
    return runSystemAction(text.slice("SYS:".length).trim(), win);
  }

  if (text.startsWith("OPENFOLDER:")) {
    const target = text.slice("OPENFOLDER:".length).trim();
    if (!target) return "¿Qué carpeta querés que abra? Dime descargas, documentos, escritorio… 📂";
    const result = await systemService.openFolder(target);
    if (result.ok) return `¡Listo! Abrí la carpeta 📂`;
    if (result.reason === "not-found" || result.reason === "no-exists") {
      return `No encontré la carpeta "${target}" 🦎 Probá con "abre descargas", "abre documentos" o decime el nombre de una carpeta de tu escritorio.`;
    }
    if (result.reason === "not-supported") return "Eso no está disponible en este sistema 😕";
    return "Ups… no pude abrir esa carpeta 😕";
  }

  if (text.startsWith("CREATE:FOLDER:")) {
    const result = await systemService.createFolder(text.slice("CREATE:FOLDER:".length).trim());
    if (result.ok) {
      const extra = result.exists ? " (ya existía)" : "";
      return `¡Listo! Creé la carpeta "${result.name}" en el Escritorio 📁${extra}`;
    }
    return `No pude crear la carpeta: ${result.reason || "error desconocido"} 😕`;
  }

  if (text.startsWith("CREATE:FILE:")) {
    const result = await systemService.createTextFile(text.slice("CREATE:FILE:".length).trim());
    if (result.ok) return `¡Listo! Creé el archivo "${result.name}" en el Escritorio 📄`;
    return `No pude crear el archivo: ${result.reason || "error desconocido"} 😕`;
  }

  if (text.startsWith("READ:")) {
    const target = text.slice("READ:".length).trim();
    const result = await systemService.readTextFile(target);
    if (!result.ok) {
      if (result.reason === "not-found") return `No encuentro el archivo "${target}" 🦎 Probá con "lee el archivo <nombre>".`;
      return `No pude leer ese archivo: ${result.reason} 😕`;
    }
    win?.webContents.send("speak-text", result.content);
    let shown = result.content;
    if (result.content.length > 1200) {
      shown = result.content.slice(0, 1200) + "\n… (te estoy leyendo el archivo completo en voz alta)";
    }
    return `📄 ${result.path}\n\n${shown}`;
  }

  if (text === "SCREENSHOT") {
    win?.webContents.send("show-message", "Tomando captura… 📸");
    const cap = await visionService.captureScreen();
    if (!cap.ok) return "No pude capturar tu pantalla 😕";
    shell.openPath(cap.filePath);
    return `¡Listo! Tomé una captura y la guardé en:\n${cap.filePath}`;
  }

  if (text === "VISION:DESCRIBE") {
    const ready = await visionService.checkReady();
    if (!ready) {
      return "Todavía no instalé mi IA del ojo 👀 Abre Configuración → Visión IA y pulsá 'Instalar IA' para que se descargue sola según tu PC.";
    }
    win?.webContents.send("show-message", "Estoy mirando tu pantalla… 👀");
    const cap = await visionService.captureScreen();
    if (!cap.ok) return "No pude capturar tu pantalla 😕";
    try {
      const description = await visionService.analyze(
        cap.base64,
        "Describe lo que se ve en esta captura de pantalla. Sé claro y ordenado. Luego agrega 2 ideas útiles sobre lo que estoy viendo."
      );
      lastAiText = description || "";
      maybeSpeakAiText(win, lastAiText);
      return description || "Vi la pantalla pero no supe qué decir 🦎";
    } catch (err) {
      return `La IA no respondió: ${err.message} 😕`;
    }
  }

  if (text.startsWith("AI_CHAT:")) {
    const msg = text.slice("AI_CHAT:".length).trim() || "dame una idea";
    const ready = await visionService.checkReady();
    if (!ready) {
      return "Todavía no instalé mi IA de apoyo 🤖 Abre Configuración → Visión IA y pulsá 'Instalar IA'.";
    }
    win?.webContents.send("show-message", "Pensando… 🧠");
    try {
      const reply = await visionService.chat(
        `El usuario de la app Noxis te pide lo siguiente. Respondé en español, breve y útil: "${msg}"`,
        aiHistory()
      );
      lastAiText = reply || "";
      maybeSpeakAiText(win, lastAiText);
      return reply || "Pensé algo pero no tengo las palabras 🦎";
    } catch (err) {
      return `La IA no respondió: ${err.message} 😕`;
    }
  }

  if (text === "AI_COPY") {
    if (!lastAiText) return "Aún no tengo ninguna respuesta de la IA para copiar 😕";
    try { clipboard.writeText(lastAiText); } catch (e) { return "No pude copiar al portapapeles 😕"; }
    return `Copié tu última respuesta de la IA al portapapeles (${String(lastAiText).length} caracteres) 📋`;
  }

  if (text === "AI_SAVE") {
    if (!lastAiText) return "Aún no tengo ninguna respuesta de la IA para guardar 😕";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const saved = await systemService.createTextFile(`respuesta-ia-${stamp}.txt`, lastAiText);
    if (!saved.ok) return `No pude guardar el archivo: ${saved.reason} 😕`;
    return `Guardé tu respuesta de la IA en:\n${saved.path} 📄`;
  }

  if (text === "AI_CLIP") {
    const clipText = clipboard.readText();
    if (!clipText || !clipText.trim()) return "Tu portapapeles está vacío 😕";
    const ready = await visionService.checkReady();
    if (!ready) return "Todavía no instalé mi IA de apoyo 🤖 Abre Configuración → Visión IA y pulsá 'Instalar IA'.";
    win?.webContents.send("show-message", "Leyendo tu portapapeles… 📋");
    try {
      const body = clipText.trim().slice(0, 6000);
      const reply = await visionService.chat(
        `Resumí el siguiente texto en puntos claros y cortos, en español:\n\n${body}`,
        aiHistory()
      );
      lastAiText = reply || "";
      maybeSpeakAiText(win, lastAiText);
      return reply || "Leí tu portapapeles pero no supe qué decir 🦎";
    } catch (err) {
      return `La IA no respondió: ${err.message} 😕`;
    }
  }

  if (text.startsWith("AI_IMAGE:")) {
    const name = text.slice("AI_IMAGE:".length).trim();
    const imagePath = visionService.resolveUserImage(name);
    if (!imagePath) return `No encuentro la imagen "${name}" 🖼️ Busco en Escritorio, Descargas y Documentos.`;
    const ready = await visionService.checkReady();
    if (!ready) return "Todavía no instalé mi IA de visión 👀 Abre Configuración → Visión IA y pulsá 'Instalar IA'.";
    win?.webContents.send("show-message", "Analizando la imagen… 👀");
    const res = await visionService.analyzeFile(imagePath, "Describe esta imagen y agrega 3 datos útiles sobre lo que se ve.");
    if (!res.ok) return `No pude analizar la imagen: ${res.reason} 😕`;
    lastAiText = res.text || "";
    maybeSpeakAiText(win, lastAiText);
    return `🖼️ ${imagePath}\n\n${res.text || "No supe qué decir 🦎"}`;
  }

  if (text.startsWith("AI_FILE:")) {
    const name = text.slice("AI_FILE:".length).trim();
    const filePath = visionService.resolveUserTextFile(name);
    if (!filePath) return `No encuentro el archivo "${name}" 📄 Busco en Escritorio, Descargas y Documentos.`;
    const read = await systemService.readTextFile(filePath);
    if (!read.ok) return `No pude leer ese archivo: ${read.reason} 😕`;
    const ready = await visionService.checkReady();
    if (!ready) return "Todavía no instalé mi IA de apoyo 🤖 Abre Configuración → Visión IA y pulsá 'Instalar IA'.";
    win?.webContents.send("show-message", "Leyendo el archivo con la IA… 📄");
    try {
      const body = read.content.slice(0, 6000);
      const reply = await visionService.chat(
        `Te comparto el contenido del archivo ${read.path}. Explicalo en español, destaca lo importante y respondé cualquier pedido:\n\n${body}`,
        aiHistory()
      );
      lastAiText = reply || "";
      maybeSpeakAiText(win, lastAiText);
      return `📄 ${read.path}\n\n${reply || "Leí el archivo pero no supe qué decir 🦎"}`;
    } catch (err) {
      return `La IA no respondió: ${err.message} 😕`;
    }
  }

  if (text.startsWith("SEARCH:")) {
    const q = text.slice("SEARCH:".length).trim();
    if (!q) return "¿Qué querés que busque? 🔎";
    win?.webContents.send("show-message", `Buscando "${q}"… 🔎`);
    const res = await webService.search(q);
    if (res.ok && res.answer) {
      const answer = String(res.answer).slice(0, 600);
      lastAiText = answer;
      maybeSpeakAiText(win, answer);
      win?.webContents.send("show-message", `Abro Google con "${q}" por si querés profundizar 🔎`);
      shell.openExternal(webService.searchUrl(q));
      return `🔎 ${answer}`;
    }
    shell.openExternal(webService.searchUrl(q));
    return `Te abrí Google con "${q}" 🔎 Ahí mismo vas a encontrar lo que buscás.`;
  }

  if (text.startsWith("SMALLTALK:")) {
    const topic = text.slice("SMALLTALK:".length).trim() || "contame algo";
    const useAi = !config || config.useAiChat !== false;
    const ready = useAi ? await visionService.checkReady() : false;
    if (!ready) {
      const fallback = proactiveService.smallTalkFallback(topic);
      maybeSpeakAiText(win, fallback);
      return fallback;
    }
    try {
      const reply = await visionService.chat(
        `Sos Noxis, la mascota de escritorio. Mantené una charla humana, cálida y breve en español rioplatense, con un toque de humor y algo de emoción.\nEl usuario te dice: "${topic}"\nRespondé en máximo 3 frases.`,
        aiHistory()
      );
      lastAiText = reply || "";
      maybeSpeakAiText(win, lastAiText);
      return reply || proactiveService.smallTalkFallback(topic);
    } catch (err) {
      return proactiveService.smallTalkFallback(topic);
    }
  }

  return text;
}

ipcMain.handle("get-response", async (event, rawText) => {
  const win = windows.getMainWindow();
  console.log("[MAIN] get-response:", rawText, "| estado:", voiceState);

  pushSession("user", rawText);

  // Confirma / cancela un apagado o reinicio pendiente
  if (pendingSystemAction) {
    if (conversationService.isConfirmText(rawText, config)) {
      const action = pendingSystemAction;
      pendingSystemAction = null;
      if (action.type === "shutdown") await systemService.systemShutdown();
      else if (action.type === "restart") await systemService.systemRestart();
      const confirmed = "Ok, confirmado ✅";
      pushSession("noxis", confirmed);
      return confirmed;
    }
    if (conversationService.isCancelText(rawText, config)) {
      pendingSystemAction = null;
      const cancelled = "Cancelado, no haré nada ✅";
      pushSession("noxis", cancelled);
      return cancelled;
    }
    return "";
  }

  const outcome = await resolveVoice(rawText, win);
  const delivered = await deliverResponse(outcome.response, win);
  if (delivered) pushSession("noxis", delivered);
  console.log("[MAIN] respuesta:", JSON.stringify(delivered));
  return delivered;
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
ipcMain.handle("model:get-info", () => {
  const w = whisperService.MODELS.whisper;
  const whisperCard = {
    id: "whisper",
    label: w.label,
    version: w.version,
    sizeMB: w.sizeMB,
    description: w.description,
    installed: whisperService.getStatus().installed,
    recommended: true
  };
  // Solo Whisper queda disponible en el selector de modelo de voz.
  return {
    models: [whisperCard],
    active: "whisper"
  };
});

ipcMain.handle("model:set-active", (event, type) => {
  if (type !== "small" && type !== "precise" && type !== "whisper") return false;
  config.voiceModel = type;
  configService.save(config);
  if (type === "whisper") {
    // Si el modelo aún no se descargó, arrancamos la descarga en segundo plano.
    whisperService.ensureModel().catch((err) => {
      console.error("[MAIN] Error asegurando Whisper:", err.message);
    });
  } else {
    voskService.setActiveType(type);
  }
  windows.getMainWindow()?.webContents.send("config-updated", config);
  return true;
});

ipcMain.handle("model:download", (event, type) => {
  if (type !== "small" && type !== "precise" && type !== "whisper") return false;
  if (type === "whisper") {
    Promise.resolve(whisperService.ensureModel()).catch((err) => {
      console.error("[MAIN] Error descargando Whisper:", err.message);
    });
  } else {
    Promise.resolve(voskService.download(type)).catch((err) => {
      console.error("[MAIN] Error descargando modelo:", err.message);
    });
  }
  return true;
});

ipcMain.handle("whisper:status", () => whisperService.getStatus());

ipcMain.handle("whisper:transcribe", async (event, samples) => {
  try {
    const result = await whisperService.transcribe(samples);
    return result;
  } catch (err) {
    console.error("[MAIN] Error transcribiendo:", err.message);
    return { ok: false, reason: String(err.message || "error"), text: "" };
  }
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

// =========================================================
// Cambio 2: sesión. Cambio 4: recordatorios
// =========================================================

ipcMain.handle("session:history", () => sessionHistory);
ipcMain.handle("session:clear", () => {
  sessionHistory = [];
  return true;
});

ipcMain.handle("reminder:add", (event, text, minutes) => {
  const id = reminderService.addReminder(text, minutes);
  const created = reminderService.listPending().find((r) => r.id === id);
  return created || null;
});

ipcMain.handle("reminder:list", () => reminderService.listPending());

ipcMain.handle("reminder:cancel", (event, id) => {
  return reminderService.cancelReminder(Number(id));
});

// =========================================================
// IA local (visión + chat)
// =========================================================

ipcMain.handle("vision:detect", () => visionService.detectHardware());

ipcMain.handle("vision:status", () => visionService.getStatus());

ipcMain.handle("vision:refresh", async () => {
  return visionService.refresh();
});

ipcMain.handle("vision:install", (event, modelName) => {
  Promise.resolve(visionService.install(String(modelName || ""))).catch((err) => {
    console.error("[MAIN] Error instalando IA:", err.message);
  });
  return true;
});

ipcMain.handle("vision:cancel", () => visionService.cancel());

ipcMain.handle("vision:test", async () => {
  const ready = await visionService.checkReady();
  if (!ready) return { ok: false, message: "La IA no está lista todavía. Instalala primero." };
  const cap = await visionService.captureScreen();
  if (!cap.ok) return { ok: false, message: "No pude capturar la pantalla." };
  try {
    const description = await visionService.analyze(
      cap.base64,
      "Describe en pocas líneas lo que se ve en esta captura de pantalla."
    );
    return { ok: true, message: description };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});