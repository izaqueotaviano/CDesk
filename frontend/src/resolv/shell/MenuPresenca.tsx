import { useNavigate } from 'react-router-dom'
import { Popover } from '@/cvz/components'
import { useLogout } from '@/api/mutations/useLogout'
import { PRESENCAS, ROTULO_PRESENCA, useMudarPresenca } from '@/api/presenca'
import { useMe } from '@/api/queries/useMe'
import type { Presence } from '@/api/types'
import { identidadeDe } from '@/ui/identidade'
import { iniciais } from '../chat/format'
import './menu-presenca.scss'
import { Icone } from './Icone'

const ICONE_PRESENCA: Record<Presence, string> = {
  available: 'ti ti-circle-check',
  away: 'ti ti-clock',
  offline: 'ti ti-circle-minus',
}

/**
 * Menu do avatar: mostra a presença REAL de quem está logado e deixa trocá-la.
 * Antes o Topbar cravava `--available` na marca do avatar — a própria pessoa
 * aparecia sempre verde enquanto "Equipe agora" mostrava a presença de verdade
 * dos colegas ao lado, e não havia lugar nenhum no front para se marcar como
 * Ausente, embora POST /api/v1/me/presence/ já existisse.
 *
 * Vive na zona utilitária da Sidebar desde a Fase 2 (a Topbar não existe
 * mais) — o gatilho perdeu o nome ao lado do avatar (não cabe em 56px; a
 * dica ao passar o mouse cobre isso) e o painel agora absorve "Sair", que
 * antes era um ícone à parte na barra: este menu é o único lugar do shell
 * com identidade de quem está logado, então é aqui que a sessão termina.
 *
 * "Offline" aqui é escolha manual, e o backend trata como tal
 * (`apps/accounts/views.py::MyPresenceView`): é ficar logado mas invisível pra
 * fila — diferente do Offline do logout, que é forçado, não pedido. Por isso a
 * opção fica no menu junto das outras duas em vez de virar sinônimo de "Sair".
 */
export function MenuPresenca() {
  const navigate = useNavigate()
  const { data: usuario } = useMe()
  const mudar = useMudarPresenca()
  const logout = useLogout()

  const nome = usuario?.full_name ?? '—'
  const presenca = usuario?.presence
  // `!== false` e não `=== true`: durante o carregamento do /auth/me/ o menu
  // se comporta como interno (que é quem chega aqui via RotaProtegida); só um
  // cliente confirmado perde as opções de presença.
  const interno = usuario?.is_internal !== false

  function escolher(nova: Presence, fechar: () => void) {
    if (nova !== presenca) mudar.mutate(nova)
    fechar()
  }

  const rotuloAtual = presenca ? ROTULO_PRESENCA[presenca] : 'carregando'
  const situacao = mudar.isPending
    ? 'salvando status'
    : mudar.isError
      ? 'não foi possível salvar o status'
      : rotuloAtual

  return (
    <Popover
      align="end"
      trigger={(props) => (
        <>
          <button
            type="button"
            className="menu-presenca__gatilho"
            // O ponto colorido é `aria-hidden`, então a presença precisa vir
            // pelo nome acessível do botão — senão o menu é a única forma de
            // um leitor de tela descobrir o próprio status.
            aria-label={`${nome} · ${situacao}. Abrir menu de presença`}
            data-tooltip={`${nome} · ${rotuloAtual}`}
            {...props}
          >
            <span className="menu-presenca__avatar" {...identidadeDe(nome)}>
              {iniciais(nome)}
              <span
                className={`menu-presenca__ponto menu-presenca__ponto--${presenca ?? 'desconhecida'}`}
                aria-hidden="true"
              />
            </span>
            <span className="menu-presenca__nome">{nome}</span>
            {mudar.isPending && (
              <Icone nome="ti ti-loader-2" tamanho={16} className="menu-presenca__girando" />
            )}
            {mudar.isError && <i className="ti ti-alert-circle menu-presenca__alerta" aria-hidden="true" />}
          </button>
          {/* A mutação termina com o menu já fechado (fechamos no clique), então
              o resultado precisa de um lugar fora do painel para ser anunciado. */}
          <span className="menu-presenca__anuncio" role="status">
            {mudar.isPending ? 'Salvando status…' : mudar.isError ? 'Não foi possível mudar seu status.' : ''}
          </span>
        </>
      )}
    >
      {(fechar) => (
        <div className="menu-presenca">
          <header className="menu-presenca__cabecalho">
            <strong>{nome}</strong>
            {usuario?.email && <span>{usuario.email}</span>}
          </header>

          {interno && (
            <>
              {/* radiogroup/aria-checked, e não aria-current: as três opções são
                  mutuamente exclusivas e mudam um estado, enquanto aria-current
                  serve para marcar "o item atual" dentro de um conjunto de
                  links de navegação — o que "Minha conta" abaixo é, e estas não.
                  Todas seguem tabuláveis de propósito: o Popover não move foco
                  nem gerencia setas, então um único ponto de tabulação (roving
                  tabindex sem setas) deixaria duas opções inalcançáveis. */}
              <div className="menu-presenca__opcoes" role="radiogroup" aria-label="Meu status">
                {PRESENCAS.map((p) => {
                  const atual = p === presenca
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={atual}
                      className={'menu-presenca__opcao' + (atual ? ' menu-presenca__opcao--atual' : '')}
                      disabled={mudar.isPending}
                      onClick={() => escolher(p, fechar)}
                    >
                      <i className={ICONE_PRESENCA[p]} aria-hidden="true" />
                      <span className={`menu-presenca__ponto menu-presenca__ponto--${p}`} aria-hidden="true" />
                      {ROTULO_PRESENCA[p]}
                    </button>
                  )
                })}
              </div>

              {mudar.isError && (
                // Sem botão de "tentar de novo": as três opções continuam ali
                // logo acima, e clicar de novo já é a repetição.
                <p className="menu-presenca__erro" role="alert">
                  {mudar.error instanceof Error ? mudar.error.message : 'Erro ao mudar o status.'}
                </p>
              )}

              <div className="menu-presenca__separador" />
            </>
          )}

          {/* Obrigatório: hoje o clique no avatar leva direto pra /conta, e o
              menu não pode comer esse caminho. Botão + navigate como o resto
              do shell (Sidebar.tsx, PainelNotificacoes.tsx). */}
          <button
            type="button"
            className="menu-presenca__conta"
            onClick={() => {
              fechar()
              navigate('/conta')
            }}
          >
            <Icone nome="ti ti-user-cog" tamanho={16} />
            Minha conta
          </button>

          {/* Sair — morava na Topbar como ícone próprio; a Fase 2 tirou a
              Topbar e este menu passou a ser o único lugar com identidade de
              quem está logado, então é aqui que a sessão termina agora. */}
          <button
            type="button"
            className="menu-presenca__conta"
            disabled={logout.isPending}
            onClick={() => {
              fechar()
              logout.mutate()
            }}
          >
            <Icone nome="ti ti-logout-2" tamanho={16} />
            Sair
          </button>
        </div>
      )}
    </Popover>
  )
}
