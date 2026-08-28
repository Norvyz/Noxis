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

// src/services/soundService.js
// Reproduce un sonido cada vez que el asistente ejecuta un comando
// (abrir una app o un grupo). El archivo de audio debe estar en
// assets/sounds/. Se reproduce en el renderer vía HTML5 Audio,
// que soporta .mp3, .wav, .ogg, etc.

const path = require("path");
const fs = require("fs");
const windows = require("../main/windows");

// Archivo de sonido que se reproduce al ejecutar un comando.
// Cambiá este nombre si agregás otro archivo a assets/sounds/.
const SOUND_FILE = path.join(__dirname, "../../assets/sounds/command.mp3");

let lastPlay = 0;

/**
 * Reproduce el sonido de comando. Le avisa al widget (renderer) que
 * suene el archivo vía HTML5 Audio. Si no existe el archivo no hace nada.
 */
function playCommandSound() {
  // Evita reproducir decenas de veces si llegan varios comandos seguidos
  const now = Date.now();
  if (now - lastPlay < 400) return;
  lastPlay = now;

  if (!fs.existsSync(SOUND_FILE)) return;

  const win = windows.getMainWindow();
  if (!win) return;

  win.webContents.send("play-sound", SOUND_FILE);
}

module.exports = { playCommandSound };
