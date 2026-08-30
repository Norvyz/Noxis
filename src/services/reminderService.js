// src/services/reminderService.js
// Gestiona recordatorios en memoria (solo duran mientras Noxis esté abierta)
// Estructura: { id, text, triggerAt: Date, fired: boolean }

const reminders = [];
let nextId = 1;

function addReminder(text, delayMinutes) {
  const minutes = Math.max(0.05, parseFloat(delayMinutes) || 1);
  const reminder = {
    id: nextId++,
    text: String(text || "recordatorio"),
    triggerAt: Date.now() + minutes * 60000,
    fired: false
  };
  reminders.push(reminder);
  return reminder.id;
}

function cancelReminder(id) {
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reminders.splice(idx, 1);
  return true;
}

function tick(onFire) {
  const now = Date.now();
  const fired = reminders.filter((r) => !r.fired && r.triggerAt <= now);
  for (const reminder of fired) {
    reminder.fired = true;
    if (typeof onFire === "function") onFire(reminder);
  }
  return fired;
}

function listPending() {
  return reminders.filter((r) => !r.fired);
}

module.exports = { addReminder, cancelReminder, tick, listPending };