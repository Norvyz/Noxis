// src/services/whisperService.js
// Reconocimiento de voz local con whisper.cpp (whisper large-v3-turbo).
// - Sin dependencias npm: el binario y el modelo se descargan solos (GitHub +
//   HuggingFace) a la carpeta de datos de la app.
// - No depende de Ollama (el build viejo que trae este equipo no soporta
//   whisper); transcribimos con "whisper-cli" por línea de comandos.
// - El renderer no cambia: seguimos exponiendo el mismo contrato (getStatus,
//   ensureModel, transcribe, MODELS) y los eventos tipo "whisper".

const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { spawn, execFile } = require("child_process");

const BIN_ZIP_URL =
  "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-blas-bin-x64.zip";
const BIN_ZIP_BYTES = 21147582;
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
const MODEL_FILENAME = "ggml-large-v3-turbo-q5_0.bin";
const MODEL_BYTES = 574041195;

// large-v3-turbo q5_0: calidad casi igual al large-v3 pero ~4,5x más rápido.
const MODELS = {
  whisper: {
    id: "whisper",
    label: "Whisper IA (local)",
    model: MODEL_FILENAME,
    fallback: MODEL_FILENAME,
    sizeMB: Math.round((BIN_ZIP_BYTES + MODEL_BYTES) / (1024 * 1024)),
    version: "large-v3-turbo q5_0",
    description:
      "Reconocimiento local de máxima calidad (Whisper large-v3-turbo). " +
      "Es el que mejor español entiende, funciona sin Internet, sin Ollama y " +
      "se descarga una sola vez (~600 MB)."
  }
};

const state = {
  alive: false,
  installed: false,
  modelName: null,
  pulling: false,
  pullPct: null,
  pullLine: "",
  lastError: "",
  cancelled: false
};

let notify = null;
function setNotify(cb) { notify = cb; }

function emitStatus(detail) {
  if (notify) {
    notify({
      type: "whisper",
      status: state.pulling ? "downloading" : state.installed ? "ready" : state.lastError ? "error" : "missing",
      pct: state.pullPct,
      detail: detail || state.pullLine || ""
    });
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------
function baseDir() {
  return path.join(app.getPath("userData"), "whisper");
}

function modelPath() {
  return path.join(baseDir(), MODEL_FILENAME);
}

function binaryDir() {
  return path.join(baseDir(), "Release");
}

function binaryPath() {
  const candidates = [
    path.join(binaryDir(), "whisper-cli.exe"),
    path.join(baseDir(), "whisper-cli.exe")
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// ---------------------------------------------------------------
// Descarga con progreso (https, sigue redirects)
// ---------------------------------------------------------------
function download(url, dest, onPct, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const done = (err) => (err ? reject(err) : resolve());
    const go = (currentUrl, redirectsLeft) => {
      https.get(currentUrl, { headers: { "User-Agent": "Noxis" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          go(new URL(res.headers.location, currentUrl).href, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          done(new Error(`HTTP ${res.statusCode} desde ${currentUrl}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10) || MODEL_BYTES;
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (c) => {
          received += c.length;
          if (onPct && total > 0) onPct(Math.min(100, Math.round((received * 100) / total)));
        });
        res.pipe(out);
        out.on("error", (err) => { res.unpipe(out); done(err); });
        out.on("finish", () => done(null));
        res.on("error", (err) => { res.unpipe(out); done(err); });
      }).on("error", done);
    };
    go(url, maxRedirects);
  });
}

function unzipInto(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Expand-Archive está disponible en todo Windows moderno.
    execFile("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`
    ], { windowsHide: true }, (err) => {
      if (err) { reject(err); return; }
      resolve();
    });
  });
}

// ---------------------------------------------------------------
// Descarga completa del motor + modelo (~600 MB) con reintentos
// ---------------------------------------------------------------
function stagePct(pct, start, end) {
  return Math.round(start + (pct / 100) * (end - start));
}

async function downloadWithRetry(label, url, dest, expectedBytes, startPct, endPct, attempts) {
  for (let i = 0; i < attempts; i++) {
    if (state.cancelled) return false;
    if (fs.existsSync(dest) && fs.statSync(dest).size >= expectedBytes * 0.8) return true;
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      state.pullLine = `${label} (intento ${i + 1}/${attempts})…`;
      emitStatus();
      await download(url, dest, (pct) => {
        state.pullPct = stagePct(pct, startPct, endPct);
        state.pullLine = `${label} ${pct}%`;
        emitStatus(`${label} ${pct}%`);
      });
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 1024) {
        throw new Error("archivo vacío");
      }
      return true;
    } catch (err) {
      state.lastError = `${label}: ${String(err.message || err)}`;
      console.error(`[whisper] ${state.lastError}`);
      if (i < attempts - 1) await sleep(3000 * (i + 1));
    }
  }
  return false;
}

async function ensureModel() {
  if (state.installed) return true;
  if (state.cancelled) return false;

  fs.mkdirSync(baseDir(), { recursive: true });
  state.pulling = true;
  state.lastError = "";

  try {
    // 1) Motor whisper-cli (binario + dlls)
    if (!binaryPath()) {
      const zipPath = path.join(baseDir(), "whisper-blas.zip");
      const ok = await downloadWithRetry(
        "Descargando motor Whisper",
        BIN_ZIP_URL, zipPath, BIN_ZIP_BYTES,
        0, 40, 3
      );
      if (ok) {
        state.pullLine = "Preparando motor Whisper…";
        emitStatus();
        try {
          await unzipInto(zipPath, baseDir());
        } finally {
          try { fs.unlinkSync(zipPath); } catch (e) { /* */ }
        }
      }
      if (!binaryPath()) {
        state.lastError = "No se pudo instalar el motor Whisper";
        state.pulling = false;
        emitStatus("No se pudo descargar Whisper");
        return false;
      }
    }

    // 2) Modelo ggml large-v3-turbo q5_0
    if (!fs.existsSync(modelPath()) || fs.statSync(modelPath()).size < MODEL_BYTES * 0.8) {
      const ok = await downloadWithRetry(
        "Descargando modelo Whisper",
        MODEL_URL, modelPath(), MODEL_BYTES,
        40, 100, 3
      );
      if (!ok) {
        state.lastError = "No se pudo terminar la descarga del modelo Whisper";
        state.pulling = false;
        emitStatus("No se pudo descargar Whisper");
        return false;
      }
    }

    state.pullPct = 100;
    state.pullLine = "";
    state.modelName = MODEL_FILENAME;
    state.installed = true;
    state.alive = true;
    state.pulling = false;
    state.lastError = "";
    emitStatus("Whisper listo");
    return true;
  } catch (err) {
    state.lastError = String(err.message || err);
    state.pulling = false;
    emitStatus("No se pudo descargar Whisper");
    return false;
  }
}

// ---------------------------------------------------------------
// Transcripción
// ---------------------------------------------------------------
function threadsCount() {
  const n = (os.cpus() || []).length || 8;
  return Math.max(4, Math.min(16, n));
}

function runWhisper(args) {
  return new Promise((resolve) => {
    const child = spawn(binaryPath(), args, { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", (e) => resolve({ code: -1, out, err: err + "\n" + String(e.message || e) }));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function extractTextFromJson(jsonFile) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    let text = data.transcription || data.text || "";
    if (!text && Array.isArray(data.segments)) {
      text = data.segments.map((s) => s.text || "").join(" ");
    }
    return String(text).trim().replace(/\s+/g, " ");
  } catch (e) {
    return "";
  }
}

function extractTextFromStdout(buf) {
  const lines = String(buf).split(/\r?\n/);
  const segs = [];
  for (const raw of lines) {
    const m = raw.match(/\]\s*(.+)$/);
    if (m && m[1].trim() && !/^(whisper_|main:|ggml_|system_info|load time|prompt time|encode time|decode time|batchd time|mel time|sample time|fallbacks)/i.test(m[1].trim())) {
      segs.push(m[1].trim());
    }
  }
  return segs.join(" ").trim();
}

// Escribe un WAV PCM16 mono 16 kHz temporal y lo transcribe con whisper-cli.
async function transcribe(float32) {
  const samples = Array.from(float32 || []);
  if (!samples.length || samples.length < 8000) { // mínimo ~0,5 s
    return { ok: false, reason: "too-short", text: "" };
  }
  if (!state.installed || !binaryPath()) {
    return { ok: false, reason: "engine-missing", text: "" };
  }

  const tag = crypto.randomBytes(4).toString("hex");
  const wavPath = path.join(os.tmpdir(), `noxis-whisper-${tag}.wav`);
  fs.writeFileSync(wavPath, pcm16Wav(samples, 16000));

  const outBase = wavPath.slice(0, -4); // p. ej. .../noxis-whisper-xxxx
  const args = [
    "-m", modelPath(),
    "-f", wavPath,
    "-l", "es",
    "-t", String(threadsCount()),
    "-pp",
    "-oj",
    "-of", outBase
  ];

  try {
    const { code, out } = await runWhisper(args);
    if (code !== 0) {
      return { ok: false, reason: "whisper-exit-" + code, text: "" };
    }
    let text = extractTextFromJson(outBase + ".json");
    if (!text) text = extractTextFromStdout(out);
    if (!text) {
      return { ok: false, reason: "empty", text: "" };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: String(err.message || err), text: "" };
  } finally {
    cleanup(wavPath);
    cleanup(outBase + ".json");
  }
}

function pcm16Wav(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);        // fmt chunk size
  buf.writeUInt16LE(1, 20);         // PCM
  buf.writeUInt16LE(1, 22);         // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);  // byte rate
  buf.writeUInt16LE(2, 32);         // block align
  buf.writeUInt16LE(16, 34);        // bits
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i] || 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

function cleanup(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* */ }
}

// ---------------------------------------------------------------
// Estado / arranque
// ---------------------------------------------------------------
function filesReady() {
  return !!binaryPath() && fs.existsSync(modelPath()) && fs.statSync(modelPath()).size > 1024 * 1024;
}

function isModelInstalled() {
  return state.installed || filesReady();
}

function getStatus() {
  return {
    alive: !!state.installed,
    installed: !!state.installed,
    modelName: state.modelName || MODELS.whisper.model,
    pulling: !!state.pulling,
    pullPct: state.pullPct,
    pullLine: state.pullLine,
    lastError: state.lastError,
    ready: !!state.installed
  };
}

async function init() {
  // Si los archivos ya están en disco, listo al toque.
  if (filesReady()) {
    state.installed = true;
    state.alive = true;
    state.modelName = MODEL_FILENAME;
    setTimeout(() => emitStatus("Whisper listo"), 300);
    return state.installed;
  }
  // Primera vez: descarga (motor + modelo) en segundo plano, "sí o sí".
  setTimeout(async () => {
    await ensureModel();
    for (let i = 0; i < 3 && !state.installed; i++) {
      await sleep(60000);
      if (!state.installed) await ensureModel();
    }
  }, 300);
  return state.installed;
}

module.exports = {
  setNotify,
  init,
  ensureModel,
  transcribe,
  isModelInstalled,
  getStatus,
  MODELS
};