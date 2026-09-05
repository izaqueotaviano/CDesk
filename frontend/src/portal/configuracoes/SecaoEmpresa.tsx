import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { useAtualizarEmpresa, useMinhaEmpresa, type MinhaEmpresa } from '../api/conta'
import { dataCurta } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Ajuda, ErroCampo, Input, Label } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-legenda text-tinta-secundaria">{rotulo}</dt>
      <dd className="truncate text-pequeno font-medio text-tinta">{children}</dd>
    </div>
  )
}

/**
 * A empresa: o que a administração define (nome, plano, gerente de conta)
 * aparece como ficha; razão social e CNPJ são editáveis — só pelo
 * responsável da conta (permissão `portal.company_edit`). Quem não é lê o
 * mesmo bloco e sabe quem pode mudar.
 */
export function SecaoEmpresa() {
  const { data: me } = useMe()
  const empresa = useMinhaEmpresa()
  const atualizar = useAtualizarEmpresa()
  const idBase = useId()
  const podeEditar = me?.permissions.includes('portal.company_edit') ?? false

  const [form, setForm] = useState<{ legal_name: string; tax_id: string } | null>(null)
  const [erros, setErros] = useState<Record<string, string[]>>({})

  const descricao = 'Os dados da sua empresa no suporte. Nome, plano e gerente de conta são definidos pela nossa equipe.'

  if (empresa.isLoading || !me) {
    return (
      <Secao id="empresa" icone={Building2} titulo="Empresa" descricao={descricao}>
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Secao>
    )
  }
  if (empresa.isError || !empresa.data) {
    return (
      <Secao id="empresa" icone={Building2} titulo="Empresa" descricao={descricao}>
        <Alert
          variant="destructive"
          titulo="Não foi possível carregar os dados da empresa"
          acao={
            <Button size="sm" variant="secondary" onClick={() => empresa.refetch()}>
              Tentar de novo
            </Button>
          }
        >
          {empresa.error instanceof ApiError ? `Erro ${empresa.error.status}.` : 'Verifique sua conexão.'}
        </Alert>
      </Secao>
    )
  }

  const dados: MinhaEmpresa = empresa.data
  const valores = form ?? { legal_name: dados.legal_name ?? '', tax_id: dados.tax_id ?? '' }
  const alterado = form !== null && (form.legal_name !== (dados.legal_name ?? '') || form.tax_id !== (dados.tax_id ?? ''))

  function mudar(campo: 'legal_name' | 'tax_id', valor: string) {
    setForm({ ...valores, [campo]: valor })
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: [] }))
  }

  function salvar() {
    if (!form) return
    setErros({})
    atualizar.mutate(
      { legal_name: form.legal_name.trim(), tax_id: form.tax_id.trim() || null },
      {
        onSuccess: () => {
          setForm(null)
          toast.success('Dados da empresa salvos.')
        },
        onError: (e) => {
          if (e instanceof ApiError && e.fieldErrors) setErros(e.fieldErrors)
          toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível salvar.') : 'Não foi possível salvar.')
        },
      },
    )
  }

  return (
    <Secao
      id="empresa"
      icone={Building2}
      titulo="Empresa"
      descricao={descricao}
      rodape={
        podeEditar ? (
          <>
            <span className="text-legenda text-tinta-terciaria">{alterado ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
            <Button onClick={salvar} disabled={!alterado || atualizar.isPending}>
              {atualizar.isPending ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </>
        ) : (
          <span className="text-legenda text-tinta-terciaria">Só o responsável pela conta altera a razão social e o CNPJ.</span>
        )
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <Dado rotulo="Nome">{dados.name}</Dado>
        <Dado rotulo="Plano">{dados.plan_name}</Dado>
        <Dado rotulo="Gerente de conta">{dados.account_manager_name ?? 'Equipe de suporte'}</Dado>
        <Dado rotulo="Pessoas com acesso">
          {dados.members} {dados.members === 1 ? 'pessoa' : 'pessoas'}
        </Dado>
        <Dado rotulo="Cliente desde">{dados.contract_started_at ? dataCurta(dados.contract_started_at) : '—'}</Dado>
        <Dado rotulo="Domínios de e-mail">{dados.domains.length ? dados.domains.join(', ') : '—'}</Dado>
      </dl>

      {podeEditar ? (
        <div className="grid gap-4 border-t border-divisoria pt-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-razao`}>Razão social</Label>
            <Input
              id={`${idBase}-razao`}
              value={valores.legal_name}
              onChange={(e) => mudar('legal_name', e.target.value)}
              maxLength={200}
              autoComplete="organization"
              aria-invalid={Boolean(erros.legal_name?.length) || undefined}
            />
            <ErroCampo>{erros.legal_name?.[0]}</ErroCampo>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-cnpj`}>CNPJ</Label>
            <Input
              id={`${idBase}-cnpj`}
              value={valores.tax_id}
              onChange={(e) => mudar('tax_id', e.target.value)}
              maxLength={20}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              aria-invalid={Boolean(erros.tax_id?.length) || undefined}
            />
            <ErroCampo>{erros.tax_id?.[0]}</ErroCampo>
          </div>
          <Ajuda className="sm:col-span-2">
            Razão social e CNPJ entram nos documentos do atendimento. Toda alteração fica registrada.
          </Ajuda>
        </div>
      ) : (
        <dl className="grid gap-4 border-t border-divisoria pt-5 sm:grid-cols-2">
          <Dado rotulo="Razão social">{dados.legal_name || '—'}</Dado>
          <Dado rotulo="CNPJ">{dados.tax_id || '—'}</Dado>
        </dl>
      )}

      <Ajuda>
        Precisa mudar o nome, o plano ou o fuso horário?{' '}
        <Link to="/portal/tickets/novo" className="text-acento hover:underline">
          Abra um ticket
        </Link>{' '}
        e a equipe cuida disso.
      </Ajuda>
    </Secao>
  )
}
