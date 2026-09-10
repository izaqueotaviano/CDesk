import { useState, type ReactNode } from 'react';
import { IconChevronDown } from '../icons';
import './Tabs.scss';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  /** Aba inicial; o componente controla o resto. */
  defaultId?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ items, defaultId, onChange }: TabsProps) {
  const [active, setActive] = useState(defaultId ?? items[0]?.id);

  const select = (id: string) => {
    setActive(id);
    onChange?.(id);
  };

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist">
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={
              'tabs__tab' + (t.id === active ? ' tabs__tab--active' : '')
            }
            onClick={() => select(t.id)}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className="tabs__count">{t.count}</span>
            )}
          </button>
        ))}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          className="tabs__panel"
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

export interface AccordionProps {
  items: AccordionItem[];
  /** Ids abertos no primeiro render. */
  defaultOpen?: string[];
  /** Um aberto por vez. */
  single?: boolean;
}

export function Accordion({ items, defaultOpen = [], single = false }: AccordionProps) {
  const [open, setOpen] = useState<string[]>(defaultOpen);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const isOpen = prev.includes(id);
      if (single) return isOpen ? [] : [id];
      return isOpen ? prev.filter((x) => x !== id) : [...prev, id];
    });
  };

  return (
    <div className="accordion">
      {items.map((item) => {
        const isOpen = open.includes(item.id);
        return (
          <div
            key={item.id}
            className={'accordion__item' + (isOpen ? ' accordion__item--open' : '')}
          >
            <button
              type="button"
              className="accordion__trigger"
              aria-expanded={isOpen}
              onClick={() => toggle(item.id)}
            >
              {item.title}
              <IconChevronDown className="accordion__caret" />
            </button>
            {isOpen && <div className="accordion__body">{item.content}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default Tabs;
