import { useEffect, useId, useRef, useState } from 'react'
import type { Me } from '@/api/types'
import { useTabs } from '@/stores/tabs'
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
 *  - os botões sem função (formatar, emoji, link) saíram.
 */
export function Compositor({ ticket, me, pedidoReabrir }: Props) {
  const idBase = useId()
  const { data: macros } = useMacros()
  const { responder, aplicarMacro } = useAcoesTicket(ticket.id)
  const rascunhoInicial = useTabs((s) => s.tabs.find((t) => t.ticketId === ticket.id)?.draft ?? '')
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
  if (reabrirVisto !== pedidoReabrir) {
    setReabrirVisto(pedidoReabrir)
    setPublico(true)
    setStatus('open')
  }
  const [anexos, setAnexos] = useState<File[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [menuMacro, setMenuMacro] = useState(false)
  const [tocouFechamento, setTocouFechamento] = useState(false)
  const [agoraMs, setAgoraMs] = useState(() => Date.now())
  const [inicioSolucao, setInicioSolucao] = useState(() => paraDatetimeLocal(ticket.created_at))
  const [fimSolucao, setFimSolucao] = useState(() => paraDatetimeLocal(new Date().toISOString()))
  const [notaFechamento, setNotaFechamento] = useState('')

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

  function trocarModo(paraPublico: boolean) {
    setPublico(paraPublico)
    setErro(null)
    areaRef.current?.focus()
  }

  function enviar() {
    if (!podeEnviar) return
    setErro(null)
    if (vaiFechar) {
      setTocouFechamento(true)
      // "agora" novo só no momento de validar — não a cada tecla
      setAgoraMs(Date.now())
      if (fechamentoInvalido) return
    }
    responder.mutate(
      {
        body: texto.trim(),
        is_public: publico,
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

      <div className="compositor__rodape">
        <div className="compositor__ferramentas">
          <button
            type="button"
            className="compositor__ferramenta"
            onClick={() => inputAnexo.current?.click()}
          >
            <i className="ti ti-paperclip" aria-hidden="true" /> Anexar
          </button>
          <input
            ref={inputAnexo}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              setAnexos((a) => [...a, ...Array.from(e.target.files ?? [])])
              e.target.value = '' // permite re-selecionar o mesmo arquivo
            }}
          />

          {podeMacro && (macros?.length ?? 0) > 0 && (
            <div className="compositor__macro" ref={menuRef}>
              <button
                type="button"
                className={
                  'compositor__ferramenta' + (menuMacro ? ' compositor__ferramenta--ativa' : '')
                }
                aria-haspopup="menu"
                aria-expanded={menuMacro}
                onClick={() => setMenuMacro((v) => !v)}
              >
                <i className="ti ti-bolt" aria-hidden="true" /> Aplicar macro…
              </button>
              {menuMacro && (
                <ul className="compositor__macro-menu" role="menu" aria-label="Macros">
                  {(macros ?? []).map((m) => (
                    <li key={m.id} role="none">
                      <button type="button" role="menuitem" onClick={() => usarMacro(m)}>
                        <span className="compositor__macro-nome">{m.name}</span>
                        {m.body && (
                          <span className="compositor__macro-previa">{m.body.split('\n')[0]}</span>
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
                      </button>
                    </li>
                  ))}
                </ul>
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
