import { useEffect, useRef, type ReactNode } from 'react'
import { useFocusTrap } from '@/cvz/hooks'
import type { NotaResumo } from '@/api/notas'
import { EditorNota } from './EditorNota'

/**
 * A nota aberta inteira, SOBRE a grade — não no lugar dela.
 *
 * A grade de cartões é a tela; abrir uma nota é entrar nela e sair de volta
 * pro mesmo lugar, com a mesma rolagem e o mesmo filtro. Uma segunda coluna
 * fixa (o desenho antigo) cobrava metade da largura o tempo todo pra mostrar
 * "escolha uma nota à esquerda" na maior parte do tempo.
 *
 * `useFocusTrap` é o MESMO hook do resto dos overlays do sistema
 * (`BuscaComando`, `Modal`/`Drawer` do cvz) — overlay que intercepta teclado
 * não reimplementa foco, é regra do design system (cvz/hooks/index.ts).
 *
 * Fechar NÃO perde o que foi digitado: quem some daqui é o `Campos` de
 * `EditorNota`, e o autosave grava na desmontagem (`autosave.ts`, o efeito
 * de saída) — o mesmo caminho que já protegia a troca de nota.
 */
export function ModalNota({
  nota,
  acoes,
  onFechar,
}: {
  nota: NotaResumo
  /** Fixar/Arquivar/Excluir (ou Restaurar) — quem manda é a página, que já
   *  tem as mutações e o resumo da nota em mãos. */
  acoes: ReactNode
  onFechar: () => void
}) {
  const painelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(painelRef, true)

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // O CKEditor também usa Esc (fecha o menu de cor, o balão de link…) e
      // marca o evento quando consome. Sem esta linha, fechar um menu da
      // barra fecharia a nota inteira junto — o Esc mais caro possível.
      if (e.defaultPrevented) return
      onFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    document.body.classList.add('is-locked')
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.classList.remove('is-locked')
    }
  }, [onFechar])

  return (
    // `mousedown` e não `click`: com `click`, selecionar texto de dentro do
    // editor e soltar o botão fora da caixa contaria como "clicou fora" e
    // fechava a nota no meio de uma seleção.
    <div
      className="modal-nota__veu"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar()
      }}
    >
      <div
        ref={painelRef}
        className="modal-nota"
        role="dialog"
        aria-modal="true"
        aria-label={`Nota: ${nota.title || 'Sem título'}`}
      >
        <header className="modal-nota__topo">
          <p className="modal-nota__migalha">
            Notas
            <i className="ti ti-chevron-right" aria-hidden="true" />
            <span>{nota.title || 'Sem título'}</span>
          </p>
          <div className="modal-nota__acoes">
            {acoes}
            <button
              type="button"
              className="modal-nota__fechar"
              onClick={onFechar}
              aria-label="Fechar nota"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="modal-nota__corpo">
          <EditorNota notaId={nota.id} />
        </div>
      </div>
    </div>
  )
}
