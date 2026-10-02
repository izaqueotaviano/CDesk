import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import escalaDoTexto from './postcss-escala-texto.js'

// Lista (e não o objeto `{ tailwindcss: {} }`) para poder usar um plugin do
// próprio repositório. A ordem importa: a escala do texto roda DEPOIS do
// Tailwind, senão as classes utilitárias (`text-corpo`, `text-[13px]`) ainda
// não existem como CSS quando ela passa.
export default {
  plugins: [tailwindcss(), autoprefixer(), escalaDoTexto()],
}
