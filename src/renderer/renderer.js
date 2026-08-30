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

// src/renderer/renderer.js
// Widget principal de Noxis - Reconocimiento de voz offline con Vosk

const noxisImage = document.getElementById("noxisImage");
const speechBubble = document.getElementById("speechBubble");
const noxisText = document.getElementById("noxisText");
const chatCard = document.getElementById("chatCard");
const chatName = document.getElementById("chatName");
const chatAvatar = document.getElementById("chatAvatar");
const chatMessages = document.getElementById("chatMessages");
const closeChatBtn = document.getElementById("closeChatBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const voiceStatus = document.getElementById("voiceStatus");
const voiceStatusText = document.getElementById("voiceStatusText");
const actionHighlight = document.getElementById("actionHighlight");

let hideBubbleTimeout = null;
let hideChatTypingTimeout = null;
let bubbleDuration = 8500; // ms que permanece la burbuja: configurable (config.bubbleDuration)
let isListening = false; // captura de audio activa (mic encendido → siempre escucha)
let isDormant = false;   // dormida: solo reacciona a su nombre
let isStarting = false;
let micEnabled = false;

// Configuración del marco que rodea a Noxis al ejecutar una acción
let actionHighlightEnabled = true;
let actionHighlightColor = "#22c55e";
let actionHighlightWidth = 5;   // px de grosor del borde
let actionHighlightRadius = 30; // px de redondez (0 = cuadrado)
let hideHighlightTimeout = null;

// Iconos SVG
closeChatBtn.innerHTML = window.NoxisIcons.close(16);
clearChatBtn.innerHTML = window.NoxisIcons.trash(15);
sendBtn.innerHTML = window.NoxisIcons.send(15);

// ---------------------------------------------------------------
// Mostrar mensaje en la burbuja
// ---------------------------------------------------------------
function showMessage(message) {
  if (!message) return;
  noxisText.textContent = message;
  speechBubble.classList.add("visible");
  clearTimeout(hideBubbleTimeout);
  hideBubbleTimeout = setTimeout(() => {
    speechBubble.classList.remove("visible");
  }, bubbleDuration);
}

// ---------------------------------------------------------------
// Marco de resaltado al ejecutar una acción
// ---------------------------------------------------------------
function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return `rgba(34, 197, 94, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function updateActionHighlightConfig(cfg) {
  if (!cfg) return;
  actionHighlightEnabled = cfg.actionHighlightEnabled !== false;
  if (typeof cfg.actionHighlightColor === "string" && /^#[0-9a-fA-F]{6}$/.test(cfg.actionHighlightColor)) {
    actionHighlightColor = cfg.actionHighlightColor;
  }
  if (typeof cfg.actionHighlightWidth === "number" && cfg.actionHighlightWidth >= 1) {
    actionHighlightWidth = cfg.actionHighlightWidth;
  }
  if (typeof cfg.actionHighlightRadius === "number" && cfg.actionHighlightRadius >= 0) {
    actionHighlightRadius = cfg.actionHighlightRadius;
  }
  applyActionHighlightStyles();
}

function applyActionHighlightStyles() {
  if (!actionHighlight) return;
  actionHighlight.style.borderColor = actionHighlightColor;
  actionHighlight.style.borderWidth = `${actionHighlightWidth}px`;
  actionHighlight.style.borderRadius = `${actionHighlightRadius}px`;
  actionHighlight.style.boxShadow = `0 0 20px ${hexToRgba(actionHighlightColor, 0.4)}`;
  actionHighlight.classList.toggle("disabled", !actionHighlightEnabled);
}

function showActionHighlight() {
  if (!actionHighlight || !actionHighlightEnabled) return;
  clearTimeout(hideHighlightTimeout);
  actionHighlight.classList.remove("visible");
  void actionHighlight.offsetWidth; // reinicia la animación
  actionHighlight.classList.add("visible");
  hideHighlightTimeout = setTimeout(() => {
    actionHighlight.classList.remove("visible");
  }, 2600);
}

// ---------------------------------------------------------------
// Mostrar estado de voz (arriba del botón)
// ---------------------------------------------------------------
function showVoiceStatus(text) {
  voiceStatusText.textContent = text;
  voiceStatus.classList.remove("hidden");
  voiceStatus.classList.add("visible");
}

function hideVoiceStatus() {
  voiceStatus.classList.remove("visible");
  voiceStatus.classList.add("hidden");
}

// ---------------------------------------------------------------
// Chat de texto
// ---------------------------------------------------------------
function openChat() {
  chatCard.classList.add("open");
  userInput.focus();
}

function closeChat() {
  chatCard.classList.remove("open");
  userInput.blur();
}

// ---------------------------------------------------------------
// Burbujas de mensaje dentro del chat
// ---------------------------------------------------------------
const MAX_CHAT_MSG = 30;

function addChatMessage(text, who, isVoice) {
  const voice = !!isVoice;
  const row = document.createElement("div");
  row.className = "chat-msg " + (who === "user" ? "chat-msg--user" : "chat-msg--noxis");
  if (voice) row.classList.add("chat-msg--voice");

  const bubble = document.createElement("span");
  bubble.className = "chat-msg-bubble";

  if (who === "user" && voice) {
    bubble.innerHTML = '<span class="chat-voice-icon">🎙</span>' + text;
  } else {
    bubble.textContent = text;
  }

  row.appendChild(bubble);
  chatMessages.appendChild(row);
  trimChatHistory(MAX_CHAT_MSG);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return row;
}

// Cambio 10: mensaje de sistema (centrado, estilo sutil)
function addChatSystemMessage(text) {
  const row = document.createElement("div");
  row.className = "chat-msg chat-system-msg";
  const bubble = document.createElement("span");
  bubble.className = "chat-msg-bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  trimChatHistory(MAX_CHAT_MSG);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return row;
}

// Limita la cantidad de mensajes visibles en el chat
function trimChatHistory(limit) {
  const max = Math.max(5, limit || MAX_CHAT_MSG);
  while (chatMessages.querySelectorAll(".chat-msg").length > max) {
    const first = chatMessages.querySelector(".chat-msg");
    if (first) first.remove();
  }
}

// Limpia el historial del chat (UI + memoria del proceso main)
async function clearChatHistory() {
  while (chatMessages.querySelectorAll(".chat-msg").length > 0) {
    chatMessages.querySelector(".chat-msg").remove();
  }
  addChatSystemMessage("— Historial borrado —");
  try {
    await window.noxisAPI.clearSession();
  } catch (err) {
    console.error("[Noxis] Error limpiando sesión:", err);
  }
}

// Cambio 10: al cargar, restaura el historial de la sesión de voz actual
async function restoreSessionHistory() {
  try {
    const history = await window.noxisAPI.getSessionHistory();
    if (!Array.isArray(history)) return;
    for (const entry of history) {
      if (!entry || !entry.text) continue;
      if (entry.role === "user") addChatMessage(entry.text, "user", true);
      else if (entry.role === "noxis") addChatMessage(entry.text, "noxis", true);
    }
  } catch (err) {
    console.error("[Noxis] Error restaurando historial:", err);
  }
}

function showChatTyping() {
  clearTimeout(hideChatTypingTimeout);
  if (document.querySelector(".chat-typing")) return;
  const row = document.createElement("div");
  row.className = "chat-msg chat-msg--noxis chat-typing";
  const bubble = document.createElement("span");
  bubble.className = "chat-msg-bubble";
  bubble.innerHTML =
    '<span class="dotTyping"><i></i><i></i><i></i></span>';
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideChatTyping() {
  clearTimeout(hideChatTypingTimeout);
  const typing = document.querySelector(".chat-typing");
  if (typing) typing.remove();
}

function pokeNoxis() {
  noxisImage.classList.remove("poke");
  void noxisImage.offsetWidth;
  noxisImage.classList.add("poke");
}

// Click en Noxis → cariñito / atajos
noxisImage.addEventListener("click", () => {
  if (moved) { moved = false; return; } // fue arrastre, no un clic
  pokeNoxis();
  if (!micEnabled) {
    showMessage("Activa el micrófono en Configuración");
    setTimeout(() => window.noxisAPI.openConfig(), 800);
  }
});

// Doble click en Noxis → abrir/cerrar chat de texto
noxisImage.addEventListener("dblclick", (e) => {
  e.preventDefault();
  if (moved) return;
  chatCard.classList.contains("open") ? closeChat() : openChat();
});

// Click derecho en Noxis → abrir Configuración (opción directa y clara)
noxisImage.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  window.noxisAPI.openConfig();
  showMessage("Abriendo Configuración…");
});

// ---- Arrastre manual (click izquierdo sostenido) ----
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDragging = false;
let moved = false;

let dragStartX = 0;
let dragStartY = 0;

noxisImage.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // solo botón izquierdo
  isDragging = true;
  moved = false;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  dragOffsetX = e.screenX - window.screenX;
  dragOffsetY = e.screenY - window.screenY;
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
  window.noxisAPI.dragWindow(e.screenX, e.screenY, dragOffsetX, dragOffsetY);
});

window.addEventListener("mouseup", () => {
  isDragging = false;
  // si solo fue un click (sin arrastre), se mantiene moved=false
});

closeChatBtn.addEventListener("click", closeChat);

clearChatBtn.addEventListener("click", clearChatHistory);

// Cerrar el chat al hacer clic fuera de él (accesible y predecible)
document.addEventListener("pointerdown", (e) => {
  if (!chatCard.classList.contains("open")) return;
  if (chatCard.contains(e.target)) return;
  closeChat();
});

// ---------------------------------------------------------------
// Enviar mensaje (texto)
// ---------------------------------------------------------------
let isSendingText = false; // evita enviar duplicados mientras hay una petición en curso

async function sendCurrentInput() {
  const text = userInput.value.trim();
  if (!text || isSendingText) return;
  userInput.value = "";
  isSendingText = true;
  addChatMessage(text, "user");
  showChatTyping();
  try {
    const response = await window.noxisAPI.sendMessage(text);
    hideChatTyping();
    if (response) {
      addChatMessage(response, "noxis");
      showMessage(response);
    }
  } finally {
    isSendingText = false;
    userInput.focus();
  }
}

sendBtn.addEventListener("click", sendCurrentInput);

userInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    await sendCurrentInput();
  } else if (e.key === "Escape") {
    closeChat();
  }
});

// ---------------------------------------------------------------
// Mensajes del proceso main
// ---------------------------------------------------------------
window.noxisAPI.onShowMessage((msg) => showMessage(msg));

// Cuando Noxis ejecuta una acción (abrir/cerrar app) → marco de resaltado
window.noxisAPI.onActionHighlight(() => showActionHighlight());

// Reproduce el sonido del comando ejecutado (mp3/wav/ogg desde la carpeta de assets)
window.noxisAPI.onPlaySound((filePath) => {
  if (!filePath) return;
  try {
    const audio = new Audio(`file://${filePath}`);
    audio.volume = 1;
    audio.play().catch((err) => console.error("[Noxis] No se pudo reproducir el sonido:", err));
  } catch (err) {
    console.error("[Noxis] Error al crear el audio:", err);
  }
});

// Lee texto en voz alta (web speech API del navegador/Electron)
window.noxisAPI.onSpeak((text) => {
  speakText(text);
});

function speakText(text) {
  const content = String(text || "").trim();
  if (!content) return;
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(content);
  utter.lang = "es-ES";
  utter.rate = 1;
  utter.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find((v) => /es-/i.test(v.lang)) || null;
  if (esVoice) utter.voice = esVoice;
  window.speechSynthesis.speak(utter);
}

window.noxisAPI.onConfigUpdated((config) => {
  chatName.textContent = config.name || "Noxis";
  applyTheme(config.theme || "light");
  if (typeof config.bubbleDuration === "number" && config.bubbleDuration > 0) {
    bubbleDuration = config.bubbleDuration;
  }
  updateActionHighlightConfig(config);
  if (config.skinPath) {
    noxisImage.src = `file://${config.skinPath}`;
    chatAvatar.src = `file://${config.skinPath}`;
  }
  micEnabled = !!config.allowMicrophone;

  const nextModelType = config.voiceModel || "small";
  if (nextModelType !== modelType) {
    // Cambió el modelo de voz → recargar con el motor correcto (Vosk o Whisper)
    modelType = nextModelType;
    const wasListening = isListening;
    if (wasListening) stopListening();
    resetVoskModel();
    WHISPER.ready = false;
    resetWhisperVad();
    if (micEnabled) startListening();
    return;
  }

  if (micEnabled && !isListening) {
    startListening();
  } else if (micEnabled && isListening) {
    restartRecognizer(); // la config cambió → nuevas keywords en la gramática
  } else if (!micEnabled && isListening) {
    stopListening();
  }
});

const THEME_IDS = ["light", "dark", "obsidian", "midnight", "forest", "sunset", "rose", "ocean"];

function applyTheme(themeId) {
  const theme = THEME_IDS.includes(themeId) ? themeId : "light";
  document.body.classList.remove(...THEME_IDS.map((t) => `theme-${t}`));
  document.body.classList.add(`theme-${theme}`);
}

// Estado dormida/activa (decidido por el main)
window.noxisAPI.onVoiceState((state) => {
  if (state === "dormant") {
    isDormant = true;
    showVoiceStatus("💤 Dormida — di su nombre");
  } else {
    isDormant = false;
    hideVoiceStatus();
  }
});

// ---------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------
window.noxisAPI.getSkinPath().then((skinPath) => {
  if (skinPath) {
    noxisImage.src = `file://${skinPath}`;
    chatAvatar.src = `file://${skinPath}`;
  }
});
window.noxisAPI.getNoxisName().then((name) => {
  chatName.textContent = name || "Noxis";
});
window.noxisAPI.getConfig().then(async (cfg) => {
  if (cfg) {
    applyTheme(cfg.theme || "light");
    if (typeof cfg.bubbleDuration === "number" && cfg.bubbleDuration > 0) {
      bubbleDuration = cfg.bubbleDuration;
    }
    updateActionHighlightConfig(cfg);
    if (cfg.skinPath) {
      noxisImage.src = `file://${cfg.skinPath}`;
      chatAvatar.src = `file://${cfg.skinPath}`;
    }
    if (cfg.voiceModel) modelType = cfg.voiceModel;
    micEnabled = !!cfg.allowMicrophone;
  } else {
    micEnabled = await window.noxisAPI.getMicEnabled().catch(() => false);
  }

  // Esperamos a conocer el modelo (config) antes de abrir el micrófono:
  // evita iniciar un modelo Vosk viejo si el usuario eligió Whisper (o al revés).
  console.log("[Noxis] Micrófono habilitado:", micEnabled, "| modelo:", modelType);
  if (micEnabled) startListening();
}).catch(async () => {
  micEnabled = await window.noxisAPI.getMicEnabled().catch(() => false);
  if (micEnabled) startListening();
});

// Cambio 10: restaura el historial de la sesión de voz en el chat
restoreSessionHistory();

// ---------------------------------------------------------------
// Vosk - Reconocimiento de voz offline
// ---------------------------------------------------------------
let voskModel = null;
let voskRecognizer = null;
let voskReady = false;
let voskInitializing = null; // evita lanzar dos cargas en paralelo
let audioContext = null;
let mediaStream = null;
let processor = null;
let currentGrammar = [];
let modelType = "small";

function resetVoskModel() {
  if (voskRecognizer) {
    try { voskRecognizer.remove(); } catch (e) { /* */ }
    voskRecognizer = null;
  }
  if (voskModel && typeof voskModel.terminate === "function") {
    try { voskModel.terminate(); } catch (e) { /* */ }
  }
  voskModel = null;
  voskReady = false;
}

async function refreshGrammar() {
  try {
    const g = await window.noxisAPI.getGrammar();
    currentGrammar = Array.isArray(g) ? g : [];
  } catch (err) {
    console.error("[Noxis] Error cargando gramática:", err);
    currentGrammar = [];
  }
}

// Escuchar estado de descarga del modelo
window.noxisAPI.onVoskStatus((info) => {
  console.log("[Noxis] Vosk status:", JSON.stringify(info));
  if (!info || !info.status) return;
  if (info.type && info.type !== modelType) return; // evento de otro modelo
  const { status, detail, pct } = info;

  if (status === "downloading") {
    showVoiceStatus(detail || (pct != null ? `Descargando modelo: ${pct}%` : "Descargando modelo..."));
  } else if (status === "preparing") {
    showVoiceStatus(detail || "Preparando modelo...");
  } else if (status === "ready") {
    // El modelo activo está listo. Si veníamos de un modelo distinto (o de un
    // arranque fallido), recargamos limpio con el URL correcto en vez de
    // quedarnos colgados en "Cargando modelo de voz".
    if (info.type === "whisper") {
      WHISPER.ready = true;
    } else {
      if (voskModel && !voskReady) resetVoskModel();
      voskReady = true;
    }
    showVoiceStatus("Modelo listo!");
    setTimeout(hideVoiceStatus, 2000);
    if (micEnabled) startListening();
  } else if (status === "missing") {
    voskReady = false;
    showVoiceStatus("Sin modelo de voz…");
  } else if (status === "error") {
    showMessage(detail || "Error con el modelo de voz.");
  }
});

// Espera breve (en caso de descarga que está terminando) antes de rendirse
async function getModelUrlWithRetry() {
  let modelUrl = await window.noxisAPI.getVoskModelUrl();
  for (let i = 0; i < 6 && !modelUrl; i++) {
    await new Promise((r) => setTimeout(r, 500));
    modelUrl = await window.noxisAPI.getVoskModelUrl();
  }
  return modelUrl;
}

// Consultar estado actual al cargar (por si se perdió el evento)
window.noxisAPI.getVoskStatus().then((status) => {
  console.log("[Noxis] Vosk status inicial:", status);
  if (status === "ready") {
    voskReady = true;
    if (micEnabled) startListening();
  } else if (status === "downloading") {
    showVoiceStatus("Descargando modelo de voz...");
  } else if (status === "missing") {
    showVoiceStatus("Sin modelo de voz…");
  }
}).catch(() => {});

async function initVosk() {
  if (voskReady && voskModel) return true;

  if (typeof window.Vosk === "undefined") {
    console.error("[Noxis] window.Vosk no existe. ¿Se cargó vosk.js?");
    showMessage("Biblioteca de voz no disponible.");
    return false;
  }

  if (voskInitializing) return voskInitializing;
  voskInitializing = doInitVosk();
  try {
    return await voskInitializing;
  } finally {
    voskInitializing = null;
  }
}

async function doInitVosk() {
  const modelUrl = await getModelUrlWithRetry();
  if (!modelUrl) {
    // El modelo activo aún no está instalado/listo (ej: acabamos de
    // activar el "Preciso" y se está descargando).
    console.log("[Noxis] Modelo", modelType, "aún no listo, esperando descarga...");
    showVoiceStatus("Preparando modelo de voz…");
    return false;
  }

  console.log("[Noxis] Cargando modelo Vosk desde:", modelUrl);
  const isPrecise = modelType === "precise";
  showVoiceStatus(
    isPrecise
      ? "Cargando modelo Preciso… pesa 1.5 GB y la primera vez tarda unos minutos"
      : "Cargando modelo de voz..."
  );

  // El modelo "Preciso" (~2.5GB ya extraído) tarda bastante en cargar en el
  // Web Worker de vosk-browser. Importante: NO abandonar la promesa cuando
  // tarda: si la soltamos, el modelo termina de cargar pero nadie retoma la
  // escucha ("parece que cargó pero no funciona"). Avisamos el progreso y
  // seguimos esperando; si no carga en 10 min, recién ahí pasamos a un plan B.
  let modelPromise;
  try {
    modelPromise = window.Vosk.createModel(modelUrl, 0);
  } catch (err) {
    console.error("[Noxis] Error al iniciar la carga del modelo Vosk:", err);
    showMessage("No se pudo iniciar la carga del modelo de voz.");
    return false;
  }

  const warn1 = setTimeout(() => {
    showVoiceStatus(
      isPrecise
        ? "Sigo cargando el modelo Preciso… la primera vez tarda varios minutos."
        : "Sigo cargando el modelo de voz…"
    );
  }, 45000);
  const warn2 = setTimeout(() => {
    showVoiceStatus("El modelo está tardando de más. Te aviso si no llega a cargar…");
  }, 180000);

  const settled = await Promise.race([
    modelPromise.then((m) => ({ model: m })),
    new Promise((resolve) => setTimeout(() => resolve(null), 600000)) // 10 min
  ]);

  clearTimeout(warn1);
  clearTimeout(warn2);

  if (!settled) {
    modelPromise.catch(() => {}); // ignorar un fallo tardío de la promesa abandonada
    if (isPrecise) {
      console.error("[Noxis] El modelo Preciso no cargó en 10 min → volver al Estándar");
      showMessage(
        "El modelo Preciso no pudo cargar en este equipo. Vuelvo al Estándar para que " +
        "sigas hablando conmigo; podés reintentar el Preciso desde Configuración."
      );
      resetVoskModel();
      try {
        await window.noxisAPI.setVoiceModel("small");
      } catch (e) {
        console.error("[Noxis] No pude cambiar al modelo Estándar:", e);
      }
      return false;
    }
    showMessage("El modelo de voz no cargó. Reintentá desde Configuración.");
    return false;
  }

  voskModel = settled.model;
  voskReady = true;
  console.log("[Noxis] Vosk modelo listo");
  return true;
}

// ---------------------------------------------------------------
// Fusión de turnos de voz
// Vosk corta el turno al detectar silencio (~0.5s). Si hablás lento
// con pausas, parte el comando ("pepe" / "abre" / "trabajo" por separado).
// Aquí juntamos esos pedazos y recién procesamos cuando el comando se ve
// completo o pasó suficiente silencio.
// ---------------------------------------------------------------
const FLUSH_DELAY = 1500;

const OPEN_WORDS = ["abre", "abrir", "abri", "abreme", "abrieme", "abrirme"];
const DEACT_WORDS = [
  "desactivar", "desactiva", "desactivame", "desactivate", "apaga", "apagate",
  "apagar", "duerme", "duermete", "dormir", "detente", "descansa", "callate",
  "off", "standby"
];

let utteranceBuffer = "";
let flushTimer = null;

function shouldFlushImmediately(text) {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;

  const last = tokens[tokens.length - 1];
  if (DEACT_WORDS.includes(last)) return true; // termina en "desactiva/duerme/..."
  if (tokens.length >= 3) return true;         // frase completa (nombre + verbo + keyword)
  if (/^(hola|buenas|buenos|adios|chao|gracias|quien|como)\b/.test(text.toLowerCase())) return true;

  return false;
}

function flushUtterance() {
  clearTimeout(flushTimer);
  flushTimer = null;
  const text = utteranceBuffer.trim();
  utteranceBuffer = "";
  if (!text) return;
  processFinalText(text);
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushUtterance, FLUSH_DELAY);
}

function createVoskRecognizer() {
  if (!voskModel) return null;

  voskRecognizer = currentGrammar.length
    ? new voskModel.KaldiRecognizer(16000, JSON.stringify(currentGrammar))
    : new voskModel.KaldiRecognizer(16000);

  voskRecognizer.on("result", async (message) => {
    const chunk = (message.result && message.result.text || "").trim();
    if (chunk) {
      utteranceBuffer = utteranceBuffer ? utteranceBuffer + " " + chunk : chunk;
      if (shouldFlushImmediately(utteranceBuffer)) {
        flushUtterance();
        return;
      }
      scheduleFlush();
    }
  });

  voskRecognizer.on("partialresult", (message) => {
    const partial = message.result.partial;
    if (isDormant) {
      // Dormida: no mostrar lo que decimos, solo el estado (evita
      // la sensación de que nos espía aunque el mic siga captando
      // para poder despertar por el nombre).
      showVoiceStatus("💤 Dormida — di su nombre");
      return;
    }
    if (partial) {
      showVoiceStatus('"' + partial + '"');
      // Hay audio en curso: si hay texto en cola, retrasamos el flush
      if (utteranceBuffer) scheduleFlush();
    }
  });

  return voskRecognizer;
}

// Procesa un turno completo de voz (enviado al main "get-response")
async function processFinalText(text) {
  console.log("[Noxis] VOZ FINAL:", text);
  showVoiceStatus("Procesando...");
  addChatMessage(text, "user", true);

  try {
    const response = await window.noxisAPI.sendMessage(text);
    console.log("[Noxis] Respuesta:", response);
    if (response && response.trim() !== "") {
      showMessage(response);
      addChatMessage(response, "noxis", true);
    }
  } catch (err) {
    console.error("[Noxis] Error al enviar:", err);
  }

  if (isDormant) {
    showVoiceStatus("💤 Dormida — di su nombre");
  } else {
    hideVoiceStatus();
  }
}

async function startAudioCapture() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);

    // ScriptProcessorNode captura AudioBuffer y lo envía a Vosk
    // 2048 muestras = 128ms por lote (media la latencia vs 4096)
    processor = audioContext.createScriptProcessor(2048, 1, 1);

    processor.onaudioprocess = (event) => {
      if (!isListening) return;
      if (modelType === "whisper") {
        handleWhisperAudio(event.inputBuffer.getChannelData(0));
        return;
      }
      if (!voskRecognizer) return;
      try {
        voskRecognizer.acceptWaveform(event.inputBuffer);
      } catch (e) {
        console.error("[Noxis] acceptWaveform error:", e);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    console.log("[Noxis] Audio capture iniciado");
    return true;

  } catch (err) {
    console.error("[Noxis] Error getUserMedia:", err);
    if (err.name === "NotAllowedError") {
      showMessage("Permiso de micrófono denegado.");
    } else {
      showMessage("No se pudo acceder al micrófono.");
    }
    return false;
  }
}

function stopAudioCapture() {
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  console.log("[Noxis] Audio capture detenido");
}

// ---------------------------------------------------------------
// Whisper (GPU local vía Ollama) - transcripción por fragmentos
// ---------------------------------------------------------------
const WHISPER = {
  ready: false,
  buf: [],        // muestras Float32 del segmento en curso
  extra: [],      // muestras capturadas mientras se transcribe
  speaking: false,
  silenceFrames: 0,
  speechFrames: 0,
  sending: false,
  noiseFloor: 0.005
};

const WHISPER_FRAME = 2048;
const WHISPER_MAX_LEN = 12 * 16000;

function whisperRms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function resetWhisperVad() {
  WHISPER.buf = [];
  WHISPER.extra = [];
  WHISPER.speaking = false;
  WHISPER.silenceFrames = 0;
  WHISPER.speechFrames = 0;
  WHISPER.sending = false;
  WHISPER.noiseFloor = 0.005;
}

function handleWhisperAudio(frame) {
  const rms = whisperRms(frame);
  const threshold = Math.max(0.008, WHISPER.noiseFloor * 3.5);
  const target = WHISPER.sending ? WHISPER.extra : WHISPER.buf;

  if (rms > threshold) {
    WHISPER.silenceFrames = 0;
    WHISPER.speechFrames++;
    if (!WHISPER.speaking && WHISPER.speechFrames >= 2) WHISPER.speaking = true;
    for (let i = 0; i < frame.length; i++) target.push(frame[i]);
  } else if (WHISPER.speaking) {
    for (let i = 0; i < frame.length; i++) target.push(frame[i]);
    if (++WHISPER.silenceFrames >= 10) finishWhisperSegment(false); // ~1.6 s de silencio
  } else {
    WHISPER.speechFrames = 0;
    WHISPER.noiseFloor = WHISPER.noiseFloor + 0.02 * (rms - WHISPER.noiseFloor);
  }

  if (WHISPER.sending) {
    if (WHISPER.extra.length > WHISPER_MAX_LEN) {
      WHISPER.extra.splice(0, WHISPER.extra.length - WHISPER_MAX_LEN);
    }
  } else if (WHISPER.buf.length > WHISPER_MAX_LEN) {
    finishWhisperSegment(true);
  }
}

function finishWhisperSegment(force) {
  const samples = WHISPER.buf;
  WHISPER.buf = [];
  WHISPER.speaking = false;
  WHISPER.speechFrames = 0;
  WHISPER.silenceFrames = 0;

  if (!force && samples.length < 8000) { // < 0.5 s: descartar
    moveWhisperExtra();
    return;
  }
  if (WHISPER.sending) {
    WHISPER.extra = samples.concat(WHISPER.extra);
    return;
  }
  startWhisperSend(samples);
}

function moveWhisperExtra() {
  if (WHISPER.extra.length) {
    WHISPER.buf = WHISPER.extra;
    WHISPER.extra = [];
    WHISPER.speaking = true;
    if (WHISPER.buf.length > WHISPER_MAX_LEN) finishWhisperSegment(true);
  }
}

async function startWhisperSend(samples) {
  WHISPER.sending = true;
  showVoiceStatus("Entendiendo…");
  try {
    const res = await window.noxisAPI.whisperTranscribe(samples);
    if (res && res.ok && res.text) {
      processFinalText(res.text);
    } else {
      if (isDormant) showVoiceStatus("💤 Dormida — di su nombre");
      else hideVoiceStatus();
    }
  } catch (err) {
    console.error("[Noxis] Error transcribiendo:", err);
    if (isDormant) showVoiceStatus("💤 Dormida — di su nombre");
    else hideVoiceStatus();
  } finally {
    WHISPER.sending = false;
    const leftover = WHISPER.extra;
    WHISPER.extra = [];
    if (!isListening) return;
    if (leftover.length) {
      WHISPER.buf = leftover;
      WHISPER.speaking = true;
    }
  }
}

async function ensureWhisperReady() {
  if (WHISPER.ready) return true;
  try {
    const st = await window.noxisAPI.getWhisperStatus();
    if (st && st.ready) {
      WHISPER.ready = true;
      return true;
    }
    if (st && st.pulling) {
      showVoiceStatus(`Descargando Whisper… ${st.pullPct != null ? st.pullPct + "%" : ""}`);
    } else if (st && st.lastError) {
      showVoiceStatus("Whisper no disponible: " + st.lastError);
    } else {
      showVoiceStatus("Preparando Whisper… (primera vez descarga ~600 MB)");
    }
  } catch (err) {
    showVoiceStatus("Preparando Whisper…");
  }
  return false;
}

// ---------------------------------------------------------------
// Escucha continua
// ---------------------------------------------------------------
async function startListening() {
  if (isListening || isStarting) return;
  console.log("[Noxis] startListening(). micEnabled:", micEnabled);

  if (!micEnabled) return;
  isStarting = true;

  if (modelType === "whisper") {
    const wok = await ensureWhisperReady();
    if (!wok) {
      isStarting = false;
      return;
    }
  } else {
    const ready = await initVosk();
    if (!ready) {
      isStarting = false;
      return;
    }
  }

  await refreshGrammar();

  if (modelType !== "whisper") {
    createVoskRecognizer();
    if (!voskRecognizer) {
      isStarting = false;
      showMessage("No pude crear el reconocedor de voz.");
      return;
    }
  }

  const audioOk = await startAudioCapture();
  if (!audioOk) {
    isStarting = false;
    return;
  }

  isListening = true;
  isStarting = false;
  console.log("[Noxis] Escucha continua activa con Vosk");
  showVoiceStatus("Escuchando...");
  setTimeout(() => {
    if (!isDormant) hideVoiceStatus();
  }, 1500);
}

function stopListening() {
  console.log("[Noxis] stopListening()");
  isListening = false;
  clearTimeout(flushTimer);
  flushTimer = null;
  utteranceBuffer = "";
  stopAudioCapture();
  resetWhisperVad();
  if (voskRecognizer) {
    try { voskRecognizer.remove(); } catch (e) { /* */ }
    voskRecognizer = null;
  }
  hideVoiceStatus();
}

// Recrea el recognizer (tras un cambio de config) para usar la gramática nueva
async function restartRecognizer() {
  if (!isListening || !voskModel) return;
  await refreshGrammar();
  const old = voskRecognizer;
  if (old) {
    try { old.remove(); } catch (e) { /* */ }
  }
  voskRecognizer = null;
  createVoskRecognizer();
  if (!voskRecognizer) {
    stopListening();
    showMessage("No pude recrear el reconocedor de voz.");
  }
}
