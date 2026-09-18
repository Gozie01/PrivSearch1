// ─────────────────────────────────────────────────────────────
// RBAC — Role-Based Access Control
//
// Roles are coarse-grained (7 types).
// Permissions are fine-grained strings following the convention:
//   <resource>:<action>[:<scope>]
// ─────────────────────────────────────────────────────────────

export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'PHYSICIAN'
  | 'NURSE'
  | 'PATIENT'
  | 'AUDITOR'
  | 'RESEARCHER'
  | 'SYSTEM';

export type Permission =
  | 'records:create'
  | 'records:read:own'
  | 'records:read:all'
  | 'records:update'
  | 'records:delete:soft'
  | 'records:delete:hard'
  | 'files:upload'
  | 'files:download:own'
  | 'files:download:all'
  | 'files:delete'
  | 'audit:read'
  | 'audit:export'
  | 'blockchain:read'
  | 'admin:users'
  | 'admin:validators'
  | 'system:bypass';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    'records:create',
    'records:read:own',
    'records:read:all',
    'records:update',
    'records:delete:soft',
    'records:delete:hard',
    'files:upload',
    'files:download:own',
    'files:download:all',
    'files:delete',
    'audit:read',
    'audit:export',
    'blockchain:read',
    'admin:users',
    'admin:validators',
    'system:bypass',
  ],

  ADMIN: [
    'records:create',
    'records:read:all',
    'records:update',
    'records:delete:soft',
    'files:upload',
    'files:download:all',
    'files:delete',
    'audit:read',
    'audit:export',
    'blockchain:read',
    'admin:users',
  ],

  PHYSICIAN: [
    'records:create',
    'records:read:own',
    'records:read:all',
    'records:update',
    'records:delete:soft',
    'files:upload',
    'files:download:all',
    'audit:read',
    'blockchain:read',
  ],

  NURSE: [
    'records:create',
    'records:read:all',
    'records:update',
    'files:upload',
    'files:download:all',
    'audit:read',
  ],

  PATIENT: [
    'records:read:own',
    'files:download:own',
    'audit:read',
  ],

  AUDITOR: [
    'records:read:all',
    'files:download:all',
    'audit:read',
    'audit:export',
    'blockchain:read',
  ],

  RESEARCHER: [
    // Data access is read-only and anonymisation is enforced in the query layer
    'records:read:all',
    'audit:read',
    'blockchain:read',
  ],

  SYSTEM: [
    'records:create',
    'records:read:own',
    'records:read:all',
    'records:update',
    'records:delete:soft',
    'files:upload',
    'files:download:all',
    'files:delete',
    'audit:read',
    'blockchain:read',
    'system:bypass',
  ],
};

// ── Public helpers ────────────────────────────────────────────

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Throws an `Error` if the role lacks the required permission */
export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw Object.assign(
      new Error(`Role '${role}' does not have permission '${permission}'`),
      { code: 'PERMISSION_DENIED', statusCode: 403 },
    );
  }
}

export function getPermissions(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

// ── Principal (authenticated actor) ──────────────────────────

export interface Principal {
  /** Decentralised Identifier of the actor */
  did: string;
  role: Role;
  sessionId?: string;
}
