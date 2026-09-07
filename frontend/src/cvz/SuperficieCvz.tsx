import type { ReactNode } from 'react'
import { ToastProvider } from './components'
import './SuperficieCvz.scss'

/**
 * Ponte visual entre o NovoShell (Resolv) e páginas construídas com
 * `cvz/components` — Clientes, Avisos, Auditoria, Relatórios, Configurações.
 * Fase 1 da unificação de shell: essas rotas saíram do `CvzAppLayout` (que
 * montava a sidebar/topbar do cvzdesk) e passaram a viver dentro do
 * NovoShell, mas o conteúdo em si continua 100% cvz — nunca cuidou do
 * próprio fundo, respiro ou rolagem, porque isso sempre veio de graça do
 * `<main className="surface surface--dashboard">` do AppShell antigo
 * (cvz/components/AppShell/AppShell.scss). Esta casca reproduz só essa
 * parte — não a `.app-shell` inteira, que também fixa `min-height: 100vh`;
 * dentro do `novo-shell__corpo` (que já tem sua própria altura/rolagem) isso
 * sobraria como espaço vazio embaixo do conteúdo curto.
 *
 * `ToastProvider` mora aqui, não no NovoShell: é consumido só por estas
 * páginas (nenhum componente do lado Resolv chama `useToast()` — o shell
 * novo não tinha mecanismo de toast até aqui), então cada rota que precisa
 * ganha o seu — mesmo padrão que o `CvzAppLayout` já usava.
 */
export function SuperficieCvz({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="cvz-superficie">{children}</div>
    </ToastProvider>
  )
}
