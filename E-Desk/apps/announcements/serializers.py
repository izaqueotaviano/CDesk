from rest_framework import serializers

from apps.announcements.models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    dismissed = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id", "title", "body", "kind", "starts_at", "ends_at", "is_pinned",
            "is_active", "audience_kind", "target_roles", "target_teams",
            "target_companies", "target_plans", "created_by_name", "dismissed",
            "created_at",
        ]
        read_only_fields = ["created_by_name", "dismissed", "created_at"]

    def get_created_by_name(self, obj) -> str | None:
        return obj.created_by.full_name if obj.created_by else None

    def get_dismissed(self, obj) -> bool:
        """Preenchido via annotate na listagem; detalhe consulta direto."""
        if hasattr(obj, "user_dismissed"):
            return bool(obj.user_dismissed)
        user = self.context["request"].user
        return obj.reads.filter(user=user, dismissed=True).exists()

    def validate(self, data):
        starts, ends = data.get("starts_at"), data.get("ends_at")
        if starts and ends and ends <= starts:
            raise serializers.ValidationError(
                {"ends_at": "Fim da vigência deve ser depois do início."}
            )
        return data
