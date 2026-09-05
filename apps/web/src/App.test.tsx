import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from './App.js';

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Integration-level smoke test covering the BUILD 03 acceptance list
 * (docs/19 gate protocol). Component-level behavior is covered by each
 * component's own test file; this proves the assembled shell.
 *
 * RELEASE 02 (Security & Production Access Hardening): every mount now
 * starts with a real `GET /auth/me` check before rendering the real app —
 * stubbed here to resolve as an already-signed-in user (the shell/routing
 * behavior these tests exist to cover is orthogonal to the sign-in flow
 * itself, which has its own dedicated coverage in AuthGate.test.tsx).
 */
describe('App (BUILD 03 UI/UX Foundation)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ id: 'test-user', email: 'test@example.com' })),
    );
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.unstubAllGlobals();
  });

  async function renderApp() {
    render(<App />);
    // Only ever rendered once `authStatus` resolves to 'signedIn' — the real wait signal every test below needs.
    await screen.findByRole('navigation', { name: 'Modules' });
  }

  it('starts and renders the main application shell — header, navigation, and routed content', async () => {
    await renderApp();
    expect(screen.getByText('AI Architectural Visualization Studio')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeInTheDocument();
  });

  it('renders the Architecture and Interior module entry points on the landing view', async () => {
    await renderApp();
    expect(screen.getByRole('button', { name: /Architecture/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Interior/i })).toBeInTheDocument();
  });

  it('navigates into the Architecture workspace and renders its distinct module boundary', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.getByLabelText('architecture workspace')).toBeInTheDocument();
  });

  it('navigates into the Interior workspace and renders its distinct module boundary', async () => {
    window.history.pushState({}, '', '/interior');
    await renderApp();
    expect(screen.getByLabelText('interior workspace')).toBeInTheDocument();
  });

  it('renders the upload dropzone foundation inside the module workspace', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.getByRole('button', { name: /drop a viewport image/i })).toBeInTheDocument();
  });

  it('renders Prompt From Image directly above the Prompt Editor', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    const promptFromImage = screen.getByText('Dò prompt từ ảnh').closest('section')!;
    const promptEditor = screen.getByLabelText('Prompt editor').closest('section')!;
    expect(promptFromImage.compareDocumentPosition(promptEditor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the Locks section with correct (honest) state representation', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.getByText('Locks become available after analysis')).toBeInTheDocument();
  });

  it('places the primary Render action at the bottom of the main workflow, after the workspace', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    const moduleWorkspace = screen.getByLabelText('architecture workspace');
    const renderBar = screen.getByTestId('primary-action-bar');
    expect(moduleWorkspace.contains(renderBar)).toBe(true);
    expect(within(renderBar).getByRole('button', { name: 'RENDER — PHOTOREALISTIC ARCHITECTURE' })).toBeInTheDocument();
    // BUILD 14: the Advanced Editor extends the flow after Render (it only ever
    // has something to edit once a generation exists) — Render still comes
    // before it in document order, but is no longer the literal last child.
    const editPanel = screen.getByRole('heading', { name: 'Edit' }).closest('section')!;
    expect(renderBar.compareDocumentPosition(editPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render a permanent wide AI Analysis Panel — the right-side Inspector is collapsed by default', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.queryByText(/AI Analysis/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('data-open', 'false');
  });

  it('defaults the canvas to a portrait presentation', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.getByLabelText('Canvas')).toHaveAttribute('data-aspect-ratio', '2:3');
  });

  it('embeds no fake sample image or fabricated generated output anywhere in the tree', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes keyboard-accessible controls (nav links, upload dropzone, primary action)', async () => {
    window.history.pushState({}, '', '/architecture');
    await renderApp();
    expect(screen.getByRole('link', { name: 'Architecture' })).toBeVisible();
    expect(screen.getByRole('button', { name: /drop a viewport image/i })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('button', { name: 'RENDER — PHOTOREALISTIC ARCHITECTURE' })).toBeInTheDocument();
  });

  it('renders the Project/Workspace placeholder route without fabricating project data', async () => {
    window.history.pushState({}, '', '/project/p1');
    await renderApp();
    expect(screen.getByText('Project workspace foundation')).toBeInTheDocument();
  });
});
