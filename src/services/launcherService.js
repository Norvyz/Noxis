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
const { spawn, execFile } = require("child_process");
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

// Rutas absolutas a taskkill.exe. En Electron el PATH puede no incluir
// System32 cuando la app se lanza como proceso GUI, así que usamos la ruta
// completa para terminar procesos de forma confiable en Windows.
const TASKKILL_CANDIDATES = [
  () => process.env.SYSTEMROOT && path.join(process.env.SYSTEMROOT, "System32", "taskkill.exe"),
  () => process.env.WINDIR && path.join(process.env.WINDIR, "System32", "taskkill.exe"),
  () => "C:\\Windows\\System32\\taskkill.exe"
].map((fn) => fn()).filter(Boolean);

function resolveTaskkill() {
  for (const candidate of TASKKILL_CANDIDATES) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) {
      // seguir probando
    }
  }
  return "taskkill"; // fallback: que lo resuelva el PATH
}

// Ruta absoluta a powershell.exe (System32), igual que en systemService.
function systemExe(name) {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const p = path.join(root, "System32", name);
  return fs.existsSync(p) ? p : name;
}

/**
 * Resuelve el .exe real al que apunta un acceso directo .lnk usando PowerShell
 * (COM WScript.Shell). Devuelve la ruta al .exe objetivo, o null si no se pudo.
 */
function resolveLnkTarget(lnkPath) {
  return new Promise((resolve) => {
    const ps = systemExe("WindowsPowerShell\\v1.0\\powershell.exe");
    const script =
      "$s=(New-Object -ComObject WScript.Shell).CreateShortcut(" +
      JSON.stringify(lnkPath) +
      ").TargetPath;Write-Output $s";
    execFile(
      ps,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 12000 },
      (err, stdout) => {
        if (err) {
          console.error("[launcherService] no pude resolver .lnk:", lnkPath, err.message);
          resolve(null);
          return;
        }
        const target = String(stdout || "").trim();
        resolve(target || null);
      }
    );
  });
}

// Devuelve exeName candidato para taskkill a partir de una ruta o nombre
// (quita la extensión, agrega .exe si faltara).
function toExeName(p) {
  const base = path.basename(String(p || "").replace(/^"|"$/g, ""));
  return /\.exe$/i.test(base) ? base : base + ".exe";
}

// Corre taskkill /IM <exe> /F /T (el /T mata todo el árbol de procesos).
// Resuelve true si taskkill termina sin errores (encontró y mató el proceso).
function taskkillExe(taskkillPath, exeName) {
  return new Promise((resolve) => {
    execFile(
      taskkillPath,
      ["/IM", exeName, "/F", "/T"],
      { windowsHide: true },
      (err) => {
        if (err) resolve(false);
        else resolve(true);
      }
    );
  });
}

/**
 * Cierra un programa por su ruta ejecutable (taskkill /IM /T).
 * - Si es un .exe directo lo mata.
 * - Si es un .lnk (acceso directo): muchas apps (Discord, Steam...) apuntan a un
 *   "Update.exe" que LANZA la app real (Discord.exe). El proceso visible es el del
 *   nombre del .lnk, así que se intentan varios candidatos y se mata el árbol:
 *     1) basename(.lnk) + ".exe"  (ej: "Discord.lnk" → "Discord.exe") ← proceso visible
 *     2) el TargetPath real del .lnk (ej: "Update.exe")
 * Devuelve true si se logró matar al menos un proceso.
 */
async function closeApp(executablePath) {
  const target = String(executablePath || "").trim();
  if (!target) return false;

  if (!fs.existsSync(target)) {
    console.error("[launcherService] La ruta no existe:", target);
    return false;
  }

  // Lista de nombres de proceso a intentar matar (sin duplicados).
  const candidates = [];
  if (target.toLowerCase().endsWith(".lnk")) {
    // 1) el exe del nombre del acceso directo → el proceso que ve el usuario
    candidates.push(toExeName(path.basename(target, ".lnk")));
    // 2) el exe al que apunta el .lnk (puede ser Update.exe / launcher)
    const real = await resolveLnkTarget(target);
    if (real) candidates.push(toExeName(real));
  } else {
    candidates.push(toExeName(target));
  }

  const taskkillPath = resolveTaskkill();
  if (taskkillPath !== "taskkill" && !fs.existsSync(taskkillPath)) {
    console.error("[launcherService] taskkill no encontrado en:", taskkillPath);
    return false;
  }

  for (const exeName of candidates) {
    if (!exeName) continue;
    try {
      const ok = await taskkillExe(taskkillPath, exeName);
      console.log("[launcherService] taskkill", exeName, ok ? "OK" : "no encontrado/fallo");
      if (ok) return true;
    } catch (err) {
      console.error("[launcherService] taskkill error para", exeName, ":", err.message);
    }
  }

  console.error("[launcherService] no se pudo cerrar:", target, "→", JSON.stringify(candidates));
  return false;
}

module.exports = { openApp, closeApp, delay };
