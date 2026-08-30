// src/services/visionService.js
// IA local (visión + chat) mediante Ollama. Auto-detecta hardware,
// descarga e instala el runtime (OllamaSetup.exe) y el modelo recomendado.
// Sin dependencias npm: usa net (Electron) para downloads y HTTP local.

const { app, net, desktopCapturer, shell } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const OLLAMA_BASE = "http://127.0.0.1:11434";
const OLLAMA_URL = "https://ollama.com/download/OllamaSetup.exe";

let notify = null; // callback de broadcast (se setea desde main)
let autoRetryIndex = 0; // reintentos automáticos en segundo plano (máx 3)
let autoRetryTimer = null;

const state = {
  status: "idle", // idle | downloading-runtime | installing-runtime | pulling-model | ready | error
  error: "",
  runtimeInstalled: false,
  alive: false,
  installedModels: [],
  modelInstalled: false,
  runtimeDownloadPct: 0,
  pullLine: "",
  hardware: null,
  recommended: null,
  inProgress: false,
  canCancel: false
};

function setNotify(cb) {
  notify = typeof cb === "function" ? cb : null;
}

function emitStatus() {
  const snapshot = getStatus();
  if (notify) {
    try { notify(snapshot); } catch (err) { console.error("[vision] notify:", err.message); }
  }
  return snapshot;
}

function setState(patch) {
  Object.assign(state, patch);
  return emitStatus();
}

// =========================================================
// Detección de hardware
// =========================================================

function detectHardware(quiet) {
  return new Promise((resolve) => {
    const cpus = os.cpus() || [];
    const hardware = {
      cpu: cpus.length ? String(cpus[0].model || "").trim() : "desconocido",
      cores: cpus.length || 0,
      ramGB: Math.max(1, Math.round(os.totalmem() / (1024 ** 3))),
      gpu: []
    };
    if (process.platform !== "win32") {
      if (!quiet) setState({ hardware });
      resolve(hardware);
      return;
    }
    // En Windows, Win32_VideoController.AdapterRAM es un campo de 32 bits y se
    // corta en 4 GB. La VRAM real se lee del registro (qwMemorySize = 64 bits).
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$class = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'",
      "$list = @()",
      "Get-ChildItem $class | ForEach-Object {",
      "  $p = Get-ItemProperty $_.PSPath",
      "  $desc = [string]$p.'DriverDesc'",
      "  if ($desc -and $desc.Trim()) {",
      "    $raw = $p.'HardwareInformation.qwMemorySize'",
      "    $vram = 0.0",
      "    if ($raw -ne $null) {",
      "      try {",
      "        if ($raw -is [byte[]]) { $long = [BitConverter]::ToUInt64($raw, 0) } else { $long = [double]$raw }",
      "        if ($long -gt 0) { $vram = [math]::Round($long / 1GB, 2) }",
      "      } catch {}",
      "    }",
      "    $list += [pscustomobject]@{ n = $desc.Trim(); v = $vram }",
      "  }",
      "}",
      "if ($list.Count -eq 0) {",
      "  Get-CimInstance Win32_VideoController | ForEach-Object {",
      "    $ram = $_.AdapterRAM",
      "    $vram = 0.0",
      "    if ($ram -and $ram -gt 0) { $vram = [math]::Round([double]$ram / 1GB, 2) }",
      "    $list += [pscustomobject]@{ n = [string]$_.Name; v = $vram }",
      "  }",
      "}",
      "ConvertTo-Json @($list) -Compress"
    ].join("\n");
    execFile(
      systemExe("WindowsPowerShell\\v1.0\\powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: 25000, windowsHide: true },
      (err, stdout) => {
        if (!err && stdout) {
          try {
            const parsed = JSON.parse(String(stdout).trim());
            const seen = new Set();
            for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
              if (!item || typeof item !== "object") continue;
              const name = String(item.n || "").trim();
              if (!name || seen.has(name)) continue;
              seen.add(name);
              const v = Number(item.v) || 0;
              hardware.gpu.push({ name, vramGB: Math.round(v * 100) / 100 });
            }
          } catch (e) { /* JSON inválido: se queda sin GPU */ }
        }
        if (!quiet) setState({ hardware });
        resolve(hardware);
      }
    );
  });
}

function systemExe(name) {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const p = path.join(root, "System32", name);
  return fs.existsSync(p) ? p : name;
}

function recommendModel(specs) {
  const ram = (specs && specs.ramGB) || os.totalmem() / (1024 ** 3);
  if (ram >= 16) {
    return { name: "llava:13b", label: "Llava 13B (recomendado: 16GB+ de RAM)", approxGB: 8 };
  }
  if (ram >= 8) {
    return { name: "llava:7b", label: "Llava 7B (recomendado: 8-16GB de RAM)", approxGB: 4.7 };
  }
  return { name: "moondream", label: "Moondream (para PC con poca RAM)", approxGB: 1.7 };
}

// =========================================================
// Runtime (Ollama)
// =========================================================

function runtimeExePath() {
  if (process.platform !== "win32") return undefined;
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  if (local) candidates.push(path.join(local, "Programs", "Ollama", "ollama.exe"));
  if (pf) candidates.push(path.join(pf, "Ollama", "ollama.exe"));
  if (pf86) candidates.push(path.join(pf86, "Ollama", "ollama.exe"));
  return candidates.find((p) => fs.existsSync(p));
}

function whereOllama(cb) {
  execFile(
    systemExe("where.exe"),
    ["ollama"],
    { timeout: 8000, windowsHide: true },
    (err, stdout) => {
      if (err || !stdout) { cb(null); return; }
      const first = String(stdout).split(/\r?\n/).find((l) => l.trim() && fs.existsSync(l.trim()));
      cb(first ? first.trim() : null);
    }
  );
}

function pingOllama() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { req.abort(); resolve(false); }, 1500);
    const req = net.request({ method: "GET", url: OLLAMA_BASE + "/api/tags" });
    req.on("response", (res) => {
      res.on("data", () => {});
      res.on("end", () => { clearTimeout(timeout); resolve(res.statusCode === 200); });
      res.on("error", () => { clearTimeout(timeout); resolve(false); });
    });
    req.on("error", () => { clearTimeout(timeout); resolve(false); });
    req.end();
  });
}

function listInstalledModels() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { req.abort(); resolve([]); }, 5000);
    const req = net.request({ method: "GET", url: OLLAMA_BASE + "/api/tags" });
    req.on("response", (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(body);
          const names = (parsed.models || []).map((m) => String(m.name || "")).filter(Boolean);
          resolve(names);
        } catch (e) { resolve([]); }
      });
      res.on("error", () => { clearTimeout(timeout); resolve([]); });
    });
    req.on("error", () => { clearTimeout(timeout); resolve([]); });
    req.end();
  });
}

function isModelInstalled(name) {
  return state.installedModels.some((m) => m === name || m.startsWith(name + ":"));
}

// =========================================================
// Descarga del instalador de Ollama (electron net)
// =========================================================

function downloadFile(url, dest, onProgress) {
  return new Promise((resolvePromise, rejectPromise) => {
    try {
      const out = fs.createWriteStream(dest);
      const req = net.request({ method: "GET", url });
      let received = 0;

      (state.currentDownload) = { abort: () => { try { req.abort(); } catch (e) {} } };

      req.on("response", (res) => {
        const total = parseInt(res.headers["content-length"], 10) || 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          out.write(chunk);
          if (onProgress && total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)));
        });
        res.on("error", (err) => {
          out.destroy();
          rejectPromise(err);
        });
        res.on("end", () => {
          out.end();
          state.currentDownload = null;
          resolvePromise(dest);
        });
      });
      req.on("error", (err) => {
        out.destroy();
        rejectPromise(err);
      });
      req.end();
    } catch (err) {
      rejectPromise(err);
    }
  });
}

// =========================================================
// Ejecución del runtime y pull de modelos
// =========================================================

function runOllama(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: childrenEnv()
    });
    state.currentPull = child;
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); handlePullLine(String(d)); });
    child.stderr.on("data", (d) => { out += String(d); handlePullLine(String(d)); });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      state.currentPull = null;
      resolve({ code });
    });
  });
}

function handlePullLine(chunk) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;
  const last = lines[lines.length - 1].trim();
  if (!last) return;
  const pctM = /success\s+(\d+(?:\.\d+)?)%/.exec(last);
  if (pctM) {
    state.pullLine = `Descargando modelo… ${Math.round(parseFloat(pctM[1]))}%`;
  } else {
    state.pullLine = last.length > 160 ? last.slice(0, 157) + "…" : last;
  }
  if (!state.inProgress) state.inProgress = true;
  emitStatus();
}

function waitRuntimeAppeared(maxMs, intervalMs, startedMs) {
  const start = startedMs || Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const exe = runtimeExePath();
      if (exe) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - start > maxMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs || 2000);
  });
}

function waitServerAlive(maxMs, startedMs) {
  const start = startedMs || Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const alive = await pingOllama();
      if (alive) { clearInterval(timer); resolve(true); return; }
      if (Date.now() - start > maxMs) { clearInterval(timer); resolve(false); }
    }, 1500);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Entorno "limpio" para los procesos de Ollama: evita proxies o un OLLAMA_HOST
// raro que impidan que el servidor local responda (causa del "not ready").
function childrenEnv() {
  return Object.assign({}, process.env, {
    OLLAMA_HOST: "127.0.0.1:11434",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    ALL_PROXY: "",
    all_proxy: ""
  });
}

// Arranca "ollama serve" en segundo plano si todavía no hay servidor.
function spawnServer() {
  const exe = runtimeExePath() || "ollama";
  try {
    const child = spawn(exe, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: childrenEnv()
    });
    child.unref();
    state.serverChild = child;
    return true;
  } catch (e) {
    console.error("[vision] no pude lanzar serve:", e.message);
    return false;
  }
}

async function ensureServerAlive() {
  if (state.alive) return true;
  state.alive = await pingOllama();
  if (state.alive) return true;
  spawnServer();
  const ok = await waitServerAlive(120000);
  state.alive = ok;
  if (!ok) state.serverChild = null;
  return ok;
}

// Descarga el modelo con reintentos automáticos. Antes de cada intento se
// asegura de que el servidor esté arriba (lo arranca si hace falta).
async function pullModelWithRetry(model) {
  const attempts = 4;
  for (let i = 0; i < attempts; i++) {
    if (state.cancelled) return { ok: false, reason: "cancelled" };

    const serverOk = await ensureServerAlive();
    if (!serverOk) {
      state.pullLine = "El servidor no arranca. Reintentando…";
      emitStatus();
      if (i < attempts - 1) await sleep(5000);
      continue;
    }

    state.status = "pulling-model";
    state.pullLine = `Iniciando descarga del modelo ${model}… (intento ${i + 1}/${attempts})`;
    emitStatus();

    if (state.currentPull) {
      try { state.currentPull.kill(); } catch (e) {}
      state.currentPull = null;
    }

    let result;
    try {
      result = await runOllama(runtimeExePath() || "ollama", ["pull", model]);
    } catch (err) {
      result = { code: -1, error: String(err && err.message ? err.message : err) };
    }

    const alive = await waitServerAlive(30000);
    state.alive = alive;
    state.installedModels = alive ? await listInstalledModels() : state.installedModels;
    state.modelInstalled = isModelInstalled(model);

    if (state.modelInstalled) return { ok: true, code: result.code };

    if (state.cancelled) return { ok: false, reason: "cancelled" };

    if (i < attempts - 1) {
      state.pullLine = `Algo falló (${result.code}); reintento en unos segundos…`;
      emitStatus();
      await sleep(5000 * (i + 1));
    }
  }
  return { ok: false, code: -1 };
}

function buildErrorHint(pullResult) {
  const model = state.recommended?.name || "el modelo";
  const base = `No pude completar la descarga de ${model}.`;
  if (!state.alive) {
    return `${base} El servidor de Ollama no llegó a responder. Noxis lo reintentará solo en un par de minutos (también revisá que el antivirus no esté bloqueando Ollama o que no uses un proxy).`;
  }
  return `${base} Se reintentó varias veces. Revisá: 1) que tengas internet estable, 2) espacio libre en disco, 3) que el antivirus no bloquee Ollama. Luego volvé a pulsar "Instalar IA".`;
}

// =========================================================
// Instalación automática completa
// =========================================================

async function refresh() {
  const runtimeInstalled = !!runtimeExePath() || await new Promise((r) => whereOllama((p) => r(!!p)));
  state.runtimeInstalled = runtimeInstalled;
  state.alive = runtimeInstalled ? await pingOllama() : false;
  state.installedModels = state.alive ? await listInstalledModels() : [];
  const hardware = await detectHardware(true);
  const recommended = recommendModel(hardware);
  state.hardware = hardware;
  state.recommended = recommended;
  state.modelInstalled = isModelInstalled(recommended.name);
  return emitStatus();
}

function init() {
  setTimeout(() => { refresh().catch((e) => console.error("[vision] refresh:", e.message)); }, 1200);
}

async function install(modelName) {
  if (state.inProgress) return getStatus();
  state.inProgress = true;
  state.canCancel = true;
  state.error = "";
  state.status = "idle";
  if (autoRetryTimer) { clearTimeout(autoRetryTimer); autoRetryTimer = null; }

  try {
    const exe = runtimeExePath();
    if (!exe) {
      const dest = path.join(app.getPath("userData"), "ollama-setup.exe");
      state.status = "downloading-runtime";
      emitStatus();
      await downloadFile(OLLAMA_URL, dest, (pct) => {
        state.runtimeDownloadPct = pct;
        emitStatus();
      });

      state.status = "installing-runtime";
      await new Promise((resolve, reject) => {
        const child = spawn(dest, ["/VERYSILENT", "/NORESTART", "/SP-"], { detached: true, stdio: "ignore" });
        child.unref();
        child.on("error", reject);
        resolve();
      });
      const appeared = await waitRuntimeAppeared(180000, 2000);
      if (!appeared) {
        state.status = "error";
        state.error = "El instalador no termino. Reintenta desde Configuracion → Vision IA.";
        return emitStatus();
      }
    }

    const model = modelName || state.recommended?.name || recommendModel(state.hardware).name;

    // Auto-recuperación: arranca el servidor y reintenta la descarga sola.
    let pullResult = await pullModelWithRetry(model);
    if (!pullResult.ok && !state.cancelled) {
      // Última bala: esperar, re-verificar servidor y un intento extra.
      state.pullLine = "Un intento más con el servidor fresco…";
      emitStatus();
      await sleep(4000);
      if (state.serverChild) {
        try { state.serverChild.kill(); } catch (e) {}
        state.serverChild = null;
      }
      state.alive = false;
      pullResult = await pullModelWithRetry(model);
    }

    if (state.cancelled) return emitStatus();

    if (!pullResult.ok || !state.modelInstalled) {
      state.status = "error";
      state.error = buildErrorHint(pullResult);
      // Auto-solución: reintenta sola en segundo plano hasta lograrlo.
      if (autoRetryIndex < 3 && !state.cancelled) {
        autoRetryIndex += 1;
        autoRetryTimer = setTimeout(() => {
          autoRetryTimer = null;
          if (!state.inProgress && !state.cancelled) {
            install(modelName || model).then(() => {}).catch(() => {});
          }
        }, 60000);
        state.error += ` Volveré a intentar sola en un minuto (intento ${autoRetryIndex}/3).`;
      }
      return emitStatus();
    }

    autoRetryIndex = 0;
    state.status = "ready";
    state.error = "";
    return emitStatus();
  } catch (err) {
    if (state.cancelled) {
      state.cancelled = false;
      state.status = "idle";
      state.error = "";
      state.currentDownload = null;
      state.currentPull = null;
      return emitStatus();
    }
    state.status = "error";
    state.error = String(err && err.message ? err.message : err);
    if (autoRetryIndex < 3) {
      autoRetryIndex += 1;
      autoRetryTimer = setTimeout(() => {
        autoRetryTimer = null;
        if (!state.inProgress && !state.cancelled) {
          install(modelName || model).then(() => {}).catch(() => {});
        }
      }, 60000);
    }
    return emitStatus();
  } finally {
    state.cancelled = false;
    state.inProgress = false;
    state.canCancel = false;
    state.currentDownload = null;
    state.currentPull = null;
  }
}

function cancel() {
  if (state.canCancel && state.inProgress) {
    state.cancelled = true;
    try {
      if (state.currentDownload && state.currentDownload.abort) state.currentDownload.abort();
      if (state.currentPull) state.currentPull.kill();
    } catch (e) { /* ignorar */ }
  }
  if (autoRetryTimer) { clearTimeout(autoRetryTimer); autoRetryTimer = null; }
  autoRetryIndex = 0;
  return true;
}

// =========================================================
// Captura y análisis
// =========================================================

function getScreenSource() {
  return desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 720 }
  }).then((sources) => {
    if (!sources || !sources.length) return null;
    return sources.reduce((best, s) => {
      const area = (s.thumbnail && s.thumbnail.getSize().width || 0) * (s.thumbnail && s.thumbnail.getSize().height || 0);
      return area > best.area ? { source: s, area } : best;
    }, { source: null, area: -1 }).source;
  }).catch(() => null);
}

function captureScreen() {
  return getScreenSource().then((src) => {
    if (!src) return { ok: false, reason: "no-screen-source" };
    const img = src.thumbnail;
    const size = img.getSize();
    const png = img.toPNG();
    const dir = path.join(app.getPath("userData"), "screens");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const filePath = path.join(dir, `screen-${Date.now()}.png`);
    try { fs.writeFileSync(filePath, png); } catch (e) { return { ok: false, reason: "write-error" }; }
    return { ok: true, filePath, base64: png.toString("base64"), width: size.width, height: size.height };
  }).catch((err) => ({ ok: false, reason: err.message }));
}

function postJson(urlPath, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: "POST", url: OLLAMA_BASE + urlPath });
    req.setHeader("Content-Type", "application/json");
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) { try { req.abort(); } catch (e) {} reject(new Error("timeout")); }
    }, timeoutMs || 300000);
    let body = "";
    req.on("response", (res) => {
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        settled = true;
        clearTimeout(t);
        if (res.statusCode !== 200) {
          reject(new Error("HTTP " + res.statusCode));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      res.on("error", (err) => { settled = true; clearTimeout(t); reject(err); });
    });
    req.on("error", (err) => { settled = true; clearTimeout(t); reject(err); });
    req.end(JSON.stringify(payload));
  });
}

function assertReadyModel() {
  const model = state.recommended?.name || recommendModel(state.hardware || {}).name;
  if (!state.modelInstalled) {
    const snapshot = refresh().then((s) => s.modelInstalled).catch(() => false);
    return { ok: false, pending: snapshot, model };
  }
  return { ok: true, model };
}

async function ensureModel() {
  const st = await refresh();
  if (st.modelInstalled && st.alive) return true;
  return false;
}

async function analyze(imageBase64, prompt) {
  if (!state.alive) state.alive = await pingOllama();
  const ready = await ensureModel();
  if (!ready) throw new Error("modelo no instalado");
  const model = state.recommended?.name || recommendModel(state.hardware || {}).name;
  const res = await postJson("/api/generate", {
    model,
    prompt: prompt || "Describe lo que ves en la imagen.",
    images: [imageBase64],
    stream: false
  }, 240000);
  return String(res && res.response ? res.response : "").trim();
}

const IMAGE_EXTENSIONS = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp"
};

// Resuelve un nombre de archivo (que puede llegar sin el punto: "fotopng")
// recorriendo Escritorio, Descargas, Documentos y la carpeta del usuario.
function resolveFileName(target, extList) {
  const home = os.homedir();
  const raw = String(target || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;

  const bases = [raw];
  for (const e of extList) {
    const tail = e.replace(".", "");
    if (raw.toLowerCase().endsWith(tail)) bases.push(raw.slice(0, raw.length - tail.length));
  }

  const names = [];
  for (let b of bases) {
    b = String(b || "").trim();
    if (!b) continue;
    names.push(b);
    const hasExt = extList.some((e) => b.toLowerCase().endsWith(e));
    if (!hasExt) for (const e of extList) names.push(b + e);
  }

  const dirs = [
    path.join(home, "Desktop"),
    path.join(home, "Downloads"),
    path.join(home, "Documents"),
    home
  ];
  if (path.isAbsolute(bases[0])) dirs.unshift(path.dirname(bases[0]));

  const seen = new Set();
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, path.basename(name));
      if (seen.has(full)) continue;
      seen.add(full);
      try { if (fs.existsSync(full)) return full; } catch (e) {}
    }
  }
  return null;
}

function resolveUserImage(target) {
  return resolveFileName(target, Object.keys(IMAGE_EXTENSIONS));
}

const TEXT_FILE_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".log", ".csv", ".json", ".xml", ".html", ".htm",
  ".ini", ".cfg", ".env", ".js", ".ts", ".py", ".java", ".ps1", ".bat", ".cmd",
  ".sh", ".yml", ".yaml", ".css", ".cpp", ".c", ".h", ".rb", ".go", ".rs"
];

function resolveUserTextFile(target) {
  return resolveFileName(target, TEXT_FILE_EXTENSIONS);
}

async function analyzeFile(imagePath, prompt) {
  const ext = path.extname(String(imagePath)).toLowerCase();
  if (!IMAGE_EXTENSIONS[ext]) return { ok: false, reason: "formato-no-imagen" };
  let buf;
  try { buf = fs.readFileSync(imagePath); } catch (e) { return { ok: false, reason: "no-se-puede-leer" }; }
  const base64 = buf.toString("base64");
  if (!state.alive) state.alive = await pingOllama();
  const ready = await ensureModel();
  if (!ready) return { ok: false, reason: "modelo-no-instalado" };
  const model = state.recommended?.name || recommendModel(state.hardware || {}).name;
  const res = await postJson("/api/generate", {
    model,
    prompt: prompt || "Describe esta imagen y agrega 3 datos útiles sobre lo que se ve.",
    images: [base64],
    stream: false
  }, 240000);
  return { ok: true, text: String(res && res.response ? res.response : "").trim() };
}

async function chat(prompt, history) {
  if (!state.alive) state.alive = await pingOllama();
  const ready = await ensureModel();
  if (!ready) throw new Error("modelo no instalado");
  const model = state.recommended?.name || recommendModel(state.hardware || {}).name;
  const messages = (history && history.length ? history : []).map((m) => ({
    role: m.role === "user" || m.role === "assistant" ? m.role : "user",
    content: String(m.content || m.text || "")
  }));
  messages.push({ role: "user", content: String(prompt || "") });
  const res = await postJson("/api/chat", { model, messages, stream: false }, 240000);
  return String(res && res.message && res.message.content ? res.message.content : "").trim();
}

async function checkReady() {
  const s = await refresh();
  return !!s.alive && !!s.modelInstalled;
}

function getStatus() {
  return {
    status: state.status,
    error: state.error || "",
    runtimeInstalled: state.runtimeInstalled,
    alive: state.alive,
    runtimeDownloadPct: state.runtimeDownloadPct,
    pullLine: state.pullLine || "",
    installedModels: state.installedModels || [],
    modelInstalled: state.modelInstalled,
    recommended: state.recommended,
    hardware: state.hardware,
    inProgress: state.inProgress,
    canCancel: state.canCancel,
    canAnalyze: state.alive && state.modelInstalled
  };
}

module.exports = {
  setNotify,
  init,
  refresh,
  detectHardware,
  recommendModel,
  getStatus,
  install,
  cancel,
  captureScreen,
  analyze,
  analyzeFile,
  resolveUserImage,
  resolveUserTextFile,
  chat,
  checkReady,
  runtimeExePath,
  pingOllama
};