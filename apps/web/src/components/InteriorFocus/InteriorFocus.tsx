import { describeInteriorModule } from '@avs/project-core';
import styles from './InteriorFocus.module.css';

function titleCase(value: string): string {
  return value
    .split('-')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * BUILD 05 — Interior Module: the module's distinct identity in the shared
 * ModuleWorkspace shell (docs/03 §3 "explicit module boundary ready for
 * BUILD 04/05"), mirroring ArchitectureFocus (BUILD 04). Renders the real
 * docs/04/05 vocabulary (packages/project-core/interior-module.ts) as
 * reference chips — not an analysis result, since Vision Analysis Engine
 * (BUILD 07) doesn't exist yet.
 */
export function InteriorFocus() {
  const description = describeInteriorModule();

  return (
    <section className={styles.root} aria-labelledby="interior-focus-title">
      <div className={styles.header}>
        <h2 id="interior-focus-title" className={styles.title}>
          Interior Focus
        </h2>
        <span className={styles.badge}>BUILD 07</span>
      </div>
      <p className={styles.description}>
        Once analyzed, this module preserves {description.analysisFocus.join(', ')} — the interior facts Material Lock
        protects.
      </p>
      <div className={styles.group}>
        <span className={styles.groupLabel}>Floor finish</span>
        <div className={styles.chips}>
          {description.floorFinishes.map((finish) => (
            <span key={finish} className={styles.chip}>
              {titleCase(finish)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.group}>
        <span className={styles.groupLabel}>Furnishing objects</span>
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
