import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFocusTrap } from '@/cvz/hooks'
import { MINIMO_PARA_BUSCAR, useBuscaGlobal } from '@/api/busca'
import { NAV } from './Sidebar'
import './busca-comando.scss'

/** Uma linha do painel, já achatada — os quatro grupos têm campos diferentes,
 *  mas o teclado anda por UMA lista só. */
interface Linha {
  chave: string
  rota: string | null
  icone: string
  referencia: string | null
  titulo: string
  detalhe: string | null
}

function ehTecladoMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const pista = navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(pista)
}

const SECOES = NAV.filter((n) => n.enabled)

/**
 * Busca + navegação do shell, num painel central sobre véu — Fase 2 da
 * unificação de shell: fundiu o campo `BuscaGlobal` (que vivia inline na
 * Topbar) com o `CommandPalette` do cvzdesk (que só existia dentro do
 * `AppShell` do cvz, hoje morto — não tinha busca de verdade, só filtrava uma
 * lista fixa de comandos). A Topbar não existe mais, então o gatilho virou
 * ícone na Sidebar; sem lugar fixo para um `<input>` inline, o painel
 * centralizado é o formato certo — mesma estrutura do CommandPalette antigo
 * (véu, painel, `useFocusTrap`), dados e teclado do BuscaGlobal antigo
 * (grupos, debounce, roving index).
 *
 * "Navegar" é o grupo novo: as rotas da Sidebar, sempre visíveis (inclusive
 * com o campo vazio — é o que dá o efeito de paleta de comandos ao abrir com
 * Ctrl/⌘K antes de digitar nada). Os outros três grupos (Chamados, Empresas,
 * Solicitantes) só entram a partir de `MINIMO_PARA_BUSCAR`, igual antes.
 */
export function BuscaComando({
  aberto,
  onAbrir,
  onFechar,
}: {
  aberto: boolean
  onAbrir: () => void
  onFechar: () => void
}) {
  const navigate = useNavigate()
  const painelRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLInputElement>(null)
  const idPainel = useId()
  const [termo, setTermo] = useState('')
  const [termoBuscado, setTermoBuscado] = useState('')
  const [indiceAtivo, setIndiceAtivo] = useState(0)
  const [ehMac] = useState(ehTecladoMac)

  useFocusTrap(painelRef, aberto)

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

  // Atalho global — abre de qualquer tela, mesmo com o painel já fechado.
  useEffect(() => {
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key?.toLowerCase() !== 'k') return
      // preventDefault porque Ctrl/⌘+K já é atalho do NAVEGADOR (barra de
      // busca no Firefox, busca de link no Chrome): sem isto ele rouba a tecla
      // antes de o campo receber o foco.
      e.preventDefault()
      onAbrir()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onAbrir])

  // Reseta o campo e trava o scroll a cada abertura — padrão do
  // CommandPalette original (cvz/components), preservado: reescrever como
  // ajuste de estado durante o render introduzia um frame de atraso real no
  // reset ao reabrir. O FOCO inicial é responsabilidade só do
  // `useFocusTrap` acima (o campo é o primeiro elemento focável do painel) —
  // chamar `.focus()' aqui também duplicaria o trabalho sem motivo.
  useEffect(() => {
    if (!aberto) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
    setTermo('')
    setTermoBuscado('')
    setIndiceAtivo(0)
    document.body.classList.add('is-locked')
    return () => document.body.classList.remove('is-locked')
  }, [aberto])

  const grupoNavegar = useMemo<{ titulo: string; linhas: Linha[] }>(() => {
    const q = termoLimpo.toLowerCase()
    const itens = q ? SECOES.filter((s) => s.label.toLowerCase().includes(q)) : SECOES
    return {
      titulo: 'Navegar',
      linhas: itens.map((s) => ({
        chave: `secao-${s.id}`,
        rota: s.route,
        icone: s.icon,
        referencia: null,
        titulo: s.label,
        detalhe: null,
      })),
    }
  }, [termoLimpo])

  const grupos = useMemo(
    () =>
      [
        grupoNavegar,
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
            // deliberada, documentada em GAPS.md §6).
            rota: s.company_id == null ? null : `/clientes/${s.company_id}`,
            icone: 'ti ti-user',
            referencia: null,
            titulo: s.full_name,
            detalhe: s.company_name ? `${s.email} · ${s.company_name}` : s.email,
          })),
        },
      ].filter((g) => g.linhas.length > 0),
    [grupoNavegar, data],
  )

  const navegaveis = useMemo(() => grupos.flatMap((g) => g.linhas).filter((l) => l.rota != null), [grupos])
  const indice = indiceAtivo < navegaveis.length ? indiceAtivo : 0

  // Cobre os dois silêncios — o debounce ainda contando e a requisição em
  // voo — só quando a busca de verdade está envolvida (Navegar nunca espera
  // rede).
  const esperandoBusca = podeBuscar && (termoBuscado.trim() !== termoLimpo || isLoading)

  function fechar() {
    onFechar()
  }

  function abrirLinha(linha: Linha) {
    if (!linha.rota) return
    fechar()
    navigate(linha.rota)
  }

  // A lista só responde ao teclado quando ela está DE FATO confiável na
  // tela. Sem esta guarda, `navegaveis` ainda é o resultado do termo anterior
  // durante a janela do debounce (a queryKey só troca depois do timeout):
  // apertar Enter logo depois de digitar abria um resultado da busca velha
  // enquanto o painel mostrava "Buscando…" e nenhuma linha de verdade.
  const resultadosConfiaveis = !esperandoBusca && !isError && navegaveis.length > 0

  function aoTeclarNoCampo(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      fechar()
      return
    }
    if (!resultadosConfiaveis) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setIndiceAtivo((indice + passo + navegaveis.length) % navegaveis.length)
      return
    }
    if (e.key === 'Enter') {
      const linha = navegaveis[indice]
      if (linha) abrirLinha(linha)
    }
  }

  const ativa = resultadosConfiaveis ? navegaveis[indice] : undefined
  const idDaLinha = (chave: string) => `${idPainel}-${chave}`

  // Até 4 grupos de 8 linhas cada num painel de altura limitada: sem isto a
  // seleção do teclado sai da área visível.
  useEffect(() => {
    if (!ativa) return
    document.getElementById(`${idPainel}-${ativa.chave}`)?.scrollIntoView({ block: 'nearest' })
  }, [ativa, idPainel])

  if (!aberto) return null

  return (
    <div
      className="busca-comando__veu"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) fechar()
      }}
    >
      <div ref={painelRef} className="busca-comando" role="dialog" aria-modal="true" aria-label="Buscar e navegar">
        <div className="busca-comando__caixa">
          <i className="ti ti-search busca-comando__lupa" aria-hidden="true" />
          <input
            ref={campoRef}
            type="text"
            className="busca-comando__campo"
            role="combobox"
            aria-label="Buscar chamado, empresa, pessoa ou área do sistema"
            placeholder="Buscar ou ir para…"
            autoComplete="off"
            spellCheck={false}
            value={termo}
            aria-expanded={aberto}
            aria-controls={idPainel}
            aria-autocomplete="list"
            aria-activedescendant={ativa ? idDaLinha(ativa.chave) : undefined}
            onChange={(e) => {
              setTermo(e.target.value)
              setIndiceAtivo(0)
            }}
            onKeyDown={aoTeclarNoCampo}
          />
          <kbd className="busca-comando__esc">esc</kbd>
        </div>

        <div className="busca-comando__resultados" id={idPainel}>
          {isError ? (
            <div className="busca-comando__estado busca-comando__estado--erro" role="alert">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <p>Não foi possível buscar agora.</p>
              <button
                type="button"
                className="busca-comando__tentar"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? 'Tentando…' : 'Tentar de novo'}
              </button>
            </div>
          ) : esperandoBusca ? (
            <p className="busca-comando__estado" role="status">
              Buscando…
            </p>
          ) : grupos.length === 0 ? (
            <p className="busca-comando__estado" role="status">
              Nada encontrado para “{termoLimpo}”.
            </p>
          ) : (
            <div role="listbox" aria-label="Resultados">
              {grupos.map((grupo) => (
                <div key={grupo.titulo} className="busca-comando__grupo" role="group" aria-label={grupo.titulo}>
                  <p className="busca-comando__grupo-titulo">{grupo.titulo}</p>
                  {grupo.linhas.map((linha) => {
                    const posicao = navegaveis.indexOf(linha)
                    const conteudo = (
                      <>
                        <i className={`${linha.icone} busca-comando__icone`} aria-hidden="true" />
                        <span className="busca-comando__texto">
                          <span className="busca-comando__titulo">
                            {linha.referencia && (
                              <span className="busca-comando__ref">{linha.referencia}</span>
                            )}
                            {linha.titulo}
                          </span>
                          {linha.detalhe && <span className="busca-comando__detalhe">{linha.detalhe}</span>}
                        </span>
                      </>
                    )
                    return linha.rota == null ? (
                      <div key={linha.chave} className="busca-comando__linha busca-comando__linha--inerte">
                        {conteudo}
                        <span className="busca-comando__motivo">sem empresa vinculada</span>
                      </div>
                    ) : (
                      <div
                        key={linha.chave}
                        id={idDaLinha(linha.chave)}
                        role="option"
                        aria-selected={posicao === indice}
                        className={
                          'busca-comando__linha' + (posicao === indice ? ' busca-comando__linha--ativa' : '')
                        }
                        onMouseEnter={() => setIndiceAtivo(posicao)}
                        onClick={() => abrirLinha(linha)}
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

        <div className="busca-comando__rodape">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>↵</kbd> abrir
          </span>
          <span>
            <kbd>{ehMac ? '⌘' : 'Ctrl'}</kbd>
            <kbd>K</kbd> {ehMac ? '' : 'abrir/fechar'}
          </span>
        </div>
      </div>
    </div>
  )
}
