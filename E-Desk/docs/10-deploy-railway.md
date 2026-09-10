# Deploy da demonstração no Railway

Objetivo: uma URL pública, num **contêiner só**, para outras pessoas testarem.
O Django serve a SPA já buildada **e** a API no mesmo domínio — sem CORS, sem
cookie cross-site. Não é para dado real de cliente (senha de demo é pública,
e-mail vai para o console, antivírus desligado). Para produção de verdade, use
`config/settings/prod.py`.

## O que já está pronto no repositório

| Arquivo | Papel |
|---|---|
| `Dockerfile.railway` | build em 2 estágios: Node builda `web/dist`, Python roda o Django e leva a SPA junto |
| `config/settings/demo.py` | settings da vitrine (SPA no mesmo domínio, seed liberado, Celery no processo) |
| `deploy/entrypoint.sh` | a cada boot: migra, coleta estáticos, semeia dados e sobe o ASGI na `$PORT` |
| `railway.json` | aponta o Railway para o `Dockerfile.railway` |

## Passo a passo (≈10 min)

1. **Conta e projeto.** Crie conta em [railway.app](https://railway.app) e
   **New Project → Deploy from GitHub repo**, escolhendo este repositório e a
   branch `claude/edesk-new-folder-nuoj3u`. O Railway acha o `railway.json`
   sozinho e usa o `Dockerfile.railway`.

2. **Banco.** No projeto, **+ New → Database → PostgreSQL**. O Railway cria a
   variável `DATABASE_URL` e a injeta no serviço automaticamente.

3. **Redis.** **+ New → Database → Redis**. Cria a `REDIS_URL`, também injetada.

4. **Variáveis do serviço web.** Em *Variables*, defina:

   | Variável | Valor | Por quê |
   |---|---|---|
   | `DJANGO_SETTINGS_MODULE` | `config.settings.demo` | usa as settings de vitrine |
   | `DJANGO_SECRET_KEY` | uma chave longa aleatória | sem ela, as sessões caem a cada redeploy |

   `DATABASE_URL` e `REDIS_URL` já vêm dos plugins; `PORT` e
   `RAILWAY_PUBLIC_DOMAIN` o Railway injeta sozinho (o domínio já entra no
   `ALLOWED_HOSTS` e no `CSRF_TRUSTED_ORIGINS`).

   Para gerar a `SECRET_KEY`:
   ```
   python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"
   ```

5. **Domínio.** Em *Settings → Networking → Generate Domain*. Sai algo como
   `edesk-production.up.railway.app`.

6. **Deploy.** O primeiro build leva alguns minutos (compila a SPA + instala o
   Python). Quando terminar, abra o domínio.

## Como testar

Abra a URL e entre com qualquer usuário de demonstração — **todos usam a senha
`edesk123`**:

- `admin@demo.edesk.test` — admin (vê tudo, configurações)
- `agente.suporte@demo.edesk.test` — agente de suporte
- `ana@acme.test` — cliente (portal do cliente)

O seed cria empresas, tickets, um quadro de Kanban e avisos de exemplo.

## Limites conhecidos da demo (de propósito)

- **Sem worker/beat:** as tarefas rodam no próprio processo (`CELERY_TASK_ALWAYS_EAGER`).
  As varreduras periódicas (SLA vencendo, chat abandonado) **não disparam
  sozinhas** — o resto funciona normal. Para produção, suba `worker` e `beat`
  como serviços à parte (ver `docker-compose.yml`).
- **Antivírus desligado:** sem o daemon ClamAV, ligá-lo deixaria todo anexo em
  quarentena (fail-closed, D19). Ligue `CLAMAV_ENABLED=1` só com um ClamAV no ar.
- **E-mail no console:** convites e avisos por e-mail aparecem no log, não saem
  de verdade.
- **Custo:** o Railway dá ~US$ 5 de crédito grátis, que cobre uma demo pequena
  por semanas. Passou disso, ele pausa até você adicionar um método de pagamento.

## Migrando para produção depois

Troque `DJANGO_SETTINGS_MODULE` para `config.settings.prod`, defina as variáveis
de e-mail (`EMAIL_HOST`, etc.), suba ClamAV e os serviços `worker`/`beat`, e
**não** rode `seed_demo` (o `SEED_DEMO=0` já evita). O `prod.py` força HTTPS,
HSTS e cookies seguros.
