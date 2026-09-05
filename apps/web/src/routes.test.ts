import { describe, expect, it } from 'vitest';
import { resolveRoute, ROUTES } from './routes.js';

describe('resolveRoute', () => {
  it('resolves the Architecture and Interior module routes', () => {
    expect(resolveRoute('/architecture')?.name).toBe('architecture');
    expect(resolveRoute('/interior')?.name).toBe('interior');
  });

  it('resolves a parameterized project workspace route', () => {
    expect(resolveRoute('/project/abc123')?.name).toBe('project');
  });

  it('returns null for an unknown path rather than guessing', () => {
    expect(resolveRoute('/nope')).toBeNull();
  });

  it('covers exactly the MVP shell sections', () => {
    expect(ROUTES.map((r) => r.name)).toEqual(['architecture', 'interior', 'project']);
  });
});
