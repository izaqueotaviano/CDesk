import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

// ---------------------------------------------------------------------------
// Configurações → Importar (Movidesk) e → Backup — apps/ferramentas no
// backend. Os dois são "trabalhos": a tela dispara, e acompanha por polling
// enquanto houver um em andamento (2s — o backend grava o log a cada página
// baixada, ~6s, então mais rápido que isso só gastaria requisição).
// ---------------------------------------------------------------------------

export type StatusTrabalho = 'pendente' | 'rodando' | 'concluido' | 'erro' | 'cancelado'

export interface LinhaDeLog {
  t: string
  nivel: 'info' | 'aviso' | 'erro'
  msg: string
}

export interface TrabalhoBase {
  id: number
  status: StatusTrabalho
  status_label: string
  etapa: string
  progresso: number | null
  log: LinhaDeLog[]
  erro: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  requested_by_name: string | null
}

export function trabalhoAtivo(t: TrabalhoBase | null | undefined): boolean {
  return t?.status === 'pendente' || t?.status === 'rodando'
}

/** Polling só enquanto há trabalho em andamento — v5: recebe a query. */
function enquantoHouverAndamento(query: { state: { data?: { em_andamento: TrabalhoBase | null } } }) {
  return trabalhoAtivo(query.state.data?.em_andamento) ? 2000 : false
}

const FMT_DATA_HORA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
export function dataHora(iso: string | null | undefined): string {
  return iso ? FMT_DATA_HORA.format(new Date(iso)) : '—'
}

// ---- Importação do Movidesk -----------------------------------------------

export interface ImportacaoMovidesk extends TrabalhoBase {
  team: number
  team_name: string
  plan: number
  plan_name: string
  limite: number | null
  apenas_baixar: boolean
  arquivo_url: string | null
  tickets_baixados: number
  tickets_criados: number
  tickets_atualizados: number
  tickets_ignorados: number
  mensagens_importadas: number
  avisos: string[]
}

export interface ListaImportacoes {
  em_andamento: ImportacaoMovidesk | null
  recentes: ImportacaoMovidesk[]
  token_no_servidor: boolean
}

export interface NovaImportacao {
  token?: string
  team: number
  plan?: number
  limite?: number | null
  apenas_baixar?: boolean
}

const URL_IMPORTACAO = '/api/v1/ferramentas/importacao-movidesk/'
const chaveImportacoes = ['ferramentas', 'importacoes'] as const

export function useImportacoes() {
  return useQuery({
    queryKey: chaveImportacoes,
    queryFn: () => api.get<ListaImportacoes>(URL_IMPORTACAO),
    refetchInterval: enquantoHouverAndamento,
  })
}

export function useIniciarImportacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: NovaImportacao) => api.post<ImportacaoMovidesk>(URL_IMPORTACAO, d),
    // as duas listas: uma importação de qualquer tipo trava o botão da outra
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ferramentas'] }),
  })
}

export function useCancelarImportacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<ImportacaoMovidesk>(`${URL_IMPORTACAO}${id}/cancelar/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ferramentas'] }),
  })
}

// ---- Importação de pessoas (empresas, contatos, agentes) -------------------

export interface ImportacaoPessoas extends TrabalhoBase {
  plan: number
  plan_name: string
  criar_agentes: boolean
  limite: number | null
  apenas_baixar: boolean
  arquivo_url: string | null
  pessoas_baixadas: number
  empresas_criadas: number
  empresas_atualizadas: number
  contatos_criados: number
  contatos_atualizados: number
  agentes_criados: number
  agentes_atualizados: number
  ignorados: number
  avisos: string[]
}

export interface ListaImportacoesPessoas {
  em_andamento: ImportacaoPessoas | null
  recentes: ImportacaoPessoas[]
  token_no_servidor: boolean
}

export interface NovaImportacaoPessoas {
  token?: string
  plan?: number
  criar_agentes?: boolean
  limite?: number | null
  apenas_baixar?: boolean
}

const URL_PESSOAS = '/api/v1/ferramentas/importacao-pessoas/'
const chavePessoas = ['ferramentas', 'importacoes-pessoas'] as const

export function useImportacoesPessoas() {
  return useQuery({
    queryKey: chavePessoas,
    queryFn: () => api.get<ListaImportacoesPessoas>(URL_PESSOAS),
    refetchInterval: enquantoHouverAndamento,
  })
}

export function useIniciarImportacaoPessoas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: NovaImportacaoPessoas) => api.post<ImportacaoPessoas>(URL_PESSOAS, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ferramentas'] }),
  })
}

export function useCancelarImportacaoPessoas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<ImportacaoPessoas>(`${URL_PESSOAS}${id}/cancelar/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ferramentas'] }),
  })
}

// ---- Backup -----------------------------------------------------------------

export type OrigemBackup = 'manual' | 'agendado' | 'pre_restauracao'

export interface TrabalhoBackup extends TrabalhoBase {
  tipo: 'backup' | 'restauracao'
  tipo_label: string
  origem: OrigemBackup
  origem_label: string
  arquivo_nome: string
  tamanho_bytes: number | null
}

export interface ArquivoBackup {
  nome: string
  tamanho_bytes: number
  criado_em: string
  /** nulo = veio de fora da tela (timer do systemd / cron) */
  origem: OrigemBackup | null
}

export interface ListaBackups {
  em_andamento: TrabalhoBackup | null
  arquivos: ArquivoBackup[]
  recentes: TrabalhoBackup[]
  diretorio: string
  retencao_dias: number
}

export interface Agendamento {
  ativo: boolean
  frequencia: 'diaria' | 'semanal'
  hora: string
  dia_da_semana: number | null
  retencao_dias: number
  proximo_em: string | null
}
export type AgendamentoEscrita = Pick<Agendamento, 'ativo' | 'frequencia' | 'hora' | 'dia_da_semana'>

const URL_BACKUPS = '/api/v1/ferramentas/backups/'
const chaveBackups = ['ferramentas', 'backups'] as const
const chaveAgendamento = ['ferramentas', 'backups', 'agendamento'] as const

export function urlDeDownloadDoBackup(nome: string): string {
  return `${URL_BACKUPS}${encodeURIComponent(nome)}/download/`
}

export function useBackups() {
  return useQuery({
    queryKey: chaveBackups,
    queryFn: () => api.get<ListaBackups>(URL_BACKUPS),
    refetchInterval: enquantoHouverAndamento,
  })
}

export function useCriarBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TrabalhoBackup>(URL_BACKUPS),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveBackups }),
  })
}

export function useRestaurarBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ nome, confirmacao }: { nome: string; confirmacao: string }) =>
      api.post<TrabalhoBackup>(`${URL_BACKUPS}${encodeURIComponent(nome)}/restaurar/`, { confirmacao }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveBackups }),
  })
}

export function useApagarBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nome: string) => api.delete<void>(`${URL_BACKUPS}${encodeURIComponent(nome)}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveBackups }),
  })
}

export function useAgendamentoBackup() {
  return useQuery({
    queryKey: chaveAgendamento,
    queryFn: () => api.get<Agendamento>(`${URL_BACKUPS}agendamento/`),
  })
}

export function useSalvarAgendamentoBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (d: AgendamentoEscrita) => api.put<Agendamento>(`${URL_BACKUPS}agendamento/`, d),
    onSuccess: (dados) => qc.setQueryData(chaveAgendamento, dados),
  })
}
