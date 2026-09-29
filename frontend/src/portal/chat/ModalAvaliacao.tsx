import { useId, useState } from 'react'
import { useAvaliarChat, useEncerrarChat, type Chat, type ConfigChat } from '@/api/chat'
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
 * Avaliação obrigatória: notas de atendimento + resolução, em modal sem saída
 * (sem X, sem Esc, sem clicar fora). A escala e o gatilho da justificativa
 * obrigatória vêm do `ChatConfig` do servidor, não são fixos aqui.
 *
 * Dois caminhos chegam neste modal, e a diferença é QUANDO o chat fecha:
 *
 * - `modo="encerrando"` — o cliente clicou "Encerrar conversa". Avaliar e
 *   encerrar viram UMA chamada (`close` levando as notas), atômica no
 *   serviço: o chat só fica encerrado se a nota gravar. É o "somente
 *   finalizar depois que a avaliação for salva com sucesso" do brief. Falhou?
 *   O que a pessoa digitou continua na tela e o botão volta — sem perder nada
 *   e sem um chat encerrado sem nota.
 * - `modo="pendente"` (padrão) — o chat JÁ fechou, porque o agente encerrou
 *   ou o sistema encerrou por inatividade. Aqui o cliente não estava
 *   necessariamente na tela, então a nota é cobrada na próxima vez que ele
 *   entra no portal, e a chamada é o `rate` de sempre.
 */
export function ModalAvaliacao({
  chat,
  config,
  modo = 'pendente',
  onCancelar,
  onEncerrada,
}: {
  chat: Chat
  config: ConfigChat | undefined
  modo?: 'pendente' | 'encerrando'
  /** Só existe em `encerrando`: desistir de encerrar devolve a conversa. */
  onCancelar?: () => void
  /** Só existe em `encerrando`: a nota gravou e o chat fechou. Quem avisa é
   *  este modal, mas quem MOSTRA a confirmação é a página — ver
   *  `DialogConversaEncerrada`. */
  onEncerrada?: () => void
}) {
  const idBase = useId()
  const min = config?.score_min ?? 0
  const max = config?.score_max ?? 10
  const gatilho = config?.low_score_threshold ?? 5
  const avaliar = useAvaliarChat(chat.id)
  const encerrar = useEncerrarChat(chat.id)

  const [atendimento, setAtendimento] = useState<number | null>(null)
  const [resolucao, setResolucao] = useState<number | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const enviando = avaliar.isPending || encerrar.isPending
  const notaBaixa = (atendimento != null && atendimento < gatilho) || (resolucao != null && resolucao < gatilho)
  const faltaJustificativa = notaBaixa && justificativa.trim().length === 0
  const podeEnviar = atendimento != null && resolucao != null && !faltaJustificativa && !enviando

  function enviar() {
    if (atendimento == null || resolucao == null) return
    setErro(null)
    const notas = {
      service_score: atendimento,
      resolution_score: resolucao,
      justification: justificativa.trim(),
    }
    // O erro NÃO limpa os campos: o state local segue intacto e o botão volta
    // a ficar disponível — tentar de novo é clicar de novo.
    const aoFalhar = (e: unknown) =>
      setErro(
        e instanceof ApiError
          ? (e.detail ?? 'Não foi possível enviar a avaliação.')
          : 'Não foi possível enviar a avaliação.',
      )

    if (modo === 'encerrando') {
      encerrar.mutate(notas, { onSuccess: () => onEncerrada?.(), onError: aoFalhar })
      return
    }
    avaliar.mutate(notas, {
      onSuccess: () => toast.success('Obrigado pela avaliação!'),
      onError: aoFalhar,
    })
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
          <DialogTitle>
            {modo === 'encerrando' ? 'Antes de encerrar, como foi?' : 'Como foi o atendimento?'}
          </DialogTitle>
          <p className="text-pequeno text-tinta-secundaria">
            {modo === 'encerrando'
              ? `A conversa ${chat.agent_name ? `com ${primeiroNome(chat.agent_name)} ` : ''}é encerrada assim que você enviar a avaliação.`
              : `Conversa ${chat.agent_name ? `com ${primeiroNome(chat.agent_name)}` : 'encerrada'}. Avalie para poder iniciar um novo chat.`}
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
              <ErroCampo id={`${idBase}-j-erro`}>Conte o que aconteceu. Isso ajuda a gente a melhorar.</ErroCampo>
            ) : (
              <Ajuda>Sua nota vai para quem cuidou da conversa.</Ajuda>
            )}
          </div>

          {erro && (
            <p role="alert" className="text-pequeno text-perigo">
              {erro}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={enviar} disabled={!podeEnviar} className="w-full">
              {enviando
                ? (modo === 'encerrando' ? 'Encerrando…' : 'Enviando…')
                : (modo === 'encerrando' ? 'Avaliar e encerrar' : 'Enviar avaliação')}
            </Button>
            {modo === 'encerrando' && onCancelar && (
              <Button variant="ghost" onClick={onCancelar} disabled={enviando} className="w-full">
                Continuar conversando
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Confirmação de encerramento (item 1 do brief): quem encerrou precisa VER que
 * terminou.
 *
 * Mora fora do `ModalAvaliacao` de propósito. Ao fechar, o chat sai da consulta
 * de "conversa viva" e a `Conversa` desmonta junto — um estado interno morreria
 * com ela e o cliente voltaria para uma lista vazia sem explicação, que é
 * exatamente o que o item pede para não acontecer. Quem renderiza é a página,
 * que sobrevive à conversa.
 */
export function DialogConversaEncerrada({ onFechar }: { onFechar: () => void }) {
  return (
    <Dialog open>
      <DialogContent semFechar onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Conversa encerrada</DialogTitle>
          <p className="text-pequeno text-tinta-secundaria">
            Obrigado pela avaliação. A conversa fica guardada no seu histórico, e você pode
            iniciar uma nova quando precisar.
          </p>
        </DialogHeader>
        <Button onClick={onFechar} className="w-full">
          Entendi
        </Button>
      </DialogContent>
    </Dialog>
  )
}
