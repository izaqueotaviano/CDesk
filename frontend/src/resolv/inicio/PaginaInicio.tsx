import { useNavigate } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { MuralAvisos } from './MuralAvisos'
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
        <h1 className="inicio__titulo">Olá, {me?.full_name?.split(' ')[0] ?? '—'}</h1>
        <p className="inicio__sub">Visão geral do atendimento</p>
      </header>

      <MuralAvisos />

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
      </div>
    </div>
  )
}
