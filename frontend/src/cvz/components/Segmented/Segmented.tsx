import './Segmented.scss';

export interface SegmentedOption<K extends string> {
  key: K;
  label: string;
}

export interface SegmentedProps<K extends string> {
  options: SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Nome do grupo para o leitor de tela ("Período", "Ver por"). */
  label: string;
}

/**
 * Escolha única entre poucas opções vizinhas (Hoje / Esta semana / Este mês).
 * Botões com `aria-pressed` num `role="group"`, não abas: trocar a opção
 * refaz o MESMO conteúdo com outro recorte, não mostra outro painel.
 *
 * O ativo é a pílula quente do item ativo da sidebar do console, com o texto
 * em tinta cheia e peso maior — nada de cor de marca. Antes cada painel de
 * Relatórios desenhava o seu, e o ativo era laranja com texto branco a
 * 3,05:1.
 */
export function Segmented<K extends string>({ options, value, onChange, label }: SegmentedProps<K>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => {
        const ativo = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            className={'segmented__opcao' + (ativo ? ' segmented__opcao--ativa' : '')}
            aria-pressed={ativo}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
