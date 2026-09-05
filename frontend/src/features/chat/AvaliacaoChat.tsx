import { useState } from 'react'
import { useAvaliarChat, type Chat, type ConfigChat } from '@/api/chat'
import { ApiError } from '@/api/client'
import { Botao } from '@/ui/Botao'

interface Props {
  chat: Chat
  config: ConfigChat | undefined
  onAvaliado: () => void
}

function Escala({
  rotulo,
  valor,
  min,
  max,
  onChange,
}: {
  rotulo: string
  valor: number | null
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const notas = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-corpo font-medio text-tinta">{rotulo}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={rotulo}>
        {notas.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={valor === n}
            onClick={() => onChange(n)}
            className={`min-h-controle min-w-[2.5rem] rounded-md border px-2 text-corpo transition-colors ${
              valor === n
                ? 'border-acento bg-acento text-acento-sobre'
                : 'border-borda-controle bg-superficie text-tinta hover:bg-hover'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * A avaliação que TRAVA o próximo chat: duas notas de propósito (atender
 * bem e não conseguir resolver são coisas diferentes), e a justificativa
 * vira obrigatória quando qualquer uma fica abaixo do gatilho do
 * `ChatConfig` — a escala e o gatilho vêm do backend, não são fixos aqui.
 */
export function AvaliacaoChat({ chat, config, onAvaliado }: Props) {
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
        onSuccess: onAvaliado,
        onError: (e) => setErro(e instanceof ApiError ? (e.detail ?? 'Não foi possível enviar a avaliação.') : 'Não foi possível enviar a avaliação.'),
      },
    )
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 rounded-lg border border-divisoria bg-superficie p-6">
      <div>
        <h1 className="text-titulo font-forte text-tinta">Como foi o atendimento?</h1>
        <p className="mt-1 text-corpo text-tinta-secundaria">
          Conversa {chat.agent_name ? `com ${chat.agent_name}` : 'encerrada'} — avalie para poder abrir um novo chat.
        </p>
      </div>

      <Escala rotulo="Atendimento" valor={atendimento} min={min} max={max} onChange={setAtendimento} />
      <Escala rotulo="Resolução do problema" valor={resolucao} min={min} max={max} onChange={setResolucao} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="justificativa" className="text-pequeno font-medio text-tinta-secundaria">
          Comentário {notaBaixa ? '(obrigatório para nota abaixo de ' + gatilho + ')' : '(opcional)'}
        </label>
        <textarea
          id="justificativa"
          rows={3}
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          aria-invalid={faltaJustificativa || undefined}
          className="rounded-md border border-borda-controle bg-superficie px-3 py-2 text-corpo text-tinta outline-none focus-visible:shadow-foco aria-[invalid=true]:border-perigo"
        />
        {faltaJustificativa && (
          <p className="text-pequeno text-perigo">Conte o que aconteceu — ajuda a gente a melhorar.</p>
        )}
      </div>

      {erro && <p className="text-pequeno text-perigo">{erro}</p>}

      <Botao onClick={enviar} disabled={!podeEnviar}>
        {avaliar.isPending ? 'Enviando…' : 'Enviar avaliação'}
      </Botao>
    </div>
  )
}
