import { ACAO_DO_TEMA, useTemaResolvido } from '@/stores/prefs'

/**
 * Sol/lua/monitor no canto superior direito — um dos dois ícones da barra
 * superior (shell.scss, `novo-shell__icone`), como na referência.
 *
 * Todo clique muda o que está na tela, e "acompanhar o sistema" continua
 * no ciclo (regras em `proximaPreferencia`, stores/prefs.ts). O ícone mostra
 * a preferência atual; o rótulo anuncia a próxima ação.
 */
export function BotaoTema() {
  const { preferencia, ciclar, proxima } = useTemaResolvido()
  const acao = ACAO_DO_TEMA[proxima]

  return (
    <button type="button" className="novo-shell__icone" aria-label={acao} title={acao} onClick={ciclar}>
      {/* Elementos literais, e não um ternário dentro do `className`: o
          gerador do subset procura o par `ti ti-*` escrito por extenso. */}
      {preferencia === 'claro' && <i className="ti ti-sun" aria-hidden="true" />}
      {preferencia === 'escuro' && <i className="ti ti-moon" aria-hidden="true" />}
      {preferencia === 'sistema' && <i className="ti ti-device-desktop" aria-hidden="true" />}
    </button>
  )
}
