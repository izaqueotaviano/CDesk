import { useTemaResolvido, type TemaResolvido } from '@/stores/prefs'

export type Tema = TemaResolvido

/**
 * Tema do shell Resolv — um CONSUMIDOR da preferência do app, não um segundo
 * dono dela.
 *
 * O `data-tema` do <html> já tinha dono antes desta rodada: `stores/prefs`
 * escreve nele desde sempre (é por lá que o portal troca de tema, com um
 * terceiro estado "sistema"), e styles/tokens.css lê o mesmo atributo. Um
 * segundo writer aqui daria duas preferências disputando o mesmo atributo:
 * um clique neste botão repintaria o app inteiro, e uma troca de tema pelo
 * portal mudaria o shell por baixo com o rótulo do botão mentindo sobre o que
 * está na tela.
 *
 * Por fora são dois estados, não três — o botão é um alternador, e quem quer
 * "acompanhar o sistema" tem essa opção no seletor do portal.
 */
export function useTema(): { tema: Tema; alternar: () => void } {
  return useTemaResolvido()
}
