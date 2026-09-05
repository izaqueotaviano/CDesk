"""Como um e-mail sai de fato — pela conexão que o admin configurou.

Tudo que manda e-mail passa por aqui: o outbox (`tasks.send_outbound_email`)
e o botão "enviar e-mail de teste" da tela de Sistema. A configuração vem do
`SystemConfig`: liga/desliga, SMTP e o modelo HTML. Sem host configurado,
usa o backend das settings (console em desenvolvimento) — é o que faz o
sistema funcionar num banco recém-migrado sem ninguém ter preenchido nada.
"""

from __future__ import annotations

import re
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils import timezone

from apps.core.models import SystemConfig

_URL = re.compile(r"https?://[^\s<]+")


class EmailDesligado(Exception):
    """A entrega está desligada em Configurações → Sistema."""


def conexao(config: SystemConfig):
    """SMTP configurado na tela, ou o backend das settings quando não há."""
    if not config.smtp_host:
        return get_connection()
    return get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=config.smtp_host,
        port=config.smtp_port or 587,
        username=config.smtp_username,
        password=config.smtp_password,
        use_tls=config.smtp_use_tls,
        use_ssl=config.smtp_use_ssl,
        timeout=20,
    )


def remetente(config: SystemConfig) -> str:
    return config.email_from.strip() or settings.DEFAULT_FROM_EMAIL


def _paragrafos(texto: str) -> str:
    """Texto simples → parágrafos HTML: escapa tudo e só depois transforma
    URLs em links, para o link ser o único HTML que vem do texto."""
    blocos = []
    for bloco in texto.replace("\r\n", "\n").split("\n\n"):
        if not bloco.strip():
            continue
        seguro = escape(bloco).replace("\n", "<br>")
        seguro = _URL.sub(
            lambda m: f'<a href="{m.group(0)}" style="color:#2563eb;">{m.group(0)}</a>', seguro
        )
        blocos.append(f'<p style="margin:0 0 12px;">{seguro}</p>')
    return "".join(blocos)


def montar_html(modelo: str, *, assunto: str, texto: str) -> str:
    """Preenche os marcadores do modelo do admin. Substituição literal, não
    engine de template: o admin controla o modelo, o sistema controla o
    conteúdo, e nenhum dos dois consegue executar nada no outro."""
    return (
        modelo.replace("{{assunto}}", escape(assunto))
        .replace("{{conteudo}}", _paragrafos(texto))
        .replace("{{ano}}", str(timezone.now().year))
    )


def enviar(*, to: str, subject: str, body: str, config: SystemConfig | None = None) -> None:
    """Envia AGORA pela conexão configurada. Levanta `EmailDesligado` com a
    entrega desligada, e deixa subir o erro do SMTP — quem chama decide se
    registra falha (outbox) ou mostra na tela (e-mail de teste)."""
    config = config or SystemConfig.load()
    if not config.email_enabled:
        raise EmailDesligado("Entrega de e-mail desligada em Configurações → Sistema.")
    mensagem = EmailMultiAlternatives(
        subject=subject,
        body=body,
        from_email=remetente(config),
        to=[to],
        reply_to=[settings.EMAIL_REPLY_TO],
        connection=conexao(config),
    )
    if config.email_html_template.strip():
        mensagem.attach_alternative(
            montar_html(config.email_html_template, assunto=subject, texto=body), "text/html"
        )
    mensagem.send(fail_silently=False)
