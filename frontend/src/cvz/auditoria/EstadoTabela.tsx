import type { ReactNode } from 'react'
import { Skeleton } from '@/cvz/components'

/**
 * Estados das tabelas da Auditoria, iguais nos quatro painéis: enquanto
 * carrega, linhas-fantasma com as colunas da tabela (a tabela não "pula" de
 * uma linha de texto para vinte linhas quando os dados chegam); sem dado, a
 * linha inteira vira o recado, centrado.
 */
export function LinhasCarregando({ colunas, linhas = 4 }: { colunas: number; linhas?: number }) {
  return (
    <>
      {Array.from({ length: linhas }, (_, i) => (
        <tr key={i} className="auditoria-tabela__linha-estado" aria-hidden={i > 0 || undefined}>
          {Array.from({ length: colunas }, (_, c) => (
            <td key={c}>
              {/* O leitor de tela ouve uma vez só, na primeira célula. */}
              {i === 0 && c === 0 && <span className="sr-only">Carregando</span>}
              <Skeleton width={c === 0 ? '64%' : c % 2 ? '48%' : '72%'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function LinhaVazia({ colunas, children }: { colunas: number; children: ReactNode }) {
  return (
    <tr className="auditoria-tabela__linha-estado">
      <td colSpan={colunas} className="auditoria-tabela__vazio">
        {children}
      </td>
    </tr>
  )
}
