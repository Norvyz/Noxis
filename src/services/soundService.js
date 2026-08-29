const path = require("path");
const fs = require("fs");
const windows = require("../main/windows");

const SOUND_FILE = path.join(__dirname, "../../assets/sounds/command.mp3");

let lastPlay = 0;


function resolveSoundFile(config) {
  if (config && config.commandSoundPath && fs.existsSync(config.commandSoundPath)) {
    return config.commandSoundPath;
  }
  return SOUND_FILE;
}

/**
 * Reproduce el sonido de comando. Le avisa al widget (renderer) que
 * suene el archivo vía HTML5 Audio. Si no existe el archivo no hace nada.
 * @param {object} [config] configuración opcional; si commandSoundEnabled
 *   es false (o falta), no se reproduce.
 */
function playCommandSound(config) {
  if (!config || config.commandSoundEnabled === false) return;


  const now = Date.now();
  if (now - lastPlay < 400) return;
  lastPlay = now;

  const file = resolveSoundFile(config);
  if (!fs.existsSync(file)) return;

  const win = windows.getMainWindow();
  if (!win) return;

  win.webContents.send("play-sound", file);
}


function previewSound(filePath) {
  const file = filePath && fs.existsSync(filePath) ? filePath : SOUND_FILE;
  if (!fs.existsSync(file)) return false;

  const win = windows.getConfigWindow();
  if (!win) return false;

  win.webContents.send("play-sound", file);
  return true;
}

module.exports = { playCommandSound, previewSound };
