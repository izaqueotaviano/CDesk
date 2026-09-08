import { useId, useState } from 'react'
import { useAvaliarChat, type Chat, type ConfigChat } from '@/api/chat'
import { ApiError } from '@/api/client'
import { cn } from '../lib/cn'
import { primeiroNome } from '../lib/formato'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Ajuda, ErroCampo, Label, Textarea } from '../ui/input'
import { toast } from '../ui/toaster'

function Escala({
  idBase,
  rotulo,
  valor,
  min,
  max,
  onChange,
}: {
  idBase: string
  rotulo: string
  valor: number | null
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const notas = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const idRotulo = `${idBase}-rotulo`
  // Padrão ARIA de radiogroup: UM tab stop (a nota marcada, ou a primeira) e
  // as setas movem a marcação — sem isto o grupo eram 11 tab stops e a seta
  // não fazia nada.
  const focavel = valor ?? min
  function escolher(n: number) {
    const alvo = Math.min(max, Math.max(min, n))
    onChange(alvo)
    document.getElementById(`${idBase}-${alvo}`)?.focus()
  }
  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    const atual = valor ?? min
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') escolher(atual + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') escolher(atual - 1)
    else if (e.key === 'Home') escolher(min)
    else if (e.key === 'End') escolher(max)
    else return
    e.preventDefault()
  }
  return (
    <div className="flex flex-col gap-2">
      <span id={idRotulo} className="text-pequeno font-medio text-tinta">
        {rotulo}
      </span>
      <div role="radiogroup" aria-labelledby={idRotulo} className="flex flex-wrap gap-1.5" onKeyDown={aoTeclar}>
        {notas.map((n) => (
          <button
            key={n}
            id={`${idBase}-${n}`}
            type="button"
            role="radio"
            aria-checked={valor === n}
            tabIndex={focavel === n ? 0 : -1}
            onClick={() => onChange(n)}
            className={cn(
              'grid h-9 min-w-9 place-items-center rounded-md border border-borda-campo bg-superficie px-1 text-pequeno font-medio text-tinta transition-colors hover:border-acento',
              valor === n && 'border-acento bg-acento text-acento-sobre',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Avaliação obrigatória: estrelas de atendimento + resolução, em modal sem
 * saída (sem X, sem Esc, sem clicar fora) — a regra é literal: "todo chat ao
 * ser encerrado obriga avaliação" e "não é possível abrir novo chat com
 * avaliação pendente". A escala e o gatilho da justificativa obrigatória
 * vêm do `ChatConfig` do servidor, não são fixos aqui.
 */
export function ModalAvaliacao({ chat, config }: { chat: Chat; config: ConfigChat | undefined }) {
  const idBase = useId()
  const min = config?.score_min ?? 0
  const max = config?.score_max ?? 10
  const gatilho = config?.low_score_threshold ?? 5
  const avaliar = useAvaliarChat(chat.id)

  const [atendimento, setAtendimento] = useState<number | null>(null)
  const [resolucao, setResolucao] = useState<number | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const notaBaixa = (atendimento != null && atendimento < gatilho) || (resolucao != null && resolucao < gatilho)
  const faltaJustificativa = notaBaixa && justificativa.trim().length === 0
  const podeEnviar = atendimento != null && resolucao != null && !faltaJustificativa && !avaliar.isPending

  function enviar() {
    if (atendimento == null || resolucao == null) return
    setErro(null)
    avaliar.mutate(
      { service_score: atendimento, resolution_score: resolucao, justification: justificativa.trim() },
      {
        onSuccess: () => toast.success('Obrigado pela avaliação!'),
        onError: (e) =>
          setErro(e instanceof ApiError ? (e.detail ?? 'Não foi possível enviar a avaliação.') : 'Não foi possível enviar a avaliação.'),
      },
    )
  }

  return (
    <Dialog open>
      <DialogContent
        semFechar
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Como foi o atendimento?</DialogTitle>
          <p className="text-pequeno text-tinta-secundaria">
            Conversa {chat.agent_name ? `com ${primeiroNome(chat.agent_name)}` : 'encerrada'} — avalie para poder
            iniciar um novo chat.
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Escala idBase={`${idBase}-a`} rotulo="Atendimento" valor={atendimento} min={min} max={max} onChange={setAtendimento} />
          <Escala idBase={`${idBase}-r`} rotulo="Resolução do problema" valor={resolucao} min={min} max={max} onChange={setResolucao} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-j`}>
              Comentário {notaBaixa ? <span className="text-perigo">(obrigatório para nota abaixo de {gatilho})</span> : '(opcional)'}
            </Label>
            <Textarea
              id={`${idBase}-j`}
              rows={3}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              aria-invalid={faltaJustificativa || undefined}
              aria-describedby={faltaJustificativa ? `${idBase}-j-erro` : undefined}
            />
            {faltaJustificativa ? (
              <ErroCampo id={`${idBase}-j-erro`}>Conte o que aconteceu — ajuda a gente a melhorar.</ErroCampo>
            ) : (
              <Ajuda>Sua nota vai para quem cuidou da conversa.</Ajuda>
            )}
          </div>

          {erro && (
            <p role="alert" className="text-pequeno text-perigo">
              {erro}
            </p>
          )}

          <Button onClick={enviar} disabled={!podeEnviar} className="w-full">
            {avaliar.isPending ? 'Enviando…' : 'Enviar avaliação'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
