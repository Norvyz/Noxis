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

// Electron solo está disponible dentro de la app (y expone shell como
// electron.shell); si la lib se carga desde Node plano (tests), se inyecta
// un stub para que no rompa el require pero SIN abrir nada de verdad.
let shell;
try {
  const electron = require("electron");
  shell = electron && electron.shell && typeof electron.shell.openPath === "function" ? electron.shell : undefined;
} catch (e) {
  shell = undefined;
}
if (!shell) {
  shell = { openPath: () => Promise.resolve(""), openExternal: () => Promise.resolve("") };
}

// Extensiones que se resuelven como un único archivo ejecutable.
const EXE_EXTS = [".exe", ".bat", ".cmd", ".ps1", ".lnk", ".com"];

// Registro de procesos que Noxis lanzó (por ruta de config).
// executablePath → Set de PIDs. Permite cerrar lo que abrimos por PID/TID
// sin depender de que el nombre del proceso coincida con el del .lnk.
const openedProcesses = new Map();

function recordOpened(executablePath, pid) {
  if (!executablePath || !pid) return;
  const key = String(executablePath).trim();
  if (!openedProcesses.has(key)) openedProcesses.set(key, new Set());
  openedProcesses.get(key).add(pid);
}

// Snapshot de procesos en el sistema: Map<pid, executablePath en minúsculas>.
// Se usa para detectar QUÉ realmente lanzó una app al abrirla, sin depender
// del nombre del .lnk ni adivinar el .exe (funciona para cualquier app).
function snapshotProcesses() {
  return new Promise((resolve) => {
    const ps = systemExe("WindowsPowerShell\\v1.0\\powershell.exe");
    const script =
      "Get-CimInstance Win32_Process | " +
      "Where-Object { $_.ExecutablePath } | " +
      "Select-Object ProcessId, ExecutablePath, ParentProcessId | ConvertTo-Json";
    execFile(
      ps,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        if (err) {
          resolve(new Map());
          return;
        }
        try {
          const raw = String(stdout || "").trim();
          if (!raw) {
            resolve(new Map());
            return;
          }
          const data = JSON.parse(raw);
          const list = Array.isArray(data) ? data : [data];
          const map = new Map();
          for (const p of list) {
            if (!p || !p.ProcessId || !p.ExecutablePath) continue;
            map.set(Number(p.ProcessId), String(p.ExecutablePath).toLowerCase());
          }
          resolve(map);
        } catch (e) {
          resolve(new Map());
        }
      }
    );
  });
}

// Procesos cuyo nombre exe no es parte de Noxis/herramientas; evita registrar
// basura del propio Electron/PowerShell/taskkill en el diff antes/después.
const NOXIS_PROCESS_FILTER = /^(electron|noxis[.\s-]*|node|powershell|pwsh|conhost|cmd|taskkill|werfault)\.exe$/i;

// Detecta los procesos que aparecieron al abrir "executablePath" y los registra
// para poder cerrarlos después. Espera hasta 4s para ver hijos que tardan.
// beforeMap = snapshot de procesos tomado ANTES de abrir.
function trackOpenedByOpenPath(executablePath, knownTarget, beforeMap) {
  const key = String(executablePath || "").trim();
  const known = knownTarget ? String(knownTarget).trim().toLowerCase() : "";
  (async () => {
    await new Promise((r) => setTimeout(r, 2000));
    const afterMap = await snapshotProcesses();
    const tracked = openedProcesses.get(key) || new Set();
    for (const [pid, exePath] of afterMap) {
      if (beforeMap.has(pid)) continue; // no es nuevo
      if (NOXIS_PROCESS_FILTER.test(path.basename(exePath))) continue;
      // Coincide con el target conocido del .lnk, o simplemente es un proceso
      // nuevo que arrancó justo después de abrir la app.
      if (known && !exePath.includes(known)) continue;
      tracked.add(pid);
      tracked.add("path:" + exePath);
    }
    if (tracked.size > 0) openedProcesses.set(key, tracked);
    console.log("[launcherService] trackOpenedByOpenPath:", key, "→", [...tracked]);
  })();
}

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
      // Detectamos qué procesos aparecen al abrir, y guardamos el target real
      // para cerrarlo por ruta de ejecutable aunque el proceso visible tenga
      // otro nombre. Sirve para CUALQUIER .lnk, incluso los que no resuelven
      // su TargetPath (p. ej. accesos directos a UWP/tienda).
      // IMPORTANTE: la apertura NO espera a PowerShell: el .lnk se abre al
      // instante y el tracking (para poder cerrarlo después) corre en paralelo.
      const knownTarget = resolveLnkTarget(clean);
      const beforeSnapshot = snapshotProcesses();
      shell.openPath(clean).catch((err) => console.error("[launcherService] openPath:", err.message));
      Promise.all([beforeSnapshot, knownTarget]).then(([beforeMap, real]) => {
        if (real && real.trim()) {
          const realPath = real.trim();
          const record = openedProcesses.get(target) || new Set();
          // ruta exacta del ejecutable real
          record.add("path:" + realPath.toLowerCase());
          // carpeta de instalación → para matar hijos que lance (jre, helpers)
          record.add("dir:" + path.dirname(realPath).toLowerCase());
          openedProcesses.set(target, record);
        }
        trackOpenedByOpenPath(target, real, beforeMap);
      });
      return true;
    }

    // .exe directo: spawn sin shell → child.pid es el PID real del proceso
    // (permite cerrarlo por PID con el árbol completo). Para scripts
    // (.bat/.cmd/.ps1) sí usamos shell.
    const needsShell = [".bat", ".cmd", ".ps1", ".com"].includes(ext);
    const child = spawn(clean, [], {
      detached: true,
      stdio: "ignore",
      shell: needsShell
    });
    recordOpened(clean, child.pid);
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

// Mata el árbol completo de un PID con taskkill /PID <pid> /F /T.
function taskkillPid(taskkillPath, pid) {
  return new Promise((resolve) => {
    execFile(
      taskkillPath,
      ["/PID", String(pid), "/F", "/T"],
      { windowsHide: true },
      (err) => {
        if (err) resolve(false);
        else resolve(true);
      }
    );
  });
}

// Encuentra los PID de procesos cuyo ejecutable en disco coincide con la ruta
// real del target del .lnk o con la ruta del ejecutable. Se usa Win32_Process
// (no el nombre del proceso) para cerrar lo que abrió el launcher aunque el
// nombre del .exe visible sea distinto (Discord.lnk → Discord.exe, etc.).
function findProcessesByExecutablePath(executablePath) {
  return new Promise((resolve) => {
    const ps = systemExe("WindowsPowerShell\\v1.0\\powershell.exe");
    const script =
      "Get-CimInstance Win32_Process | " +
      "Where-Object { $_.ExecutablePath } | " +
      "Select-Object ProcessId, ExecutablePath | ConvertTo-Json";
    execFile(
      ps,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = String(stdout || "").trim();
          if (!raw) {
            resolve([]);
            return;
          }
          const data = JSON.parse(raw);
          const list = Array.isArray(data) ? data : [data];
          const target = String(executablePath || "").replace(/^"|"$/g, "").trim().toLowerCase();
          const matches = list
            .filter((p) => p && p.ProcessId && p.ExecutablePath)
            .filter((p) => {
              const exe = String(p.ExecutablePath).toLowerCase();
              return exe === target;
            })
            .map((p) => Number(p.ProcessId));
          resolve(matches);
        } catch (e) {
          resolve([]);
        }
      }
    );
  });
}

// Encuentra los PID de procesos cuyo ejecutable esté DENTRO de la carpeta de
// instalación de la app (raíz del target del .lnk). Cubre launchers que lanzan
// hijos en subcarpetas (p. ej. Minecraft: LL.exe → jre\bin\javaw.exe) y apps
// con procesos auxiliares (updaters, helpers). Genérico: no conoce apps.
function findProcessesInFolder(folderPath) {
  return new Promise((resolve) => {
    const ps = systemExe("WindowsPowerShell\\v1.0\\powershell.exe");
    const script =
      "Get-CimInstance Win32_Process | " +
      "Where-Object { $_.ExecutablePath } | " +
      "Select-Object ProcessId, ExecutablePath | ConvertTo-Json";
    execFile(
      ps,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = String(stdout || "").trim();
          if (!raw) {
            resolve([]);
            return;
          }
          const data = JSON.parse(raw);
          const list = Array.isArray(data) ? data : [data];
          const folder = String(folderPath || "").replace(/^"|"$/g, "").trim().toLowerCase().replace(/[/\\]+$/, "");
          const matches = list
            .filter((p) => p && p.ProcessId && p.ExecutablePath)
            .filter((p) => {
              const exe = String(p.ExecutablePath).toLowerCase();
              return exe.startsWith(folder + "\\");
            })
            .map((p) => Number(p.ProcessId));
          resolve(matches);
        } catch (e) {
          resolve([]);
        }
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

  const taskkillPath = resolveTaskkill();
  if (taskkillPath !== "taskkill" && !fs.existsSync(taskkillPath)) {
    console.error("[launcherService] taskkill no encontrado en:", taskkillPath);
    return false;
  }

  let closedSomething = false;

  // 1) Procesos que Noxis registró al abrir esta misma ruta:
  //    - PIDs exactos → matar el árbol entero.
  //    - rutas de ejecutable (de .lnk) → buscar por ExecutablePath.
  const tracked = openedProcesses.get(target) || new Set();
  const trackedPids = [...tracked].map((e) => String(e)).filter((e) => /^\d+$/.test(e));
  const trackedPaths = [...tracked].map((e) => String(e)).filter((e) => e.startsWith("path:")).map((e) => e.slice("path:".length));

  if (tracked.size > 0) {
    for (const pid of trackedPids) {
      const ok = await taskkillPid(taskkillPath, pid);
      console.log("[launcherService] taskkill /PID", pid, ok ? "OK" : "no encontrado/fallo");
      if (ok) closedSomething = true;
    }
    openedProcesses.delete(target);
  }

  // 2) Rutas de ejecutable registradas al abrir el .lnk (target real).
  for (const exePath of trackedPaths) {
    const matches = await findProcessesByExecutablePath(exePath);
    for (const pid of matches) {
      const ok = await taskkillPid(taskkillPath, pid);
      console.log("[launcherService] taskkill /PID", pid, "(por ruta " + exePath + ")", ok ? "OK" : "no encontrado/fallo");
      if (ok) closedSomething = true;
    }
  }

  // 2b) Carpeta de instalación registrada al abrir el .lnk: mata TODOS los
  //     procesos cuyo ejecutable vive dentro de esa carpeta (launchers que
  //     lanzan el juego en subcarpetas: Minecraft LL.exe → jre\bin\javaw.exe).
  const trackedDirs = [...tracked].map((e) => String(e)).filter((e) => e.startsWith("dir:")).map((e) => e.slice("dir:".length));
  for (const dirPath of trackedDirs) {
    const matches = await findProcessesInFolder(dirPath);
    for (const pid of matches) {
      const ok = await taskkillPid(taskkillPath, pid);
      console.log("[launcherService] taskkill /PID", pid, "(carpeta " + dirPath + ")", ok ? "OK" : "no encontrado/fallo");
      if (ok) closedSomething = true;
    }
  }

  // 3) Candidatos clásicos por nombre de .exe (basename .lnk y target real).
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

  for (const exeName of candidates) {
    if (!exeName) continue;
    try {
      const ok = await taskkillExe(taskkillPath, exeName);
      console.log("[launcherService] taskkill", exeName, ok ? "OK" : "no encontrado/fallo");
      if (ok) closedSomething = true;
    } catch (err) {
      console.error("[launcherService] taskkill error para", exeName, ":", err.message);
    }
  }

  if (!closedSomething) {
    console.error("[launcherService] no se pudo cerrar:", target, "→", JSON.stringify(candidates));
  }
  return closedSomething;
}

module.exports = { openApp, closeApp, delay };
