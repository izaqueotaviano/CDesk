"""Seed de dados de demonstração — SOMENTE para ambiente de desenvolvimento.

Cria empresas (uma por plano), usuários internos e clientes, tickets em todos os
status (inclusive um restrito do Financeiro e um reaberto), consumo de cota, um
aviso, um quadro kanban e CONVERSAS DE CHAT (uma em andamento, com histórico de
vários dias, links e anexo; outra já encerrada e avaliada, para o histórico do
cliente ter mais de uma). Senha de todos os usuários de demo: `resolv123`.

Recusa-se a rodar com DEBUG=False. Idempotente: pode rodar mais de uma vez.
"""

import datetime as dt

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.accounts.models import AgentTeam, ClientRole, InternalRole, Team, User, UserKind
from apps.announcements.models import Announcement, AnnouncementKind, AudienceKind
from apps.chat.models import (
    Chat,
    ChatFile,
    ChatMessage,
    ChatRating,
    ChatScanStatus,
    ChatStatus,
)
from apps.customers.models import Company, Plan
from apps.customers.services import quota as quota_service
from apps.kanban.models import Board, Card
from apps.tickets.models import (
    Ticket,
    TicketCategory,
    TicketMacro,
    TicketMessage,
    TicketPriority,
    TicketSource,
    TicketStatus,
    TicketStatusEvent,
    TicketTag,
)
from apps.tickets.services import ticket_service
from apps.tickets.services.references import next_reference

PASSWORD = "resolv123"  # noqa: S105 — senha pública de demo, DEBUG-only


class Command(BaseCommand):
    help = "Popula dados de demonstração (apenas DEBUG=True)."

    @transaction.atomic
    def handle(self, *args, **options):
        # A trava é contra rodar dados fictícios (com senha pública!) num
        # ambiente de produção real. O ambiente de DEMONSTRAÇÃO é a exceção
        # legítima: ele NÃO é DEBUG, mas opta explicitamente via settings.
        permitido = settings.DEBUG or getattr(settings, "DEMO_SEED_ALLOWED", False)
        if not permitido:
            raise CommandError(
                "seed_demo é só para desenvolvimento ou ambiente de demonstração "
                "(DEBUG=True ou DEMO_SEED_ALLOWED=True)."
            )
        if not Plan.objects.exists():
            raise CommandError("Rode `seed_defaults` antes.")

        now = timezone.now()
        suporte = Team.objects.get(slug="suporte")
        financeiro = Team.objects.get(slug="financeiro")

        # ------------------------------------------------------------------ #
        # Internos
        # ------------------------------------------------------------------ #
        # Não há mais uma equipe "Atendimento" à parte para lotar todo mundo: a
        # equipe É o agrupamento de atendimento, então quem trabalha no Suporte
        # tem vínculo com o Suporte e ponto. Uma lotação paralela era metade da
        # confusão que a fusão desfez.

        def internal(email, name, role, **extra):
            user, created = User.objects.update_or_create(
                email=email,
                defaults={
                    "full_name": name,
                    "kind": UserKind.INTERNAL,
                    "internal_role": role,
                    "is_staff": role == InternalRole.ADMIN,
                    # Sem foto: as iniciais na cor de identidade da pessoa. Os
                    # avatares "prontos" (`/avatars/avatar-0N-*.svg`) nunca foram
                    # publicados pelo front, e apontar para eles dava imagem
                    # quebrada na conversa.
                    "avatar_url": "",
                    **extra,
                },
            )
            if created:
                user.set_password(PASSWORD)
                user.save(update_fields=["password"])
            return user

        admin = internal("admin@demo.resolv.test", "Alice Admin", InternalRole.ADMIN,
                         is_superuser=True)
        supervisor = internal("supervisor@demo.resolv.test", "Sofia Supervisora",
                              InternalRole.SUPERVISOR)
        agente_sup = internal("agente.suporte@demo.resolv.test", "Samuel Suporte",
                              InternalRole.AGENT)
        agente_fin = internal("agente.financeiro@demo.resolv.test", "Fátima Financeiro",
                              InternalRole.AGENT)
        for equipe in (suporte, financeiro):
            equipe.supervisor = supervisor
            equipe.save(update_fields=["supervisor"])

        # D1: visibilidade interna segue estes vínculos. Sofia está nas DUAS
        # equipes — é o caso que a lotação única não sabia representar.
        for user, equipes in [
            (supervisor, [suporte, financeiro]),
            (agente_sup, [suporte]),
            (agente_fin, [financeiro]),
        ]:
            for equipe in equipes:
                AgentTeam.objects.update_or_create(
                    user=user, team=equipe,
                    defaults={"is_default": equipe == equipes[0]},
                )

        # ------------------------------------------------------------------ #
        # Empresas clientes — uma por plano
        # ------------------------------------------------------------------ #
        companies = {}
        for slug, name, plan_slug in [
            ("acme", "Acme Marketing", "black"),
            ("bravo", "Bravo Educação", "gold"),
            ("cetus", "Cetus Contábil", "platinum"),
        ]:
            companies[slug], _ = Company.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "plan": Plan.objects.get(slug=plan_slug),
                    "account_manager": supervisor,
                    "contract_started_at": now.date() - dt.timedelta(days=200),
                },
            )

        def client(email, name, company, role=ClientRole.MEMBER):
            user, created = User.objects.update_or_create(
                email=email,
                defaults={
                    "full_name": name,
                    "kind": UserKind.CLIENT,
                    "company": company,
                    "client_role": role,
                },
            )
            if created:
                user.set_password(PASSWORD)
                user.save(update_fields=["password"])
            return user

        ana = client("ana@acme.test", "Ana Almeida", companies["acme"], ClientRole.OWNER)
        beto = client("beto@acme.test", "Beto Barros", companies["acme"])
        carla = client("carla@bravo.test", "Carla Costa", companies["bravo"], ClientRole.OWNER)
        davi = client("davi@cetus.test", "Davi Dias", companies["cetus"], ClientRole.OWNER)

        # ------------------------------------------------------------------ #
        # Tickets — um de cada situação relevante
        # ------------------------------------------------------------------ #
        if Ticket.objects.exists():
            self.stdout.write("Tickets já existem; pulando a criação de tickets de demo.")
        else:
            def ticket(requester, team, subject, status, *, created_ago_h,
                       assignee=None, source=TicketSource.WEB, consume=True):
                created = now - dt.timedelta(hours=created_ago_h)
                t = Ticket.objects.create(
                    reference=next_reference(),
                    company=requester.company,
                    requester=requester,
                    team=team,
                    subject=subject,
                    status=status,
                    # o stage é o status que a TELA mostra. Sem ele o chamado
                    # dependia do resgate do quadro para não sumir e não era
                    # contado em Configurações → Status, que mostrava zero em
                    # colunas cheias. Quem cria fora do serviço tem de dizer.
                    stage=ticket_service.stage_padrao(status),
                    source=source,
                    assignee=assignee,
                )
                # auto_now_add ignora valor passado; backdate explícito para o demo
                Ticket.objects.filter(pk=t.pk).update(created_at=created)
                t.refresh_from_db()
                TicketStatusEvent.objects.create(
                    ticket=t, from_status=None, to_status=TicketStatus.NEW
                )
                if consume:
                    # mesma transação, mesmo caminho do fluxo real (docs/05 §2.2)
                    quota_service.check_and_consume(ticket=t, actor=requester)
                return t

            def reply(t, author, body, *, hours_ago, public=True):
                msg = TicketMessage.objects.create(
                    ticket=t, author=author, body=body, is_public=public,
                )
                TicketMessage.objects.filter(pk=msg.pk).update(
                    created_at=now - dt.timedelta(hours=hours_ago)
                )
                if author.is_internal and public and t.first_response_at is None:
                    t.first_response_at = now - dt.timedelta(hours=hours_ago)
                    TicketMessage.objects.filter(pk=msg.pk).update(is_first_response=True)
                    t.save(update_fields=["first_response_at"])
                return msg

            def move(t, from_s, to_s, by, *, hours_ago, reopen=False, automatic=False):
                TicketStatusEvent.objects.create(
                    ticket=t, from_status=from_s, to_status=to_s, changed_by=by,
                    is_reopen=reopen, is_automatic=automatic,
                )
                TicketStatusEvent.objects.filter(ticket=t).last()
                t.status = to_s
                t.save(update_fields=["status"])

            # 1. Novo, ninguém respondeu ainda
            ticket(ana, suporte, "Página do formulário fora do ar",
                        TicketStatus.NEW, created_ago_h=2)

            # 2. Aberto, com primeira resposta dada
            t2 = ticket(beto, suporte, "Dúvida sobre integração com o CRM",
                        TicketStatus.OPEN, created_ago_h=30, assignee=agente_sup)
            reply(t2, beto, "Como conecto o CRM de vocês ao nosso funil?", hours_ago=30)
            reply(t2, agente_sup, "Olá! Pode me dizer qual CRM vocês usam?", hours_ago=28)
            move(t2, TicketStatus.NEW, TicketStatus.OPEN, agente_sup, hours_ago=28)

            # 3. Aguardando retorno do cliente
            t3 = ticket(carla, suporte, "Relatório mensal não chegou",
                        TicketStatus.PENDING_CUSTOMER, created_ago_h=50,
                        assignee=agente_sup)
            reply(t3, carla, "O relatório de julho não chegou no meu e-mail.", hours_ago=50)
            reply(t3, agente_sup, "Verificamos o envio. Pode confirmar se o e-mail "
                  "cadastrado é este mesmo?", hours_ago=47)
            move(t3, TicketStatus.NEW, TicketStatus.OPEN, agente_sup, hours_ago=47)
            move(t3, TicketStatus.OPEN, TicketStatus.PENDING_CUSTOMER, agente_sup,
                 hours_ago=47)

            # 4. Fechado com dados de resolução (D4)
            t4 = ticket(davi, suporte, "Erro 500 ao exportar planilha",
                        TicketStatus.CLOSED, created_ago_h=120, assignee=agente_sup)
            reply(t4, davi, "Exportar em XLSX dá erro 500.", hours_ago=120)
            reply(t4, agente_sup, "Reproduzimos o problema, corrigindo.", hours_ago=118)
            move(t4, TicketStatus.NEW, TicketStatus.OPEN, agente_sup, hours_ago=118)
            reply(t4, agente_sup, "Corrigido! Pode testar de novo.", hours_ago=100)
            t4.resolution_started_at = now - dt.timedelta(hours=118)
            t4.resolution_ended_at = now - dt.timedelta(hours=100)
            t4.closed_at = now - dt.timedelta(hours=100)
            t4.closed_by = agente_sup
            t4.save()
            move(t4, TicketStatus.OPEN, TicketStatus.CLOSED, agente_sup, hours_ago=100)

            # 5. Reaberto: cliente respondeu ticket fechado (automático, sem nova cota)
            t5 = ticket(ana, suporte, "Logo errada no rodapé do site",
                        TicketStatus.CLOSED, created_ago_h=200, assignee=agente_sup)
            reply(t5, ana, "A logo antiga ainda aparece no rodapé.", hours_ago=200)
            reply(t5, agente_sup, "Atualizada! Limpe o cache e confira.", hours_ago=190)
            t5.resolution_started_at = now - dt.timedelta(hours=198)
            t5.resolution_ended_at = now - dt.timedelta(hours=190)
            t5.closed_at = now - dt.timedelta(hours=190)
            t5.closed_by = agente_sup
            t5.save()
            move(t5, TicketStatus.OPEN, TicketStatus.CLOSED, agente_sup, hours_ago=190)
            reply(t5, ana, "Ainda aparece a antiga no celular!", hours_ago=20)
            move(t5, TicketStatus.CLOSED, TicketStatus.OPEN, None, hours_ago=20,
                 reopen=True, automatic=True)
            t5.reopen_count = 1
            t5.last_reopened_at = now - dt.timedelta(hours=20)
            t5.sla_cycle = 2  # D5: SLA de resolução reinicia no novo ciclo
            t5.save(update_fields=["reopen_count", "last_reopened_at", "sla_cycle"])

            # 6. Financeiro (restrito): outros usuários da Acme veem mascarado
            t6 = ticket(ana, financeiro, "Cobrança duplicada na fatura de julho",
                        TicketStatus.OPEN, created_ago_h=10, assignee=agente_fin)
            reply(t6, ana, "A fatura veio com o mesmo item duas vezes.", hours_ago=10)
            reply(t6, agente_fin, "Confirmado o estorno, aparece em 3 dias úteis.",
                  hours_ago=6)
            move(t6, TicketStatus.NEW, TicketStatus.OPEN, agente_fin, hours_ago=6)

            self.stdout.write(f"Tickets criados: {Ticket.objects.count()}")

        # ------------------------------------------------------------------ #
        # Aviso no mural + quadro kanban
        # ------------------------------------------------------------------ #
        Announcement.objects.update_or_create(
            title="Recesso de fim de ano",
            defaults={
                "body": "Entre 24/12 e 02/01 o atendimento funciona em horário reduzido.",
                "kind": AnnouncementKind.HOLIDAY,
                "audience_kind": AudienceKind.ALL,
                "starts_at": now,
                "ends_at": now + dt.timedelta(days=30),
                "is_pinned": True,
                "created_by": admin,
            },
        )

        board, _ = Board.objects.update_or_create(
            slug="suporte-semana",
            defaults={"name": "Suporte · semana", "team": suporte,
                      "created_by": admin},
        )
        # não há colunas para criar: elas são os status do ticket
        # (tickets.TicketStage), que a migração 0016 já semeou
        # No modelo atual o quadro DERIVA dos tickets — a coluna vem do status,
        # nunca de uma fixação. O card de demo é só a anotação que o status não
        # sabe responder: o prazo interno.
        if not Card.objects.exists():
            open_tickets = Ticket.objects.filter(
                team=suporte, status=TicketStatus.OPEN
            )[:2]
            for t in open_tickets:
                Card.objects.update_or_create(
                    board=board, ticket=t,
                    defaults={
                        "due_at": now + dt.timedelta(days=2),
                        "added_by": supervisor,
                    },
                )

        # ------------------------------------------------------------------ #
        # Chat: uma conversa VIVA com histórico longo e uma já encerrada
        # ------------------------------------------------------------------ #
        # Sem isto a tela de chat abre vazia numa instalação nova, e o que
        # depende de conversa acumulada — o "carregar mensagens anteriores",
        # as faixas de dia, a busca dentro da conversa, o painel de arquivos e
        # links, a lista de conversas anteriores — não tem o que mostrar.
        def fala(chat, autor, corpo, *, dias, hora):
            mensagem = ChatMessage.objects.create(chat=chat, author=autor, body=corpo)
            # `sent_at` é auto_now_add: só um UPDATE puxa a mensagem para trás
            ChatMessage.objects.filter(pk=mensagem.pk).update(
                sent_at=now - dt.timedelta(days=dias, hours=hora)
            )
            return mensagem

        if not Chat.objects.exists():
            # ---- a conversa encerrada e avaliada (o "histórico" do cliente)
            antiga = Chat.objects.create(
                client=beto, company=companies["acme"], agent=agente_sup,
                status=ChatStatus.CLOSED, name="Acesso ao painel",
                accepted_at=now - dt.timedelta(days=21),
                closed_at=now - dt.timedelta(days=21),
            )
            Chat.objects.filter(pk=antiga.pk).update(
                queued_at=now - dt.timedelta(days=21, hours=1)
            )
            fala(antiga, beto, "Perdi o acesso ao painel, dá para resetar?", dias=21, hora=1)
            fala(antiga, agente_sup, "Resetei agora, tente de novo por favor.", dias=21, hora=0)
            fala(antiga, beto, "Funcionou, obrigado!", dias=20, hora=23)
            ChatRating.objects.create(
                chat=antiga, service_score=10, resolution_score=9,
                justification="",
            )

            # ---- a conversa em andamento, com nove dias de história
            viva = Chat.objects.create(
                client=beto, company=companies["acme"], agent=agente_fin,
                status=ChatStatus.ACTIVE, name="Nota fiscal",
                accepted_at=now - dt.timedelta(days=9),
            )
            Chat.objects.filter(pk=viva.pk).update(
                queued_at=now - dt.timedelta(days=9, hours=9)
            )
            roteiro = [
                (beto, "Bom dia! Não consigo emitir a nota fiscal desde ontem."),
                (agente_fin, "Bom dia, Beto. Vou verificar agora mesmo."),
                (beto, "O erro aparece quando clico em Emitir."),
                (agente_fin, "Consegue mandar um print da tela?"),
                (agente_fin, "O passo a passo está aqui: "
                             "https://docs.resolv.test/nota-fiscal"),
                (beto, "Perfeito, vou seguir."),
                (beto, "Também deixei o comprovante em "
                       "www.banco.test/comprovante-8891"),
                (agente_fin, "Recebido. Obrigado pela ação rápida."),
            ]
            for dias in range(9, 0, -1):
                for hora, (autor, corpo) in enumerate(roteiro):
                    fala(viva, autor, corpo, dias=dias, hora=8 - hora)
            ultima = fala(viva, beto, "Segue a nota em anexo.", dias=0, hora=1)
            anexo = ChatFile.objects.create(
                message=ultima, filename="nota-fiscal-8891.pdf",
                content_type="application/pdf", size_bytes=13,
                uploaded_by=beto, scan_status=ChatScanStatus.CLEAN,
            )
            anexo.file.save(
                "nota-fiscal-8891.pdf", ContentFile(b"%PDF-1.4 demo"), save=True,
            )
            self.stdout.write(f"Chats criados: {Chat.objects.count()} "
                              f"({ChatMessage.objects.count()} mensagens)")

        # ── base de conhecimento ────────────────────────────────────────
        # Em produção os artigos vêm do WordPress (knowledge/services/
        # wordpress_sync.py). Aqui nascem à mão para a tela ter o que
        # mostrar em desenvolvimento — sem isso ela fica permanentemente
        # vazia e ninguém descobre que ela existe.
        from apps.knowledge.models import Article

        if not Article.objects.exists():
            artigos = [
                ("Como abrir um ticket pelo portal",
                 "Primeiros passos",
                 "O caminho do cliente: entrar, escolher o assunto e anexar o que ajudar.",
                 "<h2>Antes de abrir</h2><p>Confira se o ticket já não existe: "
                 "responder no ticket aberto é mais rápido que abrir outro.</p>"
                 "<h2>Abrindo</h2><ol><li>Entre no portal.</li>"
                 "<li>Descreva o problema em uma frase no assunto.</li>"
                 "<li>Anexe print ou arquivo, se houver.</li></ol>"),
                ("O que é SLA de primeira resposta",
                 "SLA e prazos",
                 "Os dois relógios de um ticket e quando cada um começa a contar.",
                 "<p>Todo ticket tem <strong>dois</strong> prazos independentes.</p>"
                 "<h2>Primeira resposta</h2><p>Da abertura até a primeira resposta "
                 "pública de um agente. Nota interna não conta.</p>"
                 "<h2>Resolução</h2><p>Da abertura ao fechamento.</p>"
                 "<p>Os dois contam em horas úteis, pelo calendário comercial.</p>"),
                ("Reabertura: como funciona",
                 "SLA e prazos",
                 "Responder num ticket fechado o reabre e começa um ciclo novo.",
                 "<p>Não existe botão de reabrir sozinho: reabrir é "
                 "<strong>responder publicamente</strong> num ticket fechado.</p>"
                 "<p>A reabertura começa um <em>novo ciclo de SLA</em>. O histórico "
                 "do ciclo anterior fica preservado.</p>"),
                ("Anexos bloqueados pelo antivírus",
                 "Anexos",
                 "Por que um arquivo aparece cinza e não abre.",
                 "<p>Todo anexo passa por varredura antes de ficar disponível.</p>"
                 "<p>Enquanto não termina, o arquivo aparece como "
                 "<em>em verificação</em>. Se a varredura barra, ele fica em "
                 "quarentena e não pode ser baixado, nem por quem enviou.</p>"),
                ("Macros: respostas prontas que também mudam campos",
                 "Atendimento",
                 "Macro não é só texto: ela grava prioridade, responsável e etiquetas.",
                 "<p>Aplicar uma macro faz duas coisas ao mesmo tempo:</p>"
                 "<ul><li>insere o texto no campo de resposta;</li>"
                 "<li>grava no servidor os campos que ela define.</li></ul>"
                 "<p>Por isso a macro tem efeito mesmo se você apagar o texto.</p>"),
                ("Quem enxerga o quê: equipes e escopo",
                 "Atendimento",
                 "Por que um ticket aparece mascarado com cadeado.",
                 "<p>Um agente enxerga os tickets das equipes de que participa.</p>"
                 "<p>Ticket de equipe em que você não está aparece "
                 "<strong>mascarado</strong>, com cadeado. Não é erro, é o "
                 "comportamento esperado. Peça acesso a um supervisor da equipe.</p>"),
            ]
            for i, (titulo, categoria, resumo, corpo) in enumerate(artigos, start=1):
                Article.objects.create(
                    wp_post_id=9000 + i,
                    wp_url=f"https://blog.resolv.test/?p={9000 + i}",
                    title=titulo,
                    slug=slugify(titulo),
                    excerpt=resumo,
                    body_html=corpo,
                    category=categoria,
                    tags=[categoria.lower()],
                    wp_published_at=timezone.now() - dt.timedelta(days=30 - i),
                    wp_modified_at=timezone.now() - dt.timedelta(days=15 - i),
                    synced_at=timezone.now(),
                )
            self.stdout.write(f"Artigos criados: {Article.objects.count()}")

        # ── macros ──────────────────────────────────────────────────────
        # Sem isto o catálogo nascia vazio, e vazio aqui não parece "não tem
        # nada cadastrado": parece defeito. O seletor "Aplicar macro" fica
        # desabilitado, o agente clica e não abre nada — foi exatamente o que
        # aconteceu na primeira vez que alguém testou o sistema rodando.
        #
        # As quatro cobrem os campos que a macro sabe gravar, uma cada:
        # texto puro, texto + prioridade, texto + etiqueta, e nome de chat.
        if not TicketMacro.objects.exists():
            duvida = TicketCategory.objects.filter(name="Dúvida").first()
            financeiro_tag = TicketTag.objects.filter(name="Financeiro").first()

            TicketMacro.objects.create(
                name="Pedir mais informação",
                body=(
                    "Olá, {{solicitante}}! Para seguir com este ticket preciso de "
                    "mais um detalhe:\n\n- \n\nAssim que você responder, retomo daqui."
                ),
                category=duvida,
                order=1,
            )
            TicketMacro.objects.create(
                name="Confirmar que foi resolvido",
                body=(
                    "Oi, {{solicitante}}! Apliquei a correção e testei do nosso lado. "
                    "Pode conferir e me dizer se ficou certo aí na {{empresa}}?"
                ),
                order=2,
            )
            cobranca = TicketMacro.objects.create(
                name="Cobrança em análise",
                body=(
                    "Recebemos o apontamento sobre {{referencia}} e o financeiro já "
                    "está conferindo. Retornamos com a posição ainda hoje."
                ),
                priority=TicketPriority.HIGH,
                order=3,
            )
            if financeiro_tag:
                cobranca.tags.add(financeiro_tag)
            TicketMacro.objects.create(
                name="Chat · abertura",
                body="Oi, {{solicitante}}! Já estou vendo aqui. Um minuto.",
                chat_name="Atendimento · {{empresa}}",
                order=4,
            )
            self.stdout.write(f"Macros criadas: {TicketMacro.objects.count()}")

        self.stdout.write(self.style.SUCCESS(
            "Demo ok. Login no admin: admin@demo.resolv.test / "
            f"{PASSWORD} (todos os usuários de demo usam a mesma senha)."
        ))
