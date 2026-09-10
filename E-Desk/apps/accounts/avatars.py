"""Avatar do usuário: os prontos do sistema e o enviado do computador.

Três caminhos possíveis para `User.avatar_url`, e o serializer só aceita estes:

1. `/avatars/avatar-03-laranja.svg` — um dos prontos, estático do front;
2. `/api/v1/avatars/<nome>.png` — o que a pessoa enviou, guardado no MEDIA_ROOT;
3. `https://…` — uma foto de fora (o avatar do Google, por exemplo).

**O arquivo enviado nunca é servido como veio.** Ele é aberto pelo Pillow,
recortado no quadrado, redimensionado e gravado de novo como PNG — o que sai é
byte gerado por nós. Isso é o que mata a classe inteira de arquivo-poliglota
(a imagem que também é HTML, ou o PNG com script no metadado): o conteúdo
original não sobrevive à recodificação. SVG é recusado justamente por não
passar por esse moedor — ele é texto, pode conter `<script>`, e um SVG que a
gente reescrevesse ainda seria SVG.

Isto substitui a decisão anterior ("foto por URL, não upload"). Ela existia
para não abrir um endpoint de mídia só por causa de avatar; com o pedido de
escolher ou enviar, o endpoint passou a se justificar — e ele é bem mais
estreito que o de anexos (D13): um arquivo por pessoa, 2 MB, sempre reescrito.
"""

from __future__ import annotations

import re
import secrets
from pathlib import Path

from django.conf import settings
from PIL import Image, UnidentifiedImageError

MAX_BYTES = 2 * 1024 * 1024
LADO = 256
PREFIXO = "/api/v1/avatars/"
NOME_VALIDO = re.compile(r"^[0-9a-f]{32}\.png$")
PRONTOS = re.compile(r"^/avatars/avatar-0[1-8]-[a-z-]{3,30}\.svg$")


class AvatarInvalido(Exception):
    pass


def pasta() -> Path:
    caminho = Path(settings.MEDIA_ROOT) / "avatars"
    caminho.mkdir(parents=True, exist_ok=True)
    return caminho


def caminho_de(nome: str) -> Path | None:
    """Resolve o nome do arquivo. Nome fora do formato = não existe.

    O formato é estreito de propósito (32 hex + .png): não há como escrever
    `../` dentro dele, então travessia de diretório não é uma preocupação
    que dependa de eu lembrar de checar.
    """
    if not NOME_VALIDO.match(nome or ""):
        return None
    arquivo = pasta() / nome
    return arquivo if arquivo.is_file() else None


def guardar(user, enviado) -> str:
    """Recodifica e grava. Devolve a URL para pôr em `avatar_url`."""
    if enviado.size > MAX_BYTES:
        raise AvatarInvalido(
            f"A imagem tem {enviado.size // 1024} KB; o limite é "
            f"{MAX_BYTES // 1024} KB. Reduza e envie de novo."
        )

    try:
        imagem = Image.open(enviado)
        imagem.verify()          # detecta arquivo corrompido/forjado…
        enviado.seek(0)
        imagem = Image.open(enviado)  # …e o verify() invalida o objeto: reabre
        imagem.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise AvatarInvalido(
            "Não consegui ler esse arquivo como imagem. Use PNG, JPEG ou WebP."
        ) from exc

    if imagem.format not in {"PNG", "JPEG", "WEBP"}:
        raise AvatarInvalido(
            f"Formato {imagem.format or 'desconhecido'} não aceito. "
            "Use PNG, JPEG ou WebP."
        )

    imagem = _quadrado(imagem.convert("RGB")).resize((LADO, LADO), Image.LANCZOS)

    nome = f"{secrets.token_hex(16)}.png"
    imagem.save(pasta() / nome, "PNG", optimize=True)
    apagar(user)  # troca de avatar não deixa o anterior ocupando disco
    return f"{PREFIXO}{nome}"


def _quadrado(imagem: Image.Image) -> Image.Image:
    """Recorte central. Esticar deformaria o rosto — cortar não."""
    largura, altura = imagem.size
    lado = min(largura, altura)
    esquerda = (largura - lado) // 2
    topo = (altura - lado) // 2
    return imagem.crop((esquerda, topo, esquerda + lado, topo + lado))


def apagar(user) -> None:
    """Remove o arquivo do avatar atual, se ele for um envio nosso."""
    atual = user.avatar_url or ""
    if not atual.startswith(PREFIXO):
        return
    arquivo = caminho_de(atual[len(PREFIXO):])
    if arquivo:
        arquivo.unlink(missing_ok=True)


def aceitavel(valor: str) -> bool:
    """Os três caminhos do topo do módulo — e nada além deles."""
    if not valor:
        return True
    if PRONTOS.match(valor):
        return True
    if valor.startswith(PREFIXO):
        return bool(NOME_VALIDO.match(valor[len(PREFIXO):]))
    return valor.startswith("https://") or valor.startswith("http://")
