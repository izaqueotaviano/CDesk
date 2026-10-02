import { beforeEach, describe, expect, it } from 'vitest'
import { useChatUi } from './chatUi'

beforeEach(() => useChatUi.setState({ abertos: [], filaAberta: false, rascunhos: {} }))

describe('chatUi — painéis abertos do mini chat', () => {
  it('abre até o limite; acima dele o mais antigo sai pra dar lugar ao novo', () => {
    const { abrir } = useChatUi.getState()
    abrir(1, 2)
    abrir(2, 2)
    abrir(3, 2)
    expect(useChatUi.getState().abertos).toEqual([2, 3])
  })

  it('abrir de novo o mesmo chat não duplica', () => {
    const { abrir } = useChatUi.getState()
    abrir(1, 3)
    abrir(1, 3)
    expect(useChatUi.getState().abertos).toEqual([1])
  })

  it('alternar abre e fecha', () => {
    const { alternar } = useChatUi.getState()
    alternar(7, 3)
    expect(useChatUi.getState().abertos).toEqual([7])
    alternar(7, 3)
    expect(useChatUi.getState().abertos).toEqual([])
  })

  it('limite zero ou inválido ainda deixa um painel aberto', () => {
    useChatUi.getState().abrir(4, 0)
    expect(useChatUi.getState().abertos).toEqual([4])
  })
})

describe('chatUi — balão da fila', () => {
  it('alterna e fecha', () => {
    useChatUi.getState().alternarFila()
    expect(useChatUi.getState().filaAberta).toBe(true)
    useChatUi.getState().fecharFila()
    expect(useChatUi.getState().filaAberta).toBe(false)
  })
})

describe('chatUi — rascunho por conversa (o mesmo no console e no mini chat)', () => {
  it('guarda por id de chat e devolve pra quem perguntar', () => {
    useChatUi.getState().definirRascunho(5, 'oi, já estou vendo')
    expect(useChatUi.getState().rascunhos[5]).toBe('oi, já estou vendo')
    expect(useChatUi.getState().rascunhos[6]).toBeUndefined()
  })

  it('texto vazio apaga a entrada em vez de guardar string vazia', () => {
    useChatUi.getState().definirRascunho(5, 'x')
    useChatUi.getState().definirRascunho(5, '')
    expect(5 in useChatUi.getState().rascunhos).toBe(false)
  })

  it('limpar some com o rascunho (enviar a mensagem)', () => {
    useChatUi.getState().definirRascunho(5, 'x')
    useChatUi.getState().limparRascunho(5)
    expect(useChatUi.getState().rascunhos).toEqual({})
  })

  it('definir o mesmo texto não cria estado novo (sem re-render à toa)', () => {
    useChatUi.getState().definirRascunho(5, 'x')
    const antes = useChatUi.getState()
    useChatUi.getState().definirRascunho(5, 'x')
    expect(useChatUi.getState()).toBe(antes)
  })
})

describe('chatUi — o que sobrevive a um F5 e o que o logout apaga', () => {
  it('abertos e rascunhos vão pro localStorage; a fila (popover) não', () => {
    const { abrir, definirRascunho, alternarFila } = useChatUi.getState()
    abrir(1, 3)
    definirRascunho(1, 'oi')
    alternarFila()
    const salvo = JSON.parse(localStorage.getItem('resolv:chat-ui') ?? '{}') as { state: Record<string, unknown> }
    expect(salvo.state.abertos).toEqual([1])
    expect(salvo.state.rascunhos).toEqual({ 1: 'oi' })
    expect(salvo.state).not.toHaveProperty('filaAberta')
  })

  it('podar tira painéis e rascunhos de atendimentos que não são mais meus', () => {
    useChatUi.setState({ abertos: [1, 2, 3], rascunhos: { 1: 'a', 3: 'c', 9: 'z' } })
    useChatUi.getState().podar([2, 3])
    expect(useChatUi.getState().abertos).toEqual([2, 3])
    expect(useChatUi.getState().rascunhos).toEqual({ 3: 'c' })
  })

  it('podar sem nada a tirar devolve o mesmo estado (não dispara render)', () => {
    useChatUi.setState({ abertos: [1], rascunhos: { 1: 'a' } })
    const antes = useChatUi.getState()
    useChatUi.getState().podar([1, 2])
    expect(useChatUi.getState()).toBe(antes)
  })

  it('limparTudo zera painéis, fila e rascunhos', () => {
    useChatUi.setState({ abertos: [1], filaAberta: true, rascunhos: { 1: 'a' } })
    useChatUi.getState().limparTudo()
    expect(useChatUi.getState()).toMatchObject({ abertos: [], filaAberta: false, rascunhos: {} })
  })
})
