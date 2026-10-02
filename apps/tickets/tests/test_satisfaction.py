"""Pesquisa de satisfação (CSAT).

A avaliação é SEMPRE logada, pelo próprio solicitante. O convite por e-mail
e o endpoint público por token saíram (ver `services/satisfaction.py`), e
com eles os testes de resposta anônima — nenhum endpoint serve dado de
ticket sem sessão agora. As garantias daqueles testes que continuam valendo
(resposta única, nota fora da escala, pesquisa expirada) foram movidas para
a porta autenticada, que é onde elas passaram a viver.

O que precisa ficar provado:

- só o SOLICITANTE avalia — nem colega de empresa, nem interno;
- resposta é única: repetir a chamada não infla o indicador;
- pesquisa expirada não aceita nota;
- reabrir e fechar de novo NÃO gera segunda pesquisa (a média mentiria);
- a pesquisa nasce mesmo para quem não tem e-mail cadastrado — o e-mail
  deixou de ser o canal, então deixou de ser condição.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import SatisfactionSurvey
from apps.tickets.services import satisfaction, ticket_service

pytestmark = pytest.mark.django_db

@pytest.fixture
def fechar(django_capture_on_commit_callbacks):
    """Fecha o ticket EXECUTANDO os callbacks de commit.

    A pesquisa nasce em `transaction.on_commit` — de propósito, para não
    disparar e-mail de um fechamento que ainda pode ser desfeito. Em teste
    transacional o commit nunca acontece, então o callback precisa ser
    executado explicitamente.
    """
    def _fechar(ticket, actor):
        with django_capture_on_commit_callbacks(execute=True):
            ticket_service.close_ticket(
                ticket=ticket, actor=actor,
                resolution_started_at=ticket.created_at,
                resolution_ended_at=timezone.now(),
            )
        ticket.refresh_from_db()
        return ticket
    return _fechar


@pytest.fixture
def fechado(make_ticket, ana, suporte, agente_suporte, fechar):
    return fechar(make_ticket(ana, suporte), agente_suporte)


class TestCriacao:
    def test_fechar_ticket_abre_a_pesquisa(self, fechado):
        survey = SatisfactionSurvey.objects.get(ticket=fechado)
        assert survey.score is None
        assert survey.responded_at is None
        # nada sai por e-mail: `sent_at` nasce nulo e fica nulo (campo
        # vestigial do desenho antigo — ver a docstring do modelo)
        assert survey.sent_at is None

    def test_reabrir_e_fechar_nao_gera_segunda_pesquisa(
        self, fechado, ana, agente_suporte, fechar
    ):
        # antes de reabrir, a nota (regra de produto — test_reabrir_exige_nota)
        satisfaction.answer(fechado.survey, score=9)
        ticket_service.add_reply(ticket=fechado, author=ana, body="voltou a falhar")
        fechado.refresh_from_db()
        fechar(fechado, agente_suporte)
        assert SatisfactionSurvey.objects.filter(ticket=fechado).count() == 1

    def test_solicitante_sem_email_tambem_ganha_pesquisa(
        self, make_ticket, ana, suporte, agente_suporte, fechar
    ):
        """Enquanto o convite ia por e-mail, quem não tinha endereço não
        ganhava pesquisa — não havia para onde mandar, e uma pesquisa órfã só
        poluía o painel. Agora a nota é dada dentro do portal, então o e-mail
        deixou de ser condição para ela existir."""
        ana.email = ""
        ana.save(update_fields=["email"])
        ticket = fechar(make_ticket(ana, suporte), agente_suporte)
        assert SatisfactionSurvey.objects.filter(ticket=ticket).exists()

    def test_desligado_na_configuracao_nao_cria(self, config, make_ticket, ana,
                                                suporte, agente_suporte, fechar):
        config(csat_enabled=False)
        ticket = fechar(make_ticket(ana, suporte), agente_suporte)
        assert not SatisfactionSurvey.objects.filter(ticket=ticket).exists()


class TestAvaliacaoNoPortal:
    """A única porta: logado, pelo solicitante. É o que alimenta o aviso da
    home e o botão na tela do chamado."""

    def test_pendente_aparece_para_o_proprio_solicitante(self, api, ana, fechado):
        resp = api(ana).get("/api/v1/tickets/pending-ratings/")
        assert resp.status_code == 200
        corpo = resp.json()
        assert len(corpo) == 1
        assert corpo[0]["ticket_id"] == fechado.pk
        assert corpo[0]["reference"] == fechado.reference

    def test_avaliar_pelo_painel_registra_nota_e_some_da_pendencia(self, api, ana, fechado):
        resp = api(ana).post(
            f"/api/v1/tickets/{fechado.pk}/rate/",
            {"score": 9, "comment": "rápido"}, format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["satisfaction"]["score"] == 9

        survey = SatisfactionSurvey.objects.get(ticket=fechado)
        assert survey.score == 9
        assert survey.comment == "rápido"

        assert api(ana).get("/api/v1/tickets/pending-ratings/").json() == []

    def test_outro_usuario_nao_avalia_chamado_alheio(self, api, beto, fechado):
        """`beto` é da mesma empresa (Acme) que `ana`, mas não é quem abriu
        este chamado — só o solicitante avalia, igual ao chat."""
        resp = api(beto).post(
            f"/api/v1/tickets/{fechado.pk}/rate/", {"score": 5}, format="json",
        )
        assert resp.status_code == 403
        assert SatisfactionSurvey.objects.get(ticket=fechado).score is None

    def test_nota_fora_da_escala_e_recusada_no_painel(self, api, ana, fechado):
        resp = api(ana).post(
            f"/api/v1/tickets/{fechado.pk}/rate/", {"score": 11}, format="json",
        )
        assert resp.status_code == 400
        assert SatisfactionSurvey.objects.get(ticket=fechado).score is None

    def test_responder_duas_vezes_nao_infla_o_indicador(self, api, ana, fechado):
        """Veio dos testes do endpoint público: a trava é do serviço
        (`satisfaction.answer` levanta `SurveyClosed`), não era da view que
        saiu — então continua valendo aqui."""
        url = f"/api/v1/tickets/{fechado.pk}/rate/"
        assert api(ana).post(url, {"score": 10}, format="json").status_code == 200
        segunda = api(ana).post(url, {"score": 0}, format="json")
        assert segunda.status_code == 400
        assert SatisfactionSurvey.objects.get(ticket=fechado).score == 10  # a primeira vale

    def test_pesquisa_expirada_nao_aceita(self, api, ana, fechado):
        survey = SatisfactionSurvey.objects.get(ticket=fechado)
        SatisfactionSurvey.objects.filter(pk=survey.pk).update(
            expires_at=timezone.now() - dt.timedelta(days=1)
        )
        resp = api(ana).post(
            f"/api/v1/tickets/{fechado.pk}/rate/", {"score": 8}, format="json",
        )
        assert resp.status_code == 400
        survey.refresh_from_db()
        assert survey.score is None

    def test_sem_pesquisa_da_404(self, api, ana, config, make_ticket, suporte,
                                 agente_suporte, fechar):
        config(csat_enabled=False)
        ticket = fechar(make_ticket(ana, suporte), agente_suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/rate/", {"score": 8}, format="json",
        )
        assert resp.status_code == 404


class TestAgregado:
    def test_media_ignora_quem_nao_respondeu(
        self, fechado, make_ticket, beto, suporte, agente_suporte, fechar
    ):
        satisfaction.answer(SatisfactionSurvey.objects.get(ticket=fechado), score=10)
        # segundo ticket fechado: pesquisa enviada e NÃO respondida
        fechar(make_ticket(beto, suporte), agente_suporte)

        resumo = satisfaction.summarize(list(SatisfactionSurvey.objects.all()))
        assert resumo["enviadas"] == 2
        assert resumo["respostas"] == 1      # não respondeu ≠ nota baixa
        assert resumo["media"] == 10.0       # a média não é diluída pelo silêncio
        assert resumo["distribuicao"][10] == 1
        assert resumo["distribuicao"][0] == 0

    def test_sem_resposta_a_media_e_nula(self, fechado):
        resumo = satisfaction.summarize(list(SatisfactionSurvey.objects.all()))
        assert resumo["enviadas"] == 1
        assert resumo["respostas"] == 0
        assert resumo["media"] is None
