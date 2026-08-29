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

// ---------------------------------------------------------------
// Cerrar aplicaciones
// ---------------------------------------------------------------

// Deduce el nombre del proceso a partir de la ruta del ejecutable.
// Solo sirve para .exe/.com; los accesos directos (.lnk) o scripts no
// tienen un nombre de proceso obvio. Se conserva processName como
// respaldo para configs antiguas que ya lo tuvieran guardado.
function guessProcessName(executablePath) {
  const target = String(executablePath || "").trim().replace(/^"|"$/g, "");
  if (!target) return null;
  const base = path.basename(target);
  const ext = path.extname(base).toLowerCase();
  if (ext === ".exe" || ext === ".com") return base;
  return null;
}

// Envía el cierre real del proceso por nombre de imagen.
// Windows: taskkill /IM <proceso> /F /T  |  Linux/macOS: pkill -f
// taskkill devuelve 0 si al menos un proceso fue terminado.
function killByName(processName) {
  return new Promise((resolve) => {
    let cmd = "taskkill";
    let args = ["/IM", processName, "/F", "/T"];
    if (process.platform !== "win32") {
      cmd = "pkill";
      args = ["-f", processName];
    }
    try {
      const child = spawn(cmd, args, { windowsHide: true, stdio: "ignore" });
      child.on("error", () => resolve({ ok: false }));
      child.on("close", (code) => resolve({ ok: code === 0 }));
    } catch (err) {
      console.error("[launcherService] fallo cerrando proceso:", err);
      resolve({ ok: false });
    }
  });
}

/**
 * Cierra la aplicación asociada a un AppCommand.
 * Usa processName si fue configurado; si no, lo deduce de executablePath.
 * Resuelve { ok, processName, reason } donde reason puede ser
 * "no-process" (no hay nombre de proceso conocido) o undefined.
 */
async function closeApp(app) {
  const processName = String(
    (app && (app.processName || guessProcessName(app.executablePath))) || ""
  ).trim();
  if (!processName) {
    return { ok: false, reason: "no-process" };
  }
  const result = await killByName(processName);
  return { ok: result.ok, processName };
}

module.exports = { openApp, delay, closeApp, guessProcessName };
