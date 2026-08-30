const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noxisAPI", {
  sendMessage: (text) => ipcRenderer.invoke("get-response", text),
  openConfig: () => ipcRenderer.invoke("open-config-window"),
  dragWindow: (screenX, screenY, offsetX, offsetY) => ipcRenderer.invoke("drag-window", screenX, screenY, offsetX, offsetY),
  getConfig: () => ipcRenderer.invoke("config:get"),
  getSkinPath: () => ipcRenderer.invoke("get-skin-path"),
  getNoxisName: () => ipcRenderer.invoke("get-noxis-name"),
  getMicEnabled: () => ipcRenderer.invoke("get-mic-enabled"),
  getSelectedMicId: () => ipcRenderer.invoke("get-selected-mic-id"),
  getVoskModelUrl: () => ipcRenderer.invoke("get-vosk-model-url"),
  getVoskStatus: () => ipcRenderer.invoke("get-vosk-status"),
  getGrammar: () => ipcRenderer.invoke("grammar:get"),
  setVoiceModel: (type) => ipcRenderer.invoke("model:set-active", type),

  getWhisperStatus: () => ipcRenderer.invoke("whisper:status"),
  whisperTranscribe: (samples) => ipcRenderer.invoke("whisper:transcribe", samples),

  getSessionHistory: () => ipcRenderer.invoke("session:history"),
  clearSession: () => ipcRenderer.invoke("session:clear"),
  addReminder: (text, minutes) => ipcRenderer.invoke("reminder:add", text, minutes),
  listReminders: () => ipcRenderer.invoke("reminder:list"),
  cancelReminder: (id) => ipcRenderer.invoke("reminder:cancel", id),
  reminderAdd: (text, minutes) => ipcRenderer.invoke("reminder:add", text, minutes),
  reminderList: () => ipcRenderer.invoke("reminder:list"),
  reminderCancel: (id) => ipcRenderer.invoke("reminder:cancel", id),

  onShowMessage: (callback) => {
    ipcRenderer.on("show-message", (event, msg) => callback(msg));
  },
  onConfigUpdated: (callback) => {
    ipcRenderer.on("config-updated", (event, cfg) => callback(cfg));
  },
  onVoskStatus: (callback) => {
    ipcRenderer.on("vosk-status", (event, info) => callback(info));
  },
  onVoiceState: (callback) => {
    ipcRenderer.on("voice-state", (event, state) => callback(state));
  },
  onPlaySound: (callback) => {
    ipcRenderer.on("play-sound", (event, filePath) => callback(filePath));
  },
  onActionHighlight: (callback) => {
    ipcRenderer.on("action-highlight", () => callback());
  },
  onSpeak: (callback) => {
    ipcRenderer.on("speak-text", (event, text) => callback(text));
  },
  onVisionStatus: (callback) => {
    ipcRenderer.on("vision-status", (event, status) => callback(status));
  }
});
