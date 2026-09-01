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

// src/services/voiceMatcher.js
// Normalización de texto, matching difuso (Levenshtein), detección de
// comandos y generación de gramática para Vosk. Todo es comparación de
// texto, sin IA.

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------
// CONSTANTES CONFIGURABLES
// ---------------------------------------------------------------

const FUZZY_THRESHOLD = 0.7;
const APP_FUZZY_THRESHOLD = 0.6;
const MIN_FUZZY_LENGTH = 3;

// ---------------------------------------------------------------
// DICCIONARIO: CARGA CON FILE WATCHING
// ---------------------------------------------------------------

const DICTIONARY_PATH = path.join(__dirname, "dictionary.json");

let _dictCache = null;
let _dictMtime = 0;
let _dictLastCheck = 0;
const DICT_CHECK_INTERVAL_MS = 5000; // Revisar archivo cada 5 segundos como máximo

function loadDictionary() {
  const now = Date.now();
  // Si tenemos caché y no ha pasado el intervalo, retornar caché directamente
  if (_dictCache && (now - _dictLastCheck) < DICT_CHECK_INTERVAL_MS) {
    return _dictCache;
  }
  _dictLastCheck = now;

  try {
    const stat = fs.statSync(DICTIONARY_PATH);
    if (stat.mtimeMs !== _dictMtime) {
      _dictCache = JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf8"));
      _dictMtime = stat.mtimeMs;
    }
  } catch {
    if (!_dictCache) {
      _dictCache = { commands: {}, apps: {}, locations: {}, numbers: {}, fillers: [], greetings: [], grammar: { extra: [] }, learned: [] };
    }
  }
  return _dictCache;
}

function getDictionary() {
  return loadDictionary();
}

// Alias para compatibilidad con código existente
const dictionary = new Proxy({}, {
  get(_, prop) {
    return getDictionary()[prop];
  }
});

// ---------------------------------------------------------------
// NORMALIZACIÓN DE TEXTO
// ---------------------------------------------------------------

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?¡¿;:()"\u201C\u201D]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(text) {
  return normalize(text).split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------
// DISTANCIA DE LEVENSHTEIN
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

function fuzzyClose(token, target, threshold) {
  const maxLen = Math.max(token.length, target.length);
  if (maxLen <= MIN_FUZZY_LENGTH) return token === target;
  const distance = editDistance(token, target);
  const thr = typeof threshold === "number" ? threshold : FUZZY_THRESHOLD;
  const maxDistance = Math.floor(maxLen * (1 - Math.max(0, Math.min(1, thr))));
  return distance <= maxDistance;
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = editDistance(a, b);
  return 1 - (dist / maxLen);
}

// ---------------------------------------------------------------
// MATCHING BÁSICO
// ---------------------------------------------------------------

function exactMatch(token, variants) {
  return variants.some((v) => token === v);
}

function bestFuzzyMatch(token, variants, threshold) {
  const thr = typeof threshold === "number" ? threshold : FUZZY_THRESHOLD;
  let best = null;
  let bestScore = 0;
  for (const v of variants) {
    const score = similarity(token, v);
    if (score > bestScore && score >= thr) {
      bestScore = score;
      best = v;
    }
  }
  return best ? { match: best, score: bestScore } : null;
}

function matchesAny(token, variants, threshold) {
  if (exactMatch(token, variants)) return true;
  if (token.length < MIN_FUZZY_LENGTH) return false;
  return bestFuzzyMatch(token, variants, threshold) !== null;
}

function textContainsMatch(text, variants, threshold) {
  const tokens = tokensOf(text);
  return tokens.some((t) => matchesAny(t, variants, threshold));
}

function extractFromText(text, pattern) {
  const match = normalize(text).match(pattern);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------
// ACCESO AL DICCIONARIO
// ---------------------------------------------------------------

function getCommandVariants(commandKey) {
  const dict = getDictionary();
  const cmd = dict.commands[commandKey];
  if (!cmd) return [];
  const canonical = normalize(cmd.canonical);
  const variants = (cmd.variants || []).map(normalize);
  if (!variants.includes(canonical)) variants.unshift(canonical);
  return variants;
}

function getAppVariants(exeName) {
  const dict = getDictionary();
  const app = dict.apps[exeName];
  if (!app) return [normalize(exeName.replace(".exe", ""))];
  const canonical = normalize(app.canonical);
  const variants = (app.variants || []).map(normalize);
  if (!variants.includes(canonical)) variants.unshift(canonical);
  return variants;
}

function getLocationVariants(locationKey) {
  const dict = getDictionary();
  const loc = dict.locations[locationKey];
  if (!loc) return [normalize(locationKey)];
  return [normalize(loc.canonical), ...(loc.variants || []).map(normalize)];
}

function getNumberVariants(num) {
  const dict = getDictionary();
  const key = String(num);
  const numData = dict.numbers[key];
  if (!numData) return [key];
  return [key, ...numData.map(normalize)];
}

function parseNumber(token) {
  const dict = getDictionary();
  const num = parseInt(token, 10);
  if (!isNaN(num) && num >= 0 && num <= 100) return num;
  for (const [digit, words] of Object.entries(dict.numbers)) {
    if (token === digit || words.some((w) => normalize(w) === token)) {
      return parseInt(digit, 10);
    }
  }
  return null;
}

// ---------------------------------------------------------------
// MATCHING DE COMANDOS (CASCADA: EXACTO → FUZZY)
// ---------------------------------------------------------------

/**
 * Coincidencia exacta a nivel de frase contra las variantes del diccionario.
 * @param {string} text - Texto normalizado
 * @param {object} dict - Diccionario
 * @returns {{ command: string, operand: string|null, variant: string }|null}
 */
function matchExact(text, dict) {
  if (!text) return null;

  // Buscar cada variante de cada comando
  for (const [key, cmd] of Object.entries(dict.commands || {})) {
    const allVariants = [cmd.canonical, ...(cmd.variants || [])].map(normalize);
    for (const v of allVariants) {
      if (text === v) {
        return { command: key, operand: null, variant: v };
      }
      if (text.startsWith(v + " ")) {
        return { command: key, operand: text.slice(v.length + 1).trim(), variant: v };
      }
    }
  }
  return null;
}

/**
 * Matching fuzzy a nivel de frase: busca la variante más parecida.
 * @param {string} text - Texto normalizado
 * @param {object} dict - Diccionario
 * @param {number} threshold - Umbral mínimo (0-1)
 * @returns {{ command: string, operand: string|null, score: number }|null}
 */
function matchFuzzy(text, dict, threshold) {
  if (!text) return null;
  const thr = typeof threshold === "number" ? threshold : FUZZY_THRESHOLD;
  let best = null;
  let bestScore = 0;

  for (const [key, cmd] of Object.entries(dict.commands || {})) {
    const allVariants = [cmd.canonical, ...(cmd.variants || [])].map(normalize);
    for (const v of allVariants) {
      // Similitud directa de frase completa
      const score = similarity(text, v);
      if (score > bestScore && score >= thr) {
        bestScore = score;
        best = { command: key, operand: null, score };
      }

      // Si la variante es parte del texto (ej: "abre discord" contiene "abre")
      if (v.length >= 3 && text.includes(v)) {
        const operand = text.replace(v, "").trim();
        const scoreContains = v.length / text.length;
        if (scoreContains > bestScore && scoreContains >= thr) {
          bestScore = scoreContains;
          best = { command: key, operand: operand || null, score: scoreContains };
        }
      }

      // Matching por tokens
      const textTokens = tokensOf(text);
      const variantTokens = tokensOf(v);
      if (variantTokens.length >= 2) {
        const matched = variantTokens.filter(vt =>
          textTokens.some(tt => fuzzyClose(tt, vt, thr))
        );
        if (matched.length === variantTokens.length) {
          const tokenScore = matched.length / Math.max(textTokens.length, variantTokens.length);
          if (tokenScore > bestScore && tokenScore >= thr) {
            bestScore = tokenScore;
            best = { command: key, operand: null, score: tokenScore };
          }
        }
      }
    }
  }

  return best;
}

/**
 * Identifica qué comando se dijo (cascada: exacto → fuzzy).
 * @param {string} rawText - Texto original de Vosk
 * @param {object} [config] - Config (para umbral)
 * @returns {{ command: string, operand: string|null, confidence: "exact"|"fuzzy" }|null}
 */
function identifyCommand(rawText, config) {
  const text = normalize(rawText);
  if (!text) return null;
  const dict = getDictionary();

  // 1) Coincidencia exacta
  const exact = matchExact(text, dict);
  if (exact) return { ...exact, confidence: "exact" };

  // 2) Coincidencia fuzzy
  const threshold = config?.voiceSimilarityThreshold || FUZZY_THRESHOLD;
  const fuzzy = matchFuzzy(text, dict, threshold);
  if (fuzzy) return { ...fuzzy, confidence: "fuzzy" };

  return null;
}

// ---------------------------------------------------------------
// MATCHING DE APPS Y CARPETAS
// ---------------------------------------------------------------

/**
 * Identifica qué app se mencionó en el texto.
 * @param {string} text - Texto (normalizado o no)
 * @returns {{ exeName: string, canonical: string }|null}
 */
function identifyApp(text) {
  const norm = normalize(text);
  if (!norm) return null;
  const dict = getDictionary();
  for (const [exeName, app] of Object.entries(dict.apps || {})) {
    const allVariants = [app.canonical, ...(app.variants || [])].map(normalize);
    for (const v of allVariants) {
      if (v.length < 2) continue;
      if (norm === v || norm.includes(v)) {
        return { exeName, canonical: app.canonical };
      }
      if (fuzzyClose(norm, v, APP_FUZZY_THRESHOLD)) {
        return { exeName, canonical: app.canonical };
      }
      // Token-level fuzzy: verificar si algún token del texto matchea
      const normTokens = tokensOf(norm);
      if (normTokens.some(t => fuzzyClose(t, v, APP_FUZZY_THRESHOLD))) {
        return { exeName, canonical: app.canonical };
      }
    }
  }
  return null;
}

/**
 * Identifica qué ubicación especial se mencionó.
 * @param {string} text - Texto (normalizado o no)
 * @returns {{ key: string, canonical: string }|null}
 */
function identifyLocation(text) {
  const norm = normalize(text);
  if (!norm) return null;
  const dict = getDictionary();
  for (const [key, loc] of Object.entries(dict.locations || {})) {
    const allVariants = [loc.canonical, ...(loc.variants || [])].map(normalize);
    for (const v of allVariants) {
      if (v.length < 2) continue;
      if (norm.includes(v)) {
        return { key, canonical: loc.canonical };
      }
    }
  }
  return null;
}

/**
 * Extrae un número del texto (dígitos o palabras del diccionario).
 * @param {string} text - Texto (normalizado o no)
 * @returns {number|null}
 */
function extractNumber(text) {
  const norm = normalize(text);
  if (!norm) return null;
  const dict = getDictionary();

  // 1) Dígitos directos
  const digitMatch = norm.match(/\d{1,3}/);
  if (digitMatch) {
    const val = parseInt(digitMatch[0], 10);
    if (val >= 0 && val <= 100) return val;
  }

  // 2) Palabras del diccionario de números
  const tokens = tokensOf(norm);
  for (const token of tokens) {
    for (const [numStr, words] of Object.entries(dict.numbers || {})) {
      if (token === numStr || words.some(w => normalize(w) === token)) {
        return parseInt(numStr, 10);
      }
    }
  }

  // 3) Números compuestos en español ("cincuenta y cinco" = 55)
  const COMPOUND_MAP = {
    "dieciseis": 16, "diecisiete": 17, "dieciocho": 18, "diecinueve": 19,
    "veintiuno": 21, "veintidos": 22, "veintitres": 23, "veinticuatro": 24,
    "veinticinco": 25, "veintiseis": 26, "veintisiete": 27, "veintiocho": 28, "veintinueve": 29,
    "treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60,
    "setenta": 70, "ochenta": 80, "noventa": 90
  };
  const UNITS = {
    "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9
  };
  for (let i = 0; i < tokens.length; i++) {
    const tens = COMPOUND_MAP[tokens[i]];
    if (tens !== undefined) {
      const nextIdx = (tokens[i + 1] === "y") ? i + 2 : i + 1;
      if (nextIdx < tokens.length) {
        const unit = UNITS[tokens[nextIdx]];
        if (unit !== undefined) return tens + unit;
      }
      return tens;
    }
    const unitVal = UNITS[tokens[i]];
    if (unitVal !== undefined) return unitVal;
  }

  return null;
}

// ---------------------------------------------------------------
// MATCHING DE APPS INSTALADAS (ÍNDICE AUTOMÁTICO)
// ---------------------------------------------------------------

let _appScanner = null;
function getAppScanner() {
  if (!_appScanner) {
    try { _appScanner = require("../main/appScanner"); } catch { return null; }
  }
  return _appScanner;
}

/**
 * Identifica una app del índice automático de apps instaladas.
 * @param {string} text - Texto a buscar (nombre hablado)
 * @param {object} [config] - Config para umbral
 * @returns {object|null} App encontrada con matchType y score, o null
 */
function identifyInstalledApp(text, config) {
  const scanner = getAppScanner();
  if (!scanner) return null;
  const threshold = config?.voiceSimilarityThreshold || APP_FUZZY_THRESHOLD;
  return scanner.findInIndex(text, threshold);
}

// ---------------------------------------------------------------
// GRAMÁTICA PARA VOSK (PALABRAS INDIVIDUALES)
// ---------------------------------------------------------------

function buildGrammarFromDictionary() {
  const dict = getDictionary();
  const words = new Set();

  // 1) Comandos
  for (const [, cmd] of Object.entries(dict.commands || {})) {
    for (const v of [cmd.canonical, ...(cmd.variants || [])]) {
      for (const w of normalize(v).split(/\s+/)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  // 2) Ubicaciones
  for (const [, loc] of Object.entries(dict.locations || {})) {
    for (const v of [loc.canonical, ...(loc.variants || [])]) {
      for (const w of normalize(v).split(/\s+/)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  // 3) Apps
  for (const [, app] of Object.entries(dict.apps || {})) {
    for (const v of [app.canonical, ...(app.variants || [])]) {
      for (const w of normalize(v).split(/\s+/)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  // 4) Números
  for (const [digit, wordForms] of Object.entries(dict.numbers || {})) {
    words.add(digit);
    for (const w of wordForms) {
      const norm = normalize(w);
      if (norm.length >= 1) words.add(norm);
    }
  }

  // 5) Fillers
  for (const f of dict.fillers || []) {
    for (const w of normalize(f).split(/\s+/)) {
      if (w.length >= 2) words.add(w);
    }
  }

  // 6) Saludos
  for (const g of dict.greetings || []) {
    for (const w of normalize(g).split(/\s+/)) {
      if (w.length >= 2) words.add(w);
    }
  }

  // 7) Grammar extra
  for (const w of dict.grammar?.extra || []) {
    const norm = normalize(w);
    if (norm.length >= 1) words.add(norm);
  }

  // 8) Palabras aprendidas
  for (const w of dict.learned || []) {
    const norm = normalize(w);
    if (norm.length >= 2) words.add(norm);
  }

  return [...words].filter(Boolean);
}

// ---------------------------------------------------------------
// STOPWORDS
// ---------------------------------------------------------------

function getStopwords() {
  const dict = getDictionary();
  if (dict.stopwords && Array.isArray(dict.stopwords)) {
    return dict.stopwords;
  }
  // Fallback básico
  return ["de", "la", "el", "en", "que", "los", "del", "las", "un", "por", "con",
    "una", "su", "para", "es", "al", "lo", "como", "mas", "o", "le", "ya"];
}

// ---------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------

module.exports = {
  // Constantes
  FUZZY_THRESHOLD,
  APP_FUZZY_THRESHOLD,
  MIN_FUZZY_LENGTH,

  // Normalización
  normalize,
  tokensOf,

  // Levenshtein
  editDistance,
  fuzzyClose,
  similarity,

  // Matching básico
  exactMatch,
  bestFuzzyMatch,
  matchesAny,
  textContainsMatch,
  extractFromText,

  // Diccionario
  getCommandVariants,
  getAppVariants,
  getLocationVariants,
  getNumberVariants,
  parseNumber,
  getDictionary,

  // Matching de comandos (nuevo)
  identifyCommand,
  identifyApp,
  identifyLocation,
  extractNumber,
  identifyInstalledApp,

  // Gramática
  buildGrammarFromDictionary,
  getStopwords,

  // Compatibilidad
  dictionary
};
