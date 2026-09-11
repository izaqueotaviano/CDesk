/**
 * Ícone do console — Material Symbols (Outlined, peso 400: o padrão do M3).
 *
 * O nome continua sendo o CONTRATO, e não o componente: a aba aberta guarda
 * o nome do ícone no localStorage (stores/tabs.ts), a paleta de comandos
 * monta as linhas com o nome, e a lista de navegação (`NAV`) é a mesma em
 * três telas. Por isso os nomes antigos (`ti ti-…`) continuam valendo —
 * trocá-los por componentes apagaria o que já está gravado no navegador de
 * quem usa. Telas novas podem usar direto o nome do Material Symbol
 * (`home`, `chat`, `trending_up`…). Os dois apontam para o mesmo desenho;
 * ver shell/simbolos.ts.
 *
 * Tamanho: o M3 desenha ícone em 20 ou 24. Aqui 20 é o padrão (casa com o
 * controle de 40px), 18 vai dentro de botão pequeno e chip, 24 fica para
 * destaque e 16 só na barra de abas, que é a faixa mais densa da casa. A
 * grade do Material Symbols é 24 — o `path` é reescalado pelo viewBox, nunca
 * esticado.
 */
import { SIMBOLOS, VIEW_BOX } from './simbolos'

interface Props {
  /** Nome do ícone: `ti ti-…` (legado) ou o nome do Material Symbol. */
  nome: string
  /** 16 na barra de abas (a mais densa da casa); 18 em controle pequeno e
   *  chip; 20 (padrão, o par do controle de 40px); 24 em destaque. */
  tamanho?: 16 | 18 | 20 | 24
  className?: string
  /** Só quando o ícone carrega significado sozinho. Botão que já tem
   *  `aria-label` deixa o ícone decorativo, que é o padrão. */
  rotulo?: string
}

export function Icone({ nome, tamanho = 20, className, rotulo }: Props) {
  const desenho = SIMBOLOS[nome]
  const a11y = rotulo
    ? { role: 'img' as const, 'aria-label': rotulo }
    : { 'aria-hidden': true as const }

  if (!desenho) {
    // Nome ainda não mapeado: cai no conjunto antigo, que continua carregado.
    // Nada some da tela no meio da migração.
    return <i className={`${nome} ${className ?? ''}`} {...a11y} />
  }
  return (
    <svg
      className={className}
      viewBox={VIEW_BOX}
      width={tamanho}
      height={tamanho}
      fill="currentColor"
      style={{ flexShrink: 0 }}
      {...a11y}
    >
      <path d={desenho} />
    </svg>
  )
}
