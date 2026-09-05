import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectSessionProvider } from '../../state/ProjectSessionContext.js';
import { ProjectSessionStore, createInitialProjectSessionState } from '../../state/project-session.js';
import { AuthGate } from './AuthGate.js';

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderGate() {
  const store = new ProjectSessionStore(createInitialProjectSessionState());
  render(
    <ProjectSessionProvider store={store}>
      <AuthGate />
    </ProjectSessionProvider>,
  );
  return store;
}

describe('AuthGate — RELEASE 02 sign-in/register screen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to Sign in mode, with no registration-code field', () => {
    renderGate();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText(/registration code/i)).not.toBeInTheDocument();
  });

  it('signs in with real credentials and updates the session store on success', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u1', email: 'real@example.com' }));

    const store = renderGate();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'real@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(store.getState().authStatus).toBe('signedIn'));
    expect(store.getState().currentUser).toEqual({ id: 'u1', email: 'real@example.com' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/auth/login');
    expect(JSON.parse(init.body)).toEqual({ email: 'real@example.com', password: 'correct horse battery staple' });
  });

  it('shows the real error envelope, not a fake success, when sign-in fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', retryable: false }, { status: 401 }),
    );

    const store = renderGate();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'));
    expect(store.getState().authStatus).toBe('checking');
  });

  it('switches to Create account mode, revealing the registration-code field, and submits to /auth/register', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u2', email: 'new@example.com' }, { status: 201 }));

    const store = renderGate();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText(/registration code/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.change(screen.getByLabelText(/registration code/i), { target: { value: 'invite-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(store.getState().authStatus).toBe('signedIn'));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/auth/register');
    expect(JSON.parse(init.body)).toEqual({
      email: 'new@example.com',
      password: 'correct horse battery staple',
      registrationSecret: 'invite-123',
    });
  });
});
