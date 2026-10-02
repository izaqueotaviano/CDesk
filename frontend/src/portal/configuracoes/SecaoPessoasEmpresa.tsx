import { useId, useState, type FormEvent } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import {
  IconDots,
  IconMailForward,
  IconShieldCheck,
  IconShieldOff,
  IconUserCheck,
  IconUserOff,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { Avatar } from '@/ui/Avatar'
import { urlDoAvatar } from '../api/conta'
import {
  useAlterarPessoa,
  useConvidarPessoa,
  usePessoasDaEmpresa,
  useReenviarConvite,
  type ConviteDePessoa,
  type PapelNaEmpresa,
  type PessoaDaEmpresa,
} from '../api/pessoas'
import { cn } from '../lib/cn'
import { relativo, useAgora } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { EstadoVazio } from '../ui/estado-vazio'
import { ErroCampo, Input, Label } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

/** A permissão que abre esta seção — a do papel "Responsável". */
export const PERMISSAO_PESSOAS = 'portal.company_users'

const DESCRICAO = 'Quem da sua empresa acessa o suporte. Convide colegas, escolha quem também é responsável e tire o acesso de quem saiu.'

const PAPEIS: { valor: PapelNaEmpresa; rotulo: string; descricao: string }[] = [
  { valor: 'member', rotulo: 'Usuário', descricao: 'Abre e acompanha tickets, e fala com o suporte.' },
  { valor: 'owner', rotulo: 'Responsável', descricao: 'Também convida pessoas, muda papéis e edita os dados da empresa.' },
]

function mensagem(e: unknown, padrao: string): string {
  if (e instanceof ApiError) return e.detail ?? e.fieldErrors?.detail?.[0] ?? e.fieldErrors?.is_active?.[0] ?? padrao
  return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
}

function textoDoAcesso(p: PessoaDaEmpresa, agoraMs: number): string {
  if (!p.last_access) return p.invite_status === 'pendente' ? 'Ainda não criou a senha' : 'Ainda não entrou'
  const quando = relativo(p.last_access, agoraMs)
  return quando === 'agora' || quando.startsWith('há') ? `Último acesso ${quando}` : `Último acesso em ${quando}`
}

// ---------------------------------------------------------------- convite

const CONVITE_VAZIO: ConviteDePessoa = { full_name: '', email: '', phone: '', job_title: '', client_role: 'member' }

function DialogoConvite({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const idBase = useId()
  const convidar = useConvidarPessoa()
  const [dados, setDados] = useState<ConviteDePessoa>(CONVITE_VAZIO)
  const [erros, setErros] = useState<Record<string, string[]>>({})

  function fechar() {
    setDados(CONVITE_VAZIO)
    setErros({})
    convidar.reset()
    onFechar()
  }

  function mudar<K extends keyof ConviteDePessoa>(campo: K, valor: ConviteDePessoa[K]) {
    setDados((d) => ({ ...d, [campo]: valor }))
    if (erros[campo]?.length) setErros((e) => ({ ...e, [campo]: [] }))
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    // A conferência de verdade é do servidor; aqui só o que evita uma ida
    // e volta para dizer "faltou o nome".
    const faltando: Record<string, string[]> = {}
    if (dados.full_name.trim().length < 2) faltando.full_name = ['Informe o nome da pessoa.']
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email.trim())) faltando.email = ['Informe um e-mail válido, como nome@empresa.com.br.']
    if (!dados.phone.trim()) faltando.phone = ['Informe um telefone para contato.']
    if (Object.keys(faltando).length) {
      setErros(faltando)
      return
    }
    convidar.mutate(
      { ...dados, full_name: dados.full_name.trim(), email: dados.email.trim(), phone: dados.phone.trim(), job_title: dados.job_title?.trim() },
      {
        onSuccess: (pessoa) => {
          toast.success(`Convite enviado para ${pessoa.email}.`)
          fechar()
        },
        onError: (err) => {
          if (err instanceof ApiError && err.fieldErrors) setErros(err.fieldErrors)
        },
      },
    )
  }

  const erroGeral = convidar.error != null && !(convidar.error instanceof ApiError && convidar.error.fieldErrors) ? mensagem(convidar.error, 'Não foi possível enviar o convite.') : null

  const campo = (id: keyof ConviteDePessoa, rotulo: string, props: React.InputHTMLAttributes<HTMLInputElement>, opcional = false) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idBase}-${id}`}>
        {rotulo}
        {opcional && <span className="font-normal text-tinta-secundaria"> (opcional)</span>}
      </Label>
      <Input
        id={`${idBase}-${id}`}
        value={String(dados[id] ?? '')}
        onChange={(e) => mudar(id, e.target.value as never)}
        aria-invalid={Boolean(erros[id]?.length) || undefined}
        aria-describedby={erros[id]?.length ? `${idBase}-${id}-erro` : undefined}
        {...props}
      />
      <ErroCampo id={`${idBase}-${id}-erro`}>{erros[id]?.[0]}</ErroCampo>
    </div>
  )

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !convidar.isPending && fechar()}>
      <DialogContent className="max-w-md">
        <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Convidar pessoa</DialogTitle>
            <DialogDescription>
              A pessoa recebe um e-mail com um link para criar a própria senha. O link vale por 3 dias.
            </DialogDescription>
          </DialogHeader>

          {erroGeral && (
            <Alert variant="destructive" titulo="Convite não enviado">
              {erroGeral}
            </Alert>
          )}

          {campo('full_name', 'Nome completo', { autoComplete: 'off', maxLength: 150, autoFocus: true })}
          {campo('email', 'E-mail', { type: 'email', inputMode: 'email', autoComplete: 'off', maxLength: 254 })}
          <div className="grid gap-4 sm:grid-cols-2">
            {campo('phone', 'Telefone', { type: 'tel', inputMode: 'tel', autoComplete: 'off', maxLength: 32, placeholder: '(11) 99999-0000' })}
            {campo('job_title', 'Cargo', { autoComplete: 'off', maxLength: 100 }, true)}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-pequeno font-medio text-tinta">Papel</legend>
            {PAPEIS.map((papel) => (
              <label
                key={papel.valor}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5',
                  dados.client_role === papel.valor ? 'border-tinta' : 'border-divisoria hover:border-borda-campo',
                )}
              >
                <input
                  type="radio"
                  name={`${idBase}-papel`}
                  value={papel.valor}
                  checked={dados.client_role === papel.valor}
                  onChange={() => mudar('client_role', papel.valor)}
                  className="mt-0.5 size-4 accent-[var(--tinta)]"
                />
                <span>
                  <span className="block text-corpo font-medio text-tinta">{papel.rotulo}</span>
                  <span className="block text-pequeno text-tinta-secundaria">{papel.descricao}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <DialogFooter>
            <Button variant="ghost" onClick={fechar} disabled={convidar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={convidar.isPending}>
              {convidar.isPending ? 'Enviando…' : 'Enviar convite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- ações

type Acao = { tipo: 'desativar' | 'reativar' | 'promover' | 'rebaixar'; pessoa: PessoaDaEmpresa }

const ITEM_MENU =
  'flex cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 py-2 text-corpo text-tinta outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-navegacao data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-tinta-secundaria'

function MenuDaPessoa({
  pessoa,
  unicoResponsavel,
  onAcao,
  onReenviar,
}: {
  pessoa: PessoaDaEmpresa
  unicoResponsavel: boolean
  onAcao: (a: Acao) => void
  onReenviar: () => void
}) {
  const responsavel = pessoa.client_role === 'owner'
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${pessoa.full_name}`}>
          <IconDots aria-hidden="true" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-[500] min-w-[220px] rounded-md border border-divisoria bg-superficie p-1 text-tinta shadow-[var(--elevacao-2)]"
        >
          {pessoa.is_active && pessoa.invite_status === 'pendente' && (
            <Menu.Item className={ITEM_MENU} onSelect={onReenviar}>
              <IconMailForward aria-hidden="true" /> Reenviar convite
            </Menu.Item>
          )}
          {pessoa.is_active &&
            (responsavel ? (
              <Menu.Item className={ITEM_MENU} disabled={unicoResponsavel} onSelect={() => onAcao({ tipo: 'rebaixar', pessoa })}>
                <IconShieldOff aria-hidden="true" />
                <span>
                  Tornar usuário
                  {unicoResponsavel && <span className="block text-pequeno text-tinta-secundaria">A empresa precisa de outro responsável antes</span>}
                </span>
              </Menu.Item>
            ) : (
              <Menu.Item className={ITEM_MENU} onSelect={() => onAcao({ tipo: 'promover', pessoa })}>
                <IconShieldCheck aria-hidden="true" /> Tornar responsável
              </Menu.Item>
            ))}
          {!pessoa.is_me && (
            <>
              <Menu.Separator className="my-1 h-px bg-divisoria" />
              {pessoa.is_active ? (
                <Menu.Item className={cn(ITEM_MENU, 'text-perigo [&_svg]:text-perigo')} onSelect={() => onAcao({ tipo: 'desativar', pessoa })}>
                  <IconUserOff aria-hidden="true" /> Desativar acesso
                </Menu.Item>
              ) : (
                <Menu.Item className={ITEM_MENU} onSelect={() => onAcao({ tipo: 'reativar', pessoa })}>
                  <IconUserCheck aria-hidden="true" /> Reativar acesso
                </Menu.Item>
              )}
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

function textosDaConfirmacao(a: Acao): { titulo: string; descricao: string; rotulo: string; perigo: boolean } {
  const nome = a.pessoa.full_name
  switch (a.tipo) {
    case 'desativar':
      return {
        titulo: `Desativar o acesso de ${nome}?`,
        descricao: 'A pessoa sai de todas as sessões agora e não consegue mais entrar. Os tickets que ela abriu continuam na empresa, e você pode reativar o acesso depois.',
        rotulo: 'Desativar acesso',
        perigo: true,
      }
    case 'reativar':
      return {
        titulo: `Reativar o acesso de ${nome}?`,
        descricao:
          a.pessoa.invite_status === 'pendente'
            ? 'A pessoa volta para a lista, mas ainda precisa criar a senha pelo convite. Reenvie o convite se o link tiver vencido.'
            : 'A pessoa volta a entrar com a senha que já tinha.',
        rotulo: 'Reativar acesso',
        perigo: false,
      }
    case 'promover':
      return {
        titulo: `Tornar ${nome} responsável?`,
        descricao: 'Responsáveis convidam pessoas, mudam papéis, desativam acessos e editam os dados da empresa.',
        rotulo: 'Tornar responsável',
        perigo: false,
      }
    case 'rebaixar':
      return {
        titulo: a.pessoa.is_me ? 'Deixar de ser responsável?' : `Tirar de ${nome} o papel de responsável?`,
        descricao: a.pessoa.is_me
          ? 'Você deixa de gerenciar as pessoas e os dados da empresa, e esta seção sai das suas configurações.'
          : 'A pessoa continua com acesso, mas deixa de gerenciar as pessoas e os dados da empresa.',
        rotulo: a.pessoa.is_me ? 'Deixar de ser responsável' : 'Tornar usuário',
        perigo: false,
      }
  }
}

function LinhaPessoa({
  pessoa,
  agoraMs,
  unicoResponsavel,
  onAcao,
  onReenviar,
}: {
  pessoa: PessoaDaEmpresa
  agoraMs: number
  unicoResponsavel: boolean
  onAcao: (a: Acao) => void
  onReenviar: () => void
}) {
  return (
    <li className={cn('flex items-start gap-3 py-3', !pessoa.is_active && 'text-tinta-secundaria')}>
      <span className={cn('mt-0.5', !pessoa.is_active && 'opacity-60')}>
        <Avatar nome={pessoa.full_name} urlFoto={urlDoAvatar(pessoa.avatar_url)} tamanho="sm" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('truncate text-corpo font-medio', pessoa.is_active ? 'text-tinta' : 'text-tinta-secundaria')}>{pessoa.full_name}</span>
          {pessoa.is_me && <span className="text-pequeno text-tinta-secundaria">(você)</span>}
        </p>
        <p className="truncate text-pequeno text-tinta-secundaria">
          {pessoa.email}
          {pessoa.job_title ? ` · ${pessoa.job_title}` : ''}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant={pessoa.client_role === 'owner' ? 'acento' : 'neutro'}>{pessoa.client_role_label}</Badge>
          {!pessoa.is_active ? (
            <Badge variant="outline">Acesso desativado</Badge>
          ) : pessoa.invite_status === 'pendente' ? (
            <Badge variant="alerta">Convite pendente</Badge>
          ) : null}
          <span className="text-pequeno text-tinta-secundaria">{textoDoAcesso(pessoa, agoraMs)}</span>
        </div>
      </div>
      <MenuDaPessoa pessoa={pessoa} unicoResponsavel={unicoResponsavel} onAcao={onAcao} onReenviar={onReenviar} />
    </li>
  )
}

// ---------------------------------------------------------------- seção

/**
 * Pessoas da empresa — só para o responsável (`portal.company_users`).
 *
 * A lista vem do servidor já recortada pela empresa de quem pede. As
 * mudanças que tiram poder (desativar, rebaixar) passam por confirmação; as
 * regras de verdade ("ninguém se desativa", "sempre um responsável ativo")
 * são do servidor — a tela só evita oferecer o que ele recusaria.
 */
export function SecaoPessoasEmpresa() {
  const { data: me } = useMe()
  const pode = Boolean(me?.permissions.includes(PERMISSAO_PESSOAS))
  const pessoas = usePessoasDaEmpresa(pode)
  const alterar = useAlterarPessoa()
  const reenviar = useReenviarConvite()
  const agoraMs = useAgora()
  const [convidando, setConvidando] = useState(false)
  const [acao, setAcao] = useState<Acao | null>(null)

  if (!pode) return null

  const botaoConvidar = (
    <Button onClick={() => setConvidando(true)}>
      <IconUserPlus aria-hidden="true" />
      Convidar pessoa
    </Button>
  )

  async function confirmar() {
    if (!acao) return
    const { tipo, pessoa } = acao
    const dados =
      tipo === 'desativar' ? { is_active: false } : tipo === 'reativar' ? { is_active: true } : { client_role: (tipo === 'promover' ? 'owner' : 'member') as PapelNaEmpresa }
    try {
      await alterar.mutateAsync({ id: pessoa.id, ...dados })
    } catch (e) {
      toast.error(mensagem(e, 'Não foi possível salvar a mudança.'))
      return
    }
    const feito = {
      desativar: `Acesso de ${pessoa.full_name} desativado.`,
      reativar: `Acesso de ${pessoa.full_name} reativado.`,
      promover: `${pessoa.full_name} agora é responsável.`,
      rebaixar: `${pessoa.full_name} agora é usuário.`,
    }[tipo]
    toast.success(feito)
  }

  function reenviarConvite(pessoa: PessoaDaEmpresa) {
    reenviar.mutate(pessoa.id, {
      onSuccess: () => toast.success(`Convite reenviado para ${pessoa.email}.`),
      onError: (e) => toast.error(mensagem(e, 'Não foi possível reenviar o convite.')),
    })
  }

  let conteudo: React.ReactNode
  if (pessoas.isLoading) {
    conteudo = (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="sr-only">Carregando as pessoas da empresa…</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-total" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  } else if (pessoas.isError || !pessoas.data) {
    conteudo = (
      <Alert
        variant="destructive"
        titulo="Não foi possível carregar as pessoas da empresa"
        acao={
          <Button size="sm" variant="secondary" className="border-borda-campo" onClick={() => pessoas.refetch()}>
            Tentar de novo
          </Button>
        }
      >
        {pessoas.error instanceof ApiError ? mensagem(pessoas.error, `Erro ${pessoas.error.status}.`) : 'Verifique sua conexão e tente de novo.'}
      </Alert>
    )
  } else {
    const lista = pessoas.data
    const responsaveisAtivos = lista.filter((p) => p.is_active && p.client_role === 'owner').length
    const ativas = lista.filter((p) => p.is_active).length
    const soEu = lista.length === 1 && lista[0].is_me
    conteudo = soEu ? (
      <EstadoVazio
        icone={IconUsers}
        titulo="Só você por enquanto"
        descricao="Convide colegas para abrir e acompanhar tickets em nome da empresa. Cada pessoa cria a própria senha pelo convite."
        acao={botaoConvidar}
        className="py-6"
      />
    ) : (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-pequeno text-tinta-secundaria">
            {ativas} {ativas === 1 ? 'pessoa com acesso' : 'pessoas com acesso'}
            {lista.length > ativas ? ` · ${lista.length - ativas} ${lista.length - ativas === 1 ? 'desativada' : 'desativadas'}` : ''}
          </p>
          {botaoConvidar}
        </div>
        <ul className="-my-3 divide-y divide-divisoria" aria-label="Pessoas da empresa">
          {lista.map((p) => (
            <LinhaPessoa
              key={p.id}
              pessoa={p}
              agoraMs={agoraMs}
              unicoResponsavel={p.is_active && p.client_role === 'owner' && responsaveisAtivos <= 1}
              onAcao={setAcao}
              onReenviar={() => reenviarConvite(p)}
            />
          ))}
        </ul>
      </>
    )
  }

  const textos = acao ? textosDaConfirmacao(acao) : null

  return (
    <Secao id="pessoas" icone={IconUsers} titulo="Pessoas da empresa" descricao={DESCRICAO}>
      {conteudo}
      <DialogoConvite aberto={convidando} onFechar={() => setConvidando(false)} />
      <ConfirmDialog
        aberto={acao !== null}
        onFechar={() => setAcao(null)}
        onConfirmar={confirmar}
        titulo={textos?.titulo ?? ''}
        descricao={textos?.descricao}
        rotuloConfirmar={textos?.rotulo}
        perigo={textos?.perigo}
      />
    </Secao>
  )
}
