import { useState } from 'react';
import type { ErrorEnvelope } from '@avs/shared';
import { login, register } from '../../api/client.js';
import { toErrorEnvelope } from '../../api/errors.js';
import { useProjectSessionActions } from '../../state/ProjectSessionContext.js';
import { ErrorState } from '../ErrorState/ErrorState.js';
import styles from './AuthGate.module.css';

type Mode = 'sign-in' | 'register';
type SubmitStatus = 'idle' | 'loading' | 'error';

/**
 * RELEASE 02 (Security & Production Access Hardening) — every route now
 * requires a real session; this replaces the entire app with a sign-in/
 * register screen until one exists, and never renders the real app
 * underneath it (no "preview while logged out" mode — there is nothing this
 * product can safely show without a project owner identity).
 *
 * Registration is only ever offered as a mode toggle here — it still fails
 * server-side with a real, honest `REGISTRATION_DISABLED`/`REGISTRATION_FORBIDDEN`
 * error if the deployment hasn't configured `REGISTRATION_SECRET` (or the
 * value entered doesn't match it); this screen never pretends registration
 * is open just because the toggle exists.
 */
export function AuthGate() {
  const { setState } = useProjectSessionActions();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registrationSecret, setRegistrationSecret] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [error, setError] = useState<ErrorEnvelope | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError(undefined);
    try {
      const user =
        mode === 'sign-in' ? await login({ email, password }) : await register({ email, password, registrationSecret });
      setState({ currentUser: user, authStatus: 'signedIn' });
    } catch (err) {
      setError(toErrorEnvelope(err, mode === 'sign-in' ? 'Something went wrong signing in.' : 'Something went wrong registering.'));
      setStatus('error');
    }
  };

  return (
    <div className={styles.root}>
      <form className={styles.card} onSubmit={(e) => void handleSubmit(e)}>
        <p className={styles.wordmark}>AI Architectural Visualization Studio</p>

        <div className={styles.modeToggle} role="group" aria-label="Sign in or register">
          <button type="button" aria-pressed={mode === 'sign-in'} onClick={() => setMode('sign-in')}>
            Sign in
          </button>
          <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>

        <label className={styles.field}>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className={styles.field}>
          Password
          <input
            type="password"
            required
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {mode === 'register' ? (
          <label className={styles.field}>
            Registration code
            <input
              type="password"
              required
              value={registrationSecret}
              onChange={(e) => setRegistrationSecret(e.target.value)}
              placeholder="Provided privately by the deployment owner"
            />
          </label>
        ) : null}

        <button type="submit" className={styles.submit} disabled={status === 'loading'}>
          {status === 'loading' ? 'Please wait…' : 'Continue'}
        </button>

        {status === 'error' && error ? <ErrorState error={error} /> : null}
      </form>
    </div>
  );
}
