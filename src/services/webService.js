// src/services/webService.js
// Búsquedas web sin dependencias npm: usa net (Electron).
// - Busca respuestas cortas vía DuckDuckGo Instant Answer (JSON público, sin key).
// - Si no hay respuesta inmediata, Noxis abre Google en el navegador.

const { net } = require("electron");

const DDG_API = "https://api.duckduckgo.com/";
const GOOGLE_URL = "https://www.google.com/search?q=";

function get(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: "GET", url });
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) { try { req.abort(); } catch (e) {} reject(new Error("timeout")); }
    }, 15000);
    let body = "";
    req.on("response", (res) => {
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        settled = true;
        clearTimeout(t);
        if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
        resolve(body);
      });
      res.on("error", (err) => { settled = true; clearTimeout(t); reject(err); });
    });
    req.on("error", (err) => { settled = true; clearTimeout(t); reject(err); });
    req.end();
  });
}

// Devuelve { ok, answer, source } con una respuesta corta si DuckDuckGo la tiene.
async function search(query, language) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, reason: "empty" };
  const lang = language || "es_ES";
  try {
    const raw = await get(`${DDG_API}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&kl=${encodeURIComponent(lang)}`);
    const data = JSON.parse(raw);

    if (data && data.AbstractText) {
      return { ok: true, answer: String(data.AbstractText).trim(), source: "duckduckgo" };
    }
    // Si hay subtemas (RelatedTopics) elige el primer texto útil.
    if (data && Array.isArray(data.RelatedTopics)) {
      const topic = data.RelatedTopics.find((t) => t && t.Text && !t.Topics);
      if (topic) {
        return { ok: true, answer: String(topic.Text).trim(), source: "duckduckgo" };
      }
    }
    return { ok: false, reason: "no-answer", url: searchUrl(q) };
  } catch (err) {
    return { ok: false, reason: String(err.message || "error"), url: searchUrl(q) };
  }
}

function searchUrl(query) {
  return GOOGLE_URL + encodeURIComponent(String(query || "").trim());
}

module.exports = { search, searchUrl };