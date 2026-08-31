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

// src/services/companionService.js
// Comportamiento proactivo de Noxis: detecta la app activa, habla de vez en
// cuando con frases contextuales, recuerda hidratación y genera "pensamientos
// random". Sin IA: todo es regex, temporizadores y arrays de frases fijas.

const path = require("path");
const phrases = require("./phrases.json");

// ---------------------------------------------------------------
// CONSTANTES CONFIGURABLES (ajustar sin tocar la lógica)
// ---------------------------------------------------------------

// Intervalo principal del scheduler (ms). Cada este tiempo se revisa todo.
const POLL_INTERVAL_MS = 60_000; // 1 minuto

// Cooldown mínimo entre mensajes espontáneos (ms).
// Noxis no hablará más de una vez cada COOLDOWN_MS milisegundos.
const COOLDOWN_MS = 15 * 60_000; // 15 minutos

// Probabilidad de que Noxis hable cuando se cumple el cooldown (0-1).
// 0.3 = 30% de probabilidad de hablar, 70% de quedarse callada.
const SPEAK_PROBABILITY = 0.3;

// Intervalo del recordatorio de hidratación (ms).
const HYDRATION_INTERVAL_MS = 90 * 60_000; // 90 minutos

// Intervalo de pensamientos random (ms, rango).
// Se elige un valor aleatorio entre MIN y MAX para que no sea predecible.
const RANDOM_THOUGHT_MIN_MS = 45 * 60_000; // 45 minutos
const RANDOM_THOUGHT_MAX_MS = 120 * 60_000; // 120 minutos

// Tiempo mínimo que el usuario debe estar en una app para reaccionar (ms).
// Evita reaccionar a cambios fugaces de ventanas.
const APP_DWELL_MS = 5 * 60_000; // 5 minutos

// Franjas horarias (hora inicial, hora final, excluyente al final)
const TIME_BLOCKS = [
  { id: "morning",   start: 6,  end: 12 },
  { id: "afternoon", start: 12, end: 19 },
  { id: "evening",   start: 19, end: 23 },
  { id: "night",     start: 23, end: 6  } // cruza medianoche
];

// ---------------------------------------------------------------
// ESTADO INTERNO
// ---------------------------------------------------------------

let lastMessageTime = 0;         // timestamp del último mensaje espontáneo
let lastAppCheckTime = 0;        // timestamp del último chequeo de app activa
let lastApp = null;              // nombre de la última app detectada
let appDwellStart = 0;           // timestamp de cuándo empezó la dwell actual
let hydrationTimer = null;       // setInterval de hidratación
let randomTimer = null;          // setTimeout del próximo pensamiento random
let mainLoop = null;             // setInterval del scheduler principal
let sendFn = null;               // función para enviar mensajes al widget
let configRef = null;            // referencia a config
let stopped = false;             // flag para detener

// ---------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------

function pick(list) {
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function now() {
  return Date.now();
}

function getTimeBlock() {
  const h = new Date().getHours();
  for (const block of TIME_BLOCKS) {
    if (block.start < block.end) {
      if (h >= block.start && h < block.end) return block.id;
    } else {
      // Bloque que cruza medianoche (ej: 23-6)
      if (h >= block.start || h < block.end) return block.id;
    }
  }
  return "night"; // fallback
}

function canSpeak() {
  const elapsed = now() - lastMessageTime;
  if (elapsed < COOLDOWN_MS) return false;
  // Probabilidad aleatoria
  return Math.random() < SPEAK_PROBABILITY;
}

function markSpoke() {
  lastMessageTime = now();
}

// ---------------------------------------------------------------
// DETECCIÓN DE APP ACTIVA (active-win)
// ---------------------------------------------------------------

let activeWin = null;

async function getActiveWindow() {
  try {
    if (!activeWin) {
      // Import dinámico: active-win es ESM o CJS según versión
      try {
        activeWin = require("active-win");
      } catch {
        // Si falla, intentamos import dinámico
        activeWin = (await import("active-win")).default;
      }
    }
    if (typeof activeWin === "function") {
      return await activeWin();
    }
    // active-win v8+ exporta una función default
    return null;
  } catch (err) {
    console.error("[companionService] active-win error:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------
// REACCIONES A CAMBIO DE APP
// ---------------------------------------------------------------

function getAppReaction(appName) {
  if (!appName) return null;
  const lower = appName.toLowerCase();
  // Buscar en phrases.appReactions por nombre exacto o parcial
  for (const [key, list] of Object.entries(phrases.appReactions)) {
    if (key === "default") continue;
    if (lower === key.toLowerCase() || lower.includes(key.replace(".exe", ""))) {
      return pick(list);
    }
  }
  // Reacción genérica: reemplazar {appName} en las frases default
  const generic = pick(phrases.appReactions.default);
  return generic ? generic.replace(/{appName}/g, appName) : null;
}

async function checkActiveWindow() {
  const result = await getActiveWindow();
  if (!result) return;

  const currentApp = result.name || null;
  if (!currentApp) return;

  // Si la app cambió
  if (currentApp !== lastApp) {
    const dwellStart = now();
    // Solo reaccionar si estuvo en la app anterior al menos APP_DWELL_MS
    if (lastApp && (dwellStart - appDwellStart) >= APP_DWELL_MS) {
      if (canSpeak()) {
        const reaction = getAppReaction(currentApp);
        if (reaction) {
          sendFn(reaction);
          markSpoke();
        }
      }
    }
    lastApp = currentApp;
    appDwellStart = dwellStart;
  }
}

// ---------------------------------------------------------------
// SALUDO POR HORA DEL DÍA
// ---------------------------------------------------------------

function getGreeting() {
  const block = getTimeBlock();
  const lines = phrases.timeOfDay[block];
  return pick(lines);
}

// ---------------------------------------------------------------
// RECORDATORIO DE HIDRATACIÓN
// ---------------------------------------------------------------

function getHydrationMessage() {
  return pick(phrases.hydration);
}

function startHydrationTimer() {
  if (hydrationTimer) clearInterval(hydrationTimer);
  hydrationTimer = setInterval(() => {
    if (stopped) return;
    if (!configRef || !configRef.companionEnabled) return;
    if (canSpeak()) {
      sendFn(getHydrationMessage());
      markSpoke();
    }
  }, HYDRATION_INTERVAL_MS);
}

// ---------------------------------------------------------------
// PENSAMIENTOS RANDOM
// ---------------------------------------------------------------

function scheduleRandomThought() {
  if (randomTimer) clearTimeout(randomTimer);
  if (stopped) return;
  const delay = RANDOM_THOUGHT_MIN_MS + Math.random() * (RANDOM_THOUGHT_MAX_MS - RANDOM_THOUGHT_MIN_MS);
  randomTimer = setTimeout(() => {
    if (stopped) return;
    if (!configRef || !configRef.companionEnabled) {
      scheduleRandomThought(); // reprogramar aunque esté deshabilitado
      return;
    }
    if (canSpeak()) {
      const thought = pick(phrases.randomThoughts);
      if (thought) {
        sendFn(thought);
        markSpoke();
      }
    }
    scheduleRandomThought(); // reprogramar el próximo
  }, delay);
}

// ---------------------------------------------------------------
// SCHEDULER PRINCIPAL
// ---------------------------------------------------------------

function poll() {
  if (stopped) return;
  if (!configRef || !configRef.companionEnabled) return;
  checkActiveWindow();
}

function startMainLoop() {
  if (mainLoop) clearInterval(mainLoop);
  mainLoop = setInterval(poll, POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------
// API PÚBLICA
// ---------------------------------------------------------------

/**
 * Inicia el comportamiento companion.
 * @param {function} sendMessage - Función(msg) para enviar mensajes al widget
 * @param {object} config - Configuración actual de Noxis
 */
function start(sendMessage, config) {
  sendFn = sendMessage;
  configRef = config;
  stopped = false;
  lastMessageTime = now() - COOLDOWN_MS; // permitir mensaje inmediato

  // Saludo inicial con la hora del día
  const greeting = getGreeting();
  if (greeting) {
    // Pequeño delay para que no se pise con el saludo de main.js
    setTimeout(() => {
      if (!stopped && sendFn) sendFn(greeting);
    }, 3000);
  }

  // Iniciar timers
  startHydrationTimer();
  scheduleRandomThought();
  startMainLoop();

  console.log("[companionService] Iniciado. Cooldown:", COOLDOWN_MS / 60000, "min, Probabilidad:", SPEAK_PROBABILITY);
}

/**
 * Actualiza la referencia de config (cuando el usuario cambia configuración).
 */
function updateConfig(config) {
  configRef = config;
}

/**
 * Detiene todos los temporizadores.
 */
function stop() {
  stopped = true;
  if (mainLoop) clearInterval(mainLoop);
  if (hydrationTimer) clearInterval(hydrationTimer);
  if (randomTimer) clearTimeout(randomTimer);
  mainLoop = null;
  hydrationTimer = null;
  randomTimer = null;
  console.log("[companionService] Detenido.");
}

/**
 * Devuelve la hora del día actual (para uso externo).
 */
function getCurrentTimeBlock() {
  return getTimeBlock();
}

/**
 * Devuelve un saludo de la hora actual.
 */
function getNowGreeting() {
  return getGreeting();
}

module.exports = {
  start,
  stop,
  updateConfig,
  getCurrentTimeBlock,
  getNowGreeting,
  // Exponer constantes para que main.js pueda ajustar config
  COOLDOWN_MS,
  HYDRATION_INTERVAL_MS,
  SPEAK_PROBABILITY
};
