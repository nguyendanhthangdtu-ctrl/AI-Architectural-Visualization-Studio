/**
 * Minimum application shell/routing — docs/02_UX_SPECIFICATION.md Navigation,
 * scoped to the MVP sections (Architecture, Interior, Project/workspace).
 * This is a typed route table only, not rendered UI — no rendering framework
 * has been selected (that is a BUILD 03 decision); building the full
 * navigation/canvas/control-area UI now would be premature (rule 11).
 */
export type RouteName = 'architecture' | 'interior' | 'project';

export interface Route {
  name: RouteName;
  path: string;
  label: string;
}

export const ROUTES: readonly Route[] = [
  { name: 'architecture', path: '/architecture', label: 'Architecture' },
  { name: 'interior', path: '/interior', label: 'Interior' },
  { name: 'project', path: '/project/:projectId', label: 'Project / Workspace' },
];

export function resolveRoute(path: string): Route | null {
  for (const route of ROUTES) {
    const pattern = new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}$`);
    if (pattern.test(path)) return route;
  }
  return null;
}
