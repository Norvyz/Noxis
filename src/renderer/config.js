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

// src/renderer/config.js
// Equivalente a ConfigWindow.xaml.cs

let config = null;
let selectedPack = null;

const nameInput = document.getElementById("nameInput");
const autoStartCheck = document.getElementById("autoStartCheck");
const micCheck = document.getElementById("micCheck");
const micDeviceRow = document.getElementById("micDeviceRow");
const micSelect = document.getElementById("micSelect");
const refreshMicBtn = document.getElementById("refreshMicBtn");
const skinPreview = document.getElementById("skinPreview");
const skinPathLabel = document.getElementById("skinPathLabel");

const appsList = document.getElementById("appsList");
const packsList = document.getElementById("packsList");
const packAppsList = document.getElementById("packAppsList");
const selectedPackTitle = document.getElementById("selectedPackTitle");
const addPackAppBtn = document.getElementById("addPackAppBtn");

const addAppModal = document.getElementById("addAppModal");
const addAppKeywordInput = document.getElementById("addAppKeywordInput");
const addAppPathInput = document.getElementById("addAppPathInput");
const addAppBrowseBtn = document.getElementById("addAppBrowseBtn");
const addAppConfirmBtn = document.getElementById("addAppConfirmBtn");
const addAppCancelBtn = document.getElementById("addAppCancelBtn");

const addPackModal = document.getElementById("addPackModal");
const addPackNameInput = document.getElementById("addPackNameInput");
const addPackKeywordInput = document.getElementById("addPackKeywordInput");
const addPackDelayInput = document.getElementById("addPackDelayInput");
const addPackConfirmBtn = document.getElementById("addPackConfirmBtn");
const addPackCancelBtn = document.getElementById("addPackCancelBtn");

const addPackAppModal = document.getElementById("addPackAppModal");
const addPackAppKeywordInput = document.getElementById("addPackAppKeywordInput");
const addPackAppPathInput = document.getElementById("addPackAppPathInput");
const addPackAppBrowseBtn = document.getElementById("addPackAppBrowseBtn");
const addPackAppConfirmBtn = document.getElementById("addPackAppConfirmBtn");
const addPackAppCancelBtn = document.getElementById("addPackAppCancelBtn");

const editAppModal = document.getElementById("editAppModal");
const editAppKeywordInput = document.getElementById("editAppKeywordInput");
const editAppPathInput = document.getElementById("editAppPathInput");
const editAppBrowseBtn = document.getElementById("editAppBrowseBtn");
const editAppConfirmBtn = document.getElementById("editAppConfirmBtn");
const editAppCancelBtn = document.getElementById("editAppCancelBtn");

const editPackModal = document.getElementById("editPackModal");
const editPackNameInput = document.getElementById("editPackNameInput");
const editPackDelayInput = document.getElementById("editPackDelayInput");
const editPackConfirmBtn = document.getElementById("editPackConfirmBtn");
const editPackCancelBtn = document.getElementById("editPackCancelBtn");

const editPackAppModal = document.getElementById("editPackAppModal");
const editPackAppKeywordInput = document.getElementById("editPackAppKeywordInput");
const editPackAppPathInput = document.getElementById("editPackAppPathInput");
const editPackAppBrowseBtn = document.getElementById("editPackAppBrowseBtn");
const editPackAppConfirmBtn = document.getElementById("editPackAppConfirmBtn");
const editPackAppCancelBtn = document.getElementById("editPackAppCancelBtn");

const saveStatus = document.getElementById("saveStatus");
const modelCards = document.getElementById("modelCards");
const modelProgressWrap = document.getElementById("modelProgressWrap");
const modelProgressLabel = document.getElementById("modelProgressLabel");
const modelProgressBar = document.getElementById("modelProgress");

const alwaysOnTopCheck = document.getElementById("alwaysOnTopCheck");
const showInTaskbarCheck = document.getElementById("showInTaskbarCheck");
const startCornerSelect = document.getElementById("startCornerSelect");
const bubbleDurationInput = document.getElementById("bubbleDurationInput");
const commandSoundCheck = document.getElementById("commandSoundCheck");
const commandSoundLabel = document.getElementById("commandSoundLabel");
const commandSoundBrowseBtn = document.getElementById("commandSoundBrowseBtn");
const commandSoundPreviewBtn = document.getElementById("commandSoundPreviewBtn");
const commandSoundResetBtn = document.getElementById("commandSoundResetBtn");
const similarityRange = document.getElementById("similarityRange");
const similarityValue = document.getElementById("similarityValue");
const sidebarAvatarImg = document.getElementById("sidebarAvatarImg");
const toastStack = document.getElementById("toastStack");
const inlineConfirm = document.getElementById("inlineConfirm");
const confirmYes = document.getElementById("confirmYes");
const confirmNo = document.getElementById("confirmNo");

const actionHighlightCheck = document.getElementById("actionHighlightCheck");
const actionHighlightControls = document.getElementById("actionHighlightControls");
const actionHighlightColorInput = document.getElementById("actionHighlightColorInput");
const actionHighlightColorText = document.getElementById("actionHighlightColorText");
const actionHighlightWidthRange = document.getElementById("actionHighlightWidthRange");
const actionHighlightWidthValue = document.getElementById("actionHighlightWidthValue");
const actionHighlightRadiusRange = document.getElementById("actionHighlightRadiusRange");
const actionHighlightRadiusValue = document.getElementById("actionHighlightRadiusValue");
const highlightPreview = document.getElementById("highlightPreview");

let inlineConfirmCallback = null;

let pendingExePath = null;
let editingAppIndex = -1;
let editingPackIndex = -1;
let editingPackAppIndex = -1;
let modelStatuses = {}; // id → { status, pct } recibidos por vosk-status

// ---------------------------------------------------------------
// Modelo de voz (Vosk)
// ---------------------------------------------------------------
function fmtMB(mb) {
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function renderModelCards(info) {
  modelCards.innerHTML = "";

  for (const model of info.models) {
    const card = document.createElement("div");
    card.className = "modelCard" + (model.id === info.active ? " active" : "");
    card.dataset.model = model.id;

    const st = modelStatuses[model.id] || {};
    const downloading = st.status === "downloading" || st.status === "preparing";
    const installed = model.installed;

    let statusText = "";
    let statusCls = "";
    if (downloading) {
      statusText = st.pct != null ? `Descargando… ${st.pct}%` : (st.status === "preparing" ? "Procesando…" : "Descargando…");
      statusCls = "good";
    } else if (installed) {
      statusText = model.id === info.active ? "En uso" : "Instalado";
      statusCls = "installed";
    } else {
      statusText = "No descargado";
      statusCls = "warn";
    }

    const pct = (downloading && st.pct != null) ? st.pct : (installed ? 100 : 0);

    card.innerHTML = `
      <div class="modelCardTop">
        <input type="radio" name="voiceModel" value="${model.id}" ${model.id === info.active ? "checked" : ""} />
        <span class="modelName">${model.label}</span>
        <span class="modelVer">${model.version}</span>
      </div>
      <div class="modelDesc">${model.description}</div>
      <div class="modelSize">${fmtMB(model.sizeMB)} para instalar</div>
      ${model.id === "precise" ? `
      <div class="modelWarn">⚠️ Requiere mucha memoria y puede no cargar en todos los equipos.
      Se recomienda el modelo <b>Estándar</b> para uso diario.</div>` : ""}
      <progress class="modelCardBar" max="100" value="${pct}" ${downloading ? "" : "disabled"}></progress>
      <div class="modelCardFooter">
        <span class="modelStatus ${statusCls}">${statusText}</span>
        <button class="secondaryBtn modelDownloadBtn" data-action="download" ${installed ? "disabled" : ""} >
          ${installed ? "✓ Instalado" : downloading ? "En progreso" : "Descargar"}
        </button>
      </div>
    `;

    // Click en la tarjeta = activar modelo
    card.addEventListener("click", async () => {
      const wasActive = model.id === info.active;
      if (wasActive) return;
      const input = card.querySelector("input");
      if (!input.checked) input.checked = true;
      config.voiceModel = model.id;
      await window.configAPI.setActiveModel(model.id);
      // Si no está descargado, arranca la descarga
      if (!model.installed) {
        showToast(`Descargando modelo ${model.label}…`, "info");
        window.configAPI.downloadModel(model.id);
      }
      renderModelCards({ models: info.models, active: model.id });
    });

    // Botón descargar explícito
    card.querySelector(".modelDownloadBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (model.installed) return;
      showToast(`Descargando modelo ${model.label}…`, "info");
      window.configAPI.downloadModel(model.id);
    });

    modelCards.appendChild(card);
  }
}

function renderModelProgress() {
  const active = Object.entries(modelStatuses).find(
    ([, st]) => st.status === "downloading" || st.status === "preparing"
  );
  if (!active) {
    modelProgressWrap.classList.add("hidden");
    return;
  }
  const [id, st] = active;
  const info = modelInfoFor(id);
  const label = info ? info.label : id;
  if (st.status === "downloading" && st.pct != null) {
    modelProgressLabel.textContent = `⏳ Descargando modelo ${label}: ${st.pct}%`;
    modelProgressBar.value = st.pct;
  } else if (st.status === "preparing") {
    modelProgressLabel.textContent = `⚙️ Preparando modelo ${label}…`;
    modelProgressBar.value = 0;
    modelProgressBar.removeAttribute("value");
  }
  modelProgressWrap.classList.remove("hidden");
}

let cachedModelInfo = null;
function modelInfoFor(id) {
  return (cachedModelInfo && cachedModelInfo.models
    .find((m) => m.id === id)) || null;
}

window.configAPI.onModelStatus((info) => {
  modelStatuses[info.type] = {
    status: info.status,
    pct: info.pct != null ? info.pct : null
  };
  if (info.status === "error") {
    modelProgressLabel.textContent = `⚠️ ${info.detail || "Error con el modelo"}`;
    modelProgressBar.removeAttribute("value");
    modelProgressWrap.classList.remove("hidden");
    showToast(info.detail || "Error con el modelo de voz", "error");
    return;
  }
  if (!cachedModelInfo) return;
  const fresh = {
    models: cachedModelInfo.models.map((m) =>
      m.id === info.type ? { ...m, installed: info.status === "ready" } : m
    ),
    active: info.type === cachedModelInfo.active ? info.type : cachedModelInfo.active
  };
  if (info.status === "ready") {
    // Descarga terminada: limpiar el estado transitorio y recargar la info
    // real desde el main para que la tarjeta pase de "Procesando…" a
    // "Instalado" (o "En uso") sin tener que reabrir la configuración.
    delete modelStatuses[info.type];
    loadModelSection();
    return;
  }
  renderModelCards(fresh);
  renderModelProgress();
});

async function loadModelSection() {
  try {
    const info = await window.configAPI.getModelInfo();
    cachedModelInfo = info;
    renderModelCards(info);
    renderModelProgress();
  } catch (err) {
    console.error("[config] Error cargando modelos:", err);
    modelCards.innerHTML = '<p class="sectionHint">No se pudo consultar el estado de los modelos.</p>';
  }
}

// ---------------------------------------------------------------
// Iconos SVG
// ---------------------------------------------------------------
refreshMicBtn.innerHTML = window.NoxisIcons.refresh(15);
document.querySelectorAll(".btnIcon").forEach((el) => {
  const name = el.dataset.icon;
  if (window.NoxisIcons[name]) el.innerHTML = window.NoxisIcons[name](14);
});
document.querySelectorAll(".navIcon").forEach((el) => {
  const name = el.dataset.iconNav;
  if (window.NoxisIcons[name]) el.innerHTML = window.NoxisIcons[name](18);
});
document.querySelectorAll(".creditIcon").forEach((el) => {
  const name = el.dataset.iconCredit;
  if (window.NoxisIcons[name]) el.innerHTML = window.NoxisIcons[name](16);
});

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
document.querySelectorAll(".tabBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    switchTab(btn.dataset.tab);
  });
});

let tabTimer = null;
function switchTab(tabId) {
  const target = document.getElementById(`tab-${tabId}`);
  if (!target) return;
  const current = document.querySelector(".tab.active");
  if (current === target) return;

  clearTimeout(tabTimer);
  if (current) {
    current.classList.remove("active");
    current.classList.add("tab-exit");
  }
  // Retraso mínimo para dejar que la animación de salida arranque
  tabTimer = setTimeout(() => {
    document.querySelectorAll(".tab.tab-exit").forEach((t) => t.classList.remove("tab-exit"));
    target.classList.remove("tab-enter");
    target.classList.add("active", "tab-enter");
    setTimeout(() => target.classList.remove("tab-enter"), 250);
    window.__activeTab = tabId;
  }, 120);
}

// ---------------------------------------------------------------
// Enlaces externos (GitHub / Discord): abren en el navegador real
// del sistema, no dentro de la ventana de Electron.
// ---------------------------------------------------------------
const externalLinks = document.getElementById("externalLinks");
if (externalLinks) {
  externalLinks.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    e.preventDefault();
    const url = link.getAttribute("href");
    if (url) window.configAPI.openExternal(url);
  });
}
// Enlaces del tab "Sobre Noxis"
const aboutLinks = document.querySelector(".aboutLinks");
if (aboutLinks) {
  aboutLinks.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    e.preventDefault();
    const url = link.getAttribute("href");
    if (url) window.configAPI.openExternal(url);
  });
}

// ---------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------
async function loadConfig() {
  config = await window.configAPI.getConfig();

  nameInput.value = config.name;
  autoStartCheck.checked = !!config.autoStart;
  micCheck.checked = !!config.allowMicrophone;
  applyTheme(config.theme || "light");

  alwaysOnTopCheck.checked = !!config.alwaysOnTop;
  showInTaskbarCheck.checked = config.showInTaskbar !== false;
  startCornerSelect.value = config.startCorner || "bottom-right";
  bubbleDurationInput.value = (typeof config.bubbleDuration === "number" && config.bubbleDuration > 0)
    ? config.bubbleDuration : 8.5;
  commandSoundCheck.checked = config.commandSoundEnabled !== false;
  updateCommandSoundLabel();
  const sim = (typeof config.voiceSimilarityThreshold === "number") ? config.voiceSimilarityThreshold : 0.72;
  similarityRange.value = sim;
  similarityValue.textContent = Number(sim).toFixed(2);

  actionHighlightCheck.checked = config.actionHighlightEnabled !== false;
  actionHighlightColorInput.value = /^#[0-9a-fA-F]{6}$/.test(config.actionHighlightColor)
    ? config.actionHighlightColor : "#22c55e";
  actionHighlightWidthRange.value = (typeof config.actionHighlightWidth === "number" && config.actionHighlightWidth >= 1)
    ? config.actionHighlightWidth : 5;
  actionHighlightRadiusRange.value = (typeof config.actionHighlightRadius === "number" && config.actionHighlightRadius >= 0)
    ? config.actionHighlightRadius : 30;
  updateHighlightControls();

  const applySkin = (p) => {
    const src = p ? `file://${p}` : "../../assets/noxis.png";
    skinPreview.src = src;
    sidebarAvatarImg.src = src;
    if (p) {
      skinPathLabel.textContent = p;
    } else {
      skinPathLabel.textContent = "Sin skin personalizada";
    }
  };
  applySkin(config.skinPath);

  micDeviceRow.classList.toggle("hidden", !config.allowMicrophone);
  if (config.allowMicrophone) loadMicDevices();

  loadModelSection();
  renderApps();
  renderPacks();
}

// ---------------------------------------------------------------
// Temas
// ---------------------------------------------------------------
const THEME_IDS = ["light", "dark", "obsidian", "midnight", "forest", "sunset", "rose", "ocean"];

function applyTheme(themeId) {
  const theme = THEME_IDS.includes(themeId) ? themeId : "light";
  document.body.classList.remove(...THEME_IDS.map((t) => `theme-${t}`));
  document.body.classList.add(`theme-${theme}`);
  document.querySelectorAll(".themeCard").forEach((card) => {
    const active = card.dataset.theme === theme;
    card.classList.toggle("active", active);
    card.setAttribute("aria-pressed", String(active));
  });
}

document.querySelectorAll(".themeCard").forEach((card) => {
  card.addEventListener("click", () => applyTheme(card.dataset.theme));
});

function getActiveTheme() {
  return THEME_IDS.find((t) => document.body.classList.contains(`theme-${t}`)) || "light";
}

// ---------------------------------------------------------------
// Micrófono
// ---------------------------------------------------------------
micCheck.addEventListener("change", () => {
  micDeviceRow.classList.toggle("hidden", !micCheck.checked);
  if (micCheck.checked && micSelect.options.length === 0) loadMicDevices();
});

refreshMicBtn.addEventListener("click", loadMicDevices);

async function loadMicDevices() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    console.error("[config] no se pudo acceder al micrófono:", err);
    alert("No pude acceder al micrófono. Revisa los permisos del sistema operativo.");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === "audioinput");

  micSelect.innerHTML = "";
  mics.forEach((mic, i) => {
    const opt = document.createElement("option");
    opt.value = mic.deviceId;
    opt.textContent = mic.label || `Micrófono ${i + 1}`;
    micSelect.appendChild(opt);
  });

  if (config.selectedMicrophoneId) {
    micSelect.value = config.selectedMicrophoneId;
  }
}

micSelect.addEventListener("change", () => {
  config.selectedMicrophoneId = micSelect.value;
  config.selectedMicrophoneName = micSelect.selectedOptions[0]?.textContent || null;
});

// ---------------------------------------------------------------
// Sonido de comando personalizado
// ---------------------------------------------------------------
function updateCommandSoundLabel() {
  commandSoundLabel.textContent = config.commandSoundPath
    ? config.commandSoundPath
    : "Predeterminado (sonido de Noxis)";
}

commandSoundBrowseBtn.addEventListener("click", async () => {
  const filePath = await window.configAPI.chooseSound();
  if (!filePath) return;
  config.commandSoundPath = filePath;
  updateCommandSoundLabel();
});

commandSoundPreviewBtn.addEventListener("click", () => {
  window.configAPI.previewSound(config.commandSoundPath);
});

commandSoundResetBtn.addEventListener("click", () => {
  config.commandSoundPath = null;
  updateCommandSoundLabel();
});

window.configAPI.onPlaySound((filePath) => {
  if (!filePath) return;
  try {
    const audio = new Audio(`file://${filePath}`);
    audio.volume = 1;
    audio.play().catch((err) => console.error("[Noxis] No se pudo reproducir el sonido:", err));
  } catch (err) {
    console.error("[Noxis] Error al crear el audio:", err);
  }
});

// ---------------------------------------------------------------
// Skin
// ---------------------------------------------------------------
document.getElementById("changeSkinBtn").addEventListener("click", async () => {
  const filePath = await window.configAPI.chooseSkin();
  if (!filePath) return;
  config.skinPath = filePath;
  skinPreview.src = `file://${filePath}`;
  sidebarAvatarImg.src = `file://${filePath}`;
  skinPathLabel.textContent = filePath;
});

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function showSaveStatus(msg) {
  saveStatus.textContent = msg;
  saveStatus.classList.add("visible");
  setTimeout(() => saveStatus.classList.remove("visible"), 2000);
}

// ---------------------------------------------------------------
// Toasts (feedback no intrusivo)
// ---------------------------------------------------------------
function showToast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " toast--" + type : "");
  el.textContent = msg;
  toastStack.appendChild(el);
  setTimeout(() => el.classList.add("toast--show"), 10);
  setTimeout(() => {
    el.classList.remove("toast--show");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ---------------------------------------------------------------
// Confirmación inline (reemplaza window.confirm en borrados)
// ---------------------------------------------------------------
function askInlineConfirm(message, description, onConfirm) {
  if (typeof description === "function") {
    onConfirm = description;
    description = "";
  }
  inlineConfirm.querySelector(".inlineConfirmText").textContent = message;
  inlineConfirm.querySelector(".inlineConfirmDesc").textContent = description || "";
  inlineConfirmCallback = onConfirm;
  inlineConfirm.classList.remove("hidden");
  confirmYes.focus();
}

confirmYes.addEventListener("click", () => {
  const cb = inlineConfirmCallback;
  inlineConfirm.classList.add("hidden");
  inlineConfirmCallback = null;
  if (cb) cb();
});

confirmNo.addEventListener("click", () => {
  inlineConfirm.classList.add("hidden");
  inlineConfirmCallback = null;
});

// Umbral de similitud (tab Voz)
similarityRange.addEventListener("input", () => {
  similarityValue.textContent = Number(similarityRange.value).toFixed(2);
});

// Marco de resaltado (tab Comportamiento)
function updateHighlightControls() {
  actionHighlightControls.classList.toggle("hidden", !actionHighlightCheck.checked);
  actionHighlightWidthValue.textContent = actionHighlightWidthRange.value;
  actionHighlightRadiusValue.textContent = actionHighlightRadiusRange.value;
  const color = actionHighlightColorInput.value;
  actionHighlightColorText.textContent = color;
  if (highlightPreview) {
    highlightPreview.style.borderColor = color;
    highlightPreview.style.borderWidth = `${actionHighlightWidthRange.value}px`;
    highlightPreview.style.borderRadius = `${actionHighlightRadiusRange.value}px`;
    highlightPreview.style.boxShadow = `0 0 18px ${hexToRgba(color, 0.4)}`;
  }
}

// Convierte #rrggbb a rgba() para el brillo del marco
function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return `rgba(34, 197, 94, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

actionHighlightCheck.addEventListener("change", updateHighlightControls);
actionHighlightColorInput.addEventListener("input", updateHighlightControls);
actionHighlightWidthRange.addEventListener("input", updateHighlightControls);
actionHighlightRadiusRange.addEventListener("input", updateHighlightControls);

let lastFocused = null; // elemento con foco antes de abrir el modal (para devolverlo)

function openModal(modal) {
  lastFocused = document.activeElement;
  modal.classList.add("open");
  // Enfoca el primer campo del modal (mejor accesibilidad por teclado)
  const first = modal.querySelector("input, button, select, textarea");
  if (first) first.focus();
}

function closeModal(modal) {
  modal.classList.remove("open");
  pendingExePath = null;
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  lastFocused = null;
}

[addAppModal, addPackModal, addPackAppModal, editAppModal, editPackModal, editPackAppModal].forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal(modal);
  });
});

// ---------------------------------------------------------------
// Apps sueltas
// ---------------------------------------------------------------
function renderApps() {
  appsList.innerHTML = "";
  if (config.apps.length === 0) {
    appsList.innerHTML = emptyStateMarkup(
      "Aún no tienes aplicaciones",
      "Agrega programas para abrirlos con la voz. Ej: \u201cNoxis abre discord\u201d.",
      "plus"
    );
    return;
  }
  config.apps.forEach((app, index) => {
    appsList.appendChild(buildAppRow(app, {
      onEdit: () => startEditApp(index),
      onRemove: () => confirmRemoveApp(index)
    }));
  });
}

function emptyStateMarkup(title, sub, iconName) {
  const icons = window.NoxisIcons || {};
  const inner = (icons[iconName] && icons.file ? icons.file(40) : "") || "";
  return `
    <li class="emptyState">
      <span class="emptyStateIcon">${icons[iconName] ? icons[iconName](34) : ""}</span>
      <span class="emptyStateTitle">${title}</span>
      <span class="emptyStateSub">${sub}</span>
    </li>
  `;
}

function confirmRemoveApp(index) {
  const app = config.apps[index];
  askInlineConfirm(`¿Eliminar la app \u201c${app.keyword}\u201d?`, () => {
    removeApp(index);
    showToast(`App \u201c${app.keyword}\u201d eliminada`, "success");
  });
}

function buildAppRow(app, { onEdit, onRemove }) {
  const li = document.createElement("li");
  li.className = "itemRow";
  li.innerHTML = `
    <div class="rowInfo">
      <span class="rowKeyword">${app.keyword}</span>
      <span class="rowPath" title="${app.executablePath}">${app.executablePath}</span>
    </div>
    <div class="rowActions">
      <button class="iconBtn editBtn" title="Editar" aria-label="Editar ${app.keyword}">${window.NoxisIcons.edit(14)}</button>
      <button class="iconBtn danger removeBtn" title="Eliminar" aria-label="Eliminar ${app.keyword}">${window.NoxisIcons.trash(14)}</button>
    </div>
  `;
  li.querySelector(".editBtn").addEventListener("click", onEdit);
  li.querySelector(".removeBtn").addEventListener("click", onRemove);
  return li;
}

// -- Agregar app (modal) --
document.getElementById("addAppBtn").addEventListener("click", () => {
  pendingExePath = null;
  addAppKeywordInput.value = "";
  addAppPathInput.value = "Selecciona un ejecutable...";
  addAppPathInput.classList.add("placeholder");
  openModal(addAppModal);
  addAppKeywordInput.focus();
});

addAppBrowseBtn.addEventListener("click", async () => {
  const exePath = await window.configAPI.chooseExecutable();
  if (!exePath) return;
  pendingExePath = exePath;
  addAppPathInput.value = exePath;
  addAppPathInput.classList.remove("placeholder");
  addAppKeywordInput.focus();
});

addAppConfirmBtn.addEventListener("click", () => {
  const keyword = addAppKeywordInput.value.trim().toLowerCase();
  if (!keyword) {
    addAppKeywordInput.focus();
    return;
  }
  if (!pendingExePath) {
    addAppBrowseBtn.click();
    return;
  }
  if (config.apps.some((a) => a.keyword === keyword)) {
    addAppKeywordInput.classList.add("error");
    setTimeout(() => addAppKeywordInput.classList.remove("error"), 1500);
    return;
  }
  config.apps.push({ keyword, executablePath: pendingExePath });
  renderApps();
  closeModal(addAppModal);
});

addAppCancelBtn.addEventListener("click", () => closeModal(addAppModal));

addAppKeywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addAppConfirmBtn.click();
  if (e.key === "Escape") closeModal(addAppModal);
});

// -- Editar app (modal) --
function startEditApp(index) {
  editingAppIndex = index;
  const app = config.apps[index];
  editAppKeywordInput.value = app.keyword;
  editAppPathInput.value = app.executablePath;
  editAppPathInput.classList.remove("placeholder");
  pendingExePath = app.executablePath;
  openModal(editAppModal);
  editAppKeywordInput.focus();
}

editAppBrowseBtn.addEventListener("click", async () => {
  const exePath = await window.configAPI.chooseExecutable();
  if (!exePath) return;
  pendingExePath = exePath;
  editAppPathInput.value = exePath;
  editAppPathInput.classList.remove("placeholder");
});

editAppConfirmBtn.addEventListener("click", () => {
  const keyword = editAppKeywordInput.value.trim().toLowerCase();
  if (!keyword) {
    editAppKeywordInput.focus();
    return;
  }
  const app = config.apps[editingAppIndex];
  if (config.apps.some((a) => a.keyword === keyword && a !== app)) {
    editAppKeywordInput.classList.add("error");
    setTimeout(() => editAppKeywordInput.classList.remove("error"), 1500);
    return;
  }
  app.keyword = keyword;
  app.executablePath = pendingExePath;
  renderApps();
  closeModal(editAppModal);
});

editAppCancelBtn.addEventListener("click", () => closeModal(editAppModal));

editAppKeywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") editAppConfirmBtn.click();
  if (e.key === "Escape") closeModal(editAppModal);
});

// -- Eliminar app --
function removeApp(index) {
  config.apps.splice(index, 1);
  renderApps();
}

// ---------------------------------------------------------------
// Grupos / Packs
// ---------------------------------------------------------------
function renderPacks() {
  packsList.innerHTML = "";
  if (config.packs.length === 0) {
    packsList.innerHTML = emptyStateMarkup(
      "No hay grupos todavía",
      "Agrupa varias apps para abrirlas todas con una sola orden.",
      "packs"
    );
    return;
  }
  config.packs.forEach((pack, index) => {
    const li = document.createElement("li");
    li.className = "groupCard" + (pack === selectedPack ? " selected" : "");
    li.innerHTML = `
      <div class="groupCardMain">
        <span class="groupCardName">${pack.name}</span>
        <span class="groupCardKeyword">&#8220;${pack.keyword}&#8221;</span>
      </div>
      <div class="groupCardMeta">
        <span class="chip">${pack.apps.length} ${pack.apps.length === 1 ? "app" : "apps"}</span>
        <span class="chip">${pack.delaySeconds}s de pausa</span>
      </div>
      <div class="groupCardActions">
        <button class="iconBtn editBtn" title="Editar" aria-label="Editar ${pack.name}">${window.NoxisIcons.edit(14)}</button>
        <button class="iconBtn danger removeBtn" title="Eliminar" aria-label="Eliminar ${pack.name}">${window.NoxisIcons.trash(14)}</button>
      </div>
    `;
    li.addEventListener("click", () => selectPack(pack));
    li.querySelector(".editBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      startEditPack(index);
    });
    li.querySelector(".removeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      confirmRemovePack(index);
    });
    packsList.appendChild(li);
  });
}

function confirmRemovePack(index) {
  const pack = config.packs[index];
  askInlineConfirm(`¿Eliminar el grupo \u201c${pack.name}\u201d?`, () => {
    removePack(index);
    showToast(`Grupo \u201c${pack.name}\u201d eliminado`, "success");
  });
}

// -- Crear pack (modal) --
document.getElementById("addPackBtn").addEventListener("click", () => {
  addPackNameInput.value = "";
  addPackKeywordInput.value = "";
  addPackDelayInput.value = "3";
  openModal(addPackModal);
  addPackNameInput.focus();
});

addPackConfirmBtn.addEventListener("click", () => {
  const name = addPackNameInput.value.trim();
  const keyword = addPackKeywordInput.value.trim().toLowerCase();
  const delaySeconds = parseInt(addPackDelayInput.value, 10) || 3;

  if (!name) {
    addPackNameInput.focus();
    return;
  }
  if (!keyword) {
    addPackKeywordInput.focus();
    return;
  }
  if (config.packs.some((p) => p.keyword === keyword)) {
    addPackKeywordInput.classList.add("error");
    setTimeout(() => addPackKeywordInput.classList.remove("error"), 1500);
    return;
  }

  const newPack = { name, keyword, delaySeconds, apps: [] };
  config.packs.push(newPack);
  selectPack(newPack);
  renderPacks();
  closeModal(addPackModal);
});

addPackCancelBtn.addEventListener("click", () => closeModal(addPackModal));

addPackNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPackKeywordInput.focus();
  if (e.key === "Escape") closeModal(addPackModal);
});

addPackKeywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPackDelayInput.focus();
  if (e.key === "Escape") closeModal(addPackModal);
});

addPackDelayInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPackConfirmBtn.click();
  if (e.key === "Escape") closeModal(addPackModal);
});

// -- Editar pack (modal) --
function startEditPack(index) {
  editingPackIndex = index;
  const pack = config.packs[index];
  editPackNameInput.value = pack.name;
  editPackDelayInput.value = String(pack.delaySeconds);
  openModal(editPackModal);
  editPackNameInput.focus();
}

editPackConfirmBtn.addEventListener("click", () => {
  const pack = config.packs[editingPackIndex];
  const name = editPackNameInput.value.trim();
  const delaySeconds = parseInt(editPackDelayInput.value, 10) || 3;

  if (!name) {
    editPackNameInput.focus();
    return;
  }
  pack.name = name;
  pack.delaySeconds = delaySeconds;
  if (selectedPack === pack) {
    selectedPackTitle.textContent = pack.name;
  }
  renderPacks();
  closeModal(editPackModal);
});

editPackCancelBtn.addEventListener("click", () => closeModal(editPackModal));

editPackNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") editPackDelayInput.focus();
  if (e.key === "Escape") closeModal(editPackModal);
});

editPackDelayInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") editPackConfirmBtn.click();
  if (e.key === "Escape") closeModal(editPackModal);
});

// -- Eliminar pack --
function removePack(index) {
  const pack = config.packs[index];
  if (selectedPack === pack) {
    selectedPack = null;
    renderPackApps();
  }
  config.packs.splice(index, 1);
  renderPacks();
}

function selectPack(pack) {
  selectedPack = pack;
  selectedPackTitle.textContent = pack.name;
  addPackAppBtn.disabled = false;
  renderPacks();
  renderPackApps();
}

// -- Pack apps --
function renderPackApps() {
  packAppsList.innerHTML = "";
  if (!selectedPack) {
    packAppsList.innerHTML = emptyStateMarkup(
      "Selecciona un grupo",
      "Elige un grupo de la columna izquierda para ver y editar sus apps.",
      "packs"
    );
    return;
  }
  if (selectedPack.apps.length === 0) {
    packAppsList.innerHTML = emptyStateMarkup(
      "Este grupo no tiene apps",
      "Agrega aplicaciones para que se abran juntas con una sola orden.",
      "plus"
    );
    return;
  }
  selectedPack.apps.forEach((app, index) => {
    packAppsList.appendChild(buildAppRow(app, {
      onEdit: () => startEditPackApp(index),
      onRemove: () => confirmRemovePackApp(index)
    }));
  });
}

function confirmRemovePackApp(index) {
  const app = selectedPack.apps[index];
  askInlineConfirm(`¿Quitar la app \u201c${app.keyword}\u201d del grupo?`, () => {
    removePackApp(index);
  });
}

// -- Agregar app al pack (modal) --
addPackAppBtn.addEventListener("click", () => {
  if (!selectedPack) {
    alert("Selecciona un grupo primero");
    return;
  }
  pendingExePath = null;
  addPackAppKeywordInput.value = "";
  addPackAppPathInput.value = "Selecciona un ejecutable...";
  addPackAppPathInput.classList.add("placeholder");
  openModal(addPackAppModal);
  addPackAppKeywordInput.focus();
});

addPackAppBrowseBtn.addEventListener("click", async () => {
  const exePath = await window.configAPI.chooseExecutable();
  if (!exePath) return;
  pendingExePath = exePath;
  addPackAppPathInput.value = exePath;
  addPackAppPathInput.classList.remove("placeholder");
  addPackAppKeywordInput.focus();
});

addPackAppConfirmBtn.addEventListener("click", () => {
  const keyword = addPackAppKeywordInput.value.trim().toLowerCase();
  if (!keyword) {
    addPackAppKeywordInput.focus();
    return;
  }
  if (!pendingExePath) {
    addPackAppBrowseBtn.click();
    return;
  }
  if (selectedPack.apps.some((a) => a.keyword === keyword)) {
    addPackAppKeywordInput.classList.add("error");
    setTimeout(() => addPackAppKeywordInput.classList.remove("error"), 1500);
    return;
  }

  selectedPack.apps.push({ keyword, executablePath: pendingExePath });
  renderPackApps();
  renderPacks();
  closeModal(addPackAppModal);
});

addPackAppCancelBtn.addEventListener("click", () => closeModal(addPackAppModal));

addPackAppKeywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPackAppConfirmBtn.click();
  if (e.key === "Escape") closeModal(addPackAppModal);
});

// -- Editar app del pack (modal) --
function startEditPackApp(index) {
  editingPackAppIndex = index;
  const app = selectedPack.apps[index];
  editPackAppKeywordInput.value = app.keyword;
  editPackAppPathInput.value = app.executablePath;
  editPackAppPathInput.classList.remove("placeholder");
  pendingExePath = app.executablePath;
  openModal(editPackAppModal);
  editPackAppKeywordInput.focus();
}

editPackAppBrowseBtn.addEventListener("click", async () => {
  const exePath = await window.configAPI.chooseExecutable();
  if (!exePath) return;
  pendingExePath = exePath;
  editPackAppPathInput.value = exePath;
  editPackAppPathInput.classList.remove("placeholder");
});

editPackAppConfirmBtn.addEventListener("click", () => {
  const keyword = editPackAppKeywordInput.value.trim().toLowerCase();
  if (!keyword) {
    editPackAppKeywordInput.focus();
    return;
  }
  const app = selectedPack.apps[editingPackAppIndex];
  if (selectedPack.apps.some((a) => a.keyword === keyword && a !== app)) {
    editPackAppKeywordInput.classList.add("error");
    setTimeout(() => editPackAppKeywordInput.classList.remove("error"), 1500);
    return;
  }
  app.keyword = keyword;
  app.executablePath = pendingExePath;
  renderPackApps();
  renderPacks();
  closeModal(editPackAppModal);
});

editPackAppCancelBtn.addEventListener("click", () => closeModal(editPackAppModal));

editPackAppKeywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") editPackAppConfirmBtn.click();
  if (e.key === "Escape") closeModal(editPackAppModal);
});

// -- Eliminar app del pack --
function removePackApp(index) {
  selectedPack.apps.splice(index, 1);
  renderPackApps();
  renderPacks();
}

// ---------------------------------------------------------------
// Guardar / Cancelar
// ---------------------------------------------------------------
document.getElementById("saveBtn").addEventListener("click", async () => {
  config.name = nameInput.value.trim() || "Noxis";
  config.autoStart = autoStartCheck.checked;
  config.allowMicrophone = micCheck.checked;
  config.theme = getActiveTheme();

  config.alwaysOnTop = alwaysOnTopCheck.checked;
  config.showInTaskbar = showInTaskbarCheck.checked;
  config.startCorner = startCornerSelect.value;
  const dur = parseFloat(bubbleDurationInput.value);
  config.bubbleDuration = (!isNaN(dur) && dur > 0) ? dur : 8.5;
  config.commandSoundEnabled = commandSoundCheck.checked;
  config.voiceSimilarityThreshold = parseFloat(similarityRange.value);

  config.actionHighlightEnabled = actionHighlightCheck.checked;
  config.actionHighlightColor = actionHighlightColorInput.value;
  config.actionHighlightWidth = parseInt(actionHighlightWidthRange.value, 10) || 5;
  config.actionHighlightRadius = parseInt(actionHighlightRadiusRange.value, 10) || 0;

  const ok = await window.configAPI.saveConfig(config);
  if (ok) {
    showSaveStatus("Guardado correctamente");
    setTimeout(() => window.close(), 600);
  } else {
    showSaveStatus("Error al guardar");
  }
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  window.close();
});

// ---------------------------------------------------------------
// Restablecer configuración
// ---------------------------------------------------------------
document.getElementById("resetBtn").addEventListener("click", () => {
  askInlineConfirm("¿Restablecer toda la configuración?",
    "Esto borrará apps, grupos, skins y el nombre. Esta acción no se puede deshacer.",
    async () => {
      const ok = await window.configAPI.resetConfig();
      if (ok) {
        showToast("Configuración restablecida", "success");
        setTimeout(() => {
          loadConfig();
        }, 300);
      }
    }
  );
});

loadConfig();
