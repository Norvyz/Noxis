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

// src/services/fileLearningService.js
// Lee archivos de texto (.txt, .docx, .pdf, .xlsx), extrae palabras,
// cuenta frecuencia y devuelve vocabulario nuevo para ampliar el diccionario.
// Sin IA: extracción de texto + conteo estadístico de palabras.

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------

// Formatos soportados
const SUPPORTED_EXTENSIONS = new Set([".txt", ".docx", ".doc", ".pdf", ".xlsx", ".xls"]);

// ---------------------------------------------------------------
// STOPWORDS: se cargan desde dictionary.json si existe la sección,
// con fallback a la lista hardcodeada.
// ---------------------------------------------------------------

const DEFAULT_STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "a", "en", "con", "por", "para", "sin", "sobre",
  "entre", "hasta", "desde", "hacia", "tras", "ante", "bajo", "contra",
  "y", "o", "u", "e", "ni", "que", "si", "pero", "mas", "sino",
  "aunque", "porque", "pues", "como", "cuando", "donde",
  "yo", "tu", "el", "ella", "nosotros", "vosotros", "ellos", "ellas",
  "me", "te", "le", "nos", "os", "lo", "la", "les", "se",
  "mi", "tu", "su", "mis", "tus", "sus", "nuestro", "vuestra",
  "esto", "esta", "ese", "esa", "aquel", "aquella",
  "es", "son", "fue", "ser", "estar", "hay", "ha", "han", "he", "has",
  "hoy", "muy", "ya", "no", "tambien", "asimismo",
  "tan", "tanto", "mas", "menos", "bien", "mal", "aqui", "ahi", "alla",
  "todo", "nada", "algo", "alguien", "nadie", "cada", "otro", "otra",
  "mismo", "misma", "propio", "propia",
  "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "etc", "vs", "sr", "sra", "dr", "dra",
  "al", "del",
  "he", "has", "hemos", "han", "habia",
  "era", "eras", "eran", "sido", "tiene", "tienen", "tener",
  "hacer", "puede", "pueden", "saber", "decir", "ir", "venir",
  "dar", "ver", "querer", "llegar", "poner", "parecer", "quedar",
  "creer", "hablar", "llevar", "dejar", "seguir", "encontrar",
  "llamar", "volver", "tomar", "conocer", "vivir", "sentir",
  "tratar", "mirar", "contar", "empezar", "esperar", "buscar",
  "existir", "entrar", "pasar", "realizar", "presentar",
  "desarrollar", "establecer", "participar",
  "representar", "considerar", "continuar"
]);

/**
 * Obtiene las stopwords: intenta desde dictionary.json, fallback a la lista default.
 */
function getStopwords() {
  try {
    const dict = loadDictionary();
    if (dict.stopwords && Array.isArray(dict.stopwords) && dict.stopwords.length > 0) {
      const normalizeLocal = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      return new Set(dict.stopwords.map((w) => normalizeLocal(w)));
    }
  } catch {}
  return DEFAULT_STOPWORDS;
}

// ---------------------------------------------------------------
// EXTRACCIÓN DE TEXTO POR FORMATO
// ---------------------------------------------------------------

/**
 * Lee un archivo .txt y devuelve su contenido.
 */
function extractTxt(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Lee un archivo .docx y extrae texto plano (requiere mammoth).
 */
async function extractDocx(filePath) {
  try {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  } catch (err) {
    console.error("[fileLearning] Error leyendo docx:", filePath, err.message);
    return "";
  }
}

/**
 * Lee un archivo .pdf y extrae texto plano (requiere pdf-parse).
 */
async function extractPdf(filePath) {
  try {
    const pdfParse = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch (err) {
    console.error("[fileLearning] Error leyendo pdf:", filePath, err.message);
    return "";
  }
}

/**
 * Lee un archivo .xlsx/.xls y extrae texto de todas las celdas (requiere xlsx).
 */
function extractXlsx(filePath) {
  try {
    const XLSX = require("xlsx");
    const workbook = XLSX.readFile(filePath);
    let text = "";
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_csv(sheet);
      text += data + "\n";
    }
    return text;
  } catch (err) {
    console.error("[fileLearning] Error leyendo xlsx:", filePath, err.message);
    return "";
  }
}

/**
 * Extrae texto de un archivo según su extensión.
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".txt":
      return extractTxt(filePath);
    case ".docx":
    case ".doc":
      return await extractDocx(filePath);
    case ".pdf":
      return await extractPdf(filePath);
    case ".xlsx":
    case ".xls":
      return extractXlsx(filePath);
    default:
      return "";
  }
}

// ---------------------------------------------------------------
// TOKENIZACIÓN Y FILTRADO
// ---------------------------------------------------------------

/**
 * Normaliza y tokeniza texto en palabras individuales.
 * Conserva la capitalización original para detectar nombres propios.
 */
function tokenizeWithCase(text) {
  // Separar palabras preservando mayúsculas iniciales
  const words = (text || "")
    .replace(/[.,!?¡¿;:(){}\[\]"'«»\-_\/\\|@#$%^&*+=~`<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words;
}

/**
 * Normaliza una palabra a minúsculas sin tildes.
 */
function normalizeWord(word) {
  return (word || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Verifica si una palabra empieza con mayúscula (posible nombre propio).
 */
function isProperNoun(word) {
  if (!word || word.length < 2) return false;
  return /^[A-ZÁÉÍÓÚÑ]/.test(word) && !/^[A-ZÁÉÍÓÚÑ]+$/.test(word);
}

/**
 * Cuenta frecuencia de palabras y detecta nombres propios.
 * @param {string[]} rawWords - Palabras originales (con capitalización)
 * @returns {{ wordFreq: Map<string, number>, properNouns: Set<string> }}
 */
function countWordFrequency(rawWords) {
  const wordFreq = new Map();
  const properNouns = new Set();

  for (const raw of rawWords) {
    const normalized = normalizeWord(raw);
    if (!normalized || normalized.length < 2) continue;

    // Contar frecuencia
    wordFreq.set(normalized, (wordFreq.get(normalized) || 0) + 1);

    // Detectar nombre propio (empieza con mayúscula, no es toda mayúscula)
    if (isProperNoun(raw)) {
      properNouns.add(normalized);
    }
  }

  return { wordFreq, properNouns };
}

/**
 * Filtra stopwords y palabras de baja frecuencia.
 * @param {Map<string, number>} wordFreq
 * @param {number} minFrequency - Frecuencia mínima para incluir
 * @param {Set<string>} properNouns - Nombres propios (siempre se incluyen)
 * @returns {string[]} Lista de palabras que pasan el filtro
 */
function filterWords(wordFreq, minFrequency, properNouns) {
  const stopwords = getStopwords();
  const result = [];
  for (const [word, count] of wordFreq) {
    // Siempre incluir nombres propios (si tienen al menos 2 caracteres)
    if (properNouns.has(word) && word.length >= 2) {
      result.push(word);
      continue;
    }
    // Para el resto: frecuencia mínima y no ser stopwords
    if (count >= minFrequency && !stopwords.has(word) && word.length >= 3) {
      result.push(word);
    }
  }
  return [...new Set(result)].sort();
}

// ---------------------------------------------------------------
// PROCESAMIENTO PRINCIPAL
// ---------------------------------------------------------------

/**
 * Analiza todos los archivos de una carpeta y devuelve palabras aprendidas.
 * @param {string} folderPath - Ruta de la carpeta a analizar
 * @param {object} options
 * @param {boolean} [options.includeSubfolders=false] - Incluir subcarpetas
 * @param {number} [options.minFrequency=3] - Frecuencia mínima de palabra
 * @param {function} [options.onProgress] - Callback de progreso (fileIndex, totalFiles, fileName)
 * @returns {Promise<{ words: string[], stats: object }>}
 */
async function analyzeFolder(folderPath, options = {}) {
  const { includeSubfolders = false, minFrequency = 3, onProgress } = options;

  if (!folderPath || !fs.existsSync(folderPath)) {
    return { words: [], stats: { error: "Carpeta no encontrada" } };
  }

  // 1) Recopilar archivos
  const files = [];
  function scanDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (includeSubfolders) scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  scanDir(folderPath);

  if (files.length === 0) {
    return { words: [], stats: { filesProcessed: 0, totalWords: 0, uniqueWords: 0 } };
  }

  // 2) Extraer texto de cada archivo
  let allRawWords = [];
  let filesProcessed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) {
      onProgress(i + 1, files.length, path.basename(file));
    }
    try {
      const text = await extractText(file);
      const rawWords = tokenizeWithCase(text);
      allRawWords = allRawWords.concat(rawWords);
      filesProcessed++;
    } catch (err) {
      console.error("[fileLearning] Error procesando:", file, err.message);
    }
  }

  // 3) Contar frecuencia y detectar nombres propios
  const { wordFreq, properNouns } = countWordFrequency(allRawWords);

  // 4) Filtrar
  const words = filterWords(wordFreq, minFrequency, properNouns);

  const stats = {
    filesProcessed,
    totalFiles: files.length,
    totalWords: allRawWords.length,
    uniqueWords: wordFreq.size,
    learnedWords: words.length,
    properNounsFound: properNouns.size
  };

  return { words, stats };
}

// ---------------------------------------------------------------
// PERSISTENCIA EN dictionary.json
// ---------------------------------------------------------------

const DICTIONARY_PATH = path.join(__dirname, "dictionary.json");

function loadDictionary() {
  try {
    return JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf8"));
  } catch {
    return { commands: {}, apps: {}, locations: {}, numbers: {}, fillers: [], greetings: [], grammar: { extra: [] }, learned: [] };
  }
}

function saveDictionary(dict) {
  fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(dict, null, 2), "utf8");
}

/**
 * Guarda las palabras aprendidas en dictionary.json (sección "learned").
 */
function saveLearnedWords(words) {
  const dict = loadDictionary();
  // Merge con existentes (evitar duplicados)
  const existing = new Set(dict.learned || []);
  for (const w of words) {
    existing.add(w);
  }
  dict.learned = [...existing].sort();
  saveDictionary(dict);
  return dict.learned;
}

/**
 * Obtiene las palabras aprendidas actualmente.
 */
function getLearnedWords() {
  const dict = loadDictionary();
  return dict.learned || [];
}

/**
 * Elimina una palabra aprendida específica.
 */
function removeLearnedWord(word) {
  const dict = loadDictionary();
  dict.learned = (dict.learned || []).filter((w) => w !== word);
  saveDictionary(dict);
  return dict.learned;
}

/**
 * Borra todas las palabras aprendidas (sin tocar comandos base).
 */
function clearLearnedWords() {
  const dict = loadDictionary();
  dict.learned = [];
  saveDictionary(dict);
  return [];
}

module.exports = {
  analyzeFolder,
  saveLearnedWords,
  getLearnedWords,
  removeLearnedWord,
  clearLearnedWords,
  loadDictionary,
  SUPPORTED_EXTENSIONS
};
