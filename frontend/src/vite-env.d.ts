/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_WS_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare namespace JSX {
  interface IntrinsicElements {
    'md-filled-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { disabled?: boolean }
    'md-filled-tonal-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { disabled?: boolean }
    'md-outlined-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { disabled?: boolean }
    'md-text-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { disabled?: boolean }
    'md-icon-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { disabled?: boolean }
    'md-checkbox': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { checked?: boolean }
    'md-switch': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean }
    'md-outlined-text-field': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      label?: string
      placeholder?: string
    }
  }
}
