from django.apps import AppConfig


class KanbanConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.kanban"
    label = "kanban"
    verbose_name = "Kanban"
