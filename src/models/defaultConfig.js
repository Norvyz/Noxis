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
