// System Backup - Respaldo y reversión de cambios del sistema
const fs = require("fs");
const path = require("path");
const os = require("os");

const BACKUP_DIR = path.join(os.homedir(), "AppData", "Local", "Noxis", "backups");

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function generateId() {
  return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function createBackup(description, entries) {
  ensureBackupDir();
  const id = generateId();
  const backup = {
    id,
    description,
    timestamp: new Date().toISOString(),
    entries: [],
    status: "created"
  };

  for (const entry of entries) {
    const backupEntry = {
      originalPath: entry.path,
      type: entry.type,
      data: null,
      restored: false
    };

    if (entry.type === "file" && fs.existsSync(entry.path)) {
      try {
        backupEntry.data = fs.readFileSync(entry.path);
        backup.entries.push(backupEntry);
      } catch (e) {
        backup.entries.push({ ...backupEntry, error: e.message });
      }
    } else if (entry.type === "registry") {
      backupEntry.data = entry.value;
      backup.entries.push(backupEntry);
    } else if (entry.type === "setting") {
      backupEntry.data = entry.value;
      backup.entries.push(backupEntry);
    }
  }

  const backupPath = path.join(BACKUP_DIR, `${id}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  return { id, path: backupPath, entryCount: backup.entries.length };
}

function restoreBackup(backupId) {
  const backupPath = path.join(BACKUP_DIR, `${backupId}.json`);
  if (!fs.existsSync(backupPath)) return { ok: false, error: "Respaldo no encontrado" };

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  } catch (e) {
    return { ok: false, error: "Error leyendo respaldo" };
  }

  let restored = 0;
  let errors = [];

  for (const entry of backup.entries) {
    if (entry.error) continue;
    try {
      if (entry.type === "file" && entry.data) {
        const dir = path.dirname(entry.originalPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(entry.originalPath, entry.data);
        restored++;
      } else if (entry.type === "setting") {
        restored++;
      }
    } catch (e) {
      errors.push(`${entry.originalPath}: ${e.message}`);
    }
  }

  backup.status = "restored";
  backup.restoredAt = new Date().toISOString();
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  return { ok: true, restored, errors, total: backup.entries.length };
}

function listBackups() {
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), "utf8"));
      return {
        id: data.id,
        description: data.description,
        timestamp: data.timestamp,
        entryCount: data.entries ? data.entries.length : 0,
        status: data.status
      };
    } catch (e) {
      return { id: f.replace(".json", ""), error: e.message };
    }
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function deleteBackup(backupId) {
  const backupPath = path.join(BACKUP_DIR, `${backupId}.json`);
  if (!fs.existsSync(backupPath)) return { ok: false, error: "Respaldo no encontrado" };
  try {
    fs.unlinkSync(backupPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getBackupDetail(backupId) {
  const backupPath = path.join(BACKUP_DIR, `${backupId}.json`);
  if (!fs.existsSync(backupPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(backupPath, "utf8"));
  } catch (e) {
    return null;
  }
}

module.exports = { createBackup, restoreBackup, listBackups, deleteBackup, getBackupDetail, BACKUP_DIR };
