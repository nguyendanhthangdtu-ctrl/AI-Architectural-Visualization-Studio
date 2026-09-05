import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { ProjectSessionStore, type ProjectSessionState } from './project-session.js';

/**
 * React binding for the BUILD 02 ProjectSessionStore — the one and only
 * global state system (per BUILD 03 instruction: do not invent a second).
 * useSyncExternalStore is React's built-in mechanism for exactly this kind
 * of external store subscription, so no state-management library is added.
 */
const ProjectSessionStoreContext = createContext<ProjectSessionStore | null>(null);

export function ProjectSessionProvider({ children, store }: { children: ReactNode; store?: ProjectSessionStore }) {
  const ref = useRef<ProjectSessionStore>();
  if (!ref.current) {
    ref.current = store ?? new ProjectSessionStore();
  }
  return <ProjectSessionStoreContext.Provider value={ref.current}>{children}</ProjectSessionStoreContext.Provider>;
}

function useStore(): ProjectSessionStore {
  const store = useContext(ProjectSessionStoreContext);
  if (!store) {
    throw new Error('useProjectSession must be used within a ProjectSessionProvider');
  }
  return store;
}

export function useProjectSessionState(): ProjectSessionState {
  const store = useStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
  );
}

export function useProjectSessionActions() {
  const store = useStore();
  return useMemo(
    () => ({
      setState: store.setState.bind(store),
    }),
    [store],
  );
}
