FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libmagic: validação de anexo por magic bytes, não por extensão (D13)
# pango: renderização de PDF pelo WeasyPrint (exportação de relatórios)
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

RUN mkdir -p /var/lib/edesk/media

EXPOSE 8000

CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000"]
