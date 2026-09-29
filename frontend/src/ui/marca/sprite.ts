// GERADO por scripts/gerar_sprite_marca.py — não edite à mão.
//
// Subset do sprite AUTORAL da Convertize (14 de 85 símbolos,
// 4.0 KB de SVG). Cada símbolo tem duas camadas: o corpo, que
// segue a cor do texto, e um detalhe `.a`, que fica a 38% e vira laranja no
// item ativo — é essa segunda camada que distingue o desenho da marca de um
// ícone de biblioteca qualquer.
//
// Pediu um símbolo novo numa tela? Rode o script; `icones.test.ts` avisa se
// esquecer.
export const NOMES_DO_SPRITE = ["analytics", "bell", "calendar", "chat", "file", "grid", "home", "moon", "search", "shield", "sliders", "sun", "tag", "users"] as const

export type NomeDeIcone = (typeof NOMES_DO_SPRITE)[number]

export const SPRITE = `<symbol id="i-analytics" viewBox="0 0 24 24"><rect x="3" y="13" width="5" height="8" rx="1.6"/><rect x="9.5" y="8.5" width="5" height="12.5" rx="1.6"/><rect class="a" x="16" y="3" width="5" height="18" rx="1.6"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 1 6 6v4.2l1.6 2.4a1 1 0 0 1-.8 1.5H5.2a1 1 0 0 1-.8-1.5L6 13.2V9a6 6 0 0 1 6-6Z"/><circle class="a" cx="12" cy="19.9" r="2.1"/></symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24"><path class="s" d="M8 3.2v3.5M16 3.2v3.5"/><path fill-rule="evenodd" d="M6.5 5.5H17.5A3.5 3.5 0 0 1 21 9V17.5A3.5 3.5 0 0 1 17.5 21H6.5A3.5 3.5 0 0 1 3 17.5V9A3.5 3.5 0 0 1 6.5 5.5ZM7.3 10.7H16.7A1.6 1.6 0 0 1 18.3 12.3V16.7A1.6 1.6 0 0 1 16.7 18.3H7.3A1.6 1.6 0 0 1 5.7 16.7V12.3A1.6 1.6 0 0 1 7.3 10.7Z"/><rect class="a" x="13.3" y="12.7" width="3.2" height="3.2" rx="0.8"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M8 3.5h9a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-6.6l-4.8 3.6a1 1 0 0 1-1.6-.8V7.5a4 4 0 0 1 4-4ZM8.6 8H15.4A1.1 1.1 0 0 1 16.5 9.1V9.1A1.1 1.1 0 0 1 15.4 10.2H8.6A1.1 1.1 0 0 1 7.5 9.1V9.1A1.1 1.1 0 0 1 8.6 8ZM8.6 11.8H11.9A1.1 1.1 0 0 1 13 12.9V12.9A1.1 1.1 0 0 1 11.9 14H8.6A1.1 1.1 0 0 1 7.5 12.9V12.9A1.1 1.1 0 0 1 8.6 11.8Z"/></symbol>
  <symbol id="i-file" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M7 2.5h5.5v5a2 2 0 0 0 2 2h5V19a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 19V5A2.5 2.5 0 0 1 7 2.5ZM9.1 13H14.9A1.1 1.1 0 0 1 16 14.1V14.1A1.1 1.1 0 0 1 14.9 15.2H9.1A1.1 1.1 0 0 1 8 14.1V14.1A1.1 1.1 0 0 1 9.1 13ZM9.1 16.6H11.9A1.1 1.1 0 0 1 13 17.7V17.7A1.1 1.1 0 0 1 11.9 18.8H9.1A1.1 1.1 0 0 1 8 17.7V17.7A1.1 1.1 0 0 1 9.1 16.6Z"/><path class="a" d="M14 2.9 19.1 8H15a1 1 0 0 1-1-1Z"/></symbol>
  <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2.2"/><rect class="a" x="13" y="3" width="8" height="8" rx="2.2"/><rect x="3" y="13" width="8" height="8" rx="2.2"/><rect x="13" y="13" width="8" height="8" rx="2.2"/></symbol>
  <symbol id="i-home" viewBox="0 0 24 24"><path d="M3.5 10.9a2 2 0 0 1 .7-1.5l6.5-5.6a2 2 0 0 1 2.6 0l6.5 5.6a2 2 0 0 1 .7 1.5V19a2 2 0 0 1-2 2h-3.9v-5.2a1.3 1.3 0 0 0-1.3-1.3h-2.6a1.3 1.3 0 0 0-1.3 1.3V21H5.5a2 2 0 0 1-2-2Z"/><rect class="a" x="10.6" y="16.4" width="2.8" height="4.6" rx="1"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/><path class="a" d="M18 2.9Q18.42 5.08 20.6 5.5Q18.42 5.92 18 8.1Q17.58 5.92 15.4 5.5Q17.58 5.08 18 2.9Z"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle class="a" cx="10.5" cy="10.5" r="4.8"/><path fill-rule="evenodd" d="M2.9 10.5A7.6 7.6 0 1 0 18.1 10.5A7.6 7.6 0 1 0 2.9 10.5ZM5.7 10.5A4.8 4.8 0 1 0 15.3 10.5A4.8 4.8 0 1 0 5.7 10.5Z"/><path class="s" stroke-width="3" d="m16.4 16.4 4.1 4.1"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M11.2 2.8a2 2 0 0 1 1.6 0l6 2.5a1.9 1.9 0 0 1 1.2 1.8V12c0 4.4-3 7.7-7.1 9.3a2.4 2.4 0 0 1-1.8 0C7 19.7 4 16.4 4 12V7.1a1.9 1.9 0 0 1 1.2-1.8ZM7.96 12.84L11 15.88L16.14 10.74L14.66 9.26L11 12.92L9.44 11.36Z"/></symbol>
  <symbol id="i-sliders" viewBox="0 0 24 24"><g class="a"><path class="s" stroke-width="2.2" d="M4 7h16M4 17h16"/></g><circle cx="15" cy="7" r="3.1"/><circle cx="9" cy="17" r="3.1"/></symbol>
  <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.6"/><path class="s a" d="M12 2.5v1.8M12 19.7v1.8M2.5 12h1.8M19.7 12h1.8M5.3 5.3l1.3 1.3M17.4 17.4l1.3 1.3M5.3 18.7l1.3-1.3M17.4 6.6l1.3-1.3"/></symbol>
  <symbol id="i-tag" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M3 5a2 2 0 0 1 2-2h6.2a2 2 0 0 1 1.4.6l8.3 8.3a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L3.6 12.6a2 2 0 0 1-.6-1.4ZM6.1 8A1.9 1.9 0 1 0 9.9 8A1.9 1.9 0 1 0 6.1 8Z"/></symbol>
  <symbol id="i-users" viewBox="0 0 24 24"><g class="a"><circle cx="16.6" cy="7.4" r="3"/><path d="M17 13.1a5.5 5.5 0 0 1 4.8 5.4 1.5 1.5 0 0 1-1.5 1.5h-2.9a8 8 0 0 0-2.6-6.6 5.4 5.4 0 0 1 2.2-.3Z"/></g><circle cx="9" cy="8" r="3.6"/><path d="M2.5 19.2A6.5 6.5 0 0 1 9 13.5a6.5 6.5 0 0 1 6.5 5.7 1.6 1.6 0 0 1-1.6 1.8H4.1a1.6 1.6 0 0 1-1.6-1.8Z"/></symbol>`
