"""XSS (Pilar 5 §3) — o contrato de conteúdo, fixado.

Decisão (confirmada): o backend guarda o texto do ticket VERBATIM, serve como
JSON, e o SPA renderiza como texto (React escapa; não há `dangerouslySetInnerHTML`
no front). Sanitizar no servidor corromperia conteúdo legítimo — um cliente de
suporte cola trecho de código/HTML no ticket o tempo todo.

Estes testes travam esse contrato: o payload malicioso volta LITERAL no JSON
(não interpretado, não HTML-escapado, não removido). Se alguém um dia escapar/
sanitizar no serializer, estes testes quebram e forçam a discussão.
"""

import pytest

pytestmark = pytest.mark.django_db

XSS = "<script>alert('xss')</script>"


class TestTicketContentRoundTrip:
    def test_subject_and_body_returned_verbatim(
        self, api, make_ticket, ana, agente_suporte, suporte
    ):
        ticket = make_ticket(ana, suporte, subject=f"Bug {XSS}", body=f"Corpo {XSS}")

        data = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").json()

        # literal: não vira &lt;script&gt; nem some — a defesa é a renderização
        assert data["subject"] == f"Bug {XSS}"
        assert data["messages"][0]["body"] == f"Corpo {XSS}"

    def test_reply_body_round_trips_verbatim(
        self, api, make_ticket, ana, agente_suporte, suporte
    ):
        ticket = make_ticket(ana, suporte)

        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": XSS, "is_public": True, "new_status": "open"}, format="json",
        )
        assert resp.status_code == 201
        assert XSS in [m["body"] for m in resp.json()["messages"]]

    def test_raw_response_is_not_html_escaped(
        self, api, make_ticket, ana, agente_suporte, suporte
    ):
        """Confere no corpo cru (não só no dict): o JSON não escapa `<`/`>`."""
        ticket = make_ticket(ana, suporte, body=XSS)

        raw = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").content.decode()

        assert XSS in raw
        assert "&lt;script&gt;" not in raw
