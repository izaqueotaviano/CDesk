"""Quem é o visitante que se identificou no chat público do site do cliente.

O modo público do embed (docs/14-seguranca.md §10) não tem ninguém logado do
outro lado: o visitante digita nome e e-mail na própria janelinha. Este módulo
é o único lugar que transforma isso numa pessoa do sistema — e a decisão de
projeto que ele carrega é esta:

**o visitante vira um `User` cliente daquela empresa, marcado como visitante.**

A alternativa seria um chat sem dono (`client` nulo + nome/e-mail soltos no
Chat). Ela foi descartada porque `Chat.client` é o que sustenta,
hoje, praticamente tudo o que acontece DEPOIS da conversa: o nome que o
agente vê na fila, o "já tem atendimento aberto" que evita duplicar chat da
mesma pessoa, o solicitante do ticket quando a conversa vira chamado, o
destinatário das notificações. Um cliente nulo espalharia um `if` por cada um
desses pontos — e, pior, o primeiro que esquecesse do caso quebraria em
produção com o visitante na linha.

O que impede isso de virar uma porta dos fundos para o portal:

- a senha nasce inutilizável e **não existe "esqueci minha senha"** no produto
  (ver `apps.accounts.admin_api.reset_password`): só um admin define senha,
  e fazer isso é promover o visitante a usuário de verdade, conscientemente;
- e-mail que já existe em OUTRA empresa (ou de alguém interno) nunca é
  reaproveitado nem sobrescrito — a conversa é recusada;
- `is_widget_visitor` mantém a listagem da empresa honesta: é visitante do
  site, não um acesso ao portal que alguém cadastrou.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email

from apps.accounts.models import User, UserKind

# Mensagem única para todos os motivos de recusa ligados ao e-mail. É
# deliberado: "esse e-mail é de outra empresa" contaria, para qualquer um na
# internet, onde uma pessoa é cliente — enumeração de conta com o formulário
# aberto no site do cliente.
ERRO_EMAIL = "Não foi possível iniciar o atendimento com este e-mail."
ERRO_NOME = "Diga seu nome para começar."
ERRO_EMAIL_INVALIDO = "Informe um e-mail válido."

NOME_MAX = 150


def resolver_visitante(company, *, nome: str, email: str) -> tuple[User | None, str | None]:
    """`(usuário, None)` quando dá pra atender; `(None, mensagem)` quando não.

    A mensagem é escrita para o VISITANTE (quem está do outro lado do site do
    cliente), não para quem integra — ele não tem como corrigir configuração
    nenhuma, só o que digitou.
    """
    nome = (nome or "").strip()
    email = (email or "").strip().lower()

    if len(nome) < 2:
        return None, ERRO_NOME
    try:
        validate_email(email)
    except DjangoValidationError:
        return None, ERRO_EMAIL_INVALIDO

    existente = User.objects.filter(email__iexact=email).first()
    if existente is not None:
        # Reaproveita SÓ o cliente ativo da própria empresa: é a mesma pessoa
        # voltando (e aí o histórico dela se junta, que é o certo). Qualquer
        # outro caso — interno, inativo, cliente de outra empresa — é recusa,
        # nunca captura de conta alheia.
        mesma_empresa = (
            existente.kind == UserKind.CLIENT
            and existente.is_active
            and existente.company_id == company.id
        )
        if not mesma_empresa:
            return None, ERRO_EMAIL
        return existente, None

    visitante = User(
        email=email,
        full_name=nome[:NOME_MAX],
        kind=UserKind.CLIENT,
        company=company,
        is_widget_visitor=True,
    )
    # Sem senha utilizável: a conta existe para a conversa acontecer, não para
    # entrar em lugar nenhum (ver o cabeçalho do módulo).
    visitante.set_unusable_password()
    visitante.save()
    return visitante, None
