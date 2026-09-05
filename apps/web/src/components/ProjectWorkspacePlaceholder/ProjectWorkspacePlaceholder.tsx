import { EmptyState } from '../EmptyState/EmptyState.js';

/**
 * Placeholder for the parameterized /project/:projectId route (docs/03 §8
 * Project/Workspace). Multi-project persistence and routing depend on
 * BUILD 06 (Image Ingestion) creating real Project records — this keeps the
 * route structurally present without fabricating project data.
 */
export function ProjectWorkspacePlaceholder() {
  return (
    <EmptyState
      title="Project workspace foundation"
      description="Full multi-project routing and persistence land with BUILD 06 (Image Ingestion). Use Architecture or Interior to work in the current session."
    />
  );
}
