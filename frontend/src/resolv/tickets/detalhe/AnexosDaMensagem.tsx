import { abrirNoVisualizador, useVisualizadorImagem } from '@/ui/useVisualizadorImagem'
import { classeIconeDoArquivo } from '../anexos'
import { tamanhoArquivo, urlApi } from './linhaDoTempo'
import type { Anexo } from './tiposDetalhe'

const ROTULO_VARREDURA: Record<string, string> = {
  pending: 'verificando…',
  infected: 'bloqueado pelo antivírus',
  error: 'falha na verificação',
  skipped: 'não verificado',
}

/** Só imagem LIBERADA pela varredura vira miniatura: desenhar a imagem antes
 *  seria servir o arquivo em quarentena pela porta da frente (D19). */
function ehImagemLiberada(a: Anexo): boolean {
  return Boolean(a.is_downloadable && a.url && (a.content_type ?? '').startsWith('image/'))
}

function ChipDeArquivo({ anexo }: { anexo: Anexo }) {
  const tamanho = tamanhoArquivo(anexo.size_bytes)
  const icone = classeIconeDoArquivo(anexo.content_type, anexo.filename)
  if (anexo.is_downloadable && anexo.url) {
    return (
      <a
        className="msg__anexo"
        href={urlApi(anexo.url)}
        download={anexo.filename}
        title={`Baixar ${anexo.filename}`}
      >
        <i className={icone} aria-hidden="true" />
        <span className="msg__anexo-nome">{anexo.filename}</span>
        {tamanho && <span className="msg__anexo-tam">{tamanho}</span>}
        <i className="ti ti-download msg__anexo-baixar" aria-hidden="true" />
      </a>
    )
  }
  const motivo = ROTULO_VARREDURA[anexo.scan_status ?? ''] ?? 'indisponível'
  return (
    <span className="msg__anexo msg__anexo--off" title={`Download indisponível: ${motivo}`}>
      <i className="ti ti-shield" aria-hidden="true" />
      <span className="msg__anexo-nome">{anexo.filename}</span>
      <span className="msg__anexo-tam">{motivo}</span>
    </span>
  )
}

/**
 * Os anexos de uma mensagem do chamado: imagens como miniatura (que abrem o
 * visualizador, com ← → entre as imagens desta mensagem) e o resto como chip
 * de download, com o ícone do tipo e o tamanho.
 */
export function AnexosDaMensagem({ anexos }: { anexos: Anexo[] }) {
  const imagens = anexos.filter(ehImagemLiberada)
  const outros = anexos.filter((a) => !ehImagemLiberada(a))
  const visualizador = useVisualizadorImagem(
    imagens.map((a) => ({
      url: urlApi(a.url!),
      nome: a.filename,
      detalhe: tamanhoArquivo(a.size_bytes),
    })),
  )

  return (
    <div className="msg__anexos">
      {imagens.length > 0 && (
        <ul className="msg__miniaturas" aria-label="Imagens anexadas">
          {imagens.map((a, i) => (
            <li key={a.id}>
              <a
                className="msg__miniatura"
                href={urlApi(a.url!)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Ver ${a.filename}`}
                title={`${a.filename} · ${tamanhoArquivo(a.size_bytes)}`}
                onClick={(e) => abrirNoVisualizador(e, () => visualizador.abrir(i))}
              >
                <img src={urlApi(a.url!)} alt="" loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {outros.length > 0 && (
        <ul className="msg__arquivos" aria-label="Arquivos anexados">
          {outros.map((a) => (
            <li key={a.id}>
              <ChipDeArquivo anexo={a} />
            </li>
          ))}
        </ul>
      )}
      {visualizador.elemento}
    </div>
  )
}
