/**
 * Phase 0 Security Test Specification for RBAC, Auth, PO, ClientInvoice, Roles, Users & Audit Logs
 * Verifies adversarial payloads against firestore.rules.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  expectedResult: 'PERMISSION_DENIED';
  description: string;
  payload?: Record<string, unknown>;
}

export const DIRTY_DOZEN_SCENARIOS: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Unauthenticated Read/Write Blocked',
    operation: 'list',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Attempting to read or write /po_kkb without Firebase Auth.',
  },
  {
    id: 2,
    name: 'Deactivated User Blocked',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'User whose /users_kkb/{uid}.active == false attempting to create a PO.',
  },
  {
    id: 3,
    name: 'Self Privilege Escalation',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'User attempting to change their own roleId to super_admin in /users_kkb/{uid}.',
    payload: { roleId: 'super_admin' },
  },
  {
    id: 4,
    name: 'Viewer Write Denial',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Viewer role (create_po: false) attempting to create a PO.',
    payload: { poNumber: '999/PO-KKB/2026' },
  },
  {
    id: 5,
    name: 'Unauthorized Paid Revision',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'User with revise_paid: false attempting to revise a Paid PO.',
    payload: { status: 'Invoiced' },
  },
  {
    id: 6,
    name: 'Unauthorized Permanent Delete',
    operation: 'delete',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Admin/Finance user (permanent_delete_po: false) attempting hard delete on /po_kkb/{poId}.',
  },
  {
    id: 7,
    name: 'Unauthorized Role Permission Tampering',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    description: 'User with manage_roles: false attempting to grant themselves manage_users on /roles_kkb.',
    payload: { permissions: { manage_users: true } },
  },
  {
    id: 8,
    name: 'Audit Log Spoofing or Deletion',
    operation: 'delete',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Attempting to delete or mutate an immutable entry in /audit_logs_kkb/{logId}, or forge actorUid.',
    payload: { actorUid: 'someone_else_uid' },
  },
  {
    id: 9,
    name: 'User PII Cross-Read Prevention',
    operation: 'get',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Non-admin user (manage_users: false) attempting to read /users_kkb/{otherUid}.',
  },
  {
    id: 10,
    name: 'Shadow / Ghost Field Injection',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Injecting undocumented field isApproved=true in create payload.',
    payload: { poNumber: '001/PO-KKB/2026', isApproved: true },
  },
  {
    id: 11,
    name: 'Bootstrap Replay Attack',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Attempting to overwrite /app_meta_kkb/bootstrap after initial setup.',
    payload: { initialized: true },
  },
  {
    id: 12,
    name: 'Client Timestamp Forgery',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    description: 'Setting createdAt to a past date instead of serverTimestamp().',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
  },
];
