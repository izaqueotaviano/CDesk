/**
 * Ícone do console — um registro só, de nome para Fluent UI System Icon.
 *
 * Por que registro e não `import { Home20Regular }` em cada tela: metade dos
 * ícones desta base chega como STRING e não como componente — a aba aberta
 * guarda o nome do ícone no `localStorage` (`stores/tabs.ts`), a paleta de
 * comandos monta as linhas com o nome, e a lista de navegação (`NAV`) é a
 * mesma em três telas. Trocar isso por componentes quebraria o que já está
 * gravado no navegador de quem usa. Aqui o nome continua sendo o contrato, e
 * quem desenha é o Fluent.
 *
 * Os nomes são os do conjunto anterior (`ti ti-…`, Tabler) de propósito:
 * nenhum call site precisa ser reescrito para mudar de biblioteca, e a
 * migração pode ir tela a tela. Nome ainda não mapeado cai no ícone antigo
 * (`<i class="ti …">`), que continua carregado — nada some no meio do
 * caminho.
 *
 * Tamanho: 20px é o par do Fluent para controle de 32px, que é a altura
 * padrão desta interface. `tamanho="16"` para dentro de botão pequeno e selo.
 */
import type { FluentIcon } from '@fluentui/react-icons'
import {
  Alert20Regular,
  ArrowDownload20Regular,
  ArrowLeft20Regular,
  ArrowReply20Regular,
  ArrowSort20Regular,
  ArrowSync20Regular,
  Attach20Regular,
  Bot20Regular,
  Building20Regular,
  CalendarLtr20Regular,
  ChartMultiple20Regular,
  Chat20Regular,
  Checkmark20Regular,
  CheckmarkCircle20Regular,
  ChevronDown20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Delete20Regular,
  Dismiss20Regular,
  DismissCircle20Regular,
  Edit20Regular,
  ErrorCircle20Regular,
  Filter20Regular,
  Flash20Regular,
  Grid20Regular,
  Headset20Regular,
  Home20Regular,
  Info20Regular,
  LockClosed20Regular,
  Mail20Regular,
  Megaphone20Regular,
  MoreHorizontal20Regular,
  Navigation20Regular,
  Note20Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  Person20Regular,
  PersonAvailable20Regular,
  PersonSettings20Regular,
  Pin20Regular,
  Search20Regular,
  Send20Regular,
  Settings20Regular,
  ShieldCheckmark20Regular,
  ShieldProhibited20Regular,
  Star20Regular,
  Tag20Regular,
  TicketDiagonal20Regular,
  Warning20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  Wrench20Regular,
  ArrowExpand20Regular,
  ArrowMaximize20Regular,
  Add20Regular,
  People20Regular,
  PeopleTeam20Regular,
  Clock20Regular,
} from '@fluentui/react-icons'

/** nome antigo → Fluent UI System Icon. */
export const ICONES: Record<string, FluentIcon> = {
  'ti ti-home': Home20Regular,
  'ti ti-ticket': TicketDiagonal20Regular,
  'ti ti-message-circle-2': Chat20Regular,
  'ti ti-layout-grid': Grid20Regular,
  'ti ti-users': People20Regular,
  'ti ti-users-group': PeopleTeam20Regular,
  'ti ti-speakerphone': Megaphone20Regular,
  'ti ti-chart-bar': ChartMultiple20Regular,
  'ti ti-shield-check': ShieldCheckmark20Regular,
  'ti ti-shield-x': ShieldProhibited20Regular,
  'ti ti-settings': Settings20Regular,
  'ti ti-calendar': CalendarLtr20Regular,
  'ti ti-calendar-event': CalendarLtr20Regular,
  'ti ti-note': Note20Regular,
  'ti ti-notes': Note20Regular,
  'ti ti-search': Search20Regular,
  'ti ti-x': Dismiss20Regular,
  'ti ti-plus': Add20Regular,
  'ti ti-trash': Delete20Regular,
  'ti ti-pencil': Edit20Regular,
  'ti ti-pin': Pin20Regular,
  'ti ti-tag': Tag20Regular,
  'ti ti-mail': Mail20Regular,
  'ti ti-paperclip': Attach20Regular,
  'ti ti-send': Send20Regular,
  'ti ti-bell': Alert20Regular,
  'ti ti-lock': LockClosed20Regular,
  'ti ti-bolt': Flash20Regular,
  'ti ti-robot': Bot20Regular,
  'ti ti-headset': Headset20Regular,
  'ti ti-building': Building20Regular,
  'ti ti-user': Person20Regular,
  'ti ti-user-check': PersonAvailable20Regular,
  'ti ti-user-cog': PersonSettings20Regular,
  'ti ti-tool': Wrench20Regular,
  'ti ti-star': Star20Regular,
  'ti ti-sun': WeatherSunny20Regular,
  'ti ti-moon': WeatherMoon20Regular,
  'ti ti-download': ArrowDownload20Regular,
  'ti ti-filter': Filter20Regular,
  'ti ti-sort-descending': ArrowSort20Regular,
  'ti ti-arrow-left': ArrowLeft20Regular,
  'ti ti-arrow-back-up': ArrowReply20Regular,
  'ti ti-chevron-right': ChevronRight20Regular,
  'ti ti-chevron-left': ChevronLeft20Regular,
  'ti ti-chevron-down': ChevronDown20Regular,
  'ti ti-dots': MoreHorizontal20Regular,
  'ti ti-menu-2': Navigation20Regular,
  'ti ti-alert-triangle': Warning20Regular,
  'ti ti-alert-circle': ErrorCircle20Regular,
  'ti ti-info-circle': Info20Regular,
  'ti ti-circle-check': CheckmarkCircle20Regular,
  'ti ti-circle-x': DismissCircle20Regular,
  'ti ti-check': Checkmark20Regular,
  'ti ti-rotate-clockwise': ArrowSync20Regular,
  'ti ti-loader-2': ArrowSync20Regular,
  'ti ti-arrows-diagonal': ArrowExpand20Regular,
  'ti ti-arrows-left-right': ArrowMaximize20Regular,
  'ti ti-layout-sidebar-left-collapse': PanelLeftContract20Regular,
  'ti ti-layout-sidebar-left-expand': PanelLeftExpand20Regular,
  'ti ti-clock': Clock20Regular,
}

interface Props {
  /** O nome do ícone (o mesmo de sempre, `ti ti-…`). */
  nome: string
  /** 16 dentro de controle pequeno/selo; 20 (padrão) no resto; 24 em destaque. */
  tamanho?: 16 | 20 | 24
  className?: string
  /** Quando o ícone carrega significado sozinho (botão só de ícone já tem
   *  `aria-label`, e aí ele fica decorativo — que é o padrão). */
  rotulo?: string
}

export function Icone({ nome, tamanho = 20, className, rotulo }: Props) {
  const Componente = ICONES[nome]
  const a11y = rotulo ? { role: 'img' as const, 'aria-label': rotulo } : { 'aria-hidden': true }

  if (!Componente) {
    // Ainda não mapeado: o conjunto antigo continua carregado e desenha.
    return <i className={`${nome} ${className ?? ''}`} {...a11y} />
  }
  return (
    <Componente
      className={className}
      style={{ width: tamanho, height: tamanho, flexShrink: 0 }}
      {...a11y}
    />
  )
}
