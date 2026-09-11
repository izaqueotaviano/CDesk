"""Solta da quarentena os anexos presos por uma varredura que nunca veio.

Só faz algo quando a varredura está DESLIGADA (`CLAMAV_ENABLED=False`): com
antivírus ligado, `pending` é uma promessa que o worker ainda vai cumprir e
`error` é o fail-closed do D19 — nenhum dos dois é para se mexer daqui.

O destino é `skipped` ("não verificado"), que é o que o modelo já documenta
para anexo criado sem varredura — e nunca `clean`, que seria afirmar uma
verificação que não aconteceu.
"""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Com CLAMAV_ENABLED=0, marca como 'não verificado' os anexos presos em quarentena."

    def handle(self, *args, **options):
        if settings.CLAMAV_ENABLED:
            self.stdout.write("Varredura ligada — nada a liberar.")
            return

        from apps.chat.models import ChatFile, ChatScanStatus
        from apps.tickets.models import ScanStatus, TicketAttachment

        agora = timezone.now()
        presos = (ChatScanStatus.PENDING, ChatScanStatus.ERROR)
        chat = ChatFile.objects.filter(scan_status__in=presos).update(
            scan_status=ChatScanStatus.SKIPPED, scanned_at=agora
        )
        ticket = TicketAttachment.objects.filter(
            scan_status__in=(ScanStatus.PENDING, ScanStatus.ERROR)
        ).update(scan_status=ScanStatus.SKIPPED, scanned_at=agora)
        self.stdout.write(f"Liberados: {chat} anexo(s) de chat, {ticket} de chamado.")
