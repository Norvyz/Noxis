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

// src/services/systemCommandHandler.js
// Parsea comandos de voz del sistema y despacha a systemService.
// Sin dependencias de IA: regex + fuzzy match (Levenshtein) sobre tokens.

const systemService = require("./systemService");
const voiceMatcher = require("./voiceMatcher");

// Re-exportar desde voiceMatcher para compatibilidad
const normalize = voiceMatcher.normalize;
const fuzzyClose = voiceMatcher.fuzzyClose;
const tokensOf = voiceMatcher.tokensOf;

// ---------------------------------------------------------------
// Estado de confirmación (shutdown / restart)
// ---------------------------------------------------------------
let pendingConfirmation = null; // { type, timeout }

function clearPending() {
  if (pendingConfirmation && pendingConfirmation.timeout) {
    clearTimeout(pendingConfirmation.timeout);
  }
  pendingConfirmation = null;
}

function setPending(type) {
  clearPending();
  pendingConfirmation = {
    type,
    timeout: setTimeout(() => {
      pendingConfirmation = null;
    }, 10000)
  };
}

function hasPending() {
  return pendingConfirmation !== null;
}

function getPendingType() {
  return pendingConfirmation ? pendingConfirmation.type : null;
}

// ---------------------------------------------------------------
// Estado de volumen pendiente (esperando número 1-100)
// ---------------------------------------------------------------
let pendingVolume = null; // { timeout }

function clearPendingVolume() {
  if (pendingVolume && pendingVolume.timeout) {
    clearTimeout(pendingVolume.timeout);
  }
  pendingVolume = null;
}

function setPendingVolume() {
  clearPendingVolume();
  pendingVolume = {
    timeout: setTimeout(() => {
      pendingVolume = null;
    }, 10000)
  };
}

function hasPendingVolume() {
  return pendingVolume !== null;
}

// ---------------------------------------------------------------
// Detección de "cancela" / "confirmar"
// ---------------------------------------------------------------
const CANCEL_WORDS = ["cancela", "cancelar", "cancelalo", "no", "para", "detente"];
const CONFIRM_WORDS = ["confirmar", "confirmalo", "si", "dale", "ok", "vale", "acepto", "hazlo", "ejecuta"];

function isCancelCommand(text) {
  const t = normalize(text);
  if (!t) return false;
  if (CANCEL_WORDS.some((w) => t === w)) return true;
  const tokens = tokensOf(t);
  return tokens.some((w) => CANCEL_WORDS.some((cw) => w === cw || fuzzyClose(w, cw, 0.75)));
}

function isConfirmCommand(text) {
  const t = normalize(text);
  if (!t) return false;
  if (CONFIRM_WORDS.some((w) => t === w)) return true;
  const tokens = tokensOf(t);
  return tokens.some((w) => CONFIRM_WORDS.some((cw) => w === cw || fuzzyClose(w, cw, 0.75)));
}

// ---------------------------------------------------------------
// Detección de comandos del sistema (patrones regex + fuzzy)
// ---------------------------------------------------------------

// 1) Mover ventana
const CORNER_PATTERNS = [
  { regex: /(?:arriba|superior)\s*(?:izquierda|izq|izqda)/, corner: "top-left" },
  { regex: /(?:arriba|superior)\s*(?:derecha|der|dcha)/, corner: "top-right" },
  { regex: /(?:abajo|inferior)\s*(?:izquierda|izq|izqda)/, corner: "bottom-left" },
  { regex: /(?:abajo|inferior)\s*(?:derecha|der|dcha)/, corner: "bottom-right" },
  { regex: /centro|medio|centro/, corner: "center" }
];

const MOVE_VERBS = ["muevete", "muévete", "movete", "andan", "colocate", "posicionate", "ve", "andate", "vete"];
const CORNER_WORDS = ["esquina", "rincon", "rincón", "lado", "parte"];

// 2) Cerrar apps
const CLOSE_VERBS = ["cierra", "cerrar", "cierrame", "cierrale", "mate", "mata", "matar", "cierralo"];
const CLOSE_APP_WORDS = ["app", "aplicacion", "aplicación", "programa", "apps"];

// 3) Crear carpeta
const CREATE_FOLDER_VERBS = ["crea", "crear", "genera", "generar", "haz", "hacer", "armar", "arma"];
const FOLDER_WORDS = ["carpeta", "carpetas", "directorio", "directorio"];

// 4) Crear nota / bloc de notas
const NOTE_VERBS = ["crea", "crear", "genera", "generar", "haz", "hacer"];
const NOTE_WORDS = ["bloc", "nota", "notas", "block", "archivo", "texto"];

// 5) Volumen
const VOLUME_UP_VERBS = ["sube", "subir", "aumenta", "aumentar", "subilo", "mas"];
const VOLUME_DOWN_VERBS = ["baja", "bajar", "reduce", "reducir", "bajalo", "menos"];
const VOLUME_MUTE_VERBS = ["silencia", "silenciar", "mutear", "mute", "silencio", "calla"];
const VOLUME_UNMUTE_VERBS = ["quita", "quitale", "desilencia", "desmutear", "desmutea"];
const VOLUME_SET_VERBS = ["pon", "poner", "ajusta", "ajustar", "deja", "dejar", "coloca", "colocar"];
const VOLUME_GET_VERBS = ["cuanto", "cuánto", "cual", "cuál", "dime", "consultar", "consulta"];
const VOLUME_WORDS = ["volumen", "audio", "sonido"];

// 6) Bloquear pantalla
const LOCK_VERBS = ["bloquea", "bloquear", "bloqueate", "bloquealo", "lock"];

// 7) Apagar
const SHUTDOWN_VERBS = ["apaga", "apagar", "apagate", "apagado", "shutdown"];

// 8) Reiniciar
const RESTART_VERBS = ["reinicia", "reiniciar", "reinicialo", "reboot", "restart"];

// ---------------------------------------------------------------
// Funciones auxiliares de匹配
// ---------------------------------------------------------------

function hasAnyToken(text, wordList) {
  const tokens = tokensOf(text);
  return tokens.some((w) => wordList.some((v) => w === v || fuzzyClose(w, v, 0.7)));
}

function extractAfter(text, triggerWords) {
  const tokens = tokensOf(text);
  for (let i = 0; i < tokens.length; i++) {
    if (triggerWords.some((v) => tokens[i] === v || fuzzyClose(tokens[i], v, 0.7))) {
      return tokens.slice(i + 1).join(" ");
    }
  }
  return text;
}

function matchCorner(text) {
  const t = normalize(text);
  for (const p of CORNER_PATTERNS) {
    if (p.regex.test(t)) return p.corner;
  }
  // Fuzzy: detectar combinaciones de tokens
  const tokens = tokensOf(t);
  const hasTop = tokens.some((w) => /arr|sup/.test(w) || fuzzyClose(w, "arriba", 0.6));
  const hasBottom = tokens.some((w) => /abaj|inf/.test(w) || fuzzyClose(w, "abajo", 0.6));
  const hasLeft = tokens.some((w) => /izq|iz/.test(w) || fuzzyClose(w, "izquierda", 0.6));
  const hasRight = tokens.some((w) => /der|de/.test(w) || fuzzyClose(w, "derecha", 0.6));
  const hasCenter = tokens.some((w) => /centr|medi/.test(w) || fuzzyClose(w, "centro", 0.6));

  if (hasCenter) return "center";
  if (hasTop && hasLeft) return "top-left";
  if (hasTop && hasRight) return "top-right";
  if (hasBottom && hasLeft) return "bottom-left";
  if (hasBottom && hasRight) return "bottom-right";
  return null;
}

function extractAppName(text, verbList) {
  let t = normalize(text);
  // Quitar verbos de cierre
  for (const v of verbList) {
    t = t.replace(new RegExp("\\b" + v + "\\b", "g"), "");
  }
  // Quitar palabras de contexto
  const ctxWords = ["la", "el", "los", "las", "una", "un", "lo", "al", "del",
    "app", "aplicacion", "aplicación", "programa", "apps", "que", "esta",
    "abierta", "abierto", "abiertas", "abiertos"];
  for (const cw of ctxWords) {
    t = t.replace(new RegExp("\\b" + cw + "\\b", "g"), "");
  }
  return t.replace(/\s+/g, " ").trim();
}

function extractFolderName(text) {
  let t = normalize(text);
  // Quitar verbos
  for (const v of CREATE_FOLDER_VERBS) {
    t = t.replace(new RegExp("\\b" + v + "\\b", "g"), "");
  }
  // Quitar palabras de contexto
  const ctxWords = ["una", "un", "el", "la", "carpeta", "carpetas", "directorio",
    "llamada", "llamado", "nombre", "que", "se", "llame", "diga", "como", "tipo"];
  for (const cw of ctxWords) {
    t = t.replace(new RegExp("\\b" + cw + "\\b", "g"), "");
  }
  // Extraer ubicación si existe
  const locationMatch = t.match(/\ben\s+(el\s+)?(escritorio|documentos|descargas|descarga|musica|videos|imagenes|inicio)/);
  let location = null;
  let name = t;
  if (locationMatch) {
    location = locationMatch[2];
    name = t.replace(/\ben\s+(el\s+)?(escritorio|documentos|descargas|descarga|musica|videos|imagenes|inicio)/, "");
  }
  name = name.replace(/\s+/g, " ").trim();
  return { name: name || null, location };
}

function extractNoteName(text) {
  let t = normalize(text);
  // Detectar "bloc de notas" sin nombre → nota genérica
  if (/bloc\s*(?:de\s*)?notas/.test(t)) {
    return { name: null, isGeneric: true };
  }
  // Quitar verbos
  for (const v of NOTE_VERBS) {
    t = t.replace(new RegExp("\\b" + v + "\\b", "g"), "");
  }
  // Quitar palabras de contexto
  const ctxWords = ["una", "un", "el", "la", "nota", "notas", "bloc", "block",
    "de", "notas", "llamada", "llamado", "nombre", "que", "se", "llame",
    "diga", "como", "tipo", "archivo", "texto"];
  for (const cw of ctxWords) {
    t = t.replace(new RegExp("\\b" + cw + "\\b", "g"), "");
  }
  const cleanName = t.replace(/\s+/g, " ").trim();
  return { name: cleanName || null, isGeneric: false };
}

function extractVolumePercent(text) {
  const t = normalize(text);
  // Buscar número antes de "por ciento" o solo un número
  const match = t.match(/(\d{1,3})\s*(?:por\s*ciento|%)/);
  if (match) {
    const val = parseInt(match[1], 10);
    if (val >= 0 && val <= 100) return val;
  }
  // Solo número
  const numMatch = t.match(/\b(\d{1,3})\b/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (val >= 0 && val <= 100) return val;
  }
  return null;
}

// ---------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------

/**
 * Intenta ejecutar un comando del sistema.
 * @param {string} text - Texto sin wake word
 * @param {object} config - Configuración de Noxis
 * @param {function} onMessage - Callback para enviar mensajes al widget
 * @param {object} mainWindow - BrowserWindow principal (para mover)
 * @returns {Promise<string|null>} Respuesta para el widget, o null si no es comando del sistema
 */
async function handleCommand(text, config, onMessage, mainWindow) {
  const t = normalize(text);

  // --- Volumen pendiente: esperando número ---
  if (hasPendingVolume()) {
    const pct = extractVolumePercent(t);
    if (pct !== null) {
      clearPendingVolume();
      await systemService.setVolume(pct);
      return `Volumen ajustado a ${pct}% 🔊`;
    }
    // Si no pudo extraer número, informar
    return "No entendí el número. Di un valor del 0 al 100.";
  }

  // --- Confirmación pendiente ---
  if (hasPending()) {
    const pendingType = getPendingType();

    if (isCancelCommand(t)) {
      clearPending();
      return "Cancelado 👍";
    }

    if (isConfirmCommand(t)) {
      clearPending();
      if (pendingType === "shutdown") {
        onMessage("Apagando el PC en 5 segundos...");
        await systemService.systemShutdown(5);
        return "PC apagándose 💤";
      }
      if (pendingType === "restart") {
        onMessage("Reiniciando el PC en 5 segundos...");
        await systemService.systemRestart();
        return "PC reiniciando 🔄";
      }
    }

    // Si hay pending pero no es confirm/cancel, informar
    return `Tengo pendiente un ${pendingType === "shutdown" ? "apagado" : "reinicio"}. Di "confirmar" o "cancela".`;
  }

  // --- 1) Mover ventana ---
  if (hasAnyToken(t, MOVE_VERBS) || /\bmuev/.test(t) || /\banda/.test(t) || /\bcoloca/.test(t) || /\bposiciona/.test(t)) {
    const hasCornerWord = hasAnyToken(t, CORNER_WORDS) || /\besquina/.test(t) || /\brincon/.test(t);
    const corner = matchCorner(t);
    if (corner) {
      const result = systemService.moveWindowToCorner(mainWindow, corner);
      if (result.ok) {
        const labels = {
          "top-left": "esquina superior izquierda",
          "top-right": "esquina superior derecha",
          "bottom-left": "esquina inferior izquierda",
          "bottom-right": "esquina inferior derecha",
          "center": "el centro"
        };
        return `Me moví a ${labels[corner]} 📍`;
      }
      return "No pude moverme 😕";
    }
    // Si detectó verbo de movimiento pero no la esquina
    if (hasAnyToken(t, MOVE_VERBS) || /\bmuev/.test(t)) {
      return "¿A dónde me muevo? Di una esquina (superior izquierda, inferior derecha...) o centro.";
    }
  }

  // --- 2) Cerrar apps ---
  if (hasAnyToken(t, CLOSE_VERBS) || /\bcierr/.test(t) || /\bmat/.test(t)) {
    const appName = extractAppName(t, CLOSE_VERBS);
    if (appName) {
      // Buscar en config.apps para obtener el keyword real
      const appConfig = (config.apps || []).find(
        (a) => normalize(a.keyword) === appName || fuzzyClose(normalize(a.keyword), appName, 0.7)
      );
      const procName = appConfig ? appConfig.keyword : appName;
      const result = await systemService.closeApp(procName);
      if (result.ok) {
        return `Cerré ${result.process} ✅`;
      }
      if (result.reason === "not-found") {
        return `No encontré ${result.process} abierto 😕`;
      }
      return `No pude cerrar ${result.process} 😕`;
    }
    return "¿Qué aplicación quiero cerrar? Di 'cierra' seguido del nombre.";
  }

  // --- 3) Crear carpeta ---
  if (hasAnyToken(t, CREATE_FOLDER_VERBS) && hasAnyToken(t, FOLDER_WORDS)) {
    const { name, location } = extractFolderName(t);
    if (name) {
      const result = await systemService.createFolder(name, location);
      if (result.ok) {
        const locLabel = location || "escritorio";
        if (result.exists) {
          return `Ya existe una carpeta "${result.name}" en ${locLabel} 📁`;
        }
        return `Carpeta "${result.name}" creada en ${locLabel} 📁`;
      }
      return `No pude crear la carpeta 😕 ${result.reason || ""}`;
    }
    return "¿Cómo quiero que se llame la carpeta? Di 'crea una carpeta llamada' seguido del nombre.";
  }

  // --- 4) Crear nota / bloc de notas ---
  if (hasAnyToken(t, NOTE_VERBS) && hasAnyToken(t, NOTE_WORDS)) {
    const { name, isGeneric } = extractNoteName(t);
    if (isGeneric || !name) {
      const fileName = "nota.txt";
      const result = await systemService.createTextFile(fileName);
      if (result.ok) {
        const { shell } = require("electron");
        shell.openPath(result.path);
        return `Nota creada y abierta 📝`;
      }
      return `No pude crear la nota 😕 ${result.reason || ""}`;
    }
    const result = await systemService.createTextFile(name);
    if (result.ok) {
      const { shell } = require("electron");
      shell.openPath(result.path);
      return `Nota "${result.name}" creada y abierta 📝`;
    }
    return `No pude crear la nota 😕 ${result.reason || ""}`;
  }

  // --- 5) Consultar volumen ---
  if (hasAnyToken(t, VOLUME_GET_VERBS) && hasAnyToken(t, VOLUME_WORDS)) {
    const result = await systemService.getVolume();
    if (result.ok) {
      return `Volumen actual: ${result.volume}% 🔊`;
    }
    return "No pude leer el volumen 😕";
  }

  // --- 6) Silenciar / quitar silencio ---
  if (hasAnyToken(t, VOLUME_MUTE_VERBS) && hasAnyToken(t, VOLUME_WORDS)) {
    await systemService.muteToggle();
    return "Silencio activado 🔇";
  }
  if (hasAnyToken(t, VOLUME_UNMUTE_VERBS) && hasAnyToken(t, VOLUME_WORDS)) {
    await systemService.muteToggle();
    return "Silencio desactivado 🔊";
  }

  // --- 7) Subir volumen → preguntar número ---
  if (hasAnyToken(t, VOLUME_UP_VERBS) && hasAnyToken(t, VOLUME_WORDS)) {
    setPendingVolume();
    return "¿A qué nivel? Dime un número del 0 al 100.";
  }

  // --- 8) Bajar volumen → preguntar número ---
  if (hasAnyToken(t, VOLUME_DOWN_VERBS) && hasAnyToken(t, VOLUME_WORDS)) {
    setPendingVolume();
    return "¿A qué nivel? Dime un número del 0 al 100.";
  }

  // --- 9) Poner volumen a porcentaje ---
  if (hasAnyToken(t, VOLUME_SET_VERBS) && hasAnyToken(t, VOLUME_WORDS)) {
    const pct = extractVolumePercent(t);
    if (pct !== null) {
      await systemService.setVolume(pct);
      return `Volumen ajustado a ${pct}% 🔊`;
    }
    return "¿A qué porcentaje? Di 'pon el volumen al' seguido de un número del 0 al 100.";
  }

  // --- 10) Bloquear pantalla ---
  if (hasAnyToken(t, LOCK_VERBS) || /\bbloque/.test(t)) {
    const result = await systemService.lockScreen();
    if (result.ok) return "Pantalla bloqueada 🔒";
    return "No pude bloquear la pantalla 😕";
  }

  // --- 11) Apagar PC (con confirmación) ---
  if (hasAnyToken(t, SHUTDOWN_VERBS) || /\bapaga/.test(t)) {
    // Excluir "apaga" como parte de "apaga el volumen" etc.
    if (hasAnyToken(t, VOLUME_WORDS)) return null;
    setPending("shutdown");
    return "¿Seguro que quieres apagar el PC? Di confirmar o cancela dentro de 10 segundos.";
  }

  // --- 12) Reiniciar PC (con confirmación) ---
  if (hasAnyToken(t, RESTART_VERBS) || /\breinici/.test(t)) {
    setPending("restart");
    return "¿Seguro que quieres reiniciar el PC? Di confirmar o cancela dentro de 10 segundos.";
  }

  // No es un comando del sistema
  return null;
}

module.exports = {
  handleCommand,
  hasPending,
  clearPending,
  hasPendingVolume,
  clearPendingVolume
};
