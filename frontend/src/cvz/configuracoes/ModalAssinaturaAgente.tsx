import { useRef, useState } from 'react'
import { Button, Modal, TextArea, useToast } from '@/cvz/components'
import { ApiError } from '@/api/client'
import {
  useEnviarImagemAssinaturaAgente,
  useRemoverImagemAssinaturaAgente,
  useSalvarAssinaturaAgente,
  type AgenteCfg,
} from './dados'

type Forma = AgenteCfg['signature_kind']

const FORMAS: { valor: Forma; rotulo: string }[] = [
  { valor: '', rotulo: 'Nenhuma' },
  { valor: 'texto', rotulo: 'Texto' },
  { valor: 'html', rotulo: 'HTML' },
  { valor: 'imagem', rotulo: 'Imagem' },
]

const MB = 1024 * 1024

/**
 * Assinatura de OUTRO agente, pela administração.
 *
 * Existe porque montar assinatura é o pedido que o time faz ao admin, não o
 * contrário — principalmente a de HTML, que quase ninguém escreve sozinho. As
 * regras são as mesmas do self-service em Minha conta, e quem as segura é o
 * servidor (`apps/accounts/assinatura.py`): a tela aqui é a mesma conversa,
 * mais curta.
 *
 * A prévia mostra o que VOLTOU do servidor, nunca o que foi digitado: é o
 * único jeito de ela ser verdade depois da higienização.
 */
export function ModalAssinaturaAgente({
  agente,
  onClose,
}: {
  agente: AgenteCfg | null
  onClose: () => void
}) {
  const { push } = useToast()
  const salvar = useSalvarAssinaturaAgente(agente?.id ?? 0)
  const enviarImagem = useEnviarImagemAssinaturaAgente(agente?.id ?? 0)
  const removerImagem = useRemoverImagemAssinaturaAgente(agente?.id ?? 0)
  const arquivoRef = useRef<HTMLInputElement>(null)

  // `null` = ainda não mexeram, então vale o que veio do servidor. Mesmo
  // padrão do editor de Minha conta.
  const [form, setForm] = useState<{ forma: Forma; texto: string; html: string } | null>(null)

  if (!agente) return null

  const doServidor = {
    forma: agente.signature_kind,
    texto: agente.signature,
    html: agente.signature_html,
  }
  const { forma, texto, html } = form ?? doServidor
  const mudou = form !== null && JSON.stringify(form) !== JSON.stringify(doServidor)

  function mudar(campo: Partial<typeof doServidor>) {
    setForm({ ...(form ?? doServidor), ...campo })
  }

  async function gravar() {
    try {
      await salvar.mutateAsync({ signature_kind: forma, signature: texto, signature_html: html })
      setForm(null)
      push({ tone: 'success', title: 'Assinatura salva', description: agente!.full_name })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'Não foi possível salvar',
        description: e instanceof ApiError ? e.detail : undefined,
      })
    }
  }

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > MB) {
      push({ tone: 'danger', title: 'A imagem passa de 1 MB', description: 'Reduza e envie de novo.' })
      return
    }
    try {
      await enviarImagem.mutateAsync(arquivo)
      setForm(null)
      push({ tone: 'success', title: 'Imagem enviada' })
    } catch (e) {
      const detalhe = e instanceof ApiError ? (e.fieldErrors?.file?.[0] ?? e.detail) : undefined
      push({ tone: 'danger', title: 'Não foi possível enviar', description: detalhe })
    } finally {
      if (arquivoRef.current) arquivoRef.current.value = ''
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assinatura de ${agente.full_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={gravar} disabled={!mudou || salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="cfg-assinatura">
        <fieldset className="cfg-assinatura__formas">
          <legend>Formato</legend>
          <div role="radiogroup" aria-label="Formato da assinatura">
            {FORMAS.map((f) => (
              <label key={f.valor || 'nenhuma'}>
                <input
                  type="radio"
                  name={`assinatura-${agente.id}`}
                  checked={forma === f.valor}
                  onChange={() => mudar({ forma: f.valor })}
                />
                {f.rotulo}
              </label>
            ))}
          </div>
        </fieldset>

        {forma === 'texto' && (
          <TextArea
            label="Texto da assinatura"
            rows={4}
            value={texto}
            onChange={(e) => mudar({ texto: e.target.value })}
            helper="Nome, cargo e telefone. Funciona em qualquer lugar."
          />
        )}

        {forma === 'html' && (
          <TextArea
            label="HTML da assinatura"
            rows={7}
            value={html}
            onChange={(e) => mudar({ html: e.target.value })}
            helper="Cole a assinatura do e-mail. Script, formulário e estilo de página são removidos ao salvar. A prévia mostra o que sobrou."
          />
        )}

        {forma === 'imagem' && (
          <div className="cfg-assinatura__imagem">
            <input
              ref={arquivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={enviarImagem.isPending}
              onClick={() => arquivoRef.current?.click()}
            >
              {enviarImagem.isPending
                ? 'Enviando…'
                : agente.signature_image_url
                  ? 'Trocar imagem'
                  : 'Enviar imagem'}
            </Button>
            {agente.signature_image_url && (
              <Button
                variant="ghost"
                size="sm"
                disabled={removerImagem.isPending}
                onClick={() => removerImagem.mutateAsync().then(() => setForm(null))}
              >
                Remover
              </Button>
            )}
            <span className="cfg-assinatura__ajuda">PNG, JPEG ou WebP, até 1 MB (máx. 600×240).</span>
          </div>
        )}

        <div>
          <span className="cfg-assinatura__rotulo">Prévia</span>
          {agente.signature_render ? (
            <div
              className="cfg-assinatura__previa assinatura-mensagem"
              // já higienizado no servidor — é o mesmo bloco que o cliente vê
              dangerouslySetInnerHTML={{ __html: agente.signature_render }}
            />
          ) : (
            <p className="cfg-assinatura__vazio">
              Sem assinatura: as respostas de {agente.full_name} saem sem rodapé.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
