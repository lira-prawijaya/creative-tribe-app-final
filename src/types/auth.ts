export type PermissionKey =
  | 'create_po'
  | 'edit_po_draft'
  | 'revise_invoiced'
  | 'revise_paid'
  | 'soft_delete_po'
  | 'permanent_delete_po'
  | 'send_invoice'
  | 'mark_paid'
  | 'view_reports'
  | 'manage_users'
  | 'manage_roles';

export type PermissionsMap = Record<PermissionKey, boolean>;

export const FULL_ACCESS_PERMISSIONS: PermissionsMap = {
  create_po: true,
  edit_po_draft: true,
  revise_invoiced: true,
  revise_paid: true,
  soft_delete_po: true,
  permanent_delete_po: true,
  send_invoice: true,
  mark_paid: true,
  view_reports: true,
  manage_users: false,
  manage_roles: false,
};

export interface AuditActor {
  uid: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
}

export const DEFAULT_SYSTEM_ACTOR: AuditActor = {
  uid: 'system',
  name: 'Admin KKB',
  email: 'admin@kkb.local',
  roleId: 'admin',
  roleName: 'Admin',
};

export type AuditEntityType =
  | 'PO'
  | 'CLIENT_INVOICE'
  | 'CLIENT_PO'
  | 'OPEX'
  | 'INVESTMENT'
  | 'USER'
  | 'ROLE'
  | 'REPORT'
  | 'AUTH';

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorName: string;
  actorEmail: string;
  actorRoleId: string;
  actorRoleName: string;
  action: string;
  entityType: AuditEntityType;
  entityId?: string;
  entityLabel?: string;
  amount?: number;
  summary: string;
  timestampDisplay: string;
  dateISO: string;
  createdAt?: unknown;
}

export const SUPER_ADMIN_EMAIL = 'lira@creativetribejkt.com';

export type AppMenuKey =
  | 'dashboard'
  | 'opex'
  | 'investment'
  | 'realisasi'
  | 'saldo_rekening'
  | 'project_client'
  | 'project_vendor'
  | 'log_aktivitas'
  | 'invoice';

export type AppUserRole = 'super_admin' | 'admin' | 'finance' | 'staff';

export interface AppMenuDefinition {
  key: AppMenuKey;
  label: string;
  description: string;
}

export const APP_MENU_DEFINITIONS: AppMenuDefinition[] = [
  {
    key: 'dashboard',
    label: 'Dashboard (Projection)',
    description: 'Laporan proyeksi cashflow bulanan, range periode & grafik',
  },
  {
    key: 'opex',
    label: 'Opex',
    description: 'Biaya operasional bulanan & rutin',
  },
  {
    key: 'investment',
    label: 'Investment',
    description: 'Kontrak investor, jadwal bunga & addendum',
  },
  {
    key: 'realisasi',
    label: 'Realisasi',
    description: 'Laporan realisasi cashflow berstatus Paid',
  },
  {
    key: 'saldo_rekening',
    label: 'Detail Saldo Rekening',
    description: 'Saldo awal per rekening bank',
  },
  {
    key: 'project_client',
    label: 'Project - Client',
    description: 'PO Client & monitoring piutang',
  },
  {
    key: 'project_vendor',
    label: 'Project - Vendor',
    description: 'PO Vendor & tagihan vendor',
  },
  {
    key: 'log_aktivitas',
    label: 'Log Aktivitas',
    description: 'Riwayat aktivitas & perubahan sistem',
  },
  {
    key: 'invoice',
    label: 'Invoice',
    description: 'Buat, edit, kirim, revisi & cetak Invoice Client',
  },
];

export interface MenuAccessLevel {
  canView: boolean;
  canEdit: boolean;
}

export type AppMenuPermissionsMap = Record<AppMenuKey, MenuAccessLevel>;

export interface AppUserRecord {
  id: string;
  email: string;
  nama: string;
  role: AppUserRole;
  isActive: boolean;
  lastSeenAt?: string | null;
  isOnline?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ManagedUserWithPermissions {
  user: AppUserRecord;
  permissions: AppMenuPermissionsMap;
}

export const USER_PRESENCE_TIMEOUT_MS = 2 * 60 * 1000;

export function isUserOnline(
  user: Pick<AppUserRecord, 'isActive' | 'isOnline' | 'lastSeenAt'>,
  nowMs = Date.now()
): boolean {
  if (!user.isActive) return false;
  if (!user.isOnline) return false;
  if (!user.lastSeenAt) return false;
  const seenMs = Date.parse(user.lastSeenAt);
  if (!Number.isFinite(seenMs)) return false;
  return nowMs - seenMs <= USER_PRESENCE_TIMEOUT_MS;
}

export function isSuperAdminEmail(email?: string | null): boolean {
  return (email ?? '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isSuperAdminUser(user?: Pick<AppUserRecord, 'email' | 'role'> | null): boolean {
  if (!user) return false;
  return isSuperAdminEmail(user.email) || user.role === 'super_admin';
}

export function buildSuperAdminMenuPermissions(): AppMenuPermissionsMap {
  return {
    dashboard: { canView: true, canEdit: true },
    opex: { canView: true, canEdit: true },
    investment: { canView: true, canEdit: true },
    realisasi: { canView: true, canEdit: true },
    saldo_rekening: { canView: true, canEdit: true },
    project_client: { canView: true, canEdit: true },
    project_vendor: { canView: true, canEdit: true },
    log_aktivitas: { canView: true, canEdit: true },
    invoice: { canView: true, canEdit: true },
  };
}

export function buildDefaultViewOnlyMenuPermissions(): AppMenuPermissionsMap {
  return {
    dashboard: { canView: true, canEdit: false },
    opex: { canView: true, canEdit: false },
    investment: { canView: true, canEdit: false },
    realisasi: { canView: true, canEdit: false },
    saldo_rekening: { canView: true, canEdit: false },
    project_client: { canView: true, canEdit: false },
    project_vendor: { canView: true, canEdit: false },
    log_aktivitas: { canView: true, canEdit: false },
    invoice: { canView: true, canEdit: false },
  };
}

export function buildHiddenMenuPermissions(): AppMenuPermissionsMap {
  return {
    dashboard: { canView: false, canEdit: false },
    opex: { canView: false, canEdit: false },
    investment: { canView: false, canEdit: false },
    realisasi: { canView: false, canEdit: false },
    saldo_rekening: { canView: false, canEdit: false },
    project_client: { canView: false, canEdit: false },
    project_vendor: { canView: false, canEdit: false },
    log_aktivitas: { canView: false, canEdit: false },
    invoice: { canView: false, canEdit: false },
  };
}

export function deriveClientInvoicePermissions(
  menuPermissions: AppMenuPermissionsMap,
  isSuperAdmin: boolean
): PermissionsMap {
  const canEdit = isSuperAdmin || menuPermissions.invoice.canEdit;
  const canViewDash = isSuperAdmin || menuPermissions.dashboard.canView;
  return {
    create_po: canEdit,
    edit_po_draft: canEdit,
    revise_invoiced: canEdit,
    revise_paid: canEdit,
    soft_delete_po: canEdit,
    permanent_delete_po: canEdit,
    send_invoice: canEdit,
    mark_paid: canEdit,
    view_reports: canViewDash,
    manage_users: isSuperAdmin,
    manage_roles: isSuperAdmin,
  };
}

export function deriveVendorPermissions(
  menuPermissions: AppMenuPermissionsMap,
  isSuperAdmin: boolean
): PermissionsMap {
  const canEdit = isSuperAdmin || menuPermissions.project_vendor.canEdit;
  const canViewDash = isSuperAdmin || menuPermissions.dashboard.canView;
  return {
    create_po: canEdit,
    edit_po_draft: canEdit,
    revise_invoiced: canEdit,
    revise_paid: canEdit,
    soft_delete_po: canEdit,
    permanent_delete_po: canEdit,
    send_invoice: canEdit,
    mark_paid: canEdit,
    view_reports: canViewDash,
    manage_users: isSuperAdmin,
    manage_roles: isSuperAdmin,
  };
}

