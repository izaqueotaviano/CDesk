import { useRef, useState } from 'react'
import { Button, ConfirmDialog, IconButton, Modal, Popover } from '@/cvz/components'
import { useToast } from '@/cvz/components/Toast/Toast'
import { IconMore } from '@/cvz/components/icons'
import { ApiError } from '@/api/client'
import {
  useDesativarAgenteCfg,
  useEnviarAvatarAgente,
  useReenviarConviteAgente,
  useRemoverAvatarAgente,
  useResetar2faAgente,
  useResetarSenhaAgente,
  useRevogarTodasSessoesAgente,
  type AgenteCfg,
} from './dados'

// Espelha `avatars.py` (MAX_BYTES, e os três formatos que `guardar()`
// aceita) — validar aqui evita a viagem de rede só para o backend recusar
// um arquivo grande demais ou de um formato que ele nunca vai aceitar.
const LIMITE_AVATAR_MB = 2
const TIPOS_AVATAR_ACEITOS = 'image/png,image/jpeg,image/webp'

function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.detail ?? padrao) : padrao
}

function mensagemDeErroArquivo(e: unknown, padrao: string): string {
  return e instanceof ApiError ? (e.fieldErrors?.file?.[0] ?? e.detail ?? padrao) : padrao
}

type Confirmacao = 'senha' | '2fa' | 'sessoes' | 'desativar'

const TEXTOS: Record<Confirmacao, {
  titulo: (nome: string) => string
  descricao: string
  confirmar: string
  sucesso: string
  danger?: boolean
}> = {
  senha: {
    titulo: (nome) => `Redefinir a senha de ${nome}?`,
    descricao:
      'Uma senha temporária é sorteada agora e aparece só uma vez, nesta tela — repasse por telefone ou chat, nunca por e-mail.',
    confirmar: 'Redefinir senha',
    sucesso: 'Senha redefinida',
  },
  '2fa': {
    titulo: (nome) => `Resetar a verificação em duas etapas de ${nome}?`,
    descricao: 'A pessoa perde o método atual e configura de novo no próximo login. Um e-mail avisa que isso mudou.',
    confirmar: 'Resetar 2FA',
    sucesso: 'Verificação em duas etapas resetada',
  },
  sessoes: {
    titulo: (nome) => `Revogar todas as sessões de ${nome}?`,
    descricao: 'Encerra o acesso em todos os dispositivos agora — a pessoa precisa entrar de novo em cada um.',
    confirmar: 'Revogar sessões',
    sucesso: 'Sessões revogadas',
  },
  desativar: {
    titulo: (nome) => `Desativar ${nome}?`,
    descricao: 'A pessoa perde o acesso ao sistema agora. O histórico dela continua preservado.',
    confirmar: 'Desativar',
    sucesso: 'Agente desativado',
    danger: true,
  },
}

/**
 * Ações administrativas sobre UM agente — o menu que faltava desde que a
 * tela "Equipes e agentes" antiga se perdeu na reconstrução do front, e que
 * hoje só existiam no /admin/ cru do Django (sem as regras de negócio da
 * aplicação: e-mail de aviso, trilha de auditoria, senha sorteada).
 *
 * Toda ação de `TEXTOS` passa por confirmação de propósito — são ações que
 * afetam OUTRA pessoa sem pedir senha dela (o próprio acesso administrativo
 * já é a prova de identidade, ver `reset_password`/`reset_2fa` no backend),
 * então "cliquei sem querer" não pode custar uma sessão derrubada ou uma
 * senha trocada. "Reenviar convite" e "Ver histórico" ficam de fora: a
 * primeira só reenvia um e-mail, a segunda só lê. Trocar/remover foto e
 * editar equipes também ficam de fora da confirmação: são reversíveis (envia
 * de novo, marca de novo) e não mexem em credencial nem em sessão de
 * ninguém — o mesmo raciocínio, aplicado às duas ações que a rodada anterior
 * deixou de fora por não estarem na lista priorizada.
 */
export function AcoesAgenteCfg({
  agente,
  onVerHistorico,
  onEditarEquipes,
}: {
  agente: AgenteCfg
  onVerHistorico: (agente: AgenteCfg) => void
  onEditarEquipes: (agente: AgenteCfg) => void
}) {
  const { push } = useToast()
  const reenviarConvite = useReenviarConviteAgente(agente.id)
  const resetarSenha = useResetarSenhaAgente(agente.id)
  const resetar2fa = useResetar2faAgente(agente.id)
  const revogarTudo = useRevogarTodasSessoesAgente(agente.id)
  const desativar = useDesativarAgenteCfg(agente.id)
  const enviarAvatar = useEnviarAvatarAgente(agente.id)
  const removerAvatar = useRemoverAvatarAgente(agente.id)

  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null)
  // Só existe UMA vez — a resposta de `reset-password` — por isso é estado à
  // parte do resto do menu, nunca reconstruída a partir de outra coisa.
  const [senhaGerada, setSenhaGerada] = useState<string | null>(null)
  // O <input type="file"> fica FORA do painel do Popover de propósito: o
  // painel só existe no DOM enquanto `open` (ver Popover.tsx), então um
  // input plantado lá dentro sumiria antes do seletor nativo do sistema
  // operacional abrir — o clique em "Trocar foto" fecha o menu no mesmo
  // gesto que aciona o input.
  const arquivoAvatarRef = useRef<HTMLInputElement>(null)

  function enviarConvite() {
    reenviarConvite.mutate(undefined, {
      onSuccess: () => push({ tone: 'success', title: 'Convite reenviado', description: agente.email }),
      onError: (e) =>
        push({ tone: 'danger', title: 'Não foi possível reenviar o convite', description: mensagemDeErro(e, '') }),
    })
  }

  // Mesma validação client-side de `AbaTelaDeLogin` (imagem do painel de
  // login): confere tipo e tamanho antes de gastar uma viagem de rede com um
  // arquivo que `avatars.guardar` ia recusar de qualquer jeito.
  function escolherAvatar(arquivo: File | undefined) {
    if (!arquivo) return
    if (!arquivo.type.startsWith('image/')) {
      push({ tone: 'danger', title: 'Escolha uma imagem (PNG, JPEG ou WebP).' })
      return
    }
    if (arquivo.size > LIMITE_AVATAR_MB * 1024 * 1024) {
      push({ tone: 'danger', title: `A imagem precisa ter até ${LIMITE_AVATAR_MB} MB.` })
      return
    }
    enviarAvatar.mutate(arquivo, {
      onSuccess: () => push({ tone: 'success', title: 'Foto atualizada', description: agente.full_name }),
      onError: (e) =>
        push({ tone: 'danger', title: 'Não foi possível enviar a foto', description: mensagemDeErroArquivo(e, '') }),
    })
  }

  function removerFoto() {
    removerAvatar.mutate(undefined, {
      onSuccess: () => push({ tone: 'success', title: 'Foto removida', description: agente.full_name }),
      onError: (e) =>
        push({ tone: 'danger', title: 'Não foi possível remover a foto', description: mensagemDeErro(e, '') }),
    })
  }

  // O ConfirmDialog não fecha sozinho quando `onConfirm` lança — aqui a
  // exceção é sempre tratada (toast) e engolida, então a confirmação some da
  // tela tanto no sucesso quanto na falha; o toast é quem diferencia os dois.
  async function confirmar() {
    if (confirmando === 'senha') {
      try {
        const r = await resetarSenha.mutateAsync()
        setSenhaGerada(r.password)
      } catch (e) {
        push({ tone: 'danger', title: 'Não foi possível redefinir a senha', description: mensagemDeErro(e, '') })
      }
      return
    }
    if (confirmando === '2fa') {
      try {
        await resetar2fa.mutateAsync()
        push({ tone: 'success', title: TEXTOS['2fa'].sucesso })
      } catch (e) {
        push({ tone: 'danger', title: 'Não foi possível resetar o 2FA', description: mensagemDeErro(e, '') })
      }
      return
    }
    if (confirmando === 'sessoes') {
      try {
        await revogarTudo.mutateAsync()
        push({ tone: 'success', title: TEXTOS.sessoes.sucesso })
      } catch (e) {
        push({ tone: 'danger', title: 'Não foi possível revogar as sessões', description: mensagemDeErro(e, '') })
      }
      return
    }
    if (confirmando === 'desativar') {
      try {
        await desativar.mutateAsync()
        push({ tone: 'success', title: TEXTOS.desativar.sucesso })
      } catch (e) {
        push({ tone: 'danger', title: 'Não foi possível desativar', description: mensagemDeErro(e, '') })
      }
    }
  }

  async function copiarSenha() {
    if (!senhaGerada) return
    try {
      await navigator.clipboard.writeText(senhaGerada)
      push({ tone: 'success', title: 'Copiado' })
    } catch {
      push({ tone: 'danger', title: 'Não foi possível copiar' })
    }
  }

  // Espelha as mesmas duas pré-condições que o backend recusa com 400
  // ("entra pelo Google", "já está sem verificação em duas etapas") — melhor
  // esconder a ação do que deixar clicar e voltar com um erro previsível.
  const podeConvite = agente.invite_status !== ''
  const podeResetarSenha = agente.invite_status !== ''
  const podeResetar2fa = agente.two_factor_method !== ''

  return (
    <>
      <Popover
        align="end"
        trigger={(props) => (
          <IconButton Icon={IconMore} label={`Ações para ${agente.full_name}`} size="sm" bare {...props} />
        )}
      >
        {(fechar) => (
          <div className="cfg-roster__menu" role="menu" aria-label={`Ações para ${agente.full_name}`}>
            <button
              type="button"
              role="menuitem"
              className="cfg-roster__menu-item"
              onClick={() => {
                fechar()
                arquivoAvatarRef.current?.click()
              }}
            >
              Trocar foto
            </button>
            {agente.avatar_url && (
              <button
                type="button"
                role="menuitem"
                className="cfg-roster__menu-item"
                onClick={() => {
                  fechar()
                  removerFoto()
                }}
              >
                Remover foto
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="cfg-roster__menu-item"
              onClick={() => {
                fechar()
                onEditarEquipes(agente)
              }}
            >
              Editar equipes
            </button>
            {podeConvite && (
              <button
                type="button"
                role="menuitem"
                className="cfg-roster__menu-item"
                onClick={() => {
                  fechar()
                  enviarConvite()
                }}
              >
                Reenviar convite
              </button>
            )}
            {podeResetarSenha && (
              <button
                type="button"
                role="menuitem"
                className="cfg-roster__menu-item"
                onClick={() => {
                  fechar()
                  setConfirmando('senha')
                }}
              >
                Resetar senha
              </button>
            )}
            {podeResetar2fa && (
              <button
                type="button"
                role="menuitem"
                className="cfg-roster__menu-item"
                onClick={() => {
                  fechar()
                  setConfirmando('2fa')
                }}
              >
                Resetar verificação em duas etapas
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="cfg-roster__menu-item"
              onClick={() => {
                fechar()
                onVerHistorico(agente)
              }}
            >
              Ver histórico de acesso
            </button>
            <button
              type="button"
              role="menuitem"
              className="cfg-roster__menu-item"
              onClick={() => {
                fechar()
                setConfirmando('sessoes')
              }}
            >
              Revogar todas as sessões
            </button>
            {agente.is_active && (
              <button
                type="button"
                role="menuitem"
                className="cfg-roster__menu-item cfg-roster__menu-item--perigo"
                onClick={() => {
                  fechar()
                  setConfirmando('desativar')
                }}
              >
                Desativar
              </button>
            )}
          </div>
        )}
      </Popover>

      <input
        ref={arquivoAvatarRef}
        type="file"
        accept={TIPOS_AVATAR_ACEITOS}
        className="sr-only"
        aria-label={`Escolher foto de ${agente.full_name}`}
        onChange={(e) => {
          escolherAvatar(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <ConfirmDialog
        open={confirmando !== null}
        onClose={() => setConfirmando(null)}
        onConfirm={confirmar}
        title={confirmando ? TEXTOS[confirmando].titulo(agente.full_name) : ''}
        description={confirmando ? TEXTOS[confirmando].descricao : undefined}
        confirmLabel={confirmando ? TEXTOS[confirmando].confirmar : undefined}
        danger={confirmando ? TEXTOS[confirmando].danger : undefined}
      />

      <Modal
        open={senhaGerada !== null}
        onClose={() => setSenhaGerada(null)}
        title="Nova senha gerada"
        size="sm"
        footer={
          <Button onClick={() => setSenhaGerada(null)}>Fechar</Button>
        }
      >
        <p>Repasse esta senha para {agente.full_name} agora — ela não vai aparecer de novo.</p>
        <div className="cfg-roster__segredo">
          <code>{senhaGerada}</code>
          <Button size="sm" variant="secondary" onClick={copiarSenha}>
            Copiar
          </Button>
        </div>
      </Modal>
    </>
  )
}
