"""Rotas da API v1 (D14: backend API-first).

Organização: recursos operacionais na raiz, configuração sob `settings/`
(telas de admin) e trilhas sob `audit/`.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.admin_api import (
    CustomRoleViewSet,
    RoleChoicesView,
    TeamAdminViewSet,
    UserAdminViewSet,
)
from apps.accounts.recuperacao import RecuperarSenhaView, RedefinirSenhaView
from apps.accounts.views import (
    AssinaturaFileView,
    AssinaturaImagemView,
    AvatarFileView,
    AvatarUploadView,
    DefinirSenhaView,
    LoginView,
    LogoutView,
    MeView,
    MyAccessHistoryView,
    MyPasswordView,
    MyPresenceView,
    MySessionRevokeView,
    MySessionsView,
    TwoFactorConfirmView,
    TwoFactorDisableView,
    TwoFactorRequestCodeView,
    TwoFactorResendView,
    TwoFactorSetupView,
    TwoFactorStatusView,
    TwoFactorVerifyView,
    UserViewSet,
)
from apps.announcements.views import AnnouncementViewSet
from apps.audit.views import (
    AuditLogViewSet,
    DataSubjectExportDownloadView,
    DataSubjectRequestViewSet,
    MyDataRequestView,
    RetentionRunViewSet,
    TicketAccessLogViewSet,
)
from apps.chat.views import (
    BannedWordViewSet,
    ChatCloseReasonViewSet,
    ChatConfigView,
    ChatFileDownloadView,
    ChatMacroViewSet,
    ChatReportView,
    ChatTimelineExportView,
    ChatTimelineMediaView,
    ChatTimelineView,
    ChatViewSet,
    ClientQuickReplyViewSet,
)
from apps.core.views import (
    BusinessCalendarViewSet,
    GlobalSearchView,
    HolidayViewSet,
    LoginBrandingAdminView,
    LoginBrandingImageAdminView,
    LoginBrandingImageView,
    LoginBrandingPublicView,
    SystemConfigView,
    SystemTestEmailView,
)
from apps.customers.admin_api import CompanyAdminViewSet, PlanAdminViewSet
from apps.customers.pessoas import PessoaEmpresaView, PessoasEmpresaView, ReenviarConviteView
from apps.customers.views import CompanyViewSet, MaintenanceView, MyCompanyView, QuotaView
from apps.kanban.views import BoardLaneViewSet, BoardViewSet
from apps.knowledge.views import ArticleViewSet
from apps.notes.views import NoteTagViewSet, NoteViewSet
from apps.notifications.views import NotificationPreferenceView, NotificationViewSet
from apps.reports.views import (
    ChatStatsView,
    IndicatorsView,
    ReportExportViewSet,
    TicketReportExportView,
    TicketReportView,
)
from apps.tickets.admin_api import (
    ServiceAdminViewSet,
    SLAPolicyAdminViewSet,
    TicketCategoryAdminViewSet,
    TicketMacroViewSet,
    TicketStageViewSet,
    TicketTagViewSet,
)
from apps.tickets.views import (
    AttachmentDownloadView,
    ServiceViewSet,
    TeamViewSet,
    TicketCategoryViewSet,
    TicketViewSet,
)

router = DefaultRouter()

# --- operação ---
router.register("tickets", TicketViewSet, basename="ticket")
router.register("teams", TeamViewSet, basename="team")
router.register("categories", TicketCategoryViewSet, basename="category")
router.register("services", ServiceViewSet, basename="service")
router.register("users", UserViewSet, basename="user")
router.register("companies", CompanyViewSet, basename="company")
router.register("chat/chats", ChatViewSet, basename="chat")
router.register("chat/macros", ChatMacroViewSet, basename="chat-macro")
router.register("chat/banned-words", BannedWordViewSet, basename="chat-banned-word")
router.register(
    "chat/close-reasons", ChatCloseReasonViewSet, basename="chat-close-reason"
)
# atalhos de mensagem do chat — o PORTAL lê (é quem usa), o admin gerencia
router.register(
    "chat/quick-replies", ClientQuickReplyViewSet, basename="chat-quick-reply"
)
router.register("notifications", NotificationViewSet, basename="notification")
router.register("announcements", AnnouncementViewSet, basename="announcement")
router.register("kanban/boards", BoardViewSet, basename="kanban-board")
router.register("kanban/lanes", BoardLaneViewSet, basename="kanban-lane")
router.register("knowledge/articles", ArticleViewSet, basename="knowledge-article")
# Notas pessoais de quem atende. `notes/tags` ANTES de `notes`, e a ordem é
# obrigatória: o detalhe de nota vira `^notes/(?P<pk>[^/.]+)/$`, que casa com
# `notes/tags/` — registrado depois, o autocomplete de etiqueta viraria um
# 404 de "nota com id 'tags'".
router.register("notes/tags", NoteTagViewSet, basename="note-tag")
router.register("notes", NoteViewSet, basename="note")
router.register("reports/exports", ReportExportViewSet, basename="report-export")

# --- configuração (telas de admin) ---
router.register("settings/statuses", TicketStageViewSet, basename="cfg-status")
router.register("settings/categories", TicketCategoryAdminViewSet, basename="cfg-category")
router.register("settings/services", ServiceAdminViewSet, basename="cfg-service")
router.register("settings/sla-policies", SLAPolicyAdminViewSet, basename="cfg-sla")
router.register("settings/tags", TicketTagViewSet, basename="cfg-tag")
router.register("settings/ticket-macros", TicketMacroViewSet, basename="cfg-ticket-macro")
router.register("settings/plans", PlanAdminViewSet, basename="cfg-plan")
router.register("settings/companies", CompanyAdminViewSet, basename="cfg-company")
router.register("settings/users", UserAdminViewSet, basename="cfg-user")
router.register("settings/teams", TeamAdminViewSet, basename="cfg-team")
router.register("settings/calendars", BusinessCalendarViewSet, basename="cfg-calendar")
router.register("settings/holidays", HolidayViewSet, basename="cfg-holiday")
router.register("settings/choices", RoleChoicesView, basename="cfg-choices")
# Papéis personalizados (RBAC) — permissão própria: ver CustomRoleViewSet.
router.register("settings/roles", CustomRoleViewSet, basename="cfg-role")

# --- auditoria e LGPD ---
router.register("audit/logs", AuditLogViewSet, basename="audit-log")
router.register("audit/ticket-access", TicketAccessLogViewSet, basename="audit-access")
router.register("audit/lgpd", DataSubjectRequestViewSet, basename="audit-lgpd")
router.register("audit/retention", RetentionRunViewSet, basename="audit-retention")

urlpatterns = router.urls + [
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    # verificação em duas etapas: a segunda etapa do login (sem sessão ainda)…
    path("auth/2fa/", TwoFactorVerifyView.as_view(), name="auth-2fa"),
    path("auth/2fa/resend/", TwoFactorResendView.as_view(), name="auth-2fa-resend"),
    # …e a gestão do PRÓPRIO método, já autenticado (tela "Minha conta")
    path("auth/2fa/status/", TwoFactorStatusView.as_view(), name="auth-2fa-status"),
    path("auth/2fa/setup/", TwoFactorSetupView.as_view(), name="auth-2fa-setup"),
    path("auth/2fa/confirm/", TwoFactorConfirmView.as_view(), name="auth-2fa-confirm"),
    path("auth/2fa/request-code/", TwoFactorRequestCodeView.as_view(),
         name="auth-2fa-request-code"),
    path("auth/2fa/disable/", TwoFactorDisableView.as_view(), name="auth-2fa-disable"),
    # fecha o convite: o link do e-mail vira senha. Público por natureza —
    # quem chega aqui ainda não tem como se autenticar.
    path("auth/definir-senha/", DefinirSenhaView.as_view(), name="auth-definir-senha"),
    # "Esqueci minha senha": pedir o link (resposta igual exista ou não a
    # conta) e trocar a senha por ele. Públicos pelo mesmo motivo do convite.
    path("auth/recuperar-senha/", RecuperarSenhaView.as_view(), name="auth-recuperar-senha"),
    path("auth/redefinir-senha/", RedefinirSenhaView.as_view(), name="auth-redefinir-senha"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", MeView.as_view(), name="auth-me"),
    path("me/avatar/", AvatarUploadView.as_view(), name="my-avatar"),
    path("avatars/<str:nome>", AvatarFileView.as_view(), name="avatar-file"),
    path("me/assinatura-imagem/", AssinaturaImagemView.as_view(), name="my-signature-image"),
    # sem sessão de propósito: esta URL vai dentro do e-mail do cliente
    # (ver AssinaturaFileView)
    path("assinaturas/<str:nome>", AssinaturaFileView.as_view(), name="signature-file"),
    path("me/password/", MyPasswordView.as_view(), name="my-password"),
    path("me/sessions/", MySessionsView.as_view(), name="my-sessions"),
    path("me/sessions/<str:key>/", MySessionRevokeView.as_view(), name="my-session-revoke"),
    path("me/access-history/", MyAccessHistoryView.as_view(), name="my-access-history"),
    path("me/presence/", MyPresenceView.as_view(), name="my-presence"),
    # a empresa do próprio cliente (Configurações → Empresa, no portal)
    path("me/company/", MyCompanyView.as_view(), name="my-company"),
    # as pessoas dela, geridas pelo responsável (Configurações → Pessoas da empresa)
    path("me/company/users/", PessoasEmpresaView.as_view(), name="my-company-users"),
    path("me/company/users/<int:pk>/", PessoaEmpresaView.as_view(), name="my-company-user"),
    path("me/company/users/<int:pk>/invite/", ReenviarConviteView.as_view(),
         name="my-company-user-invite"),
    path("quota/", QuotaView.as_view(), name="quota"),
    path("maintenance/", MaintenanceView.as_view(), name="maintenance"),
    path("settings/system/", SystemConfigView.as_view(), name="cfg-system"),
    path("settings/system/test-email/", SystemTestEmailView.as_view(),
         name="cfg-system-test-email"),
    # a tela de login é anônima: os textos e a imagem do painel são públicos;
    # a edição fica em settings/, como todo o resto que o admin configura
    path("branding/login/", LoginBrandingPublicView.as_view(), name="branding-login"),
    path("branding/login-image/<str:audience>/", LoginBrandingImageView.as_view(),
         name="branding-login-image"),
    path("settings/branding/login/", LoginBrandingAdminView.as_view(),
         name="cfg-branding-login"),
    path("settings/branding/login/<str:audience>/", LoginBrandingAdminView.as_view(),
         name="cfg-branding-login-audience"),
    path("settings/branding/login/<str:audience>/image/",
         LoginBrandingImageAdminView.as_view(), name="cfg-branding-login-image"),
    # Configurações → Importar (Movidesk) e → Backup — só admin, ver apps/ferramentas
    path("ferramentas/", include("apps.ferramentas.urls")),
    path("search/", GlobalSearchView.as_view(), name="global-search"),
    # LGPD: self-service do titular e download do pacote de portabilidade
    path("me/data-requests/", MyDataRequestView.as_view(), name="my-data-requests"),
    path("audit/lgpd/<int:pk>/download/", DataSubjectExportDownloadView.as_view(),
         name="lgpd-export-download"),
    path("attachments/<int:pk>/", AttachmentDownloadView.as_view(), name="attachment"),
    path("chat/files/<int:pk>/", ChatFileDownloadView.as_view(), name="chat-file"),
    path("chat/config/", ChatConfigView.as_view(), name="chat-config"),
    path("chat/reports/", ChatReportView.as_view(), name="chat-reports"),
    # A conversa contínua do cliente (todas as sessões dele numa linha só) e
    # o painel de anexos/links dela. Fora do router de propósito: não são um
    # recurso a mais, são duas leituras do que os chats já contêm.
    path("chat/timeline/", ChatTimelineView.as_view(), name="chat-timeline"),
    path("chat/timeline/media/", ChatTimelineMediaView.as_view(), name="chat-timeline-media"),
    # transcrição da conversa contínua em PDF — sem recorte, é o ponto
    path("chat/timeline/export/", ChatTimelineExportView.as_view(),
         name="chat-timeline-export"),
    path("notification-preferences/", NotificationPreferenceView.as_view(),
         name="notification-preferences"),
    path("reports/indicators/", IndicatorsView.as_view(), name="report-indicators"),
    path("reports/tickets/", TicketReportView.as_view(), name="report-tickets"),
    path("reports/tickets/export/", TicketReportExportView.as_view(),
         name="report-tickets-export"),
    path("reports/chats/", ChatStatsView.as_view(), name="report-chats"),
]
