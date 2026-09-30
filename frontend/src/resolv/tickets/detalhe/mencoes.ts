import type { Edicao } from '@/ui/edicaoFormatada'
import type { AlvoMencao, Mencao } from './tiposDetalhe'

/**
 * @menção no compositor — as regras puras, separadas da tela para caberem num
 * teste sem montar nada.
 *
 * O servidor lê a menção numa marcação inerte, `@[user:12]` / `@[team:3]`
 * (apps/tickets/services/mentions.py, `MARCACAO`), e SÓ em nota interna. Quem
 * escreve, porém, nunca vê a marcação: o campo mostra `@Izaque Sá`, e a troca
 * pelo id acontece no envio (`paraMarcacao`). Assim o texto no campo é o
 * mesmo que a pessoa leria depois, o rascunho continua legível, e digitar o
 * nome inteiro à mão também menciona.
 */

/** O `@` que está sendo digitado agora, e o que já foi escrito depois dele. */
export interface ConsultaMencao {
  /** Posição do `@` no texto. */
  inicio: number
  consulta: string
}

/**
 * Há um `@` em aberto logo antes do cursor? Só conta `@` no começo de palavra
 * (depois de espaço, quebra ou parêntese): `ana@acme.com` não abre a lista.
 * A consulta pode ter espaço — nome e sobrenome — mas não quebra de linha.
 */
export function consultaDeMencao(texto: string, cursor: number): ConsultaMencao | null {
  const antes = texto.slice(0, cursor)
  const m = antes.match(/(^|[\s(])@([^\s@[\]()][^@\n[\]()]{0,39})?$/)
  if (!m) return null
  const consulta = m[2] ?? ''
  return { inicio: cursor - consulta.length - 1, consulta }
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Chave da marcação, a mesma que o servidor devolve em `mentions[].key`. */
export function chaveDoAlvo(alvo: Pick<AlvoMencao, 'type' | 'id'>): string {
  return `${alvo.type}:${alvo.id}`
}

/**
 * Filtra a lista (que já vem na ordem certa do servidor: quem está no caso,
 * a equipe, os outros, as equipes) sem desfazer essa ordem — só sobe quem
 * começa com o que foi digitado. Sem acento e sem caixa: "joao" acha "João".
 */
export function filtrarAlvos(alvos: AlvoMencao[], consulta: string, limite = 8): AlvoMencao[] {
  const q = normalizar(consulta.trim())
  if (!q) return alvos.slice(0, limite)
  const pontuados = alvos
    .map((alvo, ordem) => {
      const nome = normalizar(alvo.name)
      const email = normalizar(alvo.email ?? '')
      let nota = -1
      if (nome.startsWith(q)) nota = 0
      else if (nome.split(/\s+/).some((p) => p.startsWith(q))) nota = 1
      else if (nome.includes(q) || email.startsWith(q)) nota = 2
      return { alvo, ordem, nota }
    })
    .filter((x) => x.nota >= 0)
  pontuados.sort((a, b) => a.nota - b.nota || a.ordem - b.ordem)
  return pontuados.slice(0, limite).map((x) => x.alvo)
}

/** Troca o `@consulta` pelo nome escolhido (com um espaço para seguir escrevendo). */
export function inserirMencao(
  texto: string,
  consulta: ConsultaMencao,
  cursor: number,
  alvo: Pick<AlvoMencao, 'name'>,
): Edicao {
  const trecho = `@${alvo.name} `
  const fim = texto[cursor] === ' ' ? cursor + 1 : cursor
  return {
    inicio: consulta.inicio,
    fim,
    trecho,
    selecao: [consulta.inicio + trecho.length, consulta.inicio + trecho.length],
  }
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `@Nome Completo` → `@[user:12]`, para os nomes conhecidos. `escolhidos` são
 * as escolhas feitas na lista nesta sessão (nome → chave) e ganham de um
 * homônimo; o resto casa pela lista do servidor, na ordem dela. Nome mais
 * longo primeiro, para "Ana Paula" não virar "Ana" + " Paula".
 */
export function paraMarcacao(
  texto: string,
  alvos: AlvoMencao[],
  escolhidos: ReadonlyMap<string, string> = new Map(),
): string {
  const porNome = new Map<string, string>(escolhidos)
  for (const a of alvos) if (!porNome.has(a.name)) porNome.set(a.name, chaveDoAlvo(a))
  const nomes = [...porNome.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  if (nomes.length === 0) return texto
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}_@])@(${nomes.map(escaparRegex).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  )
  return texto.replace(re, (_, antes: string, nome: string) => `${antes}@[${porNome.get(nome)}]`)
}

/**
 * O caminho de volta, para CORRIGIR uma nota já enviada: o corpo guardado
 * tem `@[user:12]`, e o campo de edição deve mostrar `@Izaque Sá`, como no
 * compositor. Devolve também o mapa nome → chave que `paraMarcacao` usa ao
 * salvar, para a menção continuar sendo a MESMA pessoa mesmo que outra tenha
 * nome parecido. Marcação sem nome conhecido (pessoa removida) fica crua.
 */
export function deMarcacao(
  texto: string,
  mencoes: readonly Pick<Mencao, 'key' | 'name'>[] = [],
): { texto: string; escolhidos: Map<string, string> } {
  const porChave = new Map(mencoes.map((m) => [m.key, m.name]))
  const escolhidos = new Map<string, string>()
  const legivel = texto.replace(/@\[((?:user|team):\d+)\]/g, (cru, chave: string) => {
    const nome = porChave.get(chave)
    if (!nome) return cru
    escolhidos.set(nome, chave)
    return `@${nome}`
  })
  return { texto: legivel, escolhidos }
}
