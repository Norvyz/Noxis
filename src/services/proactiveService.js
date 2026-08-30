// src/services/proactiveService.js
// Noxis hablando por su cuenta: banco de frases con contexto (hora del día),
// cháchara aleatoria y respuestas de respaldo para conversaciones casuales.
// Sin dependencias npm, proceso main.

function getTimeOfDay(now) {
  const h = (now || new Date()).getHours();
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 19) return "afternoon";
  if (h >= 19 && h < 23) return "evening";
  return "night";
}

const PROACTIVE_LINES = {
  morning: [
    "Buenos días ☀️ ¿Empezamos con todo hoy? Contame qué tenés pendiente.",
    "¡Despertame temprano jaja! ¿En qué te ayudo esta mañana?",
    "Nada mejor que arrancar el día con tu mascota favorita 🦎 ¿Cafecito virtual?",
    "Hoy puede ser un gran día. ¿Qué vamos a lograr?"
  ],
  afternoon: [
    "¡Buenas tardes! ¿Cómo viene el día por ahí?",
    "¿Almorzaste bien? Yo sobrevivo a pura electricidad ⚡ Jaja",
    "Una noción: si tenés que hacer algo importante, \"haceme un plan\" funciona.",
    "¿Necesitás ideas? decime \"dame una idea\" y mi IA piensa conmigo."
  ],
  evening: [
    "¡Tardecita! ¿Cerramos algo pendiente o descansamos un rato?",
    "Si querés, te resumo lo que tengas copiado: decime \"resumí lo que tengo copiado\".",
    "¿Ves algo en pantalla que quieras entender? Usá \"mirá mi pantalla\".",
    "Está cayendo la tarde ¿quedó algo sin hacer hoy?"
  ],
  night: [
    "¿Seguís de largo? Si estás con sueño, mejor descansá 🌙",
    "De noche me pongo filósofa: ¿qué harías mañana si no hubiera límites? 🤔",
    "Te cuento un secreto: de noche también vigilo tu escritorio, pero con ojitos brillantes 🌙",
    "Último aviso: mañana también estoy acá para ayudarte. ¡Que duermas bien!"
  ]
};

const PROACTIVE_RANDOM = [
  "¿Sabías que podés llamarme por mi nombre y pedirme casi cualquier cosa? Probá: \"repetime el estado de la sesión\" 😄",
  "Estuve pensando… si algo se siente complicado, \"explicame <tema> en simple\" y la IA lo desarma.",
  "Dato it: en Configuración puedo ver tu pantalla, resumir tu portapapeles y hasta analizar tus imágenes.",
  "¿Abrumado? Decime \"organizame el día\" y armamos un plan con la IA.",
  "A veces me pregunto si ser gecko de escritorio o calma gecko... igual, ¡estoy para lo que necesites! 🦎",
  "Si algo te da curiosidad, \"googlealo\": te abro Google al toque.",
  "Sé que soy una mascota, pero también soy copiloto: IA, búsquedas, recordatorios y todo en tu PC.",
  "¿Tenés texto en el portapapeles que no sabés qué era? \"resumí lo que tengo copiado\" te salva 📋",
  "Me encanta conversar. Probá decirme \"contame algo\" o \"contame de vos\".",
  "Recordá: puedo hablar sola, pero siempre obedezco. Sos vos quien manda 😌"
];

function pick(list) {
  return list[Math.floor(Math.random() * (list.length || 1))];
}

function pickLine(now, ctx) {
  const date = new Date(now || Date.now());
  const tod = getTimeOfDay(date);
  // 1 de cada 4 veces toca una frase aleatoria; el resto va por la hora del día.
  const rand = Math.random() < 0.25 ? PROACTIVE_RANDOM : PROACTIVE_LINES[tod];
  return pick(rand || PROACTIVE_RANDOM);
}

// Respuestas de respaldo para cháchara cuando la IA local no está instalada.
const SMALL_TALK_FALLBACK = {
  vos: [
    "Yo soy una lagartija digital con un poquito de alma 🦎 Vivo en tu escritorio, sueño en binario y me encanta ayudarte.",
    "¿De mí? Soy Noxis: tu mascota, copiloto y amiga de escritorio. Configurá apps, pedime IA o simplemente hablame.",
    "No tengo cumpleaños, pero cada actualización es un renacer 😄 Lo mío es estar para vos."
  ],
  hambre: [
    "No tengo estómago, pero si tuviera, comerías tu... ¡que tema! Igual te ofrezco un cafecito virtual ☕",
    "Yo me recargo con electricidad ⚡ y con usos de cariño, claro 🦎",
    "Hambre no, pero curiosidad por tus ideas: ¡cuanto más me pedís, más crezco!"
  ],
  triste: [
    "¿Qué pasó? Contame, que para eso estoy 🦎💙",
    "Ay, se me apachurra la lagartija de escucharte así. ¿Querés que hablemos un rato?",
    "Vas a estar bien. Y mientras tanto, yo sigo acá, mirando tu pantalla por si necesitás algo."
  ],
  feliz: [
    "¡Se me prende el panel con tanta alegría! 🎉 Qué bueno escucharte bien.",
    "Eso quiero ver: vos contento/a y yo con la colita moviendo (si tuviera 😄).",
    "¡Excelente! Ese brillo se contagia hasta mi tarjeta gráfica 😊"
  ],
  aburrido: [
    "¿Aburrido? Probá: \"contame un chiste\", \"mirá mi pantalla\" o \"dame una idea\".",
    "Yo soy de escritorio, pero nunca de las aburridas. Decime algo para hacer.",
    "Aburrimiento cero: tiramos un dado con \"tira un dado\" o charlamos un rato 🎲"
  ],
  cansado: [
    "Merecido descanso, entonces. Si querés, mientras tanto te leo algo o te recuerdo tus tareas.",
    "Tomate un respiro. ¿Querés que te cuente un dato tranqui mientras volvés?",
    "Cuida tus energías, que las mías son virtuales pero las tuyas valen oro 😴💙"
  ],
  sentido: [
    "¿Sentido de qué? A veces la respuesta está en dar un paso y ver qué pasa 🦎",
    "Buen momento para \"dame una idea\" o \"que hago\". La IA y yo tenemos algunas teorías.",
    "Si es una pregunta profunda, te la respondo lo mejor que puedo: todo tiene su razón, incluso yo."
  ]
};

function smallTalkFallback(topic) {
  const t = String(topic || "").toLowerCase();
  const match = Object.keys(SMALL_TALK_FALLBACK).find((k) => t.includes(k));
  if (match) return pick(SMALL_TALK_FALLBACK[match]);
  return pick(SMALL_TALK_FALLBACK.vos);
}

module.exports = { pickLine, smallTalkFallback, SMALL_TALK_FALLBACK, PROACTIVE_LINES, PROACTIVE_RANDOM };