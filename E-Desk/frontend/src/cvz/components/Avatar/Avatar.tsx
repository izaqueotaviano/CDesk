import './Avatar.scss';

export type Presence = 'available' | 'away' | 'offline';
export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** Nome completo — usado para derivar as iniciais e o texto acessível. */
  name: string;
  /** Sobrescreve as iniciais derivadas do nome. */
  initials?: string;
  presence?: Presence;
  size?: AvatarSize;
  /** Cor de fundo da superfície onde o avatar está, para o recorte do anel. */
  ringOn?: 'chrome' | 'surface' | 'raised';
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  available: 'Disponível',
  away: 'Ausente',
  offline: 'Offline',
};

/** "Ana Beatriz Costa" → "AC". Uma palavra vira as duas primeiras letras. */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function Avatar({
  name,
  initials,
  presence,
  size = 'md',
  ringOn = 'chrome',
}: AvatarProps) {
  const cls = [
    'avatar',
    `avatar--${size}`,
    `avatar--on-${ringOn}`,
    presence ? `avatar--${presence}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={cls} title={name}>
      <span aria-hidden>{initials ?? initialsFrom(name)}</span>
      {presence && <span className="avatar__presence" aria-hidden />}
      <span className="sr-only">
        {name}
        {presence ? `, ${PRESENCE_LABEL[presence]}` : ''}
      </span>
    </span>
  );
}

export default Avatar;
