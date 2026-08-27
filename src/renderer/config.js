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
const themeCheck = document.getElementById("themeCheck");
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
const modelProgress = document.getElementById("modelProgress");

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

    card.innerHTML = `
      <div class="modelCardTop">
        <input type="radio" name="voiceModel" value="${model.id}" ${model.id === info.active ? "checked" : ""} />
        <span class="modelName">${model.label}</span>
        <span class="modelVer">${model.version}</span>
      </div>
      <div class="modelDesc">${model.description}</div>
      <div class="modelCardFooter">
        <span class="modelStatus ${statusCls}">${statusText}</span>
        <button class="secondaryBtn modelDownloadBtn" data-action="download" ${installed ? "disabled" : ""} >
          ${installed ? "✓ Instalado" : "Descargar"}
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
        window.configAPI.downloadModel(model.id);
      }
      renderModelCards({ models: info.models, active: model.id });
    });

    // Botón descargar explícito
    card.querySelector(".modelDownloadBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (model.installed) return;
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
    modelProgress.classList.add("hidden");
    modelProgress.textContent = "";
    return;
  }
  const [id, st] = active;
  const info = modelInfoFor(id);
  const label = info ? info.label : id;
  if (st.status === "downloading" && st.pct != null) {
    modelProgress.textContent = `⏳ Descargando modelo ${label}: ${st.pct}%`;
  } else {
    modelProgress.textContent = `⏳ Preparando modelo ${label}…`;
  }
  modelProgress.classList.remove("hidden");
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
    modelProgress.textContent = `⚠️ ${info.detail || "Error con el modelo"}`;
    modelProgress.classList.remove("hidden");
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
    // el activo puede acabarse de instalar → seguir marcándolo activo
    fresh.active = cachedModelInfo.active;
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
document.getElementById("gearIcon").innerHTML = window.NoxisIcons.gear(18);
refreshMicBtn.innerHTML = window.NoxisIcons.refresh(14);
document.querySelectorAll(".btnIcon").forEach((el) => {
  const name = el.dataset.icon;
  if (window.NoxisIcons[name]) el.innerHTML = window.NoxisIcons[name](14);
});

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
document.querySelectorAll(".tabBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------
async function loadConfig() {
  config = await window.configAPI.getConfig();

  nameInput.value = config.name;
  autoStartCheck.checked = !!config.autoStart;
  micCheck.checked = !!config.allowMicrophone;
  themeCheck.checked = !!config.isDarkMode;
  applyTheme(config.isDarkMode);

  if (config.skinPath) {
    skinPreview.src = `file://${config.skinPath}`;
    skinPathLabel.textContent = config.skinPath;
  } else {
    skinPathLabel.textContent = "Sin skin personalizada";
  }

  micDeviceRow.classList.toggle("hidden", !config.allowMicrophone);
  if (config.allowMicrophone) loadMicDevices();

  loadModelSection();
  renderApps();
  renderPacks();
}

function applyTheme(isDark) {
  document.body.classList.toggle("dark", !!isDark);
}
themeCheck.addEventListener("change", () => applyTheme(themeCheck.checked));

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
// Skin
// ---------------------------------------------------------------
document.getElementById("changeSkinBtn").addEventListener("click", async () => {
  const filePath = await window.configAPI.chooseSkin();
  if (!filePath) return;
  config.skinPath = filePath;
  skinPreview.src = `file://${filePath}`;
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

function openModal(modal) {
  modal.classList.add("open");
}

function closeModal(modal) {
  modal.classList.remove("open");
  pendingExePath = null;
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
    appsList.innerHTML = '<li class="emptyMsg">No hay aplicaciones agregadas</li>';
    return;
  }
  config.apps.forEach((app, index) => {
    appsList.appendChild(buildAppRow(app, {
      onEdit: () => startEditApp(index),
      onRemove: () => removeApp(index)
    }));
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
      <button class="iconBtn editBtn" title="Editar">${window.NoxisIcons.edit(14)}</button>
      <button class="iconBtn danger removeBtn" title="Eliminar">${window.NoxisIcons.trash(14)}</button>
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
    packsList.innerHTML = '<li class="emptyMsg">No hay grupos creados</li>';
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
        <button class="iconBtn editBtn" title="Editar">${window.NoxisIcons.edit(14)}</button>
        <button class="iconBtn danger removeBtn" title="Eliminar">${window.NoxisIcons.trash(14)}</button>
      </div>
    `;
    li.addEventListener("click", () => selectPack(pack));
    li.querySelector(".editBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      startEditPack(index);
    });
    li.querySelector(".removeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      removePack(index);
    });
    packsList.appendChild(li);
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
    packAppsList.innerHTML = '<li class="emptyMsg">Selecciona un grupo para ver sus apps</li>';
    return;
  }
  if (selectedPack.apps.length === 0) {
    packAppsList.innerHTML = '<li class="emptyMsg">No hay apps en este grupo</li>';
    return;
  }
  selectedPack.apps.forEach((app, index) => {
    packAppsList.appendChild(buildAppRow(app, {
      onEdit: () => startEditPackApp(index),
      onRemove: () => removePackApp(index)
    }));
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
  config.isDarkMode = themeCheck.checked;

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
document.getElementById("resetBtn").addEventListener("click", async () => {
  if (!confirm("Esto borrará toda la configuración (apps, grupos, skins, nombre). ¿Estás seguro?")) return;
  const ok = await window.configAPI.resetConfig();
  if (ok) {
    showSaveStatus("Configuración restablecida");
    setTimeout(() => {
      loadConfig();
      showSaveStatus("Configuración restablecida - todo limpio");
    }, 300);
  }
});

loadConfig();
