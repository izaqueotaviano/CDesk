import { useState } from 'react'
import { Button, ConfirmDialog, DataTable, ErrorState, IconButton, TextInput, type Column } from '@/cvz/components'
import { IconPlus, IconTrash } from '@/cvz/components/icons'
import { useToast } from '@/cvz/components/Toast/Toast'
import { ApiError } from '@/api/client'
import { useCriarPalavraBanida, useExcluirPalavraBanida, usePalavrasBanidas, type PalavraBanida } from './dados'

/**
 * Lista de moderação do chat. A censura é na EXIBIÇÃO (o backend troca a
 * palavra por **** ao serializar, nos dois lados da conversa): cadastrar
 * aqui censura mensagem antiga também, e remover devolve o texto original
 * na hora — o banco nunca perde o que foi escrito.
 */
export function AbaModeracao() {
  const { data: itens, isLoading, isError, error, refetch } = usePalavrasBanidas()
  const criar = useCriarPalavraBanida()
  const excluir = useExcluirPalavraBanida()
  const { push } = useToast()

  const [nova, setNova] = useState('')
  const [paraExcluir, setParaExcluir] = useState<PalavraBanida | null>(null)

  async function adicionar() {
    const palavra = nova.trim().toLowerCase()
    if (!palavra) return
    try {
      await criar.mutateAsync(palavra)
      setNova('')
      push({ tone: 'success', title: 'Palavra adicionada', description: 'Vale para mensagens antigas também.' })
    } catch (e) {
      push({
        tone: 'danger',
        title: 'Não foi possível adicionar',
        description: e instanceof ApiError ? (e.detail ?? e.fieldErrors?.word?.[0]) : undefined,
      })
    }
  }

  const colunas: Column<PalavraBanida>[] = [
    { key: 'word', header: 'Palavra', mobile: 'title', render: (p) => <code>{p.word}</code> },
    {
      key: 'excluir',
      header: '',
      mobile: 'hidden',
      render: (p) => (
        <IconButton Icon={IconTrash} label={`Remover ${p.word}`} size="sm" bare onClick={() => setParaExcluir(p)} />
      ),
    },
  ]

  if (isError) {
    return <ErrorState description={error instanceof ApiError ? error.detail : undefined} onRetry={() => refetch()} />
  }

  return (
    <div className="cfg-aba">
      <p className="cfg-meta-form">
        Palavras desta lista aparecem como <code>****</code> no chat, para cliente e agente. O texto original
        continua guardado: a lista vale para mensagens antigas e remover uma palavra devolve o texto na hora.
      </p>
      <div className="cfg-aba__add-linha">
        <TextInput
          placeholder="Palavra a censurar"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && adicionar()}
        />
        <Button Icon={IconPlus} onClick={adicionar} disabled={criar.isPending || !nova.trim()}>
          Adicionar
        </Button>
      </div>

      <DataTable
        rows={itens ?? []}
        columns={colunas}
        rowKey={(p) => String(p.id)}
        loading={isLoading}
        empty="Nenhuma palavra na lista. Nada é censurado."
      />

      <ConfirmDialog
        open={!!paraExcluir}
        onClose={() => setParaExcluir(null)}
        onConfirm={async () => {
          if (!paraExcluir) return
          try {
            await excluir.mutateAsync(paraExcluir.id)
            push({ tone: 'success', title: 'Palavra removida', description: 'O texto original volta a aparecer.' })
          } catch (e) {
            push({ tone: 'danger', title: 'Não foi possível remover', description: e instanceof ApiError ? e.detail : undefined })
          }
        }}
        title={`Remover "${paraExcluir?.word}" da lista?`}
        description="As mensagens que continham a palavra voltam a mostrar o texto original, inclusive as antigas."
        confirmLabel="Remover"
        danger
      />
    </div>
  )
}
