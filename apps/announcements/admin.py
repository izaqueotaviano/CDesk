from django.contrib import admin

from apps.announcements.models import Announcement


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "audience_kind", "starts_at", "ends_at",
                    "is_pinned", "is_active")
    list_filter = ("kind", "audience_kind", "is_pinned", "is_active")
    filter_horizontal = ("target_teams", "target_companies", "target_plans")
