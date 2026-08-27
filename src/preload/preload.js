// src/preload/preload.js
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
  }
});
