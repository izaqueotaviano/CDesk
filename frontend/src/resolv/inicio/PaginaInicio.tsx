import { useNavigate } from 'react-router-dom'
import { useConfigChat } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { useIndicadores } from '@/cvz/relatorios/dados'
import { direcaoVariacao, formatarVariacao } from '@/cvz/relatorios/formato'
import { Icone } from '../shell/Icone'
import { dataHoraDe } from '../chat/format'
import { FilaDeChat } from './FilaDeChat'
import { FilaDePrioridade } from './FilaDePrioridade'
import { MuralAvisos } from './MuralAvisos'
import { QuemEstaOnline } from './QuemEstaOnline'
import { useKpis } from './useKpis'
import { VencimentosSla } from './VencimentosSla'
import './inicio.scss'

/**
 * Home do Resolv, no Material Design 3 — na versão compacta da casa.
 *
 * A página é lida de cima para baixo em quatro faixas, e NENHUMA delas é um
 * card:
 *
 * 1. **Cabeçalho** — quem é a pessoa, qual é o contexto (estado da fila de
 *    chat) e as ações. A ação principal é UMA e é um Filled Button ("Novo
 *    ticket"); a de apoio fica em Outlined ("Chat"). É a hierarquia de botão
 *    do M3 fazendo o trabalho de dizer o que é o quê.
 * 2. **Avisos** — o banner do M3, quando há o que avisar.
 * 3. **Indicadores** — números soltos sobre a superfície, separados por
 *    divisor. Seis cartõezinhos aqui seriam exatamente o "dashboard genérico"
 *    que este produto não quer ser; o número em corpo grande com o rótulo
 *    embaixo diz a mesma coisa ocupando um terço da altura.
 * 4. **Trabalho** — duas colunas de SEÇÕES (cabeçalho, divisor, linhas), não
 *    de caixas. À esquerda o que é do atendimento (seus próximos, vencendo na
 *    equipe); à direita o contexto (chat na fila, equipe agora), numa coluna
 *    mais estreita porque é apoio, não destino.
 *
 * Nada de dado, rota, texto ou ação mudou — as mesmas queries, os mesmos
 * destinos de clique.
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
              <span className={'md-badge ' + (filaAberta ? 'md-badge--success' : 'md-badge--warning')}>
                {/* o ponto é o segundo sinal: o estado não fica só na cor */}
                <span className="md-badge__ponto" aria-hidden="true" />
                {filaAberta
                  ? 'Fila de chat aberta'
                  : `Fila de chat fechada${config.data?.queue_opens_at ? ` — volta ${dataHoraDe(config.data.queue_opens_at)}` : ''}`}
              </span>
            )}
          </p>
        </div>
        <div className="inicio__acoes">
          <button type="button" className="md-btn md-btn--outlined" onClick={() => navigate('/chat')}>
            <Icone nome="chat" tamanho={18} /> Chat
          </button>
          <button
            type="button"
            className="md-btn md-btn--filled"
            onClick={() => navigate('/chamados/novo')}
          >
            <Icone nome="add" tamanho={18} /> Novo ticket
          </button>
        </div>
      </header>

      <MuralAvisos />

      <section className="inicio__metricas" aria-label="Indicadores do atendimento">
        {kpis.map((k) => (
          <button
            key={k.chave}
            type="button"
            className="inicio__metrica"
            onClick={() => navigate(irPara[k.chave] ?? '/chamados')}
          >
            <span className={'inicio__metrica-valor' + (k.tom ? ` inicio__metrica-valor--${k.tom}` : '')}>
              {carregando && k.valor == null ? (
                <span className="md-skeleton inicio__metrica-esqueleto" aria-label="Carregando" />
              ) : (
                (k.valor ?? '—')
              )}
            </span>
            <span className="inicio__metrica-rotulo">{k.rotulo}</span>
          </button>
        ))}
        {resolvidosHoje && resolvidosHoje.value != null && (
          <div className="inicio__metrica inicio__metrica--inerte">
            <span className="inicio__metrica-valor inicio__metrica-valor--ok">
              {resolvidosHoje.value}
            </span>
            <span className="inicio__metrica-rotulo">
              Resolvidos hoje
              {resolvidosHoje.variation != null && (
                <span
                  className={`inicio__metrica-delta inicio__metrica-delta--${direcaoVariacao(resolvidosHoje.variation)}`}
                >
                  <Icone
                    nome={
                      direcaoVariacao(resolvidosHoje.variation) === 'down'
                        ? 'trending_down'
                        : 'trending_up'
                    }
                    tamanho={18}
                  />
                  {formatarVariacao(resolvidosHoje.variation)} vs ontem
                </span>
              )}
            </span>
          </div>
        )}
      </section>

      <div className="inicio__grade">
        <div className="inicio__coluna">
          <FilaDePrioridade />
          <VencimentosSla />
        </div>
        <div className="inicio__coluna inicio__coluna--apoio">
          <FilaDeChat />
          <QuemEstaOnline />
        </div>
      </div>
    </div>
  )
}
