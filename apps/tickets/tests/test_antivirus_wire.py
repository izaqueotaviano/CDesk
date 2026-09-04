"""Integração real com a biblioteca `clamd` (D19).

Os outros testes trocam `scan_stream` por um `Mock` — provam a política, não a
conversa. Aqui sobe um servidor TCP que fala o protocolo INSTREAM do ClamAV de
verdade, e o cliente `clamd` real conversa com ele: socket, enquadramento em
chunks e parsing da resposta são exercitados de ponta a ponta.

Não substitui o daemon de verdade (base de assinaturas, limites, freshclam),
mas fecha a lacuna que mais dói: se a tradução da resposta estiver errada,
todo o resto da suíte passa e nada funciona em produção.

Protocolo (o cliente `clamd` usa o modo `n`, terminado por newline):
    cliente → "nINSTREAM\\n", depois <tamanho big-endian 4B><dados>...,
              terminado por um chunk de tamanho zero
    servidor → "stream: OK\\n" | "stream: <assinatura> FOUND\\n"
"""

import socket
import struct
import threading

import pytest
from django.test import override_settings

from apps.tickets.services import antivirus

EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


class FakeClamd(threading.Thread):
    """Daemon mínimo: responde FOUND se o payload contiver a marca do EICAR."""

    daemon = True

    def __init__(self):
        super().__init__()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(1)
        self.port = self.sock.getsockname()[1]
        self.received = b""

    def run(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                self._serve(conn)

    def _serve(self, conn):
        command = self._read_command(conn)
        if command.startswith(b"PING"):
            conn.sendall(b"PONG\n")
            return
        if not command.startswith(b"INSTREAM"):
            conn.sendall(b"UNKNOWN COMMAND\n")
            return

        payload = b""
        while True:
            header = self._recv_exactly(conn, 4)
            if not header:
                break
            (length,) = struct.unpack(b"!L", header)
            if length == 0:  # fim do stream
                break
            payload += self._recv_exactly(conn, length)

        self.received = payload
        if b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE" in payload:
            conn.sendall(b"stream: Eicar-Test-Signature FOUND\n")
        else:
            conn.sendall(b"stream: OK\n")

    @staticmethod
    def _read_command(conn) -> bytes:
        """Lê byte a byte: o comando termina em \\n e logo em seguida já vêm
        os chunks binários, que não podem ser consumidos por engano."""
        buffer = b""
        while not buffer.endswith(b"\n"):
            chunk = conn.recv(1)
            if not chunk:
                break
            buffer += chunk
        return buffer.lstrip(b"zn").strip()

    @staticmethod
    def _recv_exactly(conn, size: int) -> bytes:
        buffer = b""
        while len(buffer) < size:
            chunk = conn.recv(size - len(buffer))
            if not chunk:
                return buffer
            buffer += chunk
        return buffer

    def stop(self):
        self.sock.close()


@pytest.fixture
def daemon():
    server = FakeClamd()
    server.start()
    with override_settings(CLAMAV_HOST="127.0.0.1", CLAMAV_PORT=server.port):
        yield server
    server.stop()


def test_clean_file_round_trips_over_the_real_client(daemon, tmp_path):
    path = tmp_path / "ok.bin"
    path.write_bytes(b"conteudo inofensivo" * 100)

    with path.open("rb") as handle:
        assert antivirus.scan_stream(handle) == (antivirus.CLEAN, "")

    # o daemon recebeu o arquivo inteiro, não só o começo
    assert daemon.received == path.read_bytes()


def test_eicar_is_detected_end_to_end(daemon, tmp_path):
    """EICAR é a assinatura padrão de teste de antivírus — não é malware."""
    path = tmp_path / "eicar.txt"
    path.write_bytes(EICAR)

    with path.open("rb") as handle:
        verdict, signature = antivirus.scan_stream(handle)

    assert verdict == antivirus.INFECTED
    assert signature == "Eicar-Test-Signature"


def test_large_file_is_chunked_not_truncated(daemon, tmp_path):
    """Arquivo maior que um chunk: o que chega ao daemon precisa ser o todo."""
    payload = b"A" * (3 * 1024 * 1024)
    path = tmp_path / "grande.bin"
    path.write_bytes(payload)

    with path.open("rb") as handle:
        assert antivirus.scan_stream(handle) == (antivirus.CLEAN, "")

    assert len(daemon.received) == len(payload)


def test_ping_reports_health(daemon):
    assert antivirus.ping() is True


def test_ping_is_false_when_daemon_is_down():
    with override_settings(CLAMAV_HOST="127.0.0.1", CLAMAV_PORT=1):
        assert antivirus.ping() is False


def test_dead_daemon_raises_transient_error(tmp_path):
    path = tmp_path / "x.bin"
    path.write_bytes(b"x")

    with override_settings(CLAMAV_HOST="127.0.0.1", CLAMAV_PORT=1):
        with path.open("rb") as handle:
            with pytest.raises(antivirus.ScanUnavailable):
                antivirus.scan_stream(handle)
