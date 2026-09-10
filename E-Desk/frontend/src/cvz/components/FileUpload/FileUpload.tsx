import { useRef, useState, type DragEvent } from 'react';
import { IconFile, IconTrash, IconUpload } from '../icons';
import { fileSize } from '../ChatWidget/ChatWidget';
import './FileUpload.scss';

export interface FileUploadProps {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  /** Em MB. Arquivo maior é rejeitado com uma mensagem no lugar do erro genérico. */
  maxSizeMb?: number;
  disabled?: boolean;
}

/**
 * Área de arrastar-e-soltar com clique alternativo. Usado no ReplyEditor e em
 * qualquer formulário que precise anexar mais de um arquivo — para um anexo
 * só dentro de um campo estreito, ver o padrão do ChatWidget.
 */
export function FileUpload({
  files,
  onChange,
  multiple = true,
  accept,
  maxSizeMb,
  disabled = false,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accepted = (list: FileList | File[]): File[] => {
    const arr = Array.from(list);
    if (!maxSizeMb) return arr;
    const tooBig = arr.filter((f) => f.size > maxSizeMb * 1024 * 1024);
    if (tooBig.length > 0) {
      setRejected(
        `${tooBig.length === 1 ? 'Um arquivo excede' : `${tooBig.length} arquivos excedem`} o limite de ${maxSizeMb}MB.`,
      );
    } else {
      setRejected(null);
    }
    return arr.filter((f) => f.size <= maxSizeMb * 1024 * 1024);
  };

  const addFiles = (list: FileList | File[]) => {
    const ok = accepted(list);
    onChange(multiple ? [...files, ...ok] : ok.slice(0, 1));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const removeAt = (i: number) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div className="file-upload">
      <div
        className={
          'file-upload__zone' +
          (dragging ? ' file-upload__zone--dragging' : '') +
          (disabled ? ' file-upload__zone--disabled' : '')
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Anexar arquivo"
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <IconUpload className="file-upload__icon" />
        <p className="file-upload__text">
          Arraste um arquivo aqui ou <span>clique para escolher</span>
        </p>
        {maxSizeMb && (
          <span className="file-upload__hint">Até {maxSizeMb}MB por arquivo</span>
        )}
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple={multiple}
          accept={accept}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {rejected && <p className="file-upload__error">{rejected}</p>}

      {files.length > 0 && (
        <ul className="file-upload__list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="file-upload__item">
              <IconFile className="file-upload__item-icon" />
              <span className="file-upload__item-name">
                <b>{f.name}</b>
                <span>{fileSize(f.size)}</span>
              </span>
              <button
                type="button"
                aria-label={`Remover ${f.name}`}
                onClick={() => removeAt(i)}
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FileUpload;
