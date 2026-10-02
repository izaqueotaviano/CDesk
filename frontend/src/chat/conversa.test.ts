import { describe, expect, it } from 'vitest'
import {
  destacar,
  ehImagemVisivel,
  estadoDaMensagem,
  imagensColadas,
  primeiraNaoLida,
} from './conversa'

/**
 * As regras que console e portal COMPARTILHAM. Testadas aqui, uma vez, em
 * vez de duas vezes por dentro de cada tela — é o mesmo motivo de o módulo
 * existir ("evite duplicar regras entre o chat principal e o mini chat").
 */

function itemDeColagem(arquivo: File | null, type = 'image/png', kind = 'file'): DataTransferItem {
  return { kind, type, getAsFile: () => arquivo } as unknown as DataTransferItem
}
const listaDeItens = (itens: DataTransferItem[]) => itens as unknown as DataTransferItemList

const QUANDO = new Date('2026-03-04T09:07:05')

describe('imagensColadas', () => {
  it('dá nome com carimbo de hora ao print anônimo', () => {
    // Cinco prints colados numa conversa ficariam todos "image.png" e
    // indistinguíveis na hora de baixar — o nome é o que os separa.
    const achados = imagensColadas(
      listaDeItens([itemDeColagem(new File([''], 'image.png', { type: 'image/png' }))]),
      QUANDO,
    )
    expect(achados).toHaveLength(1)
    expect(achados[0].name).toBe('captura-20260304090705.png')
  })

  it('respeita o nome verdadeiro de um arquivo copiado do gerenciador', () => {
    const achados = imagensColadas(
      listaDeItens([itemDeColagem(new File([''], 'contrato-assinado.png', { type: 'image/png' }))]),
      QUANDO,
    )
    expect(achados[0].name).toBe('contrato-assinado.png')
  })

  it('ignora o texto colado — só imagem vira anexo', () => {
    expect(
      imagensColadas(listaDeItens([itemDeColagem(null, 'text/plain', 'string')]), QUANDO),
    ).toEqual([])
  })

  it('preserva a extensão pelo tipo, não pelo nome', () => {
    const achados = imagensColadas(
      listaDeItens([itemDeColagem(new File([''], 'image.png', { type: 'image/jpeg' }), 'image/jpeg')]),
      QUANDO,
    )
    expect(achados[0].name.endsWith('.jpg')).toBe(true)
  })

  it('sem área de transferência não quebra', () => {
    expect(imagensColadas(null, QUANDO)).toEqual([])
  })
})

describe('estadoDaMensagem', () => {
  const base = { id: 1, read_at: null, delivered_at: null }

  it('sem carimbo nenhum é "enviada" — nunca "entregue"', () => {
    // O servidor sabe que GRAVOU, não que alguém recebeu. Dizer "entregue"
    // aqui seria prometer uma coisa e medir outra.
    expect(estadoDaMensagem(base)).toBe('enviada')
  })

  it('com `delivered_at` vira "entregue"', () => {
    expect(estadoDaMensagem({ ...base, delivered_at: '2026-03-04T09:00:00Z' })).toBe('entregue')
  })

  it('lida ganha de entregue', () => {
    expect(
      estadoDaMensagem({
        ...base,
        delivered_at: '2026-03-04T09:00:00Z',
        read_at: '2026-03-04T09:01:00Z',
      }),
    ).toBe('lida')
  })
})

describe('primeiraNaoLida', () => {
  const msg = (id: number, interna: boolean, lida: string | null, sistema = false) => ({
    id,
    author_is_internal: interna,
    read_at: lida,
    is_system: sistema,
  })

  it('acha a primeira não lida do OUTRO lado', () => {
    const regua = primeiraNaoLida(
      [msg(1, false, '2026-01-01'), msg(2, false, null), msg(3, false, null)],
      true, // sou interno: o "outro lado" é o cliente
    )
    expect(regua).toBe(2)
  })

  it('a própria mensagem não conta — ninguém tem novidade do que escreveu', () => {
    expect(primeiraNaoLida([msg(1, true, null), msg(2, false, null)], true)).toBe(2)
  })

  it('mensagem de sistema não abre a régua', () => {
    expect(primeiraNaoLida([msg(1, false, null, true), msg(2, false, null)], true)).toBe(2)
  })

  it('tudo lido devolve null — sem régua', () => {
    expect(primeiraNaoLida([msg(1, false, '2026-01-01')], true)).toBeNull()
  })

  it('do lado do cliente o "outro lado" é o suporte', () => {
    expect(primeiraNaoLida([msg(1, false, null), msg(2, true, null)], false)).toBe(2)
  })
})

describe('destacar', () => {
  it('quebra o corpo nos trechos que casam', () => {
    expect(destacar('o boleto e o BOLETO', 'boleto')).toEqual([
      { texto: 'o ', destacado: false },
      { texto: 'boleto', destacado: true },
      { texto: ' e o ', destacado: false },
      { texto: 'BOLETO', destacado: true },
    ])
  })

  it('termo com caracteres de regex não quebra nem casa errado', () => {
    // Este é o motivo de a função não montar uma RegExp com o que a pessoa
    // digitou: "R$ 1.000 (?)" viraria uma regex inválida.
    const pedacos = destacar('total: R$ 1.000 (?) hoje', 'R$ 1.000 (?)')
    expect(pedacos.filter((p) => p.destacado).map((p) => p.texto)).toEqual(['R$ 1.000 (?)'])
  })

  it('sem termo devolve o corpo inteiro sem destaque', () => {
    expect(destacar('nada aqui', '  ')).toEqual([{ texto: 'nada aqui', destacado: false }])
  })

  it('termo que não existe devolve o corpo inteiro', () => {
    expect(destacar('nada aqui', 'zzz')).toEqual([{ texto: 'nada aqui', destacado: false }])
  })
})

describe('ehImagemVisivel', () => {
  it('imagem liberada pela varredura vira miniatura', () => {
    expect(ehImagemVisivel({ content_type: 'image/png', is_downloadable: true })).toBe(true)
  })

  it('imagem em quarentena NÃO vira miniatura', () => {
    // Renderizar a <img> baixaria o arquivo — seria servi-lo pela porta da
    // frente justamente enquanto a quarentena o segura (D19).
    expect(ehImagemVisivel({ content_type: 'image/png', is_downloadable: false })).toBe(false)
  })

  it('PDF liberado continua sendo link, não miniatura', () => {
    expect(ehImagemVisivel({ content_type: 'application/pdf', is_downloadable: true })).toBe(false)
  })
})
