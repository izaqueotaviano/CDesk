import { useId } from 'react'
import { Mail } from 'lucide-react'
import { ApiError } from '@/api/client'
import { AVISOS_EMAIL_CLIENTE, usePreferenciasNotificacao, useSalvarPreferenciaEmail } from '../api/conta'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { toast } from '../ui/toaster'
import { Secao } from './Secao'

/**
 * Avisos por e-mail, um interruptor por acontecimento. Cada toque salva na
 * hora (otimista — volta se o servidor recusar): a pessoa não precisa
 * lembrar de "salvar" uma preferência. Só os tipos que chegam a um cliente
 * aparecem; e-mails operacionais (código de acesso) não passam por aqui.
 */
export function SecaoNotificacoes() {
  const prefs = usePreferenciasNotificacao()
  const salvar = useSalvarPreferenciaEmail()
  const idBase = useId()
  const descricao = 'O que você quer receber por e-mail. Dentro do portal, tudo continua aparecendo.'

  return (
    <Secao
      id="notificacoes"
      icone={Mail}
      titulo="Notificações por e-mail"
      descricao={descricao}
      rodape={<span className="text-legenda text-tinta-terciaria">Códigos de acesso e avisos de segurança não dependem destas opções.</span>}
    >
      {prefs.isError ? (
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
      ) : (
        <ul className="flex flex-col divide-y divide-divisoria">
          {AVISOS_EMAIL_CLIENTE.map((aviso, i) => {
            const id = `${idBase}-${aviso.kind}`
            const ligado = prefs.data?.email[aviso.kind] ?? true
            return (
              <li key={aviso.kind} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <label htmlFor={id} className="block text-pequeno font-medio text-tinta">
                    {aviso.rotulo}
                  </label>
                  <p id={`${id}-desc`} className="text-legenda text-tinta-secundaria">
                    {aviso.descricao}
                  </p>
                </div>
                {prefs.isLoading ? (
                  <Skeleton className="h-6 w-11 rounded-total" style={{ animationDelay: `${i * 60}ms` }} />
                ) : (
                  <Switch
                    id={id}
                    checked={ligado}
                    aria-describedby={`${id}-desc`}
                    onCheckedChange={(v) =>
                      salvar.mutate(
                        { kind: aviso.kind, ligado: v },
                        {
                          onError: (e) =>
                            toast.error(e instanceof ApiError ? (e.detail ?? 'Não foi possível salvar a preferência.') : 'Não foi possível salvar a preferência.'),
                        },
                      )
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Secao>
  )
}
