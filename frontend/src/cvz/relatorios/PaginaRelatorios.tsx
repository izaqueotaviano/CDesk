import { PageHeader, Tabs } from '@/cvz/components'
import { PainelChats } from './PainelChats'
import { PainelDetalhado } from './PainelDetalhado'
import { PainelIndicadores } from './PainelIndicadores'
import './relatorios.scss'

/**
 * Relatórios — a tela só existia como placeholder na base antiga (/app,
 * `PaginaPendente`); aqui é a primeira de verdade, sobre o backend que já
 * existia inteiro (`apps/reports/`, indicadores gerenciais + exportação
 * síncrona de CSV). Fora desta rodada, de propósito: exportação assíncrona em
 * XLSX/PDF (`ReportExportViewSet`) e uma segunda listagem de tickets no
 * "Relatório detalhado" — a de /chamados já cobre isso, com os mesmos filtros.
 */
export function PaginaRelatorios() {
  return (
    <>
      <PageHeader title="Relatórios" description="Indicadores do time e exportação para planilha." />
      <Tabs
        items={[
          { id: 'indicadores', label: 'Indicadores', content: <PainelIndicadores /> },
          { id: 'detalhado', label: 'Relatório detalhado', content: <PainelDetalhado /> },
          { id: 'chats', label: 'Chats', content: <PainelChats /> },
        ]}
      />
    </>
  )
}
