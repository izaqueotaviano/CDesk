import { useState } from 'react'
import { useMetricasChat } from '@/api/chat'
import { EmptyState, ErrorState, Skeleton, TextInput } from '@/cvz/components'
import { formatarMinutos, formatarNota } from './formato'

/**
 * Como os atendimentos TERMINARAM — a leitura que faltava.
 *
 * "Chats" conta volume por agente; "Desempenho do chat" dá as médias por
 * eixo. Nenhum dos dois responde as perguntas do desfecho: por que as
 * conversas acabam, quantas o sistema encerrou sozinho, quantas voltaram, e
 * quantas pessoas simplesmente não avaliaram. O motivo de encerramento
 * existe desde a Fase 1 e não tinha nenhuma tela que o lesse.
 *
 * Duas escolhas de leitura que estão na tela e não só no comentário:
 *
 * - **Média E mediana, lado a lado.** Numa fila de atendimento a média
 *   mente com facilidade: um chat esquecido no fim de semana a leva para as
 *   alturas enquanto a experiência de quase todo mundo foi outra. Ver as
 *   duas é o que denuncia o outlier.
 * - **Quem NÃO avaliou aparece.** Uma média 9 sobre 5% dos atendimentos não
 *   é uma média 9, e um painel que mostrasse só a média esconderia
 *   exatamente isso.
 */
/** ISO curto (YYYY-MM-DD) de N dias atrás — fora do render, e chamado só na
 *  inicialização do estado: ler o relógio durante o render é impuro e faria
 *  o intervalo padrão mudar sozinho entre duas renderizações. */
function diaISO(diasAtras = 0): string {
  return new Date(Date.now() - diasAtras * 86_400_000).toISOString().slice(0, 10)
}

export function PainelDesfechos() {
  const [desde, setDesde] = useState(() => diaISO(30))
  const [ate, setAte] = useState(() => diaISO(0))
  const { data, isLoading, isError, error, refetch } = useMetricasChat({ desde, ate })

  if (isLoading) {
    return (
      <div className="relatorios-secao">
        <Skeleton height="96px" />
        <Skeleton lines={4} />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <ErrorState
        title="Não foi possível carregar os desfechos"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    )
  }

  const semAvaliar = data.avaliacao.sem_resposta
  const totalAvaliavel = data.avaliacao.respondidas + semAvaliar

  return (
    <div className="relatorios-secao">
      <div className="relatorios-filtros" role="group" aria-label="Período">
        <TextInput
          label="De"
          type="date"
          value={desde}
          max={ate}
          onChange={(e) => setDesde(e.target.value)}
        />
        <TextInput
          label="Até"
          type="date"
          value={ate}
          min={desde}
          onChange={(e) => setAte(e.target.value)}
        />
      </div>
      <p className="relatorios-nota">
        O recorte é por <strong>encerramento</strong>: um atendimento aberto ontem e fechado
        hoje conta hoje, que é quando as medidas de duração e desfecho passam a existir.
      </p>

      {data.total === 0 ? (
        <EmptyState
          title="Nenhum atendimento encerrado no período"
          description="Aumente o intervalo nas datas acima para ver mais atendimentos."
        />
      ) : (
        <>
          <dl className="relatorios-kpis">
            <Kpi rotulo="Encerrados" valor={String(data.total)} />
            <Kpi
              rotulo="Espera"
              valor={formatarMinutos(data.espera_minutos.media)}
              apoio={`mediana ${formatarMinutos(data.espera_minutos.mediana)}`}
            />
            <Kpi
              rotulo="Duração"
              valor={formatarMinutos(data.duracao_minutos.media)}
              apoio={`mediana ${formatarMinutos(data.duracao_minutos.mediana)}`}
            />
            <Kpi
              rotulo="Nota de atendimento"
              valor={formatarNota(data.avaliacao.media_atendimento)}
              apoio={
                totalAvaliavel > 0
                  ? `${data.avaliacao.respondidas} de ${totalAvaliavel} avaliaram`
                  : 'ninguém avaliou'
              }
            />
            <Kpi rotulo="Sem avaliação" valor={String(semAvaliar)} />
            <Kpi rotulo="Notas 6 ou menos" valor={String(data.avaliacao.detratoras)} />
            <Kpi rotulo="Nunca atendidos" valor={String(data.nao_atendidos)} />
            <Kpi rotulo="Encerrados pelo sistema" valor={String(data.encerrados_automaticamente)} />
            <Kpi rotulo="Reabertos" valor={String(data.reabertos)} />
          </dl>

          <section className="relatorios-secao">
            <h2 className="relatorios-secao__titulo">Por que terminaram</h2>
            <div className="relatorios-tabela__wrap">
            <table className="relatorios-tabela">
              <thead>
                <tr>
                  <th scope="col">Motivo</th>
                  <th scope="col" className="num">
                    Atendimentos
                  </th>
                  <th scope="col" className="num">
                    Fatia
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.por_motivo.map((m) => (
                  <tr key={m.id ?? 'sem'}>
                    <th scope="row">{m.nome}</th>
                    <td className="num">{m.total}</td>
                    <td className="num">{Math.round((m.total / data.total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>

          {data.por_agente.length > 0 && (
            <section className="relatorios-secao">
              <h2 className="relatorios-secao__titulo">Por agente</h2>
              <div className="relatorios-tabela__wrap">
              <table className="relatorios-tabela">
                <thead>
                  <tr>
                    <th scope="col">Agente</th>
                    <th scope="col" className="num">
                      Atendimentos
                    </th>
                    <th scope="col" className="num">
                      Duração média
                    </th>
                    <th scope="col" className="num">
                      Nota média
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.por_agente.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.nome}</th>
                      <td className="num">{a.total}</td>
                      <td className="num">{formatarMinutos(a.duracao_media)}</td>
                      <td className="num">{formatarNota(a.media_nota)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="relatorios-kpi">
      <dt>{rotulo}</dt>
      <dd>
        {valor}
        {apoio && <span className="relatorios-kpi__apoio">{apoio}</span>}
      </dd>
    </div>
  )
}
