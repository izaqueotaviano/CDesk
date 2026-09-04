"""RBAC — o mapa papel → permissões e as três camadas que o consomem.

O que estes testes protegem, em ordem de importância:

1. **O agente leve não fala com o cliente.** É a razão de o papel existir e o
   único ponto onde um erro vira vazamento para fora da empresa. Testado nas
   duas camadas (serviço e HTTP), porque uma tranca só na API deixa a janela
   do worker/shell aberta.
2. **O escopo recorta a fila de verdade**, e a fronteira de equipe continua
   valendo mesmo no escopo mais estreito.
3. **Papel personalizado substitui, não soma** — se somasse, seria impossível
   montar o caso mais comum ("agente que não fecha ticket").
"""

import pytest

from apps.accounts import rbac
from apps.accounts.models import CustomRole, InternalRole, User
from apps.accounts.rbac import Perm, TicketScope
from apps.tickets.models import Ticket, TicketStatus
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


# --------------------------------------------------------------------------- #
# O catálogo
# --------------------------------------------------------------------------- #

def test_admin_recebe_toda_permissao_interna_por_construcao(admin):
    """Uma permissão nova nasce valendo para o admin — é o que evita o bug de
    "criei a tela e esqueci de liberar". As de portal ficam de fora: são de
    cliente, e um interno não tem portal."""
    esperado = {p for p in Perm.values if not p.startswith("portal.")}
    assert set(admin.permissions) == esperado
    assert not any(p.startswith("portal.") for p in admin.permissions)


def test_agente_leve_le_e_comenta_internamente_e_so_isso(agente_leve):
    assert agente_leve.can(Perm.TICKET_VIEW)
    assert agente_leve.can(Perm.TICKET_ADD_INTERNAL_NOTE)
    # o conjunto do papel, item a item — o que está AUSENTE é o produto
    assert not agente_leve.can(Perm.TICKET_REPLY_PUBLIC)
    assert not agente_leve.can(Perm.TICKET_BE_ASSIGNED)
    assert not agente_leve.can(Perm.TICKET_EDIT_PROPERTIES)
    assert not agente_leve.can(Perm.TICKET_CLOSE)
    assert not agente_leve.can(Perm.TICKET_BULK_ACTIONS)
    assert not agente_leve.can(Perm.CHAT_HANDLE)
    assert not agente_leve.can(Perm.SETTINGS_MANAGE)


def test_agente_completo_atende_mas_nao_administra(agente_suporte):
    assert agente_suporte.can(Perm.TICKET_REPLY_PUBLIC)
    assert agente_suporte.can(Perm.TICKET_BE_ASSIGNED)
    assert agente_suporte.can(Perm.TICKET_CLOSE)
    assert not agente_suporte.can(Perm.SETTINGS_MANAGE)
    assert not agente_suporte.can(Perm.USER_MANAGE)
    assert not agente_suporte.can(Perm.ROLE_MANAGE)


def test_cliente_nao_tem_nenhuma_permissao_de_painel(ana):
    assert ana.can(Perm.PORTAL_ACCESS)
    assert not ana.can(Perm.PANEL_ACCESS)
    assert not ana.can(Perm.TICKET_VIEW)


def test_conta_inativa_perde_tudo(agente_suporte):
    """Sem isto, todo chamador precisaria lembrar de checar `is_active`."""
    agente_suporte.is_active = False
    assert agente_suporte.permissions == frozenset()
    assert not agente_suporte.can(Perm.TICKET_VIEW)


def test_anonimo_nao_estoura_e_nao_pode_nada():
    from django.contrib.auth.models import AnonymousUser

    assert rbac.permissions_for(AnonymousUser()) == frozenset()
    assert not rbac.can(AnonymousUser(), Perm.TICKET_VIEW)


# --------------------------------------------------------------------------- #
# Agente leve: a regra que não pode falhar
# --------------------------------------------------------------------------- #

def test_agente_leve_adiciona_nota_interna(agente_leve, suporte, ana, make_ticket):
    ticket = make_ticket(ana, suporte)
    msg = ticket_service.add_reply(
        ticket=ticket, author=agente_leve,
        body="A fila de webhooks está com atraso — vou olhar.", is_public=False,
    )
    assert msg.pk and msg.is_public is False


def test_agente_leve_nao_responde_o_cliente(agente_leve, suporte, ana, make_ticket):
    """A checagem vale mesmo chamando o serviço direto, sem passar por HTTP."""
    ticket = make_ticket(ana, suporte)
    with pytest.raises(TicketRuleViolation, match="não permite responder ao cliente"):
        ticket_service.add_reply(
            ticket=ticket, author=agente_leve, body="Olá!",
            is_public=True, new_status=TicketStatus.OPEN,
        )


def test_resposta_publica_recusada_nao_deixa_mensagem_no_banco(
    agente_leve, suporte, ana, make_ticket
):
    """A mensagem é criada antes da checagem, dentro da transação — a exceção
    tem de desfazer isso, senão sobra no ticket uma mensagem fantasma."""
    ticket = make_ticket(ana, suporte)
    antes = ticket.messages.count()
    with pytest.raises(TicketRuleViolation):
        ticket_service.add_reply(
            ticket=ticket, author=agente_leve, body="vazou?",
            is_public=True, new_status=TicketStatus.OPEN,
        )
    assert ticket.messages.count() == antes


def test_agente_leve_nao_pode_ser_responsavel(
    agente_leve, agente_suporte, suporte, ana, make_ticket
):
    ticket = make_ticket(ana, suporte)
    with pytest.raises(TicketRuleViolation, match="não pode ser responsável"):
        ticket_service.assign(ticket=ticket, assignee=agente_leve, actor=agente_suporte)


def test_agente_leve_nao_pode_ser_dono_tecnico(
    agente_leve, agente_suporte, suporte, ana, make_ticket
):
    ticket = make_ticket(ana, suporte)
    with pytest.raises(TicketRuleViolation, match="não pode ser responsável"):
        ticket_service.set_owner(ticket=ticket, owner=agente_leve, actor=agente_suporte)


def test_agente_leve_nao_edita_propriedades(agente_leve, suporte, ana, make_ticket):
    ticket = make_ticket(ana, suporte)
    with pytest.raises(TicketRuleViolation, match="não permite editar"):
        ticket_service.reclassify(ticket=ticket, actor=agente_leve, priority="high")


def test_agente_leve_nao_fecha_ticket(agente_leve, suporte, ana, make_ticket):
    from django.utils import timezone

    ticket = make_ticket(ana, suporte)
    agora = timezone.now()
    with pytest.raises(TicketRuleViolation, match="não permite fechar"):
        ticket_service.close_ticket(
            ticket=ticket, actor=agente_leve,
            resolution_started_at=agora, resolution_ended_at=agora,
        )


def test_agente_leve_enxerga_o_ticket_da_equipe_dele(
    agente_leve, suporte, ana, make_ticket
):
    """Ele PRECISA ler — é para isso que existe. O que ele não pode é agir."""
    ticket = make_ticket(ana, suporte)
    assert Ticket.objects.visible_to(agente_leve).filter(pk=ticket.pk).exists()


# --------------------------------------------------------------------------- #
# Escopo de leitura
# --------------------------------------------------------------------------- #

def test_escopo_all_ve_a_fila_inteira(admin, agente_suporte, suporte, financeiro,
                                      ana, carla, make_ticket):
    make_ticket(ana, suporte)
    make_ticket(carla, financeiro)
    assert Ticket.objects.visible_to(admin).count() == 2
    assert admin.effective_ticket_scope == TicketScope.ALL


def test_escopo_teams_recorta_pela_equipe(agente_suporte, suporte, financeiro,
                                          ana, carla, make_ticket):
    meu = make_ticket(ana, suporte)
    outro = make_ticket(carla, financeiro)
    visiveis = set(Ticket.objects.visible_to(agente_suporte).values_list("pk", flat=True))
    assert meu.pk in visiveis
    assert outro.pk not in visiveis


def test_escopo_assigned_mostra_so_o_que_esta_com_a_pessoa(
    agente_suporte, admin, suporte, ana, make_ticket
):
    meu = make_ticket(ana, suporte, subject="comigo")
    alheio = make_ticket(ana, suporte, subject="de outro")
    ticket_service.assign(ticket=meu, assignee=agente_suporte, actor=admin)

    agente_suporte.ticket_scope = TicketScope.ASSIGNED
    agente_suporte.save(update_fields=["ticket_scope"])

    visiveis = set(Ticket.objects.visible_to(agente_suporte).values_list("pk", flat=True))
    assert visiveis == {meu.pk}
    assert alheio.pk not in visiveis


def test_escopo_assigned_inclui_dono_tecnico(
    agente_suporte, admin, suporte, ana, make_ticket
):
    """Um escopo que escondesse o que a pessoa precisa ENTREGAR não teria uso."""
    t = make_ticket(ana, suporte)
    ticket_service.set_owner(ticket=t, owner=agente_suporte, actor=admin)
    agente_suporte.ticket_scope = TicketScope.ASSIGNED
    assert Ticket.objects.visible_to(agente_suporte).filter(pk=t.pk).exists()


def test_escopo_assigned_nao_fura_a_fronteira_de_equipe(
    agente_suporte, admin, financeiro, carla, make_ticket
):
    """Interseção e não substituição: atribuído numa equipe da qual a pessoa
    NÃO faz parte continua invisível — a parede da equipe é mais forte."""
    t = make_ticket(carla, financeiro)
    Ticket.objects.filter(pk=t.pk).update(assignee=agente_suporte)
    agente_suporte.ticket_scope = TicketScope.ASSIGNED
    assert not Ticket.objects.visible_to(agente_suporte).filter(pk=t.pk).exists()


def test_escopo_da_pessoa_vence_o_do_papel(agente_suporte, suporte, financeiro,
                                           ana, carla, make_ticket):
    make_ticket(ana, suporte)
    make_ticket(carla, financeiro)
    assert Ticket.objects.visible_to(agente_suporte).count() == 1  # padrão: TEAMS

    agente_suporte.ticket_scope = TicketScope.ALL
    assert Ticket.objects.visible_to(agente_suporte).count() == 2


# --------------------------------------------------------------------------- #
# Papéis personalizados
# --------------------------------------------------------------------------- #

def test_papel_personalizado_substitui_e_nao_soma(agente_suporte):
    """O caso mais comum de papel personalizado é TIRAR algo. Uma união
    jamais conseguiria expressá-lo."""
    papel = CustomRole.objects.create(
        name="Agente sem fechamento", slug="agente-sem-fechamento",
        base_role=InternalRole.AGENT,
        permissions=[Perm.PANEL_ACCESS, Perm.TICKET_VIEW, Perm.TICKET_REPLY_PUBLIC],
    )
    agente_suporte.custom_role = papel
    assert agente_suporte.can(Perm.TICKET_REPLY_PUBLIC)
    assert not agente_suporte.can(Perm.TICKET_CLOSE)  # o papel base tinha


def test_papel_personalizado_inativo_volta_ao_papel_base(agente_suporte):
    papel = CustomRole.objects.create(
        name="Só leitura", slug="so-leitura", is_active=False,
        permissions=[Perm.PANEL_ACCESS, Perm.TICKET_VIEW],
    )
    agente_suporte.custom_role = papel
    assert agente_suporte.can(Perm.TICKET_CLOSE)  # voltou a ser agente


def test_permissao_fora_do_catalogo_e_ignorada(agente_suporte):
    """Papel gravado antes de uma refatoração não pode conceder algo que
    nenhum código consome — nem quebrar a leitura do papel."""
    papel = CustomRole.objects.create(
        name="Legado", slug="legado",
        permissions=[Perm.TICKET_VIEW, "ticket.viajar_no_tempo"],
    )
    agente_suporte.custom_role = papel
    assert agente_suporte.permissions == frozenset({Perm.TICKET_VIEW})


def test_escopo_do_papel_personalizado_vale(agente_suporte, suporte, financeiro,
                                            ana, carla, make_ticket):
    make_ticket(ana, suporte)
    make_ticket(carla, financeiro)
    papel = CustomRole.objects.create(
        name="Auditor", slug="auditor", ticket_scope=TicketScope.ALL,
        permissions=[Perm.PANEL_ACCESS, Perm.TICKET_VIEW],
    )
    agente_suporte.custom_role = papel
    assert Ticket.objects.visible_to(agente_suporte).count() == 2


def test_combinacao_contraditoria_e_barrada():
    """Escopo "só atribuídos a ele" num papel que não pode ser atribuído dá
    uma fila SEMPRE vazia — o erro precisa aparecer no cadastro, não em
    produção com alguém encarando uma tela vazia."""
    erro = rbac.validate_scope_for_role(TicketScope.ASSIGNED, [Perm.TICKET_VIEW])
    assert erro and "sempre vazia" in erro

    ok = rbac.validate_scope_for_role(
        TicketScope.ASSIGNED, [Perm.TICKET_VIEW, Perm.TICKET_BE_ASSIGNED]
    )
    assert ok is None


def test_papel_personalizado_valida_no_clean():
    from django.core.exceptions import ValidationError

    papel = CustomRole(
        name="Impossível", slug="impossivel",
        ticket_scope=TicketScope.ASSIGNED, permissions=[Perm.TICKET_VIEW],
    )
    with pytest.raises(ValidationError):
        papel.clean()


# --------------------------------------------------------------------------- #
# Camada de API
# --------------------------------------------------------------------------- #

def test_me_devolve_as_permissoes_e_o_escopo(api, agente_leve):
    resp = api(agente_leve).get("/api/v1/auth/me/")
    assert resp.status_code == 200
    assert Perm.TICKET_ADD_INTERNAL_NOTE in resp.data["permissions"]
    assert Perm.TICKET_REPLY_PUBLIC not in resp.data["permissions"]
    assert resp.data["ticket_scope"] == TicketScope.TEAMS


def test_me_de_cliente_nao_traz_escopo_de_fila(api, ana):
    resp = api(ana).get("/api/v1/auth/me/")
    assert resp.data["ticket_scope"] == ""
    assert Perm.PORTAL_ACCESS in resp.data["permissions"]


def test_agente_leve_recebe_403_no_lote(api, agente_leve, suporte, ana, make_ticket):
    t = make_ticket(ana, suporte)
    resp = api(agente_leve).post(
        "/api/v1/tickets/bulk-close/",
        {"ticket_ids": [t.pk],
         "resolution_started_at": "2026-01-01T10:00:00Z",
         "resolution_ended_at": "2026-01-01T11:00:00Z"},
        format="json",
    )
    assert resp.status_code == 403


def test_agente_leve_responde_publicamente_pela_api_e_toma_400(
    api, agente_leve, suporte, ana, make_ticket
):
    """A porta HTTP também fecha — e com mensagem que ensina o caminho certo."""
    t = make_ticket(ana, suporte)
    resp = api(agente_leve).post(
        f"/api/v1/tickets/{t.pk}/reply/",
        {"body": "oi", "is_public": True, "new_status": "open"}, format="json",
    )
    assert resp.status_code == 400
    assert "nota interna" in str(resp.data).lower()


def test_agente_leve_adiciona_nota_pela_api(api, agente_leve, suporte, ana, make_ticket):
    t = make_ticket(ana, suporte)
    resp = api(agente_leve).post(
        f"/api/v1/tickets/{t.pk}/reply/",
        {"body": "olhando por aqui", "is_public": False}, format="json",
    )
    assert resp.status_code == 201


def test_so_quem_tem_role_manage_mexe_em_papel(api, admin, agente_suporte):
    assert api(admin).get("/api/v1/settings/roles/").status_code == 200
    assert api(agente_suporte).get("/api/v1/settings/roles/").status_code == 403


def test_catalogo_de_permissoes_sai_no_choices(api, admin):
    resp = api(admin).get("/api/v1/settings/choices/")
    assert resp.status_code == 200
    valores = {p["value"] for p in resp.data["permissions"]}
    assert valores == set(Perm.values)
    assert "light_agent" in {r["value"] for r in resp.data["internal_roles"]}
    # o grupo sai do prefixo — sem segunda lista para manter em dia
    grupos = {p["group"] for p in resp.data["permissions"]}
    assert {"ticket", "chat", "settings", "portal"} <= grupos


def test_api_recusa_papel_com_permissao_inventada(api, admin):
    resp = api(admin).post(
        "/api/v1/settings/roles/",
        {"name": "X", "slug": "x", "permissions": ["ticket.voar"]}, format="json",
    )
    assert resp.status_code == 400
    assert "desconhecidas" in str(resp.data).lower()


def test_api_recusa_excluir_papel_em_uso(api, admin, agente_suporte):
    papel = CustomRole.objects.create(name="Em uso", slug="em-uso",
                                      permissions=[Perm.TICKET_VIEW])
    User.objects.filter(pk=agente_suporte.pk).update(custom_role=papel)
    resp = api(admin).delete(f"/api/v1/settings/roles/{papel.pk}/")
    assert resp.status_code == 400
    assert CustomRole.objects.filter(pk=papel.pk).exists()


def test_api_recusa_escopo_contraditorio_no_cadastro_de_usuario(api, admin, agente_leve):
    """Regressão: esta validação já nasceu morta uma vez.

    O `validate` novo foi escrito num serializer que JÁ tinha um `validate`
    mais abaixo — em Python a última definição vence, e a checagem virou
    código inalcançável que nenhum teste da função pura pegaria. Este teste
    exercita o caminho HTTP inteiro, que é o único jeito de provar que a
    regra está mesmo ligada.
    """
    resp = api(admin).patch(
        f"/api/v1/settings/users/{agente_leve.pk}/",
        {"ticket_scope": TicketScope.ASSIGNED}, format="json",
    )
    assert resp.status_code == 400
    assert "sempre vazia" in str(resp.data)


def test_api_aceita_escopo_coerente_no_cadastro_de_usuario(api, admin, agente_suporte):
    """O outro lado da moeda: agente que PODE ser atribuído aceita o escopo."""
    resp = api(admin).patch(
        f"/api/v1/settings/users/{agente_suporte.pk}/",
        {"ticket_scope": TicketScope.ASSIGNED}, format="json",
    )
    assert resp.status_code == 200
    agente_suporte.refresh_from_db()
    assert agente_suporte.effective_ticket_scope == TicketScope.ASSIGNED
