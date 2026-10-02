import { useId } from 'react'
import {
  IconBaselineDensityLarge,
  IconBaselineDensitySmall,
  IconDeviceDesktop,
  IconMoon,
  IconPalette,
  IconSun,
} from '@tabler/icons-react'
import { LinhaDeAjuste, Segmentado, SeletorTamanhoTexto } from '@/portal/configuracoes/Ajustes'
import { Secao } from '@/portal/configuracoes/Secao'
import { usePrefs, type Densidade, type Tema } from '@/stores/prefs'

/**
 * Minha conta → Aparência: tema, tamanho do texto e densidade — as três
 * preferências de "como a tela se desenha", juntas. Cada uma já existia
 * espalhada (o tema no botão do topo, a densidade na lista de chamados); aqui
 * elas ganham um lugar onde se acha tudo, e escolher aqui é escolher lá.
 */
export function SecaoAparencia() {
  const idTema = useId()
  const idTexto = useId()
  const idDensidade = useId()
  const tema = usePrefs((s) => s.tema)
  const setTema = usePrefs((s) => s.setTema)
  const densidade = usePrefs((s) => s.densidade)
  const setDensidade = usePrefs((s) => s.setDensidade)

  return (
    <Secao
      id="aparencia"
      icone={IconPalette}
      titulo="Aparência"
      descricao="Como o Resolv se desenha para você. Muda na hora, sem salvar."
    >
      <div className="flex flex-col divide-y divide-divisoria">
        <LinhaDeAjuste
          id={idTema}
          titulo="Tema"
          descricao="Sistema acompanha o claro ou escuro do seu computador. Vale para este navegador."
        >
          <Segmentado<Tema>
            rotuladoPor={idTema}
            valor={tema}
            onMudar={setTema}
            opcoes={[
              { valor: 'claro', rotulo: 'Claro', icone: IconSun },
              { valor: 'escuro', rotulo: 'Escuro', icone: IconMoon },
              { valor: 'sistema', rotulo: 'Sistema', icone: IconDeviceDesktop },
            ]}
          />
        </LinhaDeAjuste>
        <LinhaDeAjuste
          id={idTexto}
          titulo="Tamanho do texto"
          descricao="Só o texto cresce: a sidebar, as colunas e os botões ficam no lugar. Fica salvo na sua conta."
        >
          <SeletorTamanhoTexto rotuladoPor={idTexto} />
        </LinhaDeAjuste>
        <LinhaDeAjuste
          id={idDensidade}
          titulo="Densidade das listas"
          descricao="Compacta mostra mais tickets por tela; confortável dá mais respiro a cada linha."
        >
          <Segmentado<Densidade>
            rotuladoPor={idDensidade}
            valor={densidade}
            onMudar={setDensidade}
            opcoes={[
              { valor: 'compacta', rotulo: 'Compacta', icone: IconBaselineDensitySmall },
              { valor: 'confortavel', rotulo: 'Confortável', icone: IconBaselineDensityLarge },
            ]}
          />
        </LinhaDeAjuste>
      </div>
    </Secao>
  )
}
