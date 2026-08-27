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
