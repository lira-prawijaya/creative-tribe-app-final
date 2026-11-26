import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import {
  createManagedUser,
  deleteManagedUser,
  listManagedUsersWithPermissions,
  saveManagedUserPermissions,
  sendUserPasswordReset,
  updateManagedUserProfile,
} from '../services/authService';
import {
  APP_MENU_DEFINITIONS,
  AppMenuKey,
  AppMenuPermissionsMap,
  AppUserRecord,
  AppUserRole,
  AuditActor,
  buildDefaultViewOnlyMenuPermissions,
  buildHiddenMenuPermissions,
  buildSuperAdminMenuPermissions,
  isSuperAdminEmail,
  isUserOnline,
  ManagedUserWithPermissions,
} from '../types/auth';

interface UserManagementViewProps {
  currentActor: AuditActor;
  onLogActivity?: (params: {
    action: string;
    entityType: 'USER' | 'ROLE';
    entityId: string;
    entityLabel: string;
    summary: string;
  }) => void;
  onPermissionsUpdated?: () => Promise<void> | void;
}

type AccessMode = 'hidden' | 'view' | 'edit';

function getAccessMode(perms: AppMenuPermissionsMap, key: AppMenuKey): AccessMode {
  const entry = perms[key];
  if (!entry || !entry.canView) return 'hidden';
  return entry.canEdit ? 'edit' : 'view';
}

function setAccessMode(
  perms: AppMenuPermissionsMap,
  key: AppMenuKey,
  mode: AccessMode
): AppMenuPermissionsMap {
  return {
    ...perms,
    [key]:
      mode === 'hidden'
        ? { canView: false, canEdit: false }
        : mode === 'view'
        ? { canView: true, canEdit: false }
        : { canView: true, canEdit: true },
  };
}

function buildFinancePresetPermissions(): AppMenuPermissionsMap {
  return {
    dashboard: { canView: true, canEdit: false },
    opex: { canView: true, canEdit: true },
    investment: { canView: true, canEdit: false },
    realisasi: { canView: true, canEdit: false },
    saldo_rekening: { canView: true, canEdit: false },
    project_client: { canView: true, canEdit: true },
    project_vendor: { canView: true, canEdit: true },
    log_aktivitas: { canView: true, canEdit: false },
    invoice: { canView: true, canEdit: true },
  };
}

const MONTHS_SHORT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function formatPresenceDateTime(isoDate: string): string {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return '-';
  const day = String(dt.getDate()).padStart(2, '0');
  const month = MONTHS_SHORT_ID[dt.getMonth()] ?? '';
  const year = dt.getFullYear();
  const hours = String(dt.getHours()).padStart(2, '0');
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

function formatLastSeenSubtitle(
  lastSeenAt: string | null | undefined,
  online: boolean,
  nowMs: number,
  isSelf = false
): string {
  if (isSelf) {
    return 'Terakhir aktif: Baru saja';
  }
  if (!lastSeenAt) return '';
  const seenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(seenMs)) return '';
  const diffMs = Math.max(0, nowMs - seenMs);
  const diffMin = Math.floor(diffMs / 60_000);
  if (online) {
    return diffMin < 1
      ? 'Terakhir aktif: Baru saja'
      : `Terakhir aktif: ${diffMin} menit lalu`;
  }
  if (diffMin < 1) return 'Terakhir aktif: Baru saja';
  if (diffMin < 60) {
    return `Terakhir aktif: ${diffMin} menit lalu (${formatPresenceDateTime(lastSeenAt)})`;
  }
  return `Terakhir aktif: ${formatPresenceDateTime(lastSeenAt)}`;
}

type PresenceFilter = 'all' | 'online' | 'offline';

const ROLE_LABELS: Record<AppUserRole, { label: string; badgeClass: string }> = {
  super_admin: {
    label: 'Super Admin',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  admin: {
    label: 'Admin',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  finance: {
    label: 'Finance',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  staff: {
    label: 'Staff',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentActor,
  onLogActivity,
  onPermissionsUpdated,
}) => {
  const [users, setUsers] = useState<ManagedUserWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Create User Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newNama, setNewNama] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState<Exclude<AppUserRole, 'super_admin'>>('staff');
  const [newPermissions, setNewPermissions] = useState<AppMenuPermissionsMap>(() =>
    buildDefaultViewOnlyMenuPermissions()
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit User & Permissions Modal State
  const [editingEntry, setEditingEntry] = useState<ManagedUserWithPermissions | null>(null);
  const [editNama, setEditNama] = useState('');
  const [editRole, setEditRole] = useState<Exclude<AppUserRole, 'super_admin'>>('staff');
  const [editPermissions, setEditPermissions] = useState<AppMenuPermissionsMap>(() =>
    buildDefaultViewOnlyMenuPermissions()
  );
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Confirm Delete Modal State
  const [deleteTarget, setDeleteTarget] = useState<ManagedUserWithPermissions | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(async (options?: { silent?: boolean }) => {
    const isSilent = Boolean(options?.silent);
    if (!isSilent) {
      setLoading(true);
      setErrorMsg(null);
    }
    try {
      const list = await listManagedUsersWithPermissions();
      setUsers(list);
      setNowMs(Date.now());
    } catch (err) {
      if (!isSilent) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Gagal memuat daftar user dari Supabase.'
        );
      }
    } finally {
      if (!isSilent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
      void loadUsers({ silent: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadUsers]);

  const isCurrentLoggedInUser = useCallback(
    (user: Pick<AppUserRecord, 'id' | 'email'>): boolean => {
      const actorEmail = currentActor.email.trim().toLowerCase();
      const rowEmail = user.email.trim().toLowerCase();
      if (actorEmail && rowEmail && actorEmail === rowEmail) return true;
      if (currentActor.uid && user.id && currentActor.uid === user.id) return true;
      return false;
    },
    [currentActor.email, currentActor.uid]
  );

  const isEffectiveOnline = useCallback(
    (user: AppUserRecord): boolean => {
      if (isCurrentLoggedInUser(user)) return true;
      return isUserOnline(user, nowMs);
    },
    [isCurrentLoggedInUser, nowMs]
  );

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.user.isActive).length;
    const inactive = total - active;
    const online = users.filter((u) => isEffectiveOnline(u.user)).length;
    const offline = total - online;
    return { total, active, inactive, online, offline };
  }, [users, isEffectiveOnline]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter(({ user }) => {
      const online = isEffectiveOnline(user);
      if (presenceFilter === 'online' && !online) return false;
      if (presenceFilter === 'offline' && online) return false;
      if (!q) return true;
      return (
        user.nama.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.role.toLowerCase().includes(q)
      );
    });
  }, [users, searchQuery, presenceFilter, isEffectiveOnline]);

  const openCreateModal = () => {
    setNewNama('');
    setNewEmail('');
    setNewPassword('');
    setShowNewPassword(false);
    setNewRole('staff');
    setNewPermissions(buildDefaultViewOnlyMenuPermissions());
    setCreateError(null);
    setShowCreateModal(true);
  };

  const handleRolePresetChange = (
    nextRole: Exclude<AppUserRole, 'super_admin'>,
    setter: React.Dispatch<React.SetStateAction<AppMenuPermissionsMap>>
  ) => {
    if (nextRole === 'staff') {
      setter(buildDefaultViewOnlyMenuPermissions());
    } else if (nextRole === 'finance') {
      setter(buildFinancePresetPermissions());
    } else if (nextRole === 'admin') {
      setter(buildSuperAdminMenuPermissions());
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await createManagedUser({
        nama: newNama,
        email: newEmail,
        password: newPassword,
        role: newRole,
        permissions: newPermissions,
      });

      onLogActivity?.({
        action: 'CREATE_USER',
        entityType: 'USER',
        entityId: res.user.id,
        entityLabel: res.user.email,
        summary: `Menambah user baru ${res.user.nama} (${res.user.email}) dengan role ${res.user.role}`,
      });

      setShowCreateModal(false);
      setFeedbackMsg(
        res.needsEmailConfirm
          ? `User ${res.user.nama} (${res.user.email}) dibuat. Pastikan user mengonfirmasi email atau matikan Confirm email di Supabase Auth.`
          : `User baru ${res.user.nama} (${res.user.email}) berhasil ditambahkan dan siap login.`
      );
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Gagal menambah user baru.');
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (entry: ManagedUserWithPermissions) => {
    setEditingEntry(entry);
    setEditNama(entry.user.nama);
    setEditRole(entry.user.role === 'super_admin' ? 'admin' : entry.user.role);
    setEditPermissions({ ...entry.permissions });
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    setEditError(null);
    setSavingEdit(true);
    try {
      const targetIsSuper = isSuperAdminEmail(editingEntry.user.email);
      if (!targetIsSuper) {
        await updateManagedUserProfile(editingEntry.user.id, {
          nama: editNama.trim() || editingEntry.user.nama,
          role: editRole,
        });
        await saveManagedUserPermissions(editingEntry.user.id, editPermissions);
      }

      onLogActivity?.({
        action: 'UPDATE_USER_PERMISSIONS',
        entityType: 'USER',
        entityId: editingEntry.user.id,
        entityLabel: editingEntry.user.email,
        summary: `Memperbarui profil, role (${targetIsSuper ? 'super_admin' : editRole}), & hak akses menu untuk ${
          editNama.trim() || editingEntry.user.nama
        } (${editingEntry.user.email})`,
      });

      setEditingEntry(null);
      setFeedbackMsg(`Hak akses untuk ${editingEntry.user.email} berhasil diperbarui.`);
      await loadUsers();
      await onPermissionsUpdated?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Gagal menyimpan hak akses user.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (entry: ManagedUserWithPermissions) => {
    if (isSuperAdminEmail(entry.user.email)) return;
    setErrorMsg(null);
    setFeedbackMsg(null);
    setBusyUserId(entry.user.id);
    const nextActive = !entry.user.isActive;
    try {
      await updateManagedUserProfile(entry.user.id, { isActive: nextActive });
      onLogActivity?.({
        action: nextActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        entityType: 'USER',
        entityId: entry.user.id,
        entityLabel: entry.user.email,
        summary: `${nextActive ? 'Mengaktifkan' : 'Menonaktifkan'} user ${entry.user.nama} (${entry.user.email})`,
      });
      setFeedbackMsg(
        `User ${entry.user.email} berhasil ${nextActive ? 'diaktifkan kembali' : 'dinonaktifkan'}.`
      );
      await loadUsers();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengubah status aktif user.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (entry: ManagedUserWithPermissions) => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    setBusyUserId(entry.user.id);
    try {
      await sendUserPasswordReset(entry.user.email);
      onLogActivity?.({
        action: 'RESET_PASSWORD_USER',
        entityType: 'USER',
        entityId: entry.user.id,
        entityLabel: entry.user.email,
        summary: `Mengirim link reset password ke ${entry.user.email}`,
      });
      setFeedbackMsg(
        `Email reset password telah dikirim ke ${entry.user.email} via Supabase Auth.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengirim reset password.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await deleteManagedUser(deleteTarget.user.id);
      onLogActivity?.({
        action: 'DELETE_USER',
        entityType: 'USER',
        entityId: deleteTarget.user.id,
        entityLabel: deleteTarget.user.email,
        summary: `Menghapus user ${deleteTarget.user.nama} (${deleteTarget.user.email})`,
      });
      setFeedbackMsg(`User ${deleteTarget.user.email} berhasil dihapus.`);
      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus user.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const renderPermissionMatrix = (
    perms: AppMenuPermissionsMap,
    onChange: React.Dispatch<React.SetStateAction<AppMenuPermissionsMap>>,
    disabled = false
  ) => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-800">
          Matriks Hak Akses Per Menu (9 Menu)
        </span>
        {!disabled && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChange(buildHiddenMenuPermissions())}
              className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
            >
              Semua Hidden
            </button>
            <button
              type="button"
              onClick={() => onChange(buildDefaultViewOnlyMenuPermissions())}
              className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
            >
              Semua Hanya Lihat
            </button>
            <button
              type="button"
              onClick={() => onChange(buildFinancePresetPermissions())}
              className="px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded cursor-pointer"
            >
              Preset Finance
            </button>
            <button
              type="button"
              onClick={() => onChange(buildSuperAdminMenuPermissions())}
              className="px-2 py-1 text-[11px] font-medium text-slate-900 bg-slate-200 hover:bg-slate-300 rounded cursor-pointer"
            >
              Semua Bisa Edit
            </button>
          </div>
        )}
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
        {APP_MENU_DEFINITIONS.map((def) => {
          const mode = getAccessMode(perms, def.key);
          return (
            <div
              key={def.key}
              className="px-3.5 py-2.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900">{def.label}</p>
                <p className="text-[11px] text-slate-500">{def.description}</p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 shrink-0">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange((prev) => setAccessMode(prev, def.key, 'hidden'))}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed ${
                    mode === 'hidden'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hidden
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange((prev) => setAccessMode(prev, def.key, 'view'))}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed ${
                    mode === 'view'
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hanya Lihat
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange((prev) => setAccessMode(prev, def.key, 'edit'))}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed ${
                    mode === 'edit'
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bisa Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Top Info & KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Akun Terdaftar</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {stats.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Akun Aktif</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {stats.active}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Akun Dinonaktifkan</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-rose-700 mt-1">
            {stats.inactive}
          </p>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {feedbackMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{feedbackMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* User List Card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, email, atau role user..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadUsers()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Tambah User Baru
            </button>
          </div>
        </div>

        {/* Presence Summary & Filter Bar */}
        <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="inline-flex items-center gap-2 text-xs text-slate-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" />
            <span className="tabular-nums">
              <strong className="font-semibold text-slate-900">{stats.online} Online</strong> dari{' '}
              <strong className="font-semibold text-slate-900">{stats.total} User</strong>
            </span>
          </div>

          <div
            role="group"
            aria-label="Filter kehadiran user"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 self-start sm:self-auto"
          >
            <button
              type="button"
              onClick={() => setPresenceFilter('all')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                presenceFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              Semua ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setPresenceFilter('online')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                presenceFilter === 'online'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  presenceFilter === 'online' ? 'bg-emerald-200' : 'bg-emerald-500'
                }`}
              />
              Online Saja ({stats.online})
            </button>
            <button
              type="button"
              onClick={() => setPresenceFilter('offline')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                presenceFilter === 'offline'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  presenceFilter === 'offline' ? 'bg-slate-300' : 'bg-slate-400'
                }`}
              />
              Offline Saja ({stats.offline})
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-12 px-6 text-center text-xs text-slate-500">
            Tidak ada user ditemukan.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Nama &amp; Email</th>
                  <th className="py-3 px-4 whitespace-nowrap">Role</th>
                  <th className="py-3 px-4 whitespace-nowrap">Status</th>
                  <th className="py-3 px-4 whitespace-nowrap">Kehadiran</th>
                  <th className="py-3 px-4">Ringkasan Hak Akses Menu</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredUsers.map((entry) => {
                  const { user, permissions } = entry;
                  const isSuper = isSuperAdminEmail(user.email);
                  const roleMeta = ROLE_LABELS[user.role];
                  const isBusy = busyUserId === user.id;
                  const isSelf = isCurrentLoggedInUser(user);
                  const online = isSelf || isUserOnline(user, nowMs);
                  const lastSeenText = formatLastSeenSubtitle(
                    user.lastSeenAt,
                    online,
                    nowMs,
                    isSelf
                  );

                  let editCount = 0;
                  let viewCount = 0;
                  let hiddenCount = 0;
                  for (const def of APP_MENU_DEFINITIONS) {
                    const mode = getAccessMode(permissions, def.key);
                    if (mode === 'edit') editCount += 1;
                    else if (mode === 'view') viewCount += 1;
                    else hiddenCount += 1;
                  }

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{user.nama}</span>
                          {isSuper && (
                            <span title="Super Admin Utama" className="inline-flex shrink-0">
                              <ShieldCheck className="w-4 h-4 text-purple-600" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5">{user.email}</div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold border rounded ${roleMeta.badgeClass}`}
                        >
                          <Shield className="w-3 h-3" />
                          {roleMeta.label}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold border rounded ${
                            user.isActive
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-rose-50 text-rose-800 border-rose-200'
                          }`}
                        >
                          {user.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        {!isSelf && !user.lastSeenAt && !online ? (
                          <div className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                            <span className="text-xs font-medium text-slate-600">
                              Offline - Belum pernah login
                            </span>
                          </div>
                        ) : (
                          <div>
                            <div className="inline-flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  online ? 'bg-emerald-500' : 'bg-slate-400'
                                }`}
                              />
                              <span
                                className={`text-xs font-semibold ${
                                  online ? 'text-emerald-700' : 'text-slate-600'
                                }`}
                              >
                                {online ? 'Online' : 'Offline'}
                              </span>
                            </div>
                            {lastSeenText && (
                              <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                                {lastSeenText}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {isSuper ? (
                          <span className="text-xs font-medium text-purple-800">
                            Semua 9 Menu: Lihat + Edit + Hapus + Manajemen User
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                              {editCount} Bisa Edit
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                              {viewCount} Hanya Lihat
                            </span>
                            {hiddenCount > 0 && (
                              <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-semibold">
                                {hiddenCount} Hidden
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {!isSuper && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => openEditModal(entry)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Hak Akses
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleResetPassword(entry)}
                            title="Kirim email reset password via Supabase Auth"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Reset Password
                          </button>

                          {!isSuper && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleActive(entry)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border rounded-lg cursor-pointer ${
                                user.isActive
                                  ? 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100'
                                  : 'text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                              }`}
                            >
                              {user.isActive ? (
                                <>
                                  <UserX className="w-3.5 h-3.5" />
                                  Nonaktifkan
                                </>
                              ) : (
                                <>
                                  <UserCheck className="w-3.5 h-3.5" />
                                  Aktifkan
                                </>
                              )}
                            </button>
                          )}

                          {!isSuper && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setDeleteTarget(entry)}
                              title="Hapus user"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Tambah User Baru */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">Tambah User Baru</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateSubmit(e)} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              {createError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap *
                  </label>
                  <input
                    type="text"
                    required
                    value={newNama}
                    onChange={(e) => setNewNama(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Login *
                  </label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="budi@creativetribejkt.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password Awal (min. 6 karakter) *
                  </label>
                  <div className="relative">
                    <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimal 6 karakter"
                      className="w-full pl-8 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((p) => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {showNewPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Role *
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => {
                      const next = e.target.value as Exclude<AppUserRole, 'super_admin'>;
                      setNewRole(next);
                      handleRolePresetChange(next, setNewPermissions);
                    }}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="staff">Staff (Default Hanya Lihat)</option>
                    <option value="finance">Finance (Edit Opex &amp; Project)</option>
                    <option value="admin">Admin (Edit Semua Menu)</option>
                  </select>
                </div>
              </div>

              {renderPermissionMatrix(newPermissions, setNewPermissions)}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {creating ? 'Mendaftarkan...' : 'Simpan User Baru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit User & Hak Akses */}
      {editingEntry && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Atur Role &amp; Hak Akses — {editingEntry.user.nama}
                </h3>
                <p className="text-xs font-mono text-slate-500">{editingEntry.user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveEdit(e)} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              {editError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    required
                    value={editNama}
                    onChange={(e) => setEditNama(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Role
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) =>
                      setEditRole(e.target.value as Exclude<AppUserRole, 'super_admin'>)
                    }
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="staff">Staff</option>
                    <option value="finance">Finance</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              {renderPermissionMatrix(editPermissions, setEditPermissions)}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Hak Akses'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus User */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-50 text-red-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Hapus Akun User?</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Akun <span className="font-semibold text-slate-900">{deleteTarget.user.nama}</span> (
                  <span className="font-mono">{deleteTarget.user.email}</span>) akan dihapus dari{' '}
                  <code className="font-mono">app_users</code> dan{' '}
                  <code className="font-mono">app_permissions</code>.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
