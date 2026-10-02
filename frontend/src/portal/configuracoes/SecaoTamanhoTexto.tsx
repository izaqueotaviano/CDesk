import { useId } from 'react'
import { IconTextSize } from '@tabler/icons-react'
import { LinhaDeAjuste, SeletorTamanhoTexto } from './Ajustes'
import { Secao } from './Secao'

/**
 * Tamanho do texto do portal. Seção própria (e não dentro de Aparência)
 * porque o tema vale para este navegador e o tamanho vale para a CONTA:
 * juntos, a descrição de uma das duas mentiria. Aplica na hora; quem leva
 * para a conta é `stores/sincronizarPrefs`.
 */
export function SecaoTamanhoTexto() {
  const idTitulo = useId()
  return (
    <Secao
      id="texto"
      icone={IconTextSize}
      titulo="Tamanho do texto"
      descricao="Para ler com mais conforto. Vale no portal inteiro e fica salvo na sua conta."
    >
      <LinhaDeAjuste
        id={idTitulo}
        titulo="Tamanho"
        descricao="Só o texto cresce: menus e botões continuam no mesmo lugar."
      >
        <SeletorTamanhoTexto rotuladoPor={idTitulo} />
      </LinhaDeAjuste>
    </Secao>
  )
}
