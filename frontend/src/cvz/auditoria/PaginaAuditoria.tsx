import { useMe } from '@/api/queries/useMe'
import { PageHeader, Tabs } from '@/cvz/components'
import { PainelAcessos } from './PainelAcessos'
import { PainelLgpd } from './PainelLgpd'
import { PainelLogs } from './PainelLogs'
import { PainelRetencao } from './PainelRetencao'
import './auditoria.scss'

/**
 * Auditoria e LGPD — o backend (`apps/audit/`) já existia inteiro, testado,
 * sem nenhuma tela consumindo. Quatro abas: a trilha de auditoria (quem fez
 * o quê, quando), os pedidos LGPD (exportação — self-service, já executa
 * sozinha — e anonimização — verificar identidade, depois executar ou
 * rejeitar com motivo), quem leu ticket de equipe restrita (inclusive
 * tentativa negada) e os ciclos de retenção (simular, revisar — é a revisão
 * que destrava o expurgo efetivo agendado).
 *
 * Todas as views são `IsAdmin` no backend (`Perm.SETTINGS_MANAGE`) — sem
 * este aviso, quem não é admin só veria erro 403 cru em cada painel.
 */
export function PaginaAuditoria() {
  const { data: me } = useMe()
  const podeVer = (me?.permissions ?? []).includes('settings.manage')

  if (me && !podeVer) {
    return (
      <>
        <PageHeader title="Auditoria e LGPD" />
        <p>Esta área é restrita a administradores.</p>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Auditoria e LGPD" description="Trilha de auditoria, pedidos LGPD, acessos restritos e retenção de dados." />
      <Tabs
        items={[
          { id: 'logs', label: 'Log de auditoria', content: <PainelLogs /> },
          { id: 'lgpd', label: 'Pedidos LGPD', content: <PainelLgpd /> },
          { id: 'acessos', label: 'Acessos restritos', content: <PainelAcessos /> },
          { id: 'retencao', label: 'Retenção', content: <PainelRetencao /> },
        ]}
      />
    </>
  )
}
