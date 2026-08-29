const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { shell } = require("electron");

const EXE_EXTS = [".exe", ".bat", ".cmd", ".ps1", ".lnk", ".com"];

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

    const clean = target.replace(/^"|"$/g, "");

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

function guessProcessName(executablePath) {
  const target = String(executablePath || "").trim().replace(/^"|"$/g, "");
  if (!target) return null;
  const base = path.basename(target);
  const ext = path.extname(base).toLowerCase();
  if (ext === ".exe" || ext === ".com") return base;
  return null;
}

function resolveLnkTarget(lnkPath) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }
    const esc = String(lnkPath).replace(/'/g, "''");
    const script =
      `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${esc}');` +
      `Write-Output ($s.TargetPath + '|' + $s.Arguments)`;

    const psPath = systemExe(path.join("WindowsPowerShell", "v1.0", "powershell.exe"));
    execFile(psPath, ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 10000,
      windowsHide: true
    }, (err, stdout) => {
      if (err) {
        console.error("[launcherService] No se pudo resolver el acceso directo:", err.message);
        resolve(null);
        return;
      }
      const line = String(stdout || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      if (!line) {
        resolve(null);
        return;
      }
      const sep = line.indexOf("|");
      resolve({
        target: sep === -1 ? line : line.slice(0, sep),
        args: sep === -1 ? "" : line.slice(sep + 1)
      });
    });
  });
}

async function processNameFromPath(executablePath) {
  const target = String(executablePath || "").trim().replace(/^"|"$/g, "");
  if (!target) return null;
  const ext = path.extname(target).toLowerCase();
  if (ext === ".exe" || ext === ".com") return path.basename(target);

  if (ext === ".lnk") {
    const info = await resolveLnkTarget(target);
    if (!info) return null;

    const procStart = /--processStart[= ]\s*"?([\w.-]+\.exe)"?/i.exec(info.args || "");
    if (procStart) return procStart[1];
    const tgtExt = path.extname(info.target || "").toLowerCase();
    if (tgtExt === ".exe" || tgtExt === ".com") return path.basename(info.target);
  }
  return null;
}

function systemExe(name) {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const candidates = [
    path.join(root, "System32", name),
    path.join(root, "Sysnative", name)
  ];
  return candidates.find((p) => fs.existsSync(p)) || name;
}

function killByName(processName) {
  return new Promise((resolve) => {
    let cmd = "taskkill";
    let args = ["/IM", processName, "/F", "/T"];
    if (process.platform !== "win32") {
      cmd = "pkill";
      args = ["-f", processName];
    } else {
      cmd = systemExe("taskkill.exe");
    }
    try {
      const child = spawn(cmd, args, { windowsHide: true, stdio: "ignore" });
      child.on("error", (err) => {
        console.error("[launcherService] fallo ejecutando cierre:", err.message);
        resolve({ ok: false });
      });
      child.on("close", (code) => resolve({ ok: code === 0 }));
    } catch (err) {
      console.error("[launcherService] fallo cerrando proceso:", err);
      resolve({ ok: false });
    }
  });
}

function isShellProcess(processName) {
  return /^explorer\.exe$/i.test(processName || "");
}

async function closeApp(app) {
  const saved = String((app && app.processName) || "").trim();
  const processName = saved || (await processNameFromPath(app && app.executablePath)) || "";
  if (!processName || isShellProcess(processName)) {
    return { ok: false, reason: "no-process" };
  }
  const result = await killByName(processName);
  return { ok: result.ok, processName };
}

module.exports = { openApp, delay, closeApp, guessProcessName };
