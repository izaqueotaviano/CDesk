import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConfigChat, useFilaChat, useMeusChats, usePegarChat, type Chat } from '@/api/chat'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { useChatUi } from '@/stores/chatUi'
import { LIMITES_MINICHAT, TAMANHOS_MINICHAT, usePrefs, type TamanhoMiniChat } from '@/stores/prefs'
import { FormEncerrar, FormReabrir, FormTransferir } from './acoes'
import { AvatarComPresenca } from './AvatarComPresenca'
import { ConversaChat } from './ConversaChat'
import { haQuanto } from './format'
import { tonsDistintos, type IndiceDeChat } from './tons'
import '../styles/tokens.scss'
import './chat.scss'
import './minichat.scss'

/** Sem config carregada ainda, o teto do backend (ChatConfig, default 3). */
const LIMITE_PADRAO = 3
/** Passo das setas no redimensionamento por teclado. */
const PASSO_TECLADO_PX = 24

const ORDEM_TAMANHOS: (keyof typeof TAMANHOS_MINICHAT)[] = ['pequeno', 'medio', 'grande']
const ROTULO_TAMANHO: Record<keyof typeof TAMANHOS_MINICHAT, string> = {
  pequeno: 'pequeno',
  medio: 'médio',
  grande: 'grande',
}

function limitar(valor: number, [min, max]: readonly [number, number]) {
  return Math.min(max, Math.max(min, Math.round(valor)))
}

/** Qual preset o tamanho atual é (ou o mais próximo, se veio do arrasto). */
function presetDe(t: TamanhoMiniChat): keyof typeof TAMANHOS_MINICHAT {
  let melhor: keyof typeof TAMANHOS_MINICHAT = 'medio'
  let menor = Infinity
  for (const nome of ORDEM_TAMANHOS) {
    const p = TAMANHOS_MINICHAT[nome]
    const d = Math.abs(p.largura - t.largura) + Math.abs(p.altura - t.altura)
    if (d < menor) {
      menor = d
      melhor = nome
    }
  }
  return melhor
}

/**
 * Um atendimento MINIMIZADO: nome do cliente, a cor do atendimento, um botão
 * de abrir maior e o marcador de mensagens novas — nada além disso. Só
 * existe pra quem NÃO está em `abertos`; quando o chat abre, esta barra some
 * e dá lugar ao painel (`PainelConversa`) — os dois nunca aparecem juntos
 * pro mesmo chat, que era a duplicação que deixava a faixa "encavalada".
 */
function BarraMinimizada({ chat, tom, onAbrir }: { chat: Chat; tom: IndiceDeChat; onAbrir: () => void }) {
  return (
    <button
      type="button"
      className="minichat__aba"
      aria-label={`Abrir conversa com ${chat.client_name}`}
      title={`${chat.client_name} · ${chat.company_name}`}
      onClick={onAbrir}
      // `--tinta-do-tom` acompanha `--tom`: quem preenche com a cor do
      // atendimento (o botão de abrir) escreve com a tinta daquele tom. Aqui
      // o par vai à mão porque a barra minimizada NÃO carrega
      // `data-tom-chat` — ela é clara, só o botão dentro dela é colorido.
      style={
        {
          '--tom': `var(--chat-tom-${tom})`,
          '--tinta-do-tom': `var(--chat-tom-${tom}-tinta)`,
        } as React.CSSProperties
      }
    >
      <AvatarComPresenca
        nome={chat.client_name}
        presenca={chat.status === 'active' ? chat.client_presence : null}
        classe="minichat__avatar"
        fundo="superficie"
        tom={tom}
      />
      <span className="minichat__aba-nome">{chat.client_name}</span>
      {chat.unread_count > 0 && <span className="minichat__badge">{chat.unread_count > 9 ? '9+' : chat.unread_count}</span>}
      {/* só o SINAL visual de "abrir" — o alvo de clique é a barra inteira
          (um botão dentro de outro não é válido); maior e preenchido na cor
          do atendimento, como o pedido descreveu. */}
      <i className="ti ti-chevron-up minichat__aba-abrir" aria-hidden="true" />
    </button>
  )
}

/**
 * Um atendimento expandido. O cabeçalho leva a COR do atendimento
 * (`data-tom-chat`, pintado em chat.scss — paleta própria do chat, 15 tons,
 * ver resolv/chat/tons.ts) — com três conversas abertas lado a lado, é a
 * cor que diz qual é qual antes do nome.
 * O canto superior esquerdo redimensiona (arrasto ou setas do teclado); o
 * botão de tamanho cicla os três presets — é a alternativa sem arrasto
 * (WCAG 2.5.7), e o tamanho é UM só para todos os painéis, guardado por
 * agente (stores/prefs).
 */
type AcaoMini = 'transferir' | 'encerrar' | 'reabrir' | null

/**
 * O menu de três pontos do painel (itens 5 e 8 do brief): as ações do console
 * dentro do mini chat, sem obrigar a pessoa a abrir a página inteira.
 *
 * Os formulários são os MESMOS do console (`./acoes`) — não uma segunda
 * versão simplificada que um dia deixa de pedir o motivo de encerramento
 * porque ninguém lembrou de copiar a regra para cá.
 */
function MenuAcoes({
  chat,
  onAbrirNoConsole,
}: {
  chat: Chat
  onAbrirNoConsole: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [acao, setAcao] = useState<AcaoMini>(null)
  const caixa = useRef<HTMLDivElement>(null)

  // fechar ao clicar fora / Esc — mesma disciplina do menu de macro do console
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        setAberto(false)
        setAcao(null)
      }
    }
    const escapar = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        setAcao(null)
      }
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', escapar)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', escapar)
    }
  }, [aberto])

  const encerrado = chat.status === 'closed'

  function fechar() {
    setAberto(false)
    setAcao(null)
  }

  return (
    <div className="minichat__menu" ref={caixa}>
      <button
        type="button"
        className="minichat__icone"
        aria-label={`Mais ações do atendimento de ${chat.client_name}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Mais ações"
        onClick={() => setAberto((v) => !v)}
      >
        <i className="ti ti-dots-vertical" />
      </button>

      {aberto && (
        <div className="minichat__menu-painel" role="menu" aria-label="Ações do atendimento">
          {acao === null ? (
            <>
              <button type="button" role="menuitem" onClick={onAbrirNoConsole}>
                <i className="ti ti-arrows-diagonal" aria-hidden="true" /> Abrir no console
              </button>
              {!encerrado && (
                <button type="button" role="menuitem" onClick={() => setAcao('transferir')}>
                  <i className="ti ti-arrows-left-right" aria-hidden="true" /> Transferir
                </button>
              )}
              {!encerrado && (
                <button type="button" role="menuitem" onClick={() => setAcao('encerrar')}>
                  <i className="ti ti-circle-x" aria-hidden="true" /> Encerrar
                </button>
              )}
              {encerrado && (
                <button type="button" role="menuitem" onClick={() => setAcao('reabrir')}>
                  <i className="ti ti-rotate-clockwise" aria-hidden="true" /> Reabrir
                </button>
              )}
              <hr />
              <p className="minichat__menu-info">
                <strong>{chat.client_name}</strong>
                <span>{chat.company_name}</span>
                {chat.client_email && <span>{chat.client_email}</span>}
                {chat.client_phone && <span>{chat.client_phone}</span>}
                <span className="minichat__menu-protocolo">Protocolo #{chat.id}</span>
              </p>
            </>
          ) : acao === 'transferir' ? (
            <FormTransferir chat={chat} onPronto={fechar} onCancelar={() => setAcao(null)} />
          ) : acao === 'encerrar' ? (
            <FormEncerrar chat={chat} onPronto={fechar} onCancelar={() => setAcao(null)} />
          ) : (
            <FormReabrir chat={chat} onPronto={fechar} onCancelar={() => setAcao(null)} />
          )}
        </div>
      )}
    </div>
  )
}

function PainelConversa({
  chat,
  tom,
  me,
  onMinimizar,
  onAbrirNoConsole,
}: {
  chat: Chat
  tom: IndiceDeChat
  me: ReturnType<typeof useMe>['data']
  onMinimizar: () => void
  onAbrirNoConsole: () => void
}) {
  const tamanho = usePrefs((s) => s.miniChat)
  const setTamanho = usePrefs((s) => s.setMiniChat)
  const preset = presetDe(tamanho)
  const proximo = ORDEM_TAMANHOS[(ORDEM_TAMANHOS.indexOf(preset) + 1) % ORDEM_TAMANHOS.length]

  function arrastar(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const alvo = e.currentTarget
    alvo.setPointerCapture(e.pointerId)
    const inicioX = e.clientX
    const inicioY = e.clientY
    // o tamanho de PARTIDA é o do store no instante do gesto, não o do render
    const { largura, altura } = usePrefs.getState().miniChat
    const mover = (ev: globalThis.PointerEvent) => {
      // painel ancorado embaixo à direita: puxar o canto pra cima/esquerda cresce
      setTamanho({
        largura: limitar(largura + (inicioX - ev.clientX), LIMITES_MINICHAT.largura),
        altura: limitar(altura + (inicioY - ev.clientY), LIMITES_MINICHAT.altura),
      })
    }
    const soltar = () => {
      alvo.removeEventListener('pointermove', mover)
      alvo.removeEventListener('pointerup', soltar)
      alvo.removeEventListener('pointercancel', soltar)
    }
    alvo.addEventListener('pointermove', mover)
    alvo.addEventListener('pointerup', soltar)
    alvo.addEventListener('pointercancel', soltar)
  }

  function teclar(e: KeyboardEvent<HTMLDivElement>) {
    const { largura, altura } = usePrefs.getState().miniChat
    const passo = PASSO_TECLADO_PX
    let novo: TamanhoMiniChat | null = null
    if (e.key === 'ArrowLeft') novo = { largura: largura + passo, altura }
    else if (e.key === 'ArrowRight') novo = { largura: largura - passo, altura }
    else if (e.key === 'ArrowUp') novo = { largura, altura: altura + passo }
    else if (e.key === 'ArrowDown') novo = { largura, altura: altura - passo }
    if (!novo) return
    e.preventDefault()
    setTamanho({
      largura: limitar(novo.largura, LIMITES_MINICHAT.largura),
      altura: limitar(novo.altura, LIMITES_MINICHAT.altura),
    })
  }

  return (
    <section className="minichat__painel" aria-label={`Conversa com ${chat.client_name}`}>
      <div
        className="minichat__redimensionar"
        role="slider"
        tabIndex={0}
        aria-label="Redimensionar painel — arraste, ou use as setas"
        aria-valuetext={`${tamanho.largura} por ${tamanho.altura} pixels`}
        aria-valuenow={tamanho.largura}
        aria-valuemin={LIMITES_MINICHAT.largura[0]}
        aria-valuemax={LIMITES_MINICHAT.largura[1]}
        title="Arraste para redimensionar (ou use as setas)"
        onPointerDown={arrastar}
        onKeyDown={teclar}
      />
      <header className="minichat__painel-cabecalho" data-tom-chat={tom}>
        <AvatarComPresenca
          nome={chat.client_name}
          presenca={chat.status === 'active' ? chat.client_presence : null}
          classe="minichat__avatar minichat__avatar--cabecalho"
          fundo="cabecalho"
          tom={null}
        />
        <span className="minichat__painel-titulo">
          <strong>{chat.client_name}</strong>
          <small>{chat.company_name}</small>
        </span>
        <button
          type="button"
          className="minichat__icone"
          aria-label={`Tamanho do painel: ${ROTULO_TAMANHO[preset]} — mudar para ${ROTULO_TAMANHO[proximo]}`}
          title={`Tamanho: ${ROTULO_TAMANHO[preset]} (clique: ${ROTULO_TAMANHO[proximo]})`}
          onClick={() => setTamanho(TAMANHOS_MINICHAT[proximo])}
        >
          <i className={preset === 'grande' ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize'} />
        </button>
        <MenuAcoes chat={chat} onAbrirNoConsole={onAbrirNoConsole} />
        <button type="button" className="minichat__icone" aria-label="Abrir no console" title="Abrir no console" onClick={onAbrirNoConsole}>
          <i className="ti ti-arrows-diagonal" />
        </button>
        <button
          type="button"
          className="minichat__icone"
          aria-label={`Minimizar conversa com ${chat.client_name}`}
          title="Minimizar"
          onClick={onMinimizar}
        >
          <i className="ti ti-minus" />
        </button>
      </header>
      {/* key: remontar ao trocar de chat zera erro/estado local; o RASCUNHO
          não zera de propósito — mora em stores/chatUi, compartilhado com o
          console */}
      <ConversaChat key={`mini-${chat.id}`} chatId={chat.id} me={me} compacto />
    </section>
  )
}

/**
 * A fila, aberta pelo balão: quem está esperando, há quanto tempo, e o
 * botão de pegar — o que o console tem, sem sair da tela em que a pessoa
 * está. O limite de simultâneos é o do servidor; aqui só se repete o motivo.
 */
function FilaPopover({
  fila,
  agoraMs,
  noLimite,
  limite,
  filaAberta,
  abreEm,
  pegando,
  erro,
  onPegar,
  onAbrirConsole,
}: {
  fila: Chat[]
  agoraMs: number
  noLimite: boolean
  limite: number
  filaAberta: boolean | undefined
  abreEm: string | null | undefined
  pegando: boolean
  erro: string | null
  onPegar: (id: number) => void
  onAbrirConsole: () => void
}) {
  return (
    <div className="minichat__fila-painel" role="dialog" aria-label="Fila de chat">
      <header className="minichat__fila-cabecalho">
        <strong>Na fila</strong>
        <span className="minichat__fila-contador">{fila.length}</span>
        <button type="button" className="cc-link" onClick={onAbrirConsole}>
          Abrir console
        </button>
      </header>
      {filaAberta === false && (
        <p className="minichat__fila-aviso">
          Fila fechada — fora do horário de atendimento
          {abreEm ? ` (abre ${new Date(abreEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}.
        </p>
      )}
      {noLimite && (
        <p className="minichat__fila-aviso">Você está no limite de {limite} atendimentos — encerre um para pegar outro.</p>
      )}
      {erro && (
        <p className="minichat__fila-erro" role="alert">
          {erro}
        </p>
      )}
      {fila.length === 0 ? (
        <p className="minichat__fila-vazia">Ninguém esperando agora.</p>
      ) : (
        <ul className="minichat__fila-lista">
          {fila.map((c) => (
            <li key={c.id} className="minichat__fila-item">
              <AvatarComPresenca
                nome={c.client_name}
                presenca={c.client_presence}
                classe="minichat__avatar"
                fundo="superficie"
              />
              <span className="minichat__fila-texto">
                <span className="minichat__fila-nome">{c.client_name}</span>
                <span className="minichat__fila-meta">
                  {c.company_name} · esperando {haQuanto(c.queued_at, agoraMs).replace('há ', '')}
                </span>
              </span>
              <button
                type="button"
                className="minichat__pegar"
                disabled={pegando || noLimite}
                title={noLimite ? `No limite de ${limite} atendimentos` : undefined}
                onClick={() => onPegar(c.id)}
              >
                {pegando ? '…' : 'Pegar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Mini chat do agente — o "widget global" de docs/01-arquitetura.md §6 e
 * docs/07 §3.3: vive fora das rotas, docado embaixo à direita, e deixa a
 * pessoa atender de QUALQUER tela (ticket, cliente, relatório) sem ir ao
 * console. Três peças:
 *
 * - o BALÃO, sempre presente pra quem é interno: abre a fila com "Pegar"
 *   (quem entra na fila aparece aqui na hora, pelo canal pessoal) e mostra o
 *   que pede atenção — quantos esperam, quantas não lidas;
 * - as ABAS, uma por atendimento em andamento;
 * - os PAINÉIS, cada aba aberta vira um painel com a conversa inteira — o
 *   mesmo `ConversaChat` do console, mesma sala de socket (registro
 *   singleton: abrir aqui e no console é UMA conexão), mesmo composer,
 *   mesmos anexos e o MESMO rascunho (stores/chatUi).
 *
 * Quantos painéis ao mesmo tempo é o `max_chats_per_agent` da configuração
 * do chat (default 3) — o mesmo teto que já limita quantos atendimentos o
 * agente pega; um número só, decidido num lugar só.
 *
 * Some no /chat (o console já mostra tudo, e dois painéis da mesma sala
 * marcariam "lido" duas vezes) e no celular (não cabe painel flutuante).
 */
export function MiniChat() {
  const { data: me } = useMe()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const interno = me?.is_internal === true
  const noConsole = pathname.startsWith('/chat')
  const ativo = interno && !noConsole

  const meus = useMeusChats(ativo)
  const fila = useFilaChat(ativo)
  const { data: config } = useConfigChat()
  const pegar = usePegarChat()
  const abertos = useChatUi((s) => s.abertos)
  const abrir = useChatUi((s) => s.abrir)
  const fechar = useChatUi((s) => s.fechar)
  const filaAberta = useChatUi((s) => s.filaAberta)
  const alternarFila = useChatUi((s) => s.alternarFila)
  const fecharFila = useChatUi((s) => s.fecharFila)
  const podar = useChatUi((s) => s.podar)
  const tamanho = usePrefs((s) => s.miniChat)
  const [erroFila, setErroFila] = useState<string | null>(null)

  // `abertos`/`rascunhos` persistem no localStorage e podem apontar pra
  // atendimentos que encerraram ou foram transferidos desde o último F5:
  // com a lista do servidor em mãos, tira esses ids — senão contariam no
  // limite de painéis e guardariam rascunho de chat que não existe mais.
  const idsMeus = meus.data
  useEffect(() => {
    if (ativo && meus.isSuccess && idsMeus) podar(idsMeus.map((c) => c.id))
  }, [ativo, meus.isSuccess, idsMeus, podar])

  if (!ativo) return null

  const limite = config?.max_chats_per_agent ?? LIMITE_PADRAO
  const meusChats = meus.data ?? []
  const filaChats = fila.data ?? []
  const porId = new Map(meusChats.map((c) => [c.id, c]))
  const tons = tonsDistintos(meusChats)
  // só os que AINDA são meus e ativos — encerrou/transferiu, o painel some
  const paineis = abertos.map((id) => porId.get(id)).filter((c): c is Chat => c != null)
  // o inverso dos painéis: quem está em `meusChats` mas não em `abertos` —
  // nunca os dois juntos pro mesmo chat (era essa dupla aparição, painel +
  // aba "ativa", que deixava a faixa encavalada)
  const minimizados = meusChats.filter((c) => !abertos.includes(c.id))
  const naFila = filaChats.length
  const naoLidas = meusChats.reduce((soma, c) => soma + c.unread_count, 0)
  const noLimite = meusChats.length >= limite
  const agoraMs = Math.max(fila.dataUpdatedAt, meus.dataUpdatedAt) || 0

  function pegarChat(id: number) {
    setErroFila(null)
    pegar.mutate(id, {
      // pegou: o painel abre na hora, sem esperar a lista voltar
      onSuccess: (c) => {
        abrir(c.id, limite)
        fecharFila()
      },
      onError: (e) => setErroFila(e instanceof ApiError ? (e.detail ?? 'Não foi possível pegar.') : 'Não foi possível pegar.'),
    })
  }

  // o balão diz o que pede atenção: fila (se ainda cabe) antes de não lidas
  const chamaAtencao = naFila > 0 && !noLimite
  const rotuloBalao = [
    naFila > 0 ? `${naFila} na fila` : 'ninguém na fila',
    naoLidas > 0 ? `${naoLidas} não lida${naoLidas === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      className="resolv-scope minichat"
      aria-label="Mini chat"
      style={{ '--minichat-largura': `${tamanho.largura}px`, '--minichat-altura': `${tamanho.altura}px` } as React.CSSProperties}
    >
      {paineis.length > 0 && (
        <div className="minichat__paineis">
          {paineis.map((chat) => (
            <PainelConversa
              key={chat.id}
              chat={chat}
              tom={tons.get(chat.id) ?? 1}
              me={me}
              onMinimizar={() => fechar(chat.id)}
              onAbrirNoConsole={() => navigate(`/chat?chat=${chat.id}`)}
            />
          ))}
        </div>
      )}

      {filaAberta && (
        <FilaPopover
          fila={filaChats}
          agoraMs={agoraMs}
          noLimite={noLimite}
          limite={limite}
          filaAberta={config?.queue_open}
          abreEm={config?.queue_opens_at}
          pegando={pegar.isPending}
          erro={erroFila}
          onPegar={pegarChat}
          onAbrirConsole={() => {
            fecharFila()
            navigate('/chat')
          }}
        />
      )}

      <div
        className={
          'minichat__barra' +
          (meusChats.length === 0 && minimizados.length === 0 && naFila === 0 ? ' minichat__barra--so-balao' : '')
        }
        role="toolbar"
        aria-label="Meus atendimentos"
      >
        <button
          type="button"
          className={'minichat__balao' + (chamaAtencao ? ' minichat__balao--atencao' : '') + (filaAberta ? ' minichat__balao--aberto' : '')}
          aria-expanded={filaAberta}
          aria-haspopup="dialog"
          aria-label={`Chat: ${rotuloBalao}`}
          title={`Fila de chat — ${rotuloBalao}`}
          onClick={alternarFila}
        >
          <i className="ti ti-message-circle-2" aria-hidden="true" />
          {(chamaAtencao || naoLidas > 0) && (
            <span className={'minichat__balao-badge' + (chamaAtencao ? ' minichat__balao-badge--fila' : '')}>
              {chamaAtencao ? naFila : naoLidas}
            </span>
          )}
        </button>
        {meusChats.length > 0 && (
          <span className="minichat__contador" title={`${meusChats.length} de ${limite} atendimentos simultâneos`}>
            {meusChats.length}/{limite}
          </span>
        )}
        {minimizados.map((chat) => (
          <BarraMinimizada key={chat.id} chat={chat} tom={tons.get(chat.id) ?? 1} onAbrir={() => abrir(chat.id, limite)} />
        ))}
        {naFila > 0 && (
          <button type="button" className="minichat__fila" onClick={alternarFila} title="Ver quem está esperando">
            {naFila} na fila
          </button>
        )}
      </div>
    </div>
  )
}
