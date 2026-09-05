import { describe, expect, it } from 'vitest';
import { createInitialProjectSessionState, ProjectSessionStore } from './project-session.js';

describe('ProjectSessionStore', () => {
  it('starts idle with no project, DNA, or errors', () => {
    const store = new ProjectSessionStore();
    expect(store.getState()).toEqual(createInitialProjectSessionState());
  });

  it('notifies subscribers on setState and stops after unsubscribe', () => {
    const store = new ProjectSessionStore();
    const seen: string[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.status));

    store.setState({ status: 'loading' });
    unsubscribe();
    store.setState({ status: 'error' });

    expect(seen).toEqual(['loading']);
    expect(store.getState().status).toBe('error');
  });
});
