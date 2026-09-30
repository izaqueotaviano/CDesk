import { IconBuilding, IconDeviceDesktop, IconFileText, IconKey, IconMail, IconPalette, IconShieldCheck, IconTextSize, IconUser, IconUsers, type Icon } from '@tabler/icons-react'
import { useMe } from '@/api/queries/useMe'
import { SecaoAcessos } from './SecaoAcessos'
import { SecaoAparencia } from './SecaoAparencia'
import { SecaoEmpresa } from './SecaoEmpresa'
import { SecaoMeusDados } from './SecaoMeusDados'
import { SecaoNotificacoes } from './SecaoNotificacoes'
import { SecaoPerfil } from './SecaoPerfil'
import { PERMISSAO_PESSOAS, SecaoPessoasEmpresa } from './SecaoPessoasEmpresa'
import { SecaoSeguranca } from './SecaoSeguranca'
import { SecaoSenha } from './SecaoSenha'
import { SecaoTamanhoTexto } from './SecaoTamanhoTexto'

/** `permissao`: a seção só aparece (no menu e na página) para quem a tem. */
const SECOES: { id: string; rotulo: string; icone: Icon; permissao?: string }[] = [
  { id: 'perfil', rotulo: 'Dados pessoais', icone: IconUser },
  { id: 'empresa', rotulo: 'Empresa', icone: IconBuilding },
  { id: 'pessoas', rotulo: 'Pessoas da empresa', icone: IconUsers, permissao: PERMISSAO_PESSOAS },
  { id: 'notificacoes', rotulo: 'Notificações por e-mail', icone: IconMail },
  { id: 'aparencia', rotulo: 'Aparência', icone: IconPalette },
  { id: 'texto', rotulo: 'Tamanho do texto', icone: IconTextSize },
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
  const { data: me } = useMe()
  const secoes = SECOES.filter((s) => !s.permissao || me?.permissions.includes(s.permissao))
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-titulo-lg font-forte tracking-display">Configurações</h1>
        <p className="mt-1 text-pequeno text-tinta-secundaria">Sua conta, sua empresa e como o suporte fala com você.</p>
      </header>

      <nav aria-label="Seções" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden">
        {secoes.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-total  bg-superficie px-3 py-1.5 text-pequeno font-medio text-tinta-secundaria hover:border-borda-controle hover:text-tinta"
          >
            <s.icone className="size-3.5" aria-hidden="true" />
            {s.rotulo}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Seções" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-1">
            {secoes.map((s) => (
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
          <SecaoPessoasEmpresa />
          <SecaoNotificacoes />
          <SecaoAparencia />
          <SecaoTamanhoTexto />
          <SecaoSenha />
          <SecaoSeguranca />
          <SecaoAcessos />
          <SecaoMeusDados />
        </div>
      </div>
    </div>
  )
}
