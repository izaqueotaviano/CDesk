import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { MINIMO_PARA_BUSCAR, useBuscaGlobal } from '@/api/busca'
import './busca-global.scss'

/** Uma linha do dropdown, já achatada. Os três grupos têm campos diferentes,
 *  mas o teclado anda por UMA lista só — passar de Chamados para Empresas com
 *  a seta é o esperado, e isso só é simples se a navegação não souber de
 *  grupo nenhum. */
interface Linha {
  chave: string
  /** `null` = linha visível mas sem destino (ver o grupo de solicitantes). */
  rota: string | null
  icone: string
  referencia: string | null
  titulo: string
  detalhe: string | null
}

/** `navigator.platform` é API legada e pode vir vazia (jsdom, e navegadores
 *  que já a congelaram), daí a segunda pista no userAgent. O fallback é Ctrl
 *  porque errar para Ctrl atinge menos gente do que o "⌘K" fixo de hoje, que
 *  está errado para todo mundo que não usa Mac. */
function ehTecladoMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const pista = navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(pista)
}

/**
 * Busca global do Topbar: chamados + empresas + solicitantes num dropdown só,
 * sobre `GET /api/v1/search/` (`apps/core/views.py::GlobalSearchView`, cujo
 * docstring já dizia que quem consome isto é o cabeçalho). Substitui a caixa
 * decorativa que existia aqui — agora é `<input>` de verdade, com Ctrl/⌘+K,
 * teclado nos resultados e os três estados (buscando / vazio / erro).
 *
 * Não reusa o `Popover` do cvz de propósito: lá o trigger ALTERNA no clique, o
 * que fecharia o painel ao clicar de volta no campo, e a seleção por teclado
 * mora no campo (aria-activedescendant), não no painel.
 */
export function BuscaGlobal() {
  const navigate = useNavigate()
  const raizRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLInputElement>(null)
  const idPainel = useId()
  const [termo, setTermo] = useState('')
  const [termoBuscado, setTermoBuscado] = useState('')
  const [aberto, setAberto] = useState(false)
  const [indiceAtivo, setIndiceAtivo] = useState(0)
  const [ehMac] = useState(ehTecladoMac)

  const { data, isLoading, isError, isFetching, refetch } = useBuscaGlobal(termoBuscado)

  const termoLimpo = termo.trim()
  const podeBuscar = termoLimpo.length >= MINIMO_PARA_BUSCAR

  // 250ms parado antes de bater no servidor (mesmo idiom de
  // PaginaListaTickets): sem isto cada tecla vira uma requisição, e a resposta
  // de uma tecla antiga pode chegar depois e sobrescrever a busca atual.
  useEffect(() => {
    const t = setTimeout(() => setTermoBuscado(termo), 250)
    return () => clearTimeout(t)
  }, [termo])

  useEffect(() => {
    if (!aberto) return
    const aoApertarFora = (e: MouseEvent) => {
      if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', aoApertarFora)
    return () => document.removeEventListener('mousedown', aoApertarFora)
  }, [aberto])

  useEffect(() => {
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key?.toLowerCase() !== 'k') return
      // preventDefault porque Ctrl/⌘+K já é atalho do NAVEGADOR (barra de
      // busca no Firefox, busca de link no Chrome): sem isto ele rouba a tecla
      // antes de o campo receber o foco.
      e.preventDefault()
      campoRef.current?.focus()
      campoRef.current?.select()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  const grupos = useMemo(
    () =>
      [
        {
          titulo: 'Chamados',
          linhas: (data?.tickets ?? []).map<Linha>((t) => ({
            chave: `chamado-${t.id}`,
            rota: `/chamados/${t.id}`,
            icone: 'ti ti-ticket',
            referencia: t.reference,
            titulo: t.subject,
            detalhe: t.stage_name ? `${t.company_name} · ${t.stage_name}` : t.company_name,
          })),
        },
        {
          titulo: 'Empresas',
          linhas: (data?.companies ?? []).map<Linha>((e) => ({
            chave: `empresa-${e.id}`,
            rota: `/clientes/${e.id}`,
            icone: 'ti ti-building',
            referencia: null,
            titulo: e.name,
            detalhe: null,
          })),
        },
        {
          titulo: 'Solicitantes',
          linhas: (data?.requesters ?? []).map<Linha>((s) => ({
            chave: `solicitante-${s.id}`,
            // Solicitante não tem tela própria: o clique leva ao painel da
            // empresa dele, que já lista os usuários (simplificação
            // deliberada, documentada em GAPS.md §6). Sem empresa não existe
            // destino, e a linha fica inerte em vez de fingir um.
            rota: s.company_id == null ? null : `/clientes/${s.company_id}`,
            icone: 'ti ti-user',
            referencia: null,
            titulo: s.full_name,
            detalhe: s.company_name ? `${s.email} · ${s.company_name}` : s.email,
          })),
        },
      ].filter((g) => g.linhas.length > 0),
    [data],
  )

  const navegaveis = useMemo(() => grupos.flatMap((g) => g.linhas).filter((l) => l.rota != null), [grupos])

  // O índice guardado pode não existir mais na lista atual (um refetch em
  // segundo plano trouxe menos resultados); derivar em vez de corrigir num
  // efeito evita a renderização em cascata. Quem digita volta pro topo pelo
  // `onChange`, que é onde o conjunto de resultados de fato muda.
  const indice = indiceAtivo < navegaveis.length ? indiceAtivo : 0

  // Cobre os dois silêncios — o debounce ainda contando e a requisição em voo.
  // O "carregando" é do ponto de vista de quem digitou, não da query: entre a
  // tecla e a resposta o dropdown não pode ficar mudo.
  const esperando = podeBuscar && (termoBuscado.trim() !== termoLimpo || isLoading)

  function limpar() {
    setTermo('')
    setTermoBuscado('')
    setAberto(false)
  }

  function abrir(linha: Linha) {
    if (!linha.rota) return
    limpar()
    navigate(linha.rota)
  }

  // A lista só responde ao teclado quando ela está DE FATO na tela. Sem esta
  // guarda, `navegaveis` ainda é o resultado do termo anterior durante a
  // janela do debounce (a queryKey só troca depois do timeout): apertar Enter
  // logo depois de digitar abria um resultado da busca velha enquanto o painel
  // mostrava "Buscando…" e nenhuma linha — e `aria-activedescendant` apontava
  // para um id que não estava no DOM.
  const resultadosNaTela = aberto && !esperando && !isError && grupos.length > 0

  function aoTeclarNoCampo(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      limpar()
      campoRef.current?.blur()
      return
    }
    if (!resultadosNaTela) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (navegaveis.length === 0) return
      // Sem preventDefault as setas levam o cursor para o começo/fim do texto
      // enquanto a seleção anda — os dois ao mesmo tempo.
      e.preventDefault()
      setAberto(true)
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setIndiceAtivo((indice + passo + navegaveis.length) % navegaveis.length)
      return
    }
    if (e.key === 'Enter') {
      const linha = navegaveis[indice]
      if (linha) abrir(linha)
    }
  }

  const ativa = resultadosNaTela ? navegaveis[indice] : undefined
  const idDaLinha = (chave: string) => `${idPainel}-${chave}`

  // São até 24 linhas (8 por grupo) num painel de 420px: sem isto a seleção do
  // teclado sai da área visível e a pessoa navega às cegas. `block: 'nearest'`
  // rola o mínimo — não recentraliza a lista a cada seta.
  useEffect(() => {
    if (!ativa) return
    document.getElementById(`${idPainel}-${ativa.chave}`)?.scrollIntoView({ block: 'nearest' })
  }, [ativa, idPainel])

  return (
    <div className="busca-global" ref={raizRef}>
      <div className="busca-global__caixa">
        <i className="ti ti-search busca-global__lupa" aria-hidden="true" />
        <input
          ref={campoRef}
          type="text"
          className="busca-global__campo"
          role="combobox"
          aria-label="Buscar chamado, empresa ou pessoa"
          placeholder="Buscar chamado, empresa ou pessoa…"
          autoComplete="off"
          value={termo}
          aria-expanded={aberto}
          aria-controls={aberto ? idPainel : undefined}
          aria-autocomplete="list"
          aria-activedescendant={ativa ? idDaLinha(ativa.chave) : undefined}
          onChange={(e) => {
            setTermo(e.target.value)
            // Termo novo, resultados novos: a seleção volta pro primeiro, senão
            // o Enter abriria a linha que ESTAVA naquela posição na busca velha.
            setIndiceAtivo(0)
            setAberto(e.target.value.trim().length >= MINIMO_PARA_BUSCAR)
          }}
          onFocus={() => podeBuscar && setAberto(true)}
          onKeyDown={aoTeclarNoCampo}
        />
        {termo ? (
          <button
            type="button"
            className="busca-global__limpar"
            aria-label="Limpar busca"
            onClick={() => {
              limpar()
              campoRef.current?.focus()
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        ) : (
          // O badge é dica visual do atalho que já está no aria-label do campo;
          // lido em voz alta viraria "Ctrl K" solto no meio da linha.
          <span className="busca-global__atalho" aria-hidden="true">
            {ehMac ? '⌘K' : 'Ctrl K'}
          </span>
        )}
      </div>

      {aberto && (
        <div className="busca-global__painel" id={idPainel}>
          {isError ? (
            <div className="busca-global__estado busca-global__estado--erro" role="alert">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <p>Não foi possível buscar agora.</p>
              <button
                type="button"
                className="busca-global__tentar"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? 'Tentando…' : 'Tentar de novo'}
              </button>
            </div>
          ) : esperando ? (
            <p className="busca-global__estado" role="status">
              Buscando…
            </p>
          ) : grupos.length === 0 ? (
            // role="status" como o "Buscando…": para quem usa leitor de tela a
            // troca de um pelo outro é a única pista de que a busca terminou.
            <p className="busca-global__estado" role="status">
              Nada encontrado para “{termoLimpo}”.
            </p>
          ) : (
            <div className="busca-global__resultados" role="listbox" aria-label="Resultados da busca">
              {grupos.map((grupo) => (
                <div key={grupo.titulo} className="busca-global__grupo" role="group" aria-label={grupo.titulo}>
                  <p className="busca-global__grupo-titulo">{grupo.titulo}</p>
                  {grupo.linhas.map((linha) => {
                    const posicao = navegaveis.indexOf(linha)
                    const conteudo = (
                      <>
                        <i className={`${linha.icone} busca-global__icone`} aria-hidden="true" />
                        <span className="busca-global__texto">
                          <span className="busca-global__titulo">
                            {linha.referencia && (
                              <span className="busca-global__ref">{linha.referencia}</span>
                            )}
                            {linha.titulo}
                          </span>
                          {linha.detalhe && <span className="busca-global__detalhe">{linha.detalhe}</span>}
                        </span>
                      </>
                    )
                    return linha.rota == null ? (
                      // Nem `role="option"` nem clique: uma linha que não leva
                      // a lugar nenhum não deve ser alcançável pelo teclado
                      // nem parecer clicável pelo mouse. O motivo é TEXTO
                      // visível, não `title`: tooltip nativo não aparece no
                      // toque, não é alcançável pelo teclado e leitor de tela
                      // não anuncia `title` em elemento sem papel acessível —
                      // seria explicar só para quem já não precisava.
                      <div key={linha.chave} className="busca-global__linha busca-global__linha--inerte">
                        {conteudo}
                        <span className="busca-global__motivo">sem empresa vinculada</span>
                      </div>
                    ) : (
                      <div
                        key={linha.chave}
                        id={idDaLinha(linha.chave)}
                        role="option"
                        aria-selected={posicao === indice}
                        className={
                          'busca-global__linha' + (posicao === indice ? ' busca-global__linha--ativa' : '')
                        }
                        onMouseEnter={() => setIndiceAtivo(posicao)}
                        onClick={() => abrir(linha)}
                      >
                        {conteudo}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
