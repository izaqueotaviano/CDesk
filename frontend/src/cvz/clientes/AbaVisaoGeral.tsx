import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Chat } from '@/api/chat'
import { ApiError } from '@/api/client'
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  IconChats,
  IconPlus,
  IconTicket,
  IconUser,
  IconUserPlus,
  PriorityBadge,
  Skeleton,
  SlaBadge,
  Tag,
} from '@/cvz/components'
import { ROTULO_STATUS } from '@/resolv/tickets/format'
import type { RelogioSla, TicketLinha } from '@/resolv/tickets/tipos'
import { MedidorDeUso } from './MedidorDeUso'
import {
  LINHAS_POR_BLOCO,
  useConversasDaEmpresa,
  useTicketsAbertosDaEmpresa,
  type Empresa,
  type UsuarioCliente,
} from './dados'
import {
  formatarMinutos,
  formatarQuando,
  renovacaoDoPeriodo,
  restanteDoSla,
  trechoDoPeriodo,
} from './uso'
import './detalhe-empresa.scss'

export interface AbaVisaoGeralProps {
  empresa: Empresa
  usuarios: UsuarioCliente[] | undefined
  carregandoUsuarios: boolean
  erroUsuarios: unknown
  onRecarregarUsuarios: () => void
  podeEditar: boolean
  onNovoTicket: () => void
  onVerUsuarios: () => void
  onConvidar: () => void
  onAbrirContato: (u: UsuarioCliente) => void
  onConfigurarChat: () => void
}

/**
 * "Visão geral" da empresa: o que está acontecendo com este cliente agora.
 * Antes a página abria direto no formulário de cadastro — que foi para a aba
 * "Dados" — e não mostrava nenhum ticket nem conversa.
 */
export function AbaVisaoGeral(props: AbaVisaoGeralProps) {
  const { empresa } = props
  // "Agora" de referência para as datas relativas ("hoje, 14:32"): o
  // instante em que a aba montou, não Date.now() a cada render (impuro).
  const [agora] = useState(() => new Date())

  return (
    <div className="empresa-visao">
      <div className="empresa-visao__coluna">
        <BlocoTickets empresaId={empresa.id} onNovoTicket={props.onNovoTicket} />
        <BlocoConversas
          empresaId={empresa.id}
          agora={agora}
          podeEditar={props.podeEditar}
          onConfigurarChat={props.onConfigurarChat}
        />
      </div>
      <div className="empresa-visao__coluna">
        <BlocoConsumo empresa={empresa} />
        <BlocoContatos {...props} agora={agora} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Moldura comum dos blocos
// ---------------------------------------------------------------------------

function Bloco({
  titulo,
  contagem,
  acao,
  ocupado = false,
  children,
}: {
  titulo: string
  contagem?: number
  acao?: ReactNode
  ocupado?: boolean
  children: ReactNode
}) {
  const idTitulo = useId()
  return (
    <section className="empresa-bloco" aria-labelledby={idTitulo} aria-busy={ocupado || undefined}>
      <header className="empresa-bloco__cabeca">
        <h2 id={idTitulo} className="empresa-bloco__titulo">
          {titulo}
          {contagem != null && <span className="empresa-bloco__contagem">{contagem}</span>}
        </h2>
        {acao}
      </header>
      {children}
    </section>
  )
}

/** Linhas-fantasma no formato da linha real (título + meta + coluna da
 *  direita). O texto "Carregando" fica só para leitor de tela. */
function LinhasCarregando({ comAvatar = false }: { comAvatar?: boolean }) {
  return (
    <>
      <p className="sr-only" role="status">
        Carregando…
      </p>
      <ul className="empresa-lista" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="empresa-lista__esqueleto">
            {comAvatar && <Skeleton circle width="30px" />}
            <Skeleton lines={2} />
            <span className="empresa-lista__esqueleto-lado">
              <Skeleton />
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

function mensagemDeErro(erro: unknown): string | undefined {
  return erro instanceof ApiError ? erro.detail : undefined
}

/** "a · b · c" com o separador fora da leitura em voz alta. */
function Meta({ partes }: { partes: (ReactNode | null | undefined | false)[] }) {
  const visiveis = partes.filter((p): p is ReactNode => p != null && p !== false && p !== '')
  return (
    <span className="empresa-lista__meta">
      {visiveis.map((p, i) => (
        <span key={i} className="empresa-lista__trecho">
          {i > 0 && (
            <span className="empresa-lista__sep" aria-hidden="true">
              ·{' '}
            </span>
          )}
          {p}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tickets abertos
// ---------------------------------------------------------------------------

function BlocoTickets({ empresaId, onNovoTicket }: { empresaId: number; onNovoTicket: () => void }) {
  const { data, isLoading, isError, error, refetch } = useTicketsAbertosDaEmpresa(empresaId)
  const linhas = data?.results ?? []

  return (
    <Bloco
      titulo="Tickets abertos"
      contagem={data?.count}
      ocupado={isLoading}
      acao={
        // O filtro por empresa da lista de tickets mora na URL (`?empresa=`),
        // como os demais recortes daquela tela.
        <Link className="empresa-bloco__link" to={`/tickets?empresa=${empresaId}`} aria-label="Ver todos os tickets">
          Ver todos
        </Link>
      }
    >
      {isLoading ? (
        <LinhasCarregando />
      ) : isError ? (
        <ErrorState
          title="Não foi possível carregar os tickets"
          description={mensagemDeErro(error)}
          onRetry={() => refetch()}
        />
      ) : linhas.length === 0 ? (
        <EmptyState
          Icon={IconTicket}
          title="Nenhum ticket aberto"
          description="Tudo em dia com esta empresa. Um ticket novo aparece aqui assim que for aberto."
          action={
            <Button variant="secondary" size="sm" Icon={IconPlus} onClick={onNovoTicket}>
              Abrir ticket
            </Button>
          }
        />
      ) : (
        <ul className="empresa-lista">
          {linhas.map((t) => (
            <LinhaTicket key={t.id} ticket={t} />
          ))}
        </ul>
      )}
    </Bloco>
  )
}

function LinhaTicket({ ticket: t }: { ticket: TicketLinha }) {
  // Prioridade só quando pede atenção: "Normal" e "Baixa" em toda linha eram
  // ruído que escondia as duas que importam.
  const prioridadeAlta = t.priority === 'high' || t.priority === 'urgent'
  return (
    <li>
      <Link className="empresa-lista__item" to={`/tickets/${t.id}`}>
        <span className="empresa-lista__principal">
          <span className="empresa-lista__titulo">{t.subject}</span>
          <Meta
            partes={[
              <span className="empresa-lista__ref">{t.reference}</span>,
              t.stage_name || ROTULO_STATUS[t.status],
              t.assignee_name ?? 'Sem responsável',
            ]}
          />
        </span>
        <span className="empresa-lista__lado">
          {prioridadeAlta && <PriorityBadge priority={t.priority} />}
          <SlaDoTicket sla={t.sla.resolution} />
        </span>
      </Link>
    </li>
  )
}

/** Relógio de resolução no `SlaBadge` do catálogo (contornado — a forma
 *  reservada ao SLA, para não competir com a prioridade). */
function SlaDoTicket({ sla }: { sla: RelogioSla }) {
  if (sla.state === 'breached') return <SlaBadge state="breached" />
  if (sla.state === 'at_risk') return <SlaBadge state="risk" remaining={restanteDoSla(sla.minutes_left)} />
  if (sla.state === 'ok') return <SlaBadge state="ok" remaining={restanteDoSla(sla.minutes_left)} />
  return (
    <span className="empresa-lista__vazio-sla">{sla.state === 'met' ? 'SLA cumprido' : 'Sem SLA'}</span>
  )
}

// ---------------------------------------------------------------------------
// Conversas recentes
// ---------------------------------------------------------------------------

function BlocoConversas({
  empresaId,
  agora,
  podeEditar,
  onConfigurarChat,
}: {
  empresaId: number
  agora: Date
  podeEditar: boolean
  onConfigurarChat: () => void
}) {
  const { data, isLoading, isError, error, refetch } = useConversasDaEmpresa(empresaId)
  const linhas = data?.results ?? []

  return (
    <Bloco titulo="Conversas recentes" contagem={data?.count} ocupado={isLoading}>
      {isLoading ? (
        <LinhasCarregando />
      ) : isError ? (
        <ErrorState
          title="Não foi possível carregar as conversas"
          description={mensagemDeErro(error)}
          onRetry={() => refetch()}
        />
      ) : linhas.length === 0 ? (
        <EmptyState
          Icon={IconChats}
          title="Nenhuma conversa ainda"
          description="Quando alguém desta empresa chamar no chat, a conversa aparece aqui."
          action={
            // Quem pode fazer a conversa acontecer é quem liga o chat no site
            // do cliente — o convite só faz sentido para quem administra.
            podeEditar ? (
              <Button variant="secondary" size="sm" onClick={onConfigurarChat}>
                Configurar chat embutido
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="empresa-lista">
          {linhas.map((c) => (
            <LinhaConversa key={c.id} conversa={c} agora={agora} />
          ))}
        </ul>
      )}
    </Bloco>
  )
}

const STATUS_DA_CONVERSA: Record<Chat['status'], { rotulo: string; tom: 'away' | 'success' | 'neutral' }> = {
  queued: { rotulo: 'Na fila', tom: 'away' },
  active: { rotulo: 'Em atendimento', tom: 'success' },
  closed: { rotulo: 'Encerrada', tom: 'neutral' },
}

function LinhaConversa({ conversa: c, agora }: { conversa: Chat; agora: Date }) {
  // Encerrada abre na aba Finalizados (é lá que ela está na lista); viva
  // abre direto a conversa. Os dois endereços são os que o console já lê.
  const destino = c.status === 'closed' ? `/chat?aba=finalizados&chat=${c.id}` : `/chat?chat=${c.id}`
  const status = STATUS_DA_CONVERSA[c.status]
  return (
    <li>
      <Link className="empresa-lista__item" to={destino}>
        <span className="empresa-lista__principal">
          <span className="empresa-lista__titulo">{c.client_name}</span>
          <Meta
            partes={[
              c.name || c.last_message_preview,
              c.agent_name ?? (c.status === 'queued' ? 'Aguardando atendente' : null),
              formatarQuando(c.closed_at ?? c.queued_at, agora),
            ]}
          />
        </span>
        <span className="empresa-lista__lado">
          <Tag tone={status.tom} dot>
            {status.rotulo}
          </Tag>
        </span>
      </Link>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Consumo do período
// ---------------------------------------------------------------------------

function BlocoConsumo({ empresa }: { empresa: Empresa }) {
  const cota = empresa.quota_usage
  const manutencao = empresa.maintenance_usage
  const periodo = trechoDoPeriodo(empresa.effective_period)
  const tickets = (n: number) => (n === 1 ? 'ticket' : 'tickets')

  return (
    <Bloco titulo="Consumo">
      <MedidorDeUso
        rotulo="Tickets"
        usado={cota.used}
        limite={cota.limit}
        renova={renovacaoDoPeriodo(cota.period_end)}
        descricao={
          cota.limit != null
            ? `${cota.used} de ${cota.limit} tickets ${periodo}`
            : `${cota.used} ${tickets(cota.used)} ${periodo}, sem limite`
        }
      />
      <MedidorDeUso
        rotulo="Horas de manutenção"
        usado={manutencao.used_minutes}
        limite={manutencao.limit_minutes}
        renova={renovacaoDoPeriodo(manutencao.period_end)}
        descricao={
          manutencao.limit_minutes != null
            ? `${formatarMinutos(manutencao.used_minutes)} de ${formatarMinutos(manutencao.limit_minutes)} este mês`
            : `${formatarMinutos(manutencao.used_minutes)} este mês, sem franquia`
        }
      />
    </Bloco>
  )
}

// ---------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------

/** Responsáveis primeiro (é com eles que se fala de conta), depois quem está
 *  ativo; dentro de cada grupo, a ordem do servidor (nome). */
function ordenarContatos(usuarios: UsuarioCliente[]): UsuarioCliente[] {
  const peso = (u: UsuarioCliente) => (u.client_role === 'owner' ? 0 : 1) + (u.is_active ? 0 : 2)
  return [...usuarios].sort((a, b) => peso(a) - peso(b))
}

function situacaoDoContato(u: UsuarioCliente, agora: Date): string {
  if (!u.is_active) return 'Inativo'
  if (u.invite_status === 'visitante') return 'Visitante do chat'
  if (u.invite_status === 'pendente') return 'Convite pendente'
  const quando = formatarQuando(u.last_seen_at ?? u.last_login, agora)
  return quando ? `Acessou ${quando}` : 'Nunca acessou'
}

function BlocoContatos({
  usuarios,
  carregandoUsuarios,
  erroUsuarios,
  onRecarregarUsuarios,
  podeEditar,
  onVerUsuarios,
  onConvidar,
  onAbrirContato,
  agora,
}: AbaVisaoGeralProps & { agora: Date }) {
  const todos = usuarios ?? []
  const visiveis = ordenarContatos(todos).slice(0, LINHAS_POR_BLOCO)

  return (
    <Bloco
      titulo="Contatos"
      contagem={usuarios ? todos.length : undefined}
      ocupado={carregandoUsuarios}
      acao={
        todos.length > 0 ? (
          <button type="button" className="empresa-bloco__link" onClick={onVerUsuarios} aria-label="Ver todos os usuários">
            Ver todos
          </button>
        ) : undefined
      }
    >
      {carregandoUsuarios ? (
        <LinhasCarregando comAvatar />
      ) : erroUsuarios ? (
        <ErrorState
          title="Não foi possível carregar os contatos"
          description={mensagemDeErro(erroUsuarios)}
          onRetry={onRecarregarUsuarios}
        />
      ) : todos.length === 0 ? (
        <EmptyState
          Icon={IconUser}
          title="Nenhum usuário ainda"
          description={
            podeEditar
              ? 'Convide quem vai abrir tickets por esta empresa.'
              : 'Quem abrir tickets por esta empresa aparece aqui.'
          }
          action={
            podeEditar ? (
              <Button variant="secondary" size="sm" Icon={IconUserPlus} onClick={onConvidar}>
                Convidar usuário
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="empresa-lista">
          {visiveis.map((u) => (
            <li key={u.id}>
              <button type="button" className="empresa-lista__item" onClick={() => onAbrirContato(u)}>
                {/* O nome já é o título da linha; o texto oculto do Avatar
                    faria o leitor de tela dizê-lo duas vezes. */}
                <span className="empresa-lista__avatar" aria-hidden="true">
                  <Avatar name={u.full_name} ringOn="raised" />
                </span>
                <span className="empresa-lista__principal">
                  <span className="empresa-lista__titulo">{u.full_name}</span>
                  <Meta partes={[u.client_role === 'owner' ? 'Responsável' : 'Usuário', u.job_title]} />
                </span>
                <span className="empresa-lista__lado">
                  <span className="empresa-lista__texto-lado">{situacaoDoContato(u, agora)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  )
}
