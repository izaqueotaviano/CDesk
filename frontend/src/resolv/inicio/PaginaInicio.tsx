import { useNavigate } from 'react-router-dom'
import {
  Add20Regular,
  Chat20Regular,
  ArrowTrendingLines20Regular,
} from '@fluentui/react-icons'
import { useConfigChat } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { useIndicadores } from '@/cvz/relatorios/dados'
import { direcaoVariacao, formatarVariacao } from '@/cvz/relatorios/formato'
import { dataHoraDe } from '../chat/format'
import { FilaDeChat } from './FilaDeChat'
import { FilaDePrioridade } from './FilaDePrioridade'
import { MuralAvisos } from './MuralAvisos'
import { QuemEstaOnline } from './QuemEstaOnline'
import { useKpis } from './useKpis'
import { VencimentosSla } from './VencimentosSla'
import './inicio.scss'

/**
 * Home do Resolv, no padrão de página do Fluent 2.
 *
 * Três níveis, de cima para baixo — é a hierarquia que o design system pede
 * para uma página de entrada:
 *
 * 1. **Cabeçalho**: quem é a área (o cumprimento), o contexto (estado da fila
 *    de chat) e as ações. A ação principal é UMA e é um Primary Button
 *    ("Novo ticket"); a de apoio fica em Default ("Chat").
 * 2. **Avisos** (MessageBar) e a **faixa de indicadores**: uma superfície só,
 *    segmentada por linha, em vez de seis cartões — é o "compacto e elegante"
 *    do briefing, e libera a atenção para o que vem embaixo.
 * 3. **As listas de trabalho**: o que precisa de atenção AGORA, cada uma num
 *    cartão com cabeçalho, contagem e alvo de linha inteira.
 *
 * A ordem entre (2) e (3) mudou em relação à versão anterior (os indicadores
 * estavam no rodapé): compactados numa faixa de uma linha, eles passam a ler
 * como contexto do cabeçalho e não competem mais com as listas, que continuam
 * sendo o peso visual da página.
 *
 * Nada de dado, rota ou ação mudou aqui — as mesmas queries, os mesmos
 * destinos de clique, os mesmos textos.
 */
export function PaginaInicio() {
  const { data: me } = useMe()
  const { kpis, carregando } = useKpis()
  const config = useConfigChat()
  const indicadoresHoje = useIndicadores('today', null)
  const navigate = useNavigate()

  const irPara: Record<string, string> = {
    'nao-resolvidos': '/chamados',
    'nao-atribuidos': '/chamados',
    meus: '/chamados',
    resolvidos: '/chamados',
  }

  const filaAberta = config.data?.queue_open
  const resolvidosHoje = indicadoresHoje.data?.kpis.find((k) => k.key === 'resolved')

  return (
    <div className="inicio">
      <header className="inicio__cabecalho">
        <div className="inicio__saudacao">
          <h1 className="inicio__titulo">Olá, {me?.full_name?.split(' ')[0] ?? '—'}</h1>
          <p className="inicio__sub">
            <span>Visão geral do atendimento</span>
            {filaAberta != null && (
              <span
                className={
                  'fui-badge ' + (filaAberta ? 'fui-badge--success' : 'fui-badge--warning')
                }
              >
                {/* o ponto é o segundo sinal: o estado não fica só na cor */}
                <span className="fui-badge__ponto" aria-hidden="true" />
                {filaAberta
                  ? 'Fila de chat aberta'
                  : `Fila de chat fechada${config.data?.queue_opens_at ? ` — volta ${dataHoraDe(config.data.queue_opens_at)}` : ''}`}
              </span>
            )}
          </p>
        </div>
        <div className="inicio__acoes">
          <button type="button" className="fui-btn" onClick={() => navigate('/chat')}>
            <Chat20Regular aria-hidden="true" /> Chat
          </button>
          <button
            type="button"
            className="fui-btn fui-btn--primary"
            onClick={() => navigate('/chamados/novo')}
          >
            <Add20Regular aria-hidden="true" /> Novo ticket
          </button>
        </div>
      </header>

      <MuralAvisos />

      <section className="inicio__kpis fui-card" aria-label="Indicadores do atendimento">
        {kpis.map((k) => (
          <button
            key={k.chave}
            type="button"
            className="inicio__kpi"
            onClick={() => navigate(irPara[k.chave] ?? '/chamados')}
          >
            <span className="inicio__kpi-rotulo">{k.rotulo}</span>
            <span className={'inicio__kpi-valor' + (k.tom ? ` inicio__kpi-valor--${k.tom}` : '')}>
              {carregando && k.valor == null ? (
                <span className="fui-skeleton inicio__kpi-esqueleto" aria-label="Carregando" />
              ) : (
                (k.valor ?? '—')
              )}
            </span>
          </button>
        ))}
        {resolvidosHoje && resolvidosHoje.value != null && (
          <div className="inicio__kpi inicio__kpi--tendencia">
            <span className="inicio__kpi-rotulo">Resolvidos hoje</span>
            <span className="inicio__kpi-valor inicio__kpi-valor--ok">{resolvidosHoje.value}</span>
            {resolvidosHoje.variation != null && (
              <span
                className={`inicio__kpi-delta inicio__kpi-delta--${direcaoVariacao(resolvidosHoje.variation)}`}
              >
                <ArrowTrendingLines20Regular aria-hidden="true" />
                {formatarVariacao(resolvidosHoje.variation)} vs ontem
              </span>
            )}
          </div>
        )}
      </section>

      <div className="inicio__grade">
        <FilaDePrioridade />
        <VencimentosSla />
        <FilaDeChat />
        <QuemEstaOnline />
      </div>
    </div>
  )
}
