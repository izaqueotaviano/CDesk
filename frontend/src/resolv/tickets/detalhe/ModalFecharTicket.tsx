import { useState } from 'react'
// Único import do design system cvz nesta pasta: fechar um ticket pede um
// diálogo modal de verdade (focus trap, Esc, bloqueio de scroll) — mesma
// decisão registrada em resolv/kanban/ModalFecharTicket.tsx.
import { Button, Modal } from '@/cvz/components'
import { paraDatetimeLocal, validarFechamento } from './linhaDoTempo'
import type { DadosFechamento, TicketDetalhe } from './tiposDetalhe'

interface Props {
  ticket: TicketDetalhe
  /** Recebe os dados já validados. Quem chama decide quando grava — no
   *  detalhe, com alguns segundos de "Desfazer" (useAcaoAdiada.ts); um erro
   *  do servidor chega por lá, num aviso, porque este diálogo já fechou. */
  onFechar: (dados: DadosFechamento) => void
  onCancelar: () => void
}

export function ModalFecharTicket({ ticket, onFechar, onCancelar }: Props) {
  // "agora" travado na abertura — validar contra Date.now() a cada tecla é impuro.
  const [agoraMs] = useState(() => Date.now())
  const [inicio, setInicio] = useState(() => paraDatetimeLocal(ticket.created_at))
  const [fim, setFim] = useState(() => paraDatetimeLocal(new Date(agoraMs).toISOString()))
  const [nota, setNota] = useState('')
  const [tocado, setTocado] = useState(false)

  const erros = validarFechamento({ criadoEm: ticket.created_at, inicio, fim, agoraMs })
  const invalido = Boolean(erros.inicio || erros.fim)

  function confirmar() {
    setTocado(true)
    if (invalido) return
    onFechar({
      resolution_started_at: new Date(inicio).toISOString(),
      resolution_ended_at: new Date(fim).toISOString(),
      note: nota.trim(),
    })
  }

  return (
    <Modal
      open
      onClose={onCancelar}
      title={`Fechar ${ticket.reference}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={tocado && invalido}>
            Fechar ticket
          </Button>
        </>
      }
    >
      <div className="fechar-form">
        <p className="fechar-form__intro">
          O cliente não recebe mensagem por aqui — para responder e fechar de uma vez, use o
          compositor com "Enviar e fechar". Registre o período real da solução:
        </p>

        <div className="fechar-form__campo">
          <label htmlFor="fechar-inicio">Início da solução</label>
          <input
            id="fechar-inicio"
            type="datetime-local"
            value={inicio}
            max={paraDatetimeLocal(new Date(agoraMs).toISOString())}
            onChange={(e) => setInicio(e.target.value)}
            aria-invalid={tocado && !!erros.inicio}
            aria-describedby={tocado && erros.inicio ? 'fechar-inicio-erro' : undefined}
          />
          {tocado && erros.inicio && (
            <span id="fechar-inicio-erro" className="fechar-form__erro">
              {erros.inicio}
            </span>
          )}
        </div>

        <div className="fechar-form__campo">
          <label htmlFor="fechar-fim">Fim da solução</label>
          <input
            id="fechar-fim"
            type="datetime-local"
            value={fim}
            max={paraDatetimeLocal(new Date(agoraMs).toISOString())}
            onChange={(e) => setFim(e.target.value)}
            aria-invalid={tocado && !!erros.fim}
            aria-describedby={tocado && erros.fim ? 'fechar-fim-erro' : undefined}
          />
          {tocado && erros.fim && (
            <span id="fechar-fim-erro" className="fechar-form__erro">
              {erros.fim}
            </span>
          )}
        </div>

        <div className="fechar-form__campo">
          <label htmlFor="fechar-nota">
            Justificativa{' '}
            <span className="fechar-form__opcional">(opcional, vai para o histórico)</span>
          </label>
          <textarea
            id="fechar-nota"
            rows={3}
            maxLength={200}
            value={nota}
            placeholder="Ex.: correção aplicada e validada com o cliente"
            onChange={(e) => setNota(e.target.value)}
          />
          <span className="fechar-form__contador">{nota.length}/200</span>
        </div>

        <p className="fechar-form__intro">
          Depois de fechar, você tem alguns segundos para desfazer.
        </p>
      </div>
    </Modal>
  )
}
