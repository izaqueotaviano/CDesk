import { useId } from 'react'
import { IconClockPause } from '@tabler/icons-react'
import { LinhaDeAjuste, Segmentado } from '@/portal/configuracoes/Ajustes'
import { Secao } from '@/portal/configuracoes/Secao'
import { OPCOES_AUSENCIA, usePrefs, type MinutosAusencia } from '@/stores/prefs'

/**
 * Minha conta → Ausência automática (resolv/shell/ausenciaAutomatica.ts).
 * A descrição diz as duas regras que evitam surpresa: só sai de Disponível,
 * e o que a pessoa escolheu à mão nunca muda sozinho.
 */
export function SecaoAusencia() {
  const id = useId()
  const minutos = usePrefs((s) => s.ausenciaAutomatica)
  const setMinutos = usePrefs((s) => s.setAusenciaAutomatica)
  return (
    <Secao
      id="ausencia"
      icone={IconClockPause}
      titulo="Ausência automática"
      descricao="Quem está Disponível recebe chat da fila. Se você sai sem mudar o status, o Resolv muda por você."
    >
      <LinhaDeAjuste
        id={id}
        titulo="Ficar Ausente depois de"
        descricao="Sem mexer no Resolv por esse tempo, Disponível vira Ausente, e volta quando você voltar. Ausente ou Offline escolhidos por você não mudam sozinhos."
      >
        <Segmentado<MinutosAusencia>
          rotuladoPor={id}
          valor={minutos}
          onMudar={setMinutos}
          opcoes={OPCOES_AUSENCIA.map((m) => ({ valor: m, rotulo: m === 0 ? 'Nunca' : `${m} min` }))}
        />
      </LinhaDeAjuste>
    </Secao>
  )
}
