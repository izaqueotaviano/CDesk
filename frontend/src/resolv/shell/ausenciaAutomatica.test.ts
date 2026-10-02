import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Presence } from '@/api/types'
import {
  esquecerAusenciaAutomatica,
  iniciarVigiaDeAusencia,
  type CanalDeAtividade,
} from './ausenciaAutomatica'

/**
 * Relógio falso do começo ao fim: o que se testa aqui é "15 minutos parado",
 * e ninguém espera 15 minutos. O servidor é uma variável (`presenca`) — é ela
 * que a regra "só sai de Disponível" consulta.
 */

const MIN = 60_000
let presenca: Presence
let lerPresenca: ReturnType<typeof vi.fn<() => Promise<Presence>>>
let mudarPresenca: ReturnType<typeof vi.fn<(p: Presence) => Promise<void>>>
let desligar: (() => void)[]

/** Várias "abas" num teste só: cada uma recebe o que as OUTRAS enviam. */
function barramento() {
  const ouvintes = new Map<number, (em: number) => void>()
  let proximo = 0
  return (): CanalDeAtividade => {
    const eu = proximo++
    return {
      enviar: (em) => ouvintes.forEach((fn, quem) => quem !== eu && fn(em)),
      ouvir: (fn) => {
        ouvintes.set(eu, fn)
        return () => ouvintes.delete(eu)
      },
    }
  }
}

function novaAba(): Document {
  return document.implementation.createHTMLDocument('aba')
}

function ligar(minutos: number, extra: { alvo?: Document; canal?: CanalDeAtividade } = {}) {
  const parar = iniciarVigiaDeAusencia({
    minutos,
    lerPresenca,
    mudarPresenca,
    canal: extra.canal ?? barramento()(),
    alvo: extra.alvo ?? novaAba(),
  })
  desligar.push(parar)
  return parar
}

function mexer(alvo: Document, tipo = 'pointerdown') {
  alvo.dispatchEvent(new Event(tipo))
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  presenca = 'available'
  lerPresenca = vi.fn(async () => presenca)
  mudarPresenca = vi.fn(async (p: Presence) => {
    presenca = p
  })
  desligar = []
})

afterEach(() => {
  desligar.forEach((parar) => parar())
  vi.useRealTimers()
})

describe('ausência automática', () => {
  it('Disponível parado pelo tempo escolhido vira Ausente, e só então', async () => {
    ligar(15)

    await vi.advanceTimersByTimeAsync(14 * MIN)
    expect(mudarPresenca).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1 * MIN + 15_000)
    expect(mudarPresenca).toHaveBeenCalledTimes(1)
    expect(mudarPresenca).toHaveBeenCalledWith('away')
    expect(presenca).toBe('away')
  })

  it('qualquer atividade zera o relógio', async () => {
    const aba = novaAba()
    ligar(5, { alvo: aba })

    await vi.advanceTimersByTimeAsync(4 * MIN)
    mexer(aba, 'keydown')
    await vi.advanceTimersByTimeAsync(4 * MIN)
    mexer(aba, 'wheel')
    await vi.advanceTimersByTimeAsync(4 * MIN)
    expect(mudarPresenca).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(mudarPresenca).toHaveBeenCalledWith('away')
  })

  it.each(['away', 'offline'] as const)('nunca passa por cima de um %s escolhido à mão', async (escolhido) => {
    presenca = escolhido
    ligar(5)
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(mudarPresenca).not.toHaveBeenCalled()
  })

  it('lê o status FRESCO: Offline escolhido em outra aba vale, mesmo com cache velho', async () => {
    ligar(5)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    presenca = 'offline' // mudou por outro caminho; o vigia não foi avisado
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(lerPresenca).toHaveBeenCalled()
    expect(mudarPresenca).not.toHaveBeenCalled()
  })

  it('volta para Disponível na próxima atividade quando foi ELE que mudou', async () => {
    const aba = novaAba()
    ligar(5, { alvo: aba })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    expect(presenca).toBe('away')

    mexer(aba, 'pointermove')
    await vi.advanceTimersByTimeAsync(0)
    expect(mudarPresenca).toHaveBeenLastCalledWith('available')
    expect(presenca).toBe('available')
  })

  it('Ausente escolhido à mão não volta sozinho quando a pessoa mexe', async () => {
    presenca = 'away'
    const aba = novaAba()
    ligar(5, { alvo: aba })
    mexer(aba)
    await vi.advanceTimersByTimeAsync(2_000)
    mexer(aba)
    await vi.advanceTimersByTimeAsync(0)
    expect(mudarPresenca).not.toHaveBeenCalled()
  })

  it('escolher um status no menu apaga a marca: depois disso a atividade não mexe em nada', async () => {
    const aba = novaAba()
    ligar(5, { alvo: aba })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    expect(presenca).toBe('away')

    // a pessoa abriu o menu e confirmou "Ausente" (MenuPresenca faz isto)
    esquecerAusenciaAutomatica()
    mexer(aba)
    await vi.advanceTimersByTimeAsync(0)
    expect(mudarPresenca).toHaveBeenCalledTimes(1) // só o 'away' automático
  })

  it('não "volta" quem entretanto virou Offline (logout em outra aba)', async () => {
    const aba = novaAba()
    ligar(5, { alvo: aba })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    presenca = 'offline'

    mexer(aba)
    await vi.advanceTimersByTimeAsync(0)
    expect(mudarPresenca).not.toHaveBeenCalledWith('available')
    expect(presenca).toBe('offline')
  })

  it('"Nunca" não marca ausência nenhuma', async () => {
    ligar(0)
    await vi.advanceTimersByTimeAsync(8 * 60 * MIN)
    expect(mudarPresenca).not.toHaveBeenCalled()
  })

  it('voltar para a aba conta como atividade', async () => {
    const aba = novaAba()
    ligar(5, { alvo: aba })
    await vi.advanceTimersByTimeAsync(4 * MIN)
    Object.defineProperty(aba, 'visibilityState', { value: 'visible', configurable: true })
    aba.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(4 * MIN)
    expect(mudarPresenca).not.toHaveBeenCalled()
  })

  it('se o servidor recusar a troca, não fica marca, e a próxima checagem tenta de novo', async () => {
    mudarPresenca.mockRejectedValueOnce(new Error('500'))
    const aba = novaAba()
    ligar(5, { alvo: aba })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(mudarPresenca).toHaveBeenCalledTimes(1)
    expect(presenca).toBe('available')
    // sem marca: a próxima atividade não "desfaria" um Ausente que não houve
    expect(localStorage.getItem('resolv:ausente-automatico')).toBeNull()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(mudarPresenca).toHaveBeenCalledTimes(2)
    expect(presenca).toBe('away')
  })
})

describe('várias abas', () => {
  it('uma aba ativa segura as outras: a esquecida em segundo plano não marca Ausente', async () => {
    const bus = barramento()
    const esquecida = novaAba()
    const ativa = novaAba()
    ligar(15, { alvo: esquecida, canal: bus() })
    ligar(15, { alvo: ativa, canal: bus() })

    // a pessoa trabalha na outra aba de 10 em 10 minutos
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10 * MIN)
      mexer(ativa)
    }
    expect(mudarPresenca).not.toHaveBeenCalled()

    // parou de vez: as duas chegam ao limite juntas, e o status muda UMA vez
    await vi.advanceTimersByTimeAsync(16 * MIN)
    expect(mudarPresenca).toHaveBeenCalledTimes(1)
    expect(presenca).toBe('away')
  })

  it('a volta acontece na aba onde a pessoa mexeu, mesmo que outra tenha marcado', async () => {
    const bus = barramento()
    const a = novaAba()
    const b = novaAba()
    ligar(5, { alvo: a, canal: bus() })
    ligar(5, { alvo: b, canal: bus() })
    await vi.advanceTimersByTimeAsync(6 * MIN)
    expect(presenca).toBe('away')

    mexer(b)
    await vi.advanceTimersByTimeAsync(0)
    expect(presenca).toBe('available')
    // e a outra aba, que recebeu o aviso de atividade, não volta de novo
    expect(mudarPresenca.mock.calls.filter(([p]) => p === 'available')).toHaveLength(1)
  })
})
