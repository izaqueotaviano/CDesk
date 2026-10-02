// Os destinos de navegação do console: uma fonte só de nome, ícone e rota para
// a sidebar, o menu "Mais", a busca (Ctrl K) e as abas do topo
// (`abasDaRota.ts`). A ORDEM aqui é a ordem em todos eles. Mora fora da
// `Sidebar.tsx` para quem só precisa da lista (as regras de rota das abas, a
// busca) não importar o componente inteiro.

export type Item = {
  id: string
  label: string
  /** Classe Tabler (`ti ti-*`), a mesma na sidebar, no "Mais" e na busca. */
  icon: string
  route: string
  enabled: boolean
  /** Mora no menu "Mais", não na coluna. Só a Sidebar lê: a busca (Ctrl K)
   *  consome a mesma lista e mostra todos os destinos. */
  mais?: boolean
}

export const NAV: Item[] = [
  { id: 'inicio', label: 'Início', icon: 'ti ti-home', route: '/inicio', enabled: true },
  { id: 'tickets', label: 'Tickets', icon: 'ti ti-ticket', route: '/tickets', enabled: true },
  { id: 'chat', label: 'Chats', icon: 'ti ti-message-circle-2', route: '/chat', enabled: true },
  { id: 'kanban', label: 'Quadro', icon: 'ti ti-layout-grid', route: '/quadro', enabled: true },
  { id: 'clientes', label: 'Clientes', icon: 'ti ti-users', route: '/clientes', enabled: true },
  { id: 'avisos', label: 'Avisos', icon: 'ti ti-speakerphone', route: '/avisos', enabled: true, mais: true },
  { id: 'notas', label: 'Notas', icon: 'ti ti-note', route: '/notas', enabled: true, mais: true },
  { id: 'relatorios', label: 'Relatórios', icon: 'ti ti-chart-bar', route: '/relatorios', enabled: true, mais: true },
  { id: 'auditoria', label: 'Auditoria e LGPD', icon: 'ti ti-shield-check', route: '/auditoria', enabled: true, mais: true },
  { id: 'config', label: 'Configurações', icon: 'ti ti-settings', route: '/configuracoes', enabled: true, mais: true },
  { id: 'calendario', label: 'Calendário', icon: 'ti ti-calendar', route: '/calendario', enabled: false, mais: true },
]
