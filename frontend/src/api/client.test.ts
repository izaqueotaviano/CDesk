import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aoDeslogar, api } from './client'

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
