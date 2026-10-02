.PHONY: help setup up down logs shell migrate migrations test lint fmt check seed bootstrap

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup:  ## Cria o .env a partir do exemplo e sobe os containers
	@test -f .env || cp .env.example .env
	docker compose up -d --build

up:  ## Sobe os containers
	docker compose up -d

bootstrap:  ## Do zero ao sistema populado: sobe, migra e semeia (backend)
	$(MAKE) setup
	docker compose exec web python manage.py migrate
	docker compose exec web python manage.py seed_defaults
	docker compose exec web python manage.py seed_demo

down:  ## Derruba os containers
	docker compose down

logs:  ## Acompanha os logs do web
	docker compose logs -f web

shell:  ## Shell do Django
	docker compose exec web python manage.py shell

migrate:  ## Aplica as migrations
	docker compose exec web python manage.py migrate

migrations:  ## Gera migrations
	docker compose exec web python manage.py makemigrations

test:  ## Roda a suíte de testes
	docker compose exec web pytest

lint:  ## Lint
	docker compose exec web ruff check .

fmt:  ## Formata
	docker compose exec web ruff format .

check:  ## django check --deploy (com as settings de PRODUÇÃO — precisa de um .env de prod)
	docker compose exec -e DJANGO_SETTINGS_MODULE=config.settings.prod web python manage.py check --deploy

# `[security]` (pip-audit, bandit) é ferramenta de auditoria, não de runtime — de
# propósito NENHUM Dockerfile instala esse extra, então ele não está dentro do
# container `web` por padrão. Antes de rodar este alvo, instale-o onde os dois
# comandos abaixo vão executar: `docker compose exec web pip install '.[security]'`
# (ou rode pip-audit/bandit fora do container, num venv local com o extra instalado).
audit:  ## CVEs nas dependências + análise estática (pip install '.[security]')
	docker compose exec web pip-audit --strict --desc
	docker compose exec web bandit -q -r apps config -x apps/*/tests -ll

seed:  ## Popula planos, departamentos, SLA e calendário
	docker compose exec web python manage.py seed_defaults

seed-demo:  ## Dados de demonstração (empresas, usuários, tickets) — só DEBUG
	docker compose exec web python manage.py seed_demo

superuser:  ## Cria um superusuário
	docker compose exec web python manage.py createsuperuser

schema:  ## Regenera resolv-openapi.yaml — o contrato que o frontend consome
	docker compose exec web python manage.py spectacular --file /app/resolv-openapi.yaml
