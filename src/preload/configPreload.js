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
  },
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  // Aprendizaje de archivos
  chooseFolder: () => ipcRenderer.invoke("learn:choose-folder"),
  analyzeFolder: (folderPath, options) => ipcRenderer.invoke("learn:analyze", folderPath, options),
  getLearnedWords: () => ipcRenderer.invoke("learn:get-words"),
  removeLearnedWord: (word) => ipcRenderer.invoke("learn:remove-word", word),
  clearLearnedWords: () => ipcRenderer.invoke("learn:clear-all"),
  onLearnProgress: (callback) => {
    ipcRenderer.on("learn:progress", (event, info) => callback(info));
  }
});
