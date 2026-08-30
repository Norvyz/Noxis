function createDefaultConfig() {
  return {
    name: "Noxis",
    autoStart: false,
    allowMicrophone: false,
    voiceModel: "precise",
    theme: "light",
    skinPath: null,
    selectedMicrophoneId: null,
    selectedMicrophoneName: null,
    apps: [],
    packs: [],
    aliases: [],
    lastUsedPack: null,
    bubbleDuration: 8500,
    commandSoundEnabled: true,
    commandSoundPath: null,
    startCorner: "bottom-right",
    alwaysOnTop: false,
    showInTaskbar: true,
    voiceSimilarityThreshold: 0.72,
    firstRun: true,
    actionHighlightEnabled: true,
    actionHighlightColor: "#22c55e",
    actionHighlightWidth: 5,
    actionHighlightRadius: 30
  };
}

function createAppCommand(keyword, executablePath, processName = null) {
  return { keyword, executablePath, processName };
}

function createAppPack(name, keyword, delaySeconds = 3) {
  return { name, keyword, delaySeconds, apps: [] };
}

module.exports = { createDefaultConfig, createAppCommand, createAppPack };
