import { useState } from 'react';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import './ConfirmDialog.scss';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ação destrutiva usa Button danger e não fecha por clique fora. */
  danger?: boolean;
}

/**
 * Confirmação de uma ação. Não é um Modal genérico com dois botões — é o
 * padrão único para "tem certeza": mesmo texto de rodapé, mesmo tratamento de
 * loading, mesma regra de não fechar por acidente quando é destrutivo.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!danger}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'Aguarde…' : confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="confirm-dialog__text">{description}</p>}
    </Modal>
  );
}

export default ConfirmDialog;
