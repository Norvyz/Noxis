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

// src/services/launcherService.js
// Equivalente a los Process.Start(...) de MainWindow.xaml.cs

const { spawn } = require("child_process");
const { shell } = require("electron");

/**
 * Abre un ejecutable o ruta. Usa shell.openPath como respaldo
 * (mismo efecto que UseShellExecute = true en C#), y spawn
 * como via principal para no bloquear el proceso main.
 */
function openApp(executablePath) {
  try {
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: "ignore",
      shell: true
    });
    child.unref();
    return true;
  } catch (err) {
    console.error("[launcherService] fallo con spawn, probando shell.openPath:", err);
    shell.openPath(executablePath);
    return true;
  }
}

function delay(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

module.exports = { openApp, delay };
