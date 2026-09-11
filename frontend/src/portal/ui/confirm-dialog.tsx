import { useState, type ReactNode } from 'react'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'

export interface ConfirmDialogProps {
  aberto: boolean
  onFechar: () => void
  /** Pode ser assíncrono: o botão fica em "Aguarde…" até resolver, e o diálogo só fecha se não lançar. */
  onConfirmar: () => void | Promise<void>
  titulo: string
  descricao?: ReactNode
  rotuloConfirmar?: string
  rotuloCancelar?: string
  /** Ação destrutiva: botão vermelho e não fecha por clique fora / Esc. */
  perigo?: boolean
}

/**
 * Confirmação de uma ação — o mesmo padrão único do ConfirmDialog do cvz:
 * mesmo rodapé, mesmo tratamento de "aguarde", mesma regra de não fechar por
 * acidente quando é destrutivo. Antes cada tela do portal reimplementava
 * isto à mão sobre o Dialog genérico (encerrar conversa, excluir mensagem).
 */
export function ConfirmDialog({
  aberto,
  onFechar,
  onConfirmar,
  titulo,
  descricao,
  rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Cancelar',
  perigo = false,
}: ConfirmDialogProps) {
  const [aguardando, setAguardando] = useState(false)

  async function confirmar() {
    setAguardando(true)
    try {
      await onConfirmar()
      onFechar()
    } finally {
      setAguardando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !aguardando && onFechar()}>
      <DialogContent
        semFechar
        className="max-w-md"
        onPointerDownOutside={(e) => perigo && e.preventDefault()}
        onEscapeKeyDown={(e) => perigo && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={aguardando}>
            {rotuloCancelar}
          </Button>
          <Button variant={perigo ? 'destructive' : 'default'} onClick={confirmar} disabled={aguardando}>
            {aguardando ? 'Aguarde…' : rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
