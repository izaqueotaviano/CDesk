"""Valida a cadeia de antivírus de ponta a ponta contra o daemon de verdade.

**Rode isto no primeiro `docker compose up` e depois de cada troca de host.**

Foi a lacuna que eu não consegui fechar sozinho: os testes exercitam o
protocolo INSTREAM contra um servidor falso, o que prova que a tradução da
resposta está certa — não prova que *aquele* ClamAV está de pé, com a base de
assinaturas baixada e o `StreamMaxLength` grande o bastante para os anexos que
vocês aceitam. Este comando prova.

    python manage.py clamav_check

Três verificações, na ordem em que falham na prática:

1. **PING** — o daemon responde? (a primeira subida leva minutos baixando a base)
2. **EICAR** — ele *detecta*? Um daemon sem base responde OK para tudo, o que é
   pior que estar fora do ar: silenciosamente aprova malware.
3. **Tamanho** — um arquivo do tamanho máximo configurado passa pelo stream, ou
   o `StreamMaxLength` está menor que o limite de anexo?
"""

import io

from django.core.management.base import BaseCommand, CommandError

from apps.tickets.services import antivirus

# Assinatura padrão de teste de antivírus (não é malware — é uma string que
# todo antivírus reconhece de propósito, justamente para este tipo de conferência).
EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


class Command(BaseCommand):
    help = "Verifica se o ClamAV está de pé, detectando e aceitando o tamanho máximo."

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-size", action="store_true",
            help="Pula a verificação de tamanho (que transfere o limite inteiro).",
        )

    def handle(self, *args, **options):
        from django.conf import settings

        from apps.tickets.services.attachments import limits

        self.stdout.write(self.style.MIGRATE_HEADING("\nClamAV — verificação\n"))
        self.stdout.write(f"  host: {settings.CLAMAV_HOST}:{settings.CLAMAV_PORT}")

        if not settings.CLAMAV_ENABLED:
            raise CommandError(
                "CLAMAV_ENABLED=False — os anexos estão sendo gravados como "
                "'não verificado'. Ligue antes de validar."
            )

        # 1. o daemon está de pé?
        if not antivirus.ping():
            raise CommandError(
                "Sem resposta ao PING. Na primeira subida o container passa "
                "minutos baixando a base de assinaturas (~200 MB); confira "
                "`docker compose logs clamav` e tente de novo."
            )
        self.stdout.write(self.style.SUCCESS("  1. PING             OK"))

        # 2. ele detecta? — um daemon sem base aprova tudo em silêncio
        verdict, signature = antivirus.scan_stream(io.BytesIO(EICAR))
        if verdict != antivirus.INFECTED:
            raise CommandError(
                "O daemon respondeu, mas NÃO detectou o EICAR. Isso significa "
                "base de assinaturas ausente ou vazia — e um antivírus que "
                "aprova tudo é pior que nenhum, porque dá falsa segurança. "
                "Rode `freshclam` no container."
            )
        self.stdout.write(
            self.style.SUCCESS(f"  2. EICAR detectado  OK  ({signature})")
        )

        # 3. o limite de stream do daemon cobre o limite de anexo?
        max_bytes, _, max_files = limits()
        if options["skip_size"]:
            self.stdout.write("  3. tamanho          PULADO")
        else:
            self.stdout.write(
                f"  3. testando arquivo de {max_bytes // 1024 // 1024} MB…",
                ending="\r",
            )
            try:
                antivirus.scan_stream(io.BytesIO(b"\0" * max_bytes))
            except antivirus.ScanRejected as exc:
                raise CommandError(
                    f"O daemon recusou um arquivo de {max_bytes // 1024 // 1024} MB: "
                    f"{exc}\n\nO `StreamMaxLength` do clamd.conf precisa ser >= o "
                    "limite de anexo, senão todo anexo grande cai em 'error' e "
                    "fica bloqueado (fail-closed)."
                ) from exc
            self.stdout.write(self.style.SUCCESS(
                f"  3. tamanho          OK  ({max_bytes // 1024 // 1024} MB aceitos)"
            ))

        self.stdout.write(self.style.SUCCESS(
            f"\nCadeia validada. Limite atual: {max_bytes // 1024 // 1024} MB por "
            f"arquivo, {max_files} arquivo(s) por mensagem.\n"
        ))
