import { useState } from 'react'
// Único ponto deste diretório que importa do design system cvz: soltar um
// card na coluna de conclusão precisa de um diálogo modal de verdade
// (focus trap, Esc, bloqueio de scroll) e o `resolv/` não tem um próprio —
// reconstruir isso do zero só para esta tela não valeria o risco de
// acessibilidade quebrada. O resto da tela de quadro é hand-rolled, como o
// padrão do design system Resolv.
import { Button, Modal, TextArea } from '@/cvz/components'
import { ApiError } from '@/api/client'
import type { Cartao } from './tipos'

interface Props {
  cartao: Cartao | null
  enviando: boolean
  onFechar: (dados: { resolution_started_at: string; resolution_ended_at: string; note: string }) => Promise<unknown>
  onCancelar: () => void
}

function paraDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * O quadro nunca fecha um chamado sozinho (D4): soltar numa coluna de
 * conclusão intercepta o arraste (o backend recusa com 409) e abre isto.
 * Mesmo contrato que `POST /tickets/{id}/close/` já usa — não inventa
 * regra nova, só dá uma porta pro quadro chegar até ela.
 */
export function ModalFecharTicket({ cartao, enviando, onFechar, onCancelar }: Props) {
  // Referência de "agora" travada na abertura do modal — não `Date.now()`
  // direto na validação, que recalcularia (impuro) a cada tecla digitada
  // (mesma lição já registrada em resolv/tickets/PaginaListaTickets.tsx
  // sobre `esperaEmFila`).
  const [agoraMs] = useState(() => Date.now())
  const [inicio, setInicio] = useState(() => (cartao ? paraDatetimeLocal(cartao.created_at) : ''))
  const [fim, setFim] = useState(() => paraDatetimeLocal(new Date(agoraMs).toISOString()))
  const [nota, setNota] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  if (!cartao) return null

  // `datetime-local` só tem precisão de minuto — comparar contra o instante
  // de criação COM segundos faria o próprio valor pré-preenchido (derivado
  // dele mesmo, truncado) reprovar por alguns segundos. Mesma tolerância que
  // o backend aplica (`ticket.created_at.replace(second=0, microsecond=0)`
  // em `ticket_service.py`) — sem ela, este erro nunca bateria com o que a
  // API de fato aceita.
  const criadoEm = new Date(cartao.created_at)
  criadoEm.setSeconds(0, 0)
  const inicioDate = inicio ? new Date(inicio) : null
  const fimDate = fim ? new Date(fim) : null

  const erroInicio =
    inicioDate && inicioDate < criadoEm ? 'Não pode ser antes da abertura do ticket.' : undefined
  const erroFim =
    fimDate && inicioDate && fimDate < inicioDate
      ? 'Não pode ser antes do início.'
      : fimDate && fimDate.getTime() > agoraMs + 60_000
        ? 'Não pode ser no futuro.'
        : undefined

  async function confirmar() {
    setErro(null)
    if (!inicio || !fim || erroInicio || erroFim) return
    try {
      await onFechar({
        resolution_started_at: new Date(inicio).toISOString(),
        resolution_ended_at: new Date(fim).toISOString(),
        note: nota.trim(),
      })
    } catch (e) {
      setErro(e instanceof ApiError ? (e.detail ?? 'Não foi possível fechar o ticket.') : 'Não foi possível fechar o ticket.')
    }
  }

  return (
    <Modal
      open
      onClose={onCancelar}
      title={`Fechar ${cartao.ticket_reference}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando || !inicio || !fim || !!erroInicio || !!erroFim}>
            {enviando ? 'Fechando…' : 'Fechar ticket'}
          </Button>
        </>
      }
    >
      <p className="kb-modal-fechar__intro">
        Para fechar o ticket, informe quando a solução começou e terminou, como na tela do
        ticket.
      </p>

      <div className="kb-modal-fechar__campo">
        <label htmlFor="kb-inicio">Início da solução</label>
        <input
          id="kb-inicio"
          type="datetime-local"
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
        {erroInicio && <span className="kb-modal-fechar__erro">{erroInicio}</span>}
      </div>

      <div className="kb-modal-fechar__campo">
        <label htmlFor="kb-fim">Fim da solução</label>
        <input id="kb-fim" type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
        {erroFim && <span className="kb-modal-fechar__erro">{erroFim}</span>}
      </div>

      <TextArea
        label="Nota de fechamento (opcional)"
        rows={3}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
      />

      {erro && <p className="kb-modal-fechar__erro">{erro}</p>}
    </Modal>
  )
}
