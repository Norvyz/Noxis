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
const { fuzzyClose, tokensOf } = require("./conversationService");

const OPEN_VERBS = ["abre", "abrir", "abri", "abreme", "abrieme", "abrirme"];

function hasOpenVerb(text) {
  const words = tokensOf(text);
  return words.some((w) => OPEN_VERBS.some((v) => w === v || fuzzyClose(w, v)));
}

// Match de una keyword (puede ser de varias palabras, ej. "visual studio")
// contra el texto: cada palabra de la keyword debe aparecer (exacta o fuzzy).
function phraseMatches(text, phrase) {
  const words = tokensOf(text);
  const phraseWords = tokensOf(phrase);
  if (!phraseWords.length) return false;
  return phraseWords.every((pw) => words.some((w) => w === pw || fuzzyClose(w, pw)));
}

/**
 * Busca un comando "abre X" dentro de config.apps o config.packs
 * y lo ejecuta. onMessage(text) se llama para mandar feedback
 * a la ventana (equivalente a ShowMessage()).
 */
async function handleCommand(input, config, onMessage) {
  const text = input.toLowerCase();

  if (!hasOpenVerb(text)) {
    return null;
  }

  // 1) intenta un pack primero (igual que en la version WPF)
  const pack = config.packs.find(
    (p) => text.includes(p.keyword) || phraseMatches(text, p.keyword)
  );
  if (pack) {
    if (pack.apps.length === 0) {
      return `El grupo ${pack.name} no tiene aplicaciones aún 🦎`;
    }

    soundService.playCommandSound();

    onMessage(`Ejecutando grupo ${pack.name} 🚀`);

    for (const app of pack.apps) {
      const ok = launcherService.openApp(app.executablePath);
      if (!ok) onMessage(`No pude abrir ${app.keyword} 😕`);
      await launcherService.delay(pack.delaySeconds);
    }

    return `Listo 😎 Ya ejecuté el grupo ${pack.name}`;
  }

  // 2) si no es un pack, busca una app suelta
  const app = config.apps.find(
    (a) => text.includes(a.keyword) || phraseMatches(text, a.keyword)
  );
  if (app) {
    soundService.playCommandSound();

    const ok = launcherService.openApp(app.executablePath);
    return ok
      ? `${config.name} abrió ${app.keyword} 🚀`
      : `Ups… no pude abrir ${app.keyword} 😕`;
  }

  return "No conozco esa aplicación aún 🦎";
}

module.exports = { handleCommand };
