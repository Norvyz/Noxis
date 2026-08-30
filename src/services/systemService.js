// src/services/systemService.js
// Comandos de sistema Windows via voz. Sin dependencias externas.
// Si process.platform !== "win32", las funciones retornan { ok:false, reason:"not-supported" }.

const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { shell, app } = require("electron");

function isWin32() {
  return process.platform === "win32";
}

function notSupported() {
  return { ok: false, reason: "not-supported" };
}

function systemExe(name) {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const p = path.join(root, "System32", name);
  return fs.existsSync(p) ? p : name;
}

function runExe(exe, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(exe, args || [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      resolve({ ok: true });
    } catch (err) {
      console.error("[systemService] fallo al ejecutar:", exe, err.message);
      resolve({ ok: false });
    }
  });
}

function runExeFile(exe, args, timeout) {
  return new Promise((resolve) => {
    execFile(exe, args || [], { windowsHide: true, timeout: timeout || 20000 }, (err) => {
      if (err) {
        console.error("[systemService] fallo execFile:", exe, err.message);
        resolve({ ok: false, reason: "exec-error" });
        return;
      }
      resolve({ ok: true });
    });
  });
}

function runPowershell(script) {
  return runExeFile(systemExe("WindowsPowerShell\\v1.0\\powershell.exe"), [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    script
  ]);
}

// Envía un atajo de medio (VK_): volumen, mute, etc. via WScript.SendKeys
function sendVkKey(charCode) {
  const script = `$w = New-Object -ComObject WScript.Shell; $w.SendKeys([char]${charCode})`;
  return runPowershell(script);
}

function setVolume(level) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const val = Math.max(0, Math.min(100, Math.round(level || 60)));
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace CoreAudio -Name VolumeWrapper -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotifications);
  int UnregisterControlChangeNotify(IntPtr pNotifications);
  int GetChannelCount(out int pnChannelCount);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int SetMute(bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDevice ppDevices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  int GetDevice(string pwstrId, out IMMDevice ppDevice);
  int RegisterEndpointNotificationCallback(IntPtr pClient);
  int UnregisterEndpointNotificationCallback(IntPtr pClient);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
  int OpenPropertyStore(int stgmAccess, IntPtr ppProperties);
  int GetId(out string ppstrId);
  int GetState(out int pdwState);
}
public class Volume {
  public static void Set(int level) {
    var devEnum = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    devEnum.GetDefaultAudioEndpoint(0, 1, out dev);
    IAudioEndpointVolume epv;
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    dev.Activate(ref iid, 1, IntPtr.Zero, out epv);
    epv.SetMasterVolumeLevelScalar(level / 100f, Guid.Empty);
    Marshal.ReleaseComObject(epv);
  }
}
"@
[CoreAudio.VolumeWrapper.Volume]::Set(${val})
`;
  return runPowershell(script);
}

function volumeUp() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return sendVkKey(175); // VK_VOLUME_UP
}

function volumeDown() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return sendVkKey(174); // VK_VOLUME_DOWN
}

function muteToggle() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return sendVkKey(173); // VK_VOLUME_MUTE
}

function lockScreen() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return runExe(systemExe("rundll32.exe"), ["user32.dll,LockWorkStation"]);
}

function openTaskManager() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return runExe(systemExe("taskmgr.exe"), []);
}

function openExplorer(folderPath) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const target = String(folderPath || "").trim() || "C:\\";
  if (fs.existsSync(target)) {
    try {
      shell.openPath(target);
      return Promise.resolve({ ok: true });
    } catch (err) {
      console.error("[systemService] openExplorer fallo:", err.message);
      return Promise.resolve({ ok: false });
    }
  }
  return new Promise((resolve) => {
    execFile("explorer.exe", [target], { windowsHide: true }, (err) => {
      if (err) {
        console.error("[systemService] openExplorer fallo:", err.message);
        resolve({ ok: false });
        return;
      }
      resolve({ ok: true });
    });
  });
}

function emptyRecycleBin() {
  if (!isWin32()) return Promise.resolve(notSupported());
  const script = "Clear-RecycleBin -Force -ErrorAction SilentlyContinue";
  return runPowershell(script);
}

function systemShutdown(delaySeconds) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const delay = Math.max(0, parseInt(delaySeconds, 10) || 5);
  return runExe(systemExe("shutdown.exe"), ["/s", "/t", String(delay)]);
}

function systemRestart() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return runExe(systemExe("shutdown.exe"), ["/r", "/t", "5"]);
}

function sleepMode() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return runExe(systemExe("rundll32.exe"), ["powrprof.dll,SetSuspendState 0,1,0"]);
}

// =========================================================
// Carpetas y archivos (abrir, crear, leer)
// =========================================================

const KNOWN_FOLDERS = {
  descargas: "downloads",
  descarga: "downloads",
  download: "downloads",
  downloads: "downloads",
  documentos: "documents",
  documento: "documents",
  document: "documents",
  "misdocumentos": "documents",
  "mis documentos": "documents",
  escritorio: "desktop",
  desktop: "desktop",
  imagenes: "pictures",
  imagen: "pictures",
  fotos: "pictures",
  foto: "pictures",
  pictures: "pictures",
  musica: "music",
  música: "music",
  music: "music",
  videos: "videos",
  video: "videos",
  inicio: "home",
  home: "home",
  usuario: "home"
};

const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".log", ".csv", ".json", ".xml", ".html", ".htm",
  ".ini", ".cfg", ".env", ".js", ".ts", ".py", ".java", ".ps1", ".bat", ".cmd",
  ".sh", ".yml", ".yaml", ".css", ".cpp", ".c", ".h", ".rb", ".go", ".rs"
];

function isAbsoluteOrDrive(p) {
  return /^[a-z]:[\\/]/i.test(p) || /^\\\\/.test(p) || /^[\\/]/.test(p);
}

function expandEnv(p) {
  return String(p || "").replace(/%([^%]+)%/g, (_, k) => process.env[k] || `%${k}%`);
}

function resolveFolderTarget(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // 1) Palabras especiales (descargas, documentos, escritorio…)
  const token = raw.toLowerCase().replace(/\s+/g, " ").replace(/[.,!?¡¿]/g, "").trim();
  const known = KNOWN_FOLDERS[token] || KNOWN_FOLDERS[token.replace(/\s+/g, "")];
  if (known) {
    return app.getPath(known);
  }

  // 2) Ruta absoluta / con separador
  const expanded = expandEnv(raw);
  if (isAbsoluteOrDrive(expanded) && fs.existsSync(expanded)) {
    return expanded;
  }

  // 3) Buscar por nombre en carpetas típicas
  const base = raw.replace(/\\/g, "/").replace(/^.*[/]/, "").trim();
  if (base) {
    const candidates = [
      path.join(app.getPath("desktop"), base),
      path.join(app.getPath("downloads"), base),
      path.join(app.getPath("documents"), base),
      path.join(app.getPath("home"), base)
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

function sanitizeName(name, fallback) {
  let clean = String(name || "")
    .trim()
    .replace(/[<>:|"?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return clean || fallback;
}

function openFolder(target) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const resolved = resolveFolderTarget(target);
  if (!resolved) {
    return Promise.resolve({ ok: false, reason: "not-found", request: String(target || "") });
  }
  if (!fs.existsSync(resolved)) {
    return Promise.resolve({ ok: false, reason: "no-exists", path: resolved });
  }
  return openExplorer(resolved).then((r) => (r.ok ? { ok: true, path: resolved } : { ok: false, reason: "open-error" }));
}

function createFolder(name) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const clean = sanitizeName(name, "Nueva carpeta");
  const dir = path.join(app.getPath("desktop"), clean);
  try {
    fs.mkdirSync(dir, { recursive: false });
    return Promise.resolve({ ok: true, path: dir, name: clean });
  } catch (err) {
    if (fs.existsSync(dir)) {
      return Promise.resolve({ ok: true, path: dir, name: clean, exists: true });
    }
    return Promise.resolve({ ok: false, reason: err.message });
  }
}

function createTextFile(name, content) {
  if (!isWin32()) return Promise.resolve(notSupported());
  let clean = sanitizeName(name, "nota");
  if (!path.extname(clean)) clean += ".txt";
  const file = path.join(app.getPath("desktop"), clean);
  try {
    fs.writeFileSync(file, String(content == null ? "" : content), "utf8");
    return Promise.resolve({ ok: true, path: file, name: clean });
  } catch (err) {
    return Promise.resolve({ ok: false, reason: err.message });
  }
}

function readTextFile(target) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const raw = String(target || "").trim();
  let file = null;

  const expanded = expandEnv(raw);
  if (isAbsoluteOrDrive(expanded) && fs.existsSync(expanded)) {
    file = expanded;
  } else {
    const base = raw.replace(/\\/g, "/").replace(/^.*[/]/, "").trim();
    if (base) {
      const candidates = [
        path.join(app.getPath("desktop"), base),
        path.join(app.getPath("downloads"), base),
        path.join(app.getPath("documents"), base),
        path.join(app.getPath("home"), base)
      ];
      file = candidates.find((c) => fs.existsSync(c)) || null;
    }
  }

  if (!file) return Promise.resolve({ ok: false, reason: "not-found", request: target });

  const ext = path.extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.includes(ext)) {
    return Promise.resolve({ ok: false, reason: `${ext || "extensión"} no soportada para leer` });
  }
  const MAX_BYTES = 512 * 1024;
  let stats;
  try {
    stats = fs.statSync(file);
  } catch (err) {
    return Promise.resolve({ ok: false, reason: "no-access" });
  }
  if (stats.isDirectory()) return Promise.resolve({ ok: false, reason: "es una carpeta" });

  const readLen = Math.min(stats.size, MAX_BYTES);
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, 0);
    fs.closeSync(fd);
    let text = buf.toString("utf8");
    let truncated = false;
    if (stats.size > MAX_BYTES) {
      text = text.slice(0, Math.min(text.length, MAX_BYTES));
      truncated = true;
    }
    return Promise.resolve({ ok: true, path: file, content: text, truncated });
  } catch (err) {
    return Promise.resolve({ ok: false, reason: "no-access" });
  }
}

module.exports = {
  setVolume,
  volumeUp,
  volumeDown,
  muteToggle,
  lockScreen,
  openTaskManager,
  openExplorer,
  emptyRecycleBin,
  systemShutdown,
  systemRestart,
  sleepMode,
  openFolder,
  createFolder,
  createTextFile,
  readTextFile
};