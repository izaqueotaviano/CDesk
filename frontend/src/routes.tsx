import { Navigate, createBrowserRouter, useParams } from 'react-router-dom'
import { App } from '@/App'
import { PaginaEsqueciSenha } from '@/features/auth/PaginaEsqueciSenha'
import { PaginaLogin } from '@/features/auth/PaginaLogin'
import { PaginaRedefinirSenha } from '@/features/auth/PaginaRedefinirSenha'
import { PaginaSessaoExpirada } from '@/features/auth/PaginaSessaoExpirada'
import { RotaProtegida } from '@/features/auth/RotaProtegida'
import { PaginaInicio } from '@/features/tickets/PaginaInicio'
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
import { PaginaNotas } from '@/resolv/notas/PaginaNotas'
import { SuperficieCvz } from '@/cvz/SuperficieCvz'
import { PaginaListaEmpresas } from '@/cvz/clientes/PaginaListaEmpresas'
import { PaginaDetalheEmpresa } from '@/cvz/clientes/PaginaDetalheEmpresa'
import { PaginaAvisos } from '@/cvz/avisos/PaginaAvisos'
import { PaginaAuditoria } from '@/cvz/auditoria/PaginaAuditoria'
import { PaginaConfiguracoes } from '@/cvz/configuracoes/PaginaConfiguracoes'
import { PaginaRelatorios as PaginaRelatoriosResolv } from '@/cvz/relatorios/PaginaRelatorios'
import { PaginaNovoTicket } from '@/resolv/tickets/novo/PaginaNovoTicket'
import { RedirecionarDeChamados } from '@/resolv/tickets/RedirecionarDeChamados'

/**
 * /app/tickets/:id não tem equivalente estático em /tickets/:id — precisa
 * ler o :id da URL antiga antes de redirecionar, então não dá pra ser um
 * <Navigate> direto como as rotas irmãs (chat, relatórios, tickets, kanban).
 */
function RedirecionarParaChamado() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/tickets/${id}`} replace />
}

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
      // "Esqueci minha senha" e a senha nova pelo link do e-mail, sob o login
      // de cada público (o link que o backend manda já aponta para o certo)
      { path: '/login/esqueci-senha', element: <PaginaEsqueciSenha /> },
      { path: '/login/cliente/esqueci-senha', element: <PaginaEsqueciSenha /> },
      { path: '/login/redefinir-senha/:uid/:token', element: <PaginaRedefinirSenha modo="recuperacao" /> },
      { path: '/login/cliente/redefinir-senha/:uid/:token', element: <PaginaRedefinirSenha modo="recuperacao" /> },
      // O link do CONVITE (apps/accounts/admin_api.py::send_invite). Público,
      // fora do `/portal` protegido: quem abre ainda não tem senha.
      { path: '/portal/definir-senha/:uid/:token', element: <PaginaRedefinirSenha modo="convite" /> },
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
        path: '/tickets',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaListaTicketsResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },
      // Antes de `/tickets/:id` por clareza — o React Router já classifica o
      // segmento estático acima do dinâmico, então "novo" nunca cai no detalhe.
      {
        path: '/tickets/novo',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaNovoTicket />
            </NovoShell>
          </RotaProtegida>
        ),
      },
      {
        path: '/tickets/:id',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaDetalheTicketResolv />
            </NovoShell>
          </RotaProtegida>
        ),
      },
      // Endereços antigos do console (antes de "chamado" virar "ticket" no
      // produto): e-mails e notificações já gravadas ainda apontam para cá.
      // Só redirecionam, mantendo query e hash — ver RedirecionarDeChamados.
      { path: '/chamados', element: <RedirecionarDeChamados /> },
      { path: '/chamados/novo', element: <RedirecionarDeChamados /> },
      { path: '/chamados/:id', element: <RedirecionarDeChamados /> },

      // ---- Quadro (Kanban) — vista computada sobre os mesmos tickets de
      // /tickets, nunca uma lista própria (ver apps/kanban/services/board_view.py) ----
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

      // ---- Clientes/Empresas — conteúdo é 100% cvz (cvz/components), mas o
      // shell (sidebar/topbar) é o NovoShell desde a Fase 1 da unificação de
      // shell: SuperficieCvz é só o "surface" (fundo/respiro/rolagem) que o
      // AppShell antigo dava de graça, ver o comentário lá ----
      {
        path: '/clientes',
        element: (
          <RotaProtegida>
            <NovoShell>
              <SuperficieCvz>
                <PaginaListaEmpresas />
              </SuperficieCvz>
            </NovoShell>
          </RotaProtegida>
        ),
      },
      {
        path: '/clientes/:id',
        element: (
          <RotaProtegida>
            <NovoShell>
              <SuperficieCvz>
                <PaginaDetalheEmpresa />
              </SuperficieCvz>
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Avisos — mural, backend já pronto (apps/announcements), primeira
      // tela consumindo. Escrita gateada por Perm.ANNOUNCEMENT_MANAGE no
      // próprio backend; a tela só esconde o botão pra quem não tem ----
      {
        path: '/avisos',
        element: (
          <RotaProtegida>
            <NovoShell>
              <SuperficieCvz>
                <PaginaAvisos />
              </SuperficieCvz>
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Notas pessoais (apps/notes) — rascunho de quem atende, privado
      // por dono. O mesmo `api/notas.ts` alimenta o painel de notas do
      // detalhe do chamado ----
      {
        path: '/notas',
        element: (
          <RotaProtegida>
            <NovoShell>
              <PaginaNotas />
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Auditoria e LGPD — backend já pronto (apps/audit), primeira tela
      // consumindo. IsAdmin no backend; a tela mostra um aviso amigável em
      // vez de 403 cru para quem não é admin ----
      {
        path: '/auditoria',
        element: (
          <RotaProtegida>
            <NovoShell>
              <SuperficieCvz>
                <PaginaAuditoria />
              </SuperficieCvz>
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Relatórios — backend já pronto (apps/reports), a tela na base
      // antiga (/app/relatorios) era só um placeholder (PaginaPendente); esta
      // é a primeira de verdade. Área interna no backend (IsInternal) ----
      {
        path: '/relatorios',
        element: (
          <RotaProtegida>
            <NovoShell>
              <SuperficieCvz>
                <PaginaRelatoriosResolv />
              </SuperficieCvz>
            </NovoShell>
          </RotaProtegida>
        ),
      },

      // ---- Configurações — cadastros que alimentam a abertura e a triagem
      // de chamados; as abas em si (Status, Serviços, SLA, Equipes...) vivem
      // dentro de PaginaConfiguracoes, não aqui ----
      {
        path: '/configuracoes',
        element: (
          <RotaProtegida>
            <NovoShell>
              <SuperficieCvz>
                <PaginaConfiguracoes />
              </SuperficieCvz>
            </NovoShell>
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
          // a lista de tickets virou tela própria (/tickets, NovoShell); o caminho antigo só redireciona
          { path: 'tickets', element: <Navigate to="/tickets" replace /> },
          { path: 'tickets/:id', element: <RedirecionarParaChamado /> },
          // o console de chat virou tela própria (/chat, NovoShell); o caminho antigo só redireciona
          { path: 'chat', element: <Navigate to="/chat" replace /> },
          // o quadro virou tela própria (/quadro, NovoShell); o caminho antigo só redireciona
          { path: 'kanban', element: <Navigate to="/quadro" replace /> },
          // a tela virou de verdade em /relatorios (CvzAppLayout) — o
          // placeholder (PaginaPendente) que vivia aqui foi retirado
          { path: 'relatorios', element: <Navigate to="/relatorios" replace /> },
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
