"""Passo 4 da fusão: os DADOS do departamento passam para a equipe.

Cada `Department` vira (ou entra em) uma `Team`, e tudo que apontava para o
departamento passa a apontar para ela: ticket, política de SLA, vínculo do
agente, sessão de chat e quadro do kanban. Nada é apagado aqui — as colunas
antigas continuam preenchidas até `0013_departamento_sai_de_cena`, para que um
erro nesta etapa seja visível antes de ser irreversível.

**Como uma Department encontra sua Team (regra determinística, nesta ordem):**

1. `department.default_team` — se o admin já declarou qual equipe corresponde
   ao departamento, essa declaração é a intenção mais explícita que existe;
2. mesma `slug`;
3. mesmo `name` (sem diferenciar maiúsculas);
4. nada bateu → cria uma equipe nova com o nome e a slug do departamento.

Quando o departamento entra numa equipe que JÁ EXISTIA, quem sobrevive como
identidade é a EQUIPE: nome e slug ficam os dela. A razão é prática — a equipe
já é referenciada por avisos segmentados, quadros e pela lotação dos usuários,
e trocar a slug dela quebraria links e filtros salvos. O que vem do
departamento são os campos de configuração, que a equipe não tinha nenhum.

Duas Departments nunca caem na mesma Team: a segunda ganha um sufixo numérico.
Fundi-las silenciosamente juntaria os tickets de dois departamentos num escopo
de visibilidade só — exatamente o erro que esta refatoração não pode cometer.
"""

from django.db import migrations, models

# o que a equipe herda do departamento; nome, slug e is_active têm regra própria
CAMPOS_HERDADOS = (
    "order",
    "visibility",
    "mask_subject_for_others",
    "internal_only",
    "chat_calendar_id",
    "notification_email",
    "description",
)


def _nome_e_slug_livres(Team, nome: str, slug: str) -> tuple[str, str]:
    """Primeiro par (nome, slug) que ainda não existe, com sufixo numérico."""
    candidato_nome, candidato_slug = nome[:80], slug[:50]
    n = 2
    while Team.objects.filter(
        models.Q(name=candidato_nome) | models.Q(slug=candidato_slug)
    ).exists():
        sufixo = f"-{n}"
        candidato_nome = f"{nome[:80 - len(sufixo)]}{sufixo}"
        candidato_slug = f"{slug[:50 - len(sufixo)]}{sufixo}"
        n += 1
    return candidato_nome, candidato_slug


def _equipe_de(Team, departamento, ja_usadas: set[int]):
    """Aplica a regra de correspondência descrita no topo do módulo."""
    candidatas = []
    if departamento.default_team_id:
        candidatas.append(Team.objects.filter(pk=departamento.default_team_id).first())
    candidatas.append(Team.objects.filter(slug=departamento.slug).first())
    candidatas.append(Team.objects.filter(name__iexact=departamento.name).first())

    for equipe in candidatas:
        if equipe is not None and equipe.pk not in ja_usadas:
            return equipe

    nome, slug = _nome_e_slug_livres(Team, departamento.name, departamento.slug)
    return Team(name=nome, slug=slug, is_active=departamento.is_active)


def fundir(apps, schema_editor):
    Department = apps.get_model("tickets", "Department")
    Team = apps.get_model("accounts", "Team")
    Ticket = apps.get_model("tickets", "Ticket")
    SLAPolicy = apps.get_model("tickets", "SLAPolicy")
    AgentDepartment = apps.get_model("accounts", "AgentDepartment")
    ChatSession = apps.get_model("chat", "ChatSession")
    Board = apps.get_model("kanban", "Board")

    ja_usadas: set[int] = set()

    for departamento in Department.objects.order_by("pk"):
        equipe = _equipe_de(Team, departamento, ja_usadas)
        for campo in CAMPOS_HERDADOS:
            setattr(equipe, campo, getattr(departamento, campo))
        # Só continua ativa se as duas pontas estavam: um departamento
        # desativado significa "ninguém abre chamado aqui", e reabri-lo por
        # efeito colateral da fusão seria decidir no lugar do administrador.
        equipe.is_active = bool(equipe.is_active and departamento.is_active)
        equipe.save()
        ja_usadas.add(equipe.pk)

        Ticket.objects.filter(department_id=departamento.pk).update(team_id=equipe.pk)
        SLAPolicy.objects.filter(department_id=departamento.pk).update(team_id=equipe.pk)
        AgentDepartment.objects.filter(department_id=departamento.pk).update(
            team_id=equipe.pk
        )
        ChatSession.objects.filter(department_id=departamento.pk).update(
            team_id=equipe.pk
        )
        # O quadro tinha as duas colunas, mas só `department` recortava os
        # tickets — `team` era rótulo sem efeito. Vence quem tinha efeito.
        Board.objects.filter(department_id=departamento.pk).update(team_id=equipe.pk)

    # Rede de proteção: se sobrou alguma linha sem equipe, a migração para aqui
    # em vez de seguir para o passo que APAGA a coluna de origem.
    orfaos = {
        "tickets": Ticket.objects.filter(team__isnull=True).count(),
        "políticas de SLA": SLAPolicy.objects.filter(
            department__isnull=False, team__isnull=True
        ).count(),
        "vínculos de agente": AgentDepartment.objects.filter(team__isnull=True).count(),
        "sessões de chat": ChatSession.objects.filter(team__isnull=True).count(),
        "quadros": Board.objects.filter(
            department__isnull=False, team__isnull=True
        ).count(),
    }
    sobras = {rotulo: n for rotulo, n in orfaos.items() if n}
    if sobras:
        raise RuntimeError(
            f"Fusão departamento→equipe incompleta, nada foi apagado: {sobras}"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0011_slapolicy_team"),
        ("accounts", "0007_equipe_absorve_departamento"),
        ("chat", "0004_chatsession_team"),
        ("kanban", "0003_soltar_fixacoes_em_coluna_de_status"),
    ]

    operations = [
        # Sem volta: as colunas antigas ainda existem depois desta migração, mas
        # desfazer a fusão exigiria saber quais equipes existiam antes dela.
        migrations.RunPython(fundir, migrations.RunPython.noop),
    ]
