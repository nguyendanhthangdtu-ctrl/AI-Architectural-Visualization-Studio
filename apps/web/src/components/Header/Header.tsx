import type { Language } from '@avs/shared';
import { StatusIndicator } from '../StatusIndicator/StatusIndicator.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import styles from './Header.module.css';

/** docs/02 UX "Header: project, model/provider, save/status." */
export function Header() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();

  function setUiLanguage(uiLanguage: Language) {
    setState({ language: { ...state.language, uiLanguage } });
  }

  return (
    <header className={styles.root}>
      <div className={styles.identity}>
        <p className={styles.wordmark}>AI Architectural Visualization Studio</p>
        <span className={styles.tagline}>viewport → photograph</span>
      </div>
      <span className={styles.context}>{state.currentProject?.name ?? 'No project selected'}</span>
      <div className={styles.actions}>
        <div className={styles.languageToggle} role="group" aria-label="UI language">
          <button
            type="button"
            className={styles.languageOption}
            aria-pressed={state.language.uiLanguage === 'vi'}
            onClick={() => setUiLanguage('vi')}
          >
            VI
          </button>
          <button
            type="button"
            className={styles.languageOption}
            aria-pressed={state.language.uiLanguage === 'en'}
            onClick={() => setUiLanguage('en')}
          >
            EN
          </button>
        </div>
        <StatusIndicator status={state.status} />
      </div>
    </header>
  );
}
