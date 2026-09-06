import type { SistemaCfg } from '@/cvz/configuracoes/dados'
import { tamanhoArquivo } from './detalhe/linhaDoTempo'

/**
 * A conferência de anexo das telas de chamado, num lugar só.
 *
 * Nasceu duplicada: a abertura e o compositor do detalhe ganharam versões
 * próprias na mesma rodada, e elas já discordavam em três pontos — a abertura
 * não recusava extensão bloqueada (um `.sh` subia inteiro para o servidor
 * recusar), cada uma tinha uma política diferente para "a configuração ainda
 * não chegou", e o limite era formatado por contas diferentes. Duas conferências
 * divergentes para a mesma regra é a mesma pessoa vendo respostas diferentes na
 * mesma sessão.
 *
 * A regra continua sendo do BACKEND (`validar_uploads` em
 * apps/tickets/services/attachments.py, que a view chama antes de criar o
 * chamado ou a mensagem). Aqui é só a mesma conferência adiantada, para não
 * gastar a viagem: subir 15 MB numa conexão de escritório para ler "não pode"
 * é a pessoa esperando à toa.
 */

export interface LimitesAnexo {
  maxBytes: number
  maxMb: number
  maxBytesPorMensagem: number
  maxMbPorMensagem: number
  maxArquivos: number
}

/**
 * Cópia de `BLOCKED_SUFFIXES` (apps/tickets/services/attachments.py): extensão
 * perigosa é recusada lá mesmo que os magic bytes digam outra coisa. O resto da
 * allowlist é POR MAGIC BYTES e só o servidor consegue conferir — por isso a
 * tela nunca promete que o arquivo passou, só evita a viagem óbvia.
 */
export const EXTENSOES_BLOQUEADAS = [
  '.exe',
  '.dll',
  '.so',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.msi',
  '.sh',
  '.ps1',
  '.jar',
  '.app',
  '.deb',
  '.rpm',
]

/**
 * Limites do SERVIDOR (`SystemConfig`, apps/core/models.py — o endpoint é
 * aberto a qualquer interno). São CONFIGURÁVEIS pelo admin, e é por isso que
 * devolve `null` enquanto a configuração não chegou, em vez de cair num
 * padrão: se o admin subiu o teto para 50 MB, conferir contra um 10 MB
 * chutado recusaria um arquivo que o servidor aceitaria — e disso a pessoa
 * não tem como escapar.
 *
 * O contrário (deixar passar e o servidor recusar) custa uma viagem perdida e
 * devolve um erro honesto, sem criar nada: desde que `validar_uploads` roda
 * antes da criação, um anexo recusado não deixa mais chamado nem mensagem
 * órfã. Entre bloquear o que era válido e gastar uma viagem numa janela de
 * milissegundos, a viagem é o erro mais barato.
 *
 * O MB anunciado é DERIVADO dos bytes com a mesma divisão inteira do
 * `SystemConfigSerializer` (apps/core/views.py:157-161), em vez de ler os
 * campos `_mb` que vêm juntos: assim o número que a tela mostra e o número
 * contra o qual ela compara não têm como divergir, e continua sendo o mesmo
 * que a tela de Configurações exibe.
 */
export function limitesDeAnexo(cfg: SistemaCfg | undefined): LimitesAnexo | null {
  if (!cfg) return null
  const emMb = (bytes: number) => Math.floor(bytes / 1024 / 1024)
  return {
    maxBytes: cfg.attachment_max_bytes,
    maxMb: emMb(cfg.attachment_max_bytes),
    maxBytesPorMensagem: cfg.attachment_max_bytes_per_message,
    maxMbPorMensagem: emMb(cfg.attachment_max_bytes_per_message),
    maxArquivos: cfg.attachment_max_files_per_message,
  }
}

/**
 * Confere o que a pessoa acabou de escolher e devolve o que entra e o porquê
 * de cada recusa. Com `limites` nulo (configuração ainda não carregada) aceita
 * tudo — ver o porquê em `limitesDeAnexo`.
 *
 * A ordem é contagem → tamanho → extensão → soma. A CONTAGEM é conferida
 * arquivo a arquivo, não em lote como no servidor: aqui a pessoa está somando
 * à seleção que já tinha, e recusar o lote inteiro jogaria fora os arquivos
 * que cabiam.
 */
export function conferirAnexos(
  jaEscolhidos: File[],
  novos: File[],
  limites: LimitesAnexo | null,
): { aceitos: File[]; recusas: string[] } {
  if (!limites) return { aceitos: novos, recusas: [] }

  const aceitos: File[] = []
  const recusas: string[] = []
  let total = jaEscolhidos.reduce((soma, f) => soma + f.size, 0)
  let quantos = jaEscolhidos.length

  for (const arquivo of novos) {
    if (quantos >= limites.maxArquivos) {
      recusas.push(
        `Máximo de ${limites.maxArquivos} arquivo(s) por mensagem: “${arquivo.name}” ficou de fora.`,
      )
      continue
    }
    if (arquivo.size > limites.maxBytes) {
      recusas.push(
        `“${arquivo.name}” tem ${tamanhoArquivo(arquivo.size)}; o limite por arquivo é ${limites.maxMb} MB.`,
      )
      continue
    }
    const nome = arquivo.name.toLowerCase()
    if (EXTENSOES_BLOQUEADAS.some((ext) => nome.endsWith(ext))) {
      recusas.push(`Tipo de arquivo não permitido: “${arquivo.name}”.`)
      continue
    }
    if (total + arquivo.size > limites.maxBytesPorMensagem) {
      recusas.push(
        `“${arquivo.name}” não cabe: o total passaria de ${limites.maxMbPorMensagem} MB por mensagem.`,
      )
      continue
    }
    aceitos.push(arquivo)
    total += arquivo.size
    quantos += 1
  }
  return { aceitos, recusas }
}
