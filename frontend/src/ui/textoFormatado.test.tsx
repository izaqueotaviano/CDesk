import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TextoFormatado } from './TextoFormatado'
import { analisarTexto, hrefSeguro, paraTextoSimples, temFormatacao } from './textoFormatado'

function html(texto: string, mencoes?: { key: string; name: string; is_active?: boolean }[]) {
  const { container } = render(<TextoFormatado texto={texto} mencoes={mencoes} />)
  return container.firstElementChild as HTMLElement
}

describe('formatação leve — o que vira formatação', () => {
  it('negrito, itálico com _ e com *', () => {
    const el = html('um **forte** e um _leve_ e um *outro*')
    expect(el.querySelector('strong')?.textContent).toBe('forte')
    expect([...el.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['leve', 'outro'])
    expect(el.textContent).toBe('um forte e um leve e um outro')
  })

  it('itálico dentro do negrito', () => {
    const el = html('**muito _importante_ mesmo**')
    expect(el.querySelector('strong em')?.textContent).toBe('importante')
  })

  it('lista com marcador e lista numerada, cada uma com os itens seguidos', () => {
    const el = html('Passos:\n- abrir\n- fechar\n\n3. terceiro\n4. quarto')
    expect([...el.querySelectorAll('ul > li')].map((l) => l.textContent)).toEqual([
      'abrir',
      'fechar',
    ])
    const ol = el.querySelector('ol')!
    expect(ol.getAttribute('start')).toBe('3')
    expect(ol.querySelectorAll('li')).toHaveLength(2)
    expect(el.querySelector('p')?.textContent).toBe('Passos:')
  })

  it('link com rótulo abre em outra aba sem entregar a origem', () => {
    const a = html('veja [o manual](https://exemplo.com/manual?x=1)').querySelector('a')!
    expect(a.textContent).toBe('o manual')
    expect(a.getAttribute('href')).toBe('https://exemplo.com/manual?x=1')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('endereço solto vira link, sem levar a pontuação da frase', () => {
    const a = html('Acesse https://exemplo.com/a_b.').querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://exemplo.com/a_b')
    expect(a.textContent).toBe('https://exemplo.com/a_b')
  })

  it('mailto é permitido', () => {
    const a = html('[fale conosco](mailto:suporte@exemplo.com)').querySelector('a')!
    expect(a.getAttribute('href')).toBe('mailto:suporte@exemplo.com')
  })

  it('menção resolvida vira chip com o nome de hoje; sem resolução fica o texto', () => {
    const el = html('@[user:7] e @[user:99], olhem', [{ key: 'user:7', name: 'Izaque Lima' }])
    expect(el.querySelector('.texto-formatado__mencao')?.textContent).toBe('@Izaque Lima')
    expect(el.textContent).toBe('@Izaque Lima e @[user:99], olhem')
  })

  it('menção sem lista de menções (resposta pública, portal) fica literal', () => {
    const el = html('@[user:7] oi')
    expect(el.querySelector('.texto-formatado__mencao')).toBeNull()
    expect(el.textContent).toBe('@[user:7] oi')
  })
})

describe('formatação leve — texto antigo continua igual', () => {
  it.each([
    'Olá, tudo bem?\nSegue o pedido 123.',
    '5 * 3 * 2 = 30',
    '5*3*2',
    'arquivo_de_log_final.txt',
    'o campo nome_cliente está vazio',
    '**sem par',
    'preço: R$ 10,00 * quantidade',
    '2024. Foi um ano difícil',
    '-5 graus lá fora',
    '[sem endereço]',
    'C:\\pasta\\arquivo',
  ])('%s', (texto) => {
    const el = html(texto)
    expect(el.textContent).toBe(texto)
    expect(el.querySelectorAll('strong, em, a, ul, ol')).toHaveLength(0)
  })

  it('quebras de linha e linhas em branco são preservadas', () => {
    const el = html('linha 1\n\nlinha 3')
    expect(el.querySelectorAll('p')).toHaveLength(1)
    expect(el.querySelector('p')?.textContent).toBe('linha 1\n\nlinha 3')
  })
})

describe('formatação leve — XSS', () => {
  it('HTML escrito na mensagem é texto, nunca elemento', () => {
    const el = html('<script>alert(1)</script><img src=x onerror=alert(1)> **<b>oi</b>**')
    expect(el.querySelector('script, img, b')).toBeNull()
    expect(el.textContent).toContain('<script>alert(1)</script>')
    expect(el.querySelector('strong')?.textContent).toBe('<b>oi</b>')
  })

  it.each([
    '[clique](javascript:alert(1))',
    '[clique](javascript:alert`1`)',
    '[clique](JaVaScRiPt:alert`1`)',
    '[clique](data:text/html;base64,PHNjcmlwdD4=)',
    '[clique](vbscript:msgbox)',
    '[clique](//evil.example.com)',
    '[clique](/api/v1/logout)',
    'javascript:alert(1)',
  ])('esquema proibido não vira link: %s', (texto) => {
    const el = html(texto)
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toBe(texto)
  })

  it('aspas no endereço não escapam do atributo', () => {
    const el = html('https://x.com/"onmouseover="alert(1)')
    const a = el.querySelector('a')!
    expect(a.getAttributeNames().sort()).toEqual(['href', 'rel', 'target'])
  })

  it('caractere de controle no esquema é recusado', () => {
    expect(hrefSeguro('java\tscript:alert(1)')).toBeNull()
    expect(hrefSeguro('https://ok.example.com\n')).toBe('https://ok.example.com')
    expect(hrefSeguro('https://')).toBeNull()
    expect(hrefSeguro('mailto:')).toBeNull()
  })

  it('link dentro do rótulo de outro link não aninha âncoras', () => {
    const el = html('[veja https://b.com](https://a.com)')
    expect(el.querySelectorAll('a')).toHaveLength(1)
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://a.com')
  })
})

describe('formatação leve — utilitários', () => {
  it('paraTextoSimples tira os marcadores e desenha a lista com texto', () => {
    expect(paraTextoSimples('**Oi** _você_\n- um\n- dois\n[site](https://a.com)')).toBe(
      'Oi você\n• um\n• dois\nsite (https://a.com)',
    )
    expect(paraTextoSimples('@[user:1] veja', (k) => (k === 'user:1' ? 'Ana' : undefined))).toBe(
      '@Ana veja',
    )
  })

  it('temFormatacao só é verdadeiro quando há marcador de fato', () => {
    expect(temFormatacao('texto comum')).toBe(false)
    expect(temFormatacao('um **forte**')).toBe(true)
    expect(temFormatacao('- item')).toBe(true)
  })

  it('analisarTexto não deixa linha em branco colada na lista', () => {
    const blocos = analisarTexto('a\n\n- x\n\nb')
    expect(blocos.map((b) => b.tipo)).toEqual(['paragrafo', 'lista', 'paragrafo'])
  })
})
