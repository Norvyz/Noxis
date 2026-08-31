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
// Normalización de texto, matching difuso (Levenshtein) y generación de
// gramática para Vosk. Todo es comparación de texto, sin IA.

const dictionary = require("./dictionary.json");

// ---------------------------------------------------------------
// CONSTANTES CONFIGURABLES
// ---------------------------------------------------------------

// Umbral de similitud para fuzzy matching (0-1).
// 0.7 = se acepta hasta ~30% de diferencia entre caracteres.
// Más alto = más estricto. Más bajo = más tolerante.
const FUZZY_THRESHOLD = 0.7;

// Umbral para nombres de apps (más tolerante porque Vosk los transcribe mal).
const APP_FUZZY_THRESHOLD = 0.6;

// Longitud mínima para aplicar fuzzy matching.
// Palabras de 1-2 caracteres siempre deben coincidir exactamente.
const MIN_FUZZY_LENGTH = 3;

// ---------------------------------------------------------------
// NORMALIZACIÓN DE TEXTO
// ---------------------------------------------------------------

/**
 * Normaliza texto: minúsculas, quita tildes, puntuación y espacios extra.
 * Esta es la función central de normalización. Úsala en vez de copy-paste.
 */
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // quita tildes/acentos
    .replace(/[.,!?¡¿;:()]/g, "")     // quita puntuación
    .replace(/\s+/g, " ")              // colapsa espacios múltiples
    .trim();
}

/**
 * Tokeniza texto en palabras (tokens), ya normalizado.
 */
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

/**
 * ¿"token" es aproximadamente igual a "target"?
 * @param {string} token - Palabra a comparar
 * @param {string} target - Palabra de referencia
 * @param {number} [threshold] - Similitud mínima (0-1). Default: FUZZY_THRESHOLD.
 */
function fuzzyClose(token, target, threshold) {
  const maxLen = Math.max(token.length, target.length);
  if (maxLen <= 2) return token === target; // palabras muy cortas: exacto
  if (maxLen <= MIN_FUZZY_LENGTH) return token === target;
  const distance = editDistance(token, target);
  const thr = typeof threshold === "number" ? threshold : FUZZY_THRESHOLD;
  const maxDistance = Math.floor(maxLen * (1 - Math.max(0, Math.min(1, thr))));
  return distance <= maxDistance;
}

/**
 * Calcula el nivel de similitud (0-1) entre dos strings.
 */
function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = editDistance(a, b);
  return 1 - (dist / maxLen);
}

// ---------------------------------------------------------------
// MATCHING DE COMANDOS
// ---------------------------------------------------------------

/**
 * Busca una coincidencia exacta de un token contra una lista de variantes.
 * @param {string} token - Palabra normalizada
 * @param {string[]} variants - Lista de variantes normalizadas
 * @returns {boolean}
 */
function exactMatch(token, variants) {
  return variants.some((v) => token === v);
}

/**
 * Busca la mejor coincidencia fuzzy de un token contra una lista de variantes.
 * @param {string} token - Palabra normalizada
 * @param {string[]} variants - Lista de variantes normalizadas
 * @param {number} [threshold] - Umbral de similitud
 * @returns {{ match: string, score: number } | null}
 */
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

/**
 * Verifica si un token coincide (exacta o fuzzy) con alguna variante de un comando.
 * @param {string} token - Palabra normalizada
 * @param {string[]} variants - Lista de variantes normalizadas
 * @param {number} [threshold] - Umbral de similitud
 * @returns {boolean}
 */
function matchesAny(token, variants, threshold) {
  if (exactMatch(token, variants)) return true;
  if (token.length < MIN_FUZZY_LENGTH) return false;
  return bestFuzzyMatch(token, variants, threshold) !== null;
}

/**
 * Verifica si el texto contiene algún token que matchee con las variantes.
 * @param {string} text - Texto normalizado
 * @param {string[]} variants - Lista de variantes normalizadas
 * @param {number} [threshold] - Umbral de similitud
 * @returns {boolean}
 */
function textContainsMatch(text, variants, threshold) {
  const tokens = tokensOf(text);
  return tokens.some((t) => matchesAny(t, variants, threshold));
}

/**
 * Extrae el valor/argumento de un comando del texto.
 * Por ejemplo, de "al 50 por ciento" extrae "50".
 * @param {string} text - Texto normalizado
 * @param {RegExp} pattern - Patrón con un grupo de captura
 * @returns {string | null}
 */
function extractFromText(text, pattern) {
  const match = normalize(text).match(pattern);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------
// DICCIONARIO: ACCESO
// ---------------------------------------------------------------

/**
 * Obtiene las variantes de un comando del diccionario.
 * @param {string} commandKey - Clave del comando (ej: "open", "close")
 * @returns {string[]} Variantes normalizadas
 */
function getCommandVariants(commandKey) {
  const cmd = dictionary.commands[commandKey];
  if (!cmd) return [];
  const canonical = normalize(cmd.canonical);
  const variants = (cmd.variants || []).map(normalize);
  // Asegurar que el canónico esté incluido
  if (!variants.includes(canonical)) variants.unshift(canonical);
  return variants;
}

/**
 * Obtiene las variantes de una app del diccionario.
 * @param {string} exeName - Nombre del .exe (ej: "discord.exe")
 * @returns {string[]} Variantes normalizadas
 */
function getAppVariants(exeName) {
  const app = dictionary.apps[exeName];
  if (!app) return [normalize(exeName.replace(".exe", ""))];
  const canonical = normalize(app.canonical);
  const variants = (app.variants || []).map(normalize);
  if (!variants.includes(canonical)) variants.unshift(canonical);
  return variants;
}

/**
 * Obtiene todas las variantes de un valor de ubicación.
 * @param {string} locationKey - Clave (ej: "desktop", "documents")
 * @returns {string[]} Variantes normalizadas
 */
function getLocationVariants(locationKey) {
  const loc = dictionary.locations[locationKey];
  if (!loc) return [normalize(locationKey)];
  return [normalize(loc.canonical), ...(loc.variants || []).map(normalize)];
}

/**
 * Obtiene todas las variantes de un número.
 * @param {string|number} num - Número (ej: "50")
 * @returns {string[]} Variantes normalizadas (incluye el dígito)
 */
function getNumberVariants(num) {
  const key = String(num);
  const numData = dictionary.numbers[key];
  if (!numData) return [key];
  return [key, ...numData.map(normalize)];
}

/**
 * Verifica si un token es un número (dígito o palabra).
 * @param {string} token - Palabra normalizada
 * @returns {number | null} El número o null
 */
function parseNumber(token) {
  // Dígito directo
  const num = parseInt(token, 10);
  if (!isNaN(num) && num >= 0 && num <= 100) return num;

  // Buscar en el diccionario de números
  for (const [digit, words] of Object.entries(dictionary.numbers)) {
    if (token === digit || words.some((w) => normalize(w) === token)) {
      return parseInt(digit, 10);
    }
  }
  return null;
}

// ---------------------------------------------------------------
// GENERACIÓN DE GRAMÁTICA PARA VOSK
// ---------------------------------------------------------------

/**
 * Genera la lista de palabras para la gramática de Vosk a partir del diccionario.
 * Incluye: variantes de comandos, nombres de apps, números, saludos, fillers,
 * y palabras adicionales del diccionario.
 * @returns {string[]} Array de palabras únicas para Vosk
 */
function buildGrammarFromDictionary() {
  const words = new Set();

  // 1) Variantes de comandos → dividir en palabras individuales
  for (const [, cmd] of Object.entries(dictionary.commands)) {
    for (const v of [cmd.canonical, ...(cmd.variants || [])]) {
      for (const w of normalize(v).split(/\s+/)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  // 2) Variantes de ubicaciones
  for (const [, loc] of Object.entries(dictionary.locations)) {
    for (const v of [loc.canonical, ...(loc.variants || [])]) {
      for (const w of normalize(v).split(/\s+/)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  // 3) Nombres de apps (palabras individuales)
  for (const [, app] of Object.entries(dictionary.apps)) {
    for (const v of [app.canonical, ...(app.variants || [])]) {
      for (const w of normalize(v).split(/\s+/)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  // 4) Números como dígitos y palabras
  for (const [digit, wordForms] of Object.entries(dictionary.numbers)) {
    words.add(digit);
    for (const w of wordForms) {
      const norm = normalize(w);
      if (norm.length >= 1) words.add(norm);
    }
  }

  // 5) Fillers
  for (const f of dictionary.fillers || []) {
    for (const w of normalize(f).split(/\s+/)) {
      if (w.length >= 2) words.add(w);
    }
  }

  // 6) Saludos
  for (const g of dictionary.greetings || []) {
    for (const w of normalize(g).split(/\s+/)) {
      if (w.length >= 2) words.add(w);
    }
  }

  // 7) Palabras adicionales del grammar.extra
  for (const w of dictionary.grammar?.extra || []) {
    const norm = normalize(w);
    if (norm.length >= 1) words.add(norm);
  }

  // 8) Palabras aprendidas de archivos del usuario
  for (const w of dictionary.learned || []) {
    const norm = normalize(w);
    if (norm.length >= 2) words.add(norm);
  }

  return [...words].filter(Boolean);
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

  // Matching
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

  // Gramática
  buildGrammarFromDictionary,

  // Acceso al diccionario crudo (para compatibilidad)
  dictionary
};
