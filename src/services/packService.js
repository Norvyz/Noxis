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

// src/services/packService.js
// Equivalente a TryRunPackAsync / TryOpenApplication de MainWindow.xaml.cs

const launcherService = require("./launcherService");
const soundService = require("./soundService");
const voiceMatcher = require("./voiceMatcher");
const appScanner = require("../main/appScanner");

// Re-exportar desde voiceMatcher para compatibilidad
const fuzzyClose = voiceMatcher.fuzzyClose;
const tokensOf = voiceMatcher.tokensOf;
const normalize = voiceMatcher.normalize;

const OPEN_VERBS = ["abre", "abrir", "abri", "abreme", "abrieme", "abrirme"];
const CLOSE_VERBS = ["cierra", "cerrar", "cierrame", "cerrame", "cerralo", "cerra", "cierra todas"];

function hasVerb(wordList, text) {
  const words = tokensOf(text);
  return words.some((w) => wordList.some((v) => w === v || fuzzyClose(w, v)));
}

function hasOpenVerb(text) {
  return hasVerb(OPEN_VERBS, text);
}

function hasCloseVerb(text) {
  return hasVerb(CLOSE_VERBS, text);
}

// Match de una keyword (puede ser de varias palabras, ej. "visual studio")
// contra el texto: cada palabra de la keyword debe aparecer (exacta o fuzzy).
function phraseMatches(text, phrase) {
  const words = tokensOf(text);
  const phraseWords = tokensOf(phrase);
  if (!phraseWords.length) return false;
  return phraseWords.every((pw) => words.some((w) => w === pw || fuzzyClose(w, pw)));
}

// Encuentra un pack o app cuya keyword/name aparezca en el texto (exacta o fuzzy)
function matchPack(text, config) {
  return config.packs.find(
    (p) => text.includes(normalize(p.keyword)) || phraseMatches(text, p.keyword) || phraseMatches(text, p.name)
  );
}

function matchApp(text, config) {
  return config.apps.find(
    (a) => text.includes(normalize(a.keyword)) || phraseMatches(text, a.keyword)
  );
}

/**
 * Busca un comando "abre X" o "cierra X" dentro de config.apps o config.packs
 * y lo ejecuta. oferta "cierra <grupo>" consulta el pack por su palabra clave
 * e intenta cerrar todas las apps del grupo. onMessage(text) da feedback.
 */
async function handleCommand(input, config, onMessage) {
  const text = normalize(input);

  const isOpen = hasOpenVerb(text);
  const isClose = hasCloseVerb(text);
  if (!isOpen && !isClose) {
    return null;
  }
  if (isOpen && isClose) {
    return null; // ambigüo: ni abrir ni cerrar en claro
  }

  // ---- CIERRES ----
  if (isClose) {
    // 1) grupo de trabajo: "cierra trabajo" → cierra las apps del pack
    const pack = matchPack(text, config);
    if (pack) {
      if (pack.apps.length === 0) {
        return `El grupo ${pack.name} no tiene aplicaciones para cerrar 🦎`;
      }

      soundService.playCommandSound(config);

      onMessage(`Cerrando grupo ${pack.name} 🔻`);

      let problemas = 0;
      for (const app of pack.apps) {
        const closed = await launcherService.closeApp(app.executablePath);
        if (!closed) problemas++;
      }

      if (problemas > 0) {
        return `Listo. Cerré las apps del grupo ${pack.name} (${pack.apps.length - problemas} de ${pack.apps.length}).`;
      }
      return `Listo 😎 Cerré el grupo ${pack.name}`;
    }

    // 2) app suelta: "cierra chrome"
    const app = matchApp(text, config);
    if (app) {
      soundService.playCommandSound(config);
      const closed = await launcherService.closeApp(app.executablePath);
      return closed
        ? `Cerré ${app.keyword} 🔻`
        : `No encontré ${app.keyword} corriendo para cerrar 😕`;
    }

    return "No conozco qué cerrar aun 🦎";
  }

  // ---- APERTURAS ----
  // 1) intenta un pack primero (igual que en la version WPF)
  const pack = matchPack(text, config);
  if (pack) {
    if (pack.apps.length === 0) {
      return `El grupo ${pack.name} no tiene aplicaciones aun 🦎`;
    }

    soundService.playCommandSound(config);

    onMessage(`Ejecutando grupo ${pack.name} 🚀`);

    for (const app of pack.apps) {
      const ok = launcherService.openApp(app.executablePath);
      if (!ok) onMessage(`No pude abrir ${app.keyword} 😕`);
      await launcherService.delay(pack.delaySeconds);
    }

    return `Listo 😎 Ya ejecute el grupo ${pack.name}`;
  }

  // 2) si no es un pack, busca una app suelta
  const app = matchApp(text, config);
  if (app) {
    soundService.playCommandSound(config);

    const ok = launcherService.openApp(app.executablePath);
    return ok
      ? `${config.name} abrio ${app.keyword} 🚀`
      : `Ups... no pude abrir ${app.keyword} 😕`;
  }

  // 3) fallback: buscar en índice automático de apps instaladas
  const autoMatch = appScanner.findInIndex(text);
  if (autoMatch && (autoMatch.exePath || autoMatch.appId)) {
    soundService.playCommandSound(config);
    const { exec } = require("child_process");
    if (autoMatch.exePath) {
      exec(`"${autoMatch.exePath}"`, (err) => {
        if (err) console.error("[packService] Error abriendo app (auto):", err.message);
      });
    } else if (autoMatch.appId) {
      exec(`Start-Process "shell:AppsFolder\\${autoMatch.appId}"`, (err) => {
        if (err) console.error("[packService] Error abriendo app UWP:", err.message);
      });
    }
    return `Abriendo ${autoMatch.name} 🚀`;
  }

  return "No conozco esa aplicacion aun 🦎";
}

module.exports = { handleCommand };
