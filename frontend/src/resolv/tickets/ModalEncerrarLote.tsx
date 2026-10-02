import { useState } from 'react'
import { Modal } from '@/cvz/components'
import type { DadosEncerrarLote } from './dados'
import { formatarDataHora } from './format'

interface Props {
  quantidade: number
  /** Abertura do ticket MAIS NOVO da seleção: o início da solução vale para
   *  todos e o backend recusa início anterior à abertura de cada um. */
  criadoMaisRecente: string
  enviando: boolean
  onEncerrar: (dados: DadosEncerrarLote) => void
  onCancelar: () => void
}

/** Valor de `<input type="datetime-local">` (fuso local, sem segundos). */
function paraCampo(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * "Encerrar" em lote. Pede o MESMO que o fechamento de um chamado só
 * (`POST /tickets/bulk-close/` usa o contrato de `close/`, D4): início e fim
 * da solução e uma nota opcional — só que valendo para todos os
 * selecionados. As regras são as do backend (`close_ticket`), no minuto:
 * abertura ≤ início ≤ fim ≤ agora.
 */
export function ModalEncerrarLote({
  quantidade,
  criadoMaisRecente,
  enviando,
  onEncerrar,
  onCancelar,
}: Props) {
  // "agora" travado na abertura — validar contra Date.now() a cada tecla é impuro.
  const [agoraMs] = useState(() => Date.now())
  const [inicio, setInicio] = useState(() => paraCampo(new Date(criadoMaisRecente).getTime()))
  const [fim, setFim] = useState(() => paraCampo(agoraMs))
  const [nota, setNota] = useState('')
  const [tocado, setTocado] = useState(false)

  const piso = new Date(criadoMaisRecente)
  piso.setSeconds(0, 0)
  const inicioData = inicio ? new Date(inicio) : null
  const fimData = fim ? new Date(fim) : null
  const erroInicio = !inicioData
    ? 'Informe quando a solução começou.'
    : inicioData < piso
      ? `Não pode ser antes de ${formatarDataHora(criadoMaisRecente)}, quando o ticket mais novo da seleção foi aberto.`
      : undefined
  const erroFim = !fimData
    ? 'Informe quando a solução terminou.'
    : inicioData && fimData < inicioData
      ? 'Não pode ser antes do início.'
      : fimData.getTime() > agoraMs + 60_000
        ? 'Não pode ser no futuro.'
        : undefined
  const invalido = Boolean(erroInicio || erroFim)
  const titulo = quantidade === 1 ? 'Encerrar 1 ticket' : `Encerrar ${quantidade} tickets`

  function confirmar() {
    setTocado(true)
    if (invalido) return
    onEncerrar({
      resolution_started_at: new Date(inicio).toISOString(),
      resolution_ended_at: new Date(fim).toISOString(),
      note: nota.trim(),
    })
  }

  return (
    <Modal
      open
      onClose={onCancelar}
      title={titulo}
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="lista-tickets__botao lista-tickets__botao--fantasma"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-encerrar-lote"
            className="lista-tickets__botao lista-tickets__botao--primario"
            disabled={enviando || (tocado && invalido)}
          >
            {enviando ? 'Encerrando…' : titulo}
          </button>
        </>
      }
    >
      <form
        id="form-encerrar-lote"
        className="lista-form"
        onSubmit={(e) => {
          e.preventDefault()
          confirmar()
        }}
      >
        <p className="lista-form__intro">
          Fechar pede o período em que a solução aconteceu. O mesmo período vale para todos os
          selecionados. Quem responder depois reabre o próprio ticket.
        </p>
        <label className="lista-form__campo">
          <span>Início da solução</span>
          <input
            type="datetime-local"
            value={inicio}
            aria-invalid={(tocado && Boolean(erroInicio)) || undefined}
            onChange={(e) => setInicio(e.target.value)}
          />
          {tocado && erroInicio && <span className="lista-form__erro">{erroInicio}</span>}
        </label>
        <label className="lista-form__campo">
          <span>Fim da solução</span>
          <input
            type="datetime-local"
            value={fim}
            aria-invalid={(tocado && Boolean(erroFim)) || undefined}
            onChange={(e) => setFim(e.target.value)}
          />
          {tocado && erroFim && <span className="lista-form__erro">{erroFim}</span>}
        </label>
        <label className="lista-form__campo">
          <span>
            Nota de fechamento <span className="lista-form__opcional">(opcional)</span>
          </span>
          <textarea
            rows={3}
            maxLength={200}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}
