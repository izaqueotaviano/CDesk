import { useId, useState, type KeyboardEvent, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconArrowLeft, IconClock, IconPaperclip, IconSend, IconX } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { mensagemDeErro } from '@/resolv/tickets/detalhe/linhaDoTempo'
import {
  LIMITE_ANEXO_MB,
  useAbrirTicketCliente,
  useCategoriasCliente,
  useEquipesCliente,
  useEstimativaEquipe,
  validarAnexos,
} from '../api/tickets'
import { tamanhoArquivo } from '../lib/formato'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Ajuda, ErroCampo, Input, Label, Select, Textarea } from '../ui/input'
import { toast } from '../ui/toaster'
import { SecaoFranquias } from './SecaoFranquias'

type Campo = 'team_id' | 'subject' | 'body' | 'category_id' | 'order_number' | 'files'

/**
 * Abertura de ticket pelo cliente. Consome a cota do plano — quando ela
 * acaba, o backend responde 422 com a mensagem pronta (limite, período,
 * renovação) e ela aparece aqui sem tradução. `SecaoFranquias` mostra as
 * duas franquias (tickets e manutenção) ANTES do bloqueio acontecer —
 * docs/05 §2.5 pede banner permanente, não só o erro na hora.
 */
export function PaginaNovoTicket() {
  const navigate = useNavigate()
  const idBase = useId()
  const { data: equipes } = useEquipesCliente()
  const { data: categorias } = useCategoriasCliente()
  const abrir = useAbrirTicketCliente()

  const [equipeId, setEquipeId] = useState('')
  const [assunto, setAssunto] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [pedido, setPedido] = useState('')
  const [texto, setTexto] = useState('')
  const [anexos, setAnexos] = useState<File[]>([])
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)

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

  function validar() {
    const e: Partial<Record<Campo, string>> = {}
    if (!equipeId) e.team_id = 'Escolha o setor que deve atender.'
    if (!assunto.trim()) e.subject = 'Resuma o problema em uma linha.'
    if (!texto.trim()) e.body = 'Conte o que aconteceu — quanto mais detalhes, mais rápida a resposta.'
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
        arquivos: anexos,
      },
      {
        onSuccess: (t) => {
          toast.success('Ticket aberto', { description: `${t.reference} — você recebe as respostas por e-mail e aqui.` })
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" onKeyDown={aoTeclar}>
      <Link to="/portal/tickets" className="inline-flex w-fit items-center gap-1 text-pequeno text-tinta-secundaria hover:text-tinta">
        <IconArrowLeft className="size-4" aria-hidden="true" /> Tickets
      </Link>

      <SecaoFranquias />

      <Card>
        <CardHeader>
          <CardTitle className="text-titulo">Abrir ticket</CardTitle>
          <CardDescription>Descreva o problema uma vez; o suporte responde por aqui e por e-mail.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
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
                <Ajuda id={`${ids.equipe}-ajuda`} className="inline-flex items-center gap-1 text-acento">
                  <IconClock className="size-3" aria-hidden="true" /> Costuma responder em {estimativa.label}
                </Ajuda>
              ) : (
                <Ajuda id={`${ids.equipe}-ajuda`}>Quem vai cuidar do seu chamado.</Ajuda>
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
              <Ajuda>Opcional — ajuda a direcionar mais rápido.</Ajuda>
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
              aria-describedby={erros.body ? `${ids.texto}-erro` : undefined}
              onChange={(e) => {
                setTexto(e.target.value)
                limpar('body')
              }}
            />
            <ErroCampo id={`${ids.texto}-erro`}>{erros.body}</ErroCampo>
          </div>

          {anexos.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Anexos">
              {anexos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-divisoria bg-navegacao px-2.5 py-1 text-legenda">
                  <IconPaperclip className="size-3 text-tinta-secundaria" aria-hidden="true" />
                  <span className="max-w-[200px] truncate">{f.name}</span>
                  <span className="text-tinta-terciaria">{tamanhoArquivo(f.size)}</span>
                  <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setAnexos((a) => a.filter((_, j) => j !== i))} className="grid size-5 place-items-center rounded-md hover:bg-perigo-suave hover:text-perigo">
                    <IconX className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ErroCampo>{erros.files}</ErroCampo>

          <div className="flex flex-col gap-3 border-t border-divisoria pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => inputAnexo.current?.click()}>
                <IconPaperclip /> Anexar
              </Button>
              <input
                ref={inputAnexo}
                type="file"
                multiple
                hidden
                aria-label="Escolher arquivos"
                onChange={(e) => {
                  const { aceitos, erro } = validarAnexos(Array.from(e.target.files ?? []), anexos)
                  setAnexos((a) => [...a, ...aceitos])
                  setErros((x) => (erro ? { ...x, files: erro } : x))
                  if (!erro) limpar('files')
                  e.target.value = ''
                }}
              />
              <span className="text-legenda text-tinta-terciaria">Imagens e documentos até {LIMITE_ANEXO_MB} MB</span>
            </div>
            <div className="flex gap-2">
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
    </div>
  )
}
