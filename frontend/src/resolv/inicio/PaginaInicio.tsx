import { useNavigate } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { useKpis } from './useKpis'
import './inicio.scss'

/** Home do Resolv: saudação + faixa de KPIs reais (contagens do backend).
 *  Clicar num card leva para a lista já na visualização correspondente. */
export function PaginaInicio() {
  const { data: me } = useMe()
  const { kpis, carregando } = useKpis()
  const navigate = useNavigate()

  const irPara: Record<string, string> = {
    'nao-resolvidos': '/chamados',
    'nao-atribuidos': '/chamados',
    meus: '/chamados',
    resolvidos: '/chamados',
  }

  return (
    <div className="inicio">
      <header className="inicio__cabecalho">
        <div>
          <span className="inicio__pre">Seu workspace, em dia</span>
          <h1 className="inicio__titulo">Olá, {me?.full_name?.split(' ')[0] ?? '—'}</h1>
          <p className="inicio__sub">Acompanhe a operação e o que precisa da sua atenção.</p>
        </div>
        <div className="inicio__acoes">
          <md-outlined-button onClick={() => navigate('/chamados')}>Abrir tickets</md-outlined-button>
          <md-filled-button onClick={() => navigate('/chamados/novo')}>Novo ticket</md-filled-button>
        </div>
      </header>

      <section className="inicio__visao" aria-labelledby="inicio-visao">
        <div className="inicio__secao-cabecalho">
          <h2 id="inicio-visao">Visão geral do atendimento</h2>
          <span>Todos os tickets</span>
        </div>
      <div className="inicio__kpis">
        {kpis.map((k) => (
          <md-text-button
            key={k.chave}
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
          </md-text-button>
        ))}
      </div>
      </section>

      <section className="inicio__orientacao" aria-label="Próximos passos">
        <div className="inicio__orientacao-icone" aria-hidden="true">✓</div>
        <div>
          <h2>Comece pela fila de tickets</h2>
          <p>Filtre atendimentos, defina responsáveis e acompanhe os prazos de SLA em um único lugar.</p>
        </div>
        <md-text-button onClick={() => navigate('/chamados')}>Ver fila</md-text-button>
      </section>
    </div>
  )
}
