"""Backup e restauração do PostgreSQL pela tela — o mesmo dump que
scripts/backup_postgres.sh faz, agora chamável de uma task.

Mesmo nome de arquivo, mesmo diretório, mesmas flags de pg_dump: os backups
do timer do systemd (produção) e os disparados pela tela vivem lado a lado em
`settings.BACKUP_DIR` e aparecem numa lista só.

Segurança do nome: tudo que entra pela API passa por `caminho_de`, que só
aceita `resolv-AAAAMMDD-HHMMSS.sql.gz`. Sem isso, "../../etc/passwd" no
DELETE ou no restore seria um desastre.

Restaurar é DESTRUTIVO por definição — derruba o schema `public` e recria a
partir do dump, tudo numa transação só (ou entra inteiro, ou nada muda). Quem
chama (tasks.py) tira um backup de segurança ANTES, sempre.
"""

from __future__ import annotations

import contextlib
import gzip
import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

from django.conf import settings

PADRAO_NOME = re.compile(r"^resolv-\d{8}-\d{6}\.sql\.gz$")
Log = Callable[[str], None]


class ErroBackup(Exception):
    pass


def diretorio() -> Path:
    d = Path(settings.BACKUP_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def nome_valido(nome: str) -> bool:
    return bool(PADRAO_NOME.match(nome or ""))


def caminho_de(nome: str) -> Path:
    if not nome_valido(nome):
        raise ValueError("Nome de backup inválido.")
    return diretorio() / nome


def listar() -> list[dict]:
    """Os arquivos de backup, mais novo primeiro."""
    itens = []
    for p in diretorio().glob("resolv-*.sql.gz"):
        if not nome_valido(p.name) or not p.is_file():
            continue
        st = p.stat()
        itens.append(
            {
                "nome": p.name,
                "tamanho_bytes": st.st_size,
                "criado_em": datetime.fromtimestamp(st.st_mtime, tz=UTC).isoformat(),
            }
        )
    itens.sort(key=lambda i: i["nome"], reverse=True)
    return itens


def url_do_banco(*, para_restaurar: bool = False) -> str:
    """A string de conexão pro pg_dump/psql.

    Dump usa o papel de aplicação (DATABASE_URL): só precisa ler. Restaurar
    faz DROP/CREATE SCHEMA, então precisa do dono — DATABASE_URL_MIGRATE em
    produção (deploy/postgres/01_papeis.sql); em dev os dois são o mesmo.
    """
    if para_restaurar:
        url = os.environ.get("DATABASE_URL_MIGRATE") or os.environ.get("DATABASE_URL")
    else:
        url = os.environ.get("DATABASE_URL")
    if not url:
        raise ErroBackup("DATABASE_URL não está no ambiente — o backup precisa dela.")
    return url


def ambiente_pg() -> dict:
    env = dict(os.environ)
    # Os timeouts do papel de aplicação são de requisição web, não de COPY de
    # tabela grande — mesma troca que o script shell faz.
    env["PGOPTIONS"] = "-c statement_timeout=0 -c idle_in_transaction_session_timeout=0"
    if os.environ.get("DB_SSLMODE"):
        env["PGSSLMODE"] = os.environ["DB_SSLMODE"]
    if os.environ.get("DB_SSLROOTCERT"):
        env["PGSSLROOTCERT"] = os.environ["DB_SSLROOTCERT"]
    return env


def _binario(nome: str) -> str:
    caminho = shutil.which(nome)
    if not caminho:
        raise ErroBackup(
            f"`{nome}` não está instalado neste servidor. No Docker é o pacote "
            "postgresql-client (ver Dockerfile); em máquina própria, o cliente do PostgreSQL."
        )
    return caminho


# ---- wrappers de processo (o que o teste substitui) ------------------------


def _pg_dump(destino: Path, url: str, env: dict) -> None:
    proc = subprocess.run(  # noqa: S603 — argumentos fixos, sem shell
        [
            _binario("pg_dump"),
            "--no-owner",
            "--no-privileges",
            "--format=plain",
            f"--file={destino}",
            url,
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=3600,
        check=False,
    )
    if proc.returncode != 0:
        raise ErroBackup(f"pg_dump falhou: {(proc.stderr or '').strip()[-800:]}")


PRELUDE_RESTAURACAO = b"DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n"


def _psql_restaurar(
    dump_gz: Path, url: str, env: dict, *, prelude: bytes = PRELUDE_RESTAURACAO
) -> None:
    """DROP SCHEMA public + o dump, numa transação só, lidos pelo stdin do psql."""
    proc = subprocess.Popen(  # noqa: S603
        [
            _binario("psql"),
            "--single-transaction",
            "--set=ON_ERROR_STOP=1",
            "--quiet",
            "--no-psqlrc",
            url,
        ],
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stderr is not None
    try:
        proc.stdin.write(prelude)
        with gzip.open(dump_gz, "rb") as f:
            shutil.copyfileobj(f, proc.stdin, length=1024 * 1024)
    except BrokenPipeError:
        pass  # o psql abortou — o motivo está no stderr abaixo
    finally:
        with contextlib.suppress(OSError, ValueError):
            proc.stdin.close()
    # Não usar communicate() aqui: com o stdin já fechado ele tenta dar flush
    # e estoura ValueError depois de o restore ter rodado.
    stderr = proc.stderr.read()
    proc.wait(timeout=3600)
    if proc.returncode != 0:
        raise ErroBackup(
            f"psql falhou (nada foi alterado): {stderr.decode('utf-8', 'replace').strip()[-800:]}"
        )


# ---- operações -------------------------------------------------------------


def criar(log: Log) -> tuple[str, int]:
    """pg_dump → gzip → rename atômico → chmod 600 → rotação. Devolve (nome, bytes)."""
    pasta = diretorio()
    carimbo = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    nome = f"resolv-{carimbo}.sql.gz"
    destino = pasta / nome
    dump_tmp = pasta / f".resolv-{carimbo}.sql.tmp"
    gz_tmp = pasta / f".resolv-{carimbo}.sql.gz.tmp"
    try:
        log("pg_dump (papel de aplicação, sem DDL)…")
        inicio = time.monotonic()
        _pg_dump(dump_tmp, url_do_banco(), ambiente_pg())
        if not dump_tmp.exists() or dump_tmp.stat().st_size == 0:
            raise ErroBackup("pg_dump terminou mas o arquivo ficou vazio — banco ou papel errado.")
        log(
            f"dump pronto em {time.monotonic() - inicio:.0f}s "
            f"({dump_tmp.stat().st_size // 1024} KB); comprimindo…"
        )
        with open(dump_tmp, "rb") as origem, gzip.open(gz_tmp, "wb", compresslevel=6) as saida:
            shutil.copyfileobj(origem, saida, length=1024 * 1024)
        os.replace(gz_tmp, destino)
        os.chmod(destino, 0o600)
        tamanho = destino.stat().st_size
        log(f"backup gravado: {nome} ({tamanho // 1024} KB)")
        removidos = rotacionar(log)
        if removidos:
            log(
                f"rotação: {removidos} backup(s) com mais de "
                f"{settings.BACKUP_ROTATION_DAYS} dias apagado(s)."
            )
        return nome, tamanho
    finally:
        for tmp in (dump_tmp, gz_tmp):
            tmp.unlink(missing_ok=True)


def rotacionar(log: Log) -> int:
    limite = datetime.now(UTC) - timedelta(days=settings.BACKUP_ROTATION_DAYS)
    removidos = 0
    for p in diretorio().glob("resolv-*.sql.gz"):
        if nome_valido(p.name) and datetime.fromtimestamp(p.stat().st_mtime, tz=UTC) < limite:
            p.unlink()
            removidos += 1
    return removidos


def restaurar(nome: str, log: Log) -> None:
    arquivo = caminho_de(nome)
    if not arquivo.is_file():
        raise ErroBackup(f"Backup {nome} não existe mais em disco.")
    log(
        f"restaurando {nome} ({arquivo.stat().st_size // 1024} KB) — "
        "DROP SCHEMA public + dump, numa transação…"
    )
    inicio = time.monotonic()
    _psql_restaurar(arquivo, url_do_banco(para_restaurar=True), ambiente_pg())
    log(f"restauração concluída em {time.monotonic() - inicio:.0f}s.")


def apagar(nome: str) -> None:
    caminho_de(nome).unlink(missing_ok=True)
