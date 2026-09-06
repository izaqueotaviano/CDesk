import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, aoDeslogar, api } from './client'

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let respostaPorUrl: (url: string) => Response

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(respostaPorUrl(String(url)))))
})
afterEach(() => vi.unstubAllGlobals())

describe('interceptor global de 401', () => {
  it('dispara para um 401 em qualquer chamada, exceto /auth/me/', async () => {
    respostaPorUrl = (url) => jsonDe({ detail: 'x' }, url.includes('/auth/me/') ? 401 : 401)
    const chamadas: string[] = []
    aoDeslogar(() => chamadas.push('disparou'))

    await api.get('/api/v1/tickets/1/').catch(() => {})
    expect(chamadas).toEqual(['disparou'])

    await api.get('/api/v1/auth/me/').catch(() => {})
    // RotaProtegida trata o 401 desta rota sozinha — o handler global não
    // dispara de novo, senão a pessoa vai pro /login errado (equipe vs portal)
    expect(chamadas).toEqual(['disparou'])
  })

  it('não dispara para um 403 (autenticado sem permissão)', async () => {
    respostaPorUrl = () => jsonDe({ detail: 'x' }, 403)
    const chamadas: string[] = []
    aoDeslogar(() => chamadas.push('disparou'))

    await api.get('/api/v1/settings/system/').catch(() => {})
    expect(chamadas).toEqual([])
  })
})

/** O corpo de erro é o que interessa aqui — a rota é só o gatilho. */
async function erroDe(corpo: unknown, status: number): Promise<ApiError> {
  respostaPorUrl = () => jsonDe(corpo, status)
  try {
    await api.post('/api/v1/tickets/')
  } catch (e) {
    return e as ApiError
  }
  throw new Error('esperava um ApiError')
}

describe('erro de campo — o DRF manda lista OU string, e a tela precisa dos dois', () => {
  it('erro de serializer continua chegando como lista, intacto', async () => {
    const erro = await erroDe({ email: ['Este campo é obrigatório.'], subject: ['Muito curto.'] }, 400)
    expect(erro.fieldErrors).toEqual({
      email: ['Este campo é obrigatório.'],
      subject: ['Muito curto.'],
    })
  })

  it('erro que a view mandou como string vira lista de um item, em vez de sumir', async () => {
    // apps/tickets/views.py: ValidationError({'files': str(exc)}) na recusa do
    // anexo e {'requester_id': 'Cliente não encontrado.'} na abertura
    const erro = await erroDe({ files: 'Arquivo acima de 10 MB: contrato.pdf.' }, 400)
    expect(erro.fieldErrors?.files).toEqual(['Arquivo acima de 10 MB: contrato.pdf.'])
  })

  it('mistura de string e lista no mesmo corpo sai toda normalizada', async () => {
    const erro = await erroDe({ requester_id: 'Cliente não encontrado.', subject: ['Obrigatório.'] }, 400)
    expect(erro.fieldErrors).toEqual({
      requester_id: ['Cliente não encontrado.'],
      subject: ['Obrigatório.'],
    })
  })

  it('`detail` sozinho continua sendo a mensagem geral e não vira erro de campo', async () => {
    const erro = await erroDe({ detail: 'Chamado encerrado não aceita resposta.' }, 400)
    expect(erro.message).toBe('Chamado encerrado não aceita resposta.')
    expect(erro.detail).toBe('Chamado encerrado não aceita resposta.')
    expect(erro.fieldErrors).toBeUndefined()
  })

  it('o 422 de cota não inventa erro nos campos `used`/`limit`/`renews_at`', async () => {
    const erro = await erroDe(
      {
        detail: 'Limite de tickets atingido: 50 de 50 neste período. Renova em 01/10/2026.',
        code: 'quota_exceeded',
        used: 50,
        limit: 50,
        renews_at: '2026-10-01T00:00:00Z',
      },
      422,
    )
    expect(erro.code).toBe('quota_exceeded')
    expect(erro.detail).toContain('Limite de tickets atingido')
    expect(erro.fieldErrors).toBeUndefined()
  })

  it('chave com lista sobrevive no envelope com `code` — `pendentesDoErro` lê daqui', async () => {
    // apps/chat/views.py: {detail, code, pending_ratings: [...]}
    const erro = await erroDe(
      { detail: 'Avalie o atendimento anterior.', code: 'pending_rating', pending_ratings: [{ id: 7 }] },
      400,
    )
    expect(erro.fieldErrors?.pending_ratings).toEqual([{ id: 7 }])
  })

  it('corpo em lista (`ValidationError("msg")` numa view) não vira "erro do campo 0"', async () => {
    const erro = await erroDe(['Algo deu errado.'], 400)
    expect(erro.fieldErrors).toBeUndefined()
  })
})
