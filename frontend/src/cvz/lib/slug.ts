/**
 * Deriva um slug a partir de um nome digitado — usado nos formulários de
 * criação onde o backend exige `slug` (`Plan`, `Company`): o serializer usa
 * o helper `slug_unico()` (apps/core/serializer_fields.py) sem o override
 * `required=False` que Team/Category/Service/Tag/Status têm, então o campo
 * é obrigatório de verdade nesses dois casos — a pessoa digita só o nome, o
 * identificador nasce dele.
 */
export function slugificar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas diacríticas combinantes (acentos)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
