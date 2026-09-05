import styles from './PrimaryAction.module.css';

export interface PrimaryActionProps {
  label?: string;
  hint?: string;
  disabled?: boolean;
  onActivate?: () => void;
}

/**
 * The Render/Generate action — docs/02 UX rule "Primary Render action should
 * be visually prominent and placed at the end of the generation flow."
 * Positioned by its parent (ModuleWorkspace) at the bottom of the main
 * workflow, structurally after canvas/control content in DOM order.
 */
export function PrimaryAction({ label = 'Render', hint, disabled = true, onActivate }: PrimaryActionProps) {
  return (
    <div className={styles.root} data-testid="primary-action-bar">
      <span className={styles.hint}>{hint ?? 'Upload a source image, apply a scenario, and compile a prompt to render.'}</span>
      <button type="button" className={styles.button} disabled={disabled} onClick={onActivate}>
        {label}
      </button>
    </div>
  );
}
