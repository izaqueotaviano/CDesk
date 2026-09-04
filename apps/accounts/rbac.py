"""RBAC — o catálogo de permissões e o mapa papel → permissões.

**Este módulo é a única fonte de verdade sobre "quem pode o quê".** Todo o
resto do sistema (permission classes da API, policies de domínio,
`visible_to()`, o payload de `/auth/me/`) consulta daqui em vez de testar
papel na mão. A regra prática: se você escrever `if user.internal_role ==`
fora deste arquivo, é bug — o papel deixa de ser configuração e vira código
espalhado, que é exatamente o que este módulo existe para impedir.

Inspirado no Zendesk Support, com uma diferença deliberada: lá, papel é um
registro do banco desde o começo; aqui os papéis EMBUTIDOS são constantes
(`InternalRole`) e as permissões são declaradas em código, porque permissão
não é dado de usuário — é contrato da aplicação. Uma tabela `Permission`
precisaria de uma migração toda vez que uma tela nova nascesse, e ainda
poderia divergir do código que a consome. `CustomRole` (ver models.py) é o
que dá liberdade ao cliente: ele COMBINA as permissões deste catálogo, nunca
inventa uma nova.

Três camadas consomem este módulo, e a ordem importa:

1. `HasPerm` (apps/core/permissions.py) — porta da API. Recusa cedo, com 403.
2. Policies de domínio (`Ticket.can_reply_publicly`, `ticket_service.*`) —
   a regra de negócio de verdade, que vale mesmo se alguém chamar o serviço
   por fora da API (management command, worker, shell).
3. `visible_to()` — o escopo de LEITURA, que não é um booleano e por isso
   mora em `TicketScope`, não em `Perm`.

Camada 1 sem camada 2 é uma tranca na porta da frente com a janela aberta.
"""

from django.db import models


class Perm(models.TextChoices):
    """Catálogo fechado de permissões.

    O nome é `área.ação` de propósito: agrupa sozinho na tela de papéis e
    deixa óbvio onde procurar quem consome. Acrescentar uma permissão é
    acrescentar uma linha aqui e concedê-la em `ROLE_PERMISSIONS` — nada de
    migração, porque o valor guardado em `CustomRole.permissions` é a
    string, e uma permissão desconhecida é simplesmente ignorada na leitura
    (ver `permissions_for`).
    """

    # --- acesso ao painel interno -----------------------------------------
    PANEL_ACCESS = "panel.access", "Acessar o painel de atendimento"

    # --- tickets ----------------------------------------------------------
    TICKET_VIEW = "ticket.view", "Ver tickets (dentro do escopo do papel)"
    TICKET_REPLY_PUBLIC = "ticket.reply_public", "Responder publicamente ao cliente"
    TICKET_ADD_INTERNAL_NOTE = "ticket.add_internal_note", "Adicionar nota interna"
    # Governa ser RESPONSÁVEL (assignee) e DONO TÉCNICO (owner): os dois são
    # atribuição — criam evento no histórico e notificam a pessoa. Se um dia
    # for preciso separar (o caso real seria um colaborador de engenharia que
    # pode ser dono técnico sem atender o cliente), nasce `TICKET_BE_OWNER`
    # aqui e `ticket_service.set_owner` passa a olhar para ela — uma linha em
    # cada lugar, justamente porque a declaração está centralizada.
    TICKET_BE_ASSIGNED = "ticket.be_assigned", "Ser responsável por tickets"
    TICKET_EDIT_PROPERTIES = (
        "ticket.edit_properties",
        "Editar propriedades do ticket (prioridade, categoria, equipe, etiquetas)",
    )
    TICKET_CLOSE = "ticket.close", "Fechar e reabrir tickets"
    TICKET_BULK_ACTIONS = "ticket.bulk_actions", "Ações em lote na fila"

    # --- chat -------------------------------------------------------------
    CHAT_VIEW = "chat.view", "Ver a fila de chat"
    CHAT_HANDLE = "chat.handle", "Atender, transferir e encerrar chats"

    # --- kanban -----------------------------------------------------------
    KANBAN_VIEW = "kanban.view", "Ver o quadro"
    KANBAN_MOVE = "kanban.move", "Mover cartões e definir prazo interno"

    # --- empresas e clientes ---------------------------------------------
    COMPANY_VIEW = "company.view", "Ver empresas e cotas"
    COMPANY_MANAGE = "company.manage", "Cadastrar e editar empresas e planos"

    # --- relatórios -------------------------------------------------------
    REPORT_VIEW = "report.view", "Ver relatórios e indicadores"
    REPORT_EXPORT = "report.export", "Exportar relatórios"

    # --- base de conhecimento --------------------------------------------
    KNOWLEDGE_VIEW = "knowledge.view", "Ler a base de conhecimento"
    KNOWLEDGE_MANAGE = "knowledge.manage", "Escrever na base de conhecimento"

    # --- macros e visões --------------------------------------------------
    MACRO_USE = "macro.use", "Aplicar macros"
    MACRO_MANAGE = "macro.manage", "Criar e editar macros da equipe"

    # --- administração ----------------------------------------------------
    SETTINGS_MANAGE = "settings.manage", "Gerenciar configurações do sistema"
    USER_MANAGE = "user.manage", "Gerenciar usuários, papéis e equipes"
    ANNOUNCEMENT_MANAGE = "announcement.manage", "Publicar avisos"
    AUDIT_VIEW = "audit.view", "Ver auditoria e atender pedidos de LGPD"
    ROLE_MANAGE = "role.manage", "Criar e editar papéis personalizados"

    # --- portal do cliente ------------------------------------------------
    # Separadas das de ticket de propósito: o cliente age sobre os PRÓPRIOS
    # tickets, um escopo que `TicketScope` nem descreve (ele é interno). Ter
    # permissões próprias evita conceder `TICKET_VIEW` a um cliente e alguém
    # concluir, mais tarde, que ele enxerga a fila.
    PORTAL_ACCESS = "portal.access", "Acessar o portal do cliente"
    PORTAL_TICKET_CREATE = "portal.ticket_create", "Abrir tickets pelo portal"
    PORTAL_TICKET_REPLY = "portal.ticket_reply", "Responder os próprios tickets"
    PORTAL_COMPANY_USERS = "portal.company_users", "Gerenciar os usuários da própria empresa"


class TicketScope(models.TextChoices):
    """QUANTO da fila o usuário interno enxerga.

    Não é uma permissão: permissão é sim/não, escopo é um recorte de
    linhas — e recorte de linha só existe num lugar (`visible_to`). Misturar
    os dois em `Perm` levaria a `ticket.view_all` vs `ticket.view_team`
    mutuamente exclusivos, com a pergunta "e se as duas estiverem marcadas?"
    sem resposta boa.
    """

    ALL = "all", "Todos os tickets"
    TEAMS = "teams", "Apenas os das suas equipes"
    ASSIGNED = "assigned", "Apenas os atribuídos a ele"


# --------------------------------------------------------------------------- #
# Papéis embutidos
# --------------------------------------------------------------------------- #
#
# `ROLE_PERMISSIONS` é a matriz inteira do produto num lugar só — dá para ler
# de cima a baixo e responder "o que muda entre agente e agente leve?" sem
# abrir mais nada. Os papéis vivem em `InternalRole`/`ClientRole`
# (apps/accounts/models.py); aqui as chaves são as STRINGS desses enums para
# este módulo não importar models (evita import circular: models.py precisa
# deste arquivo para `User.can`).

_AGENT_PERMS = frozenset({
    Perm.PANEL_ACCESS,
    Perm.TICKET_VIEW,
    Perm.TICKET_REPLY_PUBLIC,
    Perm.TICKET_ADD_INTERNAL_NOTE,
    Perm.TICKET_BE_ASSIGNED,
    Perm.TICKET_EDIT_PROPERTIES,
    Perm.TICKET_CLOSE,
    Perm.TICKET_BULK_ACTIONS,
    Perm.CHAT_VIEW,
    Perm.CHAT_HANDLE,
    Perm.KANBAN_VIEW,
    Perm.KANBAN_MOVE,
    Perm.COMPANY_VIEW,
    Perm.REPORT_VIEW,
    Perm.REPORT_EXPORT,
    Perm.KNOWLEDGE_VIEW,
    Perm.MACRO_USE,
    Perm.MACRO_MANAGE,
})

#: Supervisor = agente + enxerga a operação inteira das equipes dele.
#: Hoje difere do agente só no escopo padrão (TEAMS nos dois, mas o supervisor
#: costuma estar em mais equipes) e por poder mexer em aviso. Continua um papel
#: à parte porque `Team.supervisor` aponta para ele no banco.
_SUPERVISOR_PERMS = _AGENT_PERMS | {
    Perm.ANNOUNCEMENT_MANAGE,
    Perm.KNOWLEDGE_MANAGE,
}

#: Agente leve: enxerga e comenta INTERNAMENTE, e só. É a razão de existir do
#: papel — o colega de engenharia/produto/financeiro que precisa acompanhar o
#: caso sem virar atendente. Note o que está AUSENTE: responder o cliente, ser
#: atribuído, editar propriedade, fechar, lote, chat. Repare também que não
#: recebe `REPORT_VIEW`: relatório é gestão da operação, não colaboração num
#: caso — se o seu produto quiser o contrário, é uma linha aqui.
_LIGHT_AGENT_PERMS = frozenset({
    Perm.PANEL_ACCESS,
    Perm.TICKET_VIEW,
    Perm.TICKET_ADD_INTERNAL_NOTE,
    Perm.KANBAN_VIEW,
    Perm.KNOWLEDGE_VIEW,
})

#: Admin recebe tudo que existe no catálogo, por construção e não por lista:
#: uma permissão nova nasce já valendo para o admin, que é o comportamento
#: esperado e evita o bug clássico de "criei a tela e esqueci de liberar".
#: As do portal ficam de fora — são de cliente, e um interno não tem portal.
_ADMIN_PERMS = frozenset(
    p for p in Perm if not p.startswith("portal.")
)

_CLIENT_MEMBER_PERMS = frozenset({
    Perm.PORTAL_ACCESS,
    Perm.PORTAL_TICKET_CREATE,
    Perm.PORTAL_TICKET_REPLY,
})

#: Responsável da empresa cliente: o mesmo do membro + gerenciar quem da
#: empresa tem acesso.
_CLIENT_OWNER_PERMS = _CLIENT_MEMBER_PERMS | {Perm.PORTAL_COMPANY_USERS}


ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    # internos
    "admin": _ADMIN_PERMS,
    "supervisor": _SUPERVISOR_PERMS,
    "agent": _AGENT_PERMS,
    "light_agent": _LIGHT_AGENT_PERMS,
    # clientes
    "owner": _CLIENT_OWNER_PERMS,
    "member": _CLIENT_MEMBER_PERMS,
}

#: Escopo de leitura padrão por papel. `ALL` só para admin: agente e
#: supervisor enxergam as equipes deles (D1, a regra que já existia), e o
#: agente leve idem — ASSIGNED seria uma fila SEMPRE VAZIA para ele, já que
#: não pode ser atribuído (ver a validação em `validate_scope_for_role`).
ROLE_DEFAULT_SCOPE: dict[str, str] = {
    "admin": TicketScope.ALL,
    "supervisor": TicketScope.TEAMS,
    "agent": TicketScope.TEAMS,
    "light_agent": TicketScope.TEAMS,
}


# --------------------------------------------------------------------------- #
# Consulta
# --------------------------------------------------------------------------- #

def _role_of(user) -> str | None:
    """O papel efetivo do usuário: interno ou de cliente, um dos dois."""
    if not getattr(user, "is_authenticated", False):
        return None
    return user.internal_role if user.is_internal else user.client_role


def permissions_for(user) -> frozenset[str]:
    """As permissões efetivas de `user`.

    Papel personalizado, quando existe e está ativo, SUBSTITUI o conjunto do
    papel embutido — não soma. Somar faria de todo custom role um "papel
    base + extras", e o caso mais comum de papel personalizado é justamente
    tirar coisa ("agente que não fecha ticket"), o que uma união nunca
    conseguiria expressar.

    Anônimo não tem nenhuma. Inativo idem: uma conta desligada que ainda
    tivesse permissões dependeria de todo chamador lembrar de checar
    `is_active` — aqui a resposta é vazia e acabou.
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return frozenset()

    custom = getattr(user, "custom_role", None)
    if custom is not None and custom.is_active:
        # Interseção com o catálogo: uma permissão que saiu do código (papel
        # gravado antes de uma refatoração) é ignorada em vez de conceder
        # algo que ninguém mais consome — e sem quebrar a leitura do papel.
        return frozenset(custom.permissions) & frozenset(Perm.values)

    role = _role_of(user)
    return ROLE_PERMISSIONS.get(role, frozenset())


def can(user, perm: str) -> bool:
    """`user` tem `perm`? É esta a pergunta que o resto do sistema faz."""
    return perm in permissions_for(user)


def ticket_scope_for(user) -> str:
    """Quanto da fila `user` enxerga — o recorte que `visible_to()` aplica.

    Precedência: o que foi configurado NA PESSOA vence (é o "escopo
    configurável" por agente); depois o do papel personalizado; por último o
    padrão do papel embutido. Um usuário sem papel interno (cliente) nunca
    chega aqui — `visible_to` trata cliente antes.
    """
    if getattr(user, "ticket_scope", ""):
        return user.ticket_scope

    custom = getattr(user, "custom_role", None)
    if custom is not None and custom.is_active and custom.ticket_scope:
        return custom.ticket_scope

    return ROLE_DEFAULT_SCOPE.get(_role_of(user), TicketScope.TEAMS)


def validate_scope_for_role(scope: str, permissions) -> str | None:
    """Devolve a mensagem de erro se a combinação escopo × permissões for
    contraditória; `None` se estiver de pé.

    Existe uma combinação que o sistema aceitaria e que só se revela errada
    em produção, com alguém olhando uma fila vazia sem entender por quê:
    escopo "apenas atribuídos a ele" num papel que não pode ser atribuído.
    Ela é barrada aqui, no ponto onde um humano escolhe as duas coisas (o
    formulário de papel e o de usuário), e não no `visible_to` — corrigir na
    leitura seria esconder o erro de configuração em vez de mostrá-lo.
    """
    if scope == TicketScope.ASSIGNED and Perm.TICKET_BE_ASSIGNED not in set(permissions):
        return (
            'Escopo "apenas atribuídos a ele" exige a permissão '
            '"Ser responsável por tickets" — sem ela a fila fica sempre vazia.'
        )
    return None


def permission_catalog() -> list[dict]:
    """O catálogo para a tela de papéis: valor, rótulo e grupo.

    O grupo sai do próprio prefixo do valor — não existe uma segunda lista
    para manter em dia.
    """
    return [
        {"value": p.value, "label": p.label, "group": p.value.split(".", 1)[0]}
        for p in Perm
    ]
