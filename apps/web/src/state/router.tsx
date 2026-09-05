import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { resolveRoute, type Route } from '../routes.js';

/**
 * Minimal router built directly on BUILD 02's typed route table
 * (apps/web/src/routes.ts) — deliberately not a third-party router
 * dependency, per BUILD 03 instruction to reuse the existing routing
 * approach rather than replace it.
 */
function subscribeToHistory(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function getPathname(): string {
  return window.location.pathname;
}

interface RouterContextValue {
  pathname: string;
  route: Route | null;
  navigate: (path: string) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const pathname = useSyncExternalStore(subscribeToHistory, getPathname, () => '/');

  const navigate = useCallback((path: string) => {
    if (path === window.location.pathname) return;
    window.history.pushState({}, '', path);
    // pushState does not fire popstate — dispatch manually so subscribers update.
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const value = useMemo<RouterContextValue>(
    () => ({ pathname, route: resolveRoute(pathname), navigate }),
    [pathname, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
}
