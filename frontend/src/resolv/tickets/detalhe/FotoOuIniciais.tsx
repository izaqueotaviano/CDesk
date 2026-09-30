import { useState } from 'react'
import { iniciais, urlApi } from './linhaDoTempo'

/**
 * A foto da pessoa, ou as iniciais quando não há foto ou ela não carrega
 * (arquivo que sumiu, avatar pronto que o front não publica, estático sem
 * CORS em dev). Sem isto o avatar virava o ícone de imagem quebrada.
 */
export function FotoOuIniciais({ url, nome }: { url?: string | null; nome: string }) {
  const [falhou, setFalhou] = useState(false)
  if (url && !falhou) {
    return <img src={urlApi(url)} alt="" onError={() => setFalhou(true)} />
  }
  return <>{iniciais(nome)}</>
}
