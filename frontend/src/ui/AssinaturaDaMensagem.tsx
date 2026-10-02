/**
 * O rodapé de assinatura de uma mensagem — a mesma peça no console do agente
 * e no portal do cliente, porque é o mesmo conteúdo.
 *
 * O HTML chega PRONTO do servidor (`signature_html` da mensagem), já passado
 * pelo higienizador (`apps/accounts/assinatura.py`): a tela não monta, não
 * escolhe formato e não confia em nada que tenha vindo do texto da mensagem.
 * É por isso que o `dangerouslySetInnerHTML` aqui é aceitável — e é o único
 * lugar da conversa onde ele aparece.
 *
 * O que separa a assinatura do que a pessoa escreveu é a linha de cima e o
 * tom mais apagado: quem lê precisa distinguir "a resposta" de "quem
 * respondeu" sem precisar pensar.
 */
export function AssinaturaDaMensagem({ html }: { html: string }) {
  if (!html) return null
  return (
    <div
      className="assinatura-mensagem mt-3 border-t border-divisoria pt-2 text-legenda text-tinta-secundaria"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
