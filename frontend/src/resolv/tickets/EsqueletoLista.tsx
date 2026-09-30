import { Esqueleto } from '@/ui/Esqueleto'

const LINHAS = 8
// Larguras variadas de propósito: oito barras idênticas leem como listras,
// não como uma lista de chamados chegando.
const ASSUNTOS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-3/5', 'w-2/3', 'w-1/2', 'w-3/4']

/** Barra de texto do tamanho da linha que ela substitui. A altura do
 *  Esqueleto é `1em` — quem manda nela é o corpo de letra (`text-[Npx]`),
 *  não uma classe de altura que brigaria com a dele. */
function Barra({ largura, px = 12 }: { largura: string; px?: 12 | 14 | 16 | 24 }) {
  const corpo = { 12: 'text-[12px]', 14: 'text-[14px]', 16: 'text-[16px]', 24: 'text-[24px]' }[px]
  return <Esqueleto className={`${corpo} ${largura} align-middle`} />
}

/**
 * O que a fila mostra enquanto a PRIMEIRA página não chega: o desenho da
 * própria lista (linhas na tabela, cartões no celular), não um "Carregando…"
 * centralizado — a tela já nasce com a forma que vai ter, e nada pula de
 * lugar quando os dados entram. Trocas seguintes de página/filtro não passam
 * por aqui: `keepPreviousData` segura a lista anterior.
 *
 * `aria-hidden` no desenho e um texto só para leitor de tela: oito linhas de
 * "nada" anunciadas uma a uma seriam ruído.
 */
export function EsqueletoLista({ cartoes }: { cartoes: boolean }) {
  return (
    <div className="esqueleto-lista">
      <p className="tickets-tabela__sr" role="status">
        Carregando tickets…
      </p>
      {cartoes ? (
        <ul className="cartoes-tickets" aria-hidden="true">
          {ASSUNTOS.map((largura, i) => (
            <li key={i} className="cartao-ticket cartao-ticket--esqueleto">
              <Barra largura="w-4" px={16} />
              <div className="cartao-ticket__corpo">
                <Barra largura={largura} px={14} />
                <Barra largura="w-1/2" />
                <Barra largura="w-24" px={16} />
              </div>
              <Barra largura="w-6" px={24} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="tickets-tabela__wrap" aria-hidden="true">
          <table className="tickets-tabela tickets-tabela--esqueleto">
            <thead>
              <tr>
                <th className="col-check" />
                <th className="col-protocolo">Protocolo</th>
                <th className="col-assunto">Assunto</th>
                <th className="col-data">Aberto em</th>
                <th className="col-cliente">Cliente</th>
                <th className="col-resp">Responsável</th>
                <th className="col-urg">Prioridade</th>
                <th className="col-status">Status</th>
                <th className="col-sla">SLA</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: LINHAS }, (_, i) => (
                <tr key={i}>
                  <td className="col-check">
                    <Barra largura="w-4" px={16} />
                  </td>
                  <td className="col-protocolo">
                    <Barra largura="w-16" />
                  </td>
                  <td className="col-assunto">
                    <Barra largura={ASSUNTOS[i]!} px={14} />
                  </td>
                  <td className="col-data">
                    <Barra largura="w-24" />
                  </td>
                  <td className="col-cliente">
                    <Barra largura="w-28" px={14} />
                  </td>
                  <td className="col-resp">
                    <Barra largura="w-20" px={14} />
                  </td>
                  <td className="col-urg">
                    <Barra largura="w-12" />
                  </td>
                  <td className="col-status">
                    <Barra largura="w-24" />
                  </td>
                  <td className="col-sla">
                    <Barra largura="w-16" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
