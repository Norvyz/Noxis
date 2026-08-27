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

// src/services/configService.js
// Equivalente a ConfigService.cs. Persiste config.json en userData.

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { createDefaultConfig } = require("../models/defaultConfig");

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function load() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    const fresh = createDefaultConfig();
    save(fresh);
    return fresh;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    // merge con default por si se agregan campos nuevos en el futuro
    return { ...createDefaultConfig(), ...parsed };
  } catch (err) {
    console.error("[configService] Error leyendo config.json, usando default:", err);
    return createDefaultConfig();
  }
}

function save(config) {
  const configPath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    console.log("[configService] Config guardada en:", configPath);
    return true;
  } catch (err) {
    console.error("[configService] Error guardando config:", err);
    return false;
  }
}

module.exports = { load, save, getConfigPath };
