# 13 — Papéis e permissões (RBAC)

Inspirado no Zendesk Support, adaptado ao que este sistema já era. A regra
que sustenta o resto:

> **`apps/accounts/rbac.py` é a única fonte de verdade sobre "quem pode o
> quê".** Se você escrever `if user.internal_role ==` fora dele, é bug: o
> papel deixa de ser configuração e vira código espalhado.

## 1. Os papéis

| Papel | `internal_role` | Escopo padrão | O que define |
|---|---|---|---|
| **Admin** | `admin` | `all` | Tudo. Uma permissão nova nasce valendo para ele. |
| **Supervisor** | `supervisor` | `teams` | Agente + avisos + base de conhecimento. `Team.supervisor` aponta para ele. |
| **Agent** | `agent` | `teams` | Atende: responde, é atribuído, edita, fecha, chat. |
| **Light Agent** | `light_agent` | `teams` | Lê e comenta **internamente**. Não fala com o cliente, não é atribuído, não edita, não fecha. |
| **End User** | `kind=client` | — | Só os próprios tickets, pelo portal. Nunca o painel. |

O agente leve existe para o colega de engenharia/produto/financeiro que
precisa acompanhar o caso por dentro sem virar atendente.

## 2. Modelos

```
User
 ├─ kind            internal | client         (já existia)
 ├─ internal_role    admin|supervisor|agent|light_agent   ← ganhou light_agent
 ├─ client_role      owner|member             (já existia)
 ├─ custom_role  ──► CustomRole (nullable)    ← novo
 ├─ ticket_scope     ''|all|teams|assigned    ← novo (vazio = herda do papel)
 └─ teams  ──► Team via AgentTeam (N:N)       (já existia)

CustomRole                                     ← novo
 ├─ name / slug / description
 ├─ base_role        de qual papel embutido deriva (documental)
 ├─ permissions      JSON: lista de valores de rbac.Perm
 ├─ ticket_scope     '' | all | teams | assigned
 └─ is_active
```

**Por que `permissions` é JSON e não uma tabela `Permission`:** permissão é
contrato da aplicação, não dado do cliente. Uma tabela exigiria migração a
cada tela nova e poderia divergir do código que a consome. `CustomRole`
**combina** permissões do catálogo; nunca inventa uma.

**Por que `internal_role` continua existindo com papel personalizado:** ele é
a identidade base (o que a CheckConstraint do banco exige, o que `is_admin`
responde, o que a tela mostra como "derivado de"); o papel personalizado
responde só "o que pode". Separar os dois é o que permite um papel
personalizado existir sem reescrever toda leitura de `internal_role`.

### Migração

`accounts/0011_rbac_custom_role` — puramente aditiva. Usuários existentes
ficam com `custom_role=NULL` e `ticket_scope=''`, que significa "herda do
papel": comportamento idêntico ao de antes (provado pelos 965 testes que
passaram sem alteração).

## 3. Escopo ≠ permissão

Permissão é sim/não. **Escopo é recorte de linhas**, e recorte de linha só
existe num lugar: `TicketQuerySet.visible_to()`.

| Escopo | Recorte |
|---|---|
| `all` | a fila inteira |
| `teams` | as equipes em que a pessoa tem vínculo (a regra D1 de sempre) |
| `assigned` | **dentro das equipes dela**, só o que está com ela (assignee ou dono técnico) |

`assigned` é interseção, não substituição: a fronteira de equipe é uma
parede, e "atribuído a mim" nunca deve furá-la.

Precedência: `User.ticket_scope` → `CustomRole.ticket_scope` → padrão do papel.

**Combinação proibida:** escopo `assigned` num papel sem
`ticket.be_assigned` dá uma fila **sempre vazia**. Barrado no cadastro
(`rbac.validate_scope_for_role`), não corrigido em silêncio na leitura —
esconder erro de configuração é pior do que mostrá-lo.

## 4. As três camadas

```
HTTP  ──►  HasPerm (apps/core/permissions.py)     403 cedo, sem tocar o banco
           ↓
API   ──►  _exige(user, Perm.X) nas ações
           ↓
DOMÍNIO ─► ticket_service.* / Ticket.can_reply_publicly()   ← a tranca real
           ↓
LEITURA ─► visible_to()                            o escopo
```

A camada de domínio é a que importa: quem chama o serviço por fora da API
(management command, worker do Celery, shell) não passa pelo DRF. Camada 1
sem camada 3 é tranca na porta com a janela aberta.

## 5. Como verificar, no código

```python
# Python — em qualquer lugar
from apps.accounts.rbac import Perm

if user.can(Perm.TICKET_REPLY_PUBLIC):
    ...

# Numa view DRF
from apps.core.permissions import HasPerm, HasAnyPerm, PermReadWrite

class MinhaView(APIView):
    permission_classes = [HasPerm.of(Perm.REPORT_VIEW)]

class OutraView(APIView):
    permission_classes = [HasAnyPerm.of(Perm.TICKET_VIEW, Perm.AUDIT_VIEW)]

class Configuracao(viewsets.ModelViewSet):
    permission_classes = [PermReadWrite.of(Perm.PANEL_ACCESS, Perm.SETTINGS_MANAGE)]
```

```tsx
// React
import { Perm } from '../auth/permissions'
const { can } = useAuth()

{can(Perm.TICKET_REPLY_PUBLIC) && <AbaResponderCliente />}

<RequirePerm perm={Perm.REPORT_VIEW}><RelatoriosPage /></RequirePerm>
```

⚠️ O front é **UI, não segurança**: esconder o botão evita que a pessoa
clique num 403 garantido. O backend recusa de novo em toda requisição.

## 6. Adicionar uma permissão

1. Uma linha em `rbac.Perm`.
2. Conceder em `ROLE_PERMISSIONS` a quem deve ter (admin já ganha sozinho).
3. Consumir com `user.can(...)` / `HasPerm.of(...)`.

Sem migração: o valor guardado em `CustomRole.permissions` é a string, e a
tela de papéis monta os checkboxes a partir de `GET /settings/choices/`.

## 7. API

| Endpoint | O que faz |
|---|---|
| `GET /auth/me/` | inclui `permissions[]`, `ticket_scope`, `custom_role_name` |
| `GET /settings/choices/` | catálogo: `permissions`, `ticket_scopes`, `role_permissions`, `role_default_scopes` |
| `GET/POST/PATCH/DELETE /settings/roles/` | CRUD de `CustomRole` (exige `role.manage`) |

`role.manage` é separada de `settings.manage` de propósito: mexer em papel é
escalonamento de privilégio (quem edita papel se auto-promove), então merece
ser negável a um papel personalizado "quase admin".
