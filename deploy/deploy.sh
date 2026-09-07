#!/usr/bin/env sh
# Deploy de produção do resolv.
#
# Uso:
#   sudo deploy/deploy.sh              # publica o HEAD do branch já em uso no servidor
#   sudo deploy/deploy.sh v1.4.0       # publica uma tag, branch ou commit específico
#
# O que este script FAZ, nesta ordem — e aborta na primeira etapa que
# falhar, com uma mensagem específica, sem tentar as seguintes numa base que
# já se sabe quebrada:
#   1. atualiza o código em DEPLOY_APP_DIR (clona na primeira vez)
#   2. instala as dependências Python de produção num venv (sem o extra "dev")
#   3. `manage.py check --deploy` — falha cedo se o .env afrouxou algo
#   4. builda o frontend (frontend/dist — o nginx serve estático dali)
#   5. `manage.py migrate` com o papel DONO do schema (DATABASE_URL_MIGRATE)
#   6. `manage.py collectstatic`
#   7. aplica a config do nginx (só se ainda não existir lá — ver nota
#      abaixo) e recarrega, mas só depois de `nginx -t` passar
#   8. reinicia as três unidades systemd (deploy/systemd/)
#   9. smoke check: espera o healthcheck responder 200 antes de dizer sucesso
#
# O que este script NÃO FAZ — provisionamento do servidor. Ele assume que já
# existem: o usuário de sistema "resolv", o Postgres com os papéis de
# deploy/postgres/01_papeis.sql, o Redis, o nginx e o Node instalados, o
# certificado TLS e /etc/resolv/.env preenchido (a partir de
# .env.production.example). Nada disso é instalado por aqui — a distinção
# entre "o que deploy.sh automatiza" e "o que ainda depende de alguém
# provisionar" está em docs/15-deploy-producao.md.
#
# Nginx nunca é sobrescrito às cegas: deploy/nginx/resolv.conf é um
# TEMPLATE (`server_name app.exemplo.com.br` etc., ver o comentário no topo
# daquele arquivo — "ajuste domínio e certificados") que alguém customiza à
# mão na primeira instalação. Copiar por cima a cada deploy apagaria essa
# customização sem aviso. Por isso este script só instala os três arquivos
# de deploy/nginx/ se AINDA NÃO existirem no destino; depois disso, todo
# deploy só testa (`nginx -t`) e recarrega o que já está lá.
#
# Idempotente: rodar de novo sem nada ter mudado não faz mal — git
# fetch+reset, pip install, migrate e collectstatic já são idempotentes por
# natureza; o passo do nginx só instala o que falta; systemctl restart numa
# unidade saudável apenas a reinicia.
#
# Variáveis de ambiente (todas opcionais — os defaults servem para a
# topologia descrita em docs/15-deploy-producao.md):
#   DEPLOY_APP_DIR       /srv/resolv                    onde o código vive
#   DEPLOY_REPO_URL      (vazio)                        só lida na 1ª execução,
#                                                        quando DEPLOY_APP_DIR
#                                                        ainda não é um clone git
#   DEPLOY_USER          resolv                         dono dos arquivos após o deploy
#   DEPLOY_VENV_DIR       $DEPLOY_APP_DIR/venv
#   DEPLOY_EXTRAS         reports,antivirus,monitoring   extras de produção — mesma
#                                                        base do Dockerfile/CI
#                                                        (`.[dev,reports,antivirus]`),
#                                                        sem "dev". "monitoring" entra
#                                                        aqui e não no Dockerfile porque
#                                                        isto é produção de verdade: o
#                                                        sentry-sdk é no-op sem
#                                                        SENTRY_DSN (settings/base.py),
#                                                        então tê-lo instalado sem
#                                                        configurar não custa nada — o
#                                                        inverso (configurar SENTRY_DSN
#                                                        sem o pacote) fica mudo calado.
#   DEPLOY_ENV_FILE       /etc/resolv/.env               EnvironmentFile dos 3 .service
#   DEPLOY_SKIP_FRONTEND  0                              1 pula o build do frontend
#                                                        (caso outro pipeline já publique
#                                                        frontend/dist por fora)
#   DEPLOY_HEALTH_URL     http://127.0.0.1:8000/health/  bate direto no uvicorn, não
#                                                        no domínio público — o nginx
#                                                        deste projeto não tem location
#                                                        para /health/ (ela é para uso
#                                                        interno do orquestrador, ver o
#                                                        comentário de SECURE_REDIRECT_EXEMPT
#                                                        em config/settings/prod.py)

set -eu

log() { printf '\n\033[1m→ %s\033[0m\n' "$1"; }
erro() { printf '\nERRO: %s\n' "$1" >&2; exit 1; }

APP_DIR="${DEPLOY_APP_DIR:-/srv/resolv}"
DEPLOY_USER="${DEPLOY_USER:-resolv}"
VENV_DIR="${DEPLOY_VENV_DIR:-$APP_DIR/venv}"
EXTRAS="${DEPLOY_EXTRAS:-reports,antivirus,monitoring}"
ENV_FILE="${DEPLOY_ENV_FILE:-/etc/resolv/.env}"
SKIP_FRONTEND="${DEPLOY_SKIP_FRONTEND:-0}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8000/health/}"
REF="${1:-}"

# --------------------------------------------------------------------------- #
# 0. Pré-condições — falhar aqui é sempre melhor que falhar no meio
# --------------------------------------------------------------------------- #
[ "$(id -u)" -eq 0 ] || erro "rode como root (sudo deploy/deploy.sh...) — precisa recarregar o nginx e reiniciar as unidades systemd"

id "$DEPLOY_USER" >/dev/null 2>&1 || erro "usuário de sistema '$DEPLOY_USER' não existe. Isto é provisionamento do servidor, fora do que este script faz — crie-o (ex.: useradd --system --create-home --home-dir /home/$DEPLOY_USER --shell /usr/sbin/nologin $DEPLOY_USER) e rode de novo. Ver docs/15-deploy-producao.md."

command -v nginx >/dev/null 2>&1 || erro "nginx não encontrado no PATH — precisa estar instalado antes do primeiro deploy.sh (provisionamento, fora do escopo deste script)"
command -v curl >/dev/null 2>&1 || erro "curl não encontrado no PATH — necessário para o smoke check final"

[ -f "$ENV_FILE" ] || erro "$ENV_FILE não encontrado. Copie .env.production.example para lá, preencha e ajuste para 0600 (dono $DEPLOY_USER) antes de rodar este script."

# Carrega o .env de produção no ambiente deste script — o mesmo arquivo que
# EnvironmentFile= aponta nos três .service, formato simples KEY=valor (sem
# sintaxe de shell), então `. "$ENV_FILE"` com allexport basta.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.prod}"

# --------------------------------------------------------------------------- #
# 1. Código
# --------------------------------------------------------------------------- #
log "código em $APP_DIR"
if [ ! -e "$APP_DIR" ]; then
    [ -n "${DEPLOY_REPO_URL:-}" ] || erro "$APP_DIR não existe e DEPLOY_REPO_URL não foi definida — é a primeira execução, então preciso de algo para clonar."
    log "primeira execução: clonando $DEPLOY_REPO_URL"
    git clone "$DEPLOY_REPO_URL" "$APP_DIR"
fi
[ -d "$APP_DIR/.git" ] || erro "$APP_DIR existe mas não é um clone git — resolva manualmente antes de rodar este script."

cd "$APP_DIR"
git fetch --all --tags --prune
if [ -n "$REF" ]; then
    git checkout "$REF"
else
    REF="$(git rev-parse --abbrev-ref HEAD)"
    [ "$REF" != "HEAD" ] || erro "HEAD destacado em $APP_DIR sem um ref informado — rode: deploy.sh <branch-ou-tag>"
fi
# Se REF for um branch com tracking remoto, alinha exatamente com o
# remoto; se for tag ou commit solto, "origin/$REF" não existe e o
# fallback (já é exatamente o que o checkout acima deixou) resolve sozinho.
git reset --hard "origin/$REF" 2>/dev/null || git reset --hard "$REF"
log "publicando $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

# --------------------------------------------------------------------------- #
# 2. Dependências Python (venv de produção, sem o extra "dev")
# --------------------------------------------------------------------------- #
log "dependências Python (extras: $EXTRAS)"
[ -x "$VENV_DIR/bin/python" ] || python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -e ".[${EXTRAS}]"

# --------------------------------------------------------------------------- #
# 3. Checagem de segurança de produção — falha cedo, antes de tocar no
#    banco ou gastar tempo com o build do frontend, se o .env afrouxou algo
#    que config/settings/prod.py e apps/core/checks.py não aceitam.
# --------------------------------------------------------------------------- #
log "manage.py check --deploy"
"$VENV_DIR/bin/python" manage.py check --deploy

# --------------------------------------------------------------------------- #
# 4. Frontend
# --------------------------------------------------------------------------- #
if [ "$SKIP_FRONTEND" != "1" ]; then
    log "build do frontend (frontend/dist — deploy/nginx/resolv.conf serve estático dali)"
    command -v npm >/dev/null 2>&1 || erro "npm não encontrado no PATH — precisa de Node instalado (docs/12-ambiente.md recomenda a 22 LTS), ou rode com DEPLOY_SKIP_FRONTEND=1 se outro pipeline já publica frontend/dist."
    ( cd "$APP_DIR/frontend" && npm ci && npm run build )
else
    log "build do frontend pulado (DEPLOY_SKIP_FRONTEND=1)"
fi

# --------------------------------------------------------------------------- #
# 5. Migrations — papel DONO do schema, nunca o de aplicação
#    (docs/14-seguranca.md §4: DATABASE_URL_MIGRATE -> resolv_owner)
# --------------------------------------------------------------------------- #
log "migrations (papel resolv_owner via DATABASE_URL_MIGRATE)"
: "${DATABASE_URL_MIGRATE:?defina DATABASE_URL_MIGRATE em $ENV_FILE (papel resolv_owner) — migrate nunca roda com o papel de aplicação}"
DATABASE_URL="$DATABASE_URL_MIGRATE" "$VENV_DIR/bin/python" manage.py migrate --noinput

# --------------------------------------------------------------------------- #
# 6. Estáticos (admin do Django, DRF browsable API — a SPA em si é o passo 4)
# --------------------------------------------------------------------------- #
log "collectstatic"
"$VENV_DIR/bin/python" manage.py collectstatic --noinput

# Diretório de mídia: garante que existe antes do primeiro upload, sem forçar
# dono/permissão a cada deploy — quem define isso é o provisionamento
# (docs/14: MEDIA_ROOT fora do webroot, 0750, dono da aplicação).
[ -n "${MEDIA_ROOT:-}" ] && mkdir -p "$MEDIA_ROOT"

# Devolve a árvore ao usuário sem privilégio — mesmo raciocínio do
# Dockerfile ("o dono muda ANTES do USER, senão a troca de dono roda como
# quem não tem permissão para ela"): aqui quem "troca de USER" são as
# unidades systemd (User=resolv), reiniciadas already como esse usuário logo
# abaixo, então a árvore já precisa estar com o dono certo antes disso.
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# --------------------------------------------------------------------------- #
# 7. nginx — nunca recarrega config quebrada
# --------------------------------------------------------------------------- #
log "config do nginx"
mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
for par in \
    "$APP_DIR/deploy/nginx/resolv.conf:/etc/nginx/sites-available/resolv.conf" \
    "$APP_DIR/deploy/nginx/snippets-resolv-proxy.conf:/etc/nginx/snippets/resolv-proxy.conf" \
    "$APP_DIR/deploy/nginx/snippets-resolv-headers.conf:/etc/nginx/snippets/resolv-headers.conf"
do
    origem="${par%%:*}"
    destino="${par#*:}"
    if [ -e "$destino" ]; then
        log "  $destino já existe — não sobrescrito (customização do domínio real preservada)"
    else
        install -m 0644 "$origem" "$destino"
        log "  instalado $destino (primeira vez — ajuste domínio/certificado se ainda não fez)"
    fi
done
[ -e /etc/nginx/sites-enabled/resolv.conf ] || ln -s /etc/nginx/sites-available/resolv.conf /etc/nginx/sites-enabled/resolv.conf

nginx -t || erro "nginx -t falhou — configuração NÃO recarregada. Corrija /etc/nginx/sites-available/resolv.conf (ou os snippets) e rode de novo; o processo antigo continua servindo até lá."
systemctl reload nginx

# --------------------------------------------------------------------------- #
# 8. As três unidades da aplicação
# --------------------------------------------------------------------------- #
log "reiniciando as unidades systemd"
systemctl daemon-reload
for unidade in resolv-web resolv-celery-worker resolv-celery-beat; do
    systemctl is-enabled --quiet "$unidade" 2>/dev/null || erro "$unidade.service não está instalada/habilitada. Rode a instalação de uma vez (ver o comentário no topo de deploy/systemd/$unidade.service) antes do primeiro deploy.sh."
    systemctl restart "$unidade"
done

# --------------------------------------------------------------------------- #
# 9. Smoke check — só diz sucesso se o processo respondeu de verdade
# --------------------------------------------------------------------------- #
log "smoke check: $HEALTH_URL"
codigo="000"
tentativa=1
max_tentativas=10
while [ "$tentativa" -le "$max_tentativas" ]; do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")"
    [ "$codigo" = "200" ] && break
    sleep 2
    tentativa=$((tentativa + 1))
done
[ "$codigo" = "200" ] || erro "smoke check falhou: $HEALTH_URL não respondeu 200 depois de $max_tentativas tentativas (último código: $codigo). As unidades foram reiniciadas mas o processo não subiu saudável — veja: journalctl -u resolv-web -n 80 --no-pager"

log "deploy concluído: $(git -C "$APP_DIR" rev-parse --short HEAD), healthcheck 200"
