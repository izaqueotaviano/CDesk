"""Quem os seletores de Responsável e Dono técnico podem oferecer.

`GET /tickets/{id}/assignable-agents/` — pergunta DIFERENTE da de
`mention-targets` (ver o porquê completo em
`apps/tickets/services/atribuicao.py`): aqui o requester precisa aparecer (é
o "Assumir" pelo seletor) e quem não pode ser responsável pela regra de
negócio (`ticket_service.assign`/`set_owner`) não pode aparecer no seletor
que promete essa ação.
"""

import pytest

from apps.accounts.models import InternalRole, User, UserKind

pytestmark = pytest.mark.django_db


@pytest.fixture
def desativado():
    """Agente que saiu da empresa: interno, mas `is_active=False`."""
    return User.objects.create_user(
        email="saiu@x.test", full_name="Saiu Da Empresa", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT, is_active=False,
    )


class TestQuemPodeSerAtribuido:
    def test_interno_recebe_a_lista_incluindo_a_si_mesmo(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        """Diferente de `mention-targets`, o próprio requester aparece: sem
        isso ele nunca teria como se atribuir pelo seletor (só pelo botão
        "Assumir", que some com o ticket fechado)."""
        ticket = make_ticket(ana, suporte)

        resp = api(agente_suporte).get(
            f"/api/v1/tickets/{ticket.pk}/assignable-agents/"
        )

        assert resp.status_code == 200
        alvos = resp.json()
        assert {a["id"] for a in alvos} == {agente_suporte.pk}
        item = alvos[0]
        assert item["name"] == agente_suporte.full_name
        assert item["email"] == agente_suporte.email
        assert "avatar_url" in item
        # lista é só de gente: nada de `type`/`group` (isso é do autocomplete
        # de menção, que também oferece equipe — ver `MentionTargetSerializer`)
        assert "type" not in item
        assert "group" not in item

    def test_agente_leve_nao_aparece(
        self, api, make_ticket, ana, suporte, agente_suporte, agente_leve
    ):
        """Agente leve é interno e ativo, mas `assign()`/`set_owner()`
        recusam com 400 (`not assignee.can(Perm.TICKET_BE_ASSIGNED)`) —
        oferecê-lo no seletor prometeria uma atribuição que a regra de
        negócio nunca aceita."""
        ticket = make_ticket(ana, suporte)

        alvos = api(agente_suporte).get(
            f"/api/v1/tickets/{ticket.pk}/assignable-agents/"
        ).json()

        assert agente_leve.pk not in [a["id"] for a in alvos]

    def test_usuario_inativo_nao_aparece(
        self, api, make_ticket, ana, suporte, agente_suporte, desativado
    ):
        ticket = make_ticket(ana, suporte)

        alvos = api(agente_suporte).get(
            f"/api/v1/tickets/{ticket.pk}/assignable-agents/"
        ).json()

        assert desativado.pk not in [a["id"] for a in alvos]

    def test_cliente_toma_403(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)

        resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/assignable-agents/")

        assert resp.status_code == 403
