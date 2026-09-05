import type { ProjectId, Timestamp, UserId } from '@avs/shared';

export type ProjectModule = 'architecture' | 'interior';
export type ProjectStatus = 'draft' | 'active' | 'archived';

export interface Project {
  id: ProjectId;
  /** RELEASE 02 — real ownership, enforced server-side on every project-scoped route; never trusts a client-supplied user id (docs/16 authorization). */
  ownerId: UserId;
  name: string;
  module: ProjectModule;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: ProjectStatus;
  currentVersionId: string;
}

/** Per-object permission — docs/05 layer 9. Not a Lock (docs/04 Constraints). */
export type ObjectPermissionAction = 'keep' | 'edit' | 'replace' | 'add';

export interface ObjectPermission {
  objectId: string;
  action: ObjectPermissionAction;
}
