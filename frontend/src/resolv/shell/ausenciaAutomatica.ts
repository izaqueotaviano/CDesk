import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/api/client'
import { useMudarPresenca } from '@/api/presenca'
import { useMe } from '@/api/queries/useMe'
import type { Me, Presence } from '@/api/types'
import { usePrefs } from '@/stores/prefs'

/**
 * Ausência automática: depois de N minutos sem ninguém mexer no Resolv, o
 * status passa de "Disponível" para "Ausente"; na próxima atividade, volta.
 *
 * O problema que isto resolve é a fila, não a vaidade do ponto verde: chat
 * entra para quem está "Disponível", e o agente que saiu para almoçar sem
 * mudar o status continuava recebendo conversa que ninguém ia atender.
 *
 * Três regras que valem mais que o cronômetro:
 * 1. Só sai de "Disponível". Quem se marcou Ausente ou Offline escolheu, e o
 *    automático nunca passa por cima de uma escolha.
 * 2. Só volta o que ELE mudou. A marca `CHAVE_AUTOMATICA` diz "fui eu"; sem
 *    ela, mexer no mouse não tira ninguém de um Ausente escolhido à mão.
 *    Escolher qualquer status no menu apaga a marca (MenuPresenca).
 * 3. Uma aba ativa segura todas. Cada aba avisa as outras que houve
 *    atividade (BroadcastChannel, ou o evento `storage` onde ele não existe),
 *    então a aba esquecida em segundo plano não marca Ausente quem está
 *    trabalhando na aba ao lado.
 *
 * O status em si é lido FRESCO do servidor antes de mudar: o `me` em cache
 * desta aba pode estar velho (a pessoa mudou para Offline em outra aba), e
 * a regra 1 depende de saber o valor de agora.
 */

const CHAVE_AUTOMATICA = 'resolv:ausente-automatico'
const CHAVE_ATIVIDADE = 'resolv:ultima-atividade'
const NOME_DO_CANAL = 'resolv:atividade'
/** De quanto em quanto tempo a aba confere se passou do limite. O limite
 *  mínimo é 5 minutos, então 15 s de atraso não mudam nada para ninguém. */
export const INTERVALO_DE_CHECAGEM_MS = 15_000
/** No máximo um aviso de atividade às outras abas a cada 10 s: o mouse
 *  mexendo gera dezenas de eventos por segundo, e elas só precisam saber que
 *  a pessoa está aqui, não onde o cursor está. */
const INTERVALO_DE_DIFUSAO_MS = 10_000
/** Eventos de ponteiro chegam aos montes; entre um registro e outro, 1 s. */
const INTERVALO_DE_REGISTRO_MS = 1_000

const EVENTOS_DE_ATIVIDADE = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

function lerMarca(): boolean {
  try {
    return localStorage.getItem(CHAVE_AUTOMATICA) === '1'
  } catch {
    return false
  }
}

function gravarMarca(ligada: boolean) {
  try {
    if (ligada) localStorage.setItem(CHAVE_AUTOMATICA, '1')
    else localStorage.removeItem(CHAVE_AUTOMATICA)
  } catch {
    // sem storage (aba anônima restrita): a marca vive só nesta execução,
    // e o pior caso é não voltar sozinho para Disponível
  }
}

/** A pessoa escolheu um status no menu: o que estiver valendo agora é dela. */
export function esquecerAusenciaAutomatica(): void {
  gravarMarca(false)
}

/** Por onde as abas contam umas às outras que houve atividade. */
export interface CanalDeAtividade {
  enviar: (em: number) => void
  ouvir: (aoReceber: (em: number) => void) => () => void
}

function canalDoNavegador(): CanalDeAtividade {
  if (typeof BroadcastChannel === 'function') {
    const canal = new BroadcastChannel(NOME_DO_CANAL)
    return {
      enviar: (em) => canal.postMessage(em),
      ouvir: (aoReceber) => {
        const ouvinte = (evento: MessageEvent) => {
          if (typeof evento.data === 'number') aoReceber(evento.data)
        }
        canal.addEventListener('message', ouvinte)
        return () => {
          canal.removeEventListener('message', ouvinte)
          canal.close()
        }
      },
    }
  }
  // Safari antigo: o evento `storage` também só chega às OUTRAS abas
  return {
    enviar: (em) => {
      try {
        localStorage.setItem(CHAVE_ATIVIDADE, String(em))
      } catch {
        // sem storage não há como avisar; cada aba segue com o seu relógio
      }
    },
    ouvir: (aoReceber) => {
      const ouvinte = (evento: StorageEvent) => {
        if (evento.key === CHAVE_ATIVIDADE && evento.newValue) aoReceber(Number(evento.newValue))
      }
      window.addEventListener('storage', ouvinte)
      return () => window.removeEventListener('storage', ouvinte)
    },
  }
}

export interface OpcoesDoVigia {
  /** Minutos sem atividade até ficar Ausente; 0 = nunca (a volta automática
   *  continua valendo para uma ausência marcada antes de desligar). */
  minutos: number
  /** O status de agora, do servidor. */
  lerPresenca: () => Promise<Presence | undefined>
  mudarPresenca: (presenca: Presence) => Promise<unknown>
  canal?: CanalDeAtividade
  /** Onde ouvir teclado/mouse. Padrão: o documento. */
  alvo?: Document
}

/**
 * Liga o vigia e devolve a função que o desliga. Fora do React de propósito:
 * é temporizador, ouvinte de evento e canal entre abas, e assim o teste
 * controla o relógio sem montar tela nenhuma.
 */
export function iniciarVigiaDeAusencia(opcoes: OpcoesDoVigia): () => void {
  const { minutos, lerPresenca, mudarPresenca } = opcoes
  const canal = opcoes.canal ?? canalDoNavegador()
  const alvo = opcoes.alvo ?? document
  const limiteMs = minutos * 60_000

  let ultimaAtividade = Date.now()
  let ultimoRegistro = 0
  let ultimaDifusao = 0
  let ocupado = false // uma troca de status por vez

  async function ausentar() {
    ocupado = true
    try {
      const presenca = await lerPresenca()
      // Mexeram enquanto a leitura voltava, ou outra aba já marcou: nada a
      // fazer. A marca vem ANTES do POST para a outra aba não repetir.
      if (Date.now() - ultimaAtividade < limiteMs || lerMarca()) return
      if (presenca !== 'available') return // regra 1
      gravarMarca(true)
      try {
        await mudarPresenca('away')
      } catch {
        gravarMarca(false) // não mudou nada; não há o que desfazer depois
      }
    } catch {
      // servidor fora do ar: tenta de novo na próxima checagem
    } finally {
      ocupado = false
    }
  }

  async function voltar() {
    ocupado = true
    // apaga ANTES de ler: a próxima atividade (desta ou de outra aba) não
    // tenta voltar de novo enquanto esta volta está em curso
    gravarMarca(false)
    try {
      const presenca = await lerPresenca()
      // Só desfaz o próprio Ausente. Se entretanto virou Offline (logout em
      // outra aba) ou qualquer outra coisa, quem mudou foi outra pessoa.
      if (presenca === 'away') await mudarPresenca('available')
    } catch {
      // sem servidor agora; a pessoa vê "Ausente" no menu e troca à mão
    } finally {
      ocupado = false
    }
  }

  function registrar(em: number, local: boolean) {
    if (em > ultimaAtividade) ultimaAtividade = em
    if (!local) return
    if (em - ultimaDifusao >= INTERVALO_DE_DIFUSAO_MS) {
      ultimaDifusao = em
      canal.enviar(em)
    }
    // regra 2: só a atividade DESTA aba traz de volta — a outra aba cuida
    // da própria, e duas voltas simultâneas seriam dois POSTs
    if (!ocupado && lerMarca()) void voltar()
  }

  function aoAgir() {
    const agora = Date.now()
    // o registro é barato, mas pointermove chega a 60 por segundo
    if (agora - ultimoRegistro < INTERVALO_DE_REGISTRO_MS && !lerMarca()) return
    ultimoRegistro = agora
    registrar(agora, true)
  }

  function aoVoltarParaAba() {
    if (alvo.visibilityState === 'visible') aoAgir()
  }

  const checagem = setInterval(() => {
    if (limiteMs <= 0 || ocupado) return
    if (Date.now() - ultimaAtividade >= limiteMs && !lerMarca()) void ausentar()
  }, INTERVALO_DE_CHECAGEM_MS)

  for (const tipo of EVENTOS_DE_ATIVIDADE) {
    alvo.addEventListener(tipo, aoAgir, { capture: true, passive: true })
  }
  alvo.addEventListener('visibilitychange', aoVoltarParaAba)
  const pararDeOuvir = canal.ouvir((em) => registrar(em, false))

  return () => {
    clearInterval(checagem)
    for (const tipo of EVENTOS_DE_ATIVIDADE) {
      alvo.removeEventListener(tipo, aoAgir, { capture: true })
    }
    alvo.removeEventListener('visibilitychange', aoVoltarParaAba)
    pararDeOuvir()
  }
}

/**
 * Liga o vigia para quem está logado e é da equipe (cliente não tem
 * presença). Chamado do MenuPresenca, que fica montado em toda tela do
 * console — é o dono natural do status de quem está logado.
 */
export function useAusenciaAutomatica(): void {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const { mutateAsync: mudarPresenca } = useMudarPresenca()
  const minutos = usePrefs((s) => s.ausenciaAutomatica)
  const interno = me?.is_internal === true

  useEffect(() => {
    if (!interno) return
    return iniciarVigiaDeAusencia({
      minutos,
      // `fetchQuery` com staleTime 0: sempre vai ao servidor, e de quebra
      // atualiza o `me` que o menu mostra
      lerPresenca: async () =>
        (
          await qc.fetchQuery({
            queryKey: ['me'],
            queryFn: () => api.get<Me>('/api/v1/auth/me/'),
            staleTime: 0,
          })
        ).presence,
      mudarPresenca,
    })
  }, [interno, minutos, qc, mudarPresenca])
}
