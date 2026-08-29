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
  },
  onPlaySound: (callback) => {
    ipcRenderer.on("play-sound", (event, filePath) => callback(filePath));
  },
  onActionHighlight: (callback) => {
    ipcRenderer.on("action-highlight", () => callback());
  }
});
