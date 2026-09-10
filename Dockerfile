FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libmagic: validação de anexo por magic bytes, não por extensão (D13)
# pango: renderização de PDF pelo WeasyPrint (exportação de relatórios)
# Cliente do PostgreSQL 16 — o pg_dump/psql que Configurações → Backup usa
# (apps/ferramentas/backup.py). Precisa ser a MESMA versão maior do servidor
# (docker-compose: postgres:16): pg_dump mais antigo que o servidor recusa
# rodar. Vem do repositório oficial (PGDG) porque o da distro pode não ser 16.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y --auto-remove curl gnupg && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libmagic1 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
# reports (XLSX/PDF) e antivirus entram na imagem: extra opcional que a
# produção precisa mas ninguém instala é como a exportação de PDF ficou
# meses quebrada sem nenhum teste falhar.
RUN pip install --upgrade pip && pip install ".[dev,reports,antivirus]"

COPY . .

# Usuário sem privilégio: um RCE na aplicação (dependência, upload malicioso
# que escapa da varredura) não sai escrevendo como root no filesystem do
# contêiner. staticfiles e media são os dois diretórios que o processo
# realmente precisa escrever depois do boot — o dono muda ANTES do USER,
# senão a troca de dono roda como o usuário que não tem permissão para ela.
RUN mkdir -p /var/lib/resolv/media staticfiles \
    && useradd --system --create-home --home-dir /home/resolv --shell /usr/sbin/nologin resolv \
    && chown -R resolv:resolv /app /var/lib/resolv/media
USER resolv

EXPOSE 8000

CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000"]
