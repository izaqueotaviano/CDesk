import { useState } from 'react'
import {
  useAgentes,
  useEncerrarChat,
  useMotivosEncerramento,
  useReabrirChat,
  useTransferirChat,
  type Chat,
} from '@/api/chat'
import { ApiError } from '@/api/client'

/**
 * As ações de ciclo de vida do atendimento — transferir, encerrar, reabrir —
 * em UM lugar só, usadas pelo console e pelo mini chat.
 *
 * O brief pede isso explicitamente ("reutilize os componentes, serviços e
 * regras do chat principal para evitar diferenças de comportamento"), e é o
 * que evita o defeito clássico deste tipo de tela: o mini chat encerrando sem
 * pedir motivo porque ninguém lembrou de copiar a regra para lá.
 *
 * A regra de verdade continua no BACKEND (o serviço recusa transferir para
 * agente no limite, encerrar duas vezes, encerrar sem observação num motivo
 * que a exige). O que mora aqui é só o formulário e a mensagem de erro.
 */

export function mensagemDe(e: unknown, padrao: string): string {
  return e instanceof ApiError
    ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0] ?? padrao)
    : padrao
}

/** Estado e mutations das três ações — o que as duas telas compartilham. */
export function useAcoesAtendimento(chatId: number) {
  const transferir = useTransferirChat(chatId)
  const encerrar = useEncerrarChat(chatId)
  const reabrir = useReabrirChat(chatId)
  const [erro, setErro] = useState<string | null>(null)

  return {
    transferir,
    encerrar,
    reabrir,
    erro,
    setErro,
    ocupado: transferir.isPending || encerrar.isPending || reabrir.isPending,
  }
}

/**
 * Transferir: para quem, com observação interna e confirmação.
 *
 * A lista mostra a DISPONIBILIDADE de cada agente (o `presence` que a API já
 * devolve) porque transferir para quem está offline é o erro que a tela
 * consegue evitar antes de acontecer. Não bloqueia: às vezes é exatamente o
 * que se quer (a pessoa volta em dez minutos) — informa e deixa decidir.
 */
export function FormTransferir({
  chat,
  onPronto,
  onCancelar,
}: {
  chat: Chat
  onPronto?: () => void
  onCancelar?: () => void
}) {
  const { data: agentes } = useAgentes()
  const { transferir, erro, setErro, ocupado } = useAcoesAtendimento(chat.id)
  const [agenteId, setAgenteId] = useState('')
  const [nota, setNota] = useState('')
  const [busca, setBusca] = useState('')

  const disponiveis = (agentes ?? [])
    .filter((a) => a.id !== chat.agent_id)
    .filter((a) => a.full_name.toLowerCase().includes(busca.trim().toLowerCase()))

  function confirmar() {
    if (!agenteId) return
    setErro(null)
    transferir.mutate(
      { agent_id: Number(agenteId), note: nota },
      {
        onSuccess: () => onPronto?.(),
        onError: (e) => setErro(mensagemDe(e, 'Não foi possível transferir.')),
      },
    )
  }

  return (
    <div className="cc-acao">
      <label htmlFor={`tr-busca-${chat.id}`}>Procurar agente</label>
      <input
        id={`tr-busca-${chat.id}`}
        type="search"
        value={busca}
        placeholder="Nome do agente"
        onChange={(e) => setBusca(e.target.value)}
      />

      <label htmlFor={`tr-agente-${chat.id}`}>Para quem</label>
      <select
        id={`tr-agente-${chat.id}`}
        value={agenteId}
        onChange={(e) => setAgenteId(e.target.value)}
        size={Math.min(5, Math.max(2, disponiveis.length))}
      >
        {disponiveis.length === 0 && <option value="">Nenhum agente encontrado</option>}
        {disponiveis.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name}
            {a.presence === 'available'
              ? ' · disponível'
              : a.presence === 'away'
                ? ' · ausente'
                : ' · offline'}
          </option>
        ))}
      </select>

      <label htmlFor={`tr-nota-${chat.id}`}>Observação interna (opcional)</label>
      <textarea
        id={`tr-nota-${chat.id}`}
        rows={2}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="O que quem receber precisa saber"
      />
      <p className="cc-acao__ajuda">
        Vai direto para o agente escolhido, sem voltar para a fila. A observação fica na
        trilha de auditoria; o cliente não a vê.
      </p>

      {erro && (
        <p className="cc-acao__erro" role="alert">
          {erro}
        </p>
      )}
      <div className="cc-acao__botoes">
        {onCancelar && (
          <button type="button" className="cc-acao__cancelar" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
        )}
        <button type="button" className="cc-acao__confirmar" disabled={!agenteId || ocupado} onClick={confirmar}>
          {transferir.isPending ? 'Transferindo…' : 'Transferir'}
        </button>
      </div>
    </div>
  )
}

/**
 * Encerrar: motivo, observação interna e a nota interna do agente.
 *
 * O motivo que exige observação desabilita o botão até ela existir — mas quem
 * recusa de verdade é o backend; isto aqui só evita a viagem.
 */
export function FormEncerrar({
  chat,
  onPronto,
  onCancelar,
}: {
  chat: Chat
  onPronto?: () => void
  onCancelar?: () => void
}) {
  const { data: motivos } = useMotivosEncerramento()
  const { encerrar, erro, setErro, ocupado } = useAcoesAtendimento(chat.id)
  const [motivoId, setMotivoId] = useState('')
  const [nota, setNota] = useState('')

  const exigeNota =
    motivoId !== '' &&
    (motivos ?? []).some((m) => m.id === Number(motivoId) && m.requires_note)

  function confirmar() {
    setErro(null)
    encerrar.mutate(
      {
        reason_id: motivoId === '' ? null : Number(motivoId),
        note: nota,
        // Nota do atendimento é do CLIENTE (avaliação em duas notas depois
        // do encerramento) — o agente não dá nota para si mesmo aqui.
      },
      {
        onSuccess: () => onPronto?.(),
        onError: (e) => setErro(mensagemDe(e, 'Não foi possível encerrar.')),
      },
    )
  }

  return (
    <div className="cc-acao">
      <label htmlFor={`en-motivo-${chat.id}`}>Motivo do encerramento</label>
      <select id={`en-motivo-${chat.id}`} value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
        <option value="">Sem motivo</option>
        {(motivos ?? [])
          .filter((m) => m.is_active)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
      </select>

      <label htmlFor={`en-nota-${chat.id}`}>
        Observação interna{exigeNota ? '' : ' (opcional)'}
      </label>
      <textarea
        id={`en-nota-${chat.id}`}
        rows={2}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder={exigeNota ? 'Este motivo pede uma explicação' : 'O que a equipe precisa saber depois'}
      />

      <p className="cc-acao__ajuda">
        Motivo e observação são internos: nada disso sai para o cliente.
      </p>

      {erro && (
        <p className="cc-acao__erro" role="alert">
          {erro}
        </p>
      )}
      <div className="cc-acao__botoes">
        {onCancelar && (
          <button type="button" className="cc-acao__cancelar" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
        )}
        <button
          type="button"
          className="cc-acao__confirmar cc-acao__confirmar--perigo"
          disabled={ocupado || (exigeNota && nota.trim() === '')}
          onClick={confirmar}
        >
          {encerrar.isPending ? 'Encerrando…' : 'Encerrar conversa'}
        </button>
      </div>
    </div>
  )
}

/**
 * Reabrir: por quê. O motivo é interno e entra na auditoria — "quem reabriu e
 * por quê" é a pergunta que aparece semanas depois, quando ninguém lembra.
 */
export function FormReabrir({
  chat,
  onPronto,
  onCancelar,
}: {
  chat: Chat
  onPronto?: () => void
  onCancelar?: () => void
}) {
  const { reabrir, erro, setErro, ocupado } = useAcoesAtendimento(chat.id)
  const [nota, setNota] = useState('')

  function confirmar() {
    setErro(null)
    reabrir.mutate(nota, {
      onSuccess: () => onPronto?.(),
      onError: (e) => setErro(mensagemDe(e, 'Não foi possível reabrir.')),
    })
  }

  return (
    <div className="cc-acao">
      <label htmlFor={`re-nota-${chat.id}`}>Motivo da reabertura (opcional)</label>
      <textarea
        id={`re-nota-${chat.id}`}
        rows={2}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Por que a conversa volta a ficar aberta"
      />
      <p className="cc-acao__ajuda">
        A conversa volta para a fila com todo o histórico. O protocolo é o mesmo, e a
        reabertura fica contada no atendimento.
      </p>

      {erro && (
        <p className="cc-acao__erro" role="alert">
          {erro}
        </p>
      )}
      <div className="cc-acao__botoes">
        {onCancelar && (
          <button type="button" className="cc-acao__cancelar" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
        )}
        <button type="button" className="cc-acao__confirmar" disabled={ocupado} onClick={confirmar}>
          {reabrir.isPending ? 'Reabrindo…' : 'Reabrir conversa'}
        </button>
      </div>
    </div>
  )
}
