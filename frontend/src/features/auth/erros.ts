import { ApiError } from '@/api/client'

/**
 * Mensagem que a pessoa consegue agir em cima, não o texto cru do DRF.
 * Compartilhada pelas telas de entrada e de senha: as quatro falam com
 * endpoints públicos que erram do mesmo jeito (limite de tentativas, rede,
 * servidor fora).
 */
export function mensagemDeErro(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  if (e.status === 429) {
    // o DRF manda "…disponível em 2573 segundos."; o axes manda o próprio
    // texto com os minutos já contados
    const segundos = Number(e.detail?.match(/(\d+) segundos?/)?.[1] ?? 0)
    if (!segundos && e.detail && /Aguarde/.test(e.detail)) return e.detail
    const minutos = Math.max(1, Math.ceil(segundos / 60))
    return `Muitas tentativas. Aguarde ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e tente de novo.`
  }
  if (e.status === 0) return e.detail ?? 'O servidor não respondeu a tempo. Tente de novo.'
  if (e.status >= 500) return 'O servidor não respondeu como esperado. Tente de novo em instantes.'
  return e.detail ?? 'Não foi possível continuar.'
}
