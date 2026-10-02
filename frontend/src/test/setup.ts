import '@testing-library/jest-dom/vitest'

// jsdom não implementa scrollIntoView; a conversa do chat (ConversaChat,
// Conversa do portal) rola pro fim a cada mensagem nova. Stub inerte —
// nenhum teste afirma sobre rolagem.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
