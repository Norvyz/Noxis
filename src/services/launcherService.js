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

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { shell } = require("electron");

// Extensiones que se resuelven como un único archivo ejecutable.
const EXE_EXTS = [".exe", ".bat", ".cmd", ".ps1", ".lnk", ".com"];

/**
 * Abre un ejecutable o ruta con su aplicación asociada.
 * - Si el argumento existe y es ejecutable (.exe/.bat/...): spawn directo.
 * - Si es un .lnk (acceso directo): se abre con la app asociada.
 * - Si apunta a una carpeta o archivo: shell.openPath (definida por el sistema).
 * Devuelve true si se pudo lanzar, false si la ruta no existe.
 */
function openApp(executablePath) {
  const target = String(executablePath || "").trim();
  if (!target) return false;

  try {
    const ext = path.extname(target).toLowerCase();
    const exists = fs.existsSync(target);

    if (!exists) {
      console.error("[launcherService] La ruta no existe:", target);
      return false;
    }

    // Limpiamos comillas dobles que a veces traen los paths desde el diálogo
    const clean = target.replace(/^"|"$/g, "");

    // Acceso directo o carpeta/archivo no-ejecutable → lo maneja el SO
    if (ext === ".lnk" || !EXE_EXTS.includes(ext)) {
      shell.openPath(clean);
      return true;
    }

    const child = spawn(clean, [], {
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
