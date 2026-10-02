/**
 * cvzdesk · barrel — "Importe sempre de src/components (barrel), nunca do
 * caminho profundo" (DESIGN.md §4). Só os componentes já portados nesta base
 * (ver frontend/README.md) — o restante do catálogo (Menu, SegmentedControl,
 * RelativeTime, Calendar, TimeRangePicker, ChatWidget, ReplyEditor, Timeline)
 * ainda não foi trazido.
 *
 * ChatWidget é um caso à parte: só o helper `fileSize` veio (o FileUpload
 * depende dele); o componente em si continua fora. Por isso ele não é
 * reexportado aqui — não há componente para importar ainda.
 *
 * AppShell, Sidebar, Topbar e CommandPalette saíram na Fase 2 da unificação
 * de shell: eram a casca de navegação do cvzdesk (usada só por
 * `cvz/AppLayout.tsx`, também removido), hoje inteiramente substituída pelo
 * shell Resolv (resolv/shell/*). O resto do catálogo — os componentes de
 * CONTEÚDO (Button, DataTable, Tabs, PageHeader…) — continua em uso normal,
 * inclusive dentro do shell novo.
 */
export * from './Avatar/Avatar'
export * from './Button/Button'
export * from './Checkbox/Checkbox'
export * from './Combobox/Combobox'
export * from './ConfirmDialog/ConfirmDialog'
export * from './DataTable/DataTable'
export * from './Field/Field'
export * from './FileUpload/FileUpload'
export * from './FilterBar/FilterBar'
export * from './Form/Form'
export * from './Modal/Modal'
export * from './Notification/Notification'
export * from './PageHeader/PageHeader'
export * from './Pagination/Pagination'
export * from './Popover/Popover'
export * from './Progress/Progress'
export * from './Segmented/Segmented'
export * from './State/State'
export * from './StatCard/StatCard'
export * from './Tabs/Tabs'
export * from './Tag/Tag'
export * from './Toast/Toast'
export * from './Tooltip/Tooltip'
export * from './icons'
