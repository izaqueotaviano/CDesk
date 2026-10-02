const MINIMO = 12

export interface RegraDaSenha {
  id: string
  ok: boolean
  texto: string
}

/**
 * As regras do servidor (`AUTH_PASSWORD_VALIDATORS` em config/settings/base.py)
 * conferidas ao digitar — a pessoa vê o que falta antes de enviar. É uma
 * PRÉVIA: a palavra final é do servidor (a lista de senhas comuns, por
 * exemplo, só ele tem), e o que ele recusar aparece embaixo do campo.
 */
export function regrasDaSenha(senha: string, confirmacao: string, email: string, nome: string): RegraDaSenha[] {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]|_/].filter((r) => r.test(senha)).length
  const baixa = senha.toLowerCase()
  const usuario = email.split('@')[0]?.toLowerCase() ?? ''
  const partesNome = nome.toLowerCase().split(/\s+/).filter((p) => p.length >= 4)
  const parecida = (usuario.length >= 4 && baixa.includes(usuario)) || partesNome.some((p) => baixa.includes(p))
  return [
    { id: 'tamanho', ok: senha.length >= MINIMO, texto: `Pelo menos ${MINIMO} caracteres` },
    { id: 'variedade', ok: classes >= 3, texto: 'Três tipos de caractere: minúsculas, maiúsculas, números ou símbolos' },
    { id: 'pessoal', ok: senha.length > 0 && !parecida, texto: 'Diferente do seu nome e do seu e-mail' },
    { id: 'confirma', ok: senha.length > 0 && senha === confirmacao, texto: 'Confirmação igual à senha nova' },
  ]
}
