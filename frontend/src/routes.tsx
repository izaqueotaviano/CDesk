import { Navigate, createBrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import { PaginaLogin } from '@/features/auth/PaginaLogin'
import { PaginaSessaoExpirada } from '@/features/auth/PaginaSessaoExpirada'
import { RotaProtegida } from '@/features/auth/RotaProtegida'
import { PaginaKanban } from '@/features/kanban/PaginaKanban'
import { PaginaRelatorios } from '@/features/reports/PaginaRelatorios'
import { PaginaDetalheTicket } from '@/features/tickets/PaginaDetalheTicket'
import { PaginaInicio } from '@/features/tickets/PaginaInicio'
import { PaginaListaTickets } from '@/features/tickets/PaginaListaTickets'
import { AppShell } from '@/layouts/AppShell'
import { PortalShell } from '@/portal/shell/PortalShell'
import { PaginaInicio as PaginaInicioCliente } from '@/portal/inicio/PaginaInicio'
import { PaginaNovoTicket as PaginaNovoTicketCliente } from '@/portal/tickets/PaginaNovoTicket'
import { PaginaTicket as PaginaTicketCliente } from '@/portal/tickets/PaginaTicket'
import { PaginaTickets as PaginaTicketsCliente } from '@/portal/tickets/PaginaTickets'
import { PaginaChat as PaginaChatCliente } from '@/portal/chat/PaginaChat'
import { PaginaAjuda } from '@/portal/ajuda/PaginaAjuda'
import { PaginaArtigo } from '@/portal/ajuda/PaginaArtigo'
import { PaginaHistorico } from '@/portal/historico/PaginaHistorico'
import { PaginaConta } from '@/resolv/conta/PaginaConta'
import { PaginaConfiguracoes as PaginaConfiguracoesCliente } from '@/portal/configuracoes/PaginaConfiguracoes'
import { NovoShell } from '@/resolv/shell/NovoShell'
import { PaginaInicio as PaginaInicioResolv } from '@/resolv/inicio/PaginaInicio'
import { PaginaListaTickets as PaginaListaTicketsResolv } from '@/resolv/tickets/PaginaListaTickets'
import { PaginaDetalheTicket as PaginaDetalheTicketResolv } from '@/resolv/tickets/detalhe/PaginaDetalheTicket'
import { PaginaKanban as PaginaQuadroResolv } from '@/resolv/kanban/PaginaKanban'
import { PaginaChat as PaginaChatResolv } from '@/resolv/chat/PaginaChat'
import { CvzAppLayout } from '@/cvz/AppLayout'
import { PaginaListaEmpresas } from '@/cvz/clientes/PaginaListaEmpresas'
import { PaginaDetalheEmpresa } from '@/cvz/clientes/PaginaDetalheEmpresa'
import { PaginaConfiguracoes } from '@/cvz/configuracoes/PaginaConfiguracoes'
import { PaginaNovoTicket } from '@/resolv/tickets/novo/PaginaNovoTicket'

/**
 * Duas árvores separadas — /app (interno) e /portal (cliente) — com bundles
 * de rota distintos (F2 em docs/07-arquitetura-frontend.md). Nesta base as
 * duas ainda carregam eager (sem `lazy:`); o code-splitting por rota é uma
 * melhoria de performance a acrescentar depois, não algo que muda o contrato.
 */
export const router = createBrowserRouter([
  {
    element: <App />, // raiz de tudo — só o manifesto PWA por rota (docs/10-pwa.md)
    children: [
      // A experiência primária agora é o Resolv (design system novo): raiz cai
      // no /inicio. As rotas /app (base Tailwind antiga) seguem existindo.
      { path: '/', element: <Navigate to="/inicio" replace /> },

      {
        path: '/inicio',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaInicioResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },

      { path: '/login', element: <PaginaLogin /> },
      { path: '/login/cliente', element: <PaginaLogin /> },
      { path: '/sessao-expirada', element: <PaginaSessaoExpirada /> },

      // ---- Minha conta (equipe): verificação em duas etapas ----
      {
        path: '/conta',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaConta />
            </NovoShell>
          </RotaProtegida>
        ),
      },
      // ---- Tela de tickets no NOVO design system Resolv (a que estamos testando) ----
      {
        path: '/chamados',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaListaTicketsResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },
      // Antes de `/chamados/:id` por clareza — o React Router já classifica o
      // segmento estático acima do dinâmico, então "novo" nunca cai no detalhe.
      {
        path: '/chamados/novo',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaNovoTicket />
            </NovoShell>
          </RotaProtegida>
        ),
      },
      {
        path: '/chamados/:id',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaDetalheTicketResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Quadro (Kanban) — vista computada sobre os mesmos tickets de
      // /chamados, nunca uma lista própria (ver apps/kanban/services/board_view.py) ----
      {
        path: '/quadro',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaQuadroResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Chat — console do agente: fila única, conversa, transferir/converter/encerrar ----
      {
        path: '/chat',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaChatResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Clientes/Empresas — primeira tela na base real do design system cvzdesk ----
      {
        path: '/clientes',
        element: (
          <RotaProtegida>
            <CvzAppLayout>
              <PaginaListaEmpresas />
            </CvzAppLayout>
          </RotaProtegida>
        ),
      },
      {
        path: '/clientes/:id',
        element: (
          <RotaProtegida>
            <CvzAppLayout>
              <PaginaDetalheEmpresa />
            </CvzAppLayout>
          </RotaProtegida>
        ),
      },

      // ---- Configurações — Fase 1 do plano: Status, Serviços, Categorias,
      // Tags por enquanto (SLA/Equipes/Planos/Calendário/Papéis/Sistema vêm
      // nas próximas abas desta mesma fase) ----
      {
        path: '/configuracoes',
        element: (
          <RotaProtegida>
            <CvzAppLayout>
              <PaginaConfiguracoes />
            </CvzAppLayout>
          </RotaProtegida>
        ),
      },

      {
        path: '/app',
        element: (
          <RotaProtegida>
            <AppShell />
          </RotaProtegida>
        ),
        children: [
          { index: true, element: <PaginaInicio /> },
          { path: 'tickets', element: <PaginaListaTickets /> },
          { path: 'tickets/:id', element: <PaginaDetalheTicket /> },
          // o console de chat virou tela própria (/chat, NovoShell); o caminho antigo só redireciona
          { path: 'chat', element: <Navigate to="/chat" replace /> },
          { path: 'kanban', element: <PaginaKanban /> },
          { path: 'relatorios', element: <PaginaRelatorios /> },
        ],
      },

      {
        path: '/portal',
        element: (
          <RotaProtegida paraLogin="/login/cliente">
            <PortalShell />
          </RotaProtegida>
        ),
        // Painel do Cliente (src/portal): Início, Tickets, Chat, Central de
        // Ajuda, Histórico e Configurações.
        children: [
          { index: true, element: <PaginaInicioCliente /> },
          { path: 'tickets', element: <PaginaTicketsCliente /> },
          { path: 'tickets/novo', element: <PaginaNovoTicketCliente /> },
          { path: 'tickets/:id', element: <PaginaTicketCliente /> },
          { path: 'chat', element: <PaginaChatCliente /> },
          { path: 'ajuda', element: <PaginaAjuda /> },
          { path: 'ajuda/:id', element: <PaginaArtigo /> },
          { path: 'historico', element: <PaginaHistorico /> },
          { path: 'configuracoes', element: <PaginaConfiguracoesCliente /> },
        ],
      },
    ],
  },
])
