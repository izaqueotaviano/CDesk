# 15 — Deploy de produção

A demo do Railway (`docs/10-deploy-railway.md`) é um contêiner só, com senha
pública e sem worker — vitrine, não produção. Este documento é o outro
deploy: a topologia real, descrita (mas até aqui nunca automatizada) em
`docs/14-seguranca.md` — **nginx → uvicorn → PostgreSQL/Redis em rede
privada**, com os dois papéis de banco de `deploy/postgres/01_papeis.sql`.

**O que este documento automatiza**: o que fazer a cada deploy (`deploy/deploy.sh`)
e o backup diário (`scripts/backup_postgres.sh`). **O que ele não automatiza**:
provisionar o servidor do zero. Antes de rodar qualquer coisa aqui, alguém
já precisa ter feito, uma vez, à mão:

- um servidor Linux com **nginx**, **Node 22 LTS** (`docs/12-ambiente.md`) e
  **Python 3.11+** instalados;
- **PostgreSQL** no ar, com `deploy/postgres/01_papeis.sql` já executado
  (cria `resolv_owner`/`resolv_app`/`resolv_leitura`) e, idealmente,
  `deploy/postgres/postgresql.hardening.conf` + `pg_hba.conf.example`
  aplicados;
- **Redis** no ar, com senha (`requirepass`);
- o usuário de sistema sem privilégio que os três `.service` abaixo
  assumem — este documento chama esse usuário de **`resolv`**, criado, por
  exemplo, com `useradd --system --create-home --home-dir /home/resolv
  --shell /usr/sbin/nologin resolv` (o mesmo raciocínio que o `Dockerfile`
  já aplica dentro do contêiner);
- um certificado TLS válido para o domínio real (`certbot`/Let's Encrypt,
  por exemplo) — `deploy/nginx/resolv.conf` espera os arquivos em
  `/etc/letsencrypt/live/<domínio>/`;
- `/etc/resolv/.env`, copiado de `.env.production.example` e **preenchido de
  verdade** (segredos, domínio, `DATABASE_URL`/`DATABASE_URL_MIGRATE`,
  `REDIS_URL`…), com `chmod 600` e dono `resolv`.

Nada disso `deploy.sh` instala sozinho — ele leria como automação de
provisionamento, que é bem mais arriscado de acertar em um script genérico
(discos, firewall, backup do próprio SO, hardening do kernel…) do que "o que
fazer a cada novo commit publicado", que é o que ele resolve de fato.

## 1. Layout no servidor

```
/srv/resolv/                  ← DEPLOY_APP_DIR (clone git; dono: resolv depois do 1º deploy)
├── venv/                     ← DEPLOY_VENV_DIR (criado pelo deploy.sh)
├── frontend/dist/             ← build da SPA (deploy/nginx/resolv.conf serve daqui: `root`)
└── staticfiles/               ← collectstatic (nginx `location /static/` também aponta aqui)
/var/lib/resolv/media/        ← MEDIA_ROOT — fora do webroot, nunca servido pelo nginx (404 em /media/)
/etc/resolv/.env              ← 0600, dono resolv — EnvironmentFile dos 3 .service e lido por deploy.sh
/var/backups/resolv/          ← BACKUP_DIR (scripts/backup_postgres.sh)
```

Esses caminhos são os defaults dos scripts (`DEPLOY_APP_DIR`, `BACKUP_DIR`
etc. — todos configuráveis por variável de ambiente, ver o comentário no
topo de cada script); nada aqui é obrigatório por código, só é o que os
outros arquivos deste diretório (`deploy/nginx/resolv.conf`, os três
`.service`) já assumem sem precisar reconfigurar nada.

## 2. Primeira vez

```sh
# 1. provisionamento manual (seção acima) — SO, Postgres, Redis, nginx, TLS,
#    usuário "resolv", /etc/resolv/.env preenchido

# 2. instala as três unidades systemd (uma vez; deploy.sh só reinicia depois)
sudo cp deploy/systemd/resolv-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable resolv-web resolv-celery-worker resolv-celery-beat
# (deploy.sh dá o primeiro `restart` nelas — não precisa de `--now` aqui)

# 3. primeiro deploy: clona, instala, migra, builda o front, sobe tudo
sudo DEPLOY_REPO_URL=git@github.com:sua-org/resolv.git deploy/deploy.sh
```

Na primeira execução, `deploy/deploy.sh` clona o repositório em
`DEPLOY_APP_DIR` (`DEPLOY_REPO_URL` só é lida quando o diretório ainda não
existe) e instala `deploy/nginx/resolv.conf` + os dois snippets em
`/etc/nginx/` **se eles ainda não existirem lá** — depois de instalados,
ajuste `server_name`, os caminhos do certificado e o `connect-src` da CSP
para o domínio real antes de seguir (o arquivo do repositório é um
*template*, com `app.exemplo.com.br` de exemplo; ver o comentário no topo
dele). Rode `deploy.sh` de novo depois de ajustar — ele testa e recarrega o
que já está em `/etc/nginx/`, nunca sobrescreve o que já existe.

## 3. Deploys seguintes

```sh
sudo deploy/deploy.sh              # publica o HEAD do branch já em uso no servidor
sudo deploy/deploy.sh v1.4.0       # publica uma tag/branch/commit específico
```

O que acontece, em ordem (cada etapa aborta o script inteiro se falhar —
`deploy/deploy.sh` não segue tentando os passos seguintes numa base já
quebrada):

1. `git fetch` + `git reset --hard` para o ref pedido (ou o branch atual)
2. `pip install -e ".[reports,antivirus,monitoring]"` num venv — os mesmos
   extras de produção do `Dockerfile`/CI (`.[dev,reports,antivirus]`), **sem
   `dev`**; `monitoring` entra a mais aqui porque isto é produção de
   verdade e o `sentry-sdk` é *no-op* sem `SENTRY_DSN` (ver
   `config/settings/base.py`) — instalado sem configurar não custa nada, o
   inverso (configurar sem instalar) fica mudo calado
3. `manage.py check --deploy` — a mesma checagem do checklist manual do
   `docs/14-seguranca.md` §8/§9, agora automática e **bloqueando o deploy**
   em vez de depender de alguém lembrar de rodar à mão
4. build do frontend (`npm ci && npm run build` em `frontend/`) — pulável
   com `DEPLOY_SKIP_FRONTEND=1` se outro pipeline publica `frontend/dist`.
   O build **não precisa de variável nenhuma**: sem `VITE_API_BASE_URL` e
   `VITE_WS_BASE_URL`, a SPA fala com a própria origem (`/api/` e `/ws/`
   no mesmo host — exatamente o que `deploy/nginx/resolv.conf` faz). Só
   crie `frontend/.env.production` com essas duas se a API viver em OUTRO
   host que não o da SPA — e aí `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS`
   precisam da origem da SPA. (Antes da Rodada 13 o fallback era
   `localhost:8000`, e um build sem `.env.production` saía apontando pra
   máquina de quem buildou — o WebSocket ficava em "reconectando" pra sempre.)
   por fora
5. `manage.py migrate --noinput` com `DATABASE_URL_MIGRATE` (papel
   `resolv_owner`) — nunca com o papel de aplicação, mesmo padrão de
   `docs/14-seguranca.md` §4
6. `manage.py collectstatic --noinput`
7. `nginx -t` e só então `systemctl reload nginx` — uma config quebrada
   nunca chega a ser recarregada; o processo antigo continua servindo
   enquanto alguém corrige
8. `systemctl restart` nas três unidades (falha com uma mensagem clara se
   alguma não tiver sido instalada — passo único, seção 2)
9. **smoke check**: até 10 tentativas (2 s entre elas) batendo em
   `http://127.0.0.1:8000/health/` — direto no uvicorn, **não** através do
   domínio público, porque `deploy/nginx/resolv.conf` não tem `location`
   para `/health/` (ela é para uso interno do orquestrador; ver o
   comentário de `SECURE_REDIRECT_EXEMPT` em `config/settings/prod.py`).
   Só reporta sucesso se vier `200`.

Idempotente: rodar `deploy.sh` de novo sem nada ter mudado não tem efeito
colateral — `git reset --hard`, `pip install`, `migrate` e `collectstatic`
já são idempotentes por natureza, o passo do nginx só instala o que falta, e
reiniciar uma unidade saudável apenas a reinicia.

## 4. Backup

```sh
# variáveis lidas do ambiente (systemd EnvironmentFile ou cron) — ver o
# comentário no topo do script para as duas formas de agendar
DATABASE_URL=<papel resolv_app> scripts/backup_postgres.sh
```

`scripts/backup_postgres.sh` roda `pg_dump` com o papel de **aplicação**
(`resolv_app`), não o dono do schema — um dump só precisa ler tabela, e
pg_dump lê a definição dos objetos no catálogo do Postgres, legível por
qualquer papel com `CONNECT` no banco. Comprime com gzip, nomeia com
data/hora, grava em `BACKUP_DIR` (default `/var/backups/resolv`) e apaga o
que passou de `BACKUP_ROTATION_DAYS` — **a mesma variável e o mesmo valor
padrão (30) que `config/settings/base.py` já usa** para informar ao titular
de dados, no pacote de portabilidade LGPD, até quando uma cópia dele
sobrevive depois de excluído do banco (D21, `docs/04-decisoes-tomadas.md`,
`docs/09-lgpd-operacionalizacao.md` §5-B) — mantenha os dois em sincronia,
ou o que a tela promete deixa de bater com o que o cron faz de verdade.

Falha alta de propósito: se o `pg_dump` falhar, o script sai com erro e
**não** deixa nenhum arquivo `.sql.gz` no lugar do backup daquele dia — um
backup corrompido/vazio é pior que a ausência óbvia de um backup, porque só
aparece no dia do restore.

Agendamento — escolha uma das duas formas (ambas documentadas com exemplo
completo no topo do próprio script):

- **cron**, no crontab do usuário `resolv`, lendo `/etc/resolv/.env`;
- **systemd timer** (recomendado — mesmo padrão dos outros três `.service`
  deste diretório): `deploy/systemd/resolv-backup.service` (`Type=oneshot`)
  + `resolv-backup.timer` (`OnCalendar=*-*-* 23:00:00`, batendo com o D21-B
  — "diário às 23h", `Persistent=true` recupera sozinho um horário perdido
  se o servidor estava desligado). Instale com o mesmo par de comandos dos
  outros três:

  ```sh
  cp deploy/systemd/resolv-backup.service deploy/systemd/resolv-backup.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now resolv-backup.timer
  ```

  Testado ao vivo (rehearsal completo, não só leitura): como o usuário
  `resolv`, com as mesmas variáveis do `EnvironmentFile`, o script gerou um
  `.sql.gz` íntegro com o dono e a permissão corretos (`resolv:resolv`,
  `600`) — o mecanismo funciona; só falta rodar num systemd de verdade
  (`systemctl enable --now`) no servidor real, algo que nenhum sandbox de
  desenvolvimento consegue simular (não roda com systemd como PID 1).

**Isto substitui o item "Backup cifrado, restore testado..." do checklist
de `docs/14-seguranca.md` §9 por um script que roda sozinho** — mas troca só
a *execução*, não a responsabilidade: ninguém testou o restore por você.
Rode um restore de verdade (num banco descartável) periodicamente, e depois
de qualquer restore real rode `manage.py reapply_lgpd` — um restore desfaz
anonimizações posteriores ao backup, silenciosamente (ver
`docs/09-lgpd-operacionalizacao.md` §5-B).

Backup em si não é cifrado por este script (a rotação e a compressão são;
cifrar em repouso — `gpg`, disco cifrado no provedor, ou o backup nativo do
serviço de Postgres gerenciado, se for o caso — fica por conta de como o
`BACKUP_DIR` é provisionado, fora do que um `pg_dump | gzip` resolve
sozinho).

## 5. Systemd — as três unidades

| Unidade | Processo | Comando |
|---|---|---|
| `resolv-web.service` | HTTP + WebSocket | `uvicorn config.asgi:application --host 127.0.0.1 --port 8000` |
| `resolv-celery-worker.service` | tarefas assíncronas | `celery -A config worker -Q default,reports -l info` |
| `resolv-celery-beat.service` | agendador (SLA, expurgo, backup lógico do LGPD) | `celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler` |

Mesmos comandos que `docker-compose.yml` roda em desenvolvimento (sem o
`--reload` do uvicorn). As três: `User=resolv`, `Restart=on-failure`,
`EnvironmentFile=/etc/resolv/.env`, `WorkingDirectory=/srv/resolv`. O
`resolv-web` escuta em `127.0.0.1`, não `0.0.0.0` — só o nginx local fala
com ele; a porta 8000 nunca precisa sair do host (é literalmente um item do
checklist de `docs/14-seguranca.md` §9). Exatamente **uma** instância do
beat por ambiente — duas rodando ao mesmo tempo disparam cada tarefa
periódica em dobro.

Instalação (uma vez — `deploy.sh` só reinicia depois disso):

```sh
sudo cp deploy/systemd/resolv-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable resolv-web resolv-celery-worker resolv-celery-beat
```

Logs: `journalctl -u resolv-web -f` (troque a unidade).

## 6. O que ainda é checklist manual

`deploy.sh` automatiza `manage.py check --deploy`, migrate com o papel
certo, o teste de sintaxe do nginx antes de recarregar e um smoke check —
mas não tudo que está em `docs/14-seguranca.md` §9. Continuam **fora** do
script, porque exigem julgamento humano ou uma ferramenta que roda contra o
código-fonte, não contra o servidor:

- `pip-audit`/`bandit` (`make audit`) — auditoria, não runtime; nenhum
  Dockerfile instala o extra `[security]` em produção, e `deploy.sh` segue
  o mesmo raciocínio
- TLS A+ no SSL Labs, HSTS preload só depois de um ciclo limpo
- revisar o primeiro `RetentionRun` antes de desligar `RETENTION_DRY_RUN`
- confirmar que `seed_demo` nunca rodou neste banco
- testar de verdade um restore do backup (seção 4)
- 2FA por aplicativo nas contas internas
