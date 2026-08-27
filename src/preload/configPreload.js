// src/preload/configPreload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("configAPI", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", JSON.parse(JSON.stringify(config))),
  chooseSkin: () => ipcRenderer.invoke("config:choose-skin"),
  chooseExecutable: () => ipcRenderer.invoke("config:choose-executable"),
  resetConfig: () => ipcRenderer.invoke("config:reset"),
  getConfigPath: () => ipcRenderer.invoke("config:get-path"),
  getModelInfo: () => ipcRenderer.invoke("model:get-info"),
  setActiveModel: (type) => ipcRenderer.invoke("model:set-active", type),
  downloadModel: (type) => ipcRenderer.invoke("model:download", type),
  onModelStatus: (callback) => {
    ipcRenderer.on("vosk-status", (event, info) => callback(info));
  }
});
