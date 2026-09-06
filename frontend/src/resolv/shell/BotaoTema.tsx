import { useTema } from './useTema'

/**
 * Sol/lua da Topbar. Reaproveita `.topbar-glass__icon-btn` (a mesma classe do
 * sino e do Sair) em vez de ganhar scss próprio: não é um componente novo da
 * barra, é mais um ícone dela — e assim o alvo de clique de 34px (acima dos
 * 24px da WCAG 2.5.8) e o hover saem iguais aos dos vizinhos de graça.
 *
 * O rótulo anuncia a AÇÃO, não o estado: quem usa leitor de tela ouve "Usar
 * tema escuro" e sabe o que o clique faz. "Tema claro" seria ambíguo — é o que
 * está ligado ou o que vou ligar?
 */
export function BotaoTema() {
  const { tema, alternar } = useTema()
  const acao = tema === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'

  return (
    <button type="button" className="topbar-glass__icon-btn" aria-label={acao} title={acao} onClick={alternar}>
      <i className={tema === 'escuro' ? 'ti ti-sun' : 'ti ti-moon'} aria-hidden="true" />
    </button>
  )
}
