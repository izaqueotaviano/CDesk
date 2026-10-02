import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconClock, IconSend } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { imagensColadas } from '@/chat/conversa'
import { mensagemDeErro } from '@/resolv/tickets/detalhe/linhaDoTempo'
import { FolhaDoArtigo } from '../ajuda/FolhaDoArtigo'
import { useAbrirTicketCliente, useCategoriasCliente, useEquipesCliente, useEstimativaEquipe } from '../api/tickets'
import { chaveDeRascunho, useRascunho } from '../lib/rascunho'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Ajuda, ErroCampo, Input, Label, Select, Textarea } from '../ui/input'
import { toast } from '../ui/toaster'
import { descricaoDosLimites, useAnexosLocais, useLimitesAnexo } from './anexos'
import { BotaoAnexar, ListaDeAnexos, RecusasDeAnexo, ZonaDeSoltar } from './AnexosDoFormulario'
import { AvisoDeRascunho } from './AvisoDeRascunho'
import { SecaoFranquias } from './SecaoFranquias'
import { SugestoesDeArtigos } from './SugestoesDeArtigos'

type Campo = 'team_id' | 'subject' | 'body' | 'category_id' | 'order_number' | 'files'

/** O que o rascunho da abertura guarda. Anexo fica de fora: arquivo não cabe
 *  no localStorage, e guardar só o nome prometeria um anexo que não existe. */
interface RascunhoNovoTicket {
  equipeId: string
  categoriaId: string
  assunto: string
  pedido: string
  texto: string
}

/** Setor e categoria sozinhos não são rascunho — só o que a pessoa ESCREVEU. */
const rascunhoVazio = (r: RascunhoNovoTicket) => !r.assunto.trim() && !r.texto.trim() && !r.pedido.trim()

/**
 * Abertura de ticket pelo cliente. Consome a cota do plano — quando ela
 * acaba, o backend responde 422 com a mensagem pronta (limite, período,
 * renovação) e ela aparece aqui sem tradução. `SecaoFranquias` mostra as
 * duas franquias (tickets e manutenção) ANTES do bloqueio acontecer —
 * docs/05 §2.5 pede banner permanente, não só o erro na hora.
 *
 * Enquanto a pessoa escreve o assunto, `SugestoesDeArtigos` oferece artigos
 * da Central de Ajuda — sem travar nada. O texto vai para um rascunho local
 * (volta depois de um F5), e anexo entra por botão, arrastando ou colando
 * um print.
 */
export function PaginaNovoTicket() {
  const navigate = useNavigate()
  const idBase = useId()
  const { data: me } = useMe()
  const { data: equipes } = useEquipesCliente()
  const { data: categorias } = useCategoriasCliente()
  const abrir = useAbrirTicketCliente()
  const limites = useLimitesAnexo()
  const anexos = useAnexosLocais(limites)

  const [equipeId, setEquipeId] = useState('')
  const [assunto, setAssunto] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [pedido, setPedido] = useState('')
  const [texto, setTexto] = useState('')
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [artigoAberto, setArtigoAberto] = useState<number | null>(null)

  const rascunho = useRascunho<RascunhoNovoTicket>(
    chaveDeRascunho(me?.id, 'novo-ticket'),
    { equipeId, categoriaId, assunto, pedido, texto },
    (r) => {
      setEquipeId(r.equipeId ?? '')
      setCategoriaId(r.categoriaId ?? '')
      setAssunto(r.assunto ?? '')
      setPedido(r.pedido ?? '')
      setTexto(r.texto ?? '')
    },
    rascunhoVazio,
  )

  const equipe = (equipes ?? []).find((e) => String(e.id) === equipeId)
  const { data: estimativa } = useEstimativaEquipe(equipe?.slug)

  const ids = { equipe: `${idBase}-e`, assunto: `${idBase}-a`, categoria: `${idBase}-c`, pedido: `${idBase}-p`, texto: `${idBase}-t` }

  function limpar(campo: Campo) {
    setErros((e) => {
      if (!(campo in e)) return e
      const { [campo]: _r, ...resto } = e
      return resto
    })
  }

  function descartarRascunho() {
    rascunho.limpar()
    setEquipeId('')
    setCategoriaId('')
    setAssunto('')
    setPedido('')
    setTexto('')
    setErros({})
  }

  function validar() {
    const e: Partial<Record<Campo, string>> = {}
    if (!equipeId) e.team_id = 'Escolha o setor que deve atender.'
    if (!assunto.trim()) e.subject = 'Resuma o problema em uma linha.'
    if (!texto.trim()) e.body = 'Conte o que aconteceu. Quanto mais detalhes, mais rápida a resposta.'
    return e
  }

  function enviar() {
    if (abrir.isPending) return
    setErroGeral(null)
    const invalidos = validar()
    if (Object.keys(invalidos).length) {
      setErros(invalidos)
      const primeiro = (['team_id', 'subject', 'body'] as Campo[]).find((c) => c in invalidos)
      const alvo = primeiro === 'team_id' ? ids.equipe : primeiro === 'subject' ? ids.assunto : ids.texto
      document.getElementById(alvo)?.focus()
      return
    }
    abrir.mutate(
      {
        team_id: Number(equipeId),
        subject: assunto.trim(),
        body: texto.trim(),
        category_id: categoriaId ? Number(categoriaId) : null,
        order_number: pedido.trim(),
        arquivos: anexos.arquivos,
      },
      {
        onSuccess: (t) => {
          rascunho.limpar()
          anexos.limpar()
          toast.success('Ticket aberto', { description: `${t.reference}: você recebe as respostas por e-mail e aqui.` })
          navigate(`/portal/tickets/${t.id}`)
        },
        onError: (e) => {
          if (e instanceof ApiError && e.fieldErrors) {
            setErros(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]])) as Partial<Record<Campo, string>>)
          }
          if (e instanceof ApiError && (e.detail || e.status === 422)) setErroGeral(e.detail ?? 'Não foi possível abrir o ticket.')
          else if (!(e instanceof ApiError && e.fieldErrors)) toast.error(mensagemDeErro(e, 'Não foi possível abrir o ticket.'))
        },
      },
    )
  }

  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      enviar()
    }
  }

  /** Ctrl+V com um print na área de transferência vira anexo; texto colado segue normal. */
  function colar(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imagens = imagensColadas(e.clipboardData?.items ?? null, new Date())
    if (imagens.length === 0) return
    e.preventDefault()
    anexos.adicionar(imagens)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" onKeyDown={aoTeclar}>
      <Link to="/portal/tickets" className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
        <IconArrowLeft className="size-4" aria-hidden="true" /> Tickets
      </Link>

      <header>
        <h1 className="text-titulo-lg font-forte">Abrir ticket</h1>
        <p className="mt-1 text-corpo text-tinta-secundaria">Descreva o problema uma vez. O suporte responde por aqui e por e-mail.</p>
      </header>

      <SecaoFranquias />

      <ZonaDeSoltar onArquivos={anexos.adicionar} desabilitada={abrir.isPending}>
        <Card>
          <CardContent className="flex flex-col gap-5 p-5 md:p-6">
            {rascunho.restaurado && <AvisoDeRascunho onDescartar={descartarRascunho} />}

            {erroGeral && (
              <Alert variant="destructive" titulo="Não foi possível abrir o ticket">
                {erroGeral}
              </Alert>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.equipe}>Setor *</Label>
                <Select
                  id={ids.equipe}
                  value={equipeId}
                  aria-invalid={erros.team_id ? true : undefined}
                  aria-describedby={erros.team_id ? `${ids.equipe}-erro` : `${ids.equipe}-ajuda`}
                  onChange={(e) => {
                    setEquipeId(e.target.value)
                    limpar('team_id')
                  }}
                >
                  <option value="">{equipes ? 'Selecione' : 'Carregando…'}</option>
                  {(equipes ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
                {estimativa?.label ? (
                  <Ajuda id={`${ids.equipe}-ajuda`} className="inline-flex items-center gap-1">
                    <IconClock className="size-3.5" aria-hidden="true" /> Costuma responder em {estimativa.label}
                  </Ajuda>
                ) : (
                  <Ajuda id={`${ids.equipe}-ajuda`}>Quem vai cuidar do seu ticket.</Ajuda>
                )}
                <ErroCampo id={`${ids.equipe}-erro`}>{erros.team_id}</ErroCampo>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.categoria}>Categoria</Label>
                <Select id={ids.categoria} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                  <option value="">Não sei / outra</option>
                  {(categorias ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Ajuda>Opcional. Ajuda a direcionar mais rápido.</Ajuda>
                <ErroCampo>{erros.category_id}</ErroCampo>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.assunto}>Assunto *</Label>
              <Input
                id={ids.assunto}
                value={assunto}
                maxLength={200}
                placeholder="Ex.: Nota fiscal do pedido 8891 saiu com CNPJ errado"
                aria-invalid={erros.subject ? true : undefined}
                aria-describedby={erros.subject ? `${ids.assunto}-erro` : undefined}
                onChange={(e) => {
                  setAssunto(e.target.value)
                  limpar('subject')
                }}
              />
              <ErroCampo id={`${ids.assunto}-erro`}>{erros.subject}</ErroCampo>
              {/* dentro do bloco do assunto: vazia, a região não abre um vão no formulário */}
              <SugestoesDeArtigos assunto={assunto} onAbrir={setArtigoAberto} />
            </div>

            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor={ids.pedido}>Nº do pedido</Label>
              <Input id={ids.pedido} value={pedido} maxLength={40} placeholder="Opcional" onChange={(e) => setPedido(e.target.value)} />
              <ErroCampo>{erros.order_number}</ErroCampo>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.texto}>Mensagem *</Label>
              <Textarea
                id={ids.texto}
                value={texto}
                rows={6}
                placeholder="O que aconteceu, quando começou e o que você já tentou…"
                aria-invalid={erros.body ? true : undefined}
                aria-describedby={erros.body ? `${ids.texto}-erro` : `${ids.texto}-ajuda`}
                onChange={(e) => {
                  setTexto(e.target.value)
                  limpar('body')
                }}
                onPaste={colar}
              />
              <Ajuda id={`${ids.texto}-ajuda`}>Dá para colar um print (Ctrl+V) ou arrastar arquivos para cá.</Ajuda>
              <ErroCampo id={`${ids.texto}-erro`}>{erros.body}</ErroCampo>
            </div>

            <div className="flex flex-col gap-2">
              <ListaDeAnexos anexos={anexos.anexos} onRemover={anexos.remover} />
              <RecusasDeAnexo recusas={anexos.recusas} />
              <ErroCampo>{erros.files}</ErroCampo>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <div>
                  <BotaoAnexar onArquivos={anexos.adicionar} disabled={abrir.isPending} />
                </div>
                <span className="text-legenda text-tinta-secundaria">{descricaoDosLimites(limites)}</span>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button variant="ghost" onClick={() => navigate('/portal/tickets')} disabled={abrir.isPending}>
                  Cancelar
                </Button>
                <Button onClick={enviar} disabled={abrir.isPending} title="Ctrl+Enter">
                  <IconSend /> {abrir.isPending ? 'Abrindo…' : 'Abrir ticket'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </ZonaDeSoltar>

      <FolhaDoArtigo artigoId={artigoAberto} onFechar={() => setArtigoAberto(null)} />
    </div>
  )
}
