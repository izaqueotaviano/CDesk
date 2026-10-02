import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import type { Me, UiDensity, UiTextSize } from '@/api/types'
import { mudancaVeioDeOutraAba, usePrefs, type Densidade, type TamanhoTexto } from './prefs'

/**
 * Leva as preferências de conforto entre o aparelho (`stores/prefs`, no
 * localStorage) e a conta (`/auth/me/`). As duas pontas continuam existindo
 * por motivos diferentes: o localStorage pinta a tela certa ANTES do `me`
 * chegar (texto grande não pode "crescer" meio segundo depois de abrir), e a
 * conta leva a escolha para o outro computador.
 *
 * Regras:
 * - Na chegada do `me`, a conta ganha. É o que faz o notebook de casa abrir
 *   com o texto que a pessoa escolheu no escritório.
 * - Mudou no aparelho (qualquer tela: Minha conta, o sino, o alternador de
 *   densidade da lista de chamados), grava na conta. Por assinatura do
 *   store, e não por chamada em cada botão: quem mexe numa preferência não
 *   precisa saber que ela é sincronizada.
 * - Não grava de volta o que acabou de chegar do servidor nem o que outra
 *   aba já gravou (ver `mudancaVeioDeOutraAba`).
 */

type Local = Pick<
  ReturnType<typeof usePrefs.getState>,
  'densidade' | 'tamanhoTexto' | 'somNotificacoes' | 'ausenciaAutomatica'
>
/** O pedaço do `/auth/me/` que espelha `Local`. */
export type PreferenciasDaConta = Pick<
  Me,
  'ui_density' | 'ui_text_size' | 'notification_sound' | 'auto_away_minutes'
>

const TEXTO_PARA_CONTA: Record<TamanhoTexto, UiTextSize> = { padrao: '', grande: 'large', maior: 'larger' }
const TEXTO_DA_CONTA: Record<UiTextSize, TamanhoTexto> = { '': 'padrao', large: 'grande', larger: 'maior' }
const DENSIDADE_PARA_CONTA: Record<Densidade, UiDensity> = { compacta: 'compact', confortavel: 'comfortable' }

/** O que a conta diz, traduzido para o store. Campo ausente (servidor
 *  antigo) e densidade vazia ("automático": ninguém escolheu ainda) ficam
 *  de fora — não há o que aplicar, e o aparelho segue com o que tem. */
export function preferenciasDaConta(conta: PreferenciasDaConta): Partial<Local> {
  const local: Partial<Local> = {}
  if (conta.ui_text_size !== undefined && conta.ui_text_size in TEXTO_DA_CONTA) {
    local.tamanhoTexto = TEXTO_DA_CONTA[conta.ui_text_size]
  }
  if (conta.ui_density === 'compact') local.densidade = 'compacta'
  if (conta.ui_density === 'comfortable') local.densidade = 'confortavel'
  if (typeof conta.notification_sound === 'boolean') local.somNotificacoes = conta.notification_sound
  if (conta.auto_away_minutes !== undefined) local.ausenciaAutomatica = conta.auto_away_minutes
  return local
}

/** O que mudou entre dois estados do store, já no formato do PATCH. */
export function mudancasParaConta(antes: Local, depois: Local): Partial<PreferenciasDaConta> | null {
  const mudancas: Partial<PreferenciasDaConta> = {}
  if (antes.tamanhoTexto !== depois.tamanhoTexto) mudancas.ui_text_size = TEXTO_PARA_CONTA[depois.tamanhoTexto]
  if (antes.densidade !== depois.densidade) mudancas.ui_density = DENSIDADE_PARA_CONTA[depois.densidade]
  if (antes.somNotificacoes !== depois.somNotificacoes) mudancas.notification_sound = depois.somNotificacoes
  if (antes.ausenciaAutomatica !== depois.ausenciaAutomatica) mudancas.auto_away_minutes = depois.ausenciaAutomatica
  return Object.keys(mudancas).length > 0 ? mudancas : null
}

// Módulo, e não ref do componente: o `set` que a chegada do `me` provoca é
// síncrono e notifica a assinatura na mesma pilha — a marca só precisa
// durar esse instante.
let aplicandoDaConta = false
// PATCHes ainda sem resposta. Enquanto houver algum, o `me` que chega é de
// um momento anterior à última escolha, e aplicá-lo faria o controle
// "voltar" por um instante (duas trocas rápidas de tamanho de texto).
let gravacoesEmVoo = 0

function aplicarDaConta(valores: Partial<Local>) {
  const estado = usePrefs.getState()
  aplicandoDaConta = true
  try {
    // pelos setters, não por `setState`: o de tamanho do texto também
    // carimba o documento
    if (valores.tamanhoTexto !== undefined && valores.tamanhoTexto !== estado.tamanhoTexto) {
      estado.setTamanhoTexto(valores.tamanhoTexto)
    }
    if (valores.densidade !== undefined && valores.densidade !== estado.densidade) {
      estado.setDensidade(valores.densidade)
    }
    if (valores.somNotificacoes !== undefined && valores.somNotificacoes !== estado.somNotificacoes) {
      estado.setSomNotificacoes(valores.somNotificacoes)
    }
    if (valores.ausenciaAutomatica !== undefined && valores.ausenciaAutomatica !== estado.ausenciaAutomatica) {
      estado.setAusenciaAutomatica(valores.ausenciaAutomatica)
    }
  } finally {
    aplicandoDaConta = false
  }
}

/**
 * Montado uma vez por shell autenticado (via `realtime/useAvisos`, que os
 * dois shells já chamam). Fora de sessão não faz nada: um PATCH sem login
 * seria um 401, e o 401 manda para a tela de login.
 */
export function useSincronizarPreferencias() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const logado = me !== undefined

  const texto = me?.ui_text_size
  const densidade = me?.ui_density
  const som = me?.notification_sound
  const ausencia = me?.auto_away_minutes

  // conta → aparelho
  useEffect(() => {
    if (!logado || gravacoesEmVoo > 0) return
    aplicarDaConta(
      preferenciasDaConta({
        ui_text_size: texto,
        ui_density: densidade ?? '',
        notification_sound: som,
        auto_away_minutes: ausencia,
      }),
    )
  }, [logado, texto, densidade, som, ausencia])

  // aparelho → conta
  useEffect(() => {
    if (!logado) return
    function gravar(mudancas: Partial<PreferenciasDaConta>) {
      gravacoesEmVoo += 1
      api
        .patch<Me>('/api/v1/auth/me/', mudancas)
        .then((novo) => {
          gravacoesEmVoo -= 1
          qc.setQueryData(['me'], novo)
        })
        .catch(() => {
          // Melhor esforço: a escolha continua valendo neste aparelho (está
          // no localStorage), e a próxima mudança tenta de novo. Um aviso de
          // erro aqui seria sobre algo que a pessoa não pediu para salvar.
          gravacoesEmVoo -= 1
        })
    }

    // Densidade escolhida ANTES desta sincronização existir morava só no
    // aparelho, e a conta ainda diz "automático": sobe uma vez, senão o
    // outro computador nunca fica sabendo. Só a confortável — a compacta é
    // o padrão do console e "automático" já resolve para ela.
    const conta = qc.getQueryData<Me>(['me'])
    if (conta?.ui_density === '' && usePrefs.getState().densidade === 'confortavel') {
      gravar({ ui_density: 'comfortable' })
    }

    return usePrefs.subscribe((depois, antes) => {
      if (aplicandoDaConta || mudancaVeioDeOutraAba()) return
      const mudancas = mudancasParaConta(antes, depois)
      if (mudancas) gravar(mudancas)
    })
  }, [logado, qc])
}
