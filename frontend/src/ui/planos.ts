import { indiceDeIdentidade, type IndiceDeIdentidade } from './identidade'

/**
 * Tom de identidade do plano da empresa — um só lugar, porque o plano aparece
 * em dois design systems (selo na lista de empresas do cvz, chip no painel
 * do cliente do ticket no resolv) e precisa ser a mesma cor nos dois.
 *
 * Os três planos que existem hoje têm tom escolhido por CONOTAÇÃO, não por
 * sorteio: Black em ardósia (neutro-frio), Gold em sépia (quente, sem
 * invadir o âmbar de "pendente"), Platinum em aço (frio-premium). Um plano
 * novo cai no hash de identidade — o mesmo mecanismo do avatar — e continua
 * determinístico: o mesmo nome, o mesmo tom, em toda tela.
 */
const POR_NOME: Record<string, IndiceDeIdentidade> = {
  black: 5,
  gold: 4,
  platinum: 3,
}

export function indiceDoPlano(nome: string | null | undefined): IndiceDeIdentidade {
  const chave = (nome ?? '').trim().toLowerCase()
  return POR_NOME[chave] ?? indiceDeIdentidade(chave || 'plano')
}
