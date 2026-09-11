import { useNavigate } from 'react-router-dom'
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
 * Home do Resolv. Ordem deliberada, do mais acionável pro mais ambiente
 * (overview primeiro, detalhe sob demanda):
 * 1. Saudação — com o estado real da fila de chat e as duas ações mais
 *    comuns (abrir chat/ticket), não só um "olá" decorativo.
 * 2. Mural de avisos — o que a equipe publicou.
 * 3. O que precisa de atenção AGORA — fila de prioridade própria,
 *    vencimentos da equipe, fila de chat, quem está online. Cada um é uma
 *    lista de verdade, não só um contador: clicar leva direto ao item, não
 *    a uma lista genérica que ainda precisa ser filtrada de novo.
 * 4. A faixa de KPI de sempre (contagens totais) mais um resumo "hoje" com
 *    tendência — ainda útil como visão geral, agora complementar às
 *    listas, não a única coisa na tela.
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
            Visão geral do atendimento
            {filaAberta != null && (
              <>
                {' · '}
                <span className={'inicio__fila-estado' + (filaAberta ? ' inicio__fila-estado--aberta' : '')}>
                  {filaAberta
                    ? 'Fila de chat aberta'
                    : `Fila de chat fechada${config.data?.queue_opens_at ? ` — volta ${dataHoraDe(config.data.queue_opens_at)}` : ''}`}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="inicio__acoes">
          <button type="button" className="inicio__botao inicio__botao--secundario" onClick={() => navigate('/chat')}>
            <i className="ti ti-message-circle-2" aria-hidden="true" /> Chat
          </button>
          <button type="button" className="inicio__botao" onClick={() => navigate('/chamados/novo')}>
            <i className="ti ti-plus" aria-hidden="true" /> Novo ticket
          </button>
        </div>
      </header>

      <MuralAvisos />

      <div className="inicio__grade">
        <FilaDePrioridade />
        <VencimentosSla />
        <FilaDeChat />
        <QuemEstaOnline />
      </div>

      <div className="inicio__kpis">
        {kpis.map((k) => (
          <button
            key={k.chave}
            type="button"
            className="inicio__kpi"
            onClick={() => navigate(irPara[k.chave] ?? '/chamados')}
          >
            <span className="inicio__kpi-rotulo">{k.rotulo}</span>
            <span
              className={
                'inicio__kpi-valor' + (k.tom ? ` inicio__kpi-valor--${k.tom}` : '')
              }
            >
              {carregando && k.valor == null ? '···' : (k.valor ?? '—')}
            </span>
          </button>
        ))}
        {resolvidosHoje && resolvidosHoje.value != null && (
          <div className="inicio__kpi inicio__kpi--tendencia">
            <span className="inicio__kpi-rotulo">Resolvidos hoje</span>
            <span className="inicio__kpi-valor inicio__kpi-valor--ok">{resolvidosHoje.value}</span>
            {resolvidosHoje.variation != null && (
              <span className={`inicio__kpi-delta inicio__kpi-delta--${direcaoVariacao(resolvidosHoje.variation)}`}>
                {formatarVariacao(resolvidosHoje.variation)} vs ontem
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
