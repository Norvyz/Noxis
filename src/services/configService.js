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

const THEMES = ["light", "dark", "obsidian", "midnight", "forest", "sunset", "rose", "ocean"];

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
    // Migración: versiones antiguas usaban isDarkMode (booleano) → theme (id)
    if (parsed.theme == null && parsed.isDarkMode != null) {
      parsed.theme = parsed.isDarkMode ? "dark" : "light";
    }
    delete parsed.isDarkMode;
    // Valida que el tema exista; si no, usa el default (light)
    if (!THEMES.includes(parsed.theme)) parsed.theme = "light";
    // Normaliza campos numéricos a rangos válidos (evita configs corruptas)
    const nums = [
      ["bubbleDuration", 2000, 20000],
      ["voiceSimilarityThreshold", 0.4, 1],
      ["actionHighlightWidth", 1, 30],
      ["actionHighlightRadius", 0, 200]
    ];
    for (const [key, min, max] of nums) {
      const v = parsed[key];
      if (typeof v !== "number" || !isFinite(v)) parsed[key] = createDefaultConfig()[key];
      else parsed[key] = Math.min(max, Math.max(min, v));
    }
    // Valida el color del resaltado (formato #rrggbb); si no, usa el default
    if (typeof parsed.actionHighlightColor !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(parsed.actionHighlightColor)) {
      parsed.actionHighlightColor = createDefaultConfig().actionHighlightColor;
    }
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
