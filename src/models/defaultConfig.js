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

// src/models/defaultConfig.js
// Equivalente a NoxisConfig.cs. Define la forma de config.json.
//
// AppCommand  -> { keyword, executablePath }
// AppPack     -> { name, keyword, delaySeconds, apps: AppCommand[] }

function createDefaultConfig() {
  return {
    name: "Noxis",
    autoStart: false,
    allowMicrophone: false,
    voiceModel: "small",
    isDarkMode: false,
    skinPath: null,
    selectedMicrophoneId: null,
    selectedMicrophoneName: null,
    apps: [],
    packs: []
  };
}

function createAppCommand(keyword, executablePath) {
  return { keyword, executablePath };
}

function createAppPack(name, keyword, delaySeconds = 3) {
  return { name, keyword, delaySeconds, apps: [] };
}

module.exports = { createDefaultConfig, createAppCommand, createAppPack };
