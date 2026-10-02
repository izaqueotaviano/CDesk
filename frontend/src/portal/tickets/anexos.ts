import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfigChat } from '@/api/chat'
import { conferirAnexos, type LimitesAnexo } from '@/resolv/tickets/anexos'
import type { LimitesAnexoServidor } from '../api/chats'

/**
 * Anexos que a pessoa escolheu e ainda NÃO enviou — abertura de chamado e
 * resposta. Três entradas (botão, arrastar e soltar, Ctrl+V com um print) e
 * uma regra só de conferência: `conferirAnexos`, a mesma do console, que
 * adianta o que o servidor recusaria (tamanho, quantidade, soma, extensão
 * perigosa) sem gastar a viagem.
 */

/**
 * O piso do produto (`SystemConfig`, apps/core/models.py): 10 MB por
 * arquivo, 10 por mensagem, 100 MB somados. Só vale enquanto a configuração
 * do servidor não chegou — ou quando o backend ainda não a manda.
 */
const PADRAO: LimitesAnexo = {
  maxBytes: 10 * 1024 * 1024,
  maxMb: 10,
  maxBytesPorMensagem: 100 * 1024 * 1024,
  maxMbPorMensagem: 100,
  maxArquivos: 10,
}

/** Os tipos que o servidor aceita (`ATTACHMENT_ALLOWED_MIME`) — o `accept`
 *  do seletor. Quem arrasta outro tipo recebe a recusa do servidor com o
 *  motivo; o seletor só evita a escolha óbvia. */
export const TIPOS_ACEITOS_PORTAL = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  '.docx',
  '.xlsx',
  '.pptx',
].join(',')

export function limitesDoServidor(cfg: LimitesAnexoServidor | undefined): LimitesAnexo {
  if (!cfg) return PADRAO
  const emMb = (bytes: number) => Math.floor(bytes / 1024 / 1024)
  return {
    maxBytes: cfg.max_bytes,
    maxMb: emMb(cfg.max_bytes),
    maxBytesPorMensagem: cfg.max_bytes_per_message,
    maxMbPorMensagem: emMb(cfg.max_bytes_per_message),
    maxArquivos: cfg.max_files_per_message,
  }
}

/** Os limites que o servidor aplica agora, lidos da configuração do chat
 *  (a fatia que o cliente pode ler). */
export function useLimitesAnexo(): LimitesAnexo {
  const { data } = useConfigChat()
  return limitesDoServidor((data as { attachment_limits?: LimitesAnexoServidor } | undefined)?.attachment_limits)
}

/** A frase de ajuda sob o botão — com os números de verdade. */
export function descricaoDosLimites(l: LimitesAnexo): string {
  return `Imagens, PDF, Office, TXT, CSV ou ZIP. Até ${l.maxMb} MB por arquivo, ${l.maxArquivos} arquivos por mensagem.`
}

const IMAGEM = /^image\/(png|jpeg|gif|webp)$/

export interface AnexoLocal {
  id: string
  arquivo: File
  /** Miniatura (blob:) — só imagem. Revogada ao remover e ao desmontar. */
  previa: string | null
}

let sequencia = 0

function criarPrevia(arquivo: File): string | null {
  if (!IMAGEM.test(arquivo.type) || typeof URL.createObjectURL !== 'function') return null
  try {
    return URL.createObjectURL(arquivo)
  } catch {
    return null
  }
}

function revogar(previa: string | null) {
  if (previa && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previa)
}

export function useAnexosLocais(limites: LimitesAnexo) {
  const [anexos, setAnexos] = useState<AnexoLocal[]>([])
  const [recusas, setRecusas] = useState<string[]>([])
  const vivos = useRef<AnexoLocal[]>([])

  useEffect(() => {
    vivos.current = anexos
  }, [anexos])

  // miniatura é memória do navegador: some com a tela
  useEffect(() => () => vivos.current.forEach((a) => revogar(a.previa)), [])

  const adicionar = useCallback(
    (novos: File[]) => {
      if (novos.length === 0) return
      const { aceitos, recusas: motivos } = conferirAnexos(
        vivos.current.map((a) => a.arquivo),
        novos,
        limites,
      )
      const entrada = aceitos.map((arquivo) => ({ id: `anexo-${++sequencia}`, arquivo, previa: criarPrevia(arquivo) }))
      vivos.current = [...vivos.current, ...entrada]
      setAnexos(vivos.current)
      setRecusas(motivos)
    },
    [limites],
  )

  const remover = useCallback((id: string) => {
    const alvo = vivos.current.find((a) => a.id === id)
    revogar(alvo?.previa ?? null)
    vivos.current = vivos.current.filter((a) => a.id !== id)
    setAnexos(vivos.current)
    setRecusas([])
  }, [])

  const limpar = useCallback(() => {
    vivos.current.forEach((a) => revogar(a.previa))
    vivos.current = []
    setAnexos([])
    setRecusas([])
  }, [])

  return { anexos, arquivos: anexos.map((a) => a.arquivo), recusas, adicionar, remover, limpar }
}

/** O que veio num arrastar: só ARQUIVOS (texto arrastado de outra aba não
 *  vira anexo). */
export function arquivosArrastados(dados: DataTransfer | null): File[] {
  if (!dados) return []
  return Array.from(dados.files ?? [])
}

/** Arrastar com arquivo dentro? `types` é o único dado disponível durante o
 *  `dragover` — o conteúdo só é liberado no `drop`. */
export function temArquivo(dados: DataTransfer | null): boolean {
  return !!dados && Array.from(dados.types ?? []).includes('Files')
}
