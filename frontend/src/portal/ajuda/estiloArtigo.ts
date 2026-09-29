/**
 * Estilo do HTML que vem do WordPress. Sem plugin de tipografia no projeto:
 * as regras moram aqui, em cima dos tokens do design system, para o artigo
 * não herdar o "sem estilo" do navegador nem escapar da paleta.
 */
export const ESTILO_ARTIGO = [
  'text-corpo-lg leading-solta text-tinta',
  '[&_h2]:mt-8 [&_h2]:text-titulo-sm [&_h2]:font-forte [&_h2]:text-tinta',
  '[&_h3]:mt-6 [&_h3]:text-corpo-lg [&_h3]:font-forte [&_h3]:text-tinta',
  '[&_p]:mt-4',
  '[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1.5',
  '[&_a]:text-acento [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-forte',
  '[&_img]:mt-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md',
  '[&_figure]:mt-4 [&_figcaption]:mt-1.5 [&_figcaption]:text-legenda [&_figcaption]:text-tinta-secundaria',
  '[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-borda-controle [&_blockquote]:pl-4 [&_blockquote]:text-tinta-secundaria',
  '[&_code]:rounded-sm [&_code]:bg-navegacao [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-pequeno [&_code]:fonte-mono',
  '[&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-navegacao [&_pre]:p-4 [&_pre]:text-pequeno',
  '[&_table]:mt-4 [&_table]:w-full [&_table]:text-pequeno [&_th]:border-b [&_th]:border-divisoria [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-divisoria [&_td]:p-2',
  '[&_hr]:my-6 [&_hr]:border-divisoria',
].join(' ')
