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


_ESTILO_P = "margin:0 0 12px;"
# Link na cor do texto, sublinhado — a mesma leitura da tela (uma cor de ação
# só; o azul antigo era a segunda). Ver `formatacao._ESTILO_LINK`.
_ESTILO_LINK = "color:#242424;text-decoration:underline;"
# Trecho escrito por uma pessoa (nota citada num aviso de menção): recuado e
# com um fio à esquerda, para não se confundir com o texto do sistema.
_ESTILO_CITACAO = "margin:0 0 12px;padding:2px 0 2px 12px;border-left:2px solid #e5e4e2;"


def _paragrafos(texto: str) -> str:
    """Texto simples → parágrafos HTML: escapa tudo e só depois transforma
    URLs em links, para o link ser o único HTML que vem do texto."""
    blocos = []
    for bloco in texto.replace("\r\n", "\n").split("\n\n"):
        if not bloco.strip():
            continue
        seguro = escape(bloco).replace("\n", "<br>")
        seguro = _URL.sub(
            lambda m: f'<a href="{m.group(0)}" style="{_ESTILO_LINK}">{m.group(0)}</a>', seguro
        )
        blocos.append(f'<p style="{_ESTILO_P}">{seguro}</p>')
    return "".join(blocos)


def montar_html(
    modelo: str,
    *,
    assunto: str,
    texto: str,
    extra_html: str = "",
    trechos_html: dict[str, str] | None = None,
) -> str:
    """Preenche os marcadores do modelo do admin. Substituição literal, não
    engine de template: o admin controla o modelo, o sistema controla o
    conteúdo, e nenhum dos dois consegue executar nada no outro.

    `trechos_html` é o texto que uma PESSOA escreveu com a formatação leve
    (ver `formatacao.py`), já convertido e higienizado: `texto` chega com uma
    marca inerte no lugar de cada trecho, passa pelo mesmo escape de sempre, e
    só depois a marca é trocada pelo HTML pronto — o escape nunca vê o HTML e
    o HTML nunca vê o texto cru.
    """
    conteudo = _paragrafos(texto)
    for marca, trecho in (trechos_html or {}).items():
        sozinha = f'<p style="{_ESTILO_P}">{marca}</p>'
        if sozinha in conteudo:
            # parágrafo só dele: vira um bloco citado (pode ter lista)
            conteudo = conteudo.replace(sozinha, f'<div style="{_ESTILO_CITACAO}">{trecho}</div>')
        else:
            # no meio de uma frase não cabe bloco: fica só a formatação em linha
            em_linha = re.sub(r"</(?:p|li)>(?!$)", "<br>", trecho)
            em_linha = re.sub(r"</?(?:p|ul|ol|li)\b[^>]*>", "", em_linha)
            conteudo = conteudo.replace(marca, em_linha)
    if extra_html:
        # `extra_html` é a assinatura do agente, JÁ higienizada na gravação
        # (apps/accounts/assinatura.py) — é o único HTML que entra aqui sem
        # passar pelo escape, e por isso ele nunca vem do corpo da mensagem.
        conteudo += f'<div style="margin:16px 0 0;">{extra_html}</div>'
    return (
        modelo.replace("{{assunto}}", escape(assunto))
        .replace("{{conteudo}}", conteudo)
        .replace("{{ano}}", str(timezone.now().year))
    )


def enviar(
    *,
    to: str,
    subject: str,
    body: str,
    config: SystemConfig | None = None,
    html_extra: str = "",
    corpo_html: str | None = None,
    trechos_html: dict[str, str] | None = None,
) -> None:
    """Envia AGORA pela conexão configurada. Levanta `EmailDesligado` com a
    entrega desligada, e deixa subir o erro do SMTP — quem chama decide se
    registra falha (outbox) ou mostra na tela (e-mail de teste).

    `body` é a parte de TEXTO PURO. Quando o e-mail carrega texto formatado de
    uma pessoa, `corpo_html` é o mesmo molde com marcas no lugar desses
    trechos e `trechos_html` diz o que entra em cada marca (ver `montar_html`).
    """
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
            montar_html(
                config.email_html_template,
                assunto=subject,
                texto=body if corpo_html is None else corpo_html,
                extra_html=html_extra,
                trechos_html=trechos_html,
            ),
            "text/html",
        )
    mensagem.send(fail_silently=False)
