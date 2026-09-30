/**
 * Catálogo de atalhos de teclado do console — a FONTE ÚNICA de quais teclas
 * existem, o que fazem e em que tela valem.
 *
 * Dois consumidores leem daqui, e é por isso que é um arquivo só:
 *  - o painel "Atalhos de teclado" (`PainelAtalhos`, aberto com `?`), que
 *    lista tudo;
 *  - o despachante (`registro.ts` / `useAtalhos`), que só reconhece uma
 *    sequência se ela estiver aqui. Tela nenhuma inventa tecla por fora: se
 *    não está no catálogo, o painel mentiria sobre ela.
 *
 * Cada atalho tem uma ou mais `combinacoes` (alternativas), e cada combinação
 * é uma SEQUÊNCIA de teclas: `['g', 'i']` é "g, depois i". Os nomes são os
 * de `KeyboardEvent.key` (`Escape`, `Enter`, `?`, `[`). `mod+z` é Ctrl+Z no
 * Windows/Linux e ⌘Z no Mac — o único atalho com modificador, porque é o
 * gesto universal de desfazer.
 *
 * `quemImplementa` é documentação: a lista de tickets implementa as próprias
 * teclas (j/k/Enter/o/x); aqui elas só aparecem para o painel ser completo.
 */

export type IdAtalho =
  | 'geral.ajuda'
  | 'geral.busca'
  | 'geral.ir-inicio'
  | 'geral.ir-tickets'
  | 'geral.ir-chats'
  | 'geral.ir-quadro'
  | 'geral.fechar'
  | 'geral.desfazer'
  | 'lista.proximo'
  | 'lista.anterior'
  | 'lista.abrir'
  | 'lista.selecionar'
  | 'ticket.responder'
  | 'ticket.nota'
  | 'ticket.atribuir'
  | 'ticket.encerrar'
  | 'ticket.anterior'
  | 'ticket.proximo'

export interface DefinicaoAtalho {
  id: IdAtalho
  /** Alternativas; cada uma é uma sequência de teclas. */
  combinacoes: string[][]
  descricao: string
  /** Quem registra o comportamento — só documentação. */
  quemImplementa: 'shell' | 'lista' | 'ticket'
}

export interface GrupoAtalhos {
  id: 'geral' | 'lista' | 'ticket'
  titulo: string
  atalhos: DefinicaoAtalho[]
}

export const GRUPOS_ATALHOS: GrupoAtalhos[] = [
  {
    id: 'geral',
    titulo: 'Geral',
    atalhos: [
      { id: 'geral.ajuda', combinacoes: [['?']], descricao: 'Mostra os atalhos', quemImplementa: 'shell' },
      { id: 'geral.busca', combinacoes: [['/']], descricao: 'Busca e navegação', quemImplementa: 'shell' },
      { id: 'geral.ir-inicio', combinacoes: [['g', 'i']], descricao: 'Vai para o Início', quemImplementa: 'shell' },
      { id: 'geral.ir-tickets', combinacoes: [['g', 't']], descricao: 'Vai para Tickets', quemImplementa: 'shell' },
      { id: 'geral.ir-chats', combinacoes: [['g', 'c']], descricao: 'Vai para Chats', quemImplementa: 'shell' },
      { id: 'geral.ir-quadro', combinacoes: [['g', 'q']], descricao: 'Vai para o Quadro', quemImplementa: 'shell' },
      {
        id: 'geral.fechar',
        combinacoes: [['Escape']],
        descricao: 'Fecha o painel ou a janela aberta',
        quemImplementa: 'shell',
      },
      {
        id: 'geral.desfazer',
        combinacoes: [['mod+z']],
        descricao: 'Desfaz a última ação enquanto o aviso estiver na tela',
        quemImplementa: 'ticket',
      },
    ],
  },
  {
    id: 'lista',
    titulo: 'Lista de tickets',
    atalhos: [
      { id: 'lista.proximo', combinacoes: [['j']], descricao: 'Próximo ticket', quemImplementa: 'lista' },
      { id: 'lista.anterior', combinacoes: [['k']], descricao: 'Ticket anterior', quemImplementa: 'lista' },
      {
        id: 'lista.abrir',
        combinacoes: [['Enter'], ['o']],
        descricao: 'Abre o ticket em foco',
        quemImplementa: 'lista',
      },
      { id: 'lista.selecionar', combinacoes: [['x']], descricao: 'Seleciona o ticket em foco', quemImplementa: 'lista' },
    ],
  },
  {
    id: 'ticket',
    titulo: 'Ticket aberto',
    atalhos: [
      { id: 'ticket.responder', combinacoes: [['r']], descricao: 'Responde ao cliente', quemImplementa: 'ticket' },
      { id: 'ticket.nota', combinacoes: [['n']], descricao: 'Escreve uma nota interna', quemImplementa: 'ticket' },
      { id: 'ticket.atribuir', combinacoes: [['a']], descricao: 'Atribui a você', quemImplementa: 'ticket' },
      { id: 'ticket.encerrar', combinacoes: [['e']], descricao: 'Fecha o ticket', quemImplementa: 'ticket' },
      {
        id: 'ticket.anterior',
        combinacoes: [['[']],
        descricao: 'Ticket anterior em Trabalhando agora',
        quemImplementa: 'ticket',
      },
      {
        id: 'ticket.proximo',
        combinacoes: [[']']],
        descricao: 'Próximo ticket em Trabalhando agora',
        quemImplementa: 'ticket',
      },
    ],
  },
]

export const ATALHOS: DefinicaoAtalho[] = GRUPOS_ATALHOS.flatMap((g) => g.atalhos)

export function definicaoDe(id: IdAtalho): DefinicaoAtalho {
  const def = ATALHOS.find((a) => a.id === id)
  if (!def) throw new Error(`Atalho fora do catálogo: ${id}`)
  return def
}

function ehMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

/** Como a tecla aparece escrita para a pessoa (no `<kbd>`). */
export function rotuloDaTecla(tecla: string): string {
  if (tecla === 'Escape') return 'Esc'
  if (tecla.startsWith('mod+')) {
    return `${ehMac() ? '⌘' : 'Ctrl'} ${tecla.slice(4).toUpperCase()}`
  }
  return tecla
}

/** Texto curto para `title`/`aria-keyshortcuts`-like: "g depois i", "Enter ou o". */
export function descreverCombinacoes(def: DefinicaoAtalho): string {
  return def.combinacoes
    .map((seq) => seq.map(rotuloDaTecla).join(' depois '))
    .join(' ou ')
}
