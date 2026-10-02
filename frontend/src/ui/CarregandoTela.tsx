/**
 * Entre o clique numa rota e o pedaço da tela chegar (routes.tsx, carregavel).
 * Fica dentro do shell: menu e barra superior já estão desenhados, só o miolo
 * espera. Discreto de propósito: na maioria das vezes dura menos de um
 * piscar, e um esqueleto que aparece e some seria pior que texto quieto.
 */
export function CarregandoTela() {
  return (
    <p
      role="status"
      style={{ margin: 0, padding: '24px', color: 'var(--text-secondary, #616161)', fontSize: 14 }}
    >
      Carregando…
    </p>
  )
}
