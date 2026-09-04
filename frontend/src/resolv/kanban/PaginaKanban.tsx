import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Cartao } from './Cartao'
import { Coluna } from './Coluna'
import { ModalFecharTicket } from './ModalFecharTicket'
import {
  useApagarLane,
  useCriarLane,
  useDefinirPrazo,
  useFecharTicket,
  usePlace,
  useQuadroMontado,
  useQuadros,
} from './dados'
import type { Cartao as CartaoTipo } from './tipos'
import './kanban.scss'

const AGRUPAR = 'status' as const // única lente hoje — ver nota no README da pasta

/**
 * Anúncios em português para leitor de tela — o padrão do dnd-kit já
 * cobre pega/move/solta/cancela sozinho, só que em inglês; o resto do
 * app inteiro fala português, e isto é o que uma pessoa usando teclado +
 * leitor de tela de fato ouve a cada tecla.
 */
function anuncios(nomeDoCartao: (id: number) => string, nomeDaColuna: (key: string) => string) {
  const idDoTicket = (id: string | number) => Number(String(id).replace('ticket-', ''))
  return {
    onDragStart: ({ active }: { active: { id: string | number } }) =>
      `Pegou o chamado ${nomeDoCartao(idDoTicket(active.id))}. Use as setas para mover entre colunas, espaço para soltar, Esc para cancelar.`,
    onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over
        ? `Chamado ${nomeDoCartao(idDoTicket(active.id))} sobre a coluna ${nomeDaColuna(String(over.id))}.`
        : `Chamado ${nomeDoCartao(idDoTicket(active.id))} fora de qualquer coluna.`,
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over
        ? `Chamado ${nomeDoCartao(idDoTicket(active.id))} solto na coluna ${nomeDaColuna(String(over.id))}.`
        : `Movimento cancelado — o chamado ${nomeDoCartao(idDoTicket(active.id))} voltou ao lugar.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `Movimento cancelado — o chamado ${nomeDoCartao(idDoTicket(active.id))} voltou ao lugar.`,
  }
}

export function PaginaKanban() {
  const navigate = useNavigate()
  const { data: quadros, isLoading: carregandoQuadros } = useQuadros()
  const [boardId, setBoardId] = useState<number | null>(null)
  const quadroAtivo = boardId ?? quadros?.[0]?.id ?? null

  const { data: quadro, isLoading, isError, refetch } = useQuadroMontado(quadroAtivo, AGRUPAR)
  const place = usePlace(AGRUPAR)
  const definirPrazo = useDefinirPrazo(AGRUPAR)
  const criarLane = useCriarLane(quadroAtivo, AGRUPAR)
  const apagarLane = useApagarLane(quadroAtivo, AGRUPAR)
  const fecharTicket = useFecharTicket(quadroAtivo, AGRUPAR)

  const [arrastandoId, setArrastandoId] = useState<number | null>(null)
  const [paraFechar, setParaFechar] = useState<CartaoTipo | null>(null)
  const [novaColuna, setNovaColuna] = useState(false)
  const [nomeNovaColuna, setNomeNovaColuna] = useState('')

  const sensors = useSensors(
    // distância mínima antes de virar arraste: sem isso, todo clique no
    // card (inclusive o que abre o ticket) seria interpretado como um
    // drag de zero pixels e nunca navegaria a lugar nenhum
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const cartoesPorColuna = useMemo(() => {
    const mapa = new Map<string, CartaoTipo[]>()
    for (const c of quadro?.entries ?? []) {
      const lista = mapa.get(c.column) ?? []
      lista.push(c)
      mapa.set(c.column, lista)
    }
    return mapa
  }, [quadro])

  const cartaoArrastando = quadro?.entries.find((c) => c.ticket === arrastandoId) ?? null

  function nomeDoCartao(ticketId: number): string {
    return quadro?.entries.find((c) => c.ticket === ticketId)?.ticket_reference ?? `#${ticketId}`
  }

  function nomeDaColuna(key: string): string {
    return quadro?.columns.find((c) => c.key === key)?.name ?? key
  }

  function onDragStart(e: DragStartEvent) {
    setArrastandoId(Number(String(e.active.id).replace('ticket-', '')))
  }

  async function onDragEnd(e: DragEndEvent) {
    setArrastandoId(null)
    const { active, over } = e
    if (!over || quadroAtivo == null) return

    const ticketId = Number(String(active.id).replace('ticket-', ''))
    const cartao = quadro?.entries.find((c) => c.ticket === ticketId)
    if (!cartao || cartao.column === over.id) return // soltou na mesma coluna: nada a fazer

    const coluna = quadro?.columns.find((c) => c.key === over.id)
    if (!coluna) return

    try {
      await place.mutateAsync({
        boardId: quadroAtivo,
        ticket_id: ticketId,
        ...(coluna.kind === 'lane' ? { lane_id: coluna.lane! } : { stage_id: coluna.stage! }),
      })
    } catch (err) {
      // 409 + close_dialog_required: a coluna de destino fecha o chamado, e
      // fechar exige as datas de solução (D4) — o quadro nunca fecha
      // sozinho, então abre o formulário em vez de aceitar o arraste.
      if (err instanceof ApiError && err.status === 409 && err.code === 'close_dialog_required') {
        setParaFechar(cartao)
        return
      }
      // qualquer outra recusa (equipe interna, coluna de outro quadro etc.)
      // — o card só volta pro lugar; a tela não tem onde exibir o motivo
      // sem um toast, que este diretório ainda não usa
      console.error(err)
    }
  }

  async function confirmarFechamento(dados: { resolution_started_at: string; resolution_ended_at: string; note: string }) {
    if (!paraFechar) return
    await fecharTicket.mutateAsync({ ticketId: paraFechar.ticket, ...dados })
    setParaFechar(null)
  }

  function criarColuna() {
    if (!nomeNovaColuna.trim()) return
    criarLane.mutate(nomeNovaColuna.trim(), {
      onSuccess: () => {
        setNomeNovaColuna('')
        setNovaColuna(false)
      },
    })
  }

  if (carregandoQuadros || (quadroAtivo != null && isLoading)) {
    return (
      <div className="kb-pagina kb-pagina--estado">
        <i className="ri-loader-4-line kb-spin" />
        <p>Carregando quadro…</p>
      </div>
    )
  }

  if (!carregandoQuadros && quadros?.length === 0) {
    return (
      <div className="kb-pagina kb-pagina--estado">
        <i className="ri-layout-grid-line" />
        <p>Nenhum quadro cadastrado ainda.</p>
      </div>
    )
  }

  if (isError || !quadro) {
    return (
      <div className="kb-pagina kb-pagina--estado kb-pagina--erro">
        <i className="ri-error-warning-line" />
        <p>Não foi possível carregar o quadro.</p>
        <button type="button" onClick={() => refetch()}>
          Tentar de novo
        </button>
      </div>
    )
  }

  return (
    <div className="kb-pagina">
      <header className="kb-pagina__header">
        <div>
          <h1 className="kb-pagina__titulo">Quadro</h1>
          <p className="kb-pagina__subtitulo">
            A mesma fila de chamados não resolvidos, organizada por coluna — arraste para mudar o
            status, ou solte numa coluna de organização só para agrupar visualmente.
          </p>
        </div>
        {quadros && quadros.length > 1 && (
          <select
            className="kb-pagina__seletor-quadro"
            value={quadroAtivo ?? ''}
            onChange={(e) => setBoardId(Number(e.target.value))}
            aria-label="Quadro"
          >
            {quadros.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setArrastandoId(null)}
        accessibility={{ announcements: anuncios(nomeDoCartao, nomeDaColuna) }}
      >
        <div className="kb-pagina__colunas">
          {quadro.columns.map((coluna) => (
            <Coluna
              key={coluna.key}
              coluna={coluna}
              cartoes={cartoesPorColuna.get(coluna.key) ?? []}
              onAbrirTicket={(id) => navigate(`/chamados/${id}`)}
              onDefinirPrazo={(ticketId, iso) =>
                quadroAtivo != null &&
                definirPrazo.mutate({ boardId: quadroAtivo, ticketId, due_at: iso })
              }
              onApagarLane={(laneId) => {
                if (window.confirm('Apagar esta coluna? Os chamados fixados nela voltam para a coluna de status — nenhum é apagado.')) {
                  apagarLane.mutate(laneId)
                }
              }}
              idArrastando={arrastandoId}
            />
          ))}

          <div className="kb-coluna kb-coluna--nova">
            {novaColuna ? (
              <div className="kb-coluna__form-nova">
                <input
                  autoFocus
                  type="text"
                  placeholder="Nome da coluna"
                  value={nomeNovaColuna}
                  onChange={(e) => setNomeNovaColuna(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') criarColuna()
                    if (e.key === 'Escape') setNovaColuna(false)
                  }}
                />
                <div className="kb-coluna__form-nova-acoes">
                  <button type="button" onClick={criarColuna} disabled={criarLane.isPending}>
                    Criar
                  </button>
                  <button type="button" onClick={() => setNovaColuna(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="kb-coluna__nova-botao" onClick={() => setNovaColuna(true)}>
                <i className="ri-add-line" />
                Nova coluna de organização
              </button>
            )}
          </div>
        </div>

        <DragOverlay>
          {cartaoArrastando && (
            <Cartao cartao={cartaoArrastando} onAbrir={() => {}} onDefinirPrazo={() => {}} />
          )}
        </DragOverlay>
      </DndContext>

      <ModalFecharTicket
        // Força remontagem a cada ticket diferente: o modal só monta de
        // verdade quando `paraFechar` já existe (fica `null` a maior parte
        // do tempo), e o `useState` de inicialização preguiçosa lá dentro
        // (data de início = criação do ticket) só roda no PRIMEIRO mount —
        // sem a `key` mudando, o segundo fechamento reaproveitaria o estado
        // do primeiro ticket, ou pior, o estado vazio de quando `cartao`
        // ainda era `null`.
        key={paraFechar?.ticket}
        cartao={paraFechar}
        enviando={fecharTicket.isPending}
        onFechar={confirmarFechamento}
        onCancelar={() => setParaFechar(null)}
      />
    </div>
  )
}
