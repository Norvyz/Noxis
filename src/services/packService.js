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
const CLOSE_VERBS = [
  "cierra", "cerrar", "cierrame", "cerrame", "cerra", "cierre",
  "mata", "matar", "matalo", "termina", "terminar", "terminalo",
  "finaliza", "finalizar"
];

function hasVerb(text, verbs) {
  const words = tokensOf(text);
  return words.some((w) => verbs.some((v) => w === v || fuzzyClose(w, v)));
}

// Match de una keyword (puede ser de varias palabras, ej. "visual studio")
// contra el texto: cada palabra de la keyword debe aparecer (exacta o fuzzy).
function phraseMatches(text, phrase) {
  const words = tokensOf(text);
  const phraseWords = tokensOf(phrase);
  if (!phraseWords.length) return false;
  return phraseWords.every((pw) => words.some((w) => w === pw || fuzzyClose(w, pw)));
}

function findPack(text, config) {
  return config.packs.find(
    (p) => text.includes(p.keyword) || phraseMatches(text, p.keyword)
  );
}

function findApp(text, config) {
  return config.apps.find(
    (a) => text.includes(a.keyword) || phraseMatches(text, a.keyword)
  );
}

// Busca una app en cualquier lado: apps sueltas o dentro de cualquier grupo.
function findAppEverywhere(text, config) {
  const direct = findApp(text, config);
  if (direct) return direct;
  for (const pack of config.packs || []) {
    const inPack = findApp(text, { apps: pack.apps || [] });
    if (inPack) return inPack;
  }
  return null;
}

/**
 * Ejecuta un comando "abre X" (o "cierra X") dentro de config.apps o
 * config.packs. onMessage(text) se llama para mandar feedback a la ventana.
 * onActionSuccess() se llama cuando una acción se ejecutó con éxito
 * (sirve para que el widget haga el resaltado/marco).
 */
async function handleCommand(input, config, onMessage, onActionSuccess) {
  const text = input.toLowerCase();

  if (hasVerb(text, OPEN_VERBS)) {
    return runOpenCommand(text, config, onMessage, onActionSuccess);
  }

  if (hasVerb(text, CLOSE_VERBS)) {
    return runCloseCommand(text, config, onMessage, onActionSuccess);
  }

  return null;
}

// "abre X" → pack o app suelta
async function runOpenCommand(text, config, onMessage, onActionSuccess) {
  // 1) intenta un pack primero (igual que en la version WPF)
  const pack = findPack(text, config);
  if (pack) {
    if (pack.apps.length === 0) {
      return `El grupo ${pack.name} no tiene aplicaciones aún 🦎`;
    }

    soundService.playCommandSound(config);

    onMessage(`Ejecutando grupo ${pack.name} 🚀`);

    for (const app of pack.apps) {
      const ok = launcherService.openApp(app.executablePath);
      if (!ok) onMessage(`No pude abrir ${app.keyword} 😕`);
      await launcherService.delay(pack.delaySeconds);
    }

    if (onActionSuccess) onActionSuccess();
    return `Listo 😎 Ya ejecuté el grupo ${pack.name}`;
  }

  // 2) si no es un pack, busca una app suelta
  const app = findApp(text, config);
  if (app) {
    soundService.playCommandSound(config);

    const ok = launcherService.openApp(app.executablePath);
    if (ok && onActionSuccess) onActionSuccess();
    return ok
      ? `${config.name} abrió ${app.keyword} 🚀`
      : `Ups… no pude abrir ${app.keyword} 😕`;
  }

  return "No conozco esa aplicación aún 🦎";
}

// "cierra X" → un grupo completo, o una app suelta / dentro de un grupo
async function runCloseCommand(text, config, onMessage, onActionSuccess) {
  const pack = findPack(text, config);
  if (pack) {
    if (pack.apps.length === 0) {
      return `El grupo ${pack.name} no tiene aplicaciones aún 🦎`;
    }

    soundService.playCommandSound(config);
    onMessage(`Cerrando grupo ${pack.name} 🛑`);

    let closed = 0;
    for (const app of pack.apps) {
      const result = await launcherService.closeApp(app);
      if (result.ok) closed++;
    }

    if (onActionSuccess) onActionSuccess();
    return closed === pack.apps.length
      ? `Listo 😎 Cerré el grupo ${pack.name}`
      : `Cerré ${closed} de ${pack.apps.length} apps de ${pack.name}`;
  }

  const app = findAppEverywhere(text, config);
  if (!app) {
    return "No conozco esa aplicación aún 🦎";
  }

  soundService.playCommandSound(config);

  const result = await launcherService.closeApp(app);
  if (result.ok) {
    if (onActionSuccess) onActionSuccess();
    return `${config.name} cerró ${app.keyword} ✋`;
  }
  if (result.reason === "no-process") {
    return `No puedo deducir el proceso de ${app.keyword}. Reagrega la app apuntando directamente a su ejecutable .exe 🦎`;
  }
  return `No pude cerrar ${app.keyword}. ¿Está abierta?`;
}

module.exports = { handleCommand };
