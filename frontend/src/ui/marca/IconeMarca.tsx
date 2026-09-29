import { useEffect } from 'react'
import { SPRITE, type NomeDeIcone } from './sprite'

export type { NomeDeIcone }
import { SIMBOLOS_PROPRIOS } from './sprite-proprio'
import './icone-marca.scss'

/**
 * Ícone do conjunto AUTORAL da Convertize — o que o kit desenha, não o
 * Tabler repackado que ele serve por CDN (ver o cabeçalho de
 * scripts/gerar_sprite_marca.py, que explica a diferença).
 *
 * O desenho tem duas camadas: o corpo, que segue `currentColor`, e um
 * detalhe (`.a`) que fica a 38% de opacidade e VIRA LARANJA quando o item
 * está ativo. É essa segunda camada que faz o item selecionado da navegação
 * se anunciar sem precisar de fundo colorido — a regra do v2 ("o detalhe do
 * ícone fica laranja no item ativo").
 */
/** Os símbolos desenhados aqui, na gramática do kit — ver sprite-proprio.ts. */
export type NomeProprio = keyof typeof SIMBOLOS_PROPRIOS

export function IconeMarca({
  nome,
  tamanho = 'md',
  className,
}: {
  nome: NomeDeIcone | NomeProprio
  /** 16 / 20 / 24px — as três medidas do kit. */
  tamanho?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <svg
      className={['i', tamanho !== 'md' && `i-${tamanho}`, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#i-${nome}`} />
    </svg>
  )
}

/**
 * Injeta o sprite uma vez no documento. `<use>` só resolve um `href` de
 * fragmento se o `<symbol>` estiver no MESMO documento, então ele precisa
 * estar no DOM antes de qualquer `IconeMarca` — por isso mora no shell, não
 * dentro do ícone.
 */
export function SpriteMarca() {
  useEffect(() => {
    if (document.getElementById('cvz-sprite')) return
    const caixa = document.createElement('div')
    caixa.id = 'cvz-sprite'
    caixa.setAttribute('aria-hidden', 'true')
    caixa.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
    const proprios = Object.values(SIMBOLOS_PROPRIOS).join('')
    caixa.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${SPRITE}${proprios}</svg>`
    document.body.prepend(caixa)
  }, [])
  return null
}
