import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '@/api/client'
import { assinarEventoPessoal } from '@/realtime/bridge'
import { useDigitacaoLocal, type ModoCompositor } from './canalCompositor'

/** Uma pessoa com o ticket aberto agora (apps/tickets/services/presenca.py). */
export interface PresenteTicket {
  user_id: number
  nome: string
  avatar_url: string | null
  /** O que ela está escrevendo agora; null = só vendo. */
  digitando: ModoCompositor | null
}

interface RespostaPresenca {
  presentes: PresenteTicket[]
  batimento_segundos: number
}

/** Até o servidor dizer o dele (`batimento_segundos`), o mesmo número de lá. */
const BATIMENTO_PADRAO_S = 15

const urlPresenca = (ticketId: number) => `/api/v1/tickets/${ticketId}/presenca/`

/**
 * Saídas agendadas por ticket. O "saí da tela" vai um tique DEPOIS da
 * desmontagem: se o mesmo ticket montar de novo logo em seguida (StrictMode
 * em desenvolvimento, ou a página remontando o miolo), a saída é cancelada —
 * sem isto o DELETE e o POST da remontagem corriam lado a lado e a pessoa
 * podia sumir da tela dos colegas até o próximo batimento.
 */
const saidasAgendadas = new Map<number, ReturnType<typeof setTimeout>>()

function avisarSaida(ticketId: number) {
  // keepalive: a saída que acontece fechando a aba precisa chegar mesmo com
  // a página indo embora. O erro não interessa — o TTL do servidor cobre.
  void api.delete(urlPresenca(ticketId), { keepalive: true }).catch(() => {})
}

/**
 * Presença no detalhe do ticket: quem MAIS está com ele aberto e o que está
 * fazendo. Devolve os outros (sem a própria pessoa).
 *
 * - bate ao abrir, a cada `batimento_segundos` e quando começo/paro de
 *   digitar (o estado vem do compositor, por `useDigitacaoLocal`);
 * - a lista chega na resposta de cada batimento E pelo ws/me/
 *   (`ticket_presence`) quando algum colega muda de estado — é isso que faz
 *   o "está respondendo…" aparecer na hora, não 15s depois;
 * - ao sair (desmontar, fechar a aba) avisa o servidor; se o aviso se perder,
 *   o TTL do servidor tira a pessoa sozinho;
 * - servidor que recusa (403/404: sem acesso, ou backend sem a rota) desliga
 *   a presença em silêncio — ela é ajuda, não pode virar erro na tela.
 */
export function usePresencaTicket(
  ticketId: number,
  meuId: number | undefined,
  habilitado: boolean,
): PresenteTicket[] {
  const [presentes, setPresentes] = useState<PresenteTicket[]>([])
  const [recusado, setRecusado] = useState(false)
  const digitando = useDigitacaoLocal((s) => s.porTicket[ticketId] ?? null)
  const intervaloS = useRef(BATIMENTO_PADRAO_S)
  const ativo = habilitado && !recusado

  const bater = useCallback(
    async (modo: ModoCompositor | null) => {
      try {
        const r = await api.post<RespostaPresenca>(urlPresenca(ticketId), { digitando: modo })
        intervaloS.current = r.batimento_segundos || BATIMENTO_PADRAO_S
        setPresentes(r.presentes)
      } catch (e) {
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setRecusado(true)
        // outros erros (rede, 5xx): tenta de novo no próximo batimento
      }
    },
    [ticketId],
  )

  // Batimento: imediato ao entrar e a cada mudança de "digitando"; depois,
  // periódico. Trocar o estado de digitação reinicia o intervalo — o
  // batimento que acabou de sair já vale como o de rotina.
  useEffect(() => {
    if (!ativo) return
    // O primeiro batimento sai num tique à parte (não no corpo do efeito):
    // a resposta grava estado, e quem muda de "digitando" várias vezes no
    // mesmo instante manda um batimento só.
    const primeiro = setTimeout(() => void bater(digitando), 0)
    const id = setInterval(() => void bater(digitando), intervaloS.current * 1000)
    return () => {
      clearTimeout(primeiro)
      clearInterval(id)
    }
  }, [ativo, bater, digitando])

  // Entrada/saída do ticket e a aba voltando ao primeiro plano.
  const digitandoRef = useRef(digitando)
  useEffect(() => {
    digitandoRef.current = digitando
  })
  useEffect(() => {
    if (!ativo) return
    const saida = saidasAgendadas.get(ticketId)
    if (saida !== undefined) {
      clearTimeout(saida)
      saidasAgendadas.delete(ticketId)
    }
    const aoEsconder = () => avisarSaida(ticketId)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void bater(digitandoRef.current)
    }
    window.addEventListener('pagehide', aoEsconder)
    // voltou do bfcache (a saída já tinha sido avisada no pagehide)
    window.addEventListener('pageshow', aoVoltar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.removeEventListener('pagehide', aoEsconder)
      window.removeEventListener('pageshow', aoVoltar)
      document.removeEventListener('visibilitychange', aoVoltar)
      saidasAgendadas.set(
        ticketId,
        setTimeout(() => {
          saidasAgendadas.delete(ticketId)
          avisarSaida(ticketId)
        }, 0),
      )
    }
  }, [ativo, ticketId, bater])

  useEffect(() => {
    if (!ativo) return
    return assinarEventoPessoal((evento) => {
      if (evento.type === 'ticket_presence' && evento.ticket_id === ticketId) {
        setPresentes(evento.presentes)
      }
    })
  }, [ativo, ticketId])

  if (!ativo) return []
  return presentes.filter((p) => p.user_id !== meuId)
}
