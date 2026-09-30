import { useId, useRef, useState } from 'react'
import { IconSignature, IconTrash, IconUpload } from '@tabler/icons-react'
import { API_BASE_URL, ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import {
  useAtualizarPerfil,
  useEnviarImagemAssinatura,
  useRemoverImagemAssinatura,
} from '@/portal/api/conta'
import { Secao } from '@/portal/configuracoes/Secao'
import { Alert } from '@/portal/ui/alert'
import { Button } from '@/portal/ui/button'
import { Textarea } from '@/portal/ui/input'
import { Skeleton } from '@/portal/ui/skeleton'
import { toast } from '@/portal/ui/toaster'
import type { Me } from '@/api/types'

type Forma = Me['signature_kind']

const FORMAS: { valor: Forma; rotulo: string; ajuda: string }[] = [
  { valor: '', rotulo: 'Nenhuma', ajuda: 'Suas respostas saem sem rodapé.' },
  { valor: 'texto', rotulo: 'Texto', ajuda: 'Nome, cargo e telefone em texto simples. Funciona em qualquer lugar.' },
  { valor: 'html', rotulo: 'HTML', ajuda: 'Cole a assinatura que você já usa no e-mail. Tags que executam código são removidas ao salvar.' },
  { valor: 'imagem', rotulo: 'Imagem', ajuda: 'Uma faixa pronta (PNG, JPEG ou WebP, até 1 MB). Ela é reduzida para 600×240.' },
]

const MB = 1024 * 1024

interface Campos {
  forma: Forma
  texto: string
  html: string
}

/** Prévia: o mesmo bloco que o cliente vê, montado pelo SERVIDOR.
 *
 *  Desenhar aqui o que foi digitado seria mais imediato e estaria errado duas
 *  vezes: mostraria tags que o servidor remove no salvamento, e colocaria
 *  HTML não higienizado dentro da nossa própria tela. Por isso a prévia é o
 *  `signature_render` que voltou do PATCH — o que ela mostra é o que vai. */
function Previa({ html }: { html: string }) {
  if (!html) {
    return (
      <p className="rounded-md border border-dashed border-divisoria px-3 py-6 text-center text-pequeno text-tinta-secundaria">
        Sem assinatura: suas respostas saem sem rodapé.
      </p>
    )
  }
  return (
    <div className="rounded-md border border-divisoria bg-navegacao/40 p-4">
      <div
        className="text-[13px] leading-normal text-tinta [&_a]:text-acento [&_img]:max-w-full"
        // o HTML já veio higienizado do servidor (apps/accounts/assinatura.py);
        // é o mesmo conteúdo que a conversa e o e-mail desenham
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

/**
 * Minha conta → Assinatura: o rodapé que vai nas respostas ao cliente.
 *
 * Três formas, uma por vez. A escolha da forma é um grupo de rádio de
 * verdade (setas do teclado navegam, leitor de tela anuncia "1 de 4") em vez
 * de quatro botões que só parecem um seletor.
 *
 * A assinatura não entra no texto da mensagem: ela é guardada no perfil e
 * desenhada abaixo do corpo, nas respostas em que você marcar "incluir minha
 * assinatura". Corrigir um telefone aqui conserta o rodapé de todas as
 * respostas já enviadas.
 */
export function SecaoAssinatura() {
  const { data: me, isLoading } = useMe()
  const salvar = useAtualizarPerfil()
  const enviarImagem = useEnviarImagemAssinatura()
  const removerImagem = useRemoverImagemAssinatura()
  const inputArquivo = useRef<HTMLInputElement>(null)
  const idBase = useId()

  // `null` = nada editado ainda, então os valores VÊM do servidor. É o mesmo
  // padrão de SecaoPerfil, e evita copiar o perfil para o estado local num
  // efeito — o que faria a tela mostrar dado velho por um instante a cada
  // recarga do `me` (e é o que a regra react-hooks/set-state-in-effect proíbe).
  const [form, setForm] = useState<Campos | null>(null)
  const [limpou, setLimpou] = useState(false)

  if (isLoading || !me) return <Skeleton className="h-56 w-full" />

  const doServidor: Campos = {
    forma: me.signature_kind,
    texto: me.signature,
    html: me.signature_html,
  }
  const { forma, texto, html } = form ?? doServidor
  const mudou =
    form !== null &&
    (form.forma !== doServidor.forma ||
      form.texto !== doServidor.texto ||
      form.html !== doServidor.html)
  const ajuda = FORMAS.find((f) => f.valor === forma)?.ajuda ?? ''

  function mudar(campo: Partial<Campos>) {
    setForm({ ...(form ?? doServidor), ...campo })
  }

  async function gravar() {
    try {
      const atualizado = await salvar.mutateAsync({
        signature_kind: forma,
        signature: texto,
        signature_html: html,
      })
      // o servidor devolve o HTML já higienizado; se ele encolheu, foi porque
      // tinha coisa que não passa — dizer isso agora evita a descoberta pelo
      // cliente ("sumiu metade da minha assinatura")
      setLimpou(forma === 'html' && html.trim() !== '' && atualizado.signature_html !== html)
      // o `me` novo já é a verdade: volta a ler dele em vez de manter uma
      // cópia local que pode divergir
      setForm(null)
      toast.success('Assinatura salva')
    } catch (e) {
      toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível salvar') : 'Não foi possível salvar')
    }
  }

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > MB) {
      toast.error(`A imagem tem ${Math.round(arquivo.size / 1024)} KB; o limite é 1 MB.`)
      return
    }
    try {
      await enviarImagem.mutateAsync(arquivo)
      // o servidor já ligou a forma "imagem"; a tela volta a ler dele
      setForm(null)
      toast.success('Imagem enviada')
    } catch (e) {
      const detalhe = e instanceof ApiError ? (e.fieldErrors?.file?.[0] ?? e.detail) : undefined
      toast.error(detalhe ?? 'Não foi possível enviar a imagem')
    } finally {
      if (inputArquivo.current) inputArquivo.current.value = ''
    }
  }

  return (
    <Secao
      id="assinatura"
      icone={IconSignature}
      titulo="Assinatura"
      descricao="O rodapé que vai nas suas respostas ao cliente, como a assinatura do e-mail. Ela não entra no texto da mensagem: fica logo abaixo dele, nas respostas em que você marcar “incluir minha assinatura”."
      rodape={
        <>
          <span className="text-legenda text-tinta-secundaria">
            {mudou ? 'Alterações não salvas.' : 'Tudo salvo.'}
          </span>
          <Button onClick={gravar} disabled={!mudou || salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar assinatura'}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="text-pequeno font-medio text-tinta">Formato</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Formato da assinatura">
          {FORMAS.map((f) => (
            <label
              key={f.valor || 'nenhuma'}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-divisoria px-3 py-2 text-pequeno text-tinta has-[:checked]:border-acento has-[:checked]:bg-acento-suave has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-acento"
            >
              <input
                type="radio"
                name={`${idBase}-forma`}
                className="size-4 accent-[var(--acento)]"
                checked={forma === f.valor}
                onChange={() => mudar({ forma: f.valor })}
              />
              {f.rotulo}
            </label>
          ))}
        </div>
        {ajuda && <p className="mt-2 text-legenda text-tinta-secundaria">{ajuda}</p>}
      </fieldset>

      {forma === 'texto' && (
        <div>
          <label htmlFor={`${idBase}-texto`} className="text-pequeno font-medio text-tinta">
            Texto da assinatura
          </label>
          <Textarea
            id={`${idBase}-texto`}
            className="mt-1.5 font-mono"
            rows={4}
            value={texto}
            onChange={(e) => mudar({ texto: e.target.value })}
            placeholder={'Samuel Souza\nSuporte · (11) 4002-8922'}
          />
        </div>
      )}

      {forma === 'html' && (
        <div>
          <label htmlFor={`${idBase}-html`} className="text-pequeno font-medio text-tinta">
            HTML da assinatura
          </label>
          <Textarea
            id={`${idBase}-html`}
            className="mt-1.5 min-h-[160px] font-mono text-[12px]"
            value={html}
            onChange={(e) => mudar({ html: e.target.value })}
            spellCheck={false}
            placeholder={'<p><b>Samuel Souza</b><br>Suporte · (11) 4002-8922</p>'}
          />
          <p className="mt-1.5 text-legenda text-tinta-secundaria">
            Aceita texto, links, tabelas e imagens hospedadas em https. Script, formulário e estilo
            de página são removidos ao salvar. A prévia abaixo mostra o que sobrou.
          </p>
          {limpou && (
            <Alert variant="warning" className="mt-3" titulo="Tirei parte do HTML">
              O que foi removido não é aceito numa assinatura (script, formulário, posicionamento).
              Confira a prévia: é exatamente assim que o cliente vai ver.
            </Alert>
          )}
        </div>
      )}

      {forma === 'imagem' && (
        <div>
          <span className="text-pequeno font-medio text-tinta">Imagem</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              ref={inputArquivo}
              id={`${idBase}-arquivo`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => escolherArquivo(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              disabled={enviarImagem.isPending}
              onClick={() => inputArquivo.current?.click()}
            >
              <IconUpload className="size-4" aria-hidden="true" />
              {enviarImagem.isPending
                ? 'Enviando…'
                : me.signature_image_url
                  ? 'Trocar imagem'
                  : 'Enviar imagem'}
            </Button>
            {me.signature_image_url && (
              <Button
                variant="ghost"
                disabled={removerImagem.isPending}
                onClick={() => removerImagem.mutateAsync().then(() => setForm(null))}
              >
                <IconTrash className="size-4" aria-hidden="true" />
                Remover
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-legenda text-tinta-secundaria">
            PNG, JPEG ou WebP, até 1 MB. A imagem é redesenhada aqui no servidor (no máximo
            600×240), então o arquivo que sai não é o que entrou.
          </p>
          {me.signature_image_url && (
            <p className="mt-1.5 text-legenda text-tinta-terciaria">
              Arquivo atual: <code>{`${API_BASE_URL}${me.signature_image_url}`}</code>
            </p>
          )}
        </div>
      )}

      <div>
        <span className="text-pequeno font-medio text-tinta">Prévia</span>
        <p className="mb-1.5 text-legenda text-tinta-secundaria">
          É assim que o cliente vê, no portal e no e-mail.
        </p>
        <Previa html={me.signature_render} />
      </div>
    </Secao>
  )
}
