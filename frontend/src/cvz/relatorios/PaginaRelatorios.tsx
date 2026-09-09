import { PageHeader, Tabs } from '@/cvz/components'
import { PainelChatDesempenho } from './PainelChatDesempenho'
import { PainelChats } from './PainelChats'
import { PainelDesfechos } from './PainelDesfechos'
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
 *
 * "Chats" (`PainelChats`/`ChatStatsView`) é volume — quantos chats cada
 * agente atendeu. "Desempenho do chat" (`PainelChatDesempenho`) é qualidade
 * — tempo de espera/atendimento e nota — e vem de outro endpoint
 * (`ChatReportView`, `apps.chat`) que ficou sem tela até esta rodada.
 * "Desfechos" (`PainelDesfechos`/`chats/metrics/`) é a terceira pergunta:
 * COMO terminaram — motivo de encerramento, quantos o sistema fechou
 * sozinho, quantos voltaram e quantas pessoas não avaliaram. São três abas
 * e não uma porque são três perguntas que se fazem em momentos diferentes;
 * juntá-las daria uma tela que responde tudo e não se lê.
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
          { id: 'chat-desempenho', label: 'Desempenho do chat', content: <PainelChatDesempenho /> },
          { id: 'chat-desfechos', label: 'Desfechos', content: <PainelDesfechos /> },
        ]}
      />
    </>
  )
}
