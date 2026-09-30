import { useRef, useState } from 'react'
import {
  Button,
  ErrorState,
  Field,
  FormActions,
  FormRow,
  FormSection,
  Skeleton,
  TextInput,
  useToast,
} from '@/cvz/components'
import { urlDaImagemDeMarca, type MarcaLogin, type MarcaLoginEscrita, type PublicoLogin } from '@/api/branding'
import { ApiError } from '@/api/client'
import {
  useAtualizarMarcaLogin,
  useEnviarImagemMarca,
  useMarcaLoginAdmin,
  useRemoverImagemMarca,
  type MarcaLoginAdmin,
} from './dados'

const LIMITE_IMAGEM_MB = 5

interface Formulario {
  marca: string
  chamada: string
  subtitulo: string
  destaques: [string, string, string]
}

function formularioDe(m: MarcaLogin): Formulario {
  const d = [...m.highlights, '', '', ''].slice(0, 3) as [string, string, string]
  return { marca: m.brand_name, chamada: m.headline, subtitulo: m.subtitle, destaques: d }
}

function payloadDe(f: Formulario, base: MarcaLogin): MarcaLoginEscrita {
  const p: MarcaLoginEscrita = {}
  if (f.marca.trim() !== base.brand_name) p.brand_name = f.marca.trim()
  if (f.chamada.trim() !== base.headline) p.headline = f.chamada.trim()
  if (f.subtitulo.trim() !== base.subtitle) p.subtitle = f.subtitulo.trim()
  const destaques = f.destaques.map((d) => d.trim()).filter(Boolean)
  if (JSON.stringify(destaques) !== JSON.stringify(base.highlights)) p.highlights = destaques
  return p
}

/** O painel em miniatura — o que a pessoa vai ver no login, sem sair daqui. */
function Previa({ f, imagem }: { f: Formulario; imagem: string | null }) {
  const destaques = f.destaques.filter((d) => d.trim())
  return (
    <div
      className="cfg-marca__previa"
      style={imagem ? { backgroundImage: `url("${imagem}")` } : undefined}
      aria-label="Prévia do painel da tela de login"
    >
      <div className="cfg-marca__previa-marca">
        <span className="cfg-marca__previa-logo">r</span>
        {f.marca || '—'}
      </div>
      <div>
        {f.chamada && <p className="cfg-marca__previa-chamada">{f.chamada}</p>}
        <ul className="cfg-marca__previa-lista">
          {destaques.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function BlocoPublico({ publico, dados, padrao }: { publico: PublicoLogin; dados: MarcaLogin; padrao: MarcaLoginAdmin['defaults'][PublicoLogin] }) {
  const { push } = useToast()
  const salvar = useAtualizarMarcaLogin(publico)
  const enviar = useEnviarImagemMarca(publico)
  const remover = useRemoverImagemMarca(publico)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Formulario>(() => formularioDe(dados))
  const [base, setBase] = useState(dados)
  const [erros, setErros] = useState<Partial<Record<'marca' | 'chamada' | 'subtitulo', string>>>({})

  // o servidor devolveu uma versão nova (imagem trocada, outro admin): re-semeia
  if (dados.updated_at !== base.updated_at) {
    setBase(dados)
    setForm(formularioDe(dados))
  }

  const alteracoes = payloadDe(form, base)
  const temAlteracao = Object.keys(alteracoes).length > 0
  const imagem = urlDaImagemDeMarca(dados.image_url)
  const rotulo = publico === 'cliente' ? 'Portal do cliente' : 'Painel da equipe'

  function mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErros({})
  }
  function mudarDestaque(i: number, valor: string) {
    setForm((f) => {
      const d = [...f.destaques] as Formulario['destaques']
      d[i] = valor
      return { ...f, destaques: d }
    })
  }

  async function gravar() {
    try {
      const novo = await salvar.mutateAsync(alteracoes)
      setBase(novo)
      setForm(formularioDe(novo))
      push({ tone: 'success', title: `Tela de login (${rotulo.toLowerCase()}) salva` })
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        const mapa: Record<string, 'marca' | 'chamada' | 'subtitulo'> = { brand_name: 'marca', headline: 'chamada', subtitle: 'subtitulo' }
        const novos: typeof erros = {}
        for (const [k, msgs] of Object.entries(e.fieldErrors)) if (mapa[k]) novos[mapa[k]] = msgs[0]
        setErros(novos)
        if (Object.keys(novos).length) return
      }
      push({ tone: 'danger', title: 'Não foi possível salvar', description: e instanceof ApiError ? e.detail : undefined })
    }
  }

  function escolherImagem(arquivo: File | undefined) {
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      push({ tone: 'danger', title: 'Escolha uma imagem (JPG, PNG ou WebP).' })
      return
    }
    if (arquivo.size > LIMITE_IMAGEM_MB * 1024 * 1024) {
      push({ tone: 'danger', title: `A imagem precisa ter até ${LIMITE_IMAGEM_MB} MB.` })
      return
    }
    enviar.mutate(arquivo, {
      onSuccess: () => push({ tone: 'success', title: 'Imagem do painel atualizada' }),
      onError: (e) => push({ tone: 'danger', title: 'Não foi possível enviar a imagem', description: e instanceof ApiError ? (e.fieldErrors?.file?.[0] ?? e.detail) : undefined }),
    })
  }

  return (
    <FormSection
      title={rotulo}
      description={
        publico === 'cliente'
          ? 'O painel que o cliente vê em /login/cliente. O nome da marca também aparece no topo do portal no celular.'
          : 'O painel que a equipe vê em /login.'
      }
    >
      <div className="cfg-marca">
        <div className="cfg-marca__campos">
          <FormRow columns={1}>
            <TextInput label="Nome da marca" maxLength={80} value={form.marca} error={erros.marca} onChange={(e) => mudar('marca', e.target.value)} />
            <TextInput label="Chamada" maxLength={160} helper="A frase grande do painel. Vazia, some." value={form.chamada} error={erros.chamada} onChange={(e) => mudar('chamada', e.target.value)} />
            <TextInput label="Subtítulo" maxLength={240} helper="Aparece sob o título do formulário." value={form.subtitulo} error={erros.subtitulo} onChange={(e) => mudar('subtitulo', e.target.value)} />
          </FormRow>
          <FormRow columns={1}>
            {form.destaques.map((d, i) => (
              <TextInput key={i} label={`Destaque ${i + 1}`} maxLength={160} value={d} onChange={(e) => mudarDestaque(i, e.target.value)} helper={i === 0 ? 'Até três frases curtas; a vazia some.' : undefined} />
            ))}
          </FormRow>
          <FormRow columns={2}>
            <Field label="Textos">
              <Button
                variant="ghost"
                onClick={() => setForm({ marca: padrao.brand_name, chamada: padrao.headline, subtitulo: padrao.subtitle, destaques: [...padrao.highlights, '', '', ''].slice(0, 3) as Formulario['destaques'] })}
              >
                Restaurar textos padrão
              </Button>
            </Field>
            <Field label="Imagem de fundo" helper={`JPG, PNG ou WebP, até ${LIMITE_IMAGEM_MB} MB. Substitui o azul; os textos ficam por cima. Sem chamada e destaques, só a imagem aparece.`}>
              <div className="cfg-marca__imagem-acoes">
                <input
                  ref={arquivoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label={`Escolher imagem (${rotulo.toLowerCase()})`}
                  onChange={(e) => {
                    escolherImagem(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <Button variant="secondary" onClick={() => arquivoRef.current?.click()} disabled={enviar.isPending}>
                  {enviar.isPending ? 'Enviando…' : imagem ? 'Trocar imagem' : 'Enviar imagem'}
                </Button>
                {imagem && (
                  <Button variant="ghost" onClick={() => remover.mutate(undefined, { onSuccess: () => push({ tone: 'success', title: 'Imagem removida, painel azul de volta' }) })} disabled={remover.isPending}>
                    Remover
                  </Button>
                )}
              </div>
            </Field>
          </FormRow>
        </div>
        <Previa f={form} imagem={imagem} />
      </div>
      <FormActions>
        <span className="cfg-sistema__meta">{temAlteracao ? 'Alterações ainda não salvas.' : 'Tudo salvo.'}</span>
        <Button variant="ghost" onClick={() => setForm(formularioDe(base))} disabled={!temAlteracao || salvar.isPending}>
          Descartar
        </Button>
        <Button onClick={gravar} disabled={!temAlteracao || salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </FormActions>
    </FormSection>
  )
}

/**
 * Configurações → Tela de login: os textos e a imagem do painel, um bloco
 * por público. Cada bloco salva sozinho; a prévia ao lado mostra o painel
 * como a tela de login vai renderizar.
 */
export function AbaTelaDeLogin() {
  const { data, isLoading, isError, error, refetch } = useMarcaLoginAdmin()
  if (isError) return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  if (isLoading || !data) {
    return (
      <div className="cfg-aba">
        <Skeleton lines={8} />
      </div>
    )
  }
  return (
    <div className="cfg-aba">
      <BlocoPublico publico="cliente" dados={data.cliente} padrao={data.defaults.cliente} />
      <BlocoPublico publico="equipe" dados={data.equipe} padrao={data.defaults.equipe} />
    </div>
  )
}
