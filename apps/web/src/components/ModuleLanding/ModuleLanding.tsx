import { useRouter } from '../../state/router.js';
import styles from './ModuleLanding.module.css';

/** docs/01 MVP step 3 "Select Architecture or Interior" — the module entry point. */
export function ModuleLanding() {
  const { navigate } = useRouter();

  return (
    <div className={styles.root}>
      <p className={styles.heading}>
        Start by choosing a module. Each preserves architecture, camera, and material fidelity while transforming your
        viewport into professional photography.
      </p>
      <div className={styles.cards}>
        <button type="button" className={styles.card} onClick={() => navigate('/architecture')}>
          <h2 className={styles.cardTitle}>Architecture</h2>
          <p className={styles.cardDescription}>Exteriors — facade, massing, roof, site context.</p>
        </button>
        <button type="button" className={styles.card} onClick={() => navigate('/interior')}>
          <h2 className={styles.cardTitle}>Interior</h2>
          <p className={styles.cardDescription}>Interiors — spatial layout, furnishing, finishes.</p>
        </button>
      </div>
    </div>
  );
}
