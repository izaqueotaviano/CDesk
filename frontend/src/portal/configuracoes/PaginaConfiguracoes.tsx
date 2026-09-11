import { IconBuilding, IconDeviceDesktop, IconFileText, IconKey, IconMail, IconPalette, IconShieldCheck, IconUser, type Icon } from '@tabler/icons-react'
import { SecaoAcessos } from './SecaoAcessos'
import { SecaoAparencia } from './SecaoAparencia'
import { SecaoEmpresa } from './SecaoEmpresa'
import { SecaoMeusDados } from './SecaoMeusDados'
import { SecaoNotificacoes } from './SecaoNotificacoes'
import { SecaoPerfil } from './SecaoPerfil'
import { SecaoSeguranca } from './SecaoSeguranca'
import { SecaoSenha } from './SecaoSenha'

const SECOES: { id: string; rotulo: string; icone: Icon }[] = [
  { id: 'perfil', rotulo: 'Dados pessoais', icone: IconUser },
  { id: 'empresa', rotulo: 'Empresa', icone: IconBuilding },
  { id: 'notificacoes', rotulo: 'Notificações por e-mail', icone: IconMail },
  { id: 'aparencia', rotulo: 'Aparência', icone: IconPalette },
  { id: 'senha', rotulo: 'Alterar senha', icone: IconKey },
  { id: 'seguranca', rotulo: 'Verificação em duas etapas', icone: IconShieldCheck },
  { id: 'acessos', rotulo: 'Sessões e acesso', icone: IconDeviceDesktop },
  { id: 'meus-dados', rotulo: 'Meus dados', icone: IconFileText },
]

/**
 * Configurações do Painel do Cliente: a conta, a empresa, os avisos por
 * e-mail, o tema, a senha e a verificação em duas etapas — seis blocos numa página só, com um menu de
 * âncoras (lateral no desktop, em fita no celular). Cada bloco salva por
 * conta própria: mudar o tema não obriga a "salvar" a senha.
 */
export function PaginaConfiguracoes() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-titulo-lg font-forte tracking-display">Configurações</h1>
        <p className="mt-1 text-pequeno text-tinta-secundaria">Sua conta, sua empresa e como o suporte fala com você.</p>
      </header>

      <nav aria-label="Seções" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden">
        {SECOES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-total border border-divisoria bg-superficie px-3 py-1.5 text-pequeno font-medio text-tinta-secundaria hover:border-borda-controle hover:text-tinta"
          >
            <s.icone className="size-3.5" aria-hidden="true" />
            {s.rotulo}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Seções" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-1">
            {SECOES.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-pequeno font-medio text-tinta-secundaria hover:bg-navegacao hover:text-tinta"
                >
                  <s.icone className="size-4" aria-hidden="true" />
                  {s.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <SecaoPerfil />
          <SecaoEmpresa />
          <SecaoNotificacoes />
          <SecaoAparencia />
          <SecaoSenha />
          <SecaoSeguranca />
          <SecaoAcessos />
          <SecaoMeusDados />
        </div>
      </div>
    </div>
  )
}
