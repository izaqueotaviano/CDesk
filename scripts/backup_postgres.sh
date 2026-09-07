#!/usr/bin/env sh
# Backup do PostgreSQL do resolv: dump comprimido, com rotação por retenção.
#
# Roda com o papel de APLICAÇÃO (resolv_app), não o dono do schema
# (resolv_owner, deploy/postgres/01_papeis.sql). Um dump só precisa ler
# tabela — pg_dump lê a definição dos objetos no catálogo do Postgres
# (legível por qualquer papel com CONNECT no banco), então nenhum privilégio
# de DDL entra no processo de backup. Se este script vazar ou tiver um bug,
# o pior que consegue é o que resolv_app já consegue: SELECT.
#
# Variáveis de ambiente:
#   DATABASE_URL          obrigatória — string de conexão do papel resolv_app
#                          (a mesma que o processo web/worker usa; NUNCA
#                          DATABASE_URL_MIGRATE aqui).
#   BACKUP_DIR             default: /var/backups/resolv
#   BACKUP_ROTATION_DAYS   default: 30 — mesmo nome e mesmo valor-padrão de
#                          `BACKUP_ROTATION_DAYS` em config/settings/base.py
#                          (D21): é o prazo que o sistema informa ao titular
#                          no pacote de portabilidade LGPD, então o que roda
#                          aqui de verdade precisa bater com o que a tela e o
#                          export dizem — mantenha os dois em sincronia.
#   DB_SSLMODE, DB_SSLROOTCERT   opcionais — mesmas variáveis que
#                          config/settings/prod.py lê; se estiverem no
#                          ambiente, o dump usa a mesma verificação de TLS
#                          que o Django usa para falar com o banco.
#
# Como agendar — duas opções, escolha uma:
#
#   1) cron, no crontab do usuário "resolv" (`crontab -u resolv -e`), lendo
#      as variáveis de /etc/resolv/.env (D21-B: diário às 23h):
#
#        0 23 * * * . /etc/resolv/.env && /srv/resolv/scripts/backup_postgres.sh >> /var/log/resolv/backup.log 2>&1
#
#   2) systemd timer, no mesmo estilo dos .service em deploy/systemd/ —
#      crie os dois arquivos abaixo (não incluídos neste diretório: só as
#      três unidades do processo da aplicação estão em deploy/systemd/) e
#      rode `systemctl enable --now resolv-backup.timer`:
#
#        # /etc/systemd/system/resolv-backup.service
#        [Unit]
#        Description=Backup do PostgreSQL do resolv
#        [Service]
#        Type=oneshot
#        User=resolv
#        EnvironmentFile=/etc/resolv/.env
#        ExecStart=/srv/resolv/scripts/backup_postgres.sh
#
#        # /etc/systemd/system/resolv-backup.timer
#        [Unit]
#        Description=Dispara o backup do resolv às 23h
#        [Timer]
#        OnCalendar=*-*-* 23:00:00
#        Persistent=true
#        [Install]
#        WantedBy=timers.target
#
# Falha alta de propósito: `set -eu` mais a checagem explícita do pg_dump
# abaixo. Um script de backup que engole o erro do pg_dump e sai com 0
# esconde exatamente o dia em que o backup mais importava — é pior que não
# ter backup nenhum, porque a ausência dele passa despercebida até o
# restore, que é tarde demais.

set -eu

DATABASE_URL="${DATABASE_URL:?defina DATABASE_URL (papel resolv_app) antes de rodar este script}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/resolv}"
BACKUP_ROTATION_DAYS="${BACKUP_ROTATION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

# 01_papeis.sql prende resolv_app a statement_timeout=30s e
# idle_in_transaction_session_timeout=60s — pensado para uma requisição web,
# não para um COPY de uma tabela grande. PGOPTIONS aplica um `SET` na sessão
# do pg_dump por cima do default da role (isso não exige superusuário, é uma
# troca de sessão comum); sem isto, um banco que cresça o bastante começa a
# ter o backup interrompido no meio, silenciosamente virando o problema que
# este script existe para evitar.
PGOPTIONS="-c statement_timeout=0 -c idle_in_transaction_session_timeout=0"
export PGOPTIONS

# Mesma verificação de TLS que o Django usa em produção (prod.py) — só entra
# em jogo se as variáveis estiverem definidas; sem elas, pg_dump usa o que
# já vier codificado em DATABASE_URL (ou a negociação padrão do libpq).
if [ -n "${DB_SSLMODE:-}" ]; then
    PGSSLMODE="$DB_SSLMODE"
    export PGSSLMODE
fi
if [ -n "${DB_SSLROOTCERT:-}" ]; then
    PGSSLROOTCERT="$DB_SSLROOTCERT"
    export PGSSLROOTCERT
fi

timestamp="$(date -u +%Y%m%d-%H%M%S)"
destino="$BACKUP_DIR/resolv-${timestamp}.sql.gz"
dump_tmp="$BACKUP_DIR/.resolv-${timestamp}.sql.tmp"
gz_tmp="$BACKUP_DIR/.resolv-${timestamp}.sql.gz.tmp"

# Limpa os temporários em qualquer saída (sucesso, erro ou interrupção) —
# nunca deixa um .tmp pela metade sendo confundido com um backup de verdade
# (o padrão de nome só casa com "resolv-*.sql.gz", os .tmp ficam de fora da
# rotação abaixo, mas não custa nada não deixar lixo no disco).
trap 'rm -f "$dump_tmp" "$gz_tmp"' EXIT INT TERM

echo "→ pg_dump (papel resolv_app, sem DDL) para $dump_tmp"
if ! pg_dump --no-owner --no-privileges --format=plain --file="$dump_tmp" "$DATABASE_URL"; then
    echo "ERRO: pg_dump falhou — nenhum backup foi gravado. Verifique DATABASE_URL," \
         "conectividade com o banco e o log acima." >&2
    exit 1
fi

# Dump "vazio" (só cabeçalho de comentário do pg_dump, sem nenhum CREATE/COPY)
# é o sintoma clássico de ter apontado para o banco errado ou para um papel
# sem GRANT nas tabelas — sai como sucesso do pg_dump, mas não é um backup
# útil. Um dump de verdade deste schema passa de poucas dezenas de KB.
if [ ! -s "$dump_tmp" ]; then
    echo "ERRO: pg_dump terminou mas o arquivo ficou vazio — não gravado." >&2
    exit 1
fi

echo "→ comprimindo"
if ! gzip -c "$dump_tmp" > "$gz_tmp"; then
    echo "ERRO: gzip falhou — backup não gravado." >&2
    exit 1
fi

# Renomeia por último e de forma atômica (mv dentro do mesmo filesystem): um
# processo que liste $BACKUP_DIR no meio do dump nunca vê um arquivo
# "resolv-*.sql.gz" pela metade.
mv "$gz_tmp" "$destino"
chmod 600 "$destino"   # dump completo do banco — mesma cautela de um .env

tamanho="$(du -h "$destino" | cut -f1)"
echo "✓ backup gravado: $destino ($tamanho)"

echo "→ apagando backups com mais de ${BACKUP_ROTATION_DAYS} dias em $BACKUP_DIR"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'resolv-*.sql.gz' -mtime "+${BACKUP_ROTATION_DAYS}" -print -delete

echo "✓ concluído"
