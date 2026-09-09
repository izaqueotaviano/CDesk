import { useState } from 'react'
import {
  useAgentes,
  useFinalizados,
  useMotivosEncerramento,
  type Chat,
  type FiltrosFinalizados,
} from '@/api/chat'
import { identidadeDe } from '@/ui/identidade'
import { dataHoraDe, iniciais } from './format'

/**
 * A lista de atendimentos ENCERRADOS (item 2 do brief).
 *
 * Lista à parte da fila de propósito: encerrado não some, mas também não pode
 * voltar a disputar atenção com quem está esperando agora. Quem seleciona
 * abre o atendimento no mesmo painel de sempre — em modo de leitura, porque
 * `can_send` do backend já recusa mensagem em chat fechado.
 *
 * Todo recorte é do SERVIDOR (`?agent=`, `?reason=`, `?rating=`, período,
 * ordenação): filtrar no navegador só funcionaria na página que já baixou, e
 * a lista de finalizados cresce para sempre.
 */
export function Finalizados({
  selecionado,
  onSelecionar,
}: {
  selecionado: number | null
  onSelecionar: (id: number) => void
}) {
  const [filtros, setFiltros] = useState<FiltrosFinalizados>({ ordering: 'recentes' })
  const [busca, setBusca] = useState('')
  const [abertos, setAbertos] = useState(false)

  const { data: motivos } = useMotivosEncerramento()
  const { data: agentes } = useAgentes()
  const { data, isLoading, isError, refetch } = useFinalizados(filtros)

  function mudar<K extends keyof FiltrosFinalizados>(campo: K, valor: FiltrosFinalizados[K]) {
    setFiltros((f) => ({ ...f, [campo]: valor || null }))
  }

  const temFiltro =
    Boolean(filtros.q) ||
    Boolean(filtros.agent) ||
    Boolean(filtros.reason) ||
    Boolean(filtros.rating) ||
    Boolean(filtros.desde) ||
    Boolean(filtros.ate)

  return (
    <section className="cc-lista__secao cc-final" aria-label="Atendimentos finalizados">
      <header className="cc-lista__cabecalho">
        <h2>Finalizados</h2>
        <button
          type="button"
          className={'cc-final__filtro-toggle' + (temFiltro ? ' cc-final__filtro-toggle--ativo' : '')}
          aria-expanded={abertos}
          onClick={() => setAbertos((v) => !v)}
        >
          <i className="ti ti-filter" aria-hidden="true" /> Filtros
        </button>
      </header>

      <form
        className="cc-final__busca"
        onSubmit={(e) => {
          e.preventDefault()
          mudar('q', busca)
        }}
        role="search"
      >
        <label className="cc-visualmente-oculto" htmlFor="cc-final-q">
          Buscar em finalizados
        </label>
        <input
          id="cc-final-q"
          type="search"
          value={busca}
          placeholder="Nome, telefone, protocolo ou mensagem"
          onChange={(e) => setBusca(e.target.value)}
        />
        <button type="submit">Buscar</button>
      </form>

      {abertos && (
        <div className="cc-final__filtros">
          <label htmlFor="cc-final-agente">Agente</label>
          <select
            id="cc-final-agente"
            value={filtros.agent ?? ''}
            onChange={(e) => mudar('agent', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos</option>
            {(agentes ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>

          <label htmlFor="cc-final-motivo">Motivo</label>
          <select
            id="cc-final-motivo"
            value={filtros.reason ?? ''}
            onChange={(e) => mudar('reason', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos</option>
            {(motivos ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <label htmlFor="cc-final-nota">Avaliação</label>
          <select
            id="cc-final-nota"
            value={filtros.rating ?? ''}
            onChange={(e) => mudar('rating', e.target.value || null)}
          >
            <option value="">Qualquer</option>
            <option value="sem">Sem avaliação</option>
            <option value="9">9 ou mais</option>
            <option value="7">7 ou mais</option>
            <option value="0">Qualquer nota</option>
          </select>

          <label htmlFor="cc-final-desde">Encerrado de</label>
          <input
            id="cc-final-desde"
            type="date"
            value={filtros.desde ?? ''}
            onChange={(e) => mudar('desde', e.target.value || null)}
          />

          <label htmlFor="cc-final-ate">até</label>
          <input
            id="cc-final-ate"
            type="date"
            value={filtros.ate ?? ''}
            onChange={(e) => mudar('ate', e.target.value || null)}
          />

          <label htmlFor="cc-final-ordem">Ordenar por</label>
          <select
            id="cc-final-ordem"
            value={filtros.ordering ?? 'recentes'}
            onChange={(e) => mudar('ordering', e.target.value)}
          >
            <option value="recentes">Mais recentes</option>
            <option value="antigos">Mais antigos</option>
            <option value="duracao">Maior duração</option>
            <option value="duracao_asc">Menor duração</option>
            <option value="espera">Maior espera</option>
            <option value="nota">Maior nota</option>
            <option value="nota_asc">Menor nota</option>
          </select>

          <button
            type="button"
            className="cc-final__limpar"
            onClick={() => {
              setFiltros({ ordering: 'recentes' })
              setBusca('')
            }}
          >
            Limpar filtros
          </button>
        </div>
      )}

      {isLoading && <p className="cc-lista__vazio">Carregando…</p>}
      {isError && (
        <p className="cc-lista__erro">
          Não foi possível carregar.{' '}
          <button type="button" className="cc-link" onClick={() => void refetch()}>
            Tentar de novo
          </button>
        </p>
      )}
      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="cc-lista__vazio">
          {temFiltro ? 'Nada encontrado com esses filtros.' : 'Nenhum atendimento encerrado ainda.'}
        </p>
      )}

      {(data ?? []).map((c) => (
        <CardFinalizado
          key={c.id}
          chat={c}
          ativo={selecionado === c.id}
          onSelecionar={() => onSelecionar(c.id)}
        />
      ))}
    </section>
  )
}

/** Um encerrado na lista: quem, quando, por quê e com que nota — o suficiente
 *  para decidir abrir sem precisar entrar em cada um. */
function CardFinalizado({
  chat,
  ativo,
  onSelecionar,
}: {
  chat: Chat
  ativo: boolean
  onSelecionar: () => void
}) {
  return (
    <button
      type="button"
      className={'cc-card cc-card--final' + (ativo ? ' cc-card--ativo' : '')}
      onClick={onSelecionar}
    >
      <span className="cc-card__avatar" {...identidadeDe(chat.client_name)}>
        {iniciais(chat.client_name)}
      </span>
      <span className="cc-card__texto">
        <span className="cc-card__nome">
          {chat.client_name}
          <span className="cc-card__protocolo">#{chat.id}</span>
        </span>
        <span className="cc-card__meta">
          {chat.company_name} · {dataHoraDe(chat.closed_at)}
        </span>
        {chat.last_message_preview && (
          <span className="cc-card__preview">{chat.last_message_preview}</span>
        )}
        <span className="cc-card__desfecho">
          {chat.close_reason_name && (
            <span className="cc-card__motivo">{chat.close_reason_name}</span>
          )}
          <span className="cc-card__agente">
            {chat.closed_automatically ? 'automático' : (chat.agent_name ?? 'sem agente')}
          </span>
          {/* nota do cliente: número E rótulo, nunca só a cor (item 22) */}
          {chat.rating ? (
            <span className="cc-card__nota" title="Avaliação do cliente (atendimento)">
              <i className="ti ti-star" aria-hidden="true" /> {chat.rating.service_score}
            </span>
          ) : (
            <span className="cc-card__nota cc-card__nota--vazia">sem avaliação</span>
          )}
        </span>
      </span>
    </button>
  )
}
