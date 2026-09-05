import { describeArchitectureModule } from '@avs/project-core';
import styles from './ArchitectureFocus.module.css';

function titleCase(value: string): string {
  return value
    .split('-')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * BUILD 04 — Architecture Module: the module's distinct identity in the
 * shared ModuleWorkspace shell (docs/03 §3 "explicit module boundary ready
 * for BUILD 04/05"). Renders the real docs/05 layer 2/9 vocabulary
 * (packages/project-core/architecture-module.ts) as reference chips — not
 * an analysis result, since Vision Analysis Engine (BUILD 07) doesn't exist
 * yet. Interior's equivalent identity is BUILD 05's scope, left untouched.
 */
export function ArchitectureFocus() {
  const description = describeArchitectureModule();

  return (
    <section className={styles.root} aria-labelledby="architecture-focus-title">
      <div className={styles.header}>
        <h2 id="architecture-focus-title" className={styles.title}>
          Architecture Focus
        </h2>
        <span className={styles.badge}>BUILD 07</span>
      </div>
      <p className={styles.description}>
        Once analyzed, this module preserves {description.analysisFocus.join(', ')} — the exterior facts Architecture
        Lock protects.
      </p>
      <div className={styles.group}>
        <span className={styles.groupLabel}>Roof</span>
        <div className={styles.chips}>
          {description.roofTypes.map((type) => (
            <span key={type} className={styles.chip}>
              {titleCase(type)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.group}>
        <span className={styles.groupLabel}>Site objects</span>
        <div className={styles.chips}>
          {description.objectCategories.map((category) => (
            <span key={category} className={styles.chip}>
              {titleCase(category)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
