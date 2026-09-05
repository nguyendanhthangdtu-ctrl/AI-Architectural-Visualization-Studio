import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from './App.js';

/**
 * Integration-level smoke test covering the BUILD 03 acceptance list
 * (docs/19 gate protocol). Component-level behavior is covered by each
 * component's own test file; this proves the assembled shell.
 */
describe('App (BUILD 03 UI/UX Foundation)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('starts and renders the main application shell — header, navigation, and routed content', () => {
    render(<App />);
    expect(screen.getByText('AI Architectural Visualization Studio')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeInTheDocument();
  });

  it('renders the Architecture and Interior module entry points on the landing view', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Architecture/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Interior/i })).toBeInTheDocument();
  });

  it('navigates into the Architecture workspace and renders its distinct module boundary', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.getByLabelText('architecture workspace')).toBeInTheDocument();
  });

  it('navigates into the Interior workspace and renders its distinct module boundary', () => {
    window.history.pushState({}, '', '/interior');
    render(<App />);
    expect(screen.getByLabelText('interior workspace')).toBeInTheDocument();
  });

  it('renders the upload dropzone foundation inside the module workspace', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.getByRole('button', { name: /drop a viewport image/i })).toBeInTheDocument();
  });

  it('renders Prompt From Image directly above the Prompt Editor', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    const promptFromImage = screen.getByText('Dò prompt từ ảnh').closest('section')!;
    const promptEditor = screen.getByLabelText('Prompt editor').closest('section')!;
    expect(promptFromImage.compareDocumentPosition(promptEditor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the Locks section with correct (honest) state representation', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.getByText('Locks become available after analysis')).toBeInTheDocument();
  });

  it('places the primary Render action at the bottom of the main workflow, after the workspace', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    const moduleWorkspace = screen.getByLabelText('architecture workspace');
    const renderBar = screen.getByTestId('primary-action-bar');
    expect(moduleWorkspace.contains(renderBar)).toBe(true);
    expect(within(renderBar).getByRole('button', { name: 'Render' })).toBeInTheDocument();
    // BUILD 14: the Advanced Editor extends the flow after Render (it only ever
    // has something to edit once a generation exists) — Render still comes
    // before it in document order, but is no longer the literal last child.
    const editPanel = screen.getByRole('heading', { name: 'Edit' }).closest('section')!;
    expect(renderBar.compareDocumentPosition(editPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render a permanent wide AI Analysis Panel — the right-side Inspector is collapsed by default', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.queryByText(/AI Analysis/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Inspector')).toHaveAttribute('data-open', 'false');
  });

  it('defaults the canvas to a portrait presentation', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.getByLabelText('Canvas')).toHaveAttribute('data-aspect-ratio', '2:3');
  });

  it('embeds no fake sample image or fabricated generated output anywhere in the tree', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes keyboard-accessible controls (nav links, upload dropzone, primary action)', () => {
    window.history.pushState({}, '', '/architecture');
    render(<App />);
    expect(screen.getByRole('link', { name: 'Architecture' })).toBeVisible();
    expect(screen.getByRole('button', { name: /drop a viewport image/i })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('button', { name: 'Render' })).toBeInTheDocument();
  });

  it('renders the Project/Workspace placeholder route without fabricating project data', () => {
    window.history.pushState({}, '', '/project/p1');
    render(<App />);
    expect(screen.getByText('Project workspace foundation')).toBeInTheDocument();
  });
});
