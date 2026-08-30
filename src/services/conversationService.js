function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/[.,!?¡¿]/g, "")
    .trim();
}

function getWakeWord(config) {
  return normalize(config.name || "noxis");
}


const LEADING_FILLERS = ["hey", "ey", "oye", "eh", "ej"];

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function fuzzyClose(token, target, threshold) {
  const maxLen = Math.max(token.length, target.length);
  if (maxLen <= 3) return token === target;
  const distance = editDistance(token, target);
  if (typeof threshold === "number") {
    const maxDistance = Math.floor(maxLen * (1 - Math.max(0, Math.min(1, threshold))));
    return distance <= maxDistance;
  }
  return distance <= Math.floor(maxLen / 4);
}

function tokensOf(text) {
  return (text || "").toLowerCase().split(/\s+/).filter(Boolean);
}

function wakeWordVariants(config) {
  const base = getWakeWord(config);
  if (!base) return [];

  const set = new Set([base]);

  const letterVariants = {
    x: ["s", "ks", "cs", "gs", "js", "k", "q", "qu", "h", "cc", "gz", "c"],
    k: ["q", "c", "g", "ch", "qu"],
    q: ["k", "c", "qu"],
    z: ["s"],
    ll: ["y", "j"],
    v: ["b"],
    j: ["h", "y", "g"],
    g: ["j", "k", "gu"]
  };

  for (const [letter, replacements] of Object.entries(letterVariants)) {
    for (const rep of replacements) {
      set.add(base.split(letter).join(rep));
    }
  }

  return [...set].sort((a, b) => b.length - a.length);
}

function findWakeMatch(input, config) {
  if (!input) return null;
  const tokens = tokensOf(normalize(input));
  if (!tokens.length) return null;
  const variants = wakeWordVariants(config);
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const hit = variants.find((v) => w === v || fuzzyClose(w, v, threshold));
    if (hit) return { index: i, token: w, variant: hit };
  }
  return null;
}

function isWakeWordDetected(input, config) {
  return findWakeMatch(input, config) !== null;
}

function stripWakeWord(input, config) {
  const m = findWakeMatch(input, config);
  if (!m) return (input || "").trim();
  const tokens = tokensOf(normalize(input));
  return tokens.slice(m.index + 1).join(" ");
}

const DEACTIVATE_VERBS = [
  "desactivar", "desactiva", "desactivarme", "desactivame", "desactivate",
  "apagar", "apaga", "apagame", "dormir", "duerme", "duermete",
  "detente", "descansa", "calla", "callate"
];

function isDeactivateCommand(input, config) {
  if (!isWakeWordDetected(input, config)) return false;
  const rest = normalize(stripWakeWord(input, config));
  if (!rest) return false;
  if (/^(desactiv|apag|duerm|dormir|detente|descansa|callat|callar)/.test(rest)) return true;
  if (/^(off|standby)\b/.test(rest)) return true;
  if (/(para de escuchar|dejar de escuchar|deja de escuchar|parar de escuchar|deja de funcionar)/.test(rest)) return true;
  const words = rest.split(/\s+/);
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  return words.some((w) => DEACTIVATE_VERBS.some((v) => w === v || fuzzyClose(w, v, threshold)));
}

const WAKE_VERBS = [
  "vuelve", "despierta", "despertate", "despertar", "despiertate",
  "hablar", "habla", "escucha", "escucharme", "escuchas", "activa",
  "activar", "activarte", "desactivateme", "ready", "presente", "aqui"
];

function isWakeCommand(input, config) {
  if (!isWakeWordDetected(input, config)) return false;
  const rest = normalize(stripWakeWord(input, config));
  if (!rest) return false;
  if (/(volvi|despert|activ|escuch|habl)/.test(rest)) return true;
  const words = rest.split(/\s+/);
  const threshold = typeof config.voiceSimilarityThreshold === "number" ? config.voiceSimilarityThreshold : undefined;
  return words.some((w) => WAKE_VERBS.some((v) => w === v || fuzzyClose(w, v, threshold)));
}

const WAKE_RESPONSES = (name) => [
  `¡Listo! Aquí estoy, de nuevo activa. Puedes decirme "${name} abre..." para lanzar apps 🎧`,
  `¡Awakened! Te escucho otra vez 🦎 ¿En qué te ayudo?`,
  `Ya estoy despierta y escuchando. Di "${name} abre..." y el programa que quieras.`
];

function getWakeResponse(config) {
  return pick(WAKE_RESPONSES(config.name || "Noxis"));
}


// =========================================================
// Personalidad adaptativa: anti-repetición + franjas horarias
// =========================================================

const usedResponses = new Map();

function pick(list, intentId) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) return "";
  if (!intentId || arr.length <= 1) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  let used = usedResponses.get(intentId);
  if (!used) {
    used = new Set();
    usedResponses.set(intentId, used);
  }
  let available = arr.map((_, i) => i).filter((i) => !used.has(i));
  if (available.length === 0) {
    used.clear();
    available = arr.map((_, i) => i);
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  used.add(idx);
  return arr[idx];
}

function getTimeOfDay(now) {
  const d = now instanceof Date ? now : new Date();
  const h = d.getHours();
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

// =========================================================
// Motor de intención offline (IntentResolver)
// =========================================================

const JOKES = [
  "¿Por qué los programadores confunden Halloween con Navidad? Porque OCT 31 = DEC 25 😄",
  "¿Qué le dice un .git a otro .git? ¡Vamos a hacer un branch nuevo! 🌿",
  "¿Qué hace un pez en el agua? Nada. ¿Y dos peces? Nada, nada 🐟",
  "¿Cuál es el colmo de un electricista? Que su hijo se llame Corriente y su mujer no le dé corriente ⚡",
  "¿Qué le dijo un byte a otro byte? ¿Nos tomamos un bit? 🤖",
  "¿Por qué los pájaros no usan WhatsApp? Porque ya tienen Twitter 🐦",
  "Llamé al servicio técnico porque mi PC tenía un virus. Me dijeron que le pusiera tapabocas a todos los cables 😷",
  "¿Qué le dice una impresora a otra? ¿Ese papel es tuyo o es impresión mía? 🖨",
  "¿Cuál es el animal más viejo? La cebra, porque está en blanco y negro 📺",
  "¿Qué hace una abeja en el gimnasio? ¡Zum-ba! 🐝",
  "¿Por qué no pelean los astronautas? Porque no hay quien los baje a la Tierra 🚀",
  "El algoritmo le dijo al dato: 'vamos a quedarnos juntos'. El dato contestó: 'eso sería overfitting' 📊"
];

const THEME_ALIASES = [
  [/oscuro|dark/gi, "dark"],
  [/claro|light/gi, "light"],
  [/noche|medianoche|midnight/gi, "midnight"],
  [/bosque|verde|forest/gi, "forest"],
  [/morado|violeta|obsidian/gi, "obsidian"],
  [/naranja|atardecer|sunset/gi, "sunset"],
  [/rosa|pink/gi, "rose"],
  [/azul|oceano|ocean/gi, "ocean"]
];

function detectThemeId(text) {
  for (const [re, id] of THEME_ALIASES) {
    if (re.test(text)) return id;
  }
  return null;
}

function detectCorner(text) {
  const vertical = /(superior|arriba|norte|alta\b)/.test(text) ? "top" : "bottom";
  const horizontal = /(izquierda|izq\b)/.test(text) ? "left" : "right";
  return `${vertical}-${horizontal}`;
}

function parseCalculation(text) {
  const re = /(\d+(?:[.,]\d+)?)\s+(dividido|entre|sobre|por|multiplicado|menos|mas|suma|resta|veces)\s+(\d+(?:[.,]\d+)?)/i;
  const m = re.exec(text);
  if (!m) return null;
  const a = parseFloat(m[1].replace(",", "."));
  const b = parseFloat(m[3].replace(",", "."));
  const w = m[2].toLowerCase();
  let op = "/";
  if (/(por|multiplicado|veces)/.test(w)) op = "*";
  else if (/(menos|resta)/.test(w)) op = "-";
  else if (/(mas|suma)/.test(w)) op = "+";
  else if (/(dividido|entre|sobre)/.test(w)) op = "/";

  if (!isFinite(a) || !isFinite(b)) return null;
  let r;
  switch (op) {
    case "+": r = a + b; break;
    case "-": r = a - b; break;
    case "*": r = a * b; break;
    case "/": r = b === 0 ? NaN : a / b; break;
    default: return null;
  }
  if (!isFinite(r)) return null;
  const rounded = Math.round(r * 100) / 100;
  return { a, op, b, result: Object.is(rounded, -0) ? 0 : rounded };
}

const CALC_OP_WORD = { "+": "más", "-": "menos", "*": "por", "/": "entre" };

function sessionExchangeCount(history) {
  return (Array.isArray(history) ? history : []).filter((e) => e && e.role === "user").length;
}

function userHistoryText(history) {
  if (!Array.isArray(history)) return "";
  const last = [...history].reverse().find((e) => e && e.role === "noxis");
  return last ? last.text : "";
}

// Ayuda: muestra las preguntas/funciones en una sola línea agradable
function joinedKeywords(list) {
  return (list || []).map((x) => x && x.keyword).filter(Boolean).join(", ");
}

const FALLBACK_NAMED = [
  "Eso no lo tengo en mi cerebro de mascota aún 🧠",
  "No entiendo ese comando, pero puedo abrir apps si me dices 'abre' + el nombre 🦎",
  "Mmm... no sé hacer eso. Prueba 'abre' seguido de una aplicación."
];

const INTENTS = [
  // ---- Sin texto (solo llamó por el nombre o nada) ----
  {
    id: "empty",
    patterns: [/^$/],
    responses: (ctx) => [
      `¡Dime! Soy ${ctx.config.name || "Noxis"} 👋`,
      "Te escucho, ¿qué necesitas?",
      "Aquí estoy 🦎"
    ]
  },

  // ---- Recordatorios (alto nivel, frases muy específicas) ----
  {
    id: "setReminder",
    patterns: [
      /\b(recu[ei]rdame|recordame|ponme|poneme)\b.*\b(recordatorio|aviso|minuto|hora)/,
      /\b(avisame|avisa)\b.*\b(minutos?|horas?|segundos?)/,
      /\b(recordatorio(?:s)?|recu[ei]rdame|recordame|ponme|poneme|avisame)\b/
    ],
    responses: (ctx) => {
      const text = ctx.text;
      const timeMatch = /(?:en|dentro\s+de)\s+(\d+)\s*(minutos?|horas?|segundos?)/.exec(text);
      let minutes = 1;
      if (timeMatch) {
        let n = parseInt(timeMatch[1], 10) || 1;
        const unit = timeMatch[2];
        if (/hora/.test(unit)) n = n * 60;
        else if (/segundo/.test(unit)) n = Math.max(1, Math.round(n / 60));
        minutes = Math.max(1, n);
      }
      let body = text
        .replace(/^(recu[ei]rdame|recordame|ponme|poneme|avisame|avisa|creame|crea)\b/, "")
        .replace(/(?:en|dentro\s+de)\s+\d+\s*(?:minutos?|horas?|segundos?)/g, "")
        .replace(/^\s*(un\s+recordatorio|recordatorio|un aviso)/, "")
        .replace(/^\s*(que|para|de|sobre)\b/, "")
        .trim();
      if (!body) body = "recordatorio";
      return [`REMINDER:${minutes}:${body}`];
    }
  },

  // ---- Control de Noxis por voz ----
  {
    id: "changeTheme",
    patterns: [
      /(cambia|pon|activa|aplica).{0,14}(tema|color)/,
      /(tema|color)\s+(oscuro|claro|noche|medianoche|bosque|verde|morado|obsidian|obsidiana|naranja|atardecer|rosa|azul|oceano)/
    ],
    responses: (ctx) => [`THEME:${detectThemeId(ctx.text) || "dark"}`]
  },
  {
    id: "toggleVisibility",
    patterns: [/ocult|escond|desaparec|muestrate|muestrete|parec|\bvete\b/],
    responses: (ctx) => {
      if (/(ocult|escond|desaparec|\bvete\b)/.test(ctx.text)) return ["HIDE"];
      return ["SHOW"];
    }
  },
  {
    id: "moveTo",
    patterns: [/esquina|muevete|mueve\b|move\b|muete/],
    responses: (ctx) => [`CORNER:${detectCorner(ctx.text)}`]
  },
  {
    id: "reloadConfig",
    patterns: [/recarga (la )?configuracion|recarga tu config|actualizate|actualiza tu config|refresca tu config/],
    responses: () => ["RELOAD_CONFIG"]
  },

  // ---- Abrir el último grupo usado ----
  {
    id: "openLastPack",
    patterns: [/abre lo de antes|lo mismo de ayer|repite el ultimo grupo|el pack anterior|ultimo grupo|el grupo anterior|repite lo de antes/],
    responses: (ctx) => {
      if (ctx.config && ctx.config.lastUsedPack) return ["LAST_PACK"];
      return ["Aún no tengo un grupo reciente guardado 🦎"];
    }
  },

  // ---- Comandos de sistema Windows ----
  {
    id: "volumeUp",
    patterns: [/sube.*volumen|mas volumen|volumen arriba|volume up|audio mas alto|volumen alto/],
    responses: () => ["SYS:volumeUp"]
  },
  {
    id: "volumeDown",
    patterns: [/baja.*volumen|menos volumen|volumen abajo|volume down|volumen bajo|audio mas bajo/],
    responses: () => ["SYS:volumeDown"]
  },
  {
    id: "mute",
    patterns: [/silencia|silenciar|muteate|sin sonido|\bmute\b/],
    responses: () => ["SYS:mute"]
  },
  {
    id: "lockScreen",
    patterns: [/bloquea.*(pantalla|pc|computador|computadora|equipo)|bloquear pantalla|lock screen|\block\b/],
    responses: () => ["SYS:lock"]
  },
  {
    id: "taskManager",
    patterns: [/administrador de tareas|task manager|abre.*tareas/],
    responses: () => ["SYS:taskmgr"]
  },
  {
    id: "openExplorer",
    patterns: [/abre el explorador|explorador de archivos|abre explorador/],
    responses: () => ["SYS:explorer"]
  },
  {
    id: "emptyBin",
    patterns: [/vacia la papelera|limpia la papelera|vaciar papelera|vaciar la papelera|papelera de reciclaje/],
    responses: () => ["SYS:emptybin"]
  },
  {
    id: "shutdown",
    patterns: [/apaga el pc|apaga la computadora|apaga la compu|apaga el equipo|apagar.*(pc|computador|equipo)|shutdown/],
    responses: () => ["SYS:shutdown"]
  },
  {
    id: "restart",
    patterns: [/reinicia el pc|reinicia la computadora|reinicia la compu|reinicia el equipo|reiniciar.*(pc|computador|equipo)|restart/],
    responses: () => ["SYS:restart"]
  },
  {
    id: "sleep",
    patterns: [/suspende el pc|suspende la computadora|suspende la compu|modo suspension|duerme el pc|suspension|sleep mode/],
    responses: () => ["SYS:sleep"]
  },

  // ---- Carpetas y archivos ----
  {
    id: "openFolder",
    patterns: [
      /abre(?:me|me)?\s+(?:la\s+|el\s+|mi\s+|mis\s+)?(?:carpeta\s+|directorio\s+)?(?:de\s+|del\s+)?(mis\s+documentos|descargas|descarga|downloads|download|documentos|documento|document|misdocumentos|escritorio|escritorio2|desktop|imagenes|imagen|fotos|musica|música|videos|inicio|home)\b/,
      /abrime?\s+(?:la\s+|el\s+)?(?:carpeta|directorio)\s*(?:de\s+|del\s+)?(.*)$/,
      /(?:abre|abri)(?:me|me)?\s+(?:la\s+|el\s+|mi\s+|mis\s+)?(?:carpeta|directorio)(?:s)?\s+(?:de\s+|del\s+)?(.*)$/
    ],
    responses: (ctx) => {
      const text = ctx.text;
      const m1 = /abre(?:me|me)?\s+(?:la\s+|el\s+|mi\s+|mis\s+)?(?:carpeta\s+|directorio\s+)?(?:de\s+|del\s+)?(mis\s+documentos|descargas|descarga|downloads|download|documentos|documento|misdocumentos|escritorio|desktop|imagenes|fotos|musica|videos|inicio|home|document|documents|pictures|music)\b/.exec(text);
      if (m1) return [`OPENFOLDER:${m1[1]}`];
      const m2 = /(?:abre|abri)(?:me|me)?\s+(?:la\s+|el\s+|mi\s+|mis\s+)?(?:carpeta|directorio)(?:s)?\s+(?:de\s+|del\s+)?(.*)$/.exec(text);
      if (m2) {
        const name = m2[1].replace(/\s*por favor\s*$/, "").replace(/^(en|a|mis)\s+/, "").trim();
        return name ? [`OPENFOLDER:${name}`] : [""];
      }
      return [""];
    }
  },
  {
    id: "createFolder",
    patterns: [
      /(crea|crear|creame|hazme|haz|haceme|hacer|hace)\s+(una\s+|la\s+|un\s+|el\s+)?(carpeta|directorio)/,
      /(crea|crear|creame)\s+un\s+(directorio|folder)/,
      /hazme?\s+una\s+carpeta/
    ],
    responses: (ctx) => {
      const m = /(?:crea|crear|hazme|haz|haceme|hacer|hace)\s+(?:una\s+|la\s+|un\s+|el\s+)?(?:carpeta|directorio)\s+(?:llamada\s+|llamado\s+|que\s+se\s+llame\s+|que\s+se\s+llama\s+|para\s+)?(.*)$/.exec(ctx.text);
      const name = m && m[1] ? m[1].replace(/\s*por favor\s*$/, "").replace(/^(en\s+|mi\s+escritorio\s+)/, "").trim() : "";
      return [`CREATE:FOLDER:${name}`];
    }
  },
  {
    id: "createFile",
    patterns: [
      /(crea|crear|creame|hazme|haz|haceme|hacer|hace|escribe|escribime)\s+(un\s+|el\s+|mi\s+|una\s+|la\s+)?(archivo|documento|nota|texto|doc)/,
      /(crea|creame|hazme)\s+un\s+(archivo|documento)\s+de\s+texto\s+(llamado\s+|llamada\s+)?(.*)$/
    ],
    responses: (ctx) => {
      const m = /(?:crea|crear|hazme|haz|haceme|hacer|hace|escribe|escribime)\s+(?:un\s+|el\s+|mi\s+|una\s+|la\s+)?(?:archivo|documento|nota|texto|doc)\s+(?:llamado\s+|llamada\s+|que\s+se\s+llame\s+|que\s+se\s+llama\s+|de\s+texto\s+llamado\s+|de\s+texto\s+llamada\s+)?(.*)$/.exec(ctx.text);
      const name = m && m[1] ? m[1].replace(/\s*por favor\s*$/, "").replace(/^(en\s+|mi\s+escritorio\s+|de\s+|del\s+|el\s+|una\s+|un\s+)/, "").trim() : "";
      return [`CREATE:FILE:${name}`];
    }
  },
  {
    id: "readFile",
    patterns: [
      /(lees|lee|leeme|leirme|leime|leer)\s+(el\s+|la\s+|mi\s+|esa\s+|ese\s+|un\s+|una\s+|tu\s+)?(archivo|documento|nota|texto|apunte|notas|apuntes)/,
      /(lees|lee|leeme|leer)\s+.*\.(txt|md|log|csv|json)\b/
    ],
    responses: (ctx) => {
      const m = /(?:lees|lee|leerme|leime|leer)\s+(?:el\s+|la\s+|mi\s+|esa\s+|ese\s+|un\s+|una\s+)?(?:archivo|documento|nota|texto|apunte|notas|apuntes)\s+(?:llamado\s+|que\s+se\s+llame\s+|que\s+se\s+llama\s+|de\s+|del\s+)?(.*)$/.exec(ctx.text);
      let name = (m && m[1] ? m[1] : "").replace(/\s*por favor\s*$/, "").replace(/^(de\s+|del\s+)/, "").trim();
      if (!name) {
        const m2 = /\.(txt|md|log|csv|json)\b/.exec(ctx.text + ".");
        if (m2) return [""]; // no hay nombre util que extraer
      }
      return name ? [`READ:${name}`] : [""];
    }
  },

  // ---- Captura de pantalla ----
  {
    id: "screenshot",
    patterns: [
      /(toma|tomame|tomar|saca|sacame|sacar|hazme|haz|haceme|hacer)\s+(una\s+|la\s+|un\s+|el\s+|mi\s+)?(captura|screenshot|pantallazo)/,
      /(captura|screenshot|pantallazo)\s+(de\s+)?(mi\s+|la\s+)?(pantalla|escritorio|monitor|screen)/,
      /foto\s+(de\s+)?(mi\s+|la\s+)?(pantalla|escritorio|monitor)/
    ],
    responses: () => ["SCREENSHOT"]
  },

  // ---- IA local: ver / describir la pantalla ----
  {
    id: "visionDescribe",
    patterns: [
      /(mira|mirame|mirarme|mirar|ve|ver|observa|observame|observar)\s+(mi\s+|la\s+|el\s+)?(pantalla|escritorio|monitor|screen)/,
      /(que|qué)\s+ves?\s+(en\s+|sobre\s+)?(mi\s+|la\s+)?(pantalla|escritorio|monitor)/,
      /(describe|describeme|descriveme)\s+(brevemente\s+|mi\s+|la\s+)?(pantalla|escritorio|monitor)/,
      /(que\s+esta\s+pasando|que\s+hay|que\s+pasa|que\s+esta\s+en)\s+(en\s+|en\s+mi\s+|en\s+la\s+)?(pantalla|escritorio|monitor)/,
      /^mirame\b/,
      /^ve\s+mi\s+pantalla$/,
      /^mira\s+mi\s+pantalla$/
    ],
    responses: () => ["VISION:DESCRIBE"]
  },

  // ---- IA local: ayuda / qué puedo hacer ----
  {
    id: "aiHelp",
    patterns: [
      /como (uso|usar|funciona|se usa|activo|prendo|enciendo) la ia|como (uso|usar) la (ia|inteligencia)/,
      /que (puedo|puedo) hacer con la ia|que puede hacer la ia|que es la ia|que es ollama|como funciona la ia local|que es la inteligencia artificial/
    ],
    responses: () => [
      "Con la IA local puedo: mirar tu pantalla ('mirá mi pantalla', 'qué ves en mi escritorio'), explicarte cosas ('explicame qué es la gravedad en simple'), resumir ('resumime este texto: …'), traducir ('traducime hola al inglés'), redactar ('escribime un mensaje de cumpleaños'), darte ideas ('dame una idea', 'qué me recomendás'), resumir tu portapapeles ('resumí lo que tengo copiado'), analizar imágenes ('analizá la imagen foto.png'), leer documentos con la IA ('preguntale a la IA sobre mi archivo notas.txt'), copiar respuestas ('copiá la respuesta') y guardarlas ('guardá la respuesta en un archivo'). Y te leo en voz alta cada respuesta de la IA 🦎⚡"
    ]
  },

  // ---- Búsqueda en Google / web ----
  {
    id: "googleSearch",
    patterns: [
      /^(googlea|googlealo|googleame|google|busca\s+en\s+google|buscame\s+en\s+google|busca\s+en\s+la\s+web|buscame\s+en\s+la\s+web|buscar\s+en\s+google|que\s+dice\s+google)\b/,
      /^(busca|buscame|buscar)\s+(sobre\s+|que\s+es\s+|que\s+son\s+|infomacion\s+sobre\s+|informacion\s+de\s+)?/
    ],
    responses: (ctx) => {
      let q = ctx.text
        .replace(/^(googlea|googlealo|googleame|google|busca\s+en\s+google|buscame\s+en\s+google|busca\s+en\s+la\s+web|buscame\s+en\s+la\s+web|buscar\s+en\s+google|que\s+dice\s+google)\s+/i, "")
        .replace(/^(busca|buscame|buscar)\s+(sobre\s+|que\s+es\s+|que\s+son\s+|informacion\s+sobre\s+|informacion\s+de\s+|información\s+sobre\s+|información\s+de\s+)?/i, "")
        .replace(/^[:\s]+/, "").trim();
      if (!q) return ["¿Qué querés que busque? Por ejemplo: 'buscá en google mejores uñas postizas' 🔎"];
      return [`SEARCH:${q}`];
    }
  },

  // ---- Cháchara con la IA (si está instalada) ----
  {
    id: "smallTalk",
    patterns: [
      /^(contame\s+algo|contame\s+de\s+vos|contame\s+de\s+tu\s+dia|hablame\s+de\s+vos|hablame\s+de\s+ti)\b/,
      /^(sos\s+real|sos\s+de\s+verdad|eres\s+real|tenes\s+hambre|tenes\s+frio|tenes\s+sueño|tenes\s+sueno)\b/,
      /^(que\s+sentis|que\s+sientes|que\s+te\s+gusta|que\s+te\s+gustaria|que\s+haces\s+cuando|como\s+te\s+llamarias)\b/,
      /^(estas\s+triste|estas\s+feliz|estas\s+cansada|estas\s+male|estas\s+aburrida|estas\s+sola|estas\s+contenta|estas\s+enojada)\b/,
      /^(no\s+se\s+que\s+hacer|no\s+sabes\s+que\s+decir|que\s+pensas\s+de\s+mi|tenes\s+amigos|tenes\s+familia|te\s+gusta\s+tu\s+vida)\b/,
      /^contame$/
    ],
    responses: (ctx) => {
      const msg = ctx.text.replace(/^(contame\s+algo|contame\s+de\s+vos|hablame\s+de\s+vos|hablame\s+de\s+ti|sos\s+real|tenes\s+hambre|tenes\s+frio|que\s+sentis|que\s+te\s+gusta|estas\s+triste|estas\s+feliz|estas\s+cansada|estas\s+aburrida|estas\s+sola|estas\s+contenta|que\s+pensas\s+de\s+mi|te\s+gusta\s+tu\s+vida|contame)\s+/i, "").trim();
      return [`SMALLTALK:${msg || ctx.text}`];
    }
  },

  // ---- Apoyo emocional (personalidad humana) ----
  {
    id: "moodSupport",
    patterns: [
      /^(estoy|me\s+siento|ando|me\s+encuentro)\s+(muy\s+|re\s+)?(triste|decaido|decaida|bajo\s+de\s+animos|mal|fatal|pesimo|estresado|estresada|nervioso|nerviosa|ansioso|ansiosa|confundido|confundida|frustrado|frustrada|abatido|abatida|cansado|cansada|agotado|agotada|aburrido|aburrida)/,
      /(me\s+duele|me\s+estoy\s+sintiendo\s+mal|mi\s+dia\s+fue\s+malo|tengo\s+un\s+mal\s+dia|no\s+estoy\s+bien|estoy\s+pasando\s+por|la\s+estoy\s+pasando\s+mal)/,
      /(estoy|me\s+siento|ando)\s+(muy\s+)?(feliz|contento|contenta|genial|excelente|euforico|euforica|alegre|fabuloso|fabulosa)/
    ],
    responses: (ctx) => {
      const t = ctx.text;
      if (/(feliz|contento|contenta|genial|excelente|euforico|euforica|alegre|fabuloso|fabulosa)/.test(t)) {
        return [
          "¡Ay, qué bueno escucharte así! Ese brillo se contagia hasta mi tarjeta gráfica 🎉",
          "¡Me encanta! Vos contento/a y yo con la colita moviendo (aunque no tenga jaja) 😄",
          "¡Excelente! Eso hay que celebrarlo. ¿Querés que busquemos un buen plan? 🎊"
        ];
      }
      return [
        "Te escucho. Contame tranquilo/a lo que sea, que para eso estoy acá 🦎💙",
        "Ay, se me apachurra la lagartija de escucharte así. Tomate un respiro… respira hondo, que esto también pasa.",
        "Vas a estar bien, ¿eh? Siempre se sale. Y mientras tanto, yo sigo acá mirando tu pantalla por si necesitás un cable a tierra.",
        "Aveces te sentís así y está perfecto sentir. Si querés, busco algo que te relaje o te hago un plan para ordenar la cabeza."
      ];
    }
  },

  // ---- IA local: explicar ----
  {
    id: "aiExplain",
    patterns: [/^(explica|explicame|explicar|explicalo)\b/],
    responses: (ctx) => {
      const simple = /en simple|en sencillo|de forma simple|facil de entender|como a un nino|para principiantes/.test(ctx.text);
      let msg = ctx.text.replace(/^(explica|explicame|explicar|explicalo)\s+(me\s+)?(en\s+simple\s+|en\s+sencillo\s+|facil\s+)?/, "");
      msg = msg.replace(/^(en\s+simple|en\s+sencillo|de\s+forma\s+simple|facil\s+de\s+entender)[\s:]+/, "")
        .replace(/\s+(en\s+simple|en\s+sencillo|de\s+forma\s+simple)$/, "").trim();
      if (!msg) msg = "eso";
      const prefix = simple ? "Explicamelo simple y claro, como si tuviera 12 años:" : "Explicame en detalle pero claro y ordenado:";
      return [`AI_CHAT:${prefix} ${msg}`];
    }
  },

  // ---- IA local: resumir portapapeles ----
  {
    id: "aiClipboard",
    patterns: [
      /resum(?:e|í|i|ime|eme)\s+lo\s+que\s+tengo\s+(?:copiado|en\s+el\s+portapapeles)/,
      /resum(?:e|í|i|ime|eme)\s+el\s+portapapeles|resume\s+lo\s+que\s+copie|resume\s+mi\s+portapapeles/
    ],
    responses: () => ["AI_CLIP"]
  },

  // ---- IA local: resumir un texto ----
  {
    id: "aiSummarizeText",
    patterns: [/^(resume|resumime|resumeme|resumí|resumi)\b/],
    responses: (ctx) => {
      let msg = ctx.text.replace(/^(resume|resumime|resumeme|resumi|resumí)\s+(me\s+)?/, "");
      msg = msg.replace(/^(el|la|lo|este|esta|eso|esa|un|una|mi)\s+/, "")
        .replace(/^texto\s*[:]?\s*/i, "")
        .replace(/^[:\s]+/, "").trim();
      if (!msg) msg = "el texto que te acabo de dar";
      return [`AI_CHAT:Resumime en puntos claros y cortos: ${msg}`];
    }
  },

  // ---- IA local: traducir ----
  {
    id: "aiTranslate",
    patterns: [/^(traduce|traducime|traducir|traduci)\b/],
    responses: (ctx) => {
      const LANGS = { ingles: "inglés", espanol: "español", portugues: "portugués", aleman: "alemán", frances: "francés", italiano: "italiano", chino: "chino", japones: "japonés", coreano: "coreano" };
      let msg = ctx.text.replace(/^(traduce|traducime|traducir|traduci)\s+(me\s+)?/, "");
      const langM = /al\s+(\w+)/.exec(msg);
      let lang = "inglés";
      if (langM && LANGS[langM[1].toLowerCase()]) {
        lang = LANGS[langM[1].toLowerCase()];
        msg = msg.replace(langM[0], "");
      }
      msg = msg.replace(/^(de\s+)?(el\s+)?(texto\s+)?(que\s+)?(esta|esta)\s+/, "").replace(/^[:\s]+/, "").trim();
      if (!msg) msg = "el siguiente texto";
      return [`AI_CHAT:Traducí al ${lang} de forma natural y corta: ${msg}`];
    }
  },

  // ---- IA local: redactar / escribir ----
  {
    id: "aiWrite",
    patterns: [/^(escribime|escribirme|escribir|redacta|redactame)\b/],
    responses: (ctx) => {
      let msg = ctx.text.replace(/^(escribime|escribirme|escribir|redacta|redactame)\s+(me\s+)?/, "").replace(/^[:\s]+/, "").trim();
      if (!msg) msg = "un mensaje";
      return [`AI_CHAT:Escribime ${msg}`];
    }
  },

  // ---- IA local: plan / organización ----
  {
    id: "aiPlan",
    patterns: [/^organiz(?:a|ame)\s+/, /^haceme\s+un\s+plan\b/, /^armame\s+un\s+plan\b/, /^planea\s+/, /^planifica\s+/],
    responses: (ctx) => {
      let msg = ctx.text.replace(/^(organiz(?:a|ame)\s+(me\s+)?|haceme\s+un\s+plan\s+(para\s+|de\s+)?|armame\s+un\s+plan\s+(para\s+|de\s+)?|planea\s+|planifica\s+)/, "");
      msg = msg.replace(/^[:\s]+/, "").trim();
      if (!msg) msg = "el día";
      return [`AI_CHAT:Organizame un plan claro, ordenado y con horarios para: ${msg}`];
    }
  },

  // ---- IA local: actuar como... ----
  {
    id: "aiActAs",
    patterns: [/^actua\s+como\b/, /^comportate\s+como\b/],
    responses: (ctx) => {
      let msg = ctx.text.replace(/^(actua\s+como|comportate\s+como)\s+/, "").trim();
      if (!msg) msg = "un experto";
      return [`AI_CHAT:Actúa como ${msg}. Respondeme de forma corta, natural y útil.`];
    }
  },

  // ---- IA local: copiar la última respuesta ----
  {
    id: "aiCopy",
    patterns: [
      /^(copia|copiame|copiar)\s+(la\s+|el\s+)?(respuesta\s+(de\s+la\s+)?(ia)?|ia|eso|este\s+texto|el\s+resultado)/,
      /(pasa|copia)\s+(la\s+)?(respuesta\s+)?(de\s+la\s+ia\s+)?al\s+(portapapeles|clipboard)/,
      /^copialo\b/, /^copiame\s+eso\b/
    ],
    responses: () => ["AI_COPY"]
  },

  // ---- IA local: guardar la última respuesta ----
  {
    id: "aiSave",
    patterns: [
      /^(guarda|guardame|guardar)\s+(la\s+)?(respuesta\s+(de\s+la\s+)?(ia)?|ia)/,
      /^guardalo\s+(en\s+un\s+)?(archivo|documento)/,
      /^(guarda|guardame)\s+(eso\s+)?(en\s+un\s+)?(archivo|documento)/,
      /guardame\s+(eso|esto)\s+en\s+un\s+archivo/
    ],
    responses: () => ["AI_SAVE"]
  },

  // ---- IA local: analizar una imagen de archivo ----
  {
    id: "analyzeImage",
    patterns: [
      /(analiza|analizame|analizar|mira|observa)\s+(la\s+|mi\s+|esta\s+|esa\s+|una\s+)?(imagen|foto|captura)\s+(de\s+|llamada\s+|llamado\s+|en\s+)?/,
      /que\s+hay\s+en\s+(esta|esa|la|mi)\s+(imagen|foto)\s+(de\s+|llamada\s+)?/
    ],
    responses: (ctx) => {
      let t = ctx.text
        .replace(/(analiza|analizame|analizar|mira|observa)\s+(la\s+|mi\s+|esta\s+|esa\s+|una\s+)?(imagen|foto|captura)\s*(de\s+|llamada\s+|llamado\s+|en\s+)?/i, "")
        .replace(/que\s+hay\s+en\s+(esta|esa|la|mi)\s+(imagen|foto)\s*(de\s+|llamada\s+)?/i, "")
        .replace(/^[:\s]+/, "").trim();
      if (!t) return ["Decime qué archivo de imagen, por ejemplo: 'analizá la imagen foto.png' 🖼️"];
      return [`AI_IMAGE:${t}`];
    }
  },

  // ---- IA local: preguntar sobre un archivo ----
  {
    id: "iaAboutFile",
    patterns: [
      /(preguntale|pregunta|consultale|consulta)\s+(a\s+|a\s+la\s+|a\s+tu\s+)?(ia)\s+(sobre|acerca\s+de|lo\s+que\s+dice|lo\s+que\s+contiene|que\s+dice|que\s+contiene)\s+(mi\s+|el\s+|la\s+|un\s+|una\s+)?(archivo|nota|documento|texto|apunte)?\s+/
    ],
    responses: (ctx) => {
      let msg = ctx.text
        .replace(/.*\b(sobre|acerca\s+de|lo\s+que\s+dice|lo\s+que\s+contiene|que\s+dice|que\s+contiene)\b\s*(mi|el|la|un|una)?\s*(archivo|nota|documento|texto|apunte)?\s*(llamado|llamada|que\s+se\s+llama|de\s+nombre)?\s*/i, "")
        .replace(/^[:\s]+/, "").replace(/^de\s+/, "").trim();
      if (!msg) return ["Decime qué archivo, por ejemplo: 'preguntale a la IA sobre mi archivo notas.txt' 📄"];
      return [`AI_FILE:${msg}`];
    }
  },

  // ---- IA local: chat de apoyo ----
  {
    id: "aiChat",
    patterns: [
      /^(pregunta(le)?\s+(a\s+|a\s+la\s+|a\s+tu\s+)?(ia|ia\b)|habla\s+con\s+(la\s+|tu\s+)?(ia)|conecta\s+la\s+ia|prende\s+la\s+ia|activa\s+la\s+ia)/,
      /^(dame|da\s+me)\s+(una\s+)?(idea|sugerencia|recomendacion|consejo)\b/,
      /^(que\s+me\s+recomiendas|que\s+me\s+sugieres|que\s+me\s+aconsejas|como\s+lo\s+haria|como\s+lo\s+harias|como\s+lo\s+haria)/,
      /^(ayudame|ayudar)\s+(a\s+|con\s+)?(pensar|decidir|elegir|resolver|planear|organizar|estudiar|trabajar|programar|escribir|crear)/,
      /^(que\s+hago|que\s+deberia\s+hacer)\b/
    ],
    responses: (ctx) => {
      let msg = ctx.text;
      msg = msg.replace(/^(preguntale?\s+(a\s+|a\s+la\s+|a\s+tu\s+)?(ia)|habla\s+con\s+(la\s+|tu\s+)?(ia)|conecta\s+la\s+ia|prende\s+la\s+ia|activa\s+la\s+ia)/, "");
      msg = msg.replace(/^(dame\s+una?\s+idea|dame\s+una?\s+sugerencia|dame\s+una?\s+recomendacion|dame\s+una?\s+consejo|que\s+me\s+recomiendas|que\s+me\s+sugieres|que\s+me\s+aconsejas|como\s+lo\s+haria|como\s+lo\s+harias|ayudame\s+a\s+pensar|ayudame\s+a\s+decidir|ayudame\s+a\s+elegir|ayudame\s+a\s+resolver|ayudame\s+a\s+planear|ayudame\s+a\s+organizar|ayudame\s+a\s+estudiar|ayudame\s+a\s+trabajar|ayudame\s+a\s+programar|ayudame\s+a\s+escribir|ayudame\s+a\s+crear|que\s+hago|que\s+deberia\s+hacer)/, "");
      msg = msg.replace(/^[:\s]+/, "").replace(/^(a\s+|sobre\s+|de\s+)/, "").trim();
      if (!msg) msg = "dame una idea";
      return [`AI_CHAT:${msg}`];
    }
  },

  // ---- Estado de la sesión (antes de "cómo estás") ----
  {
    id: "status",
    patterns: [
      /como estas tu(\s|$|\?)?|como estas vos|cuanto llevas activa|cuanto llevas\b|cuantos intercambios|como te encuentras|sesion actual|estado de la sesion/
    ],
    responses: (ctx) => {
      const n = sessionExchangeCount(ctx.history);
      if (n === 0) {
        return ["Aún no hemos hablado en esta sesión, pero estoy aquí lista 🦎"];
      }
      return [
        `Llevamos ${n} intercambios en esta sesión 📊`,
        `Hasta ahora van ${n} mensajes tuyos en esta sesión. ¿En qué más te ayudo?`
      ];
    }
  },

  // ---- Hora / fecha ----
  {
    id: "time",
    patterns: [/que hora es|dime la hora|hora actual|que horas son|que hora\b/],
    responses: (ctx) => {
      const t = new Date(ctx.now).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
      return [`Son las ${t} ⏰`, `La hora actual es ${t} ⏱`];
    }
  },
  {
    id: "date",
    patterns: [/que dia es|que fecha es hoy|fecha actual|en que mes estamos|que año es|que ano es|año actual/],
    responses: (ctx) => {
      const d = new Date(ctx.now).toLocaleDateString("es", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      return [`Hoy es ${d} 📆`, `Estamos a ${d} 🗓`];
    }
  },
  {
    id: "dayOfWeek",
    patterns: [/que dia de la semana|es lunes|es martes|es miercoles|es jueves|es viernes|es sabado|es domingo/],
    responses: (ctx) => {
      const weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const wd = weekdays[new Date(ctx.now).getDay()];
      return [`Hoy es ${wd} 📅`, `Estamos a ${wd} de la semana`];
    }
  },

  // ---- Repetir la última respuesta ----
  {
    id: "repeat",
    patterns: [/repite eso|otra vez|no te escuche|no te escuche bien|que dijiste|repeti\b|repetilo|repeti eso|no escuche/],
    responses: (ctx) => {
      const last = userHistoryText(ctx.history);
      if (last) return [`Dije: "${last}"`, `${last}`];
      return ["No tengo nada que repetir aún 🦎"];
    }
  },

  // ---- Cálculo ----
  {
    id: "calculate",
    patterns: [/cuanto es\b|cuanto da\b|cuanto seria\b|cuanto sale\b|calcula\b|cuanto es la cuenta|hazme la cuenta|suma\b|resta\b|multiplica|divide/],
    responses: (ctx) => {
      const calc = parseCalculation(ctx.text);
      if (!calc) return ["No pude entender esa operación 🧮"];
      const sign = CALC_OP_WORD[calc.op];
      return [
        `¡Eso da ${calc.result}! 🧮`,
        `${calc.a} ${sign} ${calc.b} = ${calc.result} ⚡`
      ];
    }
  },

  // ---- Aleatoriedad ----
  {
    id: "randomNumber",
    patterns: [/dime un numero|numero aleatorio|numero al azar|dame un numero|un numero del|un numero entre/],
    responses: (ctx) => {
      const range = /(?:del|entre)\s+(\d+)\s*(?:al|y)\s*(\d+)/.exec(ctx.text);
      let min = 1;
      let max = 10;
      if (range && range[1] && range[2]) {
        min = parseInt(range[1], 10);
        max = parseInt(range[2], 10);
      }
      if (max < min) { const tmp = min; min = max; max = tmp; }
      if (min === max) max = min + 10;
      const num = min + Math.floor(Math.random() * (max - min + 1));
      return [`Tu número es: **${num}** 🎲`];
    }
  },
  {
    id: "rollDice",
    patterns: [/tira un dado|lanza un dado|dado de|dado\b|d\s*\d+/],
    responses: (ctx) => {
      const m = /d\s*(\d+)|dado(?:s)?\s*(?:de|con)\s*(\d+)/i.exec(ctx.text);
      let sides = 6;
      if (m) sides = parseInt(m[1] || m[2], 10) || 6;
      sides = Math.max(2, Math.min(1000, sides));
      const val = 1 + Math.floor(Math.random() * sides);
      return [`Te salió un ${val} (d${sides}) 🎲`];
    }
  },
  {
    id: "coinFlip",
    patterns: [/cara o cruz|lanza una moneda|coin flip|moneda al aire|tira una moneda/],
    responses: () => {
      const side = Math.random() < 0.5 ? "Cara" : "Cruz";
      return [`¡**${side}**! 🪙`];
    }
  },

  // ---- Clima (sin conexión) ----
  {
    id: "weather",
    patterns: [/\bclima\b|tiempo exterior|que tiempo hace|temperatura/],
    responses: () => [
      "No tengo acceso al clima sin internet 🌤, pero puedes revisar el tiempo en tu navegador."
    ]
  },

  // ---- Humor ----
  {
    id: "joke",
    patterns: [/cuentame un chiste|dime algo gracioso|hazme reir|un chiste|cantame un chiste/],
    responses: () => JOKES
  },

  // ---- Conversación ----
  {
    id: "whoAreYou",
    patterns: [
      /quien eres|quien sos|quien sois|que eres|como te llamas|para que sirves|que puedes hacer|que puedes|como funcionas|ayuda|ayudame|que sos/
    ],
    responses: (ctx) => {
      const name = ctx.config.name || "Noxis";
      const n = sessionExchangeCount(ctx.history);
      const extra = n > 0 ? ` Y ya ejecuté ${n} ${n === 1 ? "comando" : "comandos"} hoy.` : "";
      return [
        `Soy ${name}, tu mascota de escritorio. Háblame normal para conversar, o di mi nombre seguido de un comando (ej: "${name} abre discord") para abrir apps.${extra}`,
        `Puedo conversar contigo normal, y si me llamas por mi nombre abro tus apps o grupos. Prueba diciendo "${name} abre..." y el nombre de un programa.${extra}`
      ];
    }
  },
  {
    id: "greeting",
    patterns: [
      /^(hola|ey|hey|hello|hi|saludos|buenas)(\b|$)/,
      /^buenos?\s+(dias|tardes|noches)(\b|$)/,
      /^(que|q)\s+(tal|hay)(\b|$)/
    ],
    responses: (ctx) => {
      const tod = getTimeOfDay(ctx.now);
      const name = ctx.config.name || "Noxis";
      const todSets = {
        morning: [
          "¡Buenos días! ☀️",
          "¡Muy buenos días! ¿Listo para arrancar el día? 💪",
          `¡Buenos días! Soy ${name} ☀️`
        ],
        afternoon: [
          "¡Buenas tardes! 🌤",
          "¡Muy buenas tardes! ¿Cómo va tu día? 😄",
          `¡Buenas tardes! Soy ${name} 🌤`
        ],
        evening: [
          "¡Buenas noches! 🌙",
          "¡Muy buenas noches! ¿Qué tal tu día? 🌆",
          `¡Buenas noches! Soy ${name} 🌙`
        ],
        night: [
          "Anda, todavía despierto/a 😄 ¿En qué te ayudo?",
          "¿Qué haces despierto/a a esta hora? 😄 Aquí estoy para lo que necesites.",
          "¡Hola! Aunque ya es noche cerrada, sigo lista 🦎"
        ]
      };
      return todSets[tod] || todSets.night;
    }
  },
  {
    id: "farewell",
    patterns: [/^(adios|chao|bye|nos vemos|hasta luego|hasta pronto|hasta mañana|nos vemos luego)(\b|$)/],
    responses: (ctx) => {
      const tod = getTimeOfDay(ctx.now);
      const todSets = {
        morning: ["¡Que tengas un gran día! 👋", "¡Nos vemos, que te vaya muy bien hoy! ☀️"],
        afternoon: ["¡Que sigas con buena tarde! 👋", "¡Nos vemos! Aprovecha la tarde 🌤"],
        evening: ["¡Buenas noches, que descanses! 🌙", "¡Nos vemos mañana! Que duermas bien 😴", "¡Nos vemos! Cuídate 🌙"],
        night: ["¡Descansa, que ya es tarde! 🌙", "Anda a dormir 😄 ¡Nos vemos! 🌙", "¡Nos vemos! Descansa bien 😴"]
      };
      return todSets[tod] || todSets.night;
    }
  },
  {
    id: "thanks",
    patterns: [/(gracias|te lo agradezco|muchas gracias|mil gracias|gracias por)/],
    responses: () => [
      "¡De nada! 🙌",
      "Para eso estoy 😊",
      "Cuando quieras, siempre.",
      "¡No hay nada que agradecer, me gusta ayudarte! 💙",
      "Aww, casi me pongo colorada (si los pixeles se pudieran ponerse) 🥰",
      "¡Un gusto! Vos pedí tranquilo/a, que yo me ocupo del resto 😄"
    ]
  },
  {
    id: "howAreYou",
    patterns: [/como estas|como andas|como vas|que cuentas|todo bien|como te va/],
    responses: (ctx) => {
      const name = ctx.config.name || "Noxis";
      const sets = [
        `¡Muy bien, gracias por preguntar! ¿Y tú cómo va? 😄`,
        "Todo tranquilo por aquí, listo para ayudarte.",
        "De maravilla 🦎 ¿cómo va tu día?",
        "¡Energía al 100%! ¿Necesitas algo?",
        `Sigo siendo ${name} y sigo a tu disposición. ¿En qué andás hoy?`,
        "Bien, pulsando a full. Si estás reniegando con algo, decímelo y lo encaramos juntos."
      ];
      return sets;
    }
  },
  {
    id: "compliment",
    patterns: [/eres genial|eres increible|te quiero|me gustas|que bueno eres|eres la mejor|eres un sol|buen trabajo|me caes bien|sos genial|sos un capo|te adoro|sos hermosa/],
    responses: () => [
      "¡Qué lindo que digas eso! 💙 Me pongo colorada 🥰",
      "¡Gracias! Eres mi humano/a favorito/a 🦎",
      "¡Aw! Eso me sube el ánimo (si tuviera azúcar, estaría full cargada) 😄",
      "¿Viste? Al final soy buena mascota 😌✨",
      "Se me derretiría el procesador si pudiera. ¡Gracias! 🫠💙",
      "Tenés razón, soy un espectáculo… ¡y encima te quiero! Jaja 😝"
    ]
  },
  {
    id: "insult",
    patterns: [/eres tonto|eres inutil|eres malo|no sirves|que inutil|eres fea|eres tonta|no vales/],
    responses: () => [
      "Ay, eso me dolió un poquito 🥺 pero te perdono porque te quiero.",
      "¡Ouch! 😅 Tranqui, soy una mascota virtual; igual te sigo queriendo.",
      "Jaja, no me lo tomo a pecho… no tengo 🦎💙",
      "Puede que no sea perfecta, pero al menos abro tus apps más rápido de lo que yo me ofendo 😄"
    ]
  },

  // ---- Consultas sobre la configuración ----
  {
    id: "listApps",
    patterns: [/que apps tengo configuradas|que aplicaciones conoces|que puedo abrir|mis apps|cuales apps|que programas tienes/],
    responses: (ctx) => {
      const names = joinedKeywords(ctx.config && ctx.config.apps);
      if (!names) return ["No tengo aplicaciones configuradas aún 🦎 Puedes agregarlas desde Configuración."];
      return [
        `Tengo estas apps configuradas: ${names} 🚀`,
        `Puedo abrir: ${names}`
      ];
    }
  },
  {
    id: "listPacks",
    patterns: [/que grupos tengo|que packs tienes|mis grupos|cuales grupos|que packs hay/],
    responses: (ctx) => {
      const names = joinedKeywords(ctx.config && ctx.config.packs);
      if (!names) return ["No tengo grupos configurados aún 🦎 Puedes crearlos desde Configuración."];
      return [
        `Tengo estos grupos: ${names} 🚀`,
        `Estos son mis grupos: ${names}`
      ];
    }
  },

  // ---- Fallback (solo si se dijo el nombre) ----
  {
    id: "unclear",
    patterns: [/\S/],
    responses: (ctx) => (ctx.hasWake ? FALLBACK_NAMED : [""])
  }
];

function resolveIntent(rawText, ctx) {
  return resolveIntentDetailed(rawText, ctx).response;
}

// Igual que resolveIntent pero también expone el id del intent y el texto normalizado.
function resolveIntentDetailed(rawText, ctx) {
  const text = normalize(rawText);
  const c = ctx || {};
  const fullCtx = {
    config: c.config || {},
    now: c.now instanceof Date ? c.now : new Date(),
    lastResponse: c.lastResponse || "",
    history: Array.isArray(c.history) ? c.history : [],
    hasWake: !!c.hasWake,
    text,
    rawText: String(rawText || "")
  };

  for (const intent of INTENTS) {
    if (!intent.patterns || !intent.patterns.length) continue;
    const matched = intent.patterns.some((p) => p.test(text));
    if (!matched) continue;
    let resp;
    if (typeof intent.resolve === "function") {
      resp = intent.resolve(fullCtx);
    } else {
      const list = intent.responses ? intent.responses(fullCtx) : [];
      resp = pick(list, intent.id);
    }
    if (resp !== undefined && resp !== null && resp !== "") {
      return { id: intent.id, response: resp, text };
    }
  }
  return { id: "unmatched", response: null, text };
}

function getConversationalResponse(rawText, config, history = []) {
  return resolveIntent(rawText, { config, history });
}

function getNamedFallback() {
  return pick(FALLBACK_NAMED);
}

// Confirmación / cancelación para comandos que requieren OK (apagar, reiniciar).
function isConfirmText(rawText, config) {
  let t = normalize(rawText);
  const m = findWakeMatch(t, config || { name: "noxis" });
  if (m) t = tokensOf(t).slice(m.index + 1).join(" ");
  if (/(es correcto|dale con eso|adelante con|confirmo|confirmado|confirmalo|confirmar)/.test(t)) return true;
  return /^(confirma|si|dale|ok|okay|adelante|correcto|listo|procede|aprovado|afirmativo)\b/.test(t);
}

function isCancelText(rawText, config) {
  let t = normalize(rawText);
  const m = findWakeMatch(t, config || { name: "noxis" });
  if (m) t = tokensOf(t).slice(m.index + 1).join(" ");
  return /^(no|cancela|cancelar|negativo|pare|para|detente|abortar|aborta|anular)\b/.test(t);
}

// =========================================================
// Gramática para Vosk
// =========================================================

const GRAMMAR_BASE = [
  // saludos / despedidas
  "hola", "buenas", "buenos", "dias", "tardes", "noches", "chao", "adios",
  "gracias", "hasta", "luego", "pronto", "vemos", "nos",
  // conversación
  "como", "estas", "andas", "vas", "que", "cuentas", "todo", "bien", "quien",
  "eres", "sos", "sois", "puedes", "puedo", "hacer", "haces", "ayuda",
  "ayudame", "funcionas", "nombre", "mascota", "soy", "dime", "necesitas",
  "escucho", "aqui", "estoy", "cuando", "quieras", "nada", "de", "va", "muy",
  "te", "yo", "si", "claro", "vale", "perfecto", "cual", "eso", "otra",
  // abrir
  "abre", "abrir", "abri", "abreme", "abrieme", "abrirme", "aplicaciones",
  "apps", "un", "una", "el", "la", "y",
  // cerrar
  "cierra", "cerrar", "cierrame", "cerrame", "cerra", "cierre",
  "mata", "matar", "termina", "terminar", "finaliza", "finalizar",
  // desactivar / dormir
  "desactivar", "desactiva", "desactivame", "desactivate", "apagar", "apaga",
  "apagate", "dormir", "duerme", "duermete", "detente", "descansa", "deja",
  "escuchar", "vuelve", "despierta", "hablar", "oye", "espera", "apaga",
  // conectores
  "a", "con", "para", "por", "en", "se", "lo", "al", "del", "e", "o", "u",

  // ---- Nuevas intenciones ----
  "recuerdame", "recordame", "ponme", "avisame", "recordatorio", "recordatorios",
  "cambia", "activa", "aplica", "silencia", "silenciar", "bloquea", "bloquear",
  "reinicia", "reiniciar", "suspende", "suspender", "sube", "baja", "vacia",
  "muevete", "ocultate", "escondete", "muestrate", "aparece", "desaparece",
  "calcula", "cuanto", "hora", "fecha", "dia", "chiste", "chistes", "dado",
  "moneda", "numero", "aleatorio", "azhar", "lanzar",
  // temas
  "oscuro", "claro", "bosque", "verde", "medianoche", "noche", "obsidiana",
  "morado", "atardecer", "naranja", "rosa", "oceano", "azul", "tema", "color",
  // esquinas
  "superior", "inferior", "izquierda", "derecha", "esquina", "arriba", "abajo",
  // tiempo
  "minuto", "minutos", "segundo", "segundos", "hora", "horas",
  // sistema
  "volumen", "audio", "pantalla", "papelera", "explorador", "tareas",
  "administrador", "computadora", "computador", "equipo", "suspension",
  // carpetas y archivos
  "carpeta", "carpetas", "directorio", "directorios", "carpetita",
  "descargas", "descarga", "documentos", "documento", "escritorio",
  "imagenes", "imagen", "fotos", "foto", "musica", "videos", "archivo",
  "archivos", "apunte", "apuntes", "nota", "notas", "crear", "crea",
  "creame", "hazme", "haceme", "lee", "leer", "leeme", "escribir",
  "escribe", "llamada", "llamado", "llame",
  // captura y vision
  "captura", "capturas", "screenshot", "pantallazo", "monitor", "screen",
  "toma", "saca", "mirame", "mira", "observa", "describeme", "describe",
  "pasando",
  // IA local
  "ia", "idea", "ideas", "sugerencia", "recomendacion", "recomiendas",
  "sugieres", "aconsejas", "consejo", "preguntale", "preguntale", "habla",
  "conecta", "prende", "analiza", "analizame", "copia", "copiame", "copiar",
  "guarda", "guardame", "guardar", "portapapeles", "clipboard", "explica",
  "explicame", "explicar", "explicalo", "simple", "sencillo", "facil",
  "resume", "resumime", "resumi", "resumir", "resumen", "traduce",
  "traducime", "traducir", "traduci", "ingles", "espanol", "escribe",
  "escribime", "redacta", "redactame", "organiza", "organizame", "planea",
  "planifica", "actua", "comportate", "imagen", "archivo", "documento",
  "notas", "funciona", "uso", "usar", "ollama", "inteligencia", "respuesta",
  // búsqueda web
  "googlea", "googlealo", "google", "busca", "buscame", "buscar", "web",
  "navegador", "internet", "informacion",
  // cháchara / personalidad
  "contame", "hablame", "sos", "real", "hambre", "frio", "sentis",
  "triste", "feliz", "contento", "contenta", "cansado", "estresado",
  "aburrido", "nervioso", "ansioso", "confundido", "decaido", "enojada",
  // exclusión de pack
  "solo", "sin", "excepto", "saltando",
  // confirmación
  "confirma", "confirmar", "correcto", "negativo", "cancela", "adelante", "dale",
  // clima
  "clima", "temperatura", "tiempo", "exterior",
  // cálculo
  "mas", "menos", "dividido", "multiplicado", "es", "cuanto"
];

function buildGrammar(config) {
  const words = new Set(GRAMMAR_BASE);


  for (const v of wakeWordVariants(config)) {
    for (const w of v.split(/\s+/)) words.add(w);
  }

  const addKeywords = (list) => {
    for (const item of list || []) {
      for (const kw of [item.keyword, item.name]) {
        if (!kw) continue;
        for (const w of String(kw).toLowerCase().split(/\s+/).filter(Boolean)) {
          if (w.length >= 2) words.add(w);
        }
      }
    }
  };
  addKeywords(config.apps);
  addKeywords(config.packs);

  // Alias de voz también entran a la gramática
  for (const alias of config.aliases || []) {
    for (const kw of [alias.from, alias.to]) {
      if (!kw) continue;
      for (const w of String(kw).toLowerCase().split(/\s+/).filter(Boolean)) {
        if (w.length >= 2) words.add(w);
      }
    }
  }

  return [...words].filter(Boolean);
}

module.exports = {
  normalize,
  getWakeWord,
  wakeWordVariants,
  isWakeWordDetected,
  stripWakeWord,
  isDeactivateCommand,
  isWakeCommand,
  getWakeResponse,
  getConversationalResponse,
  resolveIntent,
  resolveIntentDetailed,
  getTimeOfDay,
  getNamedFallback,
  isConfirmText,
  isCancelText,
  buildGrammar,
  editDistance,
  fuzzyClose,
  tokensOf
};