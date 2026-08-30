const launcherService = require("./launcherService");
const soundService = require("./soundService");
const configService = require("./configService");
const { fuzzyClose, tokensOf } = require("./conversationService");

const OPEN_VERBS = ["abre", "abrir", "abri", "abreme", "abrieme", "abrirme"];
const CLOSE_VERBS = [
  "cierra", "cerrar", "cierrame", "cerrame", "cerra", "cierre",
  "mata", "matar", "matalo", "termina", "terminar", "terminalo",
  "finaliza", "finalizar"
];

const EXCLUSION_WORDS = ["solo", "sin", "excepto", "saltando", "menos"];

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

// Cambio 3: aplica los alias de voz (from → to) sobre el texto, en orden.
function applyAliases(input, config) {
  const aliases = (config && config.aliases) || [];
  if (!aliases || !aliases.length) return input;
  let out = String(input || "");
  for (const alias of aliases) {
    if (!alias || !alias.from || !alias.to) continue;
    const from = String(alias.from).toLowerCase().trim();
    const to = String(alias.to).toLowerCase().trim();
    if (!from || !to || from === to) continue;
    // Reemplazo por palabra completa (voz = tokens separados)
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, to);
  }
  return out;
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

// Cambio 6: apertura selectiva. Devuelve { pack, all: true } | { pack, app } | null
function findSelection(text, config) {
  const pack = findPack(text, config);
  if (!pack) return null;
  if (!(pack.apps || []).length) return { pack, none: true };

  const words = tokensOf(text);
  const exclusionToken = words.find((w) =>
    EXCLUSION_WORDS.some((ew) => w === ew || fuzzyClose(w, ew))
  );
  if (!exclusionToken) return { pack, all: true };

  const idx = words.indexOf(exclusionToken);
  const after = words.slice(idx + 1);
  if (!after.length) return { pack, all: true };

  const target = pack.apps.find((app) => {
    return (
      after.some((w) => app.keyword === w || fuzzyClose(w, String(app.keyword))) ||
      phraseMatches(after.join(" "), app.keyword)
    );
  });

  if (!target) return { pack, all: true };
  return { pack, app: target };
}

async function handleCommand(rawInput, config, onMessage, onActionSuccess) {
  let text = String(rawInput || "").toLowerCase().trim();
  if (!text) return null;

  // Cambio 3: aliases de voz antes de intentar apps/grupos
  text = applyAliases(text, config);

  if (hasVerb(text, OPEN_VERBS)) {
    return runOpenCommand(text, config, onMessage, onActionSuccess);
  }

  if (hasVerb(text, CLOSE_VERBS)) {
    return runCloseCommand(text, config, onMessage, onActionSuccess);
  }

  return null;
}

// Cambio 6: recuerda el último grupo ejecutado para el comando "abre lo de antes"
function storeLastUsedPack(config, pack) {
  try {
    if (!pack) return;
    config.lastUsedPack = pack.keyword || pack.name;
    configService.save(config);
  } catch (err) {
    console.error("[packService] storeLastUsedPack:", err.message);
  }
}

// Abre todas las apps de un grupo (usado por "abre lo de antes" y por la apertura normal)
async function openPack(pack, config, onMessage, onActionSuccess) {
  if (!(pack && pack.apps)) return "";
  if (pack.apps.length === 0) {
    return `El grupo ${pack.name} no tiene aplicaciones aún 🦎`;
  }

  soundService.playCommandSound(config);
  onMessage(`Ejecutando grupo ${pack.name} 🚀`);

  const total = pack.apps.length;
  let opened = 0;
  for (let i = 0; i < total; i++) {
    const app = pack.apps[i];
    onMessage(`Abriendo ${app.keyword}… (${i + 1}/${total})`);
    const ok = launcherService.openApp(app.executablePath);
    if (ok) {
      opened++;
    } else {
      onMessage(`No pude abrir ${app.keyword} 😕`);
    }
    if (i < total - 1) await launcherService.delay(pack.delaySeconds);
  }

  if (onActionSuccess) onActionSuccess();
  storeLastUsedPack(config, pack);
  return opened === total
    ? `¡Listo! Abrí ${pack.name} (${opened} apps) 🚀`
    : `Abrí ${opened} de ${total} apps de ${pack.name} ✅`;
}

async function runOpenCommand(text, config, onMessage, onActionSuccess) {
  const selection = findSelection(text, config);

  if (selection && selection.pack) {
    if (selection.none) {
      return `El grupo ${selection.pack.name} no tiene aplicaciones aún 🦎`;
    }

    if (selection.app) {
      const app = selection.app;
      soundService.playCommandSound(config);
      onMessage(`Abriendo solo ${app.keyword} 🚀`);
      const ok = launcherService.openApp(app.executablePath);
      if (!ok) onMessage(`No pude abrir ${app.keyword} 😕`);
      if (ok && onActionSuccess) onActionSuccess();
      storeLastUsedPack(config, selection.pack);
      return ok
        ? `${config.name} abrió ${app.keyword} 🚀`
        : `Ups… no pude abrir ${app.keyword} 😕`;
    }

    // Apertura completa del grupo
    return openPack(selection.pack, config, onMessage, onActionSuccess);
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

  return null;
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
    return null;
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

module.exports = { handleCommand, openPack, applyAliases, findPack, findApp, findAppEverywhere };