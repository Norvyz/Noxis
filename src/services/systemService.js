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

// Pulsa una tecla de volumen real del sistema (VK_VOLUME_MUTE/DOWN/UP) vía
// keybd_event. Estas teclas SÍ mueven el volumen audible en cualquier
// dispositivo, incluidos los virtuales de SteelSeries que bloquean CoreAudio.
function pressMediaKey(vk) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const hex = "0x" + vk.toString(16);
  const script = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class MK{[DllImport("user32.dll")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,System.UIntPtr dwExtraInfo);}'
[MK]::keybd_event([byte]${hex},0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MK]::keybd_event([byte]${hex},0,2,[UIntPtr]::Zero)
`;
  return runPowershell(script);
}

// Ajusta el volumen del sistema aproximándose al % pedido. Lee el nivel REAL con
// waveOutGetVolume y calcula el delta exacto (target - actual), pulsando la tecla de
// volumen (VK) la cantidad de pasos justa. Esto hace que "de 16 a 75" suba 59 puntos
// (no desde supuesto 0) y "a 15" baje desde el actual. La dirección del verbo solo
// se usa como respaldo si no se puede leer el nivel.
function setVolume(level, direction) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const val = Math.max(0, Math.min(100, Math.round(level || 60)));
  const dir = direction === "up" || direction === "down" ? direction : null;
  const dirInt = dir === "up" ? 1 : dir === "down" ? -1 : 0;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NoxisVol {
  [DllImport("winmm.dll")] public static extern uint waveOutGetVolume(IntPtr hwo, out uint pdwVolume);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
  const uint KEYUP = 2;

  public static int GetCurrent() {
    uint v;
    if (waveOutGetVolume(IntPtr.Zero, out v) != 0) return -1;
    return (int)Math.Round((double)(v & 0xFFFF) * 100.0 / 65535.0);
  }

  // direction de respaldo: 1=subir, -1=bajar, 0=auto
  public static int Run(int target, int direction) {
    byte up = 0xAF, down = 0xAE;
    int from = GetCurrent();
    bool readOk = (from >= 0 && from <= 100);
    int delta;
    if (!readOk) {
      // no se pudo leer → supuestos según dirección
      delta = direction >= 0 ? target : -(100 - target);
    } else {
      delta = target - from;
      // Sanidad con el verbo: si pidió SUBIR pero la lectura dice que ya está
      // por encima del target (lectura fija en 100), o pidió BAJAR y dice que
      // está por debajo (lectura fija en 0), la lectura no es confiable →
      // mover desde el extremo opuesto así el volumen cambia en la dirección pedida.
      if (direction > 0 && delta < 0)  delta = target;      // subir desde ~0
      if (direction < 0 && delta > 0)  delta = -(100 - target); // bajar desde ~100
    }
    byte vk = delta > 0 ? up : down;
    int steps = (int)Math.Round(Math.Abs(delta) / 2.0);
    if (delta == 0) steps = 0;
    steps = Math.Min(Math.Max(steps, 0), 60);
    for (int i = 0; i < steps; i++) {
      keybd_event(vk, 0, 0, UIntPtr.Zero);
      keybd_event(vk, 0, KEYUP, UIntPtr.Zero);
      System.Threading.Thread.Sleep(40);
    }
    return target;
  }
}
"@
$dirInt = ${dirInt}
$steps = [NoxisVol]::Run(${val}, $dirInt)
`;
  return new Promise((resolve) => {
    execFile(
      systemExe("WindowsPowerShell\\v1.0\\powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, timeout: 20000 },
      (err) => {
        if (err) {
          console.error("[systemService] setVolume fallo:", err.message);
          resolve({ ok: false, reason: "exec-error" });
          return;
        }
        resolve({ ok: true, volume: val });
      }
    );
  });
}

// Lista los dispositivos de salida (render) con su id, nombre y si es el por defecto.
function listAudioOutputs() {
  if (!isWin32()) return Promise.resolve({ ok: false, reason: "not-supported", devices: [] });
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NoxisOuts {
  [StructLayout(LayoutKind.Sequential)]
  public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)]
  public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; }

  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out int c);
    int GetAt(int i, out PROPERTYKEY pk);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    int Commit();
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  public class MMDeviceEnumeratorComObject { }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection { int GetCount(out int c); int Item(int n, out IMMDevice pp); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
    int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }
  public static string Run() {
    PROPERTYKEY pk = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    var e=(IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    string defId = null;
    try { IMMDevice dd; e.GetDefaultAudioEndpoint(0,1,out dd); string d; dd.GetId(out d); defId = d; } catch {}
    IMMDeviceCollection c; e.EnumAudioEndpoints(0,1,out c);
    int n; c.GetCount(out n);
    var sb = new StringBuilder();
    sb.AppendLine("DEFAULT_ID=" + defId);
    for (int i=0;i<n;i++){
      IMMDevice d; c.Item(i,out d);
      string id; d.GetId(out id);
      string name = "";
      IPropertyStore ps;
      try { d.OpenPropertyStore(0,out ps); if(ps!=null){ PROPVARIANT pv; if(ps.GetValue(ref pk,out pv)==0 && pv.vt==31 && pv.pointer!=IntPtr.Zero) name=Marshal.PtrToStringUni(pv.pointer); } } catch {}
      sb.AppendLine("DEV:" + id + "|" + name + "|" + (id==defId));
    }
    return sb.ToString();
  }
}
"@
[NoxisOuts]::Run()
`;
  return new Promise((resolve) => {
    execFile(
      systemExe("WindowsPowerShell\\v1.0\\powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) {
          console.error("[systemService] listAudioOutputs fallo:", err.message);
          resolve({ ok: false, reason: "exec-error", devices: [] });
          return;
        }
        const out = String(stdout || "");
        const devices = [];
        let defaultId = null;
        const mDefault = out.match(/DEFAULT_ID=(\S+)/);
        if (mDefault) defaultId = mDefault[1];
        for (const line of out.split(/\r?\n/)) {
          if (!line.startsWith("DEV:")) continue;
          const body = line.slice(4);
          const idx = body.indexOf("|");
          if (idx < 0) continue;
          const id = body.slice(0, idx);
          const rest = body.slice(idx + 1);
          const idx2 = rest.lastIndexOf("|");
          const name = idx2 >= 0 ? rest.slice(0, idx2) : rest;
          const isDefault = idx2 >= 0 ? rest.slice(idx2 + 1) === "true" : false;
          devices.push({ id, name, isDefault });
        }
        if (defaultId != null && devices.length && !devices.some((d) => d.isDefault)) {
          const def = devices.find((d) => d.id === defaultId);
          if (def) def.isDefault = true;
        }
        resolve({ ok: true, devices, defaultId });
      }
    );
  });
}

function volumeUp() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return pressMediaKey(0xAF); // VK_VOLUME_UP
}

function volumeDown() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return pressMediaKey(0xAE); // VK_VOLUME_DOWN
}

function muteToggle() {
  if (!isWin32()) return Promise.resolve(notSupported());
  return pressMediaKey(0xAD); // VK_VOLUME_MUTE
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

function createFolder(name, location) {
  if (!isWin32()) return Promise.resolve(notSupported());
  const clean = sanitizeName(name, "Nueva carpeta");
  const folderKey = KNOWN_FOLDERS[(location || "").toLowerCase().trim()];
  const basePath = folderKey ? app.getPath(folderKey) : app.getPath("desktop");
  const dir = path.join(basePath, clean);
  try {
    fs.mkdirSync(dir, { recursive: true });
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

// =========================================================
// Volumen: leer nivel actual
// =========================================================

// Lee el volumen del sistema global (winmm waveOutGetVolume). Este refleja el
// nivel maestro real y funciona con dispositivos virtuales como SteelSeries.
function getVolume() {
  if (!isWin32()) return Promise.resolve(notSupported());
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NoxisGetVol {
  [DllImport("winmm.dll")] public static extern uint waveOutGetVolume(IntPtr hwo, out uint pdwVolume);

  public static int Get() {
    uint v;
    uint r = waveOutGetVolume(IntPtr.Zero, out v);
    if (r != 0) return -1;
    double pct = (double)(v & 0xFFFF) * 100.0 / 65535.0;
    return (int)Math.Round(pct);
  }
}
"@
[NoxisGetVol]::Get()
`;
  return new Promise((resolve) => {
    execFile(
      systemExe("WindowsPowerShell\\v1.0\\powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) {
          console.error("[systemService] getVolume fallo:", err.message);
          resolve({ ok: false, reason: "exec-error" });
          return;
        }
        const pct = parseInt((stdout || "").trim(), 10);
        if (isNaN(pct) || pct < 0) {
          resolve({ ok: false, reason: "parse-error" });
          return;
        }
        resolve({ ok: true, volume: Math.max(0, Math.min(100, pct)) });
      }
    );
  });
}

// =========================================================
// Mover ventana de Noxis a esquinas / centro
// =========================================================

function moveWindowToCorner(win, corner) {
  if (!win) return { ok: false, reason: "no-window" };
  const { width: screenW, height: screenH } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  const [winW, winH] = win.getSize();
  const margin = 40;
  let x, y;

  switch (corner) {
    case "top-left":
      x = margin;
      y = margin;
      break;
    case "top-right":
      x = screenW - winW - margin;
      y = margin;
      break;
    case "bottom-left":
      x = margin;
      y = screenH - winH - margin;
      break;
    case "bottom-right":
      x = screenW - winW - margin;
      y = screenH - winH - margin;
      break;
    case "center":
      x = Math.round((screenW - winW) / 2);
      y = Math.round((screenH - winH) / 2);
      break;
    default:
      return { ok: false, reason: "unknown-corner" };
  }

  win.setPosition(x, y);
  return { ok: true, corner };
}

// =========================================================
// Cerrar aplicaciones por nombre de proceso
// =========================================================

function closeApp(processName) {
  if (!isWin32()) return Promise.resolve(notSupported());
  let exe = processName || "";
  if (!exe) return Promise.resolve({ ok: false, reason: "no-name" });
  exe = exe.replace(/[<>|"]/g, "").trim();
  if (!exe.toLowerCase().endsWith(".exe")) exe += ".exe";

  return new Promise((resolve) => {
    execFile(
      systemExe("taskkill.exe"),
      ["/IM", exe, "/F"],
      { windowsHide: true, timeout: 10000 },
      (err) => {
        if (err) {
          // taskkill returns exit code != 0 if process not found
          resolve({ ok: false, reason: "not-found", process: exe });
          return;
        }
        resolve({ ok: true, process: exe });
      }
    );
  });
}

module.exports = {
  setVolume,
  listAudioOutputs,
  volumeUp,
  volumeDown,
  muteToggle,
  getVolume,
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
  readTextFile,
  moveWindowToCorner,
  closeApp
};