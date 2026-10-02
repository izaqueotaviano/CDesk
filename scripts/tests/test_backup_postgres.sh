#!/usr/bin/env sh
# Teste do scripts/backup_postgres.sh.
#
# Não é pytest nem vitest: o script testado não é código Django nem
# frontend, é um script de infraestrutura — o alvo aqui é o CONTRATO do
# script (nome de arquivo, rotação, falha alta), não uma suíte de
# integração com um Postgres de verdade (isso é o "restore mensal testado"
# de docs/15-deploy-producao.md §4, feito contra dado real, não simulado).
#
# `pg_dump` é substituído por um stub no PATH — assim o teste roda em
# qualquer máquina, sem banco nenhum no ar.
#
# Rodar:
#   sh scripts/tests/test_backup_postgres.sh

set -eu

falhas=0

assert_eq() {
    # $1 obtido, $2 esperado, $3 descrição
    if [ "$1" = "$2" ]; then
        echo "ok: $3"
    else
        echo "FALHOU: $3 (esperado '$2', obtido '$1')" >&2
        falhas=$((falhas + 1))
    fi
}

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
alvo="$script_dir/../backup_postgres.sh"
[ -x "$alvo" ] || { echo "FALHOU: $alvo não existe ou não é executável" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

stub_dir="$tmp/stubs"
mkdir -p "$stub_dir"

stub_pg_dump_ok() {
    cat > "$stub_dir/pg_dump" <<'EOF'
#!/usr/bin/env sh
# Simula um dump que deu certo: grava algo no --file pedido.
for a in "$@"; do
    case "$a" in
        --file=*) echo "-- dump de teste" > "${a#--file=}" ;;
    esac
done
exit 0
EOF
    chmod +x "$stub_dir/pg_dump"
}

stub_pg_dump_falha() {
    cat > "$stub_dir/pg_dump" <<'EOF'
#!/usr/bin/env sh
echo "erro simulado de conexao" >&2
exit 1
EOF
    chmod +x "$stub_dir/pg_dump"
}

# --------------------------------------------------------------------------- #
# Cenário 1 — pg_dump com sucesso: exatamente um .sql.gz, sem lixo temporário
# --------------------------------------------------------------------------- #
stub_pg_dump_ok
dir1="$tmp/backups1"
codigo=0
PATH="$stub_dir:$PATH" DATABASE_URL="postgres://fake/fake" BACKUP_DIR="$dir1" "$alvo" || codigo=$?
assert_eq "$codigo" "0" "sucesso: script sai 0"
n="$(find "$dir1" -maxdepth 1 -type f -name 'resolv-*.sql.gz' | wc -l | tr -d ' ')"
assert_eq "$n" "1" "sucesso: exatamente um .sql.gz gravado"
sobras="$(find "$dir1" -maxdepth 1 -type f -name '.*' | wc -l | tr -d ' ')"
assert_eq "$sobras" "0" "sucesso: nenhum .tmp esquecido no diretório"

# --------------------------------------------------------------------------- #
# Cenário 2 — pg_dump falha: script sai != 0 e NÃO deixa nenhum arquivo
# (a falha que este teste protege é justamente "engolir o erro do pg_dump")
# --------------------------------------------------------------------------- #
stub_pg_dump_falha
dir2="$tmp/backups2"
codigo=0
PATH="$stub_dir:$PATH" DATABASE_URL="postgres://fake/fake" BACKUP_DIR="$dir2" "$alvo" || codigo=$?
if [ "$codigo" -ne 0 ]; then
    echo "ok: pg_dump falhando faz o script sair != 0 (código $codigo)"
else
    echo "FALHOU: script saiu 0 mesmo com pg_dump falhando — engoliu o erro" >&2
    falhas=$((falhas + 1))
fi
n="$(find "$dir2" -mindepth 1 -type f | wc -l | tr -d ' ')"
assert_eq "$n" "0" "falha: nenhum arquivo (nem parcial) sobra no diretório"

# --------------------------------------------------------------------------- #
# Cenário 3 — rotação: apaga o que passou da retenção, preserva o resto
# --------------------------------------------------------------------------- #
stub_pg_dump_ok
dir3="$tmp/backups3"
mkdir -p "$dir3"
velho="$dir3/resolv-20200101-000000.sql.gz"
printf 'backup antigo' | gzip > "$velho"
touch -d '100 days ago' "$velho" 2>/dev/null || touch -t 202001010000 "$velho"

codigo=0
PATH="$stub_dir:$PATH" DATABASE_URL="postgres://fake/fake" BACKUP_DIR="$dir3" BACKUP_ROTATION_DAYS=30 "$alvo" || codigo=$?
assert_eq "$codigo" "0" "rotação: script sai 0"
if [ -e "$velho" ]; then
    echo "FALHOU: backup com mais de 30 dias não foi apagado pela rotação" >&2
    falhas=$((falhas + 1))
else
    echo "ok: backup fora da retenção (>30 dias) foi apagado"
fi
n="$(find "$dir3" -maxdepth 1 -type f -name 'resolv-*.sql.gz' | wc -l | tr -d ' ')"
assert_eq "$n" "1" "rotação: sobra só o backup recém-gerado"

echo
if [ "$falhas" -eq 0 ]; then
    echo "✓ todos os cenários passaram"
    exit 0
fi
echo "✗ $falhas cenário(s) falharam" >&2
exit 1
