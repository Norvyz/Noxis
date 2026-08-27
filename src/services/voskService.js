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

// src/services/voskService.js
// Descarga modelo Vosk (.zip), extrae, reempaqueta como .tar.gz, sirve por HTTP.
// Soporta dos modelos: "small" (ligero, 40MB) y "precise" (preciso, ~1.5GB).

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { app, BrowserWindow } = require("electron");

const MODEL_DIR_NAME = "vosk-model-es";

// Puerto fijo para que el navegador (vosk-browser) cachee el modelo extraído
// en OPFS y no lo re-extraiga en cada arranque. Si está ocupado, cae a aleatorio.
const FIXED_PORT = 47821;

const MODELS = {
  small: {
    id: "small",
    label: "Estándar",
    version: "vosk-model-small-es-0.42",
    url: "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip",
    sizeMB: 40,
    description:
      "Ligero y de arranque rápido (~40 MB). Vocabulario limitado: comete más errores con palabras raras."
  },
  precise: {
    id: "precise",
    label: "Preciso",
    version: "vosk-model-es-0.42",
    url: "https://alphacephei.com/vosk/models/vosk-model-es-0.42.zip",
    sizeMB: 1485,
    description:
      "Alta precisión (~1.5 GB, ~2.5 GB al instalarlo). Escucha mejor el nombre y los comandos, pero ocupa mucho más."
  }
};

let localServer = null;
let localPort = 0;
let activeType = "small";

// ---------------------------------------------------------------
// Directorio del modelo
// ---------------------------------------------------------------
function getModelRoot() {
  return path.join(app.getPath("userData"), MODEL_DIR_NAME);
}

function getModelDir(type) {
  const id = MODELS[type] ? type : "small";
  return path.join(getModelRoot(), id);
}

function isInstalled(type) {
  return fs.existsSync(path.join(getModelDir(type), ".ready"));
}

// Migración: el modelo "small" solía vivir en la raíz vosk-model-es/.
// Lo movemos a su subcarpeta para soportar varios modelos.
function migrateLegacySmall() {
  const root = getModelRoot();
  const legacyTar = path.join(root, "model.tar.gz");
  const legacyReady = path.join(root, ".ready");
  if (!fs.existsSync(legacyReady)) return;

  const dir = getModelDir("small");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) { /* */ }

  const newTar = path.join(dir, "model.tar.gz");
  if (fs.existsSync(legacyTar) && !fs.existsSync(newTar)) {
    fs.renameSync(legacyTar, newTar);
  }
  fs.writeFileSync(path.join(dir, ".ready"), "ok");
  try { fs.unlinkSync(legacyReady); } catch (e) { /* */ }
  console.log("[vosk] Modelo small migrado a subcarpeta");
}

// ---------------------------------------------------------------
// Notificaciones (broadcast a todas las ventanas)
// ---------------------------------------------------------------
function sendStatus(info) {
  const wins = BrowserWindow.getAllWindows();
  wins.forEach((w) => {
    try { w.webContents.send("vosk-status", info); } catch (e) { /* */ }
  });
}

// ---------------------------------------------------------------
// Servidor HTTP local — sirve el .tar.gz de cada modelo
// ---------------------------------------------------------------
function startLocalServer() {
  return new Promise((resolve, reject) => {
    if (localServer && localPort) {
      resolve(localPort);
      return;
    }

    localServer = http.createServer((req, res) => {
      const typeForPath = { "/model-small.tar.gz": "small", "/model-precise.tar.gz": "precise" }[req.url]
        || activeType; // "/model.tar.gz" → modelo activo (compat)
      const tarPath = path.join(getModelDir(typeForPath), "model.tar.gz");

      if (!fs.existsSync(tarPath)) {
        res.writeHead(404);
        res.end("Model not ready yet");
        return;
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/gzip");
      const stream = fs.createReadStream(tarPath);
      stream.pipe(res);
      stream.on("error", () => {
        res.writeHead(500);
        res.end("Error");
      });
    });

    const listen = (port) => {
      localServer.once("error", (err) => {
        if (port === FIXED_PORT && err.code === "EADDRINUSE") {
          console.log("[vosk] Puerto fijo ocupado, usando uno aleatorio");
          listen(0);
        } else {
          reject(err);
        }
      });
      localServer.listen(port, "127.0.0.1", () => {
        localPort = localServer.address().port;
        console.log(`[vosk] Servidor local en puerto ${localPort}`);
        resolve(localPort);
      });
    };

    listen(FIXED_PORT);
  });
}

// ---------------------------------------------------------------
// Descargar .zip
// ---------------------------------------------------------------
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"], 10);
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);

      response.pipe(file);
      response.on("data", (chunk) => {
        downloaded += chunk.length;
        if (totalBytes) {
          const pct = Math.round((downloaded / totalBytes) * 100);
          if (onProgress) onProgress(pct, downloaded, totalBytes);
        }
      });

      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => {
      try { fs.unlinkSync(destPath); } catch (e) { /* */ }
      reject(err);
    });
  });
}

// ---------------------------------------------------------------
// Convertir .zip → .tar.gz
// ---------------------------------------------------------------
async function convertZipToTarGz(zipPath, tarPath, modelDir) {
  const extract = require("extract-zip");
  const tar = require("tar");

  const extractedDir = path.join(modelDir, "extracted");
  if (!fs.existsSync(extractedDir)) {
    fs.mkdirSync(extractedDir, { recursive: true });
  }

  console.log("[vosk] Extrayendo .zip...");
  await extract(zipPath, { dir: extractedDir });

  const entries = fs.readdirSync(extractedDir);
  const modelFolder = entries.find((e) => {
    const full = path.join(extractedDir, e);
    return fs.statSync(full).isDirectory() && e.startsWith("vosk-model");
  });

  if (!modelFolder) {
    throw new Error("No se encontró la carpeta del modelo dentro del .zip");
  }

  const modelContent = path.join(extractedDir, modelFolder);

  console.log("[vosk] Creando .tar.gz...");
  await tar.create(
    {
      gzip: true,
      file: tarPath,
      cwd: modelContent,
      prefix: "model",
    },
    fs.readdirSync(modelContent)
  );

  fs.rmSync(extractedDir, { recursive: true, force: true });
  console.log("[vosk] Conversión completada");
}

// ---------------------------------------------------------------
// Asegurar un modelo (descargar + convertir + marcar listo)
// ---------------------------------------------------------------
async function ensureModel(type) {
  const cfg = MODELS[type] || MODELS.small;
  const modelDir = getModelDir(type);
  const tarPath = path.join(modelDir, "model.tar.gz");
  const zipPath = path.join(modelDir, `${cfg.version}.zip`);
  const markerPath = path.join(modelDir, ".ready");

  if (fs.existsSync(markerPath)) {
    console.log(`[vosk] Modelo ${type} ya listo`);
    sendStatus({ type, status: "ready" });
    return { downloaded: true, already: true };
  }

  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  if (!fs.existsSync(zipPath)) {
    console.log(`[vosk] Descargando modelo ${type} (~${cfg.sizeMB}MB)...`);
    sendStatus({ type, status: "downloading", pct: 0, detail: `Descargando modelo ${cfg.label} (0%)...` });

    let lastPct = -1;
    try {
      await downloadFile(cfg.url, zipPath, (pct) => {
        if (pct !== lastPct) {
          lastPct = pct;
          sendStatus({ type, status: "downloading", pct, detail: `Descargando modelo ${cfg.label}: ${pct}%` });
        }
      });
    } catch (err) {
      sendStatus({ type, status: "error", detail: "No se pudo descargar el modelo" });
      throw new Error(`No se pudo descargar el modelo ${type}: ${err.message}`);
    }
  }

  if (!fs.existsSync(tarPath)) {
    sendStatus({ type, status: "preparing", detail: `Preparando modelo ${cfg.label}...` });
    try {
      await convertZipToTarGz(zipPath, tarPath, modelDir);
    } catch (err) {
      sendStatus({ type, status: "error", detail: "Error al procesar el modelo" });
      throw new Error(`Error al procesar el modelo ${type}: ${err.message}`);
    }
  }

  try { fs.unlinkSync(zipPath); } catch (e) { /* */ }

  fs.writeFileSync(markerPath, "ok");
  sendStatus({ type, status: "ready" });
  console.log(`[vosk] Modelo ${type} listo!`);

  return { downloaded: true, already: false };
}

// ---------------------------------------------------------------
// API pública
// ---------------------------------------------------------------
function getModelUrl() {
  if (!localPort) return null;
  if (!isInstalled(activeType)) return null;
  return `http://127.0.0.1:${localPort}/model-${activeType}.tar.gz`;
}

function setActiveType(type) {
  if (MODELS[type]) activeType = type;
}

function getActiveType() {
  return activeType;
}

function getStatus(type) {
  const t = type || activeType;
  const markerPath = path.join(getModelDir(t), ".ready");
  if (fs.existsSync(markerPath)) return "ready";
  const dir = getModelDir(t);
  if (fs.existsSync(path.join(dir, "model.tar.gz")) || fs.existsSync(path.join(dir, `${MODELS[t].version}.zip`))) {
    return "downloading";
  }
  return "missing";
}

function getModelInfo() {
  return Object.keys(MODELS).map((id) => ({
    id,
    label: MODELS[id].label,
    version: MODELS[id].version,
    sizeMB: MODELS[id].sizeMB,
    description: MODELS[id].description,
    installed: isInstalled(id)
  }));
}

async function download(type) {
  return ensureModel(type);
}

async function start(type) {
  migrateLegacySmall();
  if (type) setActiveType(type);

  const port = await startLocalServer();
  const status = getStatus();
  if (status === "ready") {
    sendStatus({ type: activeType, status: "ready" });
  } else {
    sendStatus({ type: activeType, status, detail: "Sin modelo instalado. Descárgalo desde Configuración." });
  }
  return getModelUrl();
}

function stop() {
  if (localServer) {
    localServer.close();
    localServer = null;
    localPort = 0;
  }
}

module.exports = {
  start,
  stop,
  download,
  getStatus,
  getModelUrl,
  getModelInfo,
  getActiveType,
  setActiveType
};