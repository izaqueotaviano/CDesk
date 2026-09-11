import { useSearchParams } from 'react-router-dom'
import { PageHeader, Tabs } from '@/cvz/components'
import { AbaBackup } from './AbaBackup'
import { AbaCalendarios } from './AbaCalendarios'
import { AbaCategorias } from './AbaCategorias'
import { AbaChat } from './AbaChat'
import { AbaEquipes } from './AbaEquipes'
import { AbaImportar } from './AbaImportar'
import { AbaModeracao } from './AbaModeracao'
import { AbaPapeis } from './AbaPapeis'
import { AbaPlanos } from './AbaPlanos'
import { AbaServicos } from './AbaServicos'
import { AbaSistema } from './AbaSistema'
import { AbaTelaDeLogin } from './AbaTelaDeLogin'
import { AbaSla } from './AbaSla'
import { AbaStatus } from './AbaStatus'
import { AbaTags } from './AbaTags'
import './configuracoes.scss'

const ABAS = [
  'status',
  'servicos',
  'categorias',
  'tags',
  'sla',
  'equipes',
  'planos',
  'papeis',
  'calendarios',
  'operacao',
  'chat',
  'moderacao',
  'login',
  'importar',
  'backup',
] as const
const ABA_PADRAO = ABAS[0]

/**
 * Fase 1 do plano aprovado — cadastros de ticket primeiro (Status, Serviços,
 * Categorias, Tags), porque são os quatro mais parecidos entre si e o que a
 * tela de abertura de chamado já consome hoje. SLA, Equipes, Planos, Papéis
 * e Expediente/Feriados vieram na sequência, e Operação (singleton, sem
 * lista — rótulo "Configurações → Operação" do D22 em
 * docs/04-decisoes-tomadas.md) fecha a fase — "Empresas"/"Usuários" não
 * duplicam aqui: já têm tela própria em /clientes.
 */
export function PaginaConfiguracoes() {
  const [searchParams, setSearchParams] = useSearchParams()

  // A aba ativa mora na URL (?aba=tags), não só no estado interno do Tabs —
  // achado da revisão de UX (ui-ux-pro-max, categoria "Deep Linking"): sem
  // isso, um F5 ou um link compartilhado sempre voltava pra primeira aba,
  // mesmo que a pessoa estivesse trabalhando em "Tags" havia 10 minutos.
  const abaParam = searchParams.get('aba')
  const abaInicial = (ABAS as readonly string[]).includes(abaParam ?? '') ? (abaParam as string) : ABA_PADRAO

  function trocarAba(id: string) {
    setSearchParams(id === ABA_PADRAO ? {} : { aba: id }, { replace: true })
  }

  return (
    <>
      <PageHeader title="Configurações" description="Cadastros que alimentam a abertura e a triagem de chamados." />

      <Tabs
        defaultId={abaInicial}
        onChange={trocarAba}
        items={[
          { id: 'status', label: 'Status', content: <AbaStatus /> },
          { id: 'servicos', label: 'Serviços', content: <AbaServicos /> },
          { id: 'categorias', label: 'Categorias', content: <AbaCategorias /> },
          { id: 'tags', label: 'Tags', content: <AbaTags /> },
          { id: 'sla', label: 'SLA', content: <AbaSla /> },
          { id: 'equipes', label: 'Equipes', content: <AbaEquipes /> },
          { id: 'planos', label: 'Planos', content: <AbaPlanos /> },
          { id: 'papeis', label: 'Papéis', content: <AbaPapeis /> },
          // Rótulo "Expediente", não "Calendário", pra não confundir com o
          // item de mesmo nome no menu principal (agenda/eventos — fora do
          // escopo por enquanto, sem model de eventos no backend). Aqui é
          // só horário comercial + feriados (BusinessCalendar/Holiday).
          { id: 'calendarios', label: 'Expediente', content: <AbaCalendarios /> },
          // Última porque é a única que não é cadastro: são os parâmetros
          // operacionais (linha única em banco) que valem para o sistema todo.
          { id: 'operacao', label: 'Operação', content: <AbaSistema /> },
          // Parâmetros do chat (ChatConfig): boas-vindas, timeout da fila,
          // teto de atendimentos por agente (que também é o teto de painéis
          // do mini chat) e a escala da avaliação.
          { id: 'chat', label: 'Chat', content: <AbaChat /> },
          // Lista de palavras censuradas no chat — a regra (censura na
          // exibição, retroativa) é do backend; aqui é só a lista.
          { id: 'moderacao', label: 'Moderação', content: <AbaModeracao /> },
          // Textos e imagem do painel da tela de login, por público.
          { id: 'login', label: 'Tela de login', content: <AbaTelaDeLogin /> },
          // Ferramentas de administração (apps/ferramentas): trazer os tickets
          // do Movidesk pela API, e o backup/restauração do banco. Por último
          // porque não são cadastro nem parâmetro — são operações.
          { id: 'importar', label: 'Importar', content: <AbaImportar /> },
          { id: 'backup', label: 'Backup', content: <AbaBackup /> },
        ]}
      />
    </>
  )
}
