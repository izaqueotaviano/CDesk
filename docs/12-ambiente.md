# 12 — Preparar a máquina (Docker e Node)

Só duas ferramentas são necessárias para rodar o resolv: **Docker** (backend,
banco, Redis e worker) e **Node** (frontend). Python fica dentro do container —
não precisa instalar na máquina.

**Node 22 LTS.** O Vite 6 aceita `18 || 20 || >=22`, mas o 18 saiu de suporte em
2025 e o 21 nem entra na lista (só versões pares viram LTS). Use a 22.

---

## macOS

**Caminho direto (o que menos falha):** baixe os instaladores e siga o
assistente.

- Docker Desktop: <https://www.docker.com/products/docker-desktop/> (`.dmg`)
- Node 22 LTS: <https://nodejs.org> (`.pkg`, escolha o LTS)

Depois **abra o Docker Desktop uma vez** pelo Launchpad e espere a baleia ficar
verde na barra de menu — o `docker` na linha de comando só funciona com ele
rodando.

**Com Homebrew**, se preferir. O nome do pacote do Docker Desktop já mudou uma
vez (`docker` → `docker-desktop`), então confirme antes de instalar em vez de
copiar um comando que pode estar velho:

```bash
brew search docker              # descubra o token atual
brew install --cask docker-desktop
brew install node@22
```

Duas armadilhas do Homebrew no macOS:

- existe uma **fórmula** `docker` (sem `--cask`) que instala só o CLI, sem o
  motor. Com ela o `docker run` falha dizendo que não conecta ao daemon;
- em Mac com Apple Silicon o Homebrew instala em `/opt/homebrew` e **não entra
  no PATH sozinho** — no fim da instalação ele imprime dois comandos
  `echo >> ~/.zprofile`. Sem rodá-los, `brew` continua "command not found"
  mesmo instalado.

Se o `node` não aparecer no PATH depois do `brew install node@22`:

```bash
brew link --overwrite --force node@22
```

## Windows

```powershell
winget install Docker.DockerDesktop
winget install OpenJS.NodeJS.LTS
```

O Docker Desktop exige **WSL2**. Se ele reclamar na primeira abertura:

```powershell
wsl --install        # depois reinicie o computador
```

**Recomendação:** rode o projeto **dentro do WSL2** (Ubuntu), não no PowerShell.
No Windows nativo, `make` não existe por padrão e finais de linha CRLF quebram
scripts de container. Com o WSL instalado, abra o terminal do Ubuntu e siga a
seção de Linux abaixo — o Docker Desktop se integra sozinho.

## Linux (Ubuntu/Debian)

Docker Engine pelo script oficial:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # usar docker sem sudo
newgrp docker                      # aplica o grupo sem deslogar
```

Node 22 pelo NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

`make` normalmente já vem; se não: `sudo apt install -y make`.

---

## Conferir

```bash
docker --version          # 24+ 
docker compose version    # v2.x  ← com ESPAÇO, não docker-compose
node -v                   # v22.x
npm -v
```

O `docker compose` (subcomando, v2) é o que o Makefile usa. O `docker-compose`
com hífen é a v1, descontinuada — se só ele existir na sua máquina, atualize o
Docker em vez de editar o Makefile.

Teste se o Docker realmente responde:

```bash
docker run --rm hello-world
```

## Quanto baixa

A primeira subida puxa as imagens (Postgres, Redis, ClamAV e a imagem da app) —
algo em torno de **2 GB**, uns minutos em banda residencial. Depois disso fica
em cache. O ClamAV é o mais pesado e ainda baixa a base de vírus na primeira
execução; até terminar, anexo enviado fica em quarentena, o que é o
comportamento correto (D19, fail-closed) e não um erro.

## Sem Docker

Dá para rodar tudo na máquina, mas aí você instala PostgreSQL 16, Redis e
Python 3.11 por conta própria — ver a seção "Sem Docker" do README. Com Docker é
um comando; sem ele, quatro serviços para manter de pé.
