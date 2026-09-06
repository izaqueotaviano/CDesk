import { useMe } from '@/api/queries/useMe'
import { PageHeader, Tabs } from '@/cvz/components'
import { PainelLgpd } from './PainelLgpd'
import { PainelLogs } from './PainelLogs'
import './auditoria.scss'

/**
 * Auditoria e LGPD — o backend (`apps/audit/`) já existia inteiro, testado,
 * sem nenhuma tela consumindo. Duas abas: a trilha de auditoria (quem fez
 * o quê, quando) e os pedidos LGPD (exportação — self-service, já executa
 * sozinha — e anonimização — verificar identidade, depois executar ou
 * rejeitar com motivo). "Acessos a ticket restrito" e o painel de retenção
 * (`RetentionRunViewSet`) ficam fora desta rodada — são ferramentas de
 * investigação/operação mais raras que o dia a dia coberto aqui.
 *
 * As duas views são `IsAdmin` no backend (`Perm.SETTINGS_MANAGE`) — sem
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
      <PageHeader title="Auditoria e LGPD" description="Trilha de auditoria e pedidos de exportação/anonimização de dados." />
      <Tabs
        items={[
          { id: 'logs', label: 'Log de auditoria', content: <PainelLogs /> },
          { id: 'lgpd', label: 'Pedidos LGPD', content: <PainelLgpd /> },
        ]}
      />
    </>
  )
}
