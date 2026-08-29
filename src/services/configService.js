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
    if (parsed.theme == null && parsed.isDarkMode != null) {
      parsed.theme = parsed.isDarkMode ? "dark" : "light";
    }
    delete parsed.isDarkMode;

    if (!THEMES.includes(parsed.theme)) parsed.theme = "light";

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

    if (typeof parsed.actionHighlightColor !== "string" ||
        !/^#[0-9a-fA-F]{6}$/.test(parsed.actionHighlightColor)) {
      parsed.actionHighlightColor = createDefaultConfig().actionHighlightColor;
    }

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
