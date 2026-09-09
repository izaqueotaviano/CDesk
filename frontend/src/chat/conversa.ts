import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { anexarMensagemNoCache, type MensagemChat } from '@/api/chat'
import { ApiError, enviarComProgresso } from '@/api/client'

/**
 * O que o console do agente e o painel do cliente compartilham na conversa.
 *
 * Existe porque o brief é explícito: "evite duplicar regras entre o chat
 * principal e o mini chat". As duas telas desenham com primitivas diferentes
 * (`resolv/` e `portal/` têm componentes próprios), mas as REGRAS — o que
 * conta como imagem colável, quando um envio pode ser repetido, qual é o
 * estado de uma mensagem, onde começa o "não lidas" — são uma só, aqui.
 */

/* ------------------------------------------------------------------ *
 * Colar imagem (Ctrl+V)
 * ------------------------------------------------------------------ */

/** Extensão a partir do MIME, para dar nome a um print que não tem nome. */
const EXTENSAO: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * As imagens de um evento de colar.
 *
 * Um print da área de transferência chega SEM nome ("image.png" genérico do
 * navegador, ou nome vazio). Renomear com a hora resolve o problema real: a
 * pessoa cola cinco prints numa conversa e todos ficariam "image.png" na
 * lista de anexos, indistinguíveis na hora de baixar.
 *
 * Arquivo copiado do gerenciador de arquivos também cai aqui, e aí o nome
 * verdadeiro é mantido — só o print anônimo é que ganha um.
 */
export function imagensColadas(itens: DataTransferItemList | null, agora: Date): File[] {
  if (!itens) return []
  const achados: File[] = []
  for (const item of Array.from(itens)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const arquivo = item.getAsFile()
    if (!arquivo) continue
    const anonimo = !arquivo.name || /^image\.\w+$/i.test(arquivo.name)
    if (!anonimo) {
      achados.push(arquivo)
      continue
    }
    const carimbo = [
      agora.getFullYear(),
      String(agora.getMonth() + 1).padStart(2, '0'),
      String(agora.getDate()).padStart(2, '0'),
      String(agora.getHours()).padStart(2, '0'),
      String(agora.getMinutes()).padStart(2, '0'),
      String(agora.getSeconds()).padStart(2, '0'),
    ].join('')
    const ext = EXTENSAO[arquivo.type] ?? 'png'
    achados.push(
      new File([arquivo], `captura-${carimbo}.${ext}`, { type: arquivo.type }),
    )
  }
  return achados
}

/* ------------------------------------------------------------------ *
 * Fila de anexos: progresso, cancelar, tentar de novo
 * ------------------------------------------------------------------ */

export interface EnvioDeAnexo {
  /** Local e efêmero — o id do servidor só existe depois que sobe. */
  id: string
  arquivo: File
  /** Miniatura local (blob:) enquanto sobe; imagem só. */
  previa: string | null
  progresso: number
  estado: 'enviando' | 'erro' | 'cancelado'
  erro?: string
  /** Sobe como nota interna — o "tentar de novo" precisa lembrar disso. */
  notaInterna?: boolean
}

let sequencia = 0

/**
 * A fila de envios de UM chat.
 *
 * Cada arquivo sobe na sua própria requisição, e não todos num FormData só,
 * por duas razões que aparecem na tela: uma barra por arquivo (num lote,
 * uma barra agregada não diz qual está travado) e cancelar/repetir UM sem
 * derrubar os outros. O sucesso some da fila na hora — a mensagem real já
 * entrou na thread e ter as duas seria a mesma coisa duas vezes.
 */
export function useFilaDeAnexos(chatId: number) {
  const qc = useQueryClient()
  const [fila, setFila] = useState<EnvioDeAnexo[]>([])
  const abortos = useRef(new Map<string, AbortController>())

  const atualizar = useCallback((id: string, mudanca: Partial<EnvioDeAnexo>) => {
    setFila((f) => f.map((e) => (e.id === id ? { ...e, ...mudanca } : e)))
  }, [])

  const subir = useCallback(
    async (envio: EnvioDeAnexo, texto?: string, replyTo?: number | null, notaInterna = false) => {
      const controle = new AbortController()
      abortos.current.set(envio.id, controle)
      const form = new FormData()
      form.append('files', envio.arquivo)
      if (texto) form.append('body', texto)
      if (replyTo != null) form.append('reply_to', String(replyTo))
      if (notaInterna) form.append('is_internal_note', 'true')
      try {
        const msg = await enviarComProgresso<MensagemChat>(
          `/api/v1/chat/chats/${chatId}/files/`,
          form,
          { signal: controle.signal, onProgresso: (p) => atualizar(envio.id, { progresso: p }) },
        )
        anexarMensagemNoCache(qc, chatId, msg)
        // some da fila: a mensagem de verdade já está na thread
        setFila((f) => f.filter((e) => e.id !== envio.id))
        if (envio.previa) URL.revokeObjectURL(envio.previa)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setFila((f) => f.filter((x) => x.id !== envio.id))
          if (envio.previa) URL.revokeObjectURL(envio.previa)
          return
        }
        atualizar(envio.id, {
          estado: 'erro',
          erro:
            e instanceof ApiError
              ? (e.detail ?? e.fieldErrors?.files?.[0] ?? 'Não foi possível enviar.')
              : 'Não foi possível enviar.',
        })
      } finally {
        abortos.current.delete(envio.id)
      }
    },
    [atualizar, chatId, qc],
  )

  const enviar = useCallback(
    (
      arquivos: File[],
      opcoes: { texto?: string; replyTo?: number | null; notaInterna?: boolean } = {},
    ) => {
      const novos: EnvioDeAnexo[] = arquivos.map((arquivo) => ({
        id: `envio-${++sequencia}`,
        arquivo,
        previa: arquivo.type.startsWith('image/') ? URL.createObjectURL(arquivo) : null,
        progresso: 0,
        estado: 'enviando' as const,
        notaInterna: opcoes.notaInterna,
      }))
      setFila((f) => [...f, ...novos])
      // o texto do compositor vai junto do PRIMEIRO: repetir a mesma legenda
      // em cada arquivo mandaria a frase três vezes para o cliente
      novos.forEach((envio, i) => {
        void subir(
          envio,
          i === 0 ? opcoes.texto : undefined,
          i === 0 ? opcoes.replyTo : null,
          // o modo vale para TODOS: metade dos anexos indo para o cliente
          // porque a fila perdeu a marca no segundo arquivo é o defeito que
          // esta linha existe para não ter
          opcoes.notaInterna,
        )
      })
      return novos.length
    },
    [subir],
  )

  const cancelar = useCallback((id: string) => {
    abortos.current.get(id)?.abort()
    setFila((f) => f.filter((e) => e.id !== id))
  }, [])

  const repetir = useCallback(
    (id: string) => {
      const envio = fila.find((e) => e.id === id)
      if (!envio) return
      atualizar(id, { estado: 'enviando', progresso: 0, erro: undefined })
      void subir({ ...envio, estado: 'enviando', progresso: 0 }, undefined, null, envio.notaInterna)
    },
    [atualizar, fila, subir],
  )

  const descartar = useCallback((id: string) => {
    setFila((f) => f.filter((e) => e.id !== id))
  }, [])

  return { fila, enviar, cancelar, repetir, descartar, ocupada: fila.some((e) => e.estado === 'enviando') }
}

/* ------------------------------------------------------------------ *
 * Estado de uma mensagem própria
 * ------------------------------------------------------------------ */

export type EstadoDaMensagem = 'enviando' | 'enviada' | 'entregue' | 'lida' | 'falha'

/**
 * A escada de status, e ela só existe para QUEM ESCREVEU.
 *
 * "Entregue" vem de `delivered_at`, carimbado pelo destinatário quando a
 * mensagem chega no aparelho dele — não do INSERT no servidor. Um indicador
 * que dissesse "entregue" porque o banco gravou estaria prometendo uma coisa
 * e medindo outra, e é exatamente nessa diferença que alguém confia na hora
 * de decidir se repete a pergunta.
 */
export function estadoDaMensagem(
  msg: Pick<MensagemChat, 'id' | 'read_at' | 'delivered_at'>,
): EstadoDaMensagem {
  if (msg.read_at) return 'lida'
  if (msg.delivered_at) return 'entregue'
  return 'enviada'
}

export const ROTULO_DO_ESTADO: Record<EstadoDaMensagem, string> = {
  enviando: 'Enviando',
  enviada: 'Enviada',
  entregue: 'Entregue',
  lida: 'Lida',
  falha: 'Não enviada',
}

export const ICONE_DO_ESTADO: Record<EstadoDaMensagem, string> = {
  enviando: 'ti-clock',
  enviada: 'ti-check',
  entregue: 'ti-checks',
  lida: 'ti-checks',
  falha: 'ti-alert-circle',
}

/* ------------------------------------------------------------------ *
 * Divisor de não lidas
 * ------------------------------------------------------------------ */

/**
 * O id da primeira mensagem não lida do OUTRO lado — onde vai a régua
 * "Novas mensagens".
 *
 * `null` quando não há nenhuma. A régua é calculada uma vez e congelada por
 * quem chama: recalcular a cada render faria a linha subir sozinha enquanto a
 * pessoa lê, que é o oposto do que ela serve.
 */
export function primeiraNaoLida(
  mensagens: Pick<MensagemChat, 'id' | 'read_at' | 'is_system' | 'author_is_internal'>[],
  souInterno: boolean,
): number | null {
  const daOutraParte = (m: { is_system: boolean; author_is_internal: boolean }) =>
    !m.is_system && m.author_is_internal !== souInterno
  return mensagens.find((m) => daOutraParte(m) && m.read_at === null)?.id ?? null
}

/* ------------------------------------------------------------------ *
 * Destaque da busca
 * ------------------------------------------------------------------ */

export interface PedacoDeTexto {
  texto: string
  destacado: boolean
}

/**
 * Quebra o corpo nos trechos que casam com o termo, para a tela envolver os
 * casados em <mark>.
 *
 * Feito na mão em vez de regex com o termo interpolado: o termo vem de quem
 * digita, e "R$ 1.000 (?)" viraria uma regex inválida — ou pior, uma que casa
 * o que não devia. Comparação por índice, sem acento removido, é o que o
 * `icontains` do servidor faz do outro lado; as duas metades combinam.
 */
export function destacar(corpo: string, termo: string): PedacoDeTexto[] {
  const alvo = termo.trim()
  if (!alvo) return [{ texto: corpo, destacado: false }]
  const minusculo = corpo.toLowerCase()
  const agulha = alvo.toLowerCase()
  const pedacos: PedacoDeTexto[] = []
  let cursor = 0
  for (;;) {
    const achado = minusculo.indexOf(agulha, cursor)
    if (achado === -1) break
    if (achado > cursor) pedacos.push({ texto: corpo.slice(cursor, achado), destacado: false })
    pedacos.push({ texto: corpo.slice(achado, achado + agulha.length), destacado: true })
    cursor = achado + agulha.length
  }
  if (cursor < corpo.length) pedacos.push({ texto: corpo.slice(cursor), destacado: false })
  return pedacos.length > 0 ? pedacos : [{ texto: corpo, destacado: false }]
}

/** Só imagem LIBERADA pela varredura vira miniatura — o resto continua link. */
export function ehImagemVisivel(arquivo: {
  content_type: string
  is_downloadable: boolean
}): boolean {
  return arquivo.is_downloadable && arquivo.content_type.startsWith('image/')
}
