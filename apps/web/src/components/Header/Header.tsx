import type { Language } from '@avs/shared';
import { StatusIndicator } from '../StatusIndicator/StatusIndicator.js';
import { logout } from '../../api/client.js';
import { createInitialProjectSessionState } from '../../state/project-session.js';
import { useProjectSessionActions, useProjectSessionState } from '../../state/ProjectSessionContext.js';
import styles from './Header.module.css';

/** docs/02 UX "Header: project, model/provider, save/status." */
export function Header() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();

  function setUiLanguage(uiLanguage: Language) {
    setState({ language: { ...state.language, uiLanguage } });
  }

  /** RELEASE 02 — resets the entire client-side session, not just `currentUser`: a signed-out screen must never keep the previous user's project/analysis/prompt state around in memory. */
  async function handleSignOut() {
    await logout().catch(() => undefined);
    setState({ ...createInitialProjectSessionState(), authStatus: 'signedOut', language: state.language });
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
        {state.currentUser ? (
          <div className={styles.account}>
            <span className={styles.email}>{state.currentUser.email}</span>
            <button type="button" className={styles.signOut} onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
