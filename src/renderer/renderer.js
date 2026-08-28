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
const closeChatBtn = document.getElementById("closeChatBtn");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const voiceStatus = document.getElementById("voiceStatus");
const voiceStatusText = document.getElementById("voiceStatusText");

let hideBubbleTimeout = null;
let isListening = false; // captura de audio activa (mic encendido → siempre escucha)
let isDormant = false;   // dormida: solo reacciona a su nombre
let isStarting = false;
let micEnabled = false;

// Iconos SVG
closeChatBtn.innerHTML = window.NoxisIcons.close(16);
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
  }, 8500);
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

// ---------------------------------------------------------------
// Enviar mensaje (texto)
// ---------------------------------------------------------------
async function sendCurrentInput() {
  const text = userInput.value.trim();
  if (!text) return;
  userInput.value = "";
  const response = await window.noxisAPI.sendMessage(text);
  showMessage(response);
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

window.noxisAPI.onConfigUpdated((config) => {
  chatName.textContent = config.name || "Noxis";
  applyTheme(config.isDarkMode);
  if (config.skinPath) {
    noxisImage.src = `file://${config.skinPath}`;
  }
  micEnabled = !!config.allowMicrophone;

  const nextModelType = config.voiceModel || "small";
  if (nextModelType !== modelType) {
    // Cambió el modelo de voz → recargar recognizer con la nueva URL
    modelType = nextModelType;
    const wasListening = isListening;
    if (wasListening) stopListening();
    resetVoskModel();
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

function applyTheme(isDark) {
  document.body.classList.toggle("dark", !!isDark);
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
  if (skinPath) noxisImage.src = `file://${skinPath}`;
});
window.noxisAPI.getNoxisName().then((name) => {
  chatName.textContent = name || "Noxis";
});
window.noxisAPI.getConfig().then((cfg) => {
  if (!cfg) return;
  applyTheme(cfg.isDarkMode);
  if (cfg.voiceModel) modelType = cfg.voiceModel;
}).catch(() => {});
window.noxisAPI.getMicEnabled().then((enabled) => {
  micEnabled = enabled;
  console.log("[Noxis] Micrófono habilitado:", micEnabled);
  if (micEnabled) startListening();
}).catch((err) => {
  console.error("[Noxis] Error al obtener estado del mic:", err);
});

// ---------------------------------------------------------------
// Vosk - Reconocimiento de voz offline
// ---------------------------------------------------------------
let voskModel = null;
let voskRecognizer = null;
let voskReady = false;
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
    if (voskModel && !voskReady) resetVoskModel();
    voskReady = true;
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

  const modelUrl = await getModelUrlWithRetry();
  if (!modelUrl) {
    // El modelo activo aún no está instalado/listo (ej: acabamos de activar
    // el "Preciso" y se está descargando). No fallamos en silencio: avisamos
    // y el widget arrancará cuando llegue el evento "ready" de ese modelo.
    console.log("[Noxis] Modelo", modelType, "aún no listo, esperando descarga...");
    showVoiceStatus("Preparando modelo de voz…");
    return false;
  }

  console.log("[Noxis] Cargando modelo Vosk desde:", modelUrl);
  showVoiceStatus("Cargando modelo de voz...");

  try {
    voskModel = await window.Vosk.createModel(modelUrl, 0);
    voskReady = true;
    console.log("[Noxis] Vosk modelo listo");
    return true;
  } catch (err) {
    console.error("[Noxis] Error cargando modelo Vosk:", err);
    if (/fetch|network|load/i.test(String(err && err.message))) {
      showVoiceStatus("Descarga aún en curso, reintentando…");
    } else {
      showMessage("Error cargando modelo de voz.");
    }
    return false;
  }
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

  try {
    const response = await window.noxisAPI.sendMessage(text);
    console.log("[Noxis] Respuesta:", response);
    if (response && response.trim() !== "") {
      showMessage(response);
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
      if (!isListening || !voskRecognizer) return;
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
// Escucha continua
// ---------------------------------------------------------------
async function startListening() {
  if (isListening || isStarting) return;
  console.log("[Noxis] startListening(). micEnabled:", micEnabled);

  if (!micEnabled) return;
  isStarting = true;

  const ready = await initVosk();
  if (!ready) {
    isStarting = false;
    return;
  }

  await refreshGrammar();

  createVoskRecognizer();
  if (!voskRecognizer) {
    isStarting = false;
    showMessage("No pude crear el reconocedor de voz.");
    return;
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
