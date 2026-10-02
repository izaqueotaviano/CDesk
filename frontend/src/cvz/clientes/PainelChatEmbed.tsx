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
 * Chat embutido (embed-widget): liga/desliga por empresa, o CÓDIGO DE
 * INSTALAÇÃO (um por empresa — é ele que o cliente cola no site), as origens
 * autorizadas a exibir o iframe (CSP — sem elas o navegador bloqueia mesmo
 * com tudo certo) e a chave de assinatura do modo identificado.
 *
 * Dois modos, e a tela existe muito para deixar a diferença clara:
 *
 * - **público**: um código só, colado uma vez. Serve pra site/loja, onde não
 *   há ninguém logado; quem se identifica é o visitante, na janelinha.
 * - **identificado**: o site do cliente assina a URL com a chave e diz quem
 *   é a pessoa. Serve dentro de um console (Vtex/Tray) onde ela JÁ está
 *   logada — a identidade é real, não digitada. Aqui o "código" muda a cada
 *   carregamento (a assinatura é por pessoa), então o que se entrega é a
 *   chave, não um trecho pronto.
 *
 * Não é tela de aparência: não existe cor, saudação ou posição configurável
 * no backend hoje, o HTML do balão é fixo.
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

  function alternarPublico(public_enabled: boolean) {
    atualizar.mutate(
      { public_enabled },
      { onError: (e) => push({ tone: 'danger', title: 'Não foi possível salvar', description: mensagemDeErro(e, '') }) },
    )
  }

  function adicionarOrigem() {
    const valor = novaOrigem.trim().toLowerCase().replace(/\/$/, '')
    if (!valor) return
    if (!ORIGEM_RE.test(valor)) {
      setErroOrigem('Use o formato https://dominio.com, sem caminho.')
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
        description="O balão de atendimento que o cliente embute no próprio site ou no console dele (Vtex, Tray…), num iframe que nunca pede login: quem diz de quem é a conversa é o modo abaixo."
      >
        <Toggle
          label={dados.enabled ? 'Habilitado' : 'Desabilitado'}
          checked={dados.enabled}
          disabled={!podeEditar || atualizar.isPending}
          onChange={(e) => alternarHabilitado(e.target.checked)}
        />
      </FormSection>

      <FormSection
        title="Como o visitante é identificado"
        description="Público: um código só, para site ou loja, e o visitante diz o nome e o e-mail na própria janelinha. Identificado: o site assina a URL com a chave abaixo e diz quem é a pessoa; serve dentro de um console onde ela já está logada."
      >
        <Toggle
          label={dados.public_enabled ? 'Público (um código para o site inteiro)' : 'Só por link assinado'}
          checked={dados.public_enabled}
          disabled={!podeEditar || atualizar.isPending}
          onChange={(e) => alternarPublico(e.target.checked)}
        />
        {dados.public_enabled && (
          <p className="clientes-meta--espacada">
            Quem se identificar aqui vira um usuário desta empresa marcado como “visitante do chat”, sem
            acesso ao portal. Ele aparece na aba Usuários.
          </p>
        )}
      </FormSection>

      <FormSection
        title="Código de instalação"
        description="Um por empresa: cole uma vez no site e o balão de atendimento aparece em todas as páginas. Não tem e-mail nem chave dentro, então pode ser enviado por e-mail ao cliente sem cerimônia."
      >
        <div className="clientes-snippet">
          <pre>{dados.snippet}</pre>
          <div className="clientes-snippet__acoes">
            <Button size="sm" variant="secondary" onClick={() => copiar(dados.snippet)}>
              Copiar código
            </Button>
            <Button size="sm" variant="tertiary" onClick={() => copiar(dados.iframe_url)}>
              Copiar só o endereço do iframe
            </Button>
          </div>
          {/* Os dois avisos que fazem o código não funcionar na prática — e é
              sempre um destes dois, nesta ordem. */}
          {!dados.enabled && (
            <p className="clientes-meta--espacada">
              O chat embutido está desabilitado: o código não vai mostrar nada até você ligar lá em cima.
            </p>
          )}
          {dados.enabled && !dados.public_enabled && (
            <p className="clientes-meta--espacada">
              Este código só funciona no modo público. No modo identificado, quem monta o endereço é o
              backend do cliente, assinando com a chave abaixo a cada carregamento.
            </p>
          )}
          {dados.enabled && dados.public_enabled && dados.origins.length === 0 && (
            <p className="clientes-meta--espacada">
              Falta cadastrar a origem do site abaixo. Sem ela, o navegador bloqueia a janela.
            </p>
          )}
        </div>
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
          description="O backend do cliente usa essa chave pra assinar a URL do iframe a cada sessão. Regenerar invalida a anterior na hora, e o outro lado precisa ser atualizado junto."
        >
          {chaveGerada ? (
            <div className="clientes-chave-gerada">
              <code>{chaveGerada}</code>
              <Button size="sm" variant="secondary" onClick={() => copiar(chaveGerada)}>
                Copiar
              </Button>
              <p className="clientes-meta--espacada">Essa é a única vez que ela aparece. Copie agora.</p>
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
