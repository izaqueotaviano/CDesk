import { useNavigate } from 'react-router-dom'
import { useConfigChat } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { useIndicadores } from '@/cvz/relatorios/dados'
import { direcaoVariacao, formatarVariacao } from '@/cvz/relatorios/formato'
import { Esqueleto } from '@/ui/Esqueleto'
import { dataHoraDe } from '../chat/format'
import { FilaDeChat } from './FilaDeChat'
import { FilaDePrioridade } from './FilaDePrioridade'
import { MuralAvisos } from './MuralAvisos'
import { PegarProximo } from './PegarProximo'
import { QuemEstaOnline } from './QuemEstaOnline'
import { useKpis } from './useKpis'
import { VencimentosSla } from './VencimentosSla'
import './inicio.scss'

/**
 * Home do Resolv. Ordem deliberada, do mais acionável pro mais ambiente
 * (overview primeiro, detalhe sob demanda):
 * 1. Saudação — com o estado real da fila de chat e a ação que só faz
 *    sentido aqui: "Pegar o próximo" (PegarProximo.tsx). "Novo ticket" e
 *    "Chat" saíram do cabeçalho: os dois já estão na sidebar, em toda tela,
 *    e o console de chat ainda tem o "Ver console" no cartão da fila.
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
          {/* Sem o nome ainda, só "Olá": um travessão no lugar do nome lia
           *  como dado faltando, não como carregando. */}
          <h1 className="inicio__titulo">Olá{me?.full_name ? `, ${me.full_name.split(' ')[0]}` : ''}</h1>
          <p className="inicio__sub">
            Visão geral do atendimento
            {filaAberta != null && (
              <>
                {' · '}
                <span className={'inicio__fila-estado' + (filaAberta ? ' inicio__fila-estado--aberta' : '')}>
                  {filaAberta
                    ? 'Fila de chat aberta'
                    : `Fila de chat fechada${config.data?.queue_opens_at ? `, volta ${dataHoraDe(config.data.queue_opens_at)}` : ''}`}
                </span>
              </>
            )}
          </p>
        </div>
        <PegarProximo meuId={me?.id} />
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
                // Cor só quando há o que sinalizar: "SLA estourado 0" em
                // vermelho gritava um alerta que não existe.
                'inicio__kpi-valor' + (k.tom && (k.valor ?? 0) > 0 ? ` inicio__kpi-valor--${k.tom}` : '')
              }
            >
              {carregando && k.valor == null ? (
                <>
                  <Esqueleto className="inicio__kpi-esqueleto" />
                  <span className="sr-only">Carregando</span>
                </>
              ) : (
                (k.valor ?? '—')
              )}
            </span>
          </button>
        ))}
        {resolvidosHoje && resolvidosHoje.value != null && (
          <div className="inicio__kpi inicio__kpi--tendencia">
            <span className="inicio__kpi-rotulo">Resolvidos hoje</span>
            <span className={'inicio__kpi-valor' + (resolvidosHoje.value > 0 ? ' inicio__kpi-valor--ok' : '')}>
              {resolvidosHoje.value}
            </span>
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
