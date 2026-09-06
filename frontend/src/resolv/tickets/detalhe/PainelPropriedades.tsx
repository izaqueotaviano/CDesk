import { useId, useState, type ReactNode } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import type { Me } from '@/api/types'
// ConfirmDialog do design system em vez de um `confirm()` ou de um modal novo:
// é o padrão único de "tem certeza" da casa, e a pasta já importa cvz aqui
// (ModalFecharTicket.tsx). `useEquipes`/`useEtiquetas` são os mesmos hooks que
// a tela de abertura usa — cadastro é um só (cvz/tickets/dados.ts).
import { ConfirmDialog } from '@/cvz/components'
import { useEquipes, useEtiquetas } from '@/cvz/tickets/dados'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE } from '../format'
import type { Prioridade } from '../tipos'
import { useAcoesTicket, useAlvosMencao, useCategorias } from './dados'
import { iniciais, mensagemDeErro } from './linhaDoTempo'
import type { TicketDetalhe } from './tiposDetalhe'

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

type Mutacao = Pick<
  UseMutationResult<unknown, unknown, never, unknown>,
  'isPending' | 'isError' | 'error' | 'isSuccess'
>

/** Linha de estado embaixo do controle: "Salvando…", erro ou nada. É o que
 *  faltava — antes toda ação falhava em silêncio. */
function EstadoCampo({ m, padrao }: { m: Mutacao; padrao: string }) {
  if (m.isPending) {
    return (
      <span className="props__estado props__estado--salvando" role="status">
        <i className="ti ti-loader-2" aria-hidden="true" /> Salvando…
      </span>
    )
  }
  if (m.isError) {
    return (
      <span className="props__estado props__estado--erro" role="alert">
        {mensagemDeErro(m.error, padrao)} Nada foi alterado.
      </span>
    )
  }
  return null
}

/** Rótulo + controle + ajuda — também usado pela tela de abertura. */
export function Campo({
  rotulo,
  htmlFor,
  acao,
  children,
}: {
  rotulo: ReactNode
  htmlFor?: string
  acao?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="props__campo">
      <div className="props__rotulo-linha">
        {htmlFor ? (
          <label className="props__rotulo" htmlFor={htmlFor}>
            {rotulo}
          </label>
        ) : (
          <span className="props__rotulo">{rotulo}</span>
        )}
        {acao}
      </div>
      {children}
    </div>
  )
}

export function Seletor({
  id,
  icone,
  value,
  onChange,
  disabled,
  children,
  cor,
}: {
  id: string
  icone?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  children: ReactNode
  cor?: string
}) {
  return (
    <span className="props__seletor">
      {cor ? (
        <span className="props__cor" style={{ background: cor }} aria-hidden="true" />
      ) : icone ? (
        <i className={icone} aria-hidden="true" />
      ) : null}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
      <i className="ti ti-chevron-down props__seta" aria-hidden="true" />
    </span>
  )
}

function ValorFixo({
  icone,
  children,
  vazio,
}: {
  icone?: string
  children?: ReactNode
  vazio?: boolean
}) {
  return (
    <span className={'props__valor' + (vazio ? ' props__valor--vazio' : '')}>
      {icone && <i className={icone} aria-hidden="true" />}
      {children}
    </span>
  )
}

/**
 * Propriedades em três grupos — quem atende, como está classificado, quem
 * acompanha — em vez de uma pilha de campos sem hierarquia. Controle sem
 * permissão não aparece desabilitado: vira valor fixo (decisão do design
 * system: "o sistema tira o controle inteiro quando falta permissão").
 */
export function PainelPropriedades({ ticket, me }: { ticket: TicketDetalhe; me: Me | undefined }) {
  const idBase = useId()
  const { data: alvos } = useAlvosMencao(ticket.id)
  const { data: categorias } = useCategorias()
  const {
    data: equipes,
    isLoading: carregandoEquipes,
    isError: falhouCatalogoEquipes,
  } = useEquipes()
  const {
    data: etiquetas,
    isLoading: carregandoEtiquetas,
    isError: falhouCatalogoEtiquetas,
  } = useEtiquetas()
  const {
    atribuir,
    definirDono,
    mudarCategoria,
    mudarPrioridade,
    mudarEquipe,
    mudarEtiquetas,
    seguir,
    deixarDeSeguir,
  } = useAcoesTicket(ticket.id)

  // Equipe escolhida no seletor mas ainda NÃO confirmada. Enquanto ela existe o
  // seletor mostra o destino (senão o campo voltaria sozinho e pareceria bug) e
  // o diálogo está aberto; cancelar joga fora e o campo volta ao ticket.
  const [equipeAlvo, setEquipeAlvo] = useState<number | null>(null)

  const perms = me?.permissions ?? []
  const podeEditar = perms.includes('ticket.edit_properties')

  // mention-targets traz usuários (agentes) e equipes — para atribuir/dono só
  // interessam os usuários. Shape real: {type:'user'|'team', id, name, email}.
  const agentes = (alvos ?? []).filter((a) => a.type === 'user')
  const jaSegue = me != null && ticket.watchers.some((w) => w.id === me.id)

  function opcoesAgentes(atualId: number | null, atualNome: string | null) {
    return (
      <>
        {atualId != null && !agentes.some((a) => a.id === atualId) && (
          <option value={atualId}>{atualNome}</option>
        )}
        {agentes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </>
    )
  }

  const nomeDaEquipe = (id: number | null) =>
    (equipes ?? []).find((e) => e.id === id)?.name ??
    (id === ticket.team?.id ? ticket.team.name : '')

  const catalogoEtiquetas = etiquetas ?? []
  const idsAplicados = ticket.tags.map((t) => t.id)
  const podeEtiquetar = podeEditar && catalogoEtiquetas.length > 0

  // Por que o catálogo pode não estar disponível — carregando, falhou ou
  // ninguém cadastrou. Sem isto a pessoa com permissão veria a mesma lista
  // morta de sempre e não saberia se o problema é dela.
  /** Todo chamado tem solicitante CLIENTE (o backend recusa requester interno),
   *  e equipe interna não pode receber chamado de cliente — então ela nunca é
   *  destino válido de transferência. Omitir aqui evita a recusa que só
   *  apareceria depois da confirmação. */
  const equipesElegiveis = (equipes ?? []).filter((e) => !e.internal_only)

  /** Mesmo tratamento que as etiquetas logo abaixo: sem o cadastro, um seletor
   *  com uma opção só afirmaria "esta é a única equipe", que é falso. */
  const avisoEquipes = !podeEditar
    ? null
    : carregandoEquipes
      ? 'Carregando as equipes…'
      : falhouCatalogoEquipes
        ? 'Não foi possível carregar as equipes — dá para ver a atual, não para transferir.'
        : equipesElegiveis.length <= 1
          ? 'Não há outra equipe para onde transferir.'
          : null

  const avisoEtiquetas = !podeEditar
    ? null
    : carregandoEtiquetas
      ? 'Carregando o cadastro de etiquetas…'
      : falhouCatalogoEtiquetas
        ? 'Não foi possível carregar o cadastro de etiquetas — dá para ver as aplicadas, não para mudar.'
        : catalogoEtiquetas.length === 0
          ? 'Nenhuma etiqueta cadastrada — o cadastro fica em Configurações.'
          : 'A fila e o quadro filtram por etiqueta.'

  /** O PATCH substitui o conjunto inteiro (ver `mudarEtiquetas` em dados.ts),
   *  então ligar/desligar um chip manda a lista resultante — não um delta. */
  function alternarEtiqueta(id: number) {
    mudarEtiquetas.mutate(
      idsAplicados.includes(id) ? idsAplicados.filter((x) => x !== id) : [...idsAplicados, id],
    )
  }

  return (
    <aside className="props" aria-label="Propriedades do ticket">
      <section className="props__grupo">
        <h2 className="props__titulo">Atendimento</h2>

        {/* "Assumir" mora no cabeçalho — aqui é o seletor completo */}
        <Campo rotulo="Responsável" htmlFor={podeEditar ? `${idBase}-resp` : undefined}>
          {podeEditar ? (
            <Seletor
              id={`${idBase}-resp`}
              icone="ti ti-headset"
              value={ticket.assignee_id != null ? String(ticket.assignee_id) : ''}
              onChange={(v) => atribuir.mutate(v ? Number(v) : null)}
              disabled={atribuir.isPending}
            >
              <option value="">Sem responsável</option>
              {opcoesAgentes(ticket.assignee_id, ticket.assignee_name)}
            </Seletor>
          ) : (
            <ValorFixo icone="ti ti-headset" vazio={!ticket.assignee_name}>
              {ticket.assignee_name ?? 'Sem responsável'}
            </ValorFixo>
          )}
          <span className="props__ajuda">Fala com o cliente</span>
          <EstadoCampo m={atribuir} padrao="Não foi possível mudar o responsável." />
        </Campo>

        <Campo rotulo="Dono técnico" htmlFor={podeEditar ? `${idBase}-dono` : undefined}>
          {podeEditar ? (
            <Seletor
              id={`${idBase}-dono`}
              icone="ti ti-tool"
              value={ticket.owner_id != null ? String(ticket.owner_id) : ''}
              onChange={(v) => definirDono.mutate(v ? Number(v) : null)}
              disabled={definirDono.isPending}
            >
              <option value="">Sem dono técnico</option>
              {opcoesAgentes(ticket.owner_id, ticket.owner_name)}
            </Seletor>
          ) : (
            <ValorFixo icone="ti ti-tool" vazio={!ticket.owner_name}>
              {ticket.owner_name ?? 'Sem dono técnico'}
            </ValorFixo>
          )}
          <span className="props__ajuda">Entrega a solução</span>
          <EstadoCampo m={definirDono} padrao="Não foi possível mudar o dono técnico." />
        </Campo>

        {/* Transferir muda QUEM ENXERGA o chamado (o escopo por equipe é do
            backend), então esta é a única troca do painel que passa por
            confirmação — as outras mexem em quem trabalha, não em quem vê. */}
        <Campo rotulo="Equipe" htmlFor={podeEditar && !avisoEquipes ? `${idBase}-equipe` : undefined}>
          {podeEditar && !avisoEquipes ? (
            <Seletor
              id={`${idBase}-equipe`}
              icone="ti ti-users-group"
              value={String(equipeAlvo ?? ticket.team?.id ?? '')}
              onChange={(v) => {
                const alvo = Number(v)
                if (alvo && alvo !== ticket.team?.id) setEquipeAlvo(alvo)
              }}
              disabled={mudarEquipe.isPending}
            >
              {!ticket.team && <option value="">Sem equipe</option>}
              {ticket.team && !equipesElegiveis.some((e) => e.id === ticket.team?.id) && (
                <option value={ticket.team.id}>{ticket.team.name}</option>
              )}
              {equipesElegiveis.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Seletor>
          ) : (
            <ValorFixo icone="ti ti-users-group" vazio={!ticket.team}>
              {ticket.team?.name ?? '—'}
            </ValorFixo>
          )}
          {podeEditar && (
            <span className="props__ajuda">{avisoEquipes ?? 'Transferir muda quem enxerga'}</span>
          )}
          <EstadoCampo m={mudarEquipe} padrao="Não foi possível transferir o chamado." />
        </Campo>
      </section>

      <section className="props__grupo">
        <h2 className="props__titulo">Classificação</h2>

        <Campo rotulo="Prioridade" htmlFor={podeEditar ? `${idBase}-prio` : undefined}>
          {podeEditar ? (
            <Seletor
              id={`${idBase}-prio`}
              cor={COR_PRIORIDADE[ticket.priority]}
              value={ticket.priority}
              onChange={(v) => mudarPrioridade.mutate(v as Prioridade)}
              disabled={mudarPrioridade.isPending}
            >
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PRIORIDADE[p]}
                </option>
              ))}
            </Seletor>
          ) : (
            <ValorFixo>
              <span
                className="props__cor"
                style={{ background: COR_PRIORIDADE[ticket.priority] }}
                aria-hidden="true"
              />
              {ROTULO_PRIORIDADE[ticket.priority]}
            </ValorFixo>
          )}
          <EstadoCampo m={mudarPrioridade} padrao="Não foi possível mudar a prioridade." />
        </Campo>

        <Campo rotulo="Categoria" htmlFor={podeEditar ? `${idBase}-cat` : undefined}>
          {podeEditar ? (
            <Seletor
              id={`${idBase}-cat`}
              icone="ti ti-tag"
              value={ticket.category != null ? String(ticket.category) : ''}
              onChange={(v) => mudarCategoria.mutate(v ? Number(v) : null)}
              disabled={mudarCategoria.isPending}
            >
              <option value="">Sem categoria</option>
              {(categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Seletor>
          ) : (
            <ValorFixo icone="ti ti-tag" vazio={!ticket.category_name}>
              {ticket.category_name ?? 'Sem categoria'}
            </ValorFixo>
          )}
          {ticket.service_name && (
            <span className="props__ajuda">Serviço: {ticket.service_name}</span>
          )}
          <EstadoCampo m={mudarCategoria} padrao="Não foi possível mudar a categoria." />
        </Campo>

        {/* Etiquetar depois da abertura: o mesmo PATCH que a criação já usava
            (cvz/tickets/dados.ts), agora onde a etiqueta faz falta. Chips que
            ligam/desligam, mesmo padrão da abertura — sem confirmação, porque
            o custo de errar é um clique de volta. */}
        <Campo rotulo="Etiquetas">
          {podeEtiquetar ? (
            <ul className="props__chips" aria-label="Etiquetas">
              {catalogoEtiquetas.map((t) => {
                const ligada = idsAplicados.includes(t.id)
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={
                        'props__chip props__chip--acionavel' +
                        (ligada ? ' props__chip--ligada' : '')
                      }
                      aria-pressed={ligada}
                      disabled={mudarEtiquetas.isPending}
                      onClick={() => alternarEtiqueta(t.id)}
                    >
                      {t.color && (
                        <span
                          className="props__cor"
                          style={{ background: t.color }}
                          aria-hidden="true"
                        />
                      )}
                      {t.name}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : ticket.tags.length > 0 ? (
            <ul className="props__chips" aria-label="Etiquetas">
              {ticket.tags.map((t) => (
                <li key={t.id} className="props__chip">
                  {t.color && (
                    <span
                      className="props__cor"
                      style={{ background: t.color }}
                      aria-hidden="true"
                    />
                  )}
                  {t.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="props__vazio">Nenhuma etiqueta — as macros podem aplicar.</p>
          )}
          {avisoEtiquetas && <span className="props__ajuda">{avisoEtiquetas}</span>}
          <EstadoCampo m={mudarEtiquetas} padrao="Não foi possível salvar as etiquetas." />
        </Campo>
      </section>

      <section className="props__grupo">
        <h2 className="props__titulo">Pessoas</h2>

        <Campo rotulo="Solicitante">
          <ValorFixo icone="ti ti-user">
            <span className="props__valor-principal">{ticket.requester_display}</span>
            {ticket.company_name && <span className="props__valor-sub">{ticket.company_name}</span>}
          </ValorFixo>
        </Campo>

        <Campo
          rotulo="Seguidores"
          acao={
            me?.is_internal ? (
              <button
                type="button"
                className="props__link"
                onClick={() => (jaSegue ? deixarDeSeguir.mutate() : seguir.mutate())}
                disabled={seguir.isPending || deixarDeSeguir.isPending}
              >
                {jaSegue ? 'Deixar de seguir' : 'Seguir'}
              </button>
            ) : undefined
          }
        >
          {ticket.watchers.length > 0 ? (
            <ul className="props__chips" aria-label="Seguidores">
              {ticket.watchers.map((w) => (
                <li key={w.id} className="props__chip props__chip--pessoa">
                  <span className="props__mini-avatar" aria-hidden="true">
                    {iniciais(w.name)}
                  </span>
                  {w.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="props__vazio">
              Ninguém acompanha ainda — quem segue recebe os avisos deste ticket.
            </p>
          )}
          <EstadoCampo
            m={seguir.isError ? seguir : deixarDeSeguir}
            padrao="Não foi possível atualizar os seguidores."
          />
        </Campo>
      </section>

      {ticket.current_status_note && (
        <section className="props__grupo">
          <h2 className="props__titulo">Justificativa</h2>
          <blockquote className="props__nota">
            <i className="ti ti-quote" aria-hidden="true" />
            {ticket.current_status_note}
          </blockquote>
          <span className="props__ajuda">Registrada na última mudança de status</span>
        </section>
      )}

      {equipeAlvo != null && (
        <ConfirmDialog
          open
          onClose={() => setEquipeAlvo(null)}
          onConfirm={() =>
            // O erro fica com a mutação (a linha de estado do campo o mostra);
            // engolir aqui é só para o diálogo fechar em vez de travar com uma
            // promessa rejeitada — ConfirmDialog fecha depois do await.
            mudarEquipe.mutateAsync(equipeAlvo).then(
              () => undefined,
              () => undefined,
            )
          }
          title={`Transferir para ${nomeDaEquipe(equipeAlvo)}?`}
          description={`O chamado sai da fila de ${ticket.team?.name ?? 'nenhuma equipe'} e passa a ser visto por quem atende ${nomeDaEquipe(equipeAlvo)}. A troca fica registrada no histórico.`}
          confirmLabel="Transferir"
        />
      )}
    </aside>
  )
}
