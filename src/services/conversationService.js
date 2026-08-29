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

// src/services/conversationService.js
// Equivalente a ConversationService.cs + wake word de MainWindow.xaml.cs
// Noxis escucha siempre; responde normal sin necesitar el nombre,
// pero SOLO ejecuta apps si mencionan su nombre (o variantes de pronunciación).

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/[.,!?¡¿]/g, "")
    .trim();
}

function getWakeWord(config) {
  return normalize(config.name || "noxis");
}

// Interjecciones iniciales que suelen preceder al nombre en voz
const LEADING_FILLERS = ["hey", "ey", "oye", "eh", "ej"];

// ---------------------------------------------------------------
// Fuzzy matching (distancia de Levenshtein tolerante a errores del modelo)
// ---------------------------------------------------------------
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ¿"token" es aproximadamente igual a "target"?
// El umbral crece con la longitud normalizando la distancia de Levenshtein.
// Si se pasa un `threshold` explícito (0-1, similitud mínima requerida,
// p. ej. 0.72 = se permite hasta ~28% de diferencia de caracteres), se usa
// ese en vez del valor derivado de la longitud.
function fuzzyClose(token, target, threshold) {
  const maxLen = Math.max(token.length, target.length);
  if (maxLen <= 3) return token === target;
  const distance = editDistance(token, target);
  if (typeof threshold === "number") {
    const maxDistance = Math.floor(maxLen * (1 - Math.max(0, Math.min(1, threshold))));
    return distance <= maxDistance;
  }
  return distance <= Math.floor(maxLen / 4);
}

function tokensOf(text) {
  return (text || "").toLowerCase().split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------
// Variantes de pronunciación del nombre
// El modelo transcribe "Noxis" como "nosis", "noquis", "nokis", etc.
// Generamos todas las posibles interpretaciones de las letras difíciles.
// ---------------------------------------------------------------
function wakeWordVariants(config) {
  const base = getWakeWord(config);
  if (!base) return [];

  const set = new Set([base]);

  const letterVariants = {
    x: ["s", "ks", "cs", "gs", "js", "k", "q", "qu", "h", "cc", "gz", "c"],
    k: ["q", "c", "g", "ch", "qu"],
    q: ["k", "c", "qu"],
    z: ["s"],
    ll: ["y", "j"],
    v: ["b"],
    j: ["h", "y", "g"],
    g: ["j", "k", "gu"]
  };

  for (const [letter, replacements] of Object.entries(letterVariants)) {
    for (const rep of replacements) {
      set.add(base.split(letter).join(rep));
    }
  }

  return [...set].sort((a, b) => b.length - a.length);
}

// Busca el nombre (o una variante fuzzy) en CUALQUIER posición del texto.
// Devuelve el índice del token que lo contiene o null.
function findWakeMatch(input, config) {
  if (!input) return null;
  const tokens = tokensOf(normalize(input));
  if (!tokens.length) return null;
  const variants = wakeWordVariants(config);
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const hit = variants.find((v) => w === v || fuzzyClose(w, v, threshold));
    if (hit) return { index: i, token: w, variant: hit };
  }
  return null;
}

function isWakeWordDetected(input, config) {
  return findWakeMatch(input, config) !== null;
}

function stripWakeWord(input, config) {
  const m = findWakeMatch(input, config);
  if (!m) return (input || "").trim();
  const tokens = tokensOf(normalize(input));
  return tokens.slice(m.index + 1).join(" ");
}

// ---------------------------------------------------------------
// "Noxis desactívate" → deja de escuchar (modo dormida)
// ---------------------------------------------------------------
const DEACTIVATE_VERBS = [
  "desactivar", "desactiva", "desactivarme", "desactivame", "desactivate",
  "apagar", "apaga", "apagame", "dormir", "duerme", "duermete",
  "detente", "descansa", "calla", "callate"
];

function isDeactivateCommand(input, config) {
  if (!isWakeWordDetected(input, config)) return false;
  const rest = normalize(stripWakeWord(input, config));
  if (!rest) return false;
  if (/^(desactiv|apag|duerm|dormir|detente|descansa|callat|callar)/.test(rest)) return true;
  if (/^(off|standby)\b/.test(rest)) return true;
  if (/(para de escuchar|dejar de escuchar|deja de escuchar|parar de escuchar|deja de funcionar)/.test(rest)) return true;
  const words = rest.split(/\s+/);
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  return words.some((w) => DEACTIVATE_VERBS.some((v) => w === v || fuzzyClose(w, v, threshold)));
}

// ¿El texto (tras quitar el nombre) pide "despertar"/"vuelve"? Se usa para
// confirmar la salida del modo dormida con un mensaje coherente.
const WAKE_VERBS = [
  "vuelve", "despierta", "despertate", "despertar", "despiertate",
  "hablar", "habla", "escucha", "escucharme", "escuchas", "activa",
  "activar", "activarte", "desactivateme", "ready", "presente", "aqui"
];

function isWakeCommand(input, config) {
  if (!isWakeWordDetected(input, config)) return false;
  const rest = normalize(stripWakeWord(input, config));
  if (!rest) return false;
  if (/(volvi|despert|activ|escuch|habl)/.test(rest)) return true;
  const words = rest.split(/\s+/);
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  return words.some((w) => WAKE_VERBS.some((v) => w === v || fuzzyClose(w, v, threshold)));
}

const WAKE_RESPONSES = (name) => [
  `¡Listo! Aquí estoy, de nuevo activa. Puedes decirme "${name} abre..." para lanzar apps 🎧`,
  `¡Awakened! Te escucho otra vez 🦎 ¿En qué te ayudo?`,
  `Ya estoy despierta y escuchando. Di "${name} abre..." y el programa que quieras.`
];

function getWakeResponse(config) {
  return pick(WAKE_RESPONSES(config.name || "Noxis"));
}

// ---------------------------------------------------------------
// Vocabulario (gramática) para el recognizer de Vosk
// Restringe la salida del modelo a palabras útiles: sube muchísimo la
// precisión de comandos como "abre trabajo" o "desactívame".
// Las palabras que el modelo no conoce simplemente se ignoran (no rompen).
// ---------------------------------------------------------------
const GRAMMAR_BASE = [
  // saludos / despedidas
  "hola", "buenas", "buenos", "dias", "tardes", "noches", "chao", "adios",
  "gracias", "hasta", "luego", "pronto", "vemos", "nos",
  // conversación
  "como", "estas", "andas", "vas", "que", "cuentas", "todo", "bien", "quien",
  "eres", "sos", "sois", "puedes", "puedo", "hacer", "haces", "ayuda",
  "ayudame", "funcionas", "nombre", "mascota", "soy", "dime", "necesitas",
  "escucho", "aqui", "estoy", "cuando", "quieras", "nada", "de", "va", "muy",
  "te", "yo", "si", "claro", "vale", "perfecto", "cual", "eso", "otra",
  // abrir
  "abre", "abrir", "abri", "abreme", "abrieme", "abrirme", "aplicaciones",
  "apps", "un", "una", "el", "la", "y",
  // cerrar
  "cierra", "cerrar", "cierrame", "cerrame", "cerra", "cierre",
  "mata", "matar", "termina", "terminar", "finaliza", "finalizar",
  // desactivar / dormir
  "desactivar", "desactiva", "desactivame", "desactivate", "apagar", "apaga",
  "apagate", "dormir", "duerme", "duermete", "detente", "descansa", "deja",
  "escuchar", "vuelve", "despierta", "hablar", "oye", "espera", "apaga",
  // conectores
  "a", "con", "para", "por", "en", "se", "lo", "al", "del", "e", "o", "u"
];

function buildGrammar(config) {
  const words = new Set(GRAMMAR_BASE);

  // Variantes del nombre (el modelo no las conoce → las ignora, sin daño)
  for (const v of wakeWordVariants(config)) {
    for (const w of v.split(/\s+/)) words.add(w);
  }

  // Keywords de apps y grupos: se dividen en palabras individuales
  const addKeywords = (list) => {
    for (const item of list || []) {
      for (const kw of [item.keyword, item.name]) {
        if (!kw) continue;
        for (const w of String(kw).toLowerCase().split(/\s+/).filter(Boolean)) {
          if (w.length >= 2) words.add(w);
        }
      }
    }
  };
  addKeywords(config.apps);
  addKeywords(config.packs);

  return [...words].filter(Boolean);
}

const PATTERNS = [
  {
    test: (t) => t.length === 0,
    responses: (name) => [
      `¡Dime! Soy ${name} 👋`,
      `Te escucho, ¿qué necesitas?`,
      `Aquí estoy 🦎`
    ]
  },
  {
    test: (t) => /^(hola|ey|hey|buenas|buenos dias|buenas tardes|buenas noches|que tal|q tal)/.test(t),
    responses: (name) => [
      `¡Hola! Soy ${name} 👋`,
      `¡Qué bien verte por aquí!`,
      `Hola hola, ¿en qué te ayudo hoy?`
    ]
  },
  {
    test: (t) => /(como estas|como andas|como vas|que cuentas|todo bien)/.test(t),
    responses: () => [
      `¡Muy bien, gracias por preguntar! ¿Y tú? 😄`,
      `Todo tranquilo por aquí, listo para ayudarte.`,
      `De maravilla 🦎 ¿cómo va tu día?`
    ]
  },
  {
    test: (t) => /(gracias|te lo agradezco)/.test(t),
    responses: () => [`¡De nada! 🙌`, `Para eso estoy 😊`, `Cuando quieras.`]
  },
  {
    test: (t) => /(adios|chao|nos vemos|hasta luego|hasta pronto)/.test(t),
    responses: () => [`¡Nos vemos! 👋`, `Chao, aquí estaré si me necesitas.`, `Hasta luego 🦎`]
  },
  {
    test: (t) => /(quien eres|quien sos|quien sois|que eres|que puedes hacer|que haces|como funcionas|ayuda|ayudame)/.test(t),
    responses: (name) => [
      `Soy ${name}, tu mascota de escritorio. Háblame normal para conversar, o di mi nombre seguido de un comando (ej: "${name} abre discord") para abrir apps.`,
      `Puedo conversar contigo normal, y si me llamas por mi nombre abro tus apps o grupos. Prueba diciendo "${name} abre..." y el nombre de un programa.`
    ]
  }
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Devuelve null si no hay ningún patrón → el caller decide (silencio o fallback)
function getConversationalResponse(rawText, config) {
  const text = normalize(rawText);
  const name = config.name || "Noxis";

  for (const pattern of PATTERNS) {
    if (pattern.test(text)) {
      return pick(pattern.responses(name));
    }
  }

  return null;
}

const FALLBACK_NAMED = [
  "Eso no lo tengo en mi cerebro de mascota aún 🧠",
  "No entiendo ese comando, pero puedo abrir apps si me dices 'abre' + el nombre 🦎",
  "Mmm... no sé hacer eso. Prueba 'abre' seguido de una aplicación."
];

function getNamedFallback() {
  return pick(FALLBACK_NAMED);
}

module.exports = {
  getWakeWord,
  wakeWordVariants,
  isWakeWordDetected,
  stripWakeWord,
  isDeactivateCommand,
  isWakeCommand,
  getWakeResponse,
  getConversationalResponse,
  getNamedFallback,
  buildGrammar,
  editDistance,
  fuzzyClose,
  tokensOf
};