import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { chavesConta } from './conta'

// ---------------------------------------------------------------------------
// Pessoas da empresa (Configurações → Pessoas da empresa), geridas pelo
// responsável. O backend é `apps/customers/pessoas.py`: sempre a empresa de
// quem pede, nunca um id de empresa na URL — por isso nenhum hook aqui
// recebe empresa.
// ---------------------------------------------------------------------------

export type PapelNaEmpresa = 'owner' | 'member'

export interface PessoaDaEmpresa {
  id: number
  full_name: string
  email: string
  phone: string
  job_title: string
  avatar_url: string
  client_role: PapelNaEmpresa
  client_role_label: string
  is_active: boolean
  /** `pendente` enquanto a pessoa não abriu o convite e criou a senha. */
  invite_status: 'pendente' | 'aceito'
  /** O mais recente entre o último login e o último uso; `null` = nunca entrou. */
  last_access: string | null
  is_me: boolean
}

export interface ConviteDePessoa {
  full_name: string
  email: string
  phone: string
  job_title?: string
  client_role: PapelNaEmpresa
}

const CHAVE = ['portal', 'pessoas'] as const

export function usePessoasDaEmpresa(habilitado = true) {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () => api.get<PessoaDaEmpresa[]>('/api/v1/me/company/users/'),
    enabled: habilitado,
  })
}

/** Toda mudança aqui também muda o "Pessoas com acesso" da seção Empresa. */
function useInvalidar() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: CHAVE })
    void qc.invalidateQueries({ queryKey: chavesConta.empresa })
  }
}

export function useConvidarPessoa() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: (dados: ConviteDePessoa) => api.post<PessoaDaEmpresa>('/api/v1/me/company/users/', dados),
    onSuccess: invalidar,
  })
}

export function useAlterarPessoa() {
  const invalidar = useInvalidar()
  return useMutation({
    mutationFn: ({ id, ...dados }: { id: number; is_active?: boolean; client_role?: PapelNaEmpresa }) =>
      api.patch<PessoaDaEmpresa>(`/api/v1/me/company/users/${id}/`, dados),
    onSuccess: invalidar,
  })
}

export function useReenviarConvite() {
  return useMutation({
    mutationFn: (id: number) => api.post<{ invited: string }>(`/api/v1/me/company/users/${id}/invite/`),
  })
}
