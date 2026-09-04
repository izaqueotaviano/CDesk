from rest_framework import serializers

from apps.notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "body", "url", "ticket_id",
                  "actor_name", "read_at", "created_at"]

    def get_actor_name(self, obj) -> str | None:
        return obj.actor.full_name if obj.actor else None
