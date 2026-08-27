// Noxis
// Copyright (C) 2026 Norvyz
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

// src/renderer/icons.js
// Set de iconos en línea, mismo estilo que usas en tus otros proyectos:
// viewBox 24x24, stroke-width 2, currentColor, cabos/uniones redondeados.
// Se usa tanto en HTML estático como en templates generados por JS.

(function () {
  function svg(size, inner) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }

  const NoxisIcons = {
    gear(size = 18) {
      return svg(size, `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`);
    },
    edit(size = 16) {
      return svg(size, `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`);
    },
    trash(size = 16) {
      return svg(size, `<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>`);
    },
    plus(size = 16) {
      return svg(size, `<path d="M12 5v14"/><path d="M5 12h14"/>`);
    },
    close(size = 18) {
      return svg(size, `<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`);
    },
    send(size = 18) {
      return svg(size, `<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>`);
    },
    mic(size = 16) {
      return svg(size, `<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/><path d="M9 22h6"/>`);
    },
    refresh(size = 15) {
      return svg(size, `<path d="M21 12a9 9 0 1 1-3.05-6.75"/><path d="M21 4v5h-5"/>`);
    },
    link(size = 15) {
      return svg(size, `<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>`);
    },
    chat(size = 15) {
      return svg(size, `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`);
    },
    folder(size = 16) {
      return svg(size, `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>`);
    },
    power(size = 15) {
      return svg(size, `<path d="M12 2v8"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>`);
    }
  };

  window.NoxisIcons = NoxisIcons;
})();
