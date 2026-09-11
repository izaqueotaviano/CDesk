import { useEffect } from 'react'
import type { Prioridade } from '../tipos'

/**
 * Rascunho da abertura de chamado, no localStorage.
 *
 * Existe porque a tela só tinha `beforeunload`, que o navegador só dispara ao
 * fechar a aba ou recarregar: clicar na Sidebar, abrir o sino ou ter a sessão
 * expirada é navegação dentro do SPA e levava junto a mensagem inteira e o
 * painel de triagem — sem confirmação nenhuma. Não há `useBlocker` neste
 * front (o router não é o de dados), então a saída é a mesma do compositor do
 * detalhe: guardar o que foi escrito e devolver na volta.
 *
 * O que NÃO cabe aqui: os anexos. `File` não serializa e o navegador não
 * devolve o conteúdo de um arquivo sem a pessoa escolher de novo — ficam só
 * os nomes, para o aviso poder dizer o que precisa ser reanexado.
 */

/** Mesmo prefixo de `resolv:tabs` (src/stores/tabs.ts). */
const CHAVE = 'resolv:novo-chamado'

/** No dia em que um campo mudar de tipo, esta versão decide o que fazer com o
 *  que está gravado; sem ela um rascunho antigo volta como dado corrompido em
 *  silêncio — mesmo motivo do `version` em stores/tabs.ts. */
const VERSAO = 1

/** Gravar a cada tecla escreveria no disco por letra digitada e não muda nada
 *  para quem sai da tela; é a folga que o compositor do detalhe já usa
 *  (detalhe/Compositor.tsx). */
const FOLGA_MS = 300

export interface Rascunho {
  empresaId: number | null
  solicitanteId: number | null
  equipeId: string
  assunto: string
  texto: string
  prioridade: Prioridade
  servicoId: string
  categoriaId: string
  numeroPedido: string
  responsavelId: string
  tagIds: number[]
  assinaturaLigada: boolean
  /** Só os nomes — ver o cabeçalho do arquivo. */
  anexos: string[]
}

/** O formulário recém-aberto. Serve de padrão para restaurar um rascunho
 *  gravado por uma versão que não tinha algum campo, e de referência do que
 *  conta como "mexido". */
export const RASCUNHO_VAZIO: Rascunho = {
  empresaId: null,
  solicitanteId: null,
  equipeId: '',
  assunto: '',
  texto: '',
  prioridade: 'normal',
  servicoId: '',
  categoriaId: '',
  numeroPedido: '',
  responsavelId: '',
  tagIds: [],
  assinaturaLigada: true,
  anexos: [],
}

/**
 * Qualquer diferença para o formulário recém-aberto é trabalho que não pode
 * sumir sem aviso. Olha TODOS os campos de propósito: a versão anterior só
 * via assunto, texto, solicitante e anexos, então quem tinha montado a
 * triagem inteira (equipe, serviço, categoria, urgência, responsável,
 * etiquetas, nº do pedido) saía da tela sem nem o diálogo do navegador.
 */
export function estaSujo(r: Rascunho): boolean {
  return (
    r.assunto.trim() !== '' ||
    r.texto.trim() !== '' ||
    r.numeroPedido.trim() !== '' ||
    r.anexos.length > 0 ||
    r.tagIds.length > 0 ||
    r.empresaId != null ||
    r.solicitanteId != null ||
    r.equipeId !== '' ||
    r.servicoId !== '' ||
    r.categoriaId !== '' ||
    r.responsavelId !== '' ||
    r.prioridade !== RASCUNHO_VAZIO.prioridade ||
    r.assinaturaLigada !== RASCUNHO_VAZIO.assinaturaLigada
  )
}

export function lerRascunho(): Rascunho | null {
  try {
    const cru = localStorage.getItem(CHAVE)
    if (!cru) return null
    const salvo = JSON.parse(cru) as { versao?: number; dados?: Partial<Rascunho> }
    if (salvo?.versao !== VERSAO || !salvo.dados) return null
    return { ...RASCUNHO_VAZIO, ...salvo.dados }
  } catch {
    // aba anônima sem storage, ou JSON de um formato que não existe mais:
    // começar do zero é melhor que quebrar a tela de abertura
    return null
  }
}

export function limparRascunho(): void {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    // sem storage não havia o que limpar
  }
}

/**
 * Grava o rascunho com folga enquanto `ativo`; com `ativo` falso APAGA o que
 * estiver gravado — formulário esvaziado à mão (ou já enviado) não pode
 * deixar para trás um rascunho que a próxima visita restauraria do nada.
 *
 * `rascunho` precisa vir memoizado por quem chama: a identidade nova a cada
 * render reiniciaria o temporizador para sempre e nada seria gravado.
 */
export function useGravarRascunho(rascunho: Rascunho, ativo: boolean): void {
  useEffect(() => {
    if (!ativo) {
      limparRascunho()
      return
    }
    const h = setTimeout(() => {
      try {
        localStorage.setItem(CHAVE, JSON.stringify({ versao: VERSAO, dados: rascunho }))
      } catch {
        // storage cheio ou bloqueado: o rascunho vale só enquanto a aba viver
      }
    }, FOLGA_MS)
    return () => clearTimeout(h)
  }, [rascunho, ativo])
}
