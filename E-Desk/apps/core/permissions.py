"""Permissões de API — a porta de entrada, não a tranca definitiva.

Estas classes recusam cedo, com 403 claro, antes de a view abrir o banco.
A regra de negócio de verdade continua no domínio (`visible_to()` para
leitura, as policies de `ticket_service` para escrita): quem chama o serviço
por fora da API — management command, worker do Celery, shell — não passa
por aqui, e mesmo assim não pode furar a regra.

Todas consultam `apps/accounts/rbac.py`. Nenhuma testa papel na mão: é isso
que faz um papel personalizado (`CustomRole`) valer em todo o sistema sem
precisar tocar em nenhuma view.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.rbac import Perm


class HasPerm(BasePermission):
    """Exige uma permissão do catálogo.

    Uso na view::

        class TicketViewSet(viewsets.GenericViewSet):
            permission_classes = [HasPerm.of(Perm.TICKET_VIEW)]

    `of()` devolve uma CLASSE (o DRF instancia sozinho), por isso o
    `type(...)` em vez de guardar a permissão numa instância.
    """

    perm: str = ""
    message = "Você não tem permissão para esta ação."

    @classmethod
    def of(cls, perm: str, message: str | None = None):
        return type(
            f"HasPerm_{perm.replace('.', '_')}",
            (cls,),
            {"perm": perm, "message": message or cls.message},
        )

    def has_permission(self, request, view):
        user = request.user
        return bool(user.is_authenticated and user.can(self.perm))


class HasAnyPerm(BasePermission):
    """Exige QUALQUER UMA de várias — para telas que servem a mais de um
    papel (ex.: a fila que agente e agente leve abrem, cada um fazendo
    coisas diferentes lá dentro)."""

    perms: tuple[str, ...] = ()
    message = "Você não tem permissão para esta ação."

    @classmethod
    def of(cls, *perms: str, message: str | None = None):
        return type(
            "HasAnyPerm_" + "_".join(p.replace(".", "_") for p in perms),
            (cls,),
            {"perms": tuple(perms), "message": message or cls.message},
        )

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        return any(user.can(p) for p in self.perms)


class PermReadWrite(BasePermission):
    """Uma permissão para ler, outra para escrever — o padrão das telas de
    configuração, onde interno consulta e só quem administra altera."""

    read_perm: str = ""
    write_perm: str = ""
    message = "Você não tem permissão para alterar esta configuração."

    @classmethod
    def of(cls, read_perm: str, write_perm: str, message: str | None = None):
        return type(
            f"PermReadWrite_{read_perm.replace('.', '_')}",
            (cls,),
            {
                "read_perm": read_perm,
                "write_perm": write_perm,
                "message": message or cls.message,
            },
        )

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        needed = self.read_perm if request.method in SAFE_METHODS else self.write_perm
        return user.can(needed)


# --------------------------------------------------------------------------- #
# Nomeadas — as três que o sistema já usava, agora expressas em permissão
# --------------------------------------------------------------------------- #
#
# Mantidas com o mesmo NOME e a mesma semântica de antes (dezenas de views as
# importam), mas o corpo passou a perguntar ao catálogo em vez de comparar
# papel. Hoje o resultado é idêntico — só o admin tem `SETTINGS_MANAGE`,
# só interno tem `PANEL_ACCESS` — e amanhã um papel personalizado com
# `SETTINGS_MANAGE` passa a funcionar em todas elas de uma vez.


class IsInternal(BasePermission):
    """Área interna: qualquer papel que acesse o painel (inclui agente leve)."""

    message = "Área interna."

    def has_permission(self, request, view):
        user = request.user
        return bool(user.is_authenticated and user.can(Perm.PANEL_ACCESS))


class IsAdmin(BasePermission):
    """Administração do sistema."""

    message = "Apenas administradores."

    def has_permission(self, request, view):
        user = request.user
        return bool(user.is_authenticated and user.can(Perm.SETTINGS_MANAGE))


class IsAuthenticatedReadAdminWrite(BasePermission):
    """Qualquer autenticado lê — inclusive CLIENTE; só quem administra escreve.

    Irmã de `IsInternalReadAdminWrite`, para os cadastros que o portal também
    consome (atalhos de mensagem do chat). A diferença é uma linha e é toda a
    questão: aqui a leitura não exige `PANEL_ACCESS`, senão o cliente levaria
    403 justamente no recurso feito para ele.
    """

    message = "Apenas administradores podem alterar esta configuração."

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return user.can(Perm.PANEL_ACCESS) and user.can(Perm.SETTINGS_MANAGE)


class IsInternalReadAdminWrite(BasePermission):
    """Interno lê; só quem administra escreve — o padrão de `settings/*`."""

    message = "Apenas administradores podem alterar esta configuração."

    def has_permission(self, request, view):
        user = request.user
        if not (user.is_authenticated and user.can(Perm.PANEL_ACCESS)):
            return False
        return request.method in SAFE_METHODS or user.can(Perm.SETTINGS_MANAGE)
