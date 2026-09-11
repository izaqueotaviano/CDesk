import '@testing-library/jest-dom/vitest'

// jsdom não implementa scrollIntoView; a conversa do chat (ConversaChat,
// Conversa do portal) rola pro fim a cada mensagem nova. Stub inerte —
// nenhum teste afirma sobre rolagem.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom não implementa a Web Animations API. Os componentes do Material animam
// o próprio desenho (o "tique" da caixa, o rótulo que sobe no campo) chamando
// `Element.animate` direto — sem ela, a troca de estado morre no meio e a
// caixa nunca chega a marcar. O dublê devolve um objeto de animação já
// terminada; nenhum teste afirma sobre animação.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = () =>
    ({
      cancel: () => {},
      finish: () => {},
      play: () => {},
      pause: () => {},
      reverse: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      finished: Promise.resolve(),
      onfinish: null,
      oncancel: null,
      playState: 'finished',
    }) as unknown as Animation
}

// jsdom também não implementa `matchMedia`. Antes dava pra viver sem: só o
// código do produto chamava, e cada teste que precisava dublava o seu. O
// @material/web consulta `prefers-reduced-motion` no MÓDULO (ao importar o
// componente, antes de qualquer `beforeEach`), então a falta dele agora
// derruba o arquivo inteiro na coleta. Padrão "nenhuma media casa" — quem
// precisa de outra resposta continua dublando por cima.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (consulta: string) =>
    ({
      matches: false,
      media: consulta,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// ── ElementInternals do jsdom ───────────────────────────────────────────────
// Os componentes do @material/web são *form-associated*: botão, campo,
// checkbox e select publicam o próprio valor no <form> via
// `ElementInternals.setFormValue()` (labs/behaviors/form-associated.js). O
// jsdom 30 implementa `attachInternals()`, mas o objeto que ele devolve não
// tem NENHUM dos métodos de formulário — construir qualquer md-* estourava
// "this[internals].setFormValue is not a function" em 209 exceções não
// tratadas, uma por elemento renderizado.
//
// Os métodos abaixo são inertes de propósito: nenhum teste afirma sobre envio
// nativo de formulário (todos os formulários do produto submetem por
// `onSubmit` do React e mandam JSON pela API). O que o stub compra é só o
// direito de instanciar o componente.
if (typeof ElementInternals !== 'undefined') {
  const proto = ElementInternals.prototype as unknown as Record<string, unknown>
  for (const metodo of ['setFormValue', 'setValidity', 'checkValidity', 'reportValidity']) {
    if (typeof proto[metodo] !== 'function') {
      proto[metodo] = metodo.endsWith('Validity') && metodo !== 'setValidity' ? () => true : () => {}
    }
  }
  if (!('form' in proto)) Object.defineProperty(proto, 'form', { get: () => null })
  if (!('validity' in proto)) {
    Object.defineProperty(proto, 'validity', { get: () => ({ valid: true }) })
  }
  if (!('states' in proto)) {
    Object.defineProperty(proto, 'states', { get: () => new Set<string>() })
  }
}

// ── Papel ARIA dos custom elements do Material no jsdom ─────────────────────
// O @material/web MOVE de propósito `role` e todo `aria-*` do host para
// `data-role` / `data-aria-*`, e reaplica o valor no elemento interno do shadow
// root (internal/aria/delegate.js). Em navegador isso é correto — evita o
// leitor de tela anunciar o mesmo controle duas vezes —, mas o
// `dom-accessibility-api`, motor do `getByRole`, não atravessa shadow root:
// dos dois lugares onde a semântica pode estar, ele só enxerga o que sobrou no
// host, e o que sobrou no host é `data-`.
//
// O bloco abaixo desliga essa mudança SÓ NO TESTE e devolve ao host o papel
// que o componente expõe no navegador. Não é semântica inventada: é a mesma
// que o Chrome, o NVDA e o axe leem no elemento. A alternativa seria trocar
// ~150 asserções de papel por buscas de texto — piorar o teste por um limite
// da ferramenta, não do produto.
const PAPEL_DO_ELEMENTO: Record<string, string> = {
  'md-checkbox': 'checkbox',
  'md-switch': 'switch',
  'md-outlined-text-field': 'textbox',
  'md-filled-text-field': 'textbox',
  'md-outlined-select': 'combobox',
  'md-filled-select': 'combobox',
  'md-select-option': 'option',
  'md-divider': 'separator',
}

function papelDe(nome: string): string | undefined {
  if (nome.endsWith('-button')) return 'button' // filled/outlined/text/tonal/icon
  return PAPEL_DO_ELEMENTO[nome]
}

function ehAtributoAria(nome: string) {
  return nome === 'role' || nome.startsWith('aria-')
}

// Clique numa caixa do Material: no navegador o <input> do shadow root ocupa o
// host inteiro, então o clique da pessoa cai nele. Sem layout, o jsdom entrega
// o clique ao host e ele morre ali — a caixa nunca marca. O encaminhamento
// abaixo refaz o caminho que a geometria faz no navegador.
if (typeof customElements !== 'undefined') {
  const definirOriginal = customElements.define.bind(customElements)
  customElements.define = (nome, construtor, opcoes) => {
    const papel = papelDe(nome)
    if (papel) {
      type ProtoMaterial = {
        connectedCallback?: () => void
        attributeChangedCallback?: (n: string, antigo: string | null, novo: string | null) => void
      }
      const proto = construtor.prototype as ProtoMaterial

      // 1. Ler `aria-label`/`role` volta a ler o atributo de verdade — o
      //    delegate.js redireciona a leitura para `data-*`, e é por getAttribute
      //    que o dom-accessibility-api calcula o nome acessível.
      Object.assign(proto, {
        getAttribute: Element.prototype.getAttribute,
        removeAttribute: Element.prototype.removeAttribute,
      })

      // 2. Escrever também: sem isto o atributo é apagado do host no primeiro
      //    `attributeChangedCallback` e reaparece como `data-`.
      const mudarAtributoOriginal = proto.attributeChangedCallback
      proto.attributeChangedCallback = function (
        this: HTMLElement,
        atributo: string,
        antigo: string | null,
        novo: string | null,
      ) {
        if (ehAtributoAria(atributo)) return
        mudarAtributoOriginal?.call(this, atributo, antigo, novo)
      }

      const conectarOriginal = proto.connectedCallback
      proto.connectedCallback = function (this: HTMLElement) {
        conectarOriginal?.call(this)
        // `hasAttribute` primeiro: um `role` escrito no JSX continua mandando.
        if (!this.hasAttribute('role')) this.setAttribute('role', papel)
        // Mesma história da ordem de tabulação: no navegador o host é UMA
        // parada de Tab (`delegatesFocus` no shadow root), mas o `userEvent`
        // procura tag focalizável ou `tabindex` no DOM claro e não acha nada.
        if (papel !== 'separator' && papel !== 'option' && !this.hasAttribute('tabindex')) {
          this.setAttribute('tabindex', '0')
        }
      }
    }
    return definirOriginal(nome, construtor, opcoes)
  }
}
