import { useState } from 'react'
import { useMe } from '@/api/queries/useMe'
import { ApiError } from '@/api/client'
import { Button, ErrorState, FormActions, FormRow, FormSection, Tag, TextInput, Toggle, useToast } from '@/cvz/components'
import { useAtualizarChatEmbed, useChatEmbed, useRegenerarSegredoChatEmbed } from './dados'

const ORIGEM_RE = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? Object.values(e.fieldErrors ?? {})[0]?.[0] ?? padrao) : padrao
}

/**
 * Chat embutido (embed-widget): não é aparência — não existe cor, saudação
 * ou posição configurável no backend hoje, o HTML do balão é fixo. O que
 * existe, pronto e testado sem tela nenhuma até aqui (CompanyAdminViewSet,
 * apps/customers/admin_api.py), é isto: liga/desliga por empresa, as
 * origens autorizadas a exibir o iframe (CSP — sem elas o navegador
 * bloqueia mesmo com a assinatura certa) e a chave que o backend do
 * cliente usa pra assinar a URL a cada sessão.
 */
export function PainelChatEmbed({ empresaId, habilitado }: { empresaId: number; habilitado: boolean }) {
  const { data: me } = useMe()
  const podeEditar = (me?.permissions ?? []).includes('settings.manage')
  const embed = useChatEmbed(empresaId, habilitado)
  const atualizar = useAtualizarChatEmbed(empresaId)
  const regenerar = useRegenerarSegredoChatEmbed(empresaId)
  const { push } = useToast()
  const [novaOrigem, setNovaOrigem] = useState('')
  const [erroOrigem, setErroOrigem] = useState<string | null>(null)
  const [chaveGerada, setChaveGerada] = useState<string | null>(null)

  if (embed.isError) {
    return <ErrorState description={embed.error instanceof ApiError ? embed.error.detail : undefined} onRetry={() => embed.refetch()} />
  }
  if (embed.isLoading || !embed.data) return <p>Carregando…</p>
  const dados = embed.data

  function alternarHabilitado(enabled: boolean) {
    atualizar.mutate(
      { enabled },
      { onError: (e) => push({ tone: 'danger', title: 'Não foi possível salvar', description: mensagemDeErro(e, '') }) },
    )
  }

  function adicionarOrigem() {
    const valor = novaOrigem.trim().toLowerCase().replace(/\/$/, '')
    if (!valor) return
    if (!ORIGEM_RE.test(valor)) {
      setErroOrigem('Use o formato https://dominio.com — sem caminho.')
      return
    }
    if (dados.origins.includes(valor)) {
      setErroOrigem('Essa origem já está na lista.')
      return
    }
    atualizar.mutate(
      { origins: [...dados.origins, valor] },
      {
        onSuccess: () => {
          setNovaOrigem('')
          setErroOrigem(null)
        },
        onError: (e) => setErroOrigem(mensagemDeErro(e, 'Não foi possível adicionar.')),
      },
    )
  }

  function removerOrigem(origem: string) {
    atualizar.mutate(
      { origins: dados.origins.filter((o) => o !== origem) },
      { onError: (e) => push({ tone: 'danger', title: 'Não foi possível remover', description: mensagemDeErro(e, '') }) },
    )
  }

  function regenerarChave() {
    regenerar.mutate(undefined, {
      onSuccess: (r) => setChaveGerada(r.secret),
      onError: (e) => push({ tone: 'danger', title: 'Não foi possível gerar uma nova chave', description: mensagemDeErro(e, '') }),
    })
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      push({ tone: 'success', title: 'Copiado' })
    } catch {
      push({ tone: 'danger', title: 'Não foi possível copiar' })
    }
  }

  return (
    <>
      <FormSection
        title="Chat embutido"
        description="O widget que a plataforma do cliente (Vtex, Tray…) embute num iframe do próprio site, autenticado por uma URL assinada — não por login."
      >
        <Toggle
          label={dados.enabled ? 'Habilitado' : 'Desabilitado'}
          checked={dados.enabled}
          disabled={!podeEditar || atualizar.isPending}
          onChange={(e) => alternarHabilitado(e.target.checked)}
        />
      </FormSection>

      <FormSection
        title="Origens autorizadas"
        description="De onde o iframe pode ser aberto (Content-Security-Policy). Sem a origem cadastrada, o navegador bloqueia o embed mesmo com a assinatura certa."
      >
        <div className="clientes-domain-list">
          {dados.origins.length === 0 && <span className="clientes-vazio-inline">Nenhuma origem autorizada.</span>}
          {dados.origins.map((o) => (
            <Tag key={o} onRemove={podeEditar ? () => removerOrigem(o) : undefined}>
              {o}
            </Tag>
          ))}
        </div>
        {podeEditar && (
          <FormRow columns={2}>
            <TextInput
              placeholder="https://loja.myvtex.com"
              value={novaOrigem}
              onChange={(e) => {
                setNovaOrigem(e.target.value)
                setErroOrigem(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  adicionarOrigem()
                }
              }}
              error={erroOrigem ?? undefined}
            />
            <Button variant="tertiary" onClick={adicionarOrigem} disabled={atualizar.isPending}>
              Adicionar origem
            </Button>
          </FormRow>
        )}
      </FormSection>

      {podeEditar && (
        <FormSection
          title="Chave de assinatura"
          description="O backend do cliente usa essa chave pra assinar a URL do iframe a cada sessão. Regenerar invalida a anterior na hora — o outro lado precisa ser atualizado junto."
        >
          {chaveGerada ? (
            <div className="clientes-chave-gerada">
              <code>{chaveGerada}</code>
              <Button size="sm" variant="secondary" onClick={() => copiar(chaveGerada)}>
                Copiar
              </Button>
              <p className="clientes-meta--espacada">Essa é a única vez que ela aparece — copie agora.</p>
            </div>
          ) : (
            <>
              <FormActions>
                <Button variant="tertiary" onClick={regenerarChave} disabled={regenerar.isPending}>
                  {regenerar.isPending ? 'Gerando…' : 'Regenerar chave'}
                </Button>
              </FormActions>
              <p className="clientes-meta--espacada">Girada pela última vez em {new Date(dados.rotated_at).toLocaleString('pt-BR')}.</p>
            </>
          )}
        </FormSection>
      )}

      {!podeEditar && <p className="clientes-meta--espacada">Só administradores podem alterar essas configurações.</p>}
    </>
  )
}
