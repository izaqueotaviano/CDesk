"""Vínculo empresa↔domínio de e-mail (GAPS.md #11 — "vínculo automático").

A Fase 1 do prompt de integração pede: "quem se cadastra ou escreve de um
e-mail com esses domínios entra automaticamente nessa empresa. Reforçar no
servidor no momento de criar usuário/chamado/chat — nunca deixar só o front
decidir a empresa."

Decisão desta rodada (revisão do usuário em GAPS.md): implementar só o dado
(`CompanyDomain`) e esta função de resolução — SEM wire-up em nenhum
endpoint ainda. A auditoria de Fase 0 encontrou zero pontos de entrada sem
convite prévio (auto-cadastro está fechado, `apps/accounts/adapters.py:
is_open_for_signup` retorna `False`; toda criação de cliente hoje vem de
`CompanyAdminViewSet.users` ou de convite explícito, sempre com a empresa
já decidida por um humano). "Reforçar no servidor" pressupõe um lugar para
reforçar — quando esse ponto de entrada nascer (chat público, formulário de
abertura sem login, etc.), ele chama `resolve_company_by_email_domain()`
em vez de reinventar a busca.
"""

from __future__ import annotations

from apps.customers.models import Company, CompanyDomain


def resolve_company_by_email_domain(email: str) -> Company | None:
    """Empresa dona do domínio do e-mail, se houver alguma cadastrada.

    Só olha a parte depois do "@", em minúsculo. E-mail sem "@" (entrada
    inválida) devolve None em vez de estourar — quem chama decide o que
    fazer com "sem vínculo encontrado", que é o mesmo caminho de um domínio
    desconhecido.
    """
    if "@" not in email:
        return None
    domain = email.rsplit("@", 1)[-1].strip().lower()
    if not domain:
        return None
    vinculo = (
        CompanyDomain.objects.select_related("company")
        .filter(domain=domain, company__is_active=True)
        .first()
    )
    return vinculo.company if vinculo else None


__all__ = ["resolve_company_by_email_domain"]
