"""Transcrição da conversa em PDF — do chamado e do chat.

Para que serve: o cliente precisa levar a conversa para fora do sistema —
anexar a um processo, mandar para o contador, guardar antes de um expurgo.
Copiar e colar da tela perde o que é ordem, quem falou e quando.

Três decisões que valem registro:

- **O texto é ESCAPADO, sempre.** O corpo da mensagem é escrito por gente:
  um `<` sozinho já quebraria a montagem, e `<script>` ou `<style>` num PDF
  montado no servidor é injeção de marcação num documento que a pessoa vai
  distribuir. `_e()` passa em cada pedaço de conteúdo — não há caminho que
  interpole conteúdo direto no HTML.

- **Só mensagem PÚBLICA.** Nota interna não entra, nem para interno: uma
  transcrição é feita para sair do sistema, e o que sai não pode carregar o
  que a equipe escreveu entre si. É o mesmo corte que a tela do cliente já
  faz — aqui ele é repetido de propósito, porque o destino do arquivo é
  fora do controle de quem o gerou.

- **WeasyPrint é extra opcional** (`.[reports]`), como no resto do projeto.
  Ausente, a falha é explícita — nunca um PDF vazio ou um 500 sem causa.
"""

from html import escape

from django.utils import timezone

#: Cores em hex, não em `var(--…)`: o PDF é montado no servidor e não enxerga
#: as CSS vars do frontend. Os valores vêm do tema do portal.
_ESTILO = """
@page { size: A4; margin: 16mm 14mm; }
body { font-family: Helvetica, Arial, sans-serif; color: #1a1917; font-size: 10pt;
       line-height: 1.5; }
h1 { font-size: 15pt; margin: 0 0 1mm; letter-spacing: -0.2pt; }
.ref { color: #726c64; font-size: 9pt; margin: 0 0 1mm; }
.meta { color: #6b665e; font-size: 9pt; margin: 0 0 8mm; }
.msg { border: 0.4pt solid #e5e0d8; border-radius: 3mm; padding: 4mm 5mm;
       margin-bottom: 4mm; }
.msg--propria { background: #f6f5f3; }
.cab { font-size: 9pt; margin-bottom: 2mm; }
.quem { font-weight: bold; }
.quando { color: #726c64; float: right; }
.corpo { white-space: pre-wrap; }
.anexos { color: #6b665e; font-size: 8.5pt; margin-top: 2mm; }
.marco { text-align: center; color: #726c64; font-size: 8.5pt; margin: 4mm 0; }
.msg--nota { border-left: 1.2mm solid #8a5d0f; background: #fdf8ec; }
.selo { color: #8a5d0f; font-weight: bold; font-size: 8pt;
        text-transform: uppercase; letter-spacing: 0.3pt; }
.rodape { color: #726c64; font-size: 8pt; margin-top: 10mm;
          border-top: 0.4pt solid #e5e0d8; padding-top: 3mm; }
"""


def _e(valor) -> str:
    """Escapa qualquer coisa que vá para o HTML. Nada de conteúdo entra sem
    passar por aqui — ver a segunda decisão no cabeçalho do módulo."""
    return escape("" if valor is None else str(valor), quote=True)


def _quando(dt) -> str:
    if dt is None:
        return ""
    return timezone.localtime(dt).strftime("%d/%m/%Y, %H:%M")


def _render(html: str) -> bytes:
    try:
        from weasyprint import HTML
    except ImportError as exc:  # pragma: no cover — depende do extra
        raise RuntimeError(
            "Exportar a conversa em PDF exige o extra 'reports' "
            "(pip install '.[reports]')."
        ) from exc
    return HTML(string=html).write_pdf()


def _documento(titulo: str, ref: str, meta: str, blocos: str, *, com_notas=False) -> str:
    """O rodapé é uma AFIRMAÇÃO sobre o conteúdo do arquivo, e por isso muda
    quando o conteúdo muda. Um PDF com notas internas carimbado "contém apenas
    mensagens públicas" é o tipo de arquivo que alguém encaminha ao cliente
    confiando no rodapé."""
    agora = timezone.localtime().strftime("%d/%m/%Y às %H:%M")
    aviso = (
        "CONTÉM NOTAS INTERNAS — documento de uso interno, não envie ao cliente."
        if com_notas
        else "Contém apenas mensagens públicas."
    )
    return (
        f'<html><head><meta charset="utf-8"><style>{_ESTILO}</style></head><body>'
        f'<p class="ref">{ref}</p>'
        f"<h1>{titulo}</h1>"
        f'<p class="meta">{meta}</p>'
        f"{blocos}"
        f'<p class="rodape">Transcrição gerada em {agora}. {aviso}</p>'
        f"</body></html>"
    )


def _bloco(autor: str, quando, corpo: str, *, propria: bool, anexos=(), nota=False) -> str:
    classe = "msg msg--nota" if nota else ("msg msg--propria" if propria else "msg")
    linha_anexos = ""
    if anexos:
        nomes = ", ".join(_e(a) for a in anexos)
        linha_anexos = f'<p class="anexos">Anexos: {nomes}</p>'
    # o selo é TEXTO, não só a barra lateral: impresso em preto e branco, ou
    # relido meses depois, a cor não sobrevive e a frase sobrevive
    selo = '<span class="selo">Nota interna</span> · ' if nota else ""
    return (
        f'<div class="{classe}">'
        f'<p class="cab">{selo}<span class="quem">{_e(autor)}</span>'
        f'<span class="quando">{_e(_quando(quando))}</span></p>'
        f'<div class="corpo">{_e(corpo)}</div>'
        f"{linha_anexos}"
        f"</div>"
    )


def ticket_pdf(ticket, *, para) -> tuple[bytes, str]:
    """Transcrição de um chamado. `para` é quem pediu — decide o que é "sua"
    mensagem, não o que pode ser lido (isso a view já resolveu)."""
    partes = [
        _bloco(
            "Você" if m.author_id == para.pk else m.author.full_name,
            m.created_at,
            "Mensagem apagada." if m.is_deleted else m.body,
            propria=m.author_id == para.pk,
            anexos=[a.filename for a in m.attachments.all()],
        )
        for m in ticket.messages.filter(is_public=True)
        .select_related("author")
        .prefetch_related("attachments")
        .order_by("created_at")
    ]
    if ticket.closed_at:
        partes.append(
            f'<p class="marco">Chamado resolvido em {_e(_quando(ticket.closed_at))}.</p>'
        )

    meta = f"Aberto em {_quando(ticket.created_at)} · {ticket.company.name}"
    if ticket.order_number:
        meta += f" · pedido {ticket.order_number}"
    html = _documento(_e(ticket.subject), _e(ticket.reference), _e(meta), "".join(partes))
    return _render(html), f"{ticket.reference}.pdf"


def chat_pdf(mensagens, sessoes, *, para) -> tuple[bytes, str]:
    """Transcrição da conversa contínua do cliente com o atendimento.

    Recebe o que a timeline já costurou (`chat_service.timeline`) em vez de
    consultar de novo: a costura de sessões é a regra de leitura do portal e
    duplicá-la aqui abriria espaço para as duas discordarem.

    `sessoes` são os OBJETOS `Chat`, não o serializer deles: serializado,
    `closed_at` vira string ISO e a formatação de data quebraria — e passar
    pelo serializer só para reler o que o modelo já tem é caminho a mais.
    """
    from apps.chat.services import chat_service

    encerramentos = {c.pk: c.closed_at for c in sessoes if c.closed_at}
    partes = []
    vista = set()
    for m in mensagens:
        # Estes três não são campos do modelo — são o que o serializer do chat
        # calcula na leitura. Repetidos aqui pela MESMA fonte de propósito:
        # `censor` sobretudo, senão o PDF sairia com o palavrão que a tela
        # esconde, e a exportação viraria a porta dos fundos da moderação.
        interno = bool(m.author and m.author.is_internal)
        apagada = m.deleted_at is not None
        corpo = "Mensagem apagada." if apagada else chat_service.censor(m.body)

        if m.is_system:
            partes.append(f'<p class="marco">{_e(corpo)}</p>')
        else:
            partes.append(
                _bloco(
                    (m.author.full_name if interno and m.author else None)
                    or ("Atendimento" if interno else "Você"),
                    m.sent_at,
                    corpo,
                    propria=not interno,
                    anexos=[f.filename for f in m.files.all()],
                )
            )
        # o fim de cada atendimento entra assim que a última mensagem dele passa
        if m.chat_id in encerramentos and m.chat_id not in vista:
            vista.add(m.chat_id)

    for chat_id, fechado_em in encerramentos.items():
        if chat_id in vista:
            partes.append(
                f'<p class="marco">Atendimento encerrado em {_e(_quando(fechado_em))}.</p>'
            )

    meta = f"{para.company.name if para.company else ''} · conversa com o atendimento"
    html = _documento(
        "Conversa com o atendimento", "", _e(meta.strip(" ·")), "".join(partes)
    )
    return _render(html), "conversa-com-o-atendimento.pdf"


def atendimento_pdf(chat, mensagens, *, para, com_notas: bool) -> tuple[bytes, str]:
    """Transcrição de UM atendimento, para quem ATENDE.

    Irmã de `chat_pdf`, que é a conversa contínua do cliente. São duas porque
    o recorte e o público são outros: aqui é um atendimento só, com a ficha
    dele no topo (protocolo, espera, duração, desfecho, nota) e a opção de
    levar as notas internas junto.

    `com_notas` é decisão de QUEM EXPORTA, e chega aqui já resolvida — a view
    é que sabe se quem pediu é interno. Com notas, o documento se identifica
    como interno no rodapé e cada nota leva o selo escrito: o arquivo sai do
    sistema e ninguém controla para onde vai depois, então ele precisa dizer
    o que é sem depender de quem o abriu lembrar.
    """
    from apps.chat.services import chat_service

    partes = []
    for m in mensagens:
        interno = bool(m.author and m.author.is_internal)
        apagada = m.deleted_at is not None
        corpo = "Mensagem apagada." if apagada else chat_service.censor(m.body)
        if m.is_system:
            partes.append(f'<p class="marco">{_e(corpo)}</p>')
            continue
        partes.append(
            _bloco(
                (m.author.full_name if m.author else "Sistema"),
                m.sent_at,
                corpo,
                propria=not interno,
                anexos=[f.filename for f in m.files.all()],
                nota=m.is_internal_note,
            )
        )

    html = _documento(
        f"Atendimento #{chat.pk}",
        _e(f"{chat.client.full_name} · {chat.company.name if chat.company else ''}".strip(" ·")),
        _e(_ficha(chat)),
        "".join(partes),
        com_notas=com_notas,
    )
    return _render(html), f"atendimento-{chat.pk}.pdf"


def _ficha(chat) -> str:
    """A linha de contexto do topo: o que alguém precisa saber sobre este
    atendimento antes de ler a conversa."""
    pedacos = []
    if chat.accepted_at and chat.queued_at:
        pedacos.append(f"espera {_duracao(chat.queued_at, chat.accepted_at)}")
    if chat.closed_at and chat.accepted_at:
        pedacos.append(f"duração {_duracao(chat.accepted_at, chat.closed_at)}")
    if chat.agent:
        pedacos.append(f"atendido por {chat.agent.full_name}")
    if chat.close_reason_id:
        pedacos.append(f"desfecho: {chat.close_reason.name}")
    if chat.closed_automatically:
        pedacos.append("encerrado automaticamente")
    avaliacao = getattr(chat, "rating", None)
    if avaliacao:
        pedacos.append(
            f"nota {avaliacao.service_score}/{avaliacao.resolution_score}"
        )
    return " · ".join(pedacos)


def _duracao(inicio, fim) -> str:
    minutos = int((fim - inicio).total_seconds() // 60)
    if minutos < 60:
        return f"{minutos} min"
    return f"{minutos // 60}h{minutos % 60:02d}"
