import { useEffect } from 'react';
import { AppShell } from './components/AppShell/AppShell.js';
import { AuthGate } from './components/AuthGate/AuthGate.js';
import { ModuleLanding } from './components/ModuleLanding/ModuleLanding.js';
import { ModuleWorkspace } from './components/ModuleWorkspace/ModuleWorkspace.js';
import { ProjectWorkspacePlaceholder } from './components/ProjectWorkspacePlaceholder/ProjectWorkspacePlaceholder.js';
import { getCurrentUser, getProviderConfiguration } from './api/client.js';
import { ProjectSessionProvider, useProjectSessionActions, useProjectSessionState } from './state/ProjectSessionContext.js';
import { RouterProvider, useRouter } from './state/router.js';

function RoutedContent() {
  const { route } = useRouter();

  switch (route?.name) {
    case 'architecture':
      return <ModuleWorkspace module="architecture" />;
    case 'interior':
      return <ModuleWorkspace module="interior" />;
    case 'project':
      return <ProjectWorkspacePlaceholder />;
    default:
      return <ModuleLanding />;
  }
}

/**
 * RELEASE 02 (Security & Production Access Hardening) — every apps/api route
 * now requires a real session; this checks once on mount (`GET /auth/me`,
 * the one route that safely answers "am I signed in" without guessing from
 * some other route's response code) and renders either the real app or the
 * sign-in/register gate — never both, never a "logged-out preview."
 */
function AuthenticatedApp() {
  const state = useProjectSessionState();
  const { setState } = useProjectSessionActions();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // BUILD 27 — fetched alongside auth, never gating it: a failed/slow
      // /ready call must never delay or block reaching the real app, so this
      // resolves to `null` (informational-only, "unknown") rather than
      // rejecting the whole bootstrap.
      const [user, providerConfiguration] = await Promise.all([
        getCurrentUser().catch(() => null),
        getProviderConfiguration().catch(() => null),
      ]);
      if (cancelled) return;
      setState({
        ...(user ? { currentUser: user, authStatus: 'signedIn' } : { authStatus: 'signedOut' }),
        providerConfiguration,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount only; setState identity is stable
  }, []);

  if (state.authStatus === 'checking') return null;
  if (state.authStatus === 'signedOut') return <AuthGate />;

  return (
    <RouterProvider>
      <AppShell>
        <RoutedContent />
      </AppShell>
    </RouterProvider>
  );
}

export function App() {
  return (
    <ProjectSessionProvider>
      <AuthenticatedApp />
    </ProjectSessionProvider>
  );
}
