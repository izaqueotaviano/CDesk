"""Camada de leitura de `reports`.

Consultas agregadas sobre tickets e eventos de status. Regra do projeto:
sempre partir de `apps.tickets.selectors.visible_tickets(user)` — nunca do
manager cru — para que relatório respeite o mesmo escopo de visibilidade
das listagens (verificado por teste estrutural em tickets/tests).
"""
