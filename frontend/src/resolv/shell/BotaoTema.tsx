import { useTemaResolvido } from '@/stores/prefs'

/**
 * Sol/lua/monitor da zona utilitária da Sidebar. Reaproveita
 * `.sidebar-rail__item` — a mesma classe de qualquer ícone de navegação da
 * barra — em vez de ganhar scss próprio: o alvo de clique de 40px (acima dos
 * 24px da WCAG 2.5.8), o hover e o tooltip CSS saem iguais aos dos vizinhos.
 *
 * TRÊS posições, não duas. O padrão de fábrica é "sistema", e com um
 * alternador de dois estados quem clicasse uma vez ficava preso em
 * claro/escuro: não havia volta para o automático fora do seletor do portal,
 * que quem usa o console nem abre.
 *
 * O rótulo anuncia a PRÓXIMA ação, não o estado atual — quem usa leitor de
 * tela ouve "Usar tema escuro" e sabe o que o clique faz. "Tema claro" seria
 * ambíguo: é o que está ligado ou o que vou ligar?
 */
const PROXIMO: Record<string, string> = {
  claro: 'Usar tema escuro',
  escuro: 'Acompanhar o sistema',
  sistema: 'Usar tema claro',
}

export function BotaoTema() {
  const { preferencia, ciclar } = useTemaResolvido()
  const acao = PROXIMO[preferencia]

  return (
    <button type="button" className="sidebar-rail__item" aria-label={acao} title={acao} onClick={ciclar}>
      <span className="sidebar-rail__icone">
        {/* Elementos literais, e não um ternário dentro do `className`: o
            gerador do subset procura o par `ti ti-*` escrito por extenso. */}
        {preferencia === 'claro' && <i className="ti ti-sun" aria-hidden="true" />}
        {preferencia === 'escuro' && <i className="ti ti-moon" aria-hidden="true" />}
        {preferencia === 'sistema' && <i className="ti ti-device-desktop" aria-hidden="true" />}
      </span>
      <span className="sidebar-rail__rotulo" aria-hidden="true">
        {acao}
      </span>
    </button>
  )
}
