/**
 * cvzdesk · ícones
 *
 * RECONSTRUÍDO — o MCP cvzdesk lista os nomes (`IconHome`, `IconClients`...) e
 * onde cada um é usado, mas `get_component` só serve pastas de componente
 * (`Componente.tsx` + `.scss`); `src/components/icons/*.tsx` não segue esse
 * formato e fica fora do que o MCP devolve. Os nomes e assinaturas abaixo são
 * os reais (confirmados via `search_design_system`); os traçados são
 * desenhados aqui, seguindo a regra do DESIGN.md: SVG stroke-only,
 * `currentColor`, 24×24, sem preenchimento.
 */
import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement>

const base = (children: React.ReactNode, props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
)

// ---------------------------------------------------------------- navegação
export const IconHome = (p: IconProps) =>
  base(
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9" />
    </>,
    p,
  )

export const IconTicket = (p: IconProps) =>
  base(
    <>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
      <path d="M14 6v12" strokeDasharray="2 2" />
    </>,
    p,
  )

export const IconChats = (p: IconProps) =>
  base(<path d="M21 11.5a7.5 7.5 0 0 1-11.3 6.48L4 19l1.02-4.24A7.5 7.5 0 1 1 21 11.5Z" />, p)

export const IconClients = (p: IconProps) =>
  base(
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M15.5 14.2c2.5.4 4.5 2.1 4.5 4.8" />
    </>,
    p,
  )

export const IconSettings = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.5 1.51 1.51 1.51H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>,
    p,
  )

export const IconReports = (p: IconProps) =>
  base(
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M4 20h16" />
    </>,
    p,
  )

export const IconCalendar = (p: IconProps) =>
  base(
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
    p,
  )

export const IconNotes = (p: IconProps) =>
  base(
    <>
      <path d="M6 3.5h9l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
      <path d="M8 10.5h8M8 14h8M8 17h5" />
    </>,
    p,
  )

// ---------------------------------------------------------------- ações/UI
export const IconSearch = (p: IconProps) =>
  base(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.6-4.6" />
    </>,
    p,
  )

export const IconBell = (p: IconProps) =>
  base(
    <>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>,
    p,
  )

export const IconMenu = (p: IconProps) => base(<path d="M4 6h16M4 12h16M4 18h16" />, p)

export const IconMegaphone = (p: IconProps) =>
  base(
    <>
      <path d="M3 11v2a2 2 0 0 0 2 2h1l1 5h2l-1-5h2l8 4V7l-8 4H6a2 2 0 0 0-2 2Z" />
      <path d="M18 8a4 4 0 0 1 0 8" />
    </>,
    p,
  )

export const IconSun = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>,
    p,
  )

export const IconMoon = (p: IconProps) => base(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />, p)

export const IconArrowRight = (p: IconProps) => base(<path d="M4 12h15M13 6l6 6-6 6" />, p)
export const IconArrowLeft = (p: IconProps) => base(<path d="M20 12H5M11 6l-6 6 6 6" />, p)

export const IconFilters = (p: IconProps) =>
  base(
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>,
    p,
  )

export const IconChevronDown = (p: IconProps) => base(<path d="m6 9 6 6 6-6" />, p)
export const IconChevronLeft = (p: IconProps) => base(<path d="m15 18-6-6 6-6" />, p)
export const IconChevronRight = (p: IconProps) => base(<path d="m9 6 6 6-6 6" />, p)

export const IconCheck = (p: IconProps) => base(<path d="m4 12 5 5L20 6" />, p)

export const IconPlus = (p: IconProps) => base(<path d="M12 4v16M4 12h16" />, p)

export const IconMore = (p: IconProps) =>
  base(
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>,
    p,
  )

export const IconClose = (p: IconProps) => base(<path d="M6 6l12 12M18 6 6 18" />, p)

// ---------------------------------------------------------------- ordenação
export const IconSortAsc = (p: IconProps) => base(<path d="M7 15V4M4 7l3-3 3 3M13 6h7M13 12h5M13 18h3" />, p)
export const IconSortDesc = (p: IconProps) => base(<path d="M7 4v11M4 12l3 3 3-3M13 6h7M13 12h5M13 18h3" />, p)
export const IconSortNone = (p: IconProps) => base(<path d="M7 4v16M4 7l3-3 3 3M4 17l3 3 3-3M13 8h7M13 16h7" />, p)

// ---------------------------------------------------------------- feedback
export const IconInfo = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.1" />
    </>,
    p,
  )

export const IconCircleCheck = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.2 2.6 2.6 5-5.2" />
    </>,
    p,
  )

export const IconTriangleAlert = (p: IconProps) =>
  base(
    <>
      <path d="M12 3.5 21.5 20h-19Z" />
      <path d="M12 9.5v4.5M12 17v.1" />
    </>,
    p,
  )

export const IconCircleX = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>,
    p,
  )

// ---------------------------------------------------------------- domínio
export const IconUser = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="8" r="3.3" />
      <path d="M5 20c0-3.3 3-6 7-6s7 2.7 7 6" />
    </>,
    p,
  )

export const IconUserPlus = (p: IconProps) =>
  base(
    <>
      <circle cx="9.5" cy="8" r="3.3" />
      <path d="M3.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M18.5 8v6M15.5 11h6" />
    </>,
    p,
  )

export const IconTag = (p: IconProps) =>
  base(
    <>
      <path d="M11.5 4H6a2 2 0 0 0-2 2v5.5a2 2 0 0 0 .6 1.4l8 8a2 2 0 0 0 2.8 0l5.1-5.1a2 2 0 0 0 0-2.8l-8-8A2 2 0 0 0 11.5 4Z" />
      <circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
    </>,
    p,
  )

export const IconPaperclip = (p: IconProps) =>
  base(
    <path d="M20 11.5 12.4 19a4 4 0 1 1-5.6-5.6L15 5.2a2.7 2.7 0 1 1 3.8 3.8L10.6 17a1.3 1.3 0 1 1-1.9-1.9l7-7" />,
    p,
  )

export const IconClock = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
    p,
  )

export const IconAt = (p: IconProps) =>
  base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2" />
    </>,
    p,
  )

export const IconLock = (p: IconProps) =>
  base(
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>,
    p,
  )

export const IconBold = (p: IconProps) =>
  base(<path d="M7 4h6a3.5 3.5 0 0 1 0 7H7Zm0 7h7a3.5 3.5 0 0 1 0 7H7Z" />, p)

export const IconItalic = (p: IconProps) => base(<path d="M11 4h6M7 20h6M14 4l-4 16" />, p)

export const IconList = (p: IconProps) =>
  base(<path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01" />, p)

export const IconLink = (p: IconProps) =>
  base(
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 6.5 13 4.5a3.5 3.5 0 0 1 5 5L16 11.5" />
      <path d="M13 17.5 11 19.5a3.5 3.5 0 0 1-5-5L8 12.5" />
    </>,
    p,
  )

export const IconZap = (p: IconProps) => base(<path d="M13 3 5 13.5h5.5L11 21l8-10.5h-5.5Z" />, p)

export const IconEyeOff = (p: IconProps) =>
  base(
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.4 10.4 0 0 1 12 5c5 0 9 4 10 7-.4 1.2-1.3 2.6-2.6 3.9M6.6 6.6C4.5 8 3.2 9.8 2 12c1 3 5 7 10 7 1.2 0 2.3-.2 3.4-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>,
    p,
  )

export const IconUpload = (p: IconProps) =>
  base(
    <>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>,
    p,
  )

export const IconFile = (p: IconProps) =>
  base(<path d="M6 3.5h7l5 5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Zm7 0V8h4.5" />, p)

export const IconTrash = (p: IconProps) =>
  base(
    <>
      <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7" />
      <path d="M10 11v6M14 11v6" />
    </>,
    p,
  )
