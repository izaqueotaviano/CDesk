import { useTema } from './useTema'

/**
 * Sol/lua da zona utilitária da Sidebar (Fase 2 — antes vivia na Topbar, que
 * não existe mais). Reaproveita `.sidebar-rail__item` — a mesma classe de
 * qualquer ícone de navegação da barra — em vez de ganhar scss próprio: o
 * alvo de clique de 40px (acima dos 24px da WCAG 2.5.8), o hover e o tooltip
 * CSS saem iguais aos dos vizinhos de graça.
 *
 * O rótulo anuncia a AÇÃO, não o estado: quem usa leitor de tela ouve "Usar
 * tema escuro" e sabe o que o clique faz. "Tema claro" seria ambíguo — é o que
 * está ligado ou o que vou ligar?
 */
export function BotaoTema() {
  const { tema, alternar } = useTema()
  const acao = tema === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'

  return (
    <button type="button" className="sidebar-rail__item" aria-label={acao} title={acao} onClick={alternar}>
      <span className="sidebar-rail__icone">
        {/* Dois elementos literais, e não um ternário dentro do `className`:
            o gerador do subset procura o par `ti ti-*` escrito por extenso. */}
        {tema === 'escuro' ? (
          <i className="ti ti-sun" aria-hidden="true" />
        ) : (
          <i className="ti ti-moon" aria-hidden="true" />
        )}
      </span>
      <span className="sidebar-rail__rotulo" aria-hidden="true">
        {acao}
      </span>
    </button>
  )
}
