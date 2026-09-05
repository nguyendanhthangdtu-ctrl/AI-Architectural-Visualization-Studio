import { useState, type ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * Generic collapsible/contextual panel — docs/02 UX rule "Canvas gets
 * priority over secondary analysis panels." This is deliberately the ONLY
 * mechanism for right-side content: there is no permanently-wide panel
 * anywhere in the shell. Collapsed by default so the canvas keeps priority.
 */
export function Panel({ title, children, defaultOpen = false }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.root} data-open={open} aria-label={title}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        >
          {open ? '»' : '«'}
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
