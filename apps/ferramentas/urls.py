from django.urls import path

from apps.ferramentas import views

urlpatterns = [
    path("importacao-movidesk/", views.ImportacaoMovideskView.as_view(), name="fer-importacao"),
    path(
        "importacao-movidesk/<int:pk>/",
        views.ImportacaoMovideskDetalheView.as_view(),
        name="fer-importacao-detalhe",
    ),
    path(
        "importacao-movidesk/<int:pk>/cancelar/",
        views.ImportacaoMovideskCancelarView.as_view(),
        name="fer-importacao-cancelar",
    ),
    path(
        "importacao-movidesk/<int:pk>/arquivo/",
        views.ImportacaoMovideskArquivoView.as_view(),
        name="fer-importacao-arquivo",
    ),
    path("backups/", views.BackupsView.as_view(), name="fer-backups"),
    path(
        "backups/agendamento/",
        views.AgendamentoBackupView.as_view(),
        name="fer-backups-agendamento",
    ),
    path(
        "backups/trabalhos/<int:pk>/",
        views.BackupTrabalhoView.as_view(),
        name="fer-backup-trabalho",
    ),
    path("backups/<str:nome>/", views.BackupArquivoView.as_view(), name="fer-backup-arquivo"),
    path(
        "backups/<str:nome>/download/",
        views.BackupDownloadView.as_view(),
        name="fer-backup-download",
    ),
    path(
        "backups/<str:nome>/restaurar/",
        views.BackupRestaurarView.as_view(),
        name="fer-backup-restaurar",
    ),
]
