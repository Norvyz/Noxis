// src/services/launcherService.js
// Equivalente a los Process.Start(...) de MainWindow.xaml.cs

const { spawn } = require("child_process");
const { shell } = require("electron");

/**
 * Abre un ejecutable o ruta. Usa shell.openPath como respaldo
 * (mismo efecto que UseShellExecute = true en C#), y spawn
 * como via principal para no bloquear el proceso main.
 */
function openApp(executablePath) {
  try {
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: "ignore",
      shell: true
    });
    child.unref();
    return true;
  } catch (err) {
    console.error("[launcherService] fallo con spawn, probando shell.openPath:", err);
    shell.openPath(executablePath);
    return true;
  }
}

function delay(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

module.exports = { openApp, delay };
