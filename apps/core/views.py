"""Calendário comercial pela API (base do cálculo de SLA) e busca global."""

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction, AuditLog
from apps.core.email_template import TEMPLATE_HTML_PADRAO
from apps.core.models import BusinessCalendar, Holiday, SystemConfig
from apps.core.permissions import IsInternal, IsInternalReadAdminWrite


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ["id", "calendar", "date", "name", "start_time", "end_time"]

    def validate(self, data):
        """Horário é tudo-ou-nada: os dois vazios (dia fechado) ou os dois
        preenchidos com fim depois do início (meio período)."""
        inicio = data.get("start_time", getattr(self.instance, "start_time", None))
        fim = data.get("end_time", getattr(self.instance, "end_time", None))
        if bool(inicio) != bool(fim):
            raise serializers.ValidationError(
                "Para meio período, informe início E fim; para o dia todo "
                "fechado, deixe os dois em branco."
            )
        if inicio and fim and fim <= inicio:
            raise serializers.ValidationError(
                {"end_time": "O fim precisa ser depois do início."}
            )
        return data


class BusinessCalendarSerializer(serializers.ModelSerializer):
    holidays = HolidaySerializer(many=True, read_only=True)

    class Meta:
        model = BusinessCalendar
        fields = ["id", "name", "timezone", "is_default", "workdays", "holidays"]

    def validate_workdays(self, value):
        """[{"weekday": 0-6, "start": "HH:MM", "end": "HH:MM"}] — validar aqui
        evita que uma janela inválida quebre o cálculo de SLA em produção.

        O mesmo dia pode ter VÁRIAS janelas (expediente partido: 09-12 e 13-18).
        O que não pode é sobreposição: `add_business_minutes` soma cada janela
        separadamente, então 09-13 + 12-18 contaria a hora sobreposta duas vezes
        e o prazo sairia menor do que o combinado com o cliente.
        """
        import datetime as dt

        if not isinstance(value, list):
            raise serializers.ValidationError("Envie uma lista de janelas.")

        by_weekday: dict[int, list[tuple[dt.time, dt.time]]] = {}
        for window in value:
            try:
                weekday = int(window["weekday"])
                start = dt.time.fromisoformat(window["start"])
                end = dt.time.fromisoformat(window["end"])
            except (KeyError, TypeError, ValueError) as exc:
                raise serializers.ValidationError(
                    "Cada janela precisa de weekday (0-6), start e end (HH:MM)."
                ) from exc
            if not 0 <= weekday <= 6:
                raise serializers.ValidationError("weekday deve estar entre 0 e 6.")
            if end <= start:
                raise serializers.ValidationError(
                    f"Janela inválida no dia {weekday}: fim deve ser depois do início."
                )
            by_weekday.setdefault(weekday, []).append((start, end))

        for weekday, windows in by_weekday.items():
            windows.sort()
            # strict=False: as duas fatias têm tamanhos diferentes de propósito
            # (é um zip de pares consecutivos), e parar na mais curta é a regra
            for (_, previous_end), (next_start, _) in zip(windows, windows[1:], strict=False):
                if next_start < previous_end:
                    raise serializers.ValidationError(
                        f"Janelas sobrepostas no dia {weekday}: um turno precisa "
                        "terminar antes de o outro começar."
                    )
        return value


class BusinessCalendarViewSet(viewsets.ModelViewSet):
    queryset = BusinessCalendar.objects.prefetch_related("holidays").order_by("name")
    serializer_class = BusinessCalendarSerializer
    permission_classes = [IsInternalReadAdminWrite]


class HolidayViewSet(viewsets.ModelViewSet):
    serializer_class = HolidaySerializer
    permission_classes = [IsInternalReadAdminWrite]

    def get_queryset(self):
        qs = Holiday.objects.select_related("calendar").order_by("date")
        if calendar := self.request.query_params.get("calendar"):
            qs = qs.filter(calendar_id=calendar)
        return qs


class SystemConfigSerializer(serializers.ModelSerializer):
    """Os limites em MB acompanham os bytes: quem edita pensa em MB, o
    backend valida em bytes, e nenhum dos dois precisa converter na mão."""

    attachment_max_mb = serializers.SerializerMethodField()
    attachment_max_mb_per_message = serializers.SerializerMethodField()
    # a senha do SMTP nunca volta na leitura — a tela só sabe SE existe uma.
    # Enviar vazio mantém a atual; para trocar, manda a nova.
    smtp_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=200
    )
    smtp_password_set = serializers.SerializerMethodField()
    email_html_template_default = serializers.SerializerMethodField()

    class Meta:
        model = SystemConfig
        fields = [
            "attachment_max_bytes", "attachment_max_mb",
            "attachment_max_files_per_message",
            "attachment_max_bytes_per_message", "attachment_max_mb_per_message",
            "auto_close_pending_hours", "auto_close_message",
            "auto_close_warning_hours", "auto_close_warning_message",
            "csat_enabled", "csat_expires_days",
            "two_factor_required",
            "email_enabled", "smtp_host", "smtp_port", "smtp_username",
            "smtp_password", "smtp_password_set", "smtp_use_tls", "smtp_use_ssl",
            "email_from", "email_html_template", "email_html_template_default",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def get_smtp_password_set(self, obj) -> bool:
        return bool(obj.smtp_password)

    def get_email_html_template_default(self, obj) -> str:
        """O modelo de fábrica, para o botão "restaurar padrão" da tela."""
        return TEMPLATE_HTML_PADRAO

    def update(self, instance, validated_data):
        if validated_data.get("smtp_password", None) == "":
            validated_data.pop("smtp_password")  # vazio = manter a atual
        return super().update(instance, validated_data)

    def get_attachment_max_mb(self, obj) -> int:
        return obj.attachment_max_bytes // 1024 // 1024

    def get_attachment_max_mb_per_message(self, obj) -> int:
        return obj.attachment_max_bytes_per_message // 1024 // 1024

    def validate(self, data):
        instance = SystemConfig.load()
        candidate = SystemConfig(
            attachment_max_bytes=data.get(
                "attachment_max_bytes", instance.attachment_max_bytes),
            attachment_max_files_per_message=data.get(
                "attachment_max_files_per_message",
                instance.attachment_max_files_per_message),
            attachment_max_bytes_per_message=data.get(
                "attachment_max_bytes_per_message",
                instance.attachment_max_bytes_per_message),
        )
        try:
            candidate.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc

        # o aviso só faz sentido chegando ANTES do fechamento — sem isto, um
        # aviso de 80h com prazo de 72h manda o lembrete depois de já ter
        # fechado o ticket
        tls = data.get("smtp_use_tls", instance.smtp_use_tls)
        ssl = data.get("smtp_use_ssl", instance.smtp_use_ssl)
        if tls and ssl:
            raise serializers.ValidationError({
                "smtp_use_ssl": "Escolha STARTTLS ou SSL, não os dois."
            })

        prazo = data.get("auto_close_pending_hours", instance.auto_close_pending_hours)
        aviso = data.get("auto_close_warning_hours", instance.auto_close_warning_hours)
        if prazo and aviso and aviso >= prazo:
            raise serializers.ValidationError({
                "auto_close_warning_hours": (
                    "O aviso precisa chegar antes do fechamento: escolha um "
                    "número de horas menor que o prazo de fechamento."
                )
            })
        return data


@extend_schema(
    request=SystemConfigSerializer,
    responses=SystemConfigSerializer,
    description="Parâmetros operacionais (anexos, chat). Interno lê, admin escreve.",
)
class SystemConfigView(APIView):
    """Singleton: não há lista nem id — existe uma configuração e pronto."""

    permission_classes = [IsInternalReadAdminWrite]

    def get(self, request):
        return Response(SystemConfigSerializer(SystemConfig.load()).data)

    def put(self, request):
        config = SystemConfig.load()
        ser = SystemConfigSerializer(config, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()

        AuditLog.objects.create(
            actor=request.user,
            action=AuditAction.CONFIG_CHANGE,
            content_type=ContentType.objects.get_for_model(SystemConfig),
            object_id=str(config.pk),
            summary="Configuração operacional alterada",
            # a senha do SMTP não entra na trilha: fica "***" como registro
            # de que mudou, sem o valor
            changes={
                k: ("***" if k == "smtp_password" else str(v))
                for k, v in request.data.items()
            },
        )
        return Response(SystemConfigSerializer(SystemConfig.load()).data)


class TestEmailSerializer(serializers.Serializer):
    to = serializers.EmailField()


@extend_schema(
    request=TestEmailSerializer,
    responses=OpenApiTypes.OBJECT,
    description="Envia um e-mail de teste pela configuração atual. Só admin.",
)
class SystemTestEmailView(APIView):
    """O jeito de saber se o SMTP está certo ANTES de um cliente ficar sem o
    código de login: manda um e-mail agora, pela mesma conexão do outbox, e
    devolve o erro do servidor de e-mail em vez de engoli-lo."""

    permission_classes = [IsInternalReadAdminWrite]

    def post(self, request):
        from apps.notifications import mailer

        ser = TestEmailSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        config = SystemConfig.load()
        try:
            mailer.enviar(
                to=ser.validated_data["to"],
                subject="E-mail de teste do Resolv",
                body=(
                    "Este é um e-mail de teste enviado pela tela de Configurações → "
                    "Sistema. Se ele chegou, a entrega está funcionando.\n\n"
                    f"Servidor: {config.smtp_host or 'backend padrão das settings'}."
                ),
                config=config,
            )
        except mailer.EmailDesligado as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        except Exception as exc:  # noqa: BLE001 — o erro do SMTP é a resposta útil
            raise ValidationError({"detail": f"O servidor de e-mail recusou: {exc}"}) from exc
        return Response({"sent": True, "to": ser.validated_data["to"]})


# --------------------------------------------------------------------------- #
# Busca global (Fase 3 do prompt de integração, GAPS.md)


_LIMITE_POR_GRUPO = 8  # prévia pra dropdown, não listagem — cada tela dona
# (Chamados, Empresas, settings/users/) já tem paginação de verdade pra isso


@extend_schema(
    parameters=[OpenApiParameter("q", str, description="termo buscado")],
    description=(
        "Busca através de chamados, empresas e solicitantes — recurso "
        "interno (a tela que consome isto, o cabeçalho, só existe do lado "
        "do agente). Cada grupo é uma PRÉVIA (até 8 linhas), não uma "
        "listagem paginada; quem quer a lista completa de um grupo já tem "
        "tela própria (Chamados, Empresas, settings/users/)."
    ),
)
class GlobalSearchView(APIView):
    """Chamados + empresas + solicitantes numa busca só.

    Cada dimensão reaproveita a MESMA regra de visibilidade/busca que a
    tela dedicada dela já usa — nada de regra nova:
      - chamados: `selectors.visible_tickets` + `_busca_q` (a função que já
        anotava, no próprio docstring, servir "a fila e a busca global");
      - empresas: sem escopo por agente (equipe é o eixo, não empresa —
        `Ticket.visible_to`, D1), mesmo alcance de `settings/companies/`;
      - solicitantes: só `UserKind.CLIENT`, mesmo campo de busca de
        `UserAdminViewSet.get_queryset` (`full_name`/`email`).

    Termo com menos de 2 caracteres devolve vazio sem consultar o banco —
    "busca" de 1 letra é sempre o dropdown inteiro, não uma busca.
    """

    permission_classes = [IsInternal]

    def get(self, request):
        # imports locais: evita ciclo de import no nível de módulo entre
        # apps.core e apps.tickets (que também importa apps.core.permissions)
        from apps.accounts.models import User, UserKind
        from apps.customers.models import Company
        from apps.tickets import selectors
        from apps.tickets.views import _busca_q

        termo = request.query_params.get("q", "").strip()
        if len(termo) < 2:
            return Response({"tickets": [], "companies": [], "requesters": []})

        tickets = (
            selectors.visible_tickets(request.user)
            .filter(_busca_q(request.user, termo))
            .select_related("company", "stage")
            .order_by("-created_at")[:_LIMITE_POR_GRUPO]
        )
        companies = (
            Company.objects.filter(Q(name__unaccent__icontains=termo) | Q(slug__icontains=termo))
            .order_by("name")[:_LIMITE_POR_GRUPO]
        )
        requesters = (
            User.objects.filter(kind=UserKind.CLIENT)
            .filter(Q(full_name__unaccent__icontains=termo) | Q(email__icontains=termo))
            .select_related("company")
            .order_by("full_name")[:_LIMITE_POR_GRUPO]
        )

        return Response({
            "tickets": [
                {
                    "id": t.pk, "reference": t.reference, "subject": t.subject,
                    "company_name": t.company.name, "stage_name": t.stage.name if t.stage else None,
                }
                for t in tickets
            ],
            "companies": [
                {"id": c.pk, "name": c.name, "slug": c.slug} for c in companies
            ],
            "requesters": [
                {
                    "id": u.pk, "full_name": u.full_name, "email": u.email,
                    "company_id": u.company_id, "company_name": u.company.name if u.company else None,
                }
                for u in requesters
            ],
        })


# --------------------------------------------------------------------------- #
# Infraestrutura: saúde e CSRF
# --------------------------------------------------------------------------- #

def saude(request):
    """`GET /health/` — o que o orquestrador e o nginx perguntam. Sem banco de
    propósito: um banco fora do ar deve derrubar o alerta, não fazer o
    orquestrador reiniciar o processo web em laço."""
    from django.http import JsonResponse

    return JsonResponse({"status": "ok"})


def csrf_recusado(request, reason=""):
    """Resposta de CSRF recusado — JSON, porque quem chama é a SPA.

    A página HTML padrão do Django explica em inglês, com o motivo técnico,
    o que numa API vira um erro mudo. `reason` NÃO vai para o cliente: ele
    diz qual verificação falhou (origem, referer, token), que é pista para
    quem está tentando contornar. Fica no log.
    """
    import logging

    from django.http import JsonResponse

    logging.getLogger("django.security.csrf").warning("CSRF recusado: %s", reason)

    return JsonResponse(
        {
            "detail": "A sessão expirou ou a requisição não é válida. Recarregue a página."
        },
        status=403,
    )
