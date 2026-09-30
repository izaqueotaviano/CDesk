import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O módulo é singleton (assina o canal pessoal uma vez só, como a bridge), e
 * guarda estado entre chamadas — daí `resetModules` + import dinâmico a cada
 * teste, em vez de um import no topo do arquivo.
 */
let ouvinte: ((evento: Record<string, unknown>) => void) | null = null

vi.mock('./bridge', () => ({
  assinarEventoPessoal: (fn: (evento: Record<string, unknown>) => void) => {
    ouvinte = fn
    return () => {}
  },
}))

/** Registra os bipes sem precisar de áudio de verdade (jsdom não tem). */
let hertzTocados: number[]
function stubarAudio() {
  hertzTocados = []
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 0
      createOscillator() {
        const osc = { type: '', frequency: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} }
        // a frequência é lida no fim, quando o módulo já atribuiu
        queueMicrotask(() => hertzTocados.push(osc.frequency.value))
        return osc
      }
      createGain() {
        return { gain: { value: 0 }, connect: () => {} }
      }
      resume() {
        return Promise.resolve()
      }
      destination = {}
    },
  )
}

/** Avisos do SO criados, na ordem. */
let avisosCriados: { titulo: string; corpo?: string; tag?: string; instancia: Record<string, unknown> }[]
function stubarNotification(permissao: NotificationPermission) {
  avisosCriados = []
  const Fake = function (this: Record<string, unknown>, titulo: string, opcoes?: NotificationOptions) {
    this.close = () => {}
    this.onclick = null
    avisosCriados.push({ titulo, corpo: opcoes?.body, tag: opcoes?.tag, instancia: this })
  } as unknown as typeof Notification
  Object.defineProperty(Fake, 'permission', { value: permissao, configurable: true })
  Object.defineProperty(Fake, 'requestPermission', {
    value: vi.fn(async () => permissao),
    configurable: true,
  })
  vi.stubGlobal('Notification', Fake)
}

function abaEmSegundoPlano(sim: boolean) {
  Object.defineProperty(document, 'hidden', { value: sim, configurable: true })
  document.hasFocus = () => !sim
}

async function carregarModulo() {
  vi.resetModules()
  ouvinte = null
  const modulo = await import('./avisos')
  modulo.iniciarAvisos()
  return modulo
}

/** Deixa o microtask do stub de áudio rodar antes de conferir os bipes. */
const cederAoLoop = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  document.title = 'Resolv'
  stubarAudio()
  stubarNotification('granted')
  abaEmSegundoPlano(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Avisos de segundo plano', () => {
  it('não avisa quem está olhando a tela', async () => {
    abaEmSegundoPlano(false)
    await carregarModulo()

    ouvinte!({ type: 'chat_queued', client_name: 'Ana', company: 'Acme' })
    await cederAoLoop()

    expect(hertzTocados).toHaveLength(0)
    expect(avisosCriados).toHaveLength(0)
    expect(document.title).toBe('Resolv')
  })

  it('chat novo na fila: dois bipes, marca no título e aviso no sistema', async () => {
    await carregarModulo()

    ouvinte!({ type: 'chat_queued', client_name: 'Ana Almeida', company: 'Acme' })
    await cederAoLoop()

    expect(hertzTocados).toHaveLength(2) // é o único com alguém esperando ao vivo
    expect(document.title).toBe('● Resolv')
    expect(avisosCriados[0]).toMatchObject({ titulo: 'Novo chat na fila', corpo: 'Ana Almeida · Acme' })
  })

  it('chamado novo TAMBÉM avisa — antes só chat avisava', async () => {
    await carregarModulo()

    ouvinte!({
      type: 'notification',
      kind: 'ticket_created',
      title: 'Novo chamado TCK-0012',
      body: 'Acme · Impressora não imprime',
      url: '/tickets/12',
    })
    await cederAoLoop()

    expect(hertzTocados).toHaveLength(1)
    expect(avisosCriados[0]).toMatchObject({ titulo: 'Novo chamado TCK-0012' })
  })

  it('usa timbres diferentes para conversa e chamado, pra dar pra distinguir sem olhar', async () => {
    await carregarModulo()

    ouvinte!({ type: 'notification', kind: 'chat_message', title: 'Mensagem' })
    await cederAoLoop()
    const doChat = hertzTocados[0]

    ouvinte!({ type: 'notification', kind: 'ticket_created', title: 'Chamado' })
    await cederAoLoop()
    const doChamado = hertzTocados[1]

    expect(doChat).not.toBe(doChamado)
  })

  it('não interrompe com o que ninguém está esperando (SLA, avisos, encerramentos)', async () => {
    await carregarModulo()

    for (const kind of ['sla_breached', 'sla_warning', 'announcement', 'ticket_closed', 'kanban_due']) {
      ouvinte!({ type: 'notification', kind, title: kind })
    }
    await cederAoLoop()

    expect(hertzTocados).toHaveLength(0)
    expect(avisosCriados).toHaveLength(0)
    expect(document.title).toBe('Resolv') // nem a marca discreta do título
  })

  it('devolve o título ao normal quando a pessoa volta pra aba', async () => {
    await carregarModulo()

    ouvinte!({ type: 'notification', kind: 'mention', title: 'Te citaram' })
    expect(document.title).toBe('● Resolv')

    abaEmSegundoPlano(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('Resolv')
  })

  it('agrupa por conversa: cinco mensagens do mesmo chat são um aviso, não cinco', async () => {
    await carregarModulo()

    ouvinte!({ type: 'notification', kind: 'chat_message', title: 'Ana', chat_id: 7 })
    ouvinte!({ type: 'notification', kind: 'chat_message', title: 'Ana', chat_id: 7 })
    await cederAoLoop()

    // o navegador substitui pela `tag`; o que garantimos aqui é que a tag é a
    // mesma nos dois, não que o navegador substituiu
    expect(avisosCriados.map((a) => a.tag)).toEqual(['chat-7', 'chat-7'])
  })

  it('clicar no aviso navega pelo router, sem recarregar a página', async () => {
    const modulo = await carregarModulo()
    const navegou: string[] = []
    modulo.definirNavegacao((url) => navegou.push(url))

    ouvinte!({ type: 'notification', kind: 'ticket_assigned', title: 'Te atribuíram', url: '/tickets/12' })
    await cederAoLoop()

    const aviso = avisosCriados[0].instancia as { onclick: () => void }
    window.focus = () => {}
    aviso.onclick()

    expect(navegou).toEqual(['/tickets/12'])
  })
})

describe('Som das notificações', () => {
  /** O store é reimportado junto com o módulo (resetModules): precisa ser
   *  a MESMA instância que o avisos.ts lê. */
  async function prefs() {
    return (await import('@/stores/prefs')).usePrefs
  }

  it('desligado cala só o bipe: a marca no título e o aviso do sistema continuam', async () => {
    await carregarModulo()
    ;(await prefs()).getState().setSomNotificacoes(false)

    ouvinte!({ type: 'chat_queued', client_name: 'Ana', company: 'Acme' })
    await cederAoLoop()

    expect(hertzTocados).toHaveLength(0)
    expect(document.title).toBe('● Resolv')
    expect(avisosCriados).toHaveLength(1)
  })

  it('vale já no próximo aviso, sem recarregar a página, nos dois sentidos', async () => {
    await carregarModulo()
    const usePrefs = await prefs()

    usePrefs.getState().setSomNotificacoes(false)
    ouvinte!({ type: 'notification', kind: 'mention', title: 'Te citaram' })
    await cederAoLoop()
    expect(hertzTocados).toHaveLength(0)

    usePrefs.getState().setSomNotificacoes(true)
    ouvinte!({ type: 'notification', kind: 'mention', title: 'Te citaram de novo' })
    await cederAoLoop()
    expect(hertzTocados).toHaveLength(1)
  })

  it('a escolha salva no aparelho é respeitada desde a primeira carga', async () => {
    localStorage.setItem(
      'resolv:prefs',
      JSON.stringify({ state: { somNotificacoes: false }, version: 1 }),
    )
    await carregarModulo()

    ouvinte!({ type: 'notification', kind: 'ticket_created', title: 'Novo chamado' })
    await cederAoLoop()
    expect(hertzTocados).toHaveLength(0)
  })
})

describe('Permissão do aviso do sistema', () => {
  it('sem permissão concedida, o som e o título ainda avisam — só o SO não', async () => {
    stubarNotification('default')
    await carregarModulo()

    ouvinte!({ type: 'notification', kind: 'ticket_created', title: 'Novo chamado' })
    await cederAoLoop()

    expect(hertzTocados).toHaveLength(1)
    expect(document.title).toBe('● Resolv')
    expect(avisosCriados).toHaveLength(0)
  })

  it('estado é "desligado" antes de pedir e "ligado" depois de conceder', async () => {
    stubarNotification('default')
    const modulo = await carregarModulo()
    expect(modulo.estadoDosAvisos()).toBe('desligado')

    stubarNotification('granted')
    expect(await modulo.ligarAvisosDoSistema()).toBe('ligado')
    expect(modulo.estadoDosAvisos()).toBe('ligado')
  })

  it('desligar aqui não devolve a permissão do navegador, mas cala o aviso', async () => {
    const modulo = await carregarModulo()
    expect(modulo.estadoDosAvisos()).toBe('ligado') // permissão já concedida

    modulo.desligarAvisosDoSistema()
    expect(modulo.estadoDosAvisos()).toBe('desligado')

    ouvinte!({ type: 'notification', kind: 'ticket_created', title: 'Novo chamado' })
    await cederAoLoop()
    expect(avisosCriados).toHaveLength(0)
    expect(hertzTocados).toHaveLength(1) // som continua: é outra entrega
  })

  it('negado no navegador é um estado próprio — não some nem finge que dá pra ligar', async () => {
    stubarNotification('denied')
    const modulo = await carregarModulo()

    expect(modulo.estadoDosAvisos()).toBe('bloqueado')
    expect(await modulo.ligarAvisosDoSistema()).toBe('bloqueado')
  })

  it('navegador sem a API não quebra nada', async () => {
    vi.stubGlobal('Notification', undefined)
    const modulo = await carregarModulo()

    expect(modulo.estadoDosAvisos()).toBe('indisponivel')
    ouvinte!({ type: 'notification', kind: 'ticket_created', title: 'Novo chamado' })
    await cederAoLoop()
    expect(hertzTocados).toHaveLength(1) // som e título seguem funcionando
  })
})
