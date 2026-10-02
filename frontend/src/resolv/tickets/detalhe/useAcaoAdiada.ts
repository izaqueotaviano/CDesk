import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/cvz/components'
import { useAtalho } from '../../atalhos/useAtalhos'
import { mensagemDeErro } from './linhaDoTempo'
import type { TicketDetalhe } from './tiposDetalhe'

/** Janela do "Desfazer". Pausa enquanto o ponteiro/foco está no aviso. */
export const JANELA_DESFAZER_MS = 6_000

export interface AcaoAdiada {
  /** Título do aviso — o que aconteceu, no passado ("Ticket fechado"). */
  titulo: string
  descricao?: string
  /** Como o ticket aparece enquanto a ação espera. */
  previa: Partial<TicketDetalhe>
  /** A requisição de verdade. `keepalive` quando sai junto com a página. */
  executar: (opcoes: { keepalive: boolean }) => Promise<TicketDetalhe>
  /** Começo da mensagem se o servidor recusar ("Não foi possível fechar…"). */
  erro: string
}

interface Pendencia extends AcaoAdiada {
  estado: 'aguardando' | 'enviada' | 'desfeita'
  toastId?: string
}

/**
 * "Desfazer" em vez de "tem certeza?" — com a gravação ADIADA, não desfeita.
 *
 * Reverter um fechamento não é o contrário de fechar: é REABRIR, e reabrir
 * tem regra própria (nota obrigatória, e-mail ao cliente, ciclo novo de
 * SLA). Por isso nada vai para o servidor na hora: a tela mostra o resultado
 * (`previa`) e o aviso oferece "Desfazer" por `JANELA_DESFAZER_MS`. Desfazer
 * é só esquecer a pendência. Passado o prazo — ou fechado o aviso — a
 * requisição sai.
 *
 * A pendência nunca se perde: sai NA HORA quando a pessoa troca de ticket
 * (desmontagem), fecha ou esconde a aba (`pagehide`/`visibilitychange`, com
 * `keepalive`), ou agenda outra ação por cima. Ctrl/⌘Z desfaz enquanto o
 * aviso estiver na tela (atalho `geral.desfazer`).
 *
 * Confirmação continua existindo só onde a ação não dá para adiar nem
 * voltar — hoje, transferir de equipe (quem transfere pode perder o acesso).
 */
export function useAcaoAdiada(ticketId: number) {
  const qc = useQueryClient()
  const { push, dismiss } = useToast()
  const atual = useRef<Pendencia | null>(null)
  const [previa, setPrevia] = useState<Partial<TicketDetalhe> | null>(null)
  const montado = useRef(true)

  const enviar = useCallback(
    (p: Pendencia, keepalive: boolean) => {
      if (p.estado !== 'aguardando') return
      p.estado = 'enviada'
      if (atual.current === p) atual.current = null
      if (p.toastId) dismiss(p.toastId)
      p.executar({ keepalive }).then(
        (ticket) => {
          qc.setQueryData(['ticket', ticketId], ticket)
          void qc.invalidateQueries({ queryKey: ['tickets'] })
          if (montado.current) setPrevia((v) => (atual.current ? v : null))
        },
        (e) => {
          if (montado.current) setPrevia((v) => (atual.current ? v : null))
          void qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
          push({
            tone: 'danger',
            title: `${mensagemDeErro(e, p.erro)}`,
            description: 'Nada foi alterado no ticket.',
            duration: 10_000,
          })
        },
      )
    },
    [dismiss, push, qc, ticketId],
  )

  const desfazer = useCallback(() => {
    const p = atual.current
    if (!p || p.estado !== 'aguardando') return
    p.estado = 'desfeita'
    atual.current = null
    setPrevia(null)
    if (p.toastId) dismiss(p.toastId)
    push({ title: 'Desfeito', description: 'Nada foi enviado.', duration: 3_000 })
  }, [dismiss, push])

  const agendar = useCallback(
    (acao: AcaoAdiada) => {
      // uma de cada vez: a anterior vale a partir de agora
      if (atual.current) enviar(atual.current, false)
      const p: Pendencia = { ...acao, estado: 'aguardando' }
      atual.current = p
      setPrevia(acao.previa)
      p.toastId = push({
        tone: 'success',
        title: acao.titulo,
        description: acao.descricao,
        duration: JANELA_DESFAZER_MS,
        action: { label: 'Desfazer', onClick: desfazer },
        // prazo vencido ou aviso dispensado: grava. `action` é o Desfazer,
        // que já tratou tudo. `programmatic` sem ter sido este hook é o
        // shell inteiro saindo da tela (sessão acabou): grava com keepalive.
        onClose: (motivo) => {
          if (motivo !== 'action') enviar(p, motivo === 'programmatic')
        },
      })
    },
    [desfazer, enviar, push],
  )

  // Saída da tela ou da aba: grava agora.
  useEffect(() => {
    montado.current = true
    const sairAgora = () => {
      if (atual.current) enviar(atual.current, true)
    }
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'hidden') sairAgora()
    }
    window.addEventListener('pagehide', sairAgora)
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    return () => {
      window.removeEventListener('pagehide', sairAgora)
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      montado.current = false
      sairAgora()
    }
  }, [enviar])

  useAtalho('geral.desfazer', previa ? () => desfazer() : undefined)

  return {
    /** O que sobrepor ao ticket do servidor enquanto a ação espera. */
    previa,
    agendar,
    desfazer,
    pendente: previa !== null,
  }
}
