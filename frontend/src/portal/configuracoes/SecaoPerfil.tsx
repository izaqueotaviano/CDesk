import { useId, useRef, useState } from 'react'
import { IconCamera, IconTrash, IconUser } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { Avatar } from '@/ui/Avatar'
import { LIMITE_AVATAR_MB, urlDoAvatar, useAtualizarPerfil, useEnviarAvatar, useRemoverAvatar, type PerfilEscrita } from '../api/conta'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Ajuda, ErroCampo, Input, Label } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

type Campos = Required<PerfilEscrita>

function mensagem(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

/**
 * Dados pessoais: foto, nome, cargo e telefone. O e-mail aparece mas não
 * muda aqui — é a chave de acesso (e o destino dos códigos de login);
 * trocá-lo é conversa com o suporte, não uma preferência.
 */
export function SecaoPerfil() {
  const { data: me, isError: erroMe, refetch: recarregarMe } = useMe()
  const atualizar = useAtualizarPerfil()
  const enviarAvatar = useEnviarAvatar()
  const removerAvatar = useRemoverAvatar()
  const idBase = useId()
  const arquivoRef = useRef<HTMLInputElement>(null)

  // `null` = ainda sem edição: os campos espelham o servidor
  const [form, setForm] = useState<Campos | null>(null)
  const [erros, setErros] = useState<Record<string, string[]>>({})

  // `useMe` tem retry:false — se /auth/me/ falhar, `me` fica undefined pra
  // sempre. Sem este ramo a seção mostrava o skeleton indefinidamente.
  if (!me && erroMe) {
    return (
      <Secao id="perfil" icone={IconUser} titulo="Dados pessoais" descricao="Como o suporte vê você.">
        <Alert
          variant="destructive"
          titulo="Não foi possível carregar seus dados"
          acao={
            <Button size="sm" variant="secondary" onClick={() => recarregarMe()}>
              Tentar de novo
            </Button>
          }
        >
          Verifique sua conexão.
        </Alert>
      </Secao>
    )
  }
  if (!me) {
    return (
      <Secao id="perfil" icone={IconUser} titulo="Dados pessoais" descricao="Como o suporte vê você.">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-total" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Secao>
    )
  }

  const valores: Campos = form ?? { full_name: me.full_name, job_title: me.job_title ?? '', phone: me.phone ?? '' }
  const alterado =
    form !== null &&
    (form.full_name !== me.full_name || form.job_title !== (me.job_title ?? '') || form.phone !== (me.phone ?? ''))
  const nomeVazio = valores.full_name.trim().length === 0

  function mudar(campo: keyof Campos, valor: string) {
    setForm({ ...valores, [campo]: valor })
    if (erros[campo]) setErros((e) => ({ ...e, [campo]: [] }))
  }

  function salvar() {
    if (!form || nomeVazio) return
    setErros({})
    atualizar.mutate(
      { full_name: form.full_name.trim(), job_title: form.job_title.trim(), phone: form.phone.trim() },
      {
        onSuccess: () => {
          setForm(null)
          toast.success('Dados salvos.')
        },
        onError: (e) => {
          if (e instanceof ApiError && e.fieldErrors) setErros(e.fieldErrors)
          toast.error(mensagem(e, 'Não foi possível salvar. Tente de novo.'))
        },
      },
    )
  }

  function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      toast.error('Escolha uma imagem (JPG, PNG ou WebP).')
      return
    }
    if (arquivo.size > LIMITE_AVATAR_MB * 1024 * 1024) {
      toast.error(`A foto precisa ter até ${LIMITE_AVATAR_MB} MB.`)
      return
    }
    enviarAvatar.mutate(arquivo, {
      onSuccess: () => toast.success('Foto atualizada.'),
      onError: (e) => {
        const detalhe = e instanceof ApiError ? e.fieldErrors?.file?.[0] : undefined
        toast.error(detalhe ?? mensagem(e, 'Não foi possível enviar a foto.'))
      },
    })
  }

  return (
    <Secao
      id="perfil"
      icone={IconUser}
      titulo="Dados pessoais"
      descricao="Como o suporte vê você. Nome e telefone ajudam a equipe a falar com a pessoa certa."
      rodape={
        <>
          <span className="text-legenda text-tinta-terciaria">{alterado ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
          <Button onClick={salvar} disabled={!alterado || nomeVazio || atualizar.isPending}>
            {atualizar.isPending ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <Avatar nome={me.full_name} urlFoto={urlDoAvatar(me.avatar_url)} tamanho="lg" />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={arquivoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            tabIndex={-1}
            aria-label="Escolher foto"
            onChange={(e) => {
              escolherFoto(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => arquivoRef.current?.click()} disabled={enviarAvatar.isPending}>
            <IconCamera /> {enviarAvatar.isPending ? 'Enviando…' : me.avatar_url ? 'Trocar foto' : 'Enviar foto'}
          </Button>
          {me.avatar_url && (
            <Button
              variant="ghost"
              size="sm"
              disabled={removerAvatar.isPending}
              onClick={() =>
                removerAvatar.mutate(undefined, {
                  onSuccess: () => toast.success('Foto removida. Voltamos às suas iniciais.'),
                  onError: (e) => toast.error(mensagem(e, 'Não foi possível remover a foto.')),
                })
              }
            >
              <IconTrash /> Remover
            </Button>
          )}
          <Ajuda className="basis-full">JPG, PNG ou WebP, até {LIMITE_AVATAR_MB} MB. A imagem é recortada em quadrado.</Ajuda>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idBase}-nome`}>Nome completo</Label>
          <Input
            id={`${idBase}-nome`}
            value={valores.full_name}
            onChange={(e) => mudar('full_name', e.target.value)}
            autoComplete="name"
            maxLength={150}
            aria-invalid={nomeVazio || Boolean(erros.full_name?.length) || undefined}
            aria-describedby={nomeVazio ? `${idBase}-nome-erro` : undefined}
          />
          <ErroCampo id={`${idBase}-nome-erro`}>{nomeVazio ? 'Informe seu nome.' : erros.full_name?.[0]}</ErroCampo>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idBase}-email`}>E-mail</Label>
          <Input id={`${idBase}-email`} value={me.email} readOnly disabled autoComplete="email" />
          <Ajuda>É a sua chave de acesso e o destino dos códigos de login. Para trocar, fale com o suporte.</Ajuda>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idBase}-cargo`}>Cargo</Label>
          <Input
            id={`${idBase}-cargo`}
            value={valores.job_title}
            onChange={(e) => mudar('job_title', e.target.value)}
            autoComplete="organization-title"
            maxLength={100}
            placeholder="Ex.: Analista financeiro"
          />
          <ErroCampo>{erros.job_title?.[0]}</ErroCampo>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idBase}-telefone`}>Telefone</Label>
          <Input
            id={`${idBase}-telefone`}
            type="tel"
            value={valores.phone}
            onChange={(e) => mudar('phone', e.target.value)}
            autoComplete="tel"
            maxLength={32}
            placeholder="(11) 99999-9999"
            inputMode="tel"
          />
          <ErroCampo>{erros.phone?.[0]}</ErroCampo>
        </div>
      </div>
    </Secao>
  )
}
