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

const voiceMatcher = require("./voiceMatcher");

// Re-exportar normalize, fuzzyClose, editDistance, tokensOf desde voiceMatcher
// para compatibilidad con módulos que los importen de acá.
const normalize = voiceMatcher.normalize;
const fuzzyClose = voiceMatcher.fuzzyClose;
const editDistance = voiceMatcher.editDistance;
const tokensOf = voiceMatcher.tokensOf;

function getWakeWord(config) {
  return normalize(config.name || "noxis");
}

// Interjecciones iniciales que suelen preceder al nombre en voz
const LEADING_FILLERS = ["hey", "ey", "oye", "eh", "ej"];

// ---------------------------------------------------------------
// Variantes de pronunciación del nombre
// El modelo transcribe "Noxis" como "nosis", "noquis", "nokis", etc.
// Generamos todas las posibles interpretaciones de las letras difíciles.
// ---------------------------------------------------------------

let _wakeVariantsCache = null;
let _wakeVariantsName = "";

function wakeWordVariants(config) {
  const base = getWakeWord(config);
  if (!base) return [];

  // Cachear si el nombre no cambió
  if (_wakeVariantsCache && _wakeVariantsName === base) {
    return _wakeVariantsCache;
  }

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

  _wakeVariantsCache = [...set].sort((a, b) => b.length - a.length);
  _wakeVariantsName = base;
  return _wakeVariantsCache;
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
  "detente", "calla", "callate"
];

function isDeactivateCommand(input, config) {
  if (!isWakeWordDetected(input, config)) return false;
  const rest = normalize(stripWakeWord(input, config));
  if (!rest) return false;

  // Excluir comandos del sistema: "apaga el pc", "apaga la computadora", "apaga pc", "apaga ps"...
  // Estos NO son desactivaciones, sino comandos de apagado del sistema.
  const SYSTEM_CONTEXT_WORDS = ["pc", "ps", "computadora", "equipo", "ordenador", "computer"];
  const tokens = rest.split(/\s+/);
  const hasSystemContext = tokens.some((w) => SYSTEM_CONTEXT_WORDS.includes(w));

  // "apaga <algo>" (más texto tras "apaga" que no sea solo te/me/lo) = apagar algo
  // concreto, NUNCA el modo dormida (ahí msivamos por si Vosk reconoce "ps" en vez de "pc").
  const isApagarAlgo =
    /^apaga\b/.test(rest) &&
    !/^apaga\s*(te|me|lo)?\s*$/.test(rest) &&
    !/^apagame\b/.test(rest);

  if (hasSystemContext || isApagarAlgo) return false;

  if (/^(desactiv|duerm|dormir|detente|callat|callar)/.test(rest)) return true;
  if (/^apaga\s*(te|me|lo)?$/.test(rest)) return true;
  if (/^apagame$/.test(rest)) return true;
  if (/^(off|standby)\b/.test(rest)) return true;
  if (/(para de escuchar|dejar de escuchar|deja de escuchar|parar de escuchar|deja de funcionar)/.test(rest)) return true;
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  // Solo matchear verbos de desactivación SI la frase NO empieza por "apaga algo".
  return tokens.some((w) => {
    if (/^apaga/.test(w)) return false;
    return DEACTIVATE_VERBS.some((v) => w === v || fuzzyClose(w, v, threshold));
  });
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
// Se genera automáticamente desde dictionary.json via voiceMatcher.
// Para agregar palabras, editá src/services/dictionary.json en vez
// de tocar este archivo. El diccionario se recarga automáticamente
// al detectar cambios (file watching en voiceMatcher).
// ---------------------------------------------------------------

function buildGrammar(config) {
  const dict = voiceMatcher.getDictionary();
  const words = new Set(voiceMatcher.buildGrammarFromDictionary());

  // Variantes del nombre (wake word)
  for (const v of wakeWordVariants(config)) {
    for (const w of v.split(/\s+/)) words.add(w);
  }

  // Keywords de apps y grupos del usuario
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

  // Stopwords: incluir artículos, preposiciones, etc. que Vosk necesita
  // para reconocer frases completas como "abre discord" o "crea carpeta en escritorio"
  const STOPWORDS_FOR_GRAMMAR = [
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "de", "del", "al", "a", "en", "con", "por", "para",
    "y", "o", "que", "se", "lo", "le", "me", "te",
    "mi", "tu", "su", "este", "esta", "ese", "esa",
    "mas", "poco", "muy", "todo", "nada", "algo",
    "no", "si", "bien", "ahora", "luego", "despues"
  ];
  for (const w of STOPWORDS_FOR_GRAMMAR) words.add(w);

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
  "Mmm... todavía no supe hacer eso 🦎",
  "No encontré esa app o comando, pero puedo abrir y cerrar apps y grupos. ¡Segui probando!",
  "Eso no lo tengo en mi cerebro de mascota aún 🧠"
];

function getNamedFallback() {
  return pick(FALLBACK_NAMED);
}

const FALLBACK_GENERIC = [
  "No te entendí del todo 🤔 Podés escribirme por el chat si te quedan dudas.",
  "Mmm... no sé qué quisiste decir 🙈 Contame de nuevo.",
  "¿Cómo sería? No lo capté bien 😅"
];

// Fallback natural cuando alguien habla sin nombre y no calza con nada.
function getGenericFallback() {
  return pick(FALLBACK_GENERIC);
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
  tokensOf,
  normalize
};