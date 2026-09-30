"""Marca da tela de login: o painel azul, por público (cliente e equipe).

Os textos e a imagem vivem no banco (`LoginBranding`) e o admin edita em
Configurações → Tela de login. A tela de login é anônima, então a leitura é
pública (`/branding/login/`); a escrita é do admin, como o resto de
`settings/*`.

A imagem segue a mesma disciplina do avatar: nunca é servida como veio.
Abre no Pillow, redimensiona ao lado máximo e regrava como JPEG — o que sai é
byte gerado por nós, e SVG (texto, pode carregar script) não passa.
"""

from __future__ import annotations

import re
import secrets
from pathlib import Path

from django.conf import settings
from PIL import Image, UnidentifiedImageError

AUDIENCIAS = ("cliente", "equipe")
MAX_BYTES = 5 * 1024 * 1024
LADO_MAXIMO = 1800
NOME_VALIDO = re.compile(r"^[0-9a-f]{32}\.jpg$")

#: O que a tela mostra enquanto ninguém personalizou — e o que o botão
#: "restaurar padrão" devolve. Três destaques por público, na ordem dos
#: ícones fixos da tela (chamados, chat, ajuda/segurança).
PADRAO = {
    "cliente": {
        "brand_name": "Central de Suporte",
        "headline": "Seu suporte, no seu tempo.",
        "subtitle": "Acompanhe seus tickets, fale com a equipe e avalie o atendimento.",
        "highlights": [
            "Abra tickets e acompanhe cada resposta, com prazo à vista.",
            "Converse por chat com quem atende, no horário de atendimento.",
            "Resolva sozinho com a Central de Ajuda, a qualquer hora.",
        ],
    },
    "equipe": {
        "brand_name": "Resolv",
        "headline": "Tudo que a equipe precisa, num lugar só.",
        "subtitle": "A fila, o chat e os indicadores da equipe.",
        "highlights": [
            "Fila de tickets com SLA, triagem e quadro por etapa.",
            "Chat em tempo real com transferência e conversão em ticket.",
            "Auditoria, LGPD e verificação em duas etapas por conta.",
        ],
    },
}


class ImagemInvalida(Exception):
    pass


def pasta() -> Path:
    caminho = Path(settings.MEDIA_ROOT) / "marca"
    caminho.mkdir(parents=True, exist_ok=True)
    return caminho


def caminho_de(nome: str) -> Path | None:
    """Nome fora do formato (32 hex + .jpg) = não existe: sem `../` possível."""
    if not NOME_VALIDO.match(nome or ""):
        return None
    arquivo = pasta() / nome
    return arquivo if arquivo.is_file() else None


def guardar_imagem(enviado) -> str:
    """Recodifica e grava. Devolve o nome do arquivo para `image_name`."""
    if enviado.size > MAX_BYTES:
        raise ImagemInvalida(
            f"A imagem tem {enviado.size // 1024 // 1024} MB; o limite é "
            f"{MAX_BYTES // 1024 // 1024} MB. Reduza e envie de novo."
        )
    try:
        imagem = Image.open(enviado)
        imagem.verify()
        enviado.seek(0)
        imagem = Image.open(enviado)
        imagem.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ImagemInvalida(
            "Não consegui ler esse arquivo como imagem. Use PNG, JPEG ou WebP."
        ) from exc
    if imagem.format not in {"PNG", "JPEG", "WEBP"}:
        raise ImagemInvalida(
            f"Formato {imagem.format or 'desconhecido'} não aceito. Use PNG, JPEG ou WebP."
        )

    imagem = imagem.convert("RGB")
    imagem.thumbnail((LADO_MAXIMO, LADO_MAXIMO), Image.LANCZOS)
    nome = f"{secrets.token_hex(16)}.jpg"
    imagem.save(pasta() / nome, "JPEG", quality=85, optimize=True)
    return nome


def apagar_imagem(nome: str) -> None:
    arquivo = caminho_de(nome)
    if arquivo:
        arquivo.unlink(missing_ok=True)
