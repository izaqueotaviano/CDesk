import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { NadaParaPegar, usePegarProximo, useQuantosSemDono } from './usePegarProximo'

/**
 * A ação principal da Início: pegar o chamado sem responsável mais urgente e
 * já cair nele. Substitui o "Novo ticket" que ficava aqui — esse já é a
 * primeira ação da sidebar, em toda tela; repetir na Início era o mesmo botão
 * duas vezes na mesma vista. Quem abre a Início quer saber o que atender, e
 * este é o atalho para "o que atender AGORA".
 *
 * Sem nada para pegar, o botão continua focável (`aria-disabled`, não
 * `disabled`) e a frase ao lado diz por quê — um botão morto sem explicação
 * parece defeito, e `disabled` de verdade some da navegação por teclado.
 */
export function PegarProximo({ meuId }: { meuId: number | undefined }) {
  const navigate = useNavigate()
  const dicaId = useId()
  const { data: quantos, isLoading } = useQuantosSemDono()
  const pegar = usePegarProximo(meuId)

  const nada = quantos === 0
  const indisponivel = nada || isLoading || meuId == null || pegar.isPending

  function aoClicar() {
    if (indisponivel) return
    pegar.mutate(undefined, { onSuccess: (t) => navigate(`/tickets/${t.id}`) })
  }

  const erro = pegar.error
  const textoErro =
    erro instanceof NadaParaPegar
      ? 'Alguém pegou antes. Não sobrou ticket sem responsável.'
      : erro instanceof ApiError && erro.detail
        ? `Não foi possível pegar o ticket: ${erro.detail}`
        : erro
          ? 'Não foi possível pegar o ticket. Tente de novo.'
          : null

  return (
    <div className="inicio__pegar">
      <button
        type="button"
        className="inicio__botao"
        aria-disabled={indisponivel || undefined}
        aria-busy={pegar.isPending || undefined}
        aria-describedby={dicaId}
        onClick={aoClicar}
      >
        <i className="ti ti-inbox" aria-hidden="true" />
        {pegar.isPending ? 'Pegando…' : 'Pegar o próximo'}
      </button>
      {textoErro ? (
        <p id={dicaId} className="inicio__dica inicio__dica--erro" role="alert">
          {textoErro}
        </p>
      ) : (
        <p id={dicaId} className="inicio__dica">
          {isLoading
            ? 'Procurando tickets sem responsável'
            : nada
              ? 'Nenhum ticket sem responsável agora'
              : `${quantos} sem responsável, o mais urgente primeiro`}
        </p>
      )}
    </div>
  )
}
