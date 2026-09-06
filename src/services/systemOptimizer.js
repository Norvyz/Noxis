// System Optimizer - Facade principal del sistema de optimización modular
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");

const systemScanner = require("./systemScanner");
const performanceAnalyzer = require("./performanceAnalyzer");
const systemBackup = require("./systemBackup");
const processManager = require("./processManager");
const systemMonitor = require("./systemMonitor");

function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout, stderr });
    });
  });
}

function getTempDirs() {
  const userTemp = path.join(os.homedir(), "AppData", "Local", "Temp");
  return [
    { name: "Temp del sistema", path: "C:\\Windows\\Temp", safe: true },
    { name: "Temp del usuario", path: userTemp, safe: true },
    { name: "Caché de thumbnails", path: path.join(os.homedir(), "AppData", "Local", "Microsoft", "Windows", "Explorer"), safe: true },
    { name: "Prefetch", path: "C:\\Windows\\Prefetch", safe: true },
    { name: "Logs de Windows", path: "C:\\Windows\\Logs", safe: true },
    { name: "Caché de Windows Update", path: "C:\\Windows\\SoftwareDistribution\\Download", safe: true },
    { name: "Caché de errores", path: "C:\\ProgramData\\Microsoft\\Windows\\WER", safe: true },
    { name: "Caché de Edge", path: path.join(os.homedir(), "AppData", "Local", "Microsoft", "Edge", "User Data", "Default", "Cache"), safe: true },
    { name: "Caché de Chrome", path: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Cache"), safe: true },
    { name: "Caché de Firefox", path: path.join(os.homedir(), "AppData", "Local", "Mozilla", "Firefox", "Profiles"), safe: true },
  ];
}

function getDirSize(dirPath) {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        totalSize += getDirSize(fullPath);
      } else {
        try { totalSize += fs.statSync(fullPath).size; } catch (e) { /* skip */ }
      }
    }
  } catch (e) { /* skip */ }
  return totalSize;
}

function cleanDir(dirPath) {
  let cleaned = 0;
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      try {
        if (file.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleaned++;
        } else {
          fs.unlinkSync(fullPath);
          cleaned++;
        }
      } catch (e) { /* skip locked */ }
    }
  } catch (e) { /* skip */ }
  return cleaned;
}

// ===================== OPTIMIZACIÓN BÁSICA (backward-compatible) =====================
async function optimizeSystem(onProgress) {
  const results = {
    tempCleaned: 0, tempSizeBefore: 0, tempSizeAfter: 0,
    dnsFlushed: false, thumbnailCacheCleared: false, recycleBinEmptied: false, errors: []
  };

  const dirs = getTempDirs();
  for (const dir of dirs) { try { results.tempSizeBefore += getDirSize(dir.path); } catch (e) { /* skip */ } }

  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (onProgress) onProgress(`Limpiando ${dir.name}...`, Math.round(((i + 1) / dirs.length) * 80));
    try { if (fs.existsSync(dir.path)) results.tempCleaned += cleanDir(dir.path); } catch (e) { results.errors.push(`${dir.name}: ${e.message}`); }
  }

  for (const dir of dirs) { try { results.tempSizeAfter += getDirSize(dir.path); } catch (e) { /* skip */ } }

  if (onProgress) onProgress("Limpiando caché DNS...", 85);
  try { await runCommand("ipconfig /flushdns"); results.dnsFlushed = true; } catch (e) { results.errors.push("DNS: " + e.message); }

  if (onProgress) onProgress("Limpiando caché de thumbnails...", 90);
  try { await runCommand('del /q /f /s "%LocalAppData%\\Microsoft\\Windows\\Explorer\\thumbcache_*.db"'); results.thumbnailCacheCleared = true; } catch (e) { results.errors.push("Thumbnails: " + e.message); }

  if (onProgress) onProgress("Vaciando papelera...", 95);
  try {
    await runCommand("rd /s /q C:\\$Recycle.Bin");
    results.recycleBinEmptied = true;
  } catch (e) {
    try { await runCommand("Clear-RecycleBin -Force -ErrorAction SilentlyContinue"); results.recycleBinEmptied = true; } catch (e2) { results.errors.push("Papelera: " + e2.message); }
  }

  if (onProgress) onProgress("Completado", 100);
  const freedBytes = results.tempSizeBefore - results.tempSizeAfter;
  results.freedMB = Math.max(0, Math.round(freedBytes / (1024 * 1024)));
  results.freedGB = (results.freedMB / 1024).toFixed(2);
  return results;
}

// ===================== SYSTEM INFO (backward-compatible) =====================
async function getSystemInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();
  let diskInfo = null;
  try {
    const result = await runCommand('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv');
    if (result.ok && result.stdout) {
      const lines = result.stdout.trim().split("\n").filter(l => l.trim());
      if (lines.length > 1) {
        const parts = lines[1].split(",");
        if (parts.length >= 3) {
          const free = parseInt(parts[1]) || 0;
          const total = parseInt(parts[2]) || 0;
          diskInfo = { totalGB: (total / (1024 ** 3)).toFixed(1), freeGB: (free / (1024 ** 3)).toFixed(1), usedPercent: Math.round(((total - free) / total) * 100) };
        }
      }
    }
  } catch (e) { /* skip */ }

  return {
    hostname: os.hostname(), platform: os.platform(), release: os.release(), uptime: Math.round(os.uptime() / 3600),
    memory: { totalGB: (totalMem / (1024 ** 3)).toFixed(1), usedGB: (usedMem / (1024 ** 3)).toFixed(1), freeGB: (freeMem / (1024 ** 3)).toFixed(1), percent: Math.round((usedMem / totalMem) * 100) },
    cpu: { model: (cpus[0] ? cpus[0].model : "Desconocido").trim(), cores: cpus.length },
    disk: diskInfo
  };
}

// ===================== NUEVA ARQUITECTURA MODULAR =====================

async function fullScan(onProgress) {
  return await systemScanner.fullScan(onProgress);
}

async function analyzeSystem(scan) {
  return performanceAnalyzer.analyzeAll(scan);
}

async function createBackupSnapshot(description, entries) {
  return systemBackup.createBackup(description, entries);
}

async function restoreSnapshot(backupId) {
  return systemBackup.restoreBackup(backupId);
}

function listSnapshots() {
  return systemBackup.listBackups();
}

function deleteSnapshot(backupId) {
  return systemBackup.deleteBackup(backupId);
}

function getSnapshotDetail(backupId) {
  return systemBackup.getBackupDetail(backupId);
}

async function listAllProcesses(sortBy, limit) {
  return processManager.listProcesses(sortBy, limit);
}

async function killProcessById(pid, force) {
  return processManager.killProcess(pid, force);
}

async function killProcessByName(name, force) {
  return processManager.killProcessByName(name, force);
}

async function getHeavyProcesses() {
  const cpu = await processManager.getCPUIntensiveProcesses(10);
  const ram = await processManager.getMemoryIntensiveProcesses(200);
  return { cpu, ram };
}

async function getStartupItems() {
  return processManager.getStartupPrograms();
}

async function getRunningServices() {
  return processManager.getServices("Running");
}

function startRealtimeMonitor(intervalMs, callback) {
  systemMonitor.startMonitoring(intervalMs, callback);
}

function stopRealtimeMonitor() {
  systemMonitor.stopMonitoring();
}

function getMonitorSnapshot() {
  return systemMonitor.getSnapshot();
}

function isMonitoringActive() {
  return systemMonitor.isMonitoring();
}

module.exports = {
  // Legacy (backward-compatible)
  optimizeSystem, getSystemInfo, getTempDirs, getDirSize,
  // New modular architecture
  fullScan, analyzeSystem,
  createBackupSnapshot, restoreSnapshot, listSnapshots, deleteSnapshot, getSnapshotDetail,
  listAllProcesses, killProcessById, killProcessByName, getHeavyProcesses,
  getStartupItems, getRunningServices,
  startRealtimeMonitor, stopRealtimeMonitor, getMonitorSnapshot, isMonitoringActive
};
