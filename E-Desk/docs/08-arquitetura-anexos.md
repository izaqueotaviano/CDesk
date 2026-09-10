# E-Desk — Arquitetura de anexos

Decisão sobre upload, armazenamento e download autenticado de anexos de ticket.

**Estado:** a abordagem descrita aqui **já está implementada** (`apps/tickets/services/attachments.py`,
`AttachmentDownloadView`, 12 testes em `test_attachments.py`). Este documento registra
*por que* ela é assim, e separa o que está pronto do que continua em aberto.

| | |
|---|---|
| ✅ Decidido e implementado | §1 abordagem, §2 fluxo, §3 antivírus, §4 LGPD |

---

## 1. Proxy autenticado vs. URL assinada

**Decisão: proxy autenticado.** O Django serve os bytes e reavalia a permissão
a cada request.

O argumento é um só:

> Uma URL assinada é um *bearer token*. Depois de emitida, ela não passa mais
> por verificação de permissão — ela **é** a permissão.

Isso colide de frente com três requisitos do projeto:

| Requisito | Por que a URL assinada falha |
|---|---|
| Download só por quem pode ver aquele ticket | O link sobrevive à revogação. Agente sai do departamento, ticket muda de dono, contrato encerra — a URL emitida às 14h continua valendo até expirar. |
| Regra do Financeiro aplicada no backend (D13) | O storage não sabe o que é departamento restrito. A regra é avaliada na emissão, não no acesso. |
| Auditoria de leitura de ticket sensível | O download acontece fora do Django. Registra-se *que um link foi emitido*, não *que alguém leu o arquivo* — coisas diferentes quando o link vaza num grupo de mensagens. |

O argumento a favor da URL assinada — não passar bytes pelo servidor de aplicação —
é irrelevante neste volume (§5). `FileResponse` faz streaming, não carrega o
arquivo em memória.

### Saída de emergência (não fazer agora)

Se o perfil mudar — arquivos de centenas de MB, vídeo — existe o híbrido:
o Django faz a checagem completa, grava o `TicketAccessLog`, e **só então**
emite uma URL assinada de vida curta (30–60s) como redirect. Troca-se
revogação-no-instante-exato por banda descarregada. Não é o caso de um helpdesk.

---

## 2. Fluxo completo

### 2.1 Upload

Vai junto com a resposta, no mesmo `POST` multipart (`request.FILES.getlist("files")`).
Não há upload direto ao storage — isso elimina a classe inteira de bugs de
"arquivo órfão no bucket sem dono".

Validação do **lote inteiro antes de gravar qualquer byte**:

1. Tamanho por arquivo (`ATTACHMENT_MAX_BYTES`, 25 MB) e acumulado por mensagem
   (`ATTACHMENT_MAX_BYTES_PER_MESSAGE`, 50 MB)
2. Extensão em `BLOCKED_SUFFIXES` (`.exe`, `.sh`, `.jar`, `.msi`…) — higiene, não segurança
3. **MIME real por magic bytes** (`python-magic`) contra `ATTACHMENT_ALLOWED_MIME`

O passo 3 é o que importa. Nunca se confia em duas coisas que o cliente manda:
a extensão e o header `Content-Type`. Ambos são texto arbitrário escolhido por
quem faz o upload. Há teste explícito: um `.exe` renomeado para `.pdf` é recusado.

A validação é **all-or-nothing**. Se o terceiro de cinco arquivos falha, nenhum é
gravado — o usuário não fica com uma mensagem meio-anexada e um erro ambíguo.

### 2.2 Armazenamento

- `sha256` do conteúdo gravado (integridade e deduplicação futura)
- Gravação sob `MEDIA_ROOT`, **fora do webroot**
- `MEDIA_URL = None` — não existe rota estática que sirva esses arquivos

Se alguém amanhã configurar o nginx apontando para o diretório, o teste que
verifica que a URL do serializer é a view autenticada quebra.

### 2.3 Download — `GET /api/v1/attachments/{id}/`

Ordem das checagens:

1. `visible_tickets(request.user)` → fora do escopo responde **404, não 403**.
   Um 403 confirma que o ticket existe; isso é vazamento de metadados entre empresas.
2. `ticket.is_content_visible_to(user)` → a regra do Financeiro, reavaliada **agora**.
3. Anexo de nota interna nunca vai para cliente, mesmo em ticket que ele pode ver.
4. Departamento restrito → grava `TicketAccessLog` com **concedido e negado**.
   A tentativa negada costuma ser o registro mais valioso que existe.
5. `FileResponse` com `Content-Disposition: attachment` e `X-Content-Type-Options: nosniff`
   (impede o browser de reinterpretar um "PDF" como HTML e executar script na origem).

---

## 3. Antivírus — implementado (D19)

Magic bytes provam que o arquivo é um PDF de verdade; **não** provam que é um PDF
inofensivo. PDF com JavaScript, XLSX com macro, ZIP-bomb passariam na validação
de tipo. Por isso o anexo agora nasce em quarentena.

**ClamAV** em container (`docker-compose.yml`), varredura por task Celery
(`apps/tickets/tasks.py::scan_attachment`), estado em
`TicketAttachment.scan_status`:

| Estado | Download |
|---|---|
| `pending` | **409** — transitório, a UI mostra "verificando…" |
| `clean` | 200 |
| `infected` | **403** permanente; arquivo preservado como evidência |
| `error` | **403** por default (`ATTACHMENT_BLOCK_ON_SCAN_ERROR`) |
| `skipped` | 200 — scan desligado ou anexo anterior ao D19 |

As três decisões que sustentam o resto:

1. **Fail-closed.** Daemon fora do ar é retry, nunca aprovação. Esgotadas as
   tentativas, o anexo fica em `error` e continua bloqueado.
2. **Permissão antes da quarentena.** Quem não enxerga o ticket recebe 404 —
   nunca o 409, que revelaria a existência do anexo. Há teste para isso.
3. **`skipped`, não `clean`,** quando o scan está desligado: o registro diz a
   verdade em vez de mentir.

Infecção notifica quem subiu o arquivo e grava `AuditLog` (`scan_blocked`).
O admin tem ação de re-varrer — necessária porque `error` é fail-closed e um
anexo legítimo que pegou o daemon fora do ar precisa de uma saída que não seja
mexer no banco à mão.

Desligar em produção falha `manage.py check --deploy` (`edesk.E001`).

**Verificação:** 35 testes. A política é testada com o daemon mockado; o
protocolo INSTREAM é exercitado contra um servidor TCP que fala o protocolo de
verdade, com o cliente `clamd` real (inclusive detecção do EICAR e arquivo de
3 MB em múltiplos chunks). **Não foi exercitado contra um ClamAV de verdade** —
base de assinaturas, `freshclam` e `StreamMaxLength` continuam por validar no
primeiro `docker compose up`.

Complementos ainda não feitos, quase grátis: `Content-Security-Policy: sandbox`
no download e forçar download em vez de preview inline para PDF.

---

## 4. LGPD

### 4.1 Retenção

Anexos acompanham o ticket: 5 anos após o fechamento (`RETENTION_DAYS["ticket_after_close"]`).

Implementado em D20: `apply_retention_policy` roda diariamente em dry-run,
gravando um `RetentionRun` revisável. Nada é apagado até `RETENTION_DRY_RUN=0`.
Ver `docs/09-lgpd-operacionalizacao.md` §2.

### 4.2 Exclusão / anonimização

`execute_data_subject_request` limpa PII e **preserva linhas e FKs**, para não
quebrar o histórico de tickets de outras empresas nem as métricas.

### 4.3 ✅ Resolvido — o conteúdo do anexo

A anonimização limpa nome, e-mail e telefone dos campos do banco — mas se o
titular anexou uma CNH digitalizada, o PDF ficaria intacto. Não dá para
"anonimizar" o conteúdo de um binário; havia duas saídas defensáveis:

- **(a) Apagar o blob, manter a linha** — `TicketAttachment` permanece com nome,
  tamanho, checksum e autor, marcado `purged_at`. A thread continua legível
  ("houve um anexo aqui, removido a pedido do titular em DD/MM"), o histórico de
  outras empresas não quebra, e o dado pessoal some. **Escolhido e implementado**
  (`purge_blob()`); o download responde **410 Gone** — não 404, porque o anexo
  existiu e essa é a resposta honesta.
- **(b) Manter** — só sustentável com base legal de guarda (obrigação legal,
  exercício de direito em processo) para aquele anexo específico. Não é escolha
  genérica aplicável ao acervo inteiro.

**Backups:** apagar o blob do disco não apaga das cópias de segurança. A resposta
padrão e aceitável é documentar o prazo de rotação e que a exclusão se propaga ao
fim dele — mas precisa estar escrito, não presumido.

---

## 5. Custo e complexidade no volume real

| | Proxy autenticado (atual) | URL assinada | Híbrido |
|---|---|---|---|
| Infra | disco local + backup | S3/R2 + IAM | S3 + Django |
| Custo/mês | ~R$0 marginal | ~US$1–5 | ~US$1–5 |
| Complexidade | baixa (feita) | média | alta |
| Revogação | imediata | só ao expirar | imediata na emissão |
| Auditoria de leitura | completa | ausente | parcial |
| Isolamento entre empresas | na view, testado | depende da chave | na view |
| Banda pelo app | sim (irrelevante aqui) | não | não |

Volume: 500 tickets/mês × ~1,5 anexos × ~2 MB ≈ **1,5 GB/mês**. Storage é ruído;
banda de download idem. O gargalo do sistema não será anexo — será WebSocket de
chat e geração de relatório.

### Migração para S3

Os models usam `FileField`, então trocar para `django-storages` é mudar
`DEFAULT_FILE_STORAGE`. **Nenhuma migração de model, nenhuma mudança na view de
download** — ela continua lendo via `attachment.file.open("rb")` e o storage vira
detalhe. Isso foi de propósito.

Só não deixe o bucket público, senão perde-se exatamente a propriedade que
motivou a decisão inteira.

---

## 6. Resumo

| # | Item | Estado |
|---|---|---|
| 1 | Proxy autenticado em vez de URL assinada | ✅ decidido e implementado |
| 2 | Validação por magic bytes, lote all-or-nothing, `MEDIA_URL = None` | ✅ implementado, 12 testes |
| 3 | ClamAV + quarentena, fail-closed | ✅ implementado (D19), 35 testes |
| 4 | Anexo na anonimização: apagar blob e manter a linha | ✅ implementado (D20), `purge_blob()` |
| 5 | Retenção do D18 aplicada por task agendada | ✅ implementada (D20), em dry-run |
