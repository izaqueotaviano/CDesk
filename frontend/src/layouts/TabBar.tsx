import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { chaveAba, useTabs, type AbaTicket } from '@/stores/tabs'

/**
 * docs/06-abas-frontend.md — reconcilia com o servidor ao montar (uma vez;
 * o resultado alimenta o store, não o componente) e depois só lê do store.
 * Mostra o que já tinha em localStorage enquanto `reconciliando` é true —
 * nunca espera rede pra desenhar a barra.
 */
export function TabBar() {
  const { tabs: todasAsAbas, active, reconciliar, fechar, definirAtiva } = useTabs()
  const navigate = useNavigate()

  // Esta barra é só de TICKETS (base Tailwind antiga, /app) — desde a Fase 2
  // o store passou a guardar abas de seção também (shell novo, Fase 2),
  // que esta base nunca cria mas pode HERDAR do mesmo store compartilhado
  // (ex.: a pessoa abriu /clientes no shell novo antes de cair aqui). Filtrar
  // é o que evita acessar `.resumo` (só existe em aba de ticket) numa aba de
  // seção.
  const tabs = todasAsAbas.filter((a): a is AbaTicket => a.tipo === 'ticket')

  useEffect(() => {
    reconciliar().catch(() => {
      // Melhor esforço: sem conexão na primeira carga, segue com o que
      // já estava em localStorage — GET falho não deve travar a tela.
    })
    // roda uma vez por montagem do shell (login), não a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (tabs.length === 0) return null

  return (
    <div
      role="tablist"
      aria-label="Tickets abertos"
      className="flex items-center gap-1 border-b border-divisoria bg-navegacao px-2"
    >
      {tabs.map((aba) => {
        const chave = chaveAba(aba)
        return (
          <div
            key={chave}
            role="tab"
            aria-selected={chave === active}
            className={`group flex items-center gap-2 rounded-t-md px-3 py-2 text-pequeno
              transition-colors duration-padrao ${
                chave === active
                  ? 'bg-superficie text-tinta'
                  : 'text-tinta-secundaria hover:bg-hover'
              }`}
          >
            <button
              className="max-w-40 truncate text-left"
              onClick={() => {
                definirAtiva(chave)
                navigate(`/app/tickets/${aba.ticketId}`)
              }}
            >
              {aba.resumo?.reference ?? `#${aba.ticketId}`}
            </button>
            <button
              aria-label={`Fechar aba ${aba.resumo?.reference ?? aba.ticketId}`}
              className="rounded-sm px-1 text-tinta-terciaria opacity-0 hover:bg-ativo
                group-hover:opacity-100"
              onClick={() => fechar(chave)}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
