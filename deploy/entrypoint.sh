#!/usr/bin/env sh
# Boot da demo em contêiner único (Railway).
#
# Idempotente de propósito: roda a cada deploy/reinício. migrate, collectstatic
# e os seeds usam update_or_create/--noinput, então repetir não duplica nada.
set -e

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.demo}"

echo "→ migrando o banco"
python manage.py migrate --noinput

echo "→ coletando estáticos (admin do Django e a interface do DRF)"
python manage.py collectstatic --noinput

echo "→ dados padrão (planos, equipes, SLA, feriados)"
python manage.py seed_defaults

# Dados de demonstração: empresas, usuários e tickets de exemplo, com senha
# pública. Desligue com SEED_DEMO=0 se um dia isto virar algo mais que vitrine.
if [ "${SEED_DEMO:-1}" = "1" ]; then
  echo "→ dados de demonstração (login: senha resolv123)"
  python manage.py seed_demo || echo "  (seed_demo falhou — seguindo sem os exemplos)"
  # Deploy que já existia não é semeado de novo (o seed só popula banco vazio),
  # então as contas ficariam com o endereço e a senha de antes da troca de nome
  # enquanto a tela anuncia os novos. Isto acerta e é idempotente.
  python manage.py migrar_contas_demo || true
fi

echo "→ subindo o servidor ASGI na porta ${PORT:-8000}"
exec uvicorn config.asgi:application --host 0.0.0.0 --port "${PORT:-8000}"
