"""Leitura das trilhas de auditoria e pedidos LGPD (tela `/admin/auditoria`).

Append-only também na API: nenhum endpoint permite alterar ou apagar log.
"""

from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import (
    AuditLog,
    DataSubjectRequest,
    RetentionRun,
    TicketAccessLog,
)
from apps.core.permissions import IsAdmin


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(
        source="actor.full_name", read_only=True, default="—"
    )
    target_type = serializers.CharField(source="content_type.model", read_only=True)

    class Meta:
        model = AuditLog
        fields = ["id", "actor", "actor_name", "action", "target_type", "object_id",
                  "changes", "summary", "ip_address", "created_at"]


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor", "content_type").order_by("-created_at")
        if action_filter := self.request.query_params.get("action"):
            qs = qs.filter(action=action_filter)
        if actor := self.request.query_params.get("actor"):
            qs = qs.filter(actor_id=actor)
        if since := self.request.query_params.get("from"):
            qs = qs.filter(created_at__date__gte=since)
        return qs


class TicketAccessLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True, default="—")
    ticket_reference = serializers.CharField(source="ticket.reference", read_only=True)
    team = serializers.CharField(source="ticket.team.name", read_only=True)

    class Meta:
        model = TicketAccessLog
        fields = ["id", "ticket", "ticket_reference", "team", "user", "user_name",
                  "was_granted", "context", "ip_address", "created_at"]


class TicketAccessLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Quem leu ticket de equipe restrita — incluindo tentativas negadas."""

    serializer_class = TicketAccessLogSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = (TicketAccessLog.objects
              .select_related("user", "ticket__team")
              .order_by("-created_at"))
        if ticket := self.request.query_params.get("ticket"):
            qs = qs.filter(ticket_id=ticket)
        if user := self.request.query_params.get("user"):
            qs = qs.filter(user_id=user)
        if self.request.query_params.get("denied") == "1":
            qs = qs.filter(was_granted=False)
        return qs


class DataSubjectRequestSerializer(serializers.ModelSerializer):
    subject_user_name = serializers.CharField(
        source="subject_user.full_name", read_only=True, default=None
    )
    subject_company_name = serializers.CharField(
        source="subject_company.name", read_only=True, default=None
    )

    executed_by_name = serializers.CharField(
        source="executed_by.full_name", read_only=True, default=None
    )
    is_overdue = serializers.BooleanField(read_only=True)
    days_left = serializers.IntegerField(read_only=True, allow_null=True)
    has_export = serializers.SerializerMethodField()

    class Meta:
        model = DataSubjectRequest
        fields = ["id", "kind", "status", "subject_user", "subject_user_name",
                  "subject_company", "subject_company_name", "requested_by",
                  "executed_by", "executed_by_name", "executed_at",
                  "verified_by", "verified_at", "verification_note",
                  "due_at", "is_overdue", "days_left", "has_export",
                  "result", "error", "notes", "rejection_reason", "created_at"]
        read_only_fields = ["status", "requested_by", "executed_by", "executed_at",
                            "verified_by", "verified_at", "due_at", "result", "error",
                            "rejection_reason"]

    def get_has_export(self, obj) -> bool:
        return bool(obj.export_file)

    def validate(self, data):
        if self.instance is not None:
            # Update (PATCH): quem é o titular e que TIPO de pedido é isto são
            # a identidade do próprio pedido — imutáveis depois de criado.
            # Achado real testando a tela: nada aqui impedia repor
            # subject_user/subject_company/kind depois de `verify()` já ter
            # conferido a identidade de OUTRA pessoa — a anonimização então
            # rodava sobre quem nunca teve identidade nenhuma checada, e o
            # PATCH nem deixava rastro (nenhum AuditLog no update genérico).
            # Editar por aqui segue valendo pra notes/verification_note; pra
            # mudar o titular ou o tipo, o caminho é rejeitar e abrir outro.
            for campo in ("subject_user", "subject_company", "kind"):
                if campo in data and data[campo] != getattr(self.instance, campo):
                    raise serializers.ValidationError({
                        campo: "Não é possível mudar depois de criado — "
                               "rejeite este pedido e abra um novo.",
                    })
            return data

        # Os dois checks abaixo só fazem sentido na CRIAÇÃO — num update
        # parcial, subject_user/subject_company legitimamente não vêm no
        # payload (ex.: um PATCH só de `notes`), e exigi-los aqui rejeitaria
        # toda edição que não fosse redigitar o alvo inteiro de novo.
        if not data.get("subject_user") and not data.get("subject_company"):
            raise serializers.ValidationError(
                "Informe o usuário ou a empresa alvo do pedido."
            )
        if (
            data.get("kind") == DataSubjectRequest.Kind.EXPORT
            and not data.get("subject_user")
        ):
            # devolver "os dados da empresa" para quem pediu vazaria dado de
            # todos os funcionários dela
            raise serializers.ValidationError(
                "Exportação exige um usuário titular; pedido de empresa não se aplica."
            )
        return data


class DataSubjectRequestViewSet(viewsets.ModelViewSet):
    """Pedidos LGPD.

    Criar o pedido **não** executa nada. Anonimização é irreversível: precisa
    de identidade conferida (`verify`) e aprovação antes de `execute`.
    """

    queryset = DataSubjectRequest.objects.select_related(
        "subject_user", "subject_company", "requested_by", "executed_by"
    ).order_by("-created_at")
    serializer_class = DataSubjectRequestSerializer
    permission_classes = [IsAdmin]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Registra COMO a identidade do titular foi confirmada.

        Executar anonimização sem isso é o próprio vetor de ataque: basta um
        e-mail se passando pelo titular para destruir um cadastro.
        """
        dsr = self.get_object()
        note = (request.data.get("verification_note") or "").strip()
        if not note:
            return Response(
                {"verification_note": "Descreva como a identidade foi confirmada."},
                status=400,
            )
        if dsr.status != DataSubjectRequest.Status.PENDING:
            return Response({"detail": "Pedido já processado."}, status=400)

        dsr.verified_by = request.user
        dsr.verified_at = timezone.now()
        dsr.verification_note = note[:250]
        dsr.status = DataSubjectRequest.Status.APPROVED
        dsr.save(update_fields=["verified_by", "verified_at",
                                "verification_note", "status"])
        return Response(self.get_serializer(dsr).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """A LGPD exige informar o motivo da negativa — então ele é obrigatório."""
        dsr = self.get_object()
        reason = (request.data.get("rejection_reason") or "").strip()
        if not reason:
            return Response(
                {"rejection_reason": "A negativa precisa de justificativa (LGPD)."},
                status=400,
            )
        if not dsr.is_open:
            return Response({"detail": "Pedido já encerrado."}, status=400)

        dsr.status = DataSubjectRequest.Status.REJECTED
        dsr.rejection_reason = reason
        dsr.executed_by = request.user
        dsr.executed_at = timezone.now()
        dsr.save(update_fields=["status", "rejection_reason",
                                "executed_by", "executed_at"])
        return Response(self.get_serializer(dsr).data)

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """Dispara a execução em background, registrando quem apertou o botão."""
        from apps.audit.tasks import execute_data_subject_request

        dsr = self.get_object()

        # anonimização é irreversível: só sai daqui com identidade conferida
        allowed = (
            [DataSubjectRequest.Status.APPROVED, DataSubjectRequest.Status.FAILED]
            if dsr.requires_verification()
            else [DataSubjectRequest.Status.PENDING, DataSubjectRequest.Status.APPROVED,
                  DataSubjectRequest.Status.FAILED]
        )
        if dsr.status not in allowed:
            detail = (
                "Anonimização exige verificação de identidade antes de executar."
                if dsr.requires_verification()
                else "Pedido já processado."
            )
            return Response({"detail": detail}, status=400)

        dsr.status = DataSubjectRequest.Status.RUNNING
        dsr.executed_by = request.user
        dsr.save(update_fields=["status", "executed_by"])
        execute_data_subject_request.delay(dsr.pk, executed_by_id=request.user.pk)
        dsr.refresh_from_db()
        return Response(self.get_serializer(dsr).data)

    @action(detail=True, methods=["get"])
    def redaction_candidates(self, request, pk=None):
        """Trechos com PII provável em texto livre — para revisão humana.

        Só sugere. Regex que apaga sozinho destrói conteúdo legítimo, e
        "irreversível" é a palavra que desqualifica o automático.
        """
        from apps.audit.services import anonymization

        dsr = self.get_object()
        users = [dsr.subject_user] if dsr.subject_user_id else []
        if not users and dsr.subject_company_id:
            from apps.accounts.models import User

            users = list(User.objects.filter(company_id=dsr.subject_company_id))
        return Response({"candidates": anonymization.find_free_text_pii(users)})

    @action(detail=True, methods=["post"])
    def redact(self, request, pk=None):
        """Redige um campo apontado por `redaction_candidates`."""
        from apps.audit.services import anonymization

        self.get_object()  # 404 se o pedido não existe
        model = request.data.get("model")
        target = request.data.get("pk")
        if model not in ("ticket", "message") or not target:
            return Response({"detail": "Informe model ('ticket'|'message') e pk."}, 400)

        done = anonymization.redact_free_text(
            model=model, pk=int(target), actor=request.user
        )
        return Response({"redacted": done})


class RetentionRunSerializer(serializers.ModelSerializer):
    total_matched = serializers.IntegerField(read_only=True)
    total_applied = serializers.IntegerField(read_only=True)
    triggered_by_name = serializers.CharField(
        source="triggered_by.full_name", read_only=True, default="agendamento"
    )

    reviewed_by_name = serializers.CharField(
        source="reviewed_by.full_name", read_only=True, default=None
    )
    is_reviewed = serializers.BooleanField(read_only=True)

    class Meta:
        model = RetentionRun
        fields = ["id", "dry_run", "status", "results", "error", "finished_at",
                  "triggered_by", "triggered_by_name", "total_matched",
                  "total_applied", "reviewed_by", "reviewed_by_name",
                  "reviewed_at", "review_note", "is_reviewed", "created_at"]


class RetentionRunViewSet(viewsets.ReadOnlyModelViewSet):
    """Ciclos de retenção (D18).

    É o que torna o dry-run revisável: sem esta tela, "simular antes de ligar"
    seria uma linha de log que ninguém lê.
    """

    queryset = RetentionRun.objects.select_related("triggered_by", "reviewed_by")
    serializer_class = RetentionRunSerializer
    permission_classes = [IsAdmin]

    @action(detail=False, methods=["post"])
    def simulate(self, request):
        """Roda uma simulação agora, sob demanda."""
        from apps.audit.services import retention

        cycle = retention.run(dry_run=True, triggered_by=request.user)
        return Response(self.get_serializer(cycle).data, status=201)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Registra que alguém olhou este relatório — é o que destrava o
        expurgo efetivo. Ver `retention._blocking_reason`."""
        cycle = self.get_object()
        if not cycle.dry_run:
            return Response(
                {"detail": "Só simulações precisam (e podem) ser revisadas."}, 400
            )
        cycle.reviewed_by = request.user
        cycle.reviewed_at = timezone.now()
        cycle.review_note = (request.data.get("review_note") or "")[:250]
        cycle.save(update_fields=["reviewed_by", "reviewed_at", "review_note"])
        return Response(self.get_serializer(cycle).data)


@extend_schema(
    responses={(200, "application/zip"): OpenApiTypes.BINARY},
    description="Download do pacote de portabilidade (LGPD art. 18).",
)
class DataSubjectExportDownloadView(APIView):
    """Download do pacote de portabilidade.

    Duas pessoas podem baixar: um admin, e **o próprio titular**. O titular
    receber os próprios dados é o ponto do art. 18 — mas por download
    autenticado e registrado, nunca por e-mail com anexo.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        dsr = DataSubjectRequest.objects.filter(pk=pk).first()
        if dsr is None or not dsr.export_file:
            raise NotFound("Pacote não disponível.")

        is_admin = request.user.is_internal and request.user.is_admin
        if not (is_admin or dsr.subject_user_id == request.user.pk):
            raise NotFound("Pacote não disponível.")  # não confirma existência

        if dsr.export_expires_at and dsr.export_expires_at < timezone.now():
            raise PermissionDenied("O pacote expirou; solicite uma nova exportação.")

        from django.contrib.contenttypes.models import ContentType

        from apps.audit.models import AuditAction

        AuditLog.objects.create(
            actor=request.user,
            action=AuditAction.EXPORT,
            content_type=ContentType.objects.get_for_model(DataSubjectRequest),
            object_id=str(dsr.pk),
            summary=f"Download do pacote LGPD #{dsr.pk}",
        )

        response = FileResponse(
            dsr.export_file.open("rb"), content_type="application/zip"
        )
        response["Content-Disposition"] = f'attachment; filename="meus-dados-{dsr.pk}.zip"'
        response["X-Content-Type-Options"] = "nosniff"
        return response


@extend_schema(
    request=DataSubjectRequestSerializer,
    responses=DataSubjectRequestSerializer(many=True),
    description="Self-service do titular: exportação dos próprios dados.",
)
class MyDataRequestView(APIView):
    """Self-service do titular (portal).

    Exportação é não-destrutiva e o titular já vê esses dados na tela — exigir
    intermediação só adiciona atrito e risco de estourar o prazo legal. A
    sessão autenticada *é* a verificação de identidade, e isso fica registrado.

    Anonimização **não** entra aqui: é irreversível e afeta o histórico da
    empresa contratante. O titular pede, um admin confere e executa.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        mine = DataSubjectRequest.objects.filter(
            subject_user=request.user
        ).order_by("-created_at")[:20]
        return Response(DataSubjectRequestSerializer(mine, many=True).data)

    def post(self, request):
        from apps.audit.tasks import execute_data_subject_request

        kind = request.data.get("kind", DataSubjectRequest.Kind.EXPORT)
        if kind != DataSubjectRequest.Kind.EXPORT:
            raise PermissionDenied(
                "Apenas exportação é self-service. Para exclusão, abra um pedido "
                "com o suporte — a anonimização é irreversível e passa por conferência."
            )

        pending = DataSubjectRequest.objects.filter(
            subject_user=request.user,
            kind=DataSubjectRequest.Kind.EXPORT,
            status__in=[DataSubjectRequest.Status.PENDING,
                        DataSubjectRequest.Status.APPROVED,
                        DataSubjectRequest.Status.RUNNING],
        ).first()
        if pending is not None:
            # evita fila de pacotes idênticos a cada clique
            return Response(DataSubjectRequestSerializer(pending).data, status=200)

        dsr = DataSubjectRequest.objects.create(
            kind=DataSubjectRequest.Kind.EXPORT,
            subject_user=request.user,
            requested_by=request.user,
            status=DataSubjectRequest.Status.RUNNING,
            verified_by=request.user,
            verified_at=timezone.now(),
            verification_note="Sessão autenticada do próprio titular.",
        )
        execute_data_subject_request.delay(dsr.pk, executed_by_id=request.user.pk)
        dsr.refresh_from_db()
        return Response(DataSubjectRequestSerializer(dsr).data, status=201)
