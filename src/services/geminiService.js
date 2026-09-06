// Gemini Service - Mejora de precisión para comandos de voz
// Trabaja JUNTO a Vosk: Vosk transcribe audio → texto, Gemini procesa texto → comando más preciso

const https = require("https");
const configService = require("./configService");

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey() {
  const config = configService.load();
  return config.geminiApiKey || null;
}

function hasKey() {
  return !!getApiKey();
}

function enhanceCommand(text) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return resolve({ ok: false, error: "No hay API key de Gemini configurada" });
    }

    const requestBody = JSON.stringify({
      contents: [{
        parts: [{
          text: `Sos un asistente de comandos de voz para un escritorio virtual. El usuario dijo algo al micrófono y el sistema de reconocimiento local lo transcribió así: "${text}".

Tu tarea es interpretar la intención del usuario y devolver un JSON con:
{
  "intent": "open_app" | "close_app" | "volume" | "create_folder" | "move_window" | "pack" | "system" | "conversation" | "unknown",
  "app": "nombre de la app si aplica",
  "value": "valor numérico si aplica (volumen, etc)",
  "corner": "top-left" | "top-right" | "bottom-left" | "bottom-right" si aplica,
  "response": "respuesta breve y natural para mostrar al usuario",
  "confidence": 0.0 a 1.0
}

Reglas:
- Si el usuario dice "abre [algo]", intent = "open_app", app = "[algo]"
- Si el usuario dice "cierra [algo]", intent = "close_app", app = "[algo]"
- Si el usuario dice "volumen al [X]%" o "sube/baja el volumen", intent = "volume", value = el porcentaje
- Si el usuario dice "crea carpeta [nombre]", intent = "create_folder"
- Si el usuario dice "mueve a [esquina]", intent = "move_window"
- Si es una conversación normal (hola, gracias, etc), intent = "conversation"
- Si no entendés nada, intent = "unknown"

Solo devolvé el JSON, sin explicaciones ni formato adicional.`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256
      }
    });

    const url = new URL(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            const text = json.candidates &&
              json.candidates[0] &&
              json.candidates[0].content &&
              json.candidates[0].content.parts &&
              json.candidates[0].content.parts[0] &&
              json.candidates[0].content.parts[0].text
              ? json.candidates[0].content.parts[0].text.trim()
              : "";
            // Try to parse the JSON response from Gemini
            try {
              const parsed = JSON.parse(text);
              resolve({ ok: true, ...parsed });
            } catch {
              // If not valid JSON, return the raw text
              resolve({ ok: true, intent: "unknown", response: text, confidence: 0.5 });
            }
          } catch (err) {
            reject(new Error("Error parseando respuesta: " + err.message));
          }
        } else if (res.statusCode === 403) {
          reject(new Error("API key sin permisos"));
        } else if (res.statusCode === 429) {
          reject(new Error("Límite de velocidad alcanzado"));
        } else {
          reject(new Error("Error HTTP " + res.statusCode));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error("Error de red: " + err.message));
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Tiempo de espera agotado"));
    });

    req.write(requestBody);
    req.end();
  });
}

function testKey(apiKey) {
  return new Promise((resolve) => {
    const url = new URL(`${GEMINI_API_BASE}/models?key=${apiKey}`);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "GET"
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve({ ok: true });
        } else if (res.statusCode === 400 || res.statusCode === 403) {
          resolve({ ok: false, error: "API key inválida o sin permisos" });
        } else {
          resolve({ ok: false, error: "HTTP " + res.statusCode });
        }
      });
    });
    req.on("error", (err) => { resolve({ ok: false, error: err.message }); });
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: "Timeout" }); });
    req.end();
  });
}

module.exports = { hasKey, getApiKey, enhanceCommand, testKey };
