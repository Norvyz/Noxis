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

// src/main/appScanner.js
// Escaneo automático de apps instaladas en Windows.
// Usa registro de Windows, accesos directos del Menú Inicio y Get-StartApps.
// Sin IA: lectura de datos del sistema + comparación de texto.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const APPDATA = process.env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming");
const INDEX_PATH = path.join(APPDATA, "Noxis", "installedApps.json");

// ---------------------------------------------------------------
// CACHÉ EN MEMORIA (evita fs.readFileSync en cada lookup)
// ---------------------------------------------------------------

let _indexCache = null;
let _indexCacheTime = 0;
const INDEX_CACHE_TTL_MS = 30000; // 30 segundos

function loadIndex() {
  const now = Date.now();
  if (_indexCache && (now - _indexCacheTime) < INDEX_CACHE_TTL_MS) {
    return _indexCache;
  }
  try {
    _indexCache = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    _indexCacheTime = now;
    return _indexCache;
  } catch {
    _indexCache = { lastScan: null, apps: [] };
    _indexCacheTime = now;
    return _indexCache;
  }
}

function invalidateIndexCache() {
  _indexCache = null;
  _indexCacheTime = 0;
}

// ---------------------------------------------------------------
// FILTRADO DE RUIDO
// ---------------------------------------------------------------

const NOISE_PATTERNS = [
  /uninstall/i, /desinstalar/i, /desinstal/i,
  /readme/i, /help/i, /ayuda/i, /manual/i,
  /update/i, /actualiz/i, /updater/i,
  /changelog/i, /release notes/i,
  /visit.*website/i, /sitio.*web/i,
  /license/i, /licencia/i,
  /privacy/i, /privacidad/i,
  /support/i, /soporte/i,
  /^microsoft\s+(windows|visual c|net framework)/i,
  /^redistributable/i,
  /^runtime/i,
  /^update for/i,
  /^kb\d+/i,
  /\.msi$/i
];

const VALID_OVERRIDES = [
  /uninstaller$/i
];

function isNoise(name) {
  if (!name || typeof name !== "string") return true;
  const trimmed = name.trim();
  if (trimmed.length < 2) return true;
  if (NOISE_PATTERNS.some((p) => p.test(trimmed))) {
    if (VALID_OVERRIDES.some((p) => p.test(trimmed))) return false;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------
// FUENTE 1: Registro de Windows
// ---------------------------------------------------------------

async function scanRegistry() {
  const ps = `
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
Get-ItemProperty -Path $paths -ErrorAction Ignore |
  Where-Object { $_.DisplayName -and $_.DisplayName -notmatch '^KB' } |
  Select-Object DisplayName, DisplayIcon, InstallLocation, Publisher |
  ConvertTo-Json -Compress -Depth 3
`;

  return new Promise((resolve) => {
    const psPath = getPowerShellPath();
    execFile(psPath, ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error("[appScanner] Registry error:", err.message);
          resolve([]);
          return;
        }
        try {
          const raw = JSON.parse(stdout || "[]");
          const items = Array.isArray(raw) ? raw : [raw];
          const apps = [];
          for (const item of items) {
            if (!item.DisplayName || isNoise(item.DisplayName)) continue;
            let exePath = null;
            if (item.DisplayIcon) {
              const icon = item.DisplayIcon.replace(/^"|"$/g, "").replace(/,\s*-?\d+$/, "").trim();
              if (icon.toLowerCase().endsWith(".exe")) exePath = icon;
            }
            const exeName = exePath ? path.basename(exePath) : null;
            apps.push({
              name: item.DisplayName.trim(),
              exeName,
              exePath,
              installPath: item.InstallLocation || null,
              publisher: item.Publisher || null,
              source: "registry"
            });
          }
          resolve(apps);
        } catch (e) {
          console.error("[appScanner] JSON parse error:", e.message);
          resolve([]);
        }
      }
    );
  });
}

// ---------------------------------------------------------------
// FUENTE 2: Accesos directos del Menú Inicio
// VERSIÓN ASYNC: resuelve todos los .lnk en un solo call de PowerShell
// ---------------------------------------------------------------

async function scanStartMenuShortcuts() {
  const startPaths = [
    path.join(process.env.ProgramData || "C:\\ProgramData",
      "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming"),
      "Microsoft", "Windows", "Start Menu", "Programs")
  ];

  // 1) Recopilar todos los .lnk de forma síncrona (rápido, solo nombres de archivo)
  const lnkFiles = [];
  for (const startPath of startPaths) {
    if (!fs.existsSync(startPath)) continue;
    collectLnkFiles(startPath, lnkFiles);
  }

  if (lnkFiles.length === 0) return [];

  // 2) Resolver TODOS los targets en un SOLO call de PowerShell (batch)
  const resolved = await resolveLnkBatch(lnkFiles);

  // 3) Filtrar y construir resultados
  const apps = [];
  for (const { name, target } of resolved) {
    if (!target) continue;
    const t = target.trim();
    if (!t.toLowerCase().endsWith(".exe")) continue;
    if (!fs.existsSync(t)) continue;
    apps.push({
      name,
      exeName: path.basename(t),
      exePath: t,
      source: "shortcut"
    });
  }

  return apps;
}

function collectLnkFiles(dir, result) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLnkFiles(fullPath, result);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) {
      const name = path.basename(entry.name, ".lnk");
      if (!isNoise(name)) {
        result.push({ name, fullPath });
      }
    }
  }
}

function resolveLnkBatch(lnkFiles) {
  return new Promise((resolve) => {
    // Construir un solo script de PowerShell que resuelva todos los .lnk
    // Usa WScript.Shell.CreateShortcut() para cada uno
    const psLines = lnkFiles.map((f) => {
      const escaped = f.fullPath.replace(/'/g, "''");
      return `$r = try { (New-Object -ComObject WScript.Shell).CreateShortcut('${escaped}').TargetPath } catch { '' }; Write-Output "${f.name}|||$r"`;
    });

    const psScript = psLines.join("; ");

    const psPath = getPowerShellPath();
    execFile(psPath, ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error("[appScanner] Batch resolve error:", err.message);
          resolve(lnkFiles.map((f) => ({ name: f.name, target: null })));
          return;
        }
        // Parsear output: cada línea es "nombre|||target"
        const lines = stdout.split("\n").filter(Boolean);
        const resultMap = new Map();
        for (const line of lines) {
          const sep = line.indexOf("|||");
          if (sep === -1) continue;
          const name = line.substring(0, sep).trim();
          const target = line.substring(sep + 3).trim();
          resultMap.set(name, target);
        }
        resolve(lnkFiles.map((f) => ({
          name: f.name,
          target: resultMap.get(f.name) || null
        })));
      }
    );
  });
}

// ---------------------------------------------------------------
// FUENTE 3: Get-StartApps (Store/UWP)
// ---------------------------------------------------------------

function scanStartApps() {
  return new Promise((resolve) => {
    const psPath = getPowerShellPath();
    execFile(psPath, ["-NoProfile", "-NonInteractive", "-Command", "Get-StartApps | ConvertTo-Json -Compress"],
      { windowsHide: true, timeout: 15000, encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = JSON.parse(stdout || "[]");
          const items = Array.isArray(raw) ? raw : [raw];
          const apps = items
            .filter((a) => a.Name && !isNoise(a.Name))
            .map((a) => ({
              name: a.Name,
              exeName: null,
              exePath: null,
              appId: a.AppID,
              source: "startapps"
            }));
          resolve(apps);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

// ---------------------------------------------------------------
// FUENTE 4: Accesos directos del escritorio
// ---------------------------------------------------------------

function scanDesktopShortcuts() {
  const desktopPaths = [
    path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
    path.join(require("os").homedir(), "Desktop")
  ];

  const lnkFiles = [];
  for (const desktopPath of desktopPaths) {
    if (!fs.existsSync(desktopPath)) continue;
    try {
      const entries = fs.readdirSync(desktopPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) {
          const name = path.basename(entry.name, ".lnk");
          if (!isNoise(name)) {
            lnkFiles.push({ name, fullPath: path.join(desktopPath, entry.name) });
          }
        }
      }
    } catch { /* skip */ }
  }

  if (lnkFiles.length === 0) return Promise.resolve([]);
  return resolveLnkBatch(lnkFiles).then((resolved) => {
    const apps = [];
    for (const { name, target } of resolved) {
      if (!target) continue;
      const t = target.trim();
      if (!t.toLowerCase().endsWith(".exe")) continue;
      apps.push({
        name,
        exeName: path.basename(t),
        exePath: t,
        source: "desktop"
      });
    }
    return apps;
  });
}

// ---------------------------------------------------------------
// FUENTE 5: Exploración de carpetas de instalación comunes
// ---------------------------------------------------------------

function scanProgramFilesDirs() {
  const programDirs = [
    process.env["ProgramFiles"] || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env["ProgramW6432"] || null
  ].filter(Boolean);

  const apps = [];
  for (const dir of programDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(dir, entry.name);
        const appName = entry.name;
        if (isNoise(appName)) continue;
        // Buscar .exe principal en la carpeta raíz
        try {
          const files = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const file of files) {
            if (!file.isFile()) continue;
            if (file.name.toLowerCase().endsWith(".exe")) {
              const exeName = file.name.toLowerCase();
              // Filtrar common noise executables
              if (/^(uninstall|setup|install|update|config|helper|service|agent|crash|report|log|tmp)/i.test(exeName)) continue;
              apps.push({
                name: appName,
                exeName: file.name,
                exePath: path.join(dirPath, file.name),
                source: "programfiles"
              });
              break; // Solo el primer .exe por carpeta
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return apps;
}

// ---------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------

function getPowerShellPath() {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const p = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return fs.existsSync(p) ? p : "powershell";
}

function deduplicate(apps) {
  const map = new Map();
  for (const app of apps) {
    const key = app.name.toLowerCase().trim();
    if (!map.has(key)) {
      map.set(key, app);
    } else {
      // Keep the version with more info (prefer exePath over appId)
      const existing = map.get(key);
      if (!existing.exePath && app.exePath) {
        map.set(key, app);
      }
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------
// ESCANEO PRINCIPAL
// ---------------------------------------------------------------

async function scanAllApps(onProgress) {
  if (onProgress) onProgress("Escaneando registro de Windows...");
  const registry = await scanRegistry();

  if (onProgress) onProgress("Escaneando accesos directos del Menú Inicio...");
  const shortcuts = await scanStartMenuShortcuts();

  if (onProgress) onProgress("Escaneando apps de Microsoft Store...");
  const startApps = await scanStartApps();

  if (onProgress) onProgress("Escaneando accesos directos del escritorio...");
  const desktop = await scanDesktopShortcuts();

  if (onProgress) onProgress("Explorando carpetas de instalación...");
  const programFiles = scanProgramFilesDirs();

  const all = [...registry, ...shortcuts, ...startApps, ...desktop, ...programFiles];
  const deduped = deduplicate(all);
  const filtered = deduped.filter((a) => !isNoise(a.name));

  return filtered;
}

function saveIndex(index) {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index), "utf8"); // sin pretty-print
  invalidateIndexCache(); // invalidar caché después de guardar
}

async function rescanApps(onProgress) {
  const apps = await scanAllApps(onProgress);
  const index = {
    lastScan: new Date().toISOString(),
    apps
  };
  saveIndex(index);
  console.log(`[appScanner] Escaneo completo: ${apps.length} apps detectadas`);
  return index;
}

function shouldRescan() {
  const index = loadIndex();
  if (!index.lastScan || !index.apps.length) return true;
  const lastScan = new Date(index.lastScan);
  const now = new Date();
  const daysSince = (now - lastScan) / (1000 * 60 * 60 * 24);
  return daysSince >= 7;
}

// ---------------------------------------------------------------
// BÚSQUEDA EN EL ÍNDICE
// ---------------------------------------------------------------

function findInIndex(appName, threshold) {
  const voiceMatcher = require("../services/voiceMatcher");
  const norm = voiceMatcher.normalize(appName);
  if (!norm) return null;

  const index = loadIndex(); // USA CACHÉ EN MEMORIA
  const thr = typeof threshold === "number" ? threshold : 0.6;
  let best = null;
  let bestScore = 0;

  for (const app of index.apps) {
    const appNameNorm = voiceMatcher.normalize(app.name);
    if (!appNameNorm) continue;

    // Coincidencia exacta
    if (norm === appNameNorm) {
      return { ...app, matchType: "exact", score: 1 };
    }

    // Contención
    if (appNameNorm.includes(norm) || norm.includes(appNameNorm)) {
      const score = Math.min(norm.length, appNameNorm.length) / Math.max(norm.length, appNameNorm.length);
      if (score > bestScore) {
        bestScore = score;
        best = { ...app, matchType: "contains", score };
      }
    }

    // Fuzzy
    const sim = voiceMatcher.similarity(norm, appNameNorm);
    if (sim > bestScore && sim >= thr) {
      bestScore = sim;
      best = { ...app, matchType: "fuzzy", score: sim };
    }
  }

  return best;
}

module.exports = {
  scanAllApps,
  rescanApps,
  loadIndex,
  saveIndex,
  findInIndex,
  shouldRescan,
  isNoise,
  invalidateIndexCache,
  INDEX_PATH
};
