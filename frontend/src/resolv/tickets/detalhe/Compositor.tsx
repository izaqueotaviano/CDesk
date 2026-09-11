import { useEffect, useId, useRef, useState } from 'react'
import type { Me } from '@/api/types'
import { useSistemaCfg } from '@/cvz/configuracoes/dados'
import { useTabs, type AbaTicket } from '@/stores/tabs'
import { conferirAnexos, limitesDeAnexo } from '../anexos'
import { ROTULO_PRIORIDADE, ROTULO_STATUS, formatarDataHora } from '../format'
import type { StatusTicket } from '../tipos'
import { useAcoesTicket, useMacros } from './dados'
import {
  STATUS_AO_ENVIAR,
  interpolarMacro,
  marcadoresPendentes,
  mensagemDeErro,
  paraDatetimeLocal,
  rotuloEnviar,
  statusInicialAoEnviar,
  tamanhoArquivo,
  validarFechamento,
} from './linhaDoTempo'
import type { Macro, TicketDetalhe } from './tiposDetalhe'

const ROTULO_AO_ENVIAR: Record<StatusTicket, string> = {
  new: 'Novo',
  open: 'Aberto',
  pending_customer: 'Aguardando retorno do cliente',
  closed: 'Fechado',
}

/** Limites de anexo em vigor. Vêm do servidor (`SystemConfig`), que é quem o
 *  backend consulta em `attachments.limits()` — a tela não tem número próprio. */
/** Valem enquanto GET /api/v1/settings/system/ não respondeu (e para quem o
 *  endpoint recusa: ele é `IsInternalReadAdminWrite`). São os mesmos números de
 *  config/settings/base.py:260-264 — o fallback que o próprio
 *  `attachments.limits()` usa quando não consegue ler o `SystemConfig`, então
 *  na dúvida a tela erra para o mesmo lado que o servidor. */

/**
 * Corpo que vai para `POST /tickets/{id}/reply/`.
 *
 * Anexar um print e enviar sem escrever é o gesto mais natural do suporte, e o
 * botão sempre acendeu para ele — mas `body` é obrigatório no
 * `TicketReplySerializer` (apps/tickets/serializers.py:538, `allow_blank=False`),
 * então esse envio sempre voltava 400. Entre apagar o gesto (botão só acende com
 * texto) e completá-lo, a tela completa: sem texto, o corpo vira a legenda dos
 * arquivos que a pessoa escolheu. É descrição do que está ali, não frase
 * inventada em nome de quem enviou — e a tela mostra a legenda ANTES do envio,
 * então ninguém publica o que não leu.
 *
 * Sem ponto final: o último caractere é um nome de arquivo, e um ponto colado
 * nele parece parte da extensão.
 */
/** "Envio de nota" acha "Envio de Nota"; "ACME" acha "acme". Mesma função,
 *  copiada — não importada — de novo/BuscaPessoa.tsx: a casa já aceita essa
 *  duplicação (BuscaPessoa e resolv/shell/BuscaComando.tsx têm cada uma a
 *  própria cópia) em vez de um utilitário compartilhado para três linhas. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function corpoParaEnviar(texto: string, anexos: File[]): string {
  const escrito = texto.trim()
  if (escrito) return escrito
  if (anexos.length === 0) return ''
  return `Segue em anexo: ${anexos.map((f) => f.name).join(', ')}`
}

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
  pedidoReabrir: number
}

/**
 * Compositor: responder ao cliente ou anotar para a equipe.
 *
 * O que mudou em relação à versão anterior, e por quê:
 *  - o status "ao enviar" é um seletor visível, não um menu escondido atrás de
 *    uma seta (recognition over recall);
 *  - escolher "Fechado" abre AQUI os campos que o backend exige (datas da
 *    solução, D4) — antes o envio falhava com 400 sem explicação;
 *  - o rascunho persiste por aba (`useTabs.atualizarRascunho`, só local);
 *  - erro de envio aparece embaixo e o texto fica; Ctrl+Enter envia;
 *  - macro entra como menu com prévia e ainda grava os campos de triagem no
 *    servidor (apply-macro), que o texto sozinho nunca fez;
 *  - os botões sem função (formatar, emoji, link) saíram;
 *  - o anexo é conferido ANTES de subir, contra o limite que o servidor
 *    publica (`conferirAnexos`), e a tela anuncia esse limite;
 *  - anexo sem texto passou a ser um envio válido: o corpo vira a legenda dos
 *    arquivos (`corpoParaEnviar`), visível antes de enviar;
 *  - "Reabrir…" no cabeçalho não reclassifica mais uma nota interna já
 *    escrita: pergunta.
 */
export function Compositor({ ticket, me, pedidoReabrir }: Props) {
  const idBase = useId()
  const { data: macros } = useMacros()
  // Limite de anexo é configuração do servidor (SystemConfig), não constante da
  // tela: a query é a mesma de Configurações (chave `cfg-sistema`), então cai no
  // cache já quente na maioria das vezes. Ainda não voltou, `limitesDeAnexo`
  // devolve null e a conferência local não recusa nada — ver o porquê lá.
  const { data: cfgSistema } = useSistemaCfg()
  const limites = limitesDeAnexo(cfgSistema)
  const { responder, aplicarMacro } = useAcoesTicket(ticket.id)
  const rascunhoInicial = useTabs(
    (s) => s.tabs.find((t): t is AbaTicket => t.tipo === 'ticket' && t.ticketId === ticket.id)?.draft ?? '',
  )
  const atualizarRascunho = useTabs((s) => s.atualizarRascunho)

  const perms = me?.permissions ?? []
  const interno = me?.is_internal === true
  const podePublico = !interno || perms.includes('ticket.reply_public')
  const podeNota = interno && perms.includes('ticket.add_internal_note')
  const podeMacro = interno && perms.includes('macro.use')
  const fechado = ticket.status === 'closed'

  const [modoPublico, setPublico] = useState(true)
  // quem só pode anotar escreve em "nota interna", sem estado extra: deriva
  const publico = podePublico && modoPublico
  // Nota interna não leva assinatura (ninguém assina um bilhete para a
  // própria equipe) e quem não configurou uma não vê a opção — o servidor
  // segura as duas regras de qualquer forma.
  const podeAssinar = interno && publico && !!me?.signature_render
  const [texto, setTexto] = useState(rascunhoInicial)
  const [status, setStatus] = useState<StatusTicket>(() => statusInicialAoEnviar(ticket.status))
  // Mudanças vindas de fora (status do ticket por realtime; "Reabrir…" no
  // cabeçalho) ajustam o estado DURANTE o render, comparando com o valor
  // anterior — o padrão do React para "derivar de props", sem efeito+setState.
  const [statusVisto, setStatusVisto] = useState(ticket.status)
  if (statusVisto !== ticket.status) {
    setStatusVisto(ticket.status)
    setStatus(statusInicialAoEnviar(ticket.status))
  }
  const [reabrirVisto, setReabrirVisto] = useState(pedidoReabrir)
  // "Reabrir…" fica no CABEÇALHO: quem clica está olhando para lá, não para o
  // compositor. Trocar sozinho para público um texto que a pessoa escreveu em
  // "Nota interna" é decidir por ela quem lê o que ela escreveu — então o modo
  // só muda sozinho quando não há nada escrito. Havendo, a decisão é dela, e a
  // pergunta aparece no compositor (`perguntaReabrir`, abaixo).
  const [perguntaReabrir, setPerguntaReabrir] = useState(false)
  if (reabrirVisto !== pedidoReabrir) {
    setReabrirVisto(pedidoReabrir)
    setStatus('open')
    if (podePublico && !modoPublico && texto.trim()) setPerguntaReabrir(true)
    else setPublico(true)
  }
  const [anexos, setAnexos] = useState<File[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [menuMacro, setMenuMacro] = useState(false)
  // Filtro do menu de macro: texto digitado + índice virtualmente "ativo"
  // (o foco de verdade nunca sai do campo — mesmo padrão de
  // novo/BuscaPessoa.tsx, combobox com aria-activedescendant). Limpo toda
  // vez que o menu abre, no próprio botão que abre (abaixo).
  const [filtroMacro, setFiltroMacro] = useState('')
  const [macroAtiva, setMacroAtiva] = useState(0)
  const [tocouFechamento, setTocouFechamento] = useState(false)
  const [agoraMs, setAgoraMs] = useState(() => Date.now())
  const [inicioSolucao, setInicioSolucao] = useState(() => paraDatetimeLocal(ticket.created_at))
  const [fimSolucao, setFimSolucao] = useState(() => paraDatetimeLocal(new Date().toISOString()))
  const [notaFechamento, setNotaFechamento] = useState('')
  // Assinatura: ligada por padrão para quem tem uma configurada — é o
  // comportamento de cliente de e-mail, e é o que a pessoa quis dizer ao
  // cadastrá-la. Desmarcar vale só para esta mensagem.
  const [assinar, setAssinar] = useState(true)

  const areaRef = useRef<HTMLTextAreaElement>(null)
  const inputAnexo = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // "Reabrir…" no cabeçalho: além de trocar o modo (acima), leva o foco ao texto
  useEffect(() => {
    if (pedidoReabrir > 0) areaRef.current?.focus()
  }, [pedidoReabrir])

  // rascunho por aba — local, com folga para não gravar a cada tecla
  useEffect(() => {
    const h = setTimeout(() => atualizarRascunho(ticket.id, texto), 300)
    return () => clearTimeout(h)
  }, [texto, ticket.id, atualizarRascunho])

  // textarea cresce com o conteúdo (até o limite do CSS)
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [texto, publico])

  // menu de macro fecha ao clicar fora / Esc
  useEffect(() => {
    if (!menuMacro) return
    const fora = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuMacro(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuMacro(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [menuMacro])

  // aviso (macro aplicada etc.) some sozinho
  useEffect(() => {
    if (!aviso) return
    const h = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(h)
  }, [aviso])

  if (!podePublico && !podeNota) {
    return (
      <div className="compositor compositor--bloqueado" role="note">
        <i className="ti ti-lock" aria-hidden="true" />
        Seu papel não permite escrever neste ticket.
      </div>
    )
  }

  const vaiFechar = publico && interno && status === 'closed'
  const errosFechamento = vaiFechar
    ? validarFechamento({
        criadoEm: ticket.created_at,
        inicio: inicioSolucao,
        fim: fimSolucao,
        agoraMs,
      })
    : {}
  const fechamentoInvalido = Boolean(errosFechamento.inicio || errosFechamento.fim)
  const temConteudo = texto.trim().length > 0 || anexos.length > 0
  const podeEnviar = temConteudo && !responder.isPending
  // Anexo sem texto continua acendendo o botão — e agora chega ao servidor com
  // corpo, que é o que faltava (ver `corpoParaEnviar`).
  // (`corpo` já é o nome do texto da macro em `usarMacro`)
  const corpoDaMensagem = corpoParaEnviar(texto, anexos)
  const soAnexo = !texto.trim() && anexos.length > 0
  // Sem configuração carregada não há teto conhecido: não bloqueia e não
  // anuncia número nenhum, em vez de anunciar um chutado.
  const anexosNoLimite = limites != null && anexos.length >= limites.maxArquivos

  function trocarModo(paraPublico: boolean) {
    setPublico(paraPublico)
    setPerguntaReabrir(false)
    setErro(null)
    areaRef.current?.focus()
  }

  function adicionarAnexos(escolhidos: File[]) {
    const { aceitos, recusas } = conferirAnexos(anexos, escolhidos, limites)
    if (aceitos.length > 0) setAnexos((a) => [...a, ...aceitos])
    // O que foi recusado some da tela junto com o motivo — não fica um arquivo
    // na lista que a pessoa acha que vai junto.
    setErro(recusas.length > 0 ? recusas.join(' ') : null)
  }

  function enviar() {
    if (!podeEnviar) return
    setErro(null)
    // Mesma conferência da escolha, agora sobre o lote inteiro — é o que
    // `validar_uploads` faz no servidor. Cobre o caso do limite ter chegado
    // depois da escolha (a configuração é uma query; até ela voltar vale o
    // padrão) e o de o limite ter mudado com a aba aberta.
    const { recusas } = conferirAnexos([], anexos, limites)
    if (recusas.length > 0) {
      setErro(`${recusas.join(' ')} Tire o arquivo da lista para enviar o resto.`)
      return
    }
    if (vaiFechar) {
      setTocouFechamento(true)
      // "agora" novo só no momento de validar — não a cada tecla
      setAgoraMs(Date.now())
      if (fechamentoInvalido) return
    }
    responder.mutate(
      {
        body: corpoDaMensagem,
        is_public: publico,
        // a assinatura NÃO entra no corpo: o servidor a desenha abaixo dele,
        // a partir do perfil (apps/accounts/assinatura.py)
        with_signature: assinar && podeAssinar,
        // resposta pública de agente exige status; nota interna não manda status
        ...(publico && interno ? { new_status: status } : {}),
        ...(vaiFechar
          ? {
              resolution_started_at: new Date(inicioSolucao).toISOString(),
              resolution_ended_at: new Date(fimSolucao).toISOString(),
              close_note: notaFechamento.trim(),
            }
          : {}),
        ...(anexos.length > 0 ? { files: anexos } : {}),
      },
      {
        onSuccess: () => {
          setTexto('')
          setAnexos([])
          setNotaFechamento('')
          setTocouFechamento(false)
          atualizarRascunho(ticket.id, '')
        },
        onError: (e) => {
          setErro(
            `${mensagemDeErro(e, 'Não foi possível enviar.')} Seu texto e os anexos continuam aqui.`,
          )
        },
      },
    )
  }

  function usarMacro(m: Macro) {
    setMenuMacro(false)
    setFiltroMacro('')
    setMacroAtiva(0)
    const corpo = interpolarMacro(m.body ?? '', {
      solicitante: ticket.requester_display,
      empresa: ticket.company_name,
      referencia: ticket.reference,
    })
    if (corpo) setTexto((t) => (t.trim() ? `${t}\n${corpo}` : corpo))
    const pendentes = marcadoresPendentes(corpo)
    const temTriagem = Boolean(
      m.category || m.priority || m.assignee || (m.tags && m.tags.length > 0),
    )
    if (temTriagem) {
      aplicarMacro.mutate(m.id, {
        onError: (e) =>
          setErro(
            `${mensagemDeErro(e, 'A macro não pôde atualizar os campos do ticket.')} O texto foi inserido mesmo assim.`,
          ),
      })
    }
    setAviso(
      pendentes.length
        ? `Macro “${m.name}” aplicada — revise ${pendentes.join(', ')} no texto.`
        : `Macro “${m.name}” aplicada${temTriagem ? ' (texto e campos de triagem)' : ''}.`,
    )
    areaRef.current?.focus()
  }

  const idTexto = `${idBase}-texto`
  const idStatus = `${idBase}-status`
  const idErro = `${idBase}-erro`
  const idMacroLista = `${idBase}-macro-lista`
  const idOpcaoMacro = (m: Macro) => `${idMacroLista}-${m.id}`

  // Filtra por nome E corpo — achar pelo texto que a macro escreve é tão
  // comum quanto achar pelo nome dela. Índice ativo é CLAMPADO aqui, não
  // corrigido num efeito: apagar/filtrar pode encolher a lista para menos
  // que o índice que estava selecionado (mesma técnica de roving tabindex
  // usada em resolv/shell/BarraDeAbas.tsx — derivar durante o render, não
  // sincronizar depois).
  const macrosFiltradas = (macros ?? []).filter((m) =>
    normalizar(`${m.name} ${m.body ?? ''}`).includes(normalizar(filtroMacro)),
  )
  const macroAtivaValida = Math.min(macroAtiva, Math.max(macrosFiltradas.length - 1, 0))
  const rotuloBotao = rotuloEnviar({
    publico,
    statusAtual: ticket.status,
    statusEscolhido: status,
    enviando: responder.isPending,
  })

  return (
    <div className={'compositor' + (publico ? '' : ' compositor--interna')}>
      {fechado && (
        <p className="compositor__aviso-fechado">
          <i className="ti ti-circle-check" aria-hidden="true" />
          Ticket fechado{ticket.closed_at ? ` em ${formatarDataHora(ticket.closed_at)}` : ''}
          {ticket.auto_closed ? ' (automaticamente, por falta de resposta)' : ''}.{' '}
          {publico
            ? 'Uma resposta pública reabre o ticket.'
            : 'Uma nota interna não reabre o ticket.'}
        </p>
      )}

      <div className="compositor__abas" role="tablist" aria-label="Tipo de mensagem">
        {podePublico && (
          <button
            type="button"
            role="tab"
            aria-selected={publico}
            aria-controls={idTexto}
            className={'compositor__aba' + (publico ? ' compositor__aba--ativa' : '')}
            onClick={() => trocarModo(true)}
          >
            <i className="ti ti-arrow-back-up" aria-hidden="true" /> Responder ao cliente
          </button>
        )}
        {podeNota && (
          <button
            type="button"
            role="tab"
            aria-selected={!publico}
            aria-controls={idTexto}
            className={'compositor__aba' + (!publico ? ' compositor__aba--ativa' : '')}
            onClick={() => trocarModo(false)}
          >
            <i className="ti ti-lock" aria-hidden="true" /> Nota interna
          </button>
        )}
        <span className="compositor__destino">
          {publico ? (
            <>
              Para <strong>{ticket.requester_display}</strong>
              {ticket.requester?.email ? (
                <span className="compositor__email"> · {ticket.requester.email}</span>
              ) : null}
            </>
          ) : (
            <>
              <i className="ti ti-eye-off" aria-hidden="true" /> Só a equipe vê
            </>
          )}
        </span>
      </div>

      <textarea
        ref={areaRef}
        id={idTexto}
        className="compositor__texto"
        placeholder={
          publico
            ? 'Escreva a resposta ao cliente…'
            : 'Anote para a equipe — o cliente nunca vê isto…'
        }
        aria-label={publico ? 'Resposta ao cliente' : 'Nota interna'}
        aria-describedby={erro ? idErro : undefined}
        value={texto}
        rows={3}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            enviar()
          }
        }}
      />

      {anexos.length > 0 && (
        <ul className="compositor__anexos" aria-label="Anexos a enviar">
          {anexos.map((f, i) => (
            <li key={`${f.name}-${i}`} className="compositor__anexo">
              <i className="ti ti-paperclip" aria-hidden="true" />
              <span className="compositor__anexo-nome">{f.name}</span>
              <span className="compositor__anexo-tam">{tamanhoArquivo(f.size)}</span>
              <button
                type="button"
                aria-label={`Remover ${f.name}`}
                onClick={() => setAnexos((a) => a.filter((_, j) => j !== i))}
              >
                <i className="ti ti-x" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {soAnexo && (
        <p className="compositor__corpo-padrao">
          <i className="ti ti-corner-down-right" aria-hidden="true" />
          Sem nada escrito, a mensagem vai com a legenda “{corpoDaMensagem}”.
        </p>
      )}

      {vaiFechar && (
        <fieldset className="compositor__fechamento">
          <legend>
            Fechamento — registre o período real da solução
            <span className="compositor__fechamento-dica">
              (a resposta e o fechamento vão juntos)
            </span>
          </legend>
          <div className="compositor__fechamento-campos">
            <div className="compositor__campo">
              <label htmlFor={`${idBase}-inicio`}>Início da solução</label>
              <input
                id={`${idBase}-inicio`}
                type="datetime-local"
                value={inicioSolucao}
                onChange={(e) => setInicioSolucao(e.target.value)}
                aria-invalid={tocouFechamento && !!errosFechamento.inicio}
              />
              {tocouFechamento && errosFechamento.inicio && (
                <span className="compositor__campo-erro">{errosFechamento.inicio}</span>
              )}
            </div>
            <div className="compositor__campo">
              <label htmlFor={`${idBase}-fim`}>Fim da solução</label>
              <input
                id={`${idBase}-fim`}
                type="datetime-local"
                value={fimSolucao}
                onChange={(e) => setFimSolucao(e.target.value)}
                aria-invalid={tocouFechamento && !!errosFechamento.fim}
              />
              {tocouFechamento && errosFechamento.fim && (
                <span className="compositor__campo-erro">{errosFechamento.fim}</span>
              )}
            </div>
            <div className="compositor__campo compositor__campo--largo">
              <label htmlFor={`${idBase}-nota`}>
                Justificativa{' '}
                <span className="compositor__opcional">(opcional, vai para o histórico)</span>
              </label>
              <input
                id={`${idBase}-nota`}
                type="text"
                maxLength={200}
                value={notaFechamento}
                placeholder="Ex.: correção aplicada e validada com o cliente"
                onChange={(e) => setNotaFechamento(e.target.value)}
              />
            </div>
          </div>
        </fieldset>
      )}

      {perguntaReabrir && (
        <div className="compositor__pergunta" role="alert">
          <i className="ti ti-help-circle" aria-hidden="true" />
          <div>
            <p>
              Reabrir é responder ao cliente, mas você está escrevendo uma nota interna. O texto
              continua interno até você decidir.
            </p>
            <div className="compositor__pergunta-acoes">
              <button
                type="button"
                className="compositor__pergunta-botao compositor__pergunta-botao--primario"
                onClick={() => {
                  setPublico(true)
                  setPerguntaReabrir(false)
                  areaRef.current?.focus()
                }}
              >
                Passar para resposta ao cliente
              </button>
              <button
                type="button"
                className="compositor__pergunta-botao"
                onClick={() => {
                  setPerguntaReabrir(false)
                  areaRef.current?.focus()
                }}
              >
                Manter como nota interna
              </button>
            </div>
          </div>
        </div>
      )}

      {aviso && (
        <p className="compositor__aviso" role="status">
          <i className="ti ti-bolt" aria-hidden="true" /> {aviso}
        </p>
      )}
      {erro && (
        <p id={idErro} className="compositor__erro" role="alert">
          <i className="ti ti-alert-circle" aria-hidden="true" /> {erro}
        </p>
      )}

      {podeAssinar && (
        <div className="compositor__assinatura">
          <label className="compositor__assinatura-toggle">
            <input
              type="checkbox"
              checked={assinar}
              onChange={(e) => setAssinar(e.target.checked)}
            />
            Incluir minha assinatura
          </label>
          {/* a prévia evita a surpresa de descobrir o rodapé depois de enviado;
              o HTML já vem higienizado do servidor (`signature_render`) */}
          {assinar && (
            <div
              className="compositor__assinatura-previa assinatura-mensagem"
              dangerouslySetInnerHTML={{ __html: me?.signature_render ?? '' }}
            />
          )}
        </div>
      )}

      <div className="compositor__rodape">
        <div className="compositor__ferramentas">
          <button
            type="button"
            className="compositor__ferramenta"
            onClick={() => inputAnexo.current?.click()}
            disabled={anexosNoLimite}
            title={
              anexosNoLimite && limites
                ? `Você já escolheu ${limites.maxArquivos} arquivo(s), o máximo por mensagem.`
                : undefined
            }
          >
            <i className="ti ti-paperclip" aria-hidden="true" /> Anexar
          </button>
          <input
            ref={inputAnexo}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              adicionarAnexos(Array.from(e.target.files ?? []))
              e.target.value = '' // permite re-selecionar o mesmo arquivo
            }}
          />
          {/* O limite fica visível ANTES de escolher: era a tela de abertura
              prometendo 20 MB que fazia a pessoa esperar o upload para descobrir
              que o teto é outro. */}
          {limites && (
            <span className="compositor__dica-anexo">
              Até {limites.maxMb} MB por arquivo · {limites.maxArquivos} arquivos ·{' '}
              {limites.maxMbPorMensagem} MB no total
            </span>
          )}

          {podeMacro && (macros?.length ?? 0) > 0 && (
            <div className="compositor__macro" ref={menuRef}>
              <button
                type="button"
                className={
                  'compositor__ferramenta' + (menuMacro ? ' compositor__ferramenta--ativa' : '')
                }
                aria-haspopup="listbox"
                aria-expanded={menuMacro}
                onClick={() => {
                  // Abrir sempre começa sem filtro — reabrir com o texto da
                  // última vez leria como "a macro que eu buscei antes
                  // sumiu", já que a lista mostraria só o resultado antigo.
                  if (!menuMacro) {
                    setFiltroMacro('')
                    setMacroAtiva(0)
                  }
                  setMenuMacro((v) => !v)
                }}
              >
                <i className="ti ti-bolt" aria-hidden="true" /> Aplicar macro…
              </button>
              {menuMacro && (
                <div className="compositor__macro-painel">
                  {/* Fora da área que rola (compositor__macro-menu, abaixo):
                      um campo fixo que rola junto seria escondido pela
                      própria lista que ele filtra. O foco fica AQUI o tempo
                      todo — as opções não são tabuláveis, mesmo padrão de
                      novo/BuscaPessoa.tsx (combobox com seleção virtual via
                      aria-activedescendant, não uma navegação por Tab entre
                      itens de um menu). */}
                  <input
                    type="text"
                    autoFocus
                    className="compositor__macro-filtro"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={idMacroLista}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      macrosFiltradas[macroAtivaValida]
                        ? idOpcaoMacro(macrosFiltradas[macroAtivaValida])
                        : undefined
                    }
                    placeholder="Filtrar macros…"
                    aria-label="Filtrar macros por nome ou texto"
                    value={filtroMacro}
                    onChange={(e) => {
                      setFiltroMacro(e.target.value)
                      setMacroAtiva(0)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setMacroAtiva((i) => Math.min(i + 1, macrosFiltradas.length - 1))
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setMacroAtiva((i) => Math.max(i - 1, 0))
                      } else if (e.key === 'Enter') {
                        const m = macrosFiltradas[macroAtivaValida]
                        if (m) {
                          e.preventDefault()
                          usarMacro(m)
                        }
                      }
                      // Escape: sem handler próprio — o mousedown/keydown de
                      // documento logo acima (useEffect) já fecha o menu ao
                      // ouvir Escape em qualquer lugar dentro dele.
                    }}
                  />
                  <ul
                    id={idMacroLista}
                    className="compositor__macro-menu"
                    role="listbox"
                    aria-label="Macros"
                  >
                    {macrosFiltradas.length === 0 ? (
                      <li className="compositor__macro-vazio" role="presentation">
                        Nenhuma macro com “{filtroMacro}”.
                      </li>
                    ) : (
                      macrosFiltradas.map((m, i) => (
                        <li
                          key={m.id}
                          id={idOpcaoMacro(m)}
                          role="option"
                          aria-selected={i === macroAtivaValida}
                          className={
                            'compositor__macro-opcao' +
                            (i === macroAtivaValida ? ' compositor__macro-opcao--ativa' : '')
                          }
                          onMouseEnter={() => setMacroAtiva(i)}
                          onClick={() => usarMacro(m)}
                        >
                          <span className="compositor__macro-nome">{m.name}</span>
                          {m.body && (
                            <span className="compositor__macro-previa">
                              {m.body.split('\n')[0]}
                            </span>
                          )}
                          {(m.category_name || m.priority || m.assignee_name) && (
                            <span className="compositor__macro-triagem">
                              {[
                                m.category_name && `categoria → ${m.category_name}`,
                                m.priority &&
                                  `prioridade → ${ROTULO_PRIORIDADE[m.priority] ?? m.priority}`,
                                m.assignee_name && `responsável → ${m.assignee_name}`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="compositor__enviar">
          {publico && interno && (
            <span className="compositor__status">
              <label htmlFor={idStatus}>Ao enviar, deixar</label>
              <span className="compositor__status-select">
                <select
                  id={idStatus}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusTicket)}
                  // Select nativo focado + roda do mouse por cima = o
                  // navegador troca a opção selecionada em vez de rolar a
                  // página (Chrome e Firefox, sem precisar clicar de novo —
                  // some dar :focus uma vez já bastou). Aqui é o pior lugar
                  // possível pra isso: rolar até o fim da conversa pra
                  // responder passa o cursor bem em cima deste combo, e
                  // "Fechado" é a última opção da lista — um scroll comum
                  // pousa exatamente nela, o botão vira verde e a resposta
                  // fecharia o ticket sem ninguém ter escolhido isso.
                  // Devolve o evento pro scroll normal da página assim que
                  // ele chega, antes do navegador aplicar a troca.
                  onWheel={(e) => e.currentTarget.blur()}
                >
                  {STATUS_AO_ENVIAR.map((s) => (
                    <option key={s} value={s}>
                      {ROTULO_AO_ENVIAR[s] ?? ROTULO_STATUS[s]}
                    </option>
                  ))}
                </select>
                <i className="ti ti-chevron-down" aria-hidden="true" />
              </span>
            </span>
          )}
          <button
            type="button"
            className={'compositor__botao' + (vaiFechar ? ' compositor__botao--fechar' : '')}
            disabled={!podeEnviar}
            onClick={enviar}
            // O convite do title ("ou anexe um arquivo") ficou: agora ele é
            // verdade — anexo sem texto envia, com a legenda de `corpoParaEnviar`.
            title={temConteudo ? 'Ctrl+Enter' : 'Escreva algo ou anexe um arquivo para enviar'}
          >
            {rotuloBotao}
            <kbd aria-hidden="true">⌃↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
