const launcherService = require("./launcherService");
const soundService = require("./soundService");
const { fuzzyClose, tokensOf } = require("./conversationService");

const OPEN_VERBS = ["abre", "abrir", "abri", "abreme", "abrieme", "abrirme"];
const CLOSE_VERBS = [
  "cierra", "cerrar", "cierrame", "cerrame", "cerra", "cierre",
  "mata", "matar", "matalo", "termina", "terminar", "terminalo",
  "finaliza", "finalizar"
];

function hasVerb(text, verbs) {
  const words = tokensOf(text);
  return words.some((w) => verbs.some((v) => w === v || fuzzyClose(w, v)));
}

function phraseMatches(text, phrase) {
  const words = tokensOf(text);
  const phraseWords = tokensOf(phrase);
  if (!phraseWords.length) return false;
  return phraseWords.every((pw) => words.some((w) => w === pw || fuzzyClose(w, pw)));
}

function findPack(text, config) {
  return config.packs.find(
    (p) => text.includes(p.keyword) || phraseMatches(text, p.keyword)
  );
}

function findApp(text, config) {
  return config.apps.find(
    (a) => text.includes(a.keyword) || phraseMatches(text, a.keyword)
  );
}

function findAppEverywhere(text, config) {
  const direct = findApp(text, config);
  if (direct) return direct;
  for (const pack of config.packs || []) {
    const inPack = findApp(text, { apps: pack.apps || [] });
    if (inPack) return inPack;
  }
  return null;
}

async function handleCommand(input, config, onMessage, onActionSuccess) {
  const text = input.toLowerCase();

  if (hasVerb(text, OPEN_VERBS)) {
    return runOpenCommand(text, config, onMessage, onActionSuccess);
  }

  if (hasVerb(text, CLOSE_VERBS)) {
    return runCloseCommand(text, config, onMessage, onActionSuccess);
  }

  return null;
}

async function runOpenCommand(text, config, onMessage, onActionSuccess) {

  const pack = findPack(text, config);
  if (pack) {
    if (pack.apps.length === 0) {
      return `El grupo ${pack.name} no tiene aplicaciones aún 🦎`;
    }

    soundService.playCommandSound(config);

    onMessage(`Ejecutando grupo ${pack.name} 🚀`);

    for (const app of pack.apps) {
      const ok = launcherService.openApp(app.executablePath);
      if (!ok) onMessage(`No pude abrir ${app.keyword} 😕`);
      await launcherService.delay(pack.delaySeconds);
    }

    if (onActionSuccess) onActionSuccess();
    return `Listo 😎 Ya ejecuté el grupo ${pack.name}`;
  }

  const app = findApp(text, config);
  if (app) {
    soundService.playCommandSound(config);

    const ok = launcherService.openApp(app.executablePath);
    if (ok && onActionSuccess) onActionSuccess();
    return ok
      ? `${config.name} abrió ${app.keyword} 🚀`
      : `Ups… no pude abrir ${app.keyword} 😕`;
  }

  return "No conozco esa aplicación aún 🦎";
}

async function runCloseCommand(text, config, onMessage, onActionSuccess) {
  const pack = findPack(text, config);
  if (pack) {
    if (pack.apps.length === 0) {
      return `El grupo ${pack.name} no tiene aplicaciones aún 🦎`;
    }

    onMessage(`Cerrando grupo ${pack.name} 🛑`);

    let closed = 0;
    for (const app of pack.apps) {
      const result = await launcherService.closeApp(app);
      if (result.ok) {
        closed++;
      } else {
        onMessage(`No pude cerrar ${app.keyword} 😕`);
      }
    }

    if (closed > 0) {
      soundService.playCommandSound(config);
      if (onActionSuccess) onActionSuccess();
    }
    return closed === pack.apps.length
      ? `Listo 😎 Cerré el grupo ${pack.name}`
      : `Cerré ${closed} de ${pack.apps.length} apps de ${pack.name}`;
  }

  const app = findAppEverywhere(text, config);
  if (!app) {
    return "No conozco esa aplicación aún 🦎";
  }

  const result = await launcherService.closeApp(app);
  if (result.ok) {
    soundService.playCommandSound(config);
    if (onActionSuccess) onActionSuccess();
    return `${config.name} cerró ${app.keyword} ✋`;
  }
  if (result.reason === "no-process") {
    return `No pude deducir el proceso de ${app.keyword}. El acceso directo debe apuntar a un .exe real (no a una app universal o a una página web) 🦎`;
  }
  return `No pude cerrar ${app.keyword}. ¿Está abierta?`;
}

module.exports = { handleCommand };
