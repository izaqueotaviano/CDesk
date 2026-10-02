import { useId, useState } from 'react'
import { IconBell } from '@tabler/icons-react'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { usePreferenciasNotificacao } from '@/portal/api/conta'
import { LinhaDeAjuste } from '@/portal/configuracoes/Ajustes'
import { Secao } from '@/portal/configuracoes/Secao'
import { Alert } from '@/portal/ui/alert'
import { Button } from '@/portal/ui/button'
import { Skeleton } from '@/portal/ui/skeleton'
import { Switch } from '@/portal/ui/switch'
import { toast } from '@/portal/ui/toaster'
import {
  desligarAvisosDoSistema,
  estadoDosAvisos,
  ligarAvisosDoSistema,
  type EstadoAviso,
} from '@/realtime/avisos'
import { usePrefs } from '@/stores/prefs'
import { GRUPOS_DE_AVISOS, useSalvarPreferenciaDeAviso, type Canal } from './avisosDoAgente'

/** A mesma chave do cabeçalho do sino: uma preferência só (stores/prefs). */
function ChaveSom() {
  const id = useId()
  const ligado = usePrefs((s) => s.somNotificacoes)
  const setSom = usePrefs((s) => s.setSomNotificacoes)
  return (
    <LinhaDeAjuste
      id={id}
      titulo="Som das notificações"
      descricao="Um bipe curto quando chega algo com o Resolv em segundo plano. Desligado, o aviso continua no título da aba."
    >
      <Switch checked={ligado} onCheckedChange={setSom} aria-labelledby={id} />
    </LinhaDeAjuste>
  )
}

/**
 * O aviso do sistema operacional é do APARELHO (a permissão é do
 * navegador), por isso diz "neste computador" — ao contrário do resto da
 * seção, que vale para a conta. Mesma regra do rodapé do sino: a permissão
 * só é pedida no clique.
 */
function ChaveComputador() {
  const id = useId()
  const [estado, setEstado] = useState<EstadoAviso>(estadoDosAvisos)
  if (estado === 'indisponivel') return null

  return (
    <LinhaDeAjuste
      id={id}
      titulo="Avisar neste computador"
      descricao={
        estado === 'bloqueado'
          ? 'Bloqueado por este navegador. Para receber, libere as notificações deste site nas configurações dele.'
          : 'Aviso do sistema, por cima de outros programas. Vale só para este navegador.'
      }
    >
      {estado !== 'bloqueado' && (
        <Switch
          checked={estado === 'ligado'}
          aria-labelledby={id}
          onCheckedChange={async (ligar) => {
            if (ligar) setEstado(await ligarAvisosDoSistema())
            else {
              desligarAvisosDoSistema()
              setEstado(estadoDosAvisos())
            }
          }}
        />
      )}
    </LinhaDeAjuste>
  )
}

const NOME_DO_CANAL: Record<Canal, string> = { in_app: 'no Resolv', email: 'por e-mail' }

function TabelaDeAvisos() {
  const { data: me } = useMe()
  const prefs = usePreferenciasNotificacao()
  const salvar = useSalvarPreferenciaDeAviso()

  if (prefs.isError) {
    return (
      <Alert
        variant="destructive"
        titulo="Não foi possível carregar suas preferências"
        acao={
          <Button size="sm" variant="secondary" onClick={() => prefs.refetch()}>
            Tentar de novo
          </Button>
        }
      >
        {prefs.error instanceof ApiError ? `Erro ${prefs.error.status}.` : 'Verifique sua conexão.'}
      </Alert>
    )
  }

  function mudar(canal: Canal, kind: string, ligado: boolean) {
    salvar.mutate(
      { canal, kind, ligado },
      {
        onError: (e) =>
          toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível salvar.') : 'Não foi possível salvar.'),
      },
    )
  }

  function chave(canal: Canal, kind: string, rotulo: string) {
    if (prefs.isLoading) return <Skeleton className="mx-auto h-6 w-11 rounded-total" />
    return (
      <Switch
        // padrão ligado: é o que o servidor aplica para quem nunca mexeu
        checked={prefs.data?.[canal][kind] ?? true}
        onCheckedChange={(v) => mudar(canal, kind, v)}
        aria-label={`${rotulo} ${NOME_DO_CANAL[canal]}`}
      />
    )
  }

  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Avisos por tipo, no Resolv e por e-mail</caption>
      <thead>
        <tr className="border-b border-divisoria">
          <th scope="col" className="pb-2 text-pequeno font-medio text-tinta-secundaria">
            Aviso
          </th>
          <th scope="col" className="w-16 pb-2 text-center text-pequeno font-medio text-tinta-secundaria md:w-24">
            No Resolv
          </th>
          <th scope="col" className="w-16 pb-2 text-center text-pequeno font-medio text-tinta-secundaria md:w-24">
            E-mail
          </th>
        </tr>
      </thead>
      {GRUPOS_DE_AVISOS.map((grupo) => {
        const avisos = grupo.avisos.filter((a) => !a.soAdmin || me?.is_admin)
        return (
          <tbody key={grupo.titulo}>
            <tr>
              <th
                scope="colgroup"
                colSpan={3}
                className="pb-1 pt-5 text-pequeno font-medio text-tinta-terciaria"
              >
                {grupo.titulo}
              </th>
            </tr>
            {avisos.map((aviso) => (
              <tr key={aviso.kind} className="border-b border-divisoria last:border-b-0">
                <th scope="row" className="py-3 pr-3 align-middle font-normal">
                  <span className="block text-corpo text-tinta">{aviso.rotulo}</span>
                  <span className="block text-pequeno text-tinta-secundaria">{aviso.descricao}</span>
                </th>
                <td className="py-3 text-center align-middle">{chave('in_app', aviso.kind, aviso.rotulo)}</td>
                <td className="py-3 text-center align-middle">
                  {aviso.email ? (
                    chave('email', aviso.kind, aviso.rotulo)
                  ) : (
                    <span className="text-pequeno text-tinta-terciaria" title="Este aviso não vai por e-mail">
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">Este aviso não vai por e-mail</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        )
      })}
    </table>
  )
}

/**
 * Minha conta → Notificações: o que avisa, e por onde. O portal já tinha
 * esta tela (só e-mail, só os tipos de cliente); aqui entram os tipos de
 * quem atende e os dois canais, com a mesma API
 * (`/notification-preferences/`, que o serviço consulta de verdade antes de
 * avisar). Tudo salva no toque.
 */
export function SecaoNotificacoes() {
  return (
    <Secao
      id="notificacoes"
      icone={IconBell}
      titulo="Notificações"
      descricao="O que chega no sino e por e-mail. Cada escolha salva na hora."
      rodape={
        <span className="text-legenda text-tinta-terciaria">
          Códigos de acesso e avisos de segurança chegam sempre.
        </span>
      }
    >
      <div className="flex flex-col divide-y divide-divisoria">
        <ChaveSom />
        <ChaveComputador />
      </div>
      <TabelaDeAvisos />
    </Secao>
  )
}
