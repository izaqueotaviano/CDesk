import { useEffect } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

/**
 * Rota citada em docs/07-arquitetura-frontend.md ("/login/google — redireciona
 * para o fluxo allauth"), mas o caminho exato do allauth não está em nenhum
 * documento lido (docs/01 só confirma "Google OAuth via django-allauth" para
 * internos). `/accounts/google/login/` é o caminho PADRÃO do
 * django-allauth — confirme contra `config/urls.py` antes de depender disto.
 */
export function PaginaLoginGoogle() {
  useEffect(() => {
    window.location.href = `${API_BASE_URL}/accounts/google/login/`
  }, [])
  return null
}
