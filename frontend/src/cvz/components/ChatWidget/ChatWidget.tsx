/**
 * PORTE PARCIAL — só `fileSize`.
 *
 * No cvzdesk, `fileSize` mora no ChatWidget e o FileUpload o importa daqui
 * (`import { fileSize } from '../ChatWidget/ChatWidget'`). O ChatWidget
 * inteiro ainda não foi trazido para esta base; trazer o componente completo
 * só para obter um formatador de bytes seria desproporcional.
 *
 * O caminho e o nome do módulo são os mesmos do original de propósito: quando
 * o ChatWidget for portado de verdade, ele substitui este arquivo e o import
 * do FileUpload continua válido, sem mexer em nada.
 */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
