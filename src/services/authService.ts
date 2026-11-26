import { User } from '@supabase/supabase-js';
import {
  createEphemeralSupabaseClient,
  extractSupabaseErrorMessage,
  invalidateSupabaseTableSchema,
  isSupabaseConfigured,
  requireSupabaseClient,
} from '../lib/supabaseClient';
import {
  extractMissingColumnFromError,
  getObservedTableColumns,
  isMissingColumnSupabaseError,
  recordObservedTableColumns,
  removeObservedTableColumn,
  resolveTableWhitelistSchema,
} from '../lib/supabaseWhitelist';
import {
  APP_MENU_DEFINITIONS,
  AppMenuKey,
  AppMenuPermissionsMap,
  AppUserRecord,
  AppUserRole,
  buildDefaultViewOnlyMenuPermissions,
  buildSuperAdminMenuPermissions,
  isSuperAdminEmail,
  isSuperAdminUser,
  ManagedUserWithPermissions,
  SUPER_ADMIN_EMAIL,
  USER_PRESENCE_TIMEOUT_MS,
} from '../types/auth';

const APP_USERS_TABLE = 'app_users';
const APP_PERMISSIONS_TABLE = 'app_permissions';
const AUTH_SESSION_STORAGE_KEY = 'kkb_auth_session_meta';
const SUPER_ADMIN_INITIAL_PASSWORD = 'Admin123!';

export interface AuthenticatedSessionState {
  user: AppUserRecord;
  permissions: AppMenuPermissionsMap;
  isSuperAdmin: boolean;
}

function normalizeRole(raw: unknown, email: string): AppUserRole {
  if (isSuperAdminEmail(email)) return 'super_admin';
  const val = String(raw ?? '').trim().toLowerCase();
  if (val === 'super_admin' || val === 'admin' || val === 'finance' || val === 'staff') {
    return val;
  }
  return 'staff';
}

function mapAppUserRow(row: Record<string, unknown>): AppUserRecord {
  const email = String(row.email ?? '').trim().toLowerCase();
  const rawLastSeen = row.last_seen_at ?? row.lastSeenAt;
  const lastSeenAt =
    typeof rawLastSeen === 'string' && rawLastSeen.trim() ? rawLastSeen.trim() : null;
  const rawOnline = row.is_online ?? row.isOnline;
  return {
    id: String(row.id ?? ''),
    email,
    nama: String(row.nama ?? '').trim() || email.split('@')[0] || 'User',
    role: normalizeRole(row.role, email),
    isActive: row.is_active !== false,
    lastSeenAt,
    isOnline: rawOnline === true,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapPermissionsRows(
  rows: Array<Record<string, unknown>>,
  fallbackToViewOnly: boolean
): AppMenuPermissionsMap {
  const result = buildDefaultViewOnlyMenuPermissions();

  if (rows.length === 0) {
    return result;
  }

  const byKey = new Map<AppMenuKey, { canView: boolean; canEdit: boolean }>();
  for (const row of rows) {
    const key = String(row.menu_key ?? '') as AppMenuKey;
    if (APP_MENU_DEFINITIONS.some((m) => m.key === key)) {
      const canEdit = Boolean(row.can_edit);
      const canView = canEdit ? true : Boolean(row.can_view);
      byKey.set(key, { canView, canEdit });
    }
  }

  for (const def of APP_MENU_DEFINITIONS) {
    const found = byKey.get(def.key);
    if (found) {
      result[def.key] = found;
    } else if (!fallbackToViewOnly) {
      result[def.key] = { canView: false, canEdit: false };
    } else {
      result[def.key] = { canView: true, canEdit: false };
    }
  }

  return result;
}

function persistLocalSessionMeta(state: AuthenticatedSessionState | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!state) {
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      AUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        id: state.user.id,
        email: state.user.email,
        nama: state.user.nama,
        role: state.user.role,
        isSuperAdmin: state.isSuperAdmin,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Abaikan error localStorage quota/mode private
  }
}

const APP_USERS_CORE_COLUMNS = new Set([
  'id',
  'email',
  'nama',
  'role',
  'is_active',
]);

const APP_PERMISSIONS_CORE_COLUMNS = new Set([
  'user_id',
  'menu_key',
  'can_view',
  'can_edit',
]);

function filterRowColumnsForWrite(
  row: Record<string, unknown>,
  allowedColumns: ReadonlySet<string>,
  excludedColumns: ReadonlySet<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (excludedColumns.has(key)) continue;
    if (!allowedColumns.has(key)) continue;
    out[key] = value;
  }
  return out;
}

async function resolveAllowedWriteColumns(
  tableName: string,
  coreColumns: ReadonlySet<string>
): Promise<Set<string>> {
  const schema = await resolveTableWhitelistSchema(tableName);
  if (schema && schema.columns.size > 0) {
    return new Set(schema.columns.keys());
  }
  return new Set(coreColumns);
}

async function executeTableWriteWithFallback<T>(params: {
  tableName: string;
  coreColumns: ReadonlySet<string>;
  rows: Record<string, unknown>[];
  execute: (
    filteredRows: Record<string, unknown>[]
  ) => PromiseLike<{ data: T; error: unknown }>;
}): Promise<{ data: T; error: unknown }> {
  const { tableName, coreColumns, rows, execute } = params;
  const excluded = new Set<string>();
  let allowed = await resolveAllowedWriteColumns(tableName, coreColumns);

  let currentRows = rows.map((row) => filterRowColumnsForWrite(row, allowed, excluded));
  let result = await execute(currentRows);

  for (let attempt = 0; attempt < 6 && result.error; attempt += 1) {
    if (!isMissingColumnSupabaseError(result.error)) {
      break;
    }

    invalidateSupabaseTableSchema(tableName);
    const missingCol = extractMissingColumnFromError(result.error) ?? 'updated_at';
    if (excluded.has(missingCol)) {
      break;
    }

    excluded.add(missingCol);
    removeObservedTableColumn(tableName, missingCol);
    allowed = new Set(Array.from(allowed).filter((col) => !excluded.has(col)));
    currentRows = rows.map((row) => filterRowColumnsForWrite(row, allowed, excluded));

    if (currentRows.every((r) => Object.keys(r).length === 0)) {
      return { data: null as T, error: null };
    }

    result = await execute(currentRows);
  }

  return result;
}

async function upsertUserPermissionsRows(
  userId: string,
  permissions: AppMenuPermissionsMap
): Promise<void> {
  const client = requireSupabaseClient();
  const nowIso = new Date().toISOString();
  const rawPayload = APP_MENU_DEFINITIONS.map((def) => {
    const entry = permissions[def.key] ?? { canView: true, canEdit: false };
    return {
      user_id: userId,
      menu_key: def.key,
      can_view: entry.canEdit ? true : Boolean(entry.canView),
      can_edit: Boolean(entry.canEdit),
      updated_at: nowIso,
    };
  });

  const { error } = await executeTableWriteWithFallback({
    tableName: APP_PERMISSIONS_TABLE,
    coreColumns: APP_PERMISSIONS_CORE_COLUMNS,
    rows: rawPayload,
    execute: (filteredRows) =>
      client
        .from(APP_PERMISSIONS_TABLE)
        .upsert(filteredRows, { onConflict: 'user_id,menu_key' }),
  });

  if (error) {
    throw new Error(`Gagal menyimpan hak akses user: ${extractSupabaseErrorMessage(error)}`);
  }
}

export async function updateUserPresence(
  userId: string,
  isOnline: boolean,
  options?: { touchLastSeen?: boolean; email?: string }
): Promise<void> {
  if (!isSupabaseConfigured || (!userId && !options?.email)) return;
  try {
    const client = requireSupabaseClient();
    const nowIso = new Date().toISOString();
    const candidatePayload: Record<string, unknown> = {
      is_online: isOnline,
      updated_at: nowIso,
    };
    if (options?.touchLastSeen !== false) {
      candidatePayload.last_seen_at = nowIso;
    }

    const cleanEmail = options?.email?.trim().toLowerCase();
    const runUpdate = async (payload: Record<string, unknown>) => {
      if (Object.keys(payload).length === 0) {
        return { data: null, error: null };
      }
      if (userId) {
        const res = await client
          .from(APP_USERS_TABLE)
          .update(payload)
          .eq('id', userId)
          .select('id');
        if (!res.error && Array.isArray(res.data) && res.data.length === 0 && cleanEmail) {
          return client.from(APP_USERS_TABLE).update(payload).eq('email', cleanEmail);
        }
        return res;
      }
      return client.from(APP_USERS_TABLE).update(payload).eq('email', cleanEmail!);
    };

    const currentPayload = { ...candidatePayload };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { error } = await runUpdate(currentPayload);
      if (!error) break;
      if (!isMissingColumnSupabaseError(error)) break;
      const missingCol = extractMissingColumnFromError(error);
      if (!missingCol || !(missingCol in currentPayload)) break;
      delete currentPayload[missingCol];
      removeObservedTableColumn(APP_USERS_TABLE, missingCol);
    }
  } catch {
    // Abaikan error presence agar tidak mengganggu aplikasi utama
  }
}

export function sendPresenceOfflineBeacon(
  userId: string,
  accessToken?: string | null
): void {
  if (!isSupabaseConfigured || !userId || typeof fetch !== 'function') return;
  const observed = getObservedTableColumns(APP_USERS_TABLE);
  if (observed && !observed.has('is_online')) return;

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!supabaseUrl || !supabaseAnonKey) return;

  const token = accessToken?.trim() || supabaseAnonKey;
  try {
    void fetch(
      `${supabaseUrl}/rest/v1/${APP_USERS_TABLE}?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        keepalive: true,
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          is_online: false,
        }),
      }
    ).catch(() => {
      // Abaikan error network saat tab ditutup
    });
  } catch {
    // Abaikan error keepalive fetch
  }
}

export async function loadAuthenticatedProfile(
  authUser: User
): Promise<AuthenticatedSessionState> {
  const client = requireSupabaseClient();
  const email = (authUser.email ?? '').trim().toLowerCase();
  const superAdmin = isSuperAdminEmail(email);

  const { data: existingRows, error: userLookupErr } = await client
    .from(APP_USERS_TABLE)
    .select('*')
    .or(`id.eq.${authUser.id},email.eq.${email}`)
    .limit(1);

  if (userLookupErr) {
    const detail = extractSupabaseErrorMessage(userLookupErr);
    if (detail.toLowerCase().includes('does not exist') || detail.toLowerCase().includes('42p01')) {
      throw new Error(
        'Tabel app_users / app_permissions belum ada di Supabase. Jalankan SQL dari supabase/schema.sql di Supabase SQL Editor terlebih dahulu.'
      );
    }
    throw new Error(`Gagal memuat profil user: ${detail}`);
  }

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    recordObservedTableColumns(APP_USERS_TABLE, existingRows);
  }

  const existingRow =
    Array.isArray(existingRows) && existingRows.length > 0
      ? (existingRows[0] as Record<string, unknown>)
      : null;

  if (superAdmin) {
    const defaultNama =
      String(existingRow?.nama ?? '').trim() ||
      String((authUser.user_metadata as { nama?: unknown } | undefined)?.nama ?? '').trim() ||
      'Lira (Super Admin)';
    const nowIso = new Date().toISOString();
    const { data: upserted, error: upsertErr } = await executeTableWriteWithFallback({
      tableName: APP_USERS_TABLE,
      coreColumns: APP_USERS_CORE_COLUMNS,
      rows: [
        {
          id: existingRow?.id ? String(existingRow.id) : authUser.id,
          email: SUPER_ADMIN_EMAIL,
          nama: defaultNama,
          role: 'super_admin',
          is_active: true,
          last_seen_at: nowIso,
          is_online: true,
          updated_at: nowIso,
        },
      ],
      execute: ([row]) =>
        client
          .from(APP_USERS_TABLE)
          .upsert(row, { onConflict: 'email' })
          .select()
          .single(),
    });

    if (upsertErr) {
      throw new Error(`Gagal menyiapkan profil Super Admin: ${extractSupabaseErrorMessage(upsertErr)}`);
    }

    let userRecord = mapAppUserRow(upserted as Record<string, unknown>);
    const presenceNowIso = new Date().toISOString();
    void updateUserPresence(userRecord.id, true, { email: userRecord.email });
    userRecord = {
      ...userRecord,
      isOnline: true,
      lastSeenAt: presenceNowIso,
    };
    const fullPerms = buildSuperAdminMenuPermissions();
    await upsertUserPermissionsRows(userRecord.id, fullPerms);

    const state: AuthenticatedSessionState = {
      user: userRecord,
      permissions: fullPerms,
      isSuperAdmin: true,
    };
    persistLocalSessionMeta(state);
    return state;
  }

  let userRecord: AppUserRecord;
  if (!existingRow) {
    // User lama dari Supabase Auth yang belum punya profil di app_users:
    // Buat profil default staff dan default seluruh menu ke Hanya Lihat (View Only).
    const metaNama = String(
      (authUser.user_metadata as { nama?: unknown } | undefined)?.nama ?? ''
    ).trim();
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insertErr } = await executeTableWriteWithFallback({
      tableName: APP_USERS_TABLE,
      coreColumns: APP_USERS_CORE_COLUMNS,
      rows: [
        {
          id: authUser.id,
          email,
          nama: metaNama || email.split('@')[0] || 'User',
          role: 'staff',
          is_active: true,
          last_seen_at: nowIso,
          is_online: true,
          updated_at: nowIso,
        },
      ],
      execute: ([row]) =>
        client
          .from(APP_USERS_TABLE)
          .insert(row)
          .select()
          .single(),
    });

    if (insertErr) {
      throw new Error(`Gagal membuat profil user: ${extractSupabaseErrorMessage(insertErr)}`);
    }

    userRecord = mapAppUserRow(inserted as Record<string, unknown>);
    void updateUserPresence(userRecord.id, true, { email: userRecord.email });
    userRecord = {
      ...userRecord,
      isOnline: true,
      lastSeenAt: nowIso,
    };
    const defaultPerms = buildDefaultViewOnlyMenuPermissions();
    await upsertUserPermissionsRows(userRecord.id, defaultPerms);

    const state: AuthenticatedSessionState = {
      user: userRecord,
      permissions: defaultPerms,
      isSuperAdmin: false,
    };
    persistLocalSessionMeta(state);
    return state;
  }

  userRecord = mapAppUserRow(existingRow);
  if (!userRecord.isActive) {
    await updateUserPresence(userRecord.id, false, {
      touchLastSeen: false,
      email: userRecord.email,
    });
    await client.auth.signOut();
    persistLocalSessionMeta(null);
    throw new Error('Akun Anda sedang dinonaktifkan oleh Super Admin.');
  }

  const nowIso = new Date().toISOString();
  void updateUserPresence(userRecord.id, true, { email: userRecord.email });
  userRecord = {
    ...userRecord,
    isOnline: true,
    lastSeenAt: nowIso,
  };

  const { data: permRows, error: permErr } = await client
    .from(APP_PERMISSIONS_TABLE)
    .select('*')
    .eq('user_id', userRecord.id);

  if (permErr) {
    throw new Error(`Gagal memuat hak akses menu: ${extractSupabaseErrorMessage(permErr)}`);
  }

  const normalizedPermRows = (permRows ?? []) as Array<Record<string, unknown>>;
  const isLegacyWithoutPerms = normalizedPermRows.length === 0;
  const permissions = mapPermissionsRows(normalizedPermRows, true);

  if (isLegacyWithoutPerms) {
    // User lama belum punya permission -> default ke Hanya Lihat & simpan agar konsisten
    try {
      await upsertUserPermissionsRows(userRecord.id, permissions);
    } catch {
      // Tetap lanjutkan dengan default Hanya Lihat di memori jika insert gagal
    }
  }

  const state: AuthenticatedSessionState = {
    user: userRecord,
    permissions,
    isSuperAdmin: isSuperAdminUser(userRecord),
  };
  persistLocalSessionMeta(state);
  return state;
}

export async function signInWithEmailPassword(
  rawEmail: string,
  password: string
): Promise<AuthenticatedSessionState> {
  const client = requireSupabaseClient();
  const cleanEmail = rawEmail.trim().toLowerCase();

  if (!cleanEmail || !password) {
    throw new Error('Email dan password wajib diisi.');
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (error) {
    const errMsg = extractSupabaseErrorMessage(error).toLowerCase();
    // Auto-bootstrap Super Admin pertama saat login pertama menggunakan password awal Admin123!
    if (
      isSuperAdminEmail(cleanEmail) &&
      password === SUPER_ADMIN_INITIAL_PASSWORD &&
      !errMsg.includes('not confirmed')
    ) {
      const { data: signUpData, error: signUpErr } = await client.auth.signUp({
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_INITIAL_PASSWORD,
        options: {
          data: {
            nama: 'Lira (Super Admin)',
            role: 'super_admin',
          },
        },
      });

      if (signUpErr) {
        const signUpMsg = extractSupabaseErrorMessage(signUpErr);
        if (signUpMsg.toLowerCase().includes('already registered')) {
          throw new Error('Email atau password salah.');
        }
        throw new Error(`Gagal mendaftarkan Super Admin awal: ${signUpMsg}`);
      }

      if (!signUpData.session) {
        throw new Error(
          'Akun Super Admin berhasil dibuat di Supabase Auth. Silakan konfirmasi email Anda atau nonaktifkan "Confirm email" di Supabase Dashboard -> Authentication -> Providers -> Email lalu login ulang.'
        );
      }

      if (!signUpData.user) {
        throw new Error('Gagal membuat sesi login Super Admin.');
      }

      return loadAuthenticatedProfile(signUpData.user);
    }

    if (errMsg.includes('email not confirmed')) {
      throw new Error(
        'Email belum dikonfirmasi di Supabase Auth. Silakan cek inbox atau matikan Confirm email di Supabase.'
      );
    }
    if (errMsg.includes('invalid login credentials')) {
      throw new Error('Email atau password salah.');
    }
    throw new Error(`Gagal login: ${extractSupabaseErrorMessage(error)}`);
  }

  if (!data.user) {
    throw new Error('Gagal mendapatkan data akun setelah login.');
  }

  return loadAuthenticatedProfile(data.user);
}

export async function restoreSavedSession(): Promise<AuthenticatedSessionState | null> {
  if (!isSupabaseConfigured) return null;
  const client = requireSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.user) {
    persistLocalSessionMeta(null);
    return null;
  }
  return loadAuthenticatedProfile(data.session.user);
}

export async function signOutCurrentUser(
  userId?: string,
  email?: string
): Promise<void> {
  if (userId || email) {
    await updateUserPresence(userId ?? '', false, { email });
  }
  persistLocalSessionMeta(null);
  if (!isSupabaseConfigured) return;
  const client = requireSupabaseClient();
  await client.auth.signOut();
}

export async function updateOwnPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 6) {
    throw new Error('Password baru minimal 6 karakter.');
  }
  const client = requireSupabaseClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    throw new Error(`Gagal mengubah password: ${extractSupabaseErrorMessage(error)}`);
  }
}

export async function listManagedUsersWithPermissions(): Promise<
  ManagedUserWithPermissions[]
> {
  const client = requireSupabaseClient();
  const [usersResInitial, permsRes] = await Promise.all([
    client.from(APP_USERS_TABLE).select('*').order('created_at', { ascending: true }),
    client.from(APP_PERMISSIONS_TABLE).select('*'),
  ]);

  let usersData = usersResInitial.data;
  let usersErr = usersResInitial.error;

  if (usersErr && isMissingColumnSupabaseError(usersErr)) {
    const fallbackUsersRes = await client.from(APP_USERS_TABLE).select('*');
    usersData = fallbackUsersRes.data;
    usersErr = fallbackUsersRes.error;
  }

  const permsData = permsRes.data;
  const permsErr = permsRes.error;

  if (usersErr) {
    throw new Error(`Gagal mengambil daftar user: ${extractSupabaseErrorMessage(usersErr)}`);
  }
  if (permsErr) {
    throw new Error(
      `Gagal mengambil daftar hak akses: ${extractSupabaseErrorMessage(permsErr)}`
    );
  }

  if (Array.isArray(usersData) && usersData.length > 0) {
    recordObservedTableColumns(APP_USERS_TABLE, usersData);
  }
  if (Array.isArray(permsData) && permsData.length > 0) {
    recordObservedTableColumns(APP_PERMISSIONS_TABLE, permsData);
  }

  const permsByUserId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of (permsData ?? []) as Array<Record<string, unknown>>) {
    const uid = String(row.user_id ?? '');
    if (!uid) continue;
    const list = permsByUserId.get(uid) ?? [];
    list.push(row);
    permsByUserId.set(uid, list);
  }

  const nowMs = Date.now();
  const staleUserIds: string[] = [];

  const mapped = ((usersData ?? []) as Array<Record<string, unknown>>).map((row) => {
    let user = mapAppUserRow(row);
    if (user.isOnline) {
      const seenMs = user.lastSeenAt ? Date.parse(user.lastSeenAt) : NaN;
      if (!Number.isFinite(seenMs) || nowMs - seenMs > USER_PRESENCE_TIMEOUT_MS || !user.isActive) {
        staleUserIds.push(user.id);
        user = { ...user, isOnline: false };
      }
    }
    if (isSuperAdminUser(user)) {
      return {
        user,
        permissions: buildSuperAdminMenuPermissions(),
      };
    }
    const rawPerms = permsByUserId.get(user.id) ?? [];
    return {
      user,
      permissions: mapPermissionsRows(rawPerms, true),
    };
  });

  if (staleUserIds.length > 0) {
    const observedCols = getObservedTableColumns(APP_USERS_TABLE);
    if (observedCols?.has('is_online')) {
      void client
        .from(APP_USERS_TABLE)
        .update({ is_online: false })
        .in('id', staleUserIds)
        .then(() => undefined, () => undefined);
    }
  }

  mapped.sort((a, b) => {
    if (a.user.createdAt && b.user.createdAt) {
      return a.user.createdAt.localeCompare(b.user.createdAt);
    }
    return a.user.nama.localeCompare(b.user.nama, 'id');
  });

  return mapped;
}

export async function createManagedUser(params: {
  nama: string;
  email: string;
  password: string;
  role: Exclude<AppUserRole, 'super_admin'>;
  permissions: AppMenuPermissionsMap;
}): Promise<{ user: AppUserRecord; permissions: AppMenuPermissionsMap; needsEmailConfirm: boolean }> {
  const cleanNama = params.nama.trim();
  const cleanEmail = params.email.trim().toLowerCase();
  const password = params.password;

  if (!cleanNama) throw new Error('Nama user wajib diisi.');
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Format email tidak valid.');
  }
  if (password.length < 6) {
    throw new Error('Password awal minimal 6 karakter.');
  }
  if (isSuperAdminEmail(cleanEmail)) {
    throw new Error('Email ini sudah dikhususkan untuk Super Admin utama.');
  }

  // Gunakan ephemeral client agar sesi Super Admin di localStorage tidak tertimpa
  const authCreator = createEphemeralSupabaseClient();
  const { data: signUpData, error: signUpErr } = await authCreator.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: {
        nama: cleanNama,
        role: params.role,
      },
    },
  });

  if (signUpErr) {
    const msg = extractSupabaseErrorMessage(signUpErr);
    if (msg.toLowerCase().includes('already registered')) {
      throw new Error(
        `Email ${cleanEmail} sudah terdaftar di Supabase Auth. Gunakan email lain atau aktifkan kembali user yang sudah ada.`
      );
    }
    throw new Error(`Gagal mendaftarkan user di Supabase Auth: ${msg}`);
  }

  const createdAuthUser = signUpData.user;
  if (!createdAuthUser?.id) {
    throw new Error('Supabase Auth tidak mengembalikan ID user baru.');
  }

  const client = requireSupabaseClient();
  const nowIso = new Date().toISOString();
  const { data: insertedUser, error: insertErr } = await executeTableWriteWithFallback({
    tableName: APP_USERS_TABLE,
    coreColumns: APP_USERS_CORE_COLUMNS,
    rows: [
      {
        id: createdAuthUser.id,
        email: cleanEmail,
        nama: cleanNama,
        role: params.role,
        is_active: true,
        updated_at: nowIso,
      },
    ],
    execute: ([row]) =>
      client
        .from(APP_USERS_TABLE)
        .upsert(row, { onConflict: 'email' })
        .select()
        .single(),
  });

  if (insertErr) {
    throw new Error(
      `User Auth terbuat, namun gagal menyimpan profil ke app_users: ${extractSupabaseErrorMessage(
        insertErr
      )}`
    );
  }

  const userRecord = mapAppUserRow(insertedUser as Record<string, unknown>);
  await upsertUserPermissionsRows(userRecord.id, params.permissions);

  return {
    user: userRecord,
    permissions: params.permissions,
    needsEmailConfirm: !signUpData.session,
  };
}

export async function updateManagedUserProfile(
  userId: string,
  patch: Partial<Pick<AppUserRecord, 'nama' | 'role' | 'isActive'>>
): Promise<void> {
  const client = requireSupabaseClient();
  const { data: existing, error: fetchErr } = await client
    .from(APP_USERS_TABLE)
    .select('email, role')
    .eq('id', userId)
    .single();

  if (fetchErr) {
    throw new Error(`User tidak ditemukan: ${extractSupabaseErrorMessage(fetchErr)}`);
  }

  const targetEmail = String((existing as { email?: unknown })?.email ?? '');
  if (isSuperAdminEmail(targetEmail)) {
    throw new Error('Status dan role Super Admin utama tidak dapat diubah.');
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.nama !== undefined) updates.nama = patch.nama.trim();
  if (patch.role !== undefined && patch.role !== 'super_admin') updates.role = patch.role;
  if (patch.isActive !== undefined) updates.is_active = Boolean(patch.isActive);

  const { error: updateErr } = await executeTableWriteWithFallback({
    tableName: APP_USERS_TABLE,
    coreColumns: APP_USERS_CORE_COLUMNS,
    rows: [updates],
    execute: ([row]) => {
      if (Object.keys(row).length === 0) {
        return Promise.resolve({ data: null, error: null });
      }
      return client.from(APP_USERS_TABLE).update(row).eq('id', userId);
    },
  });

  if (updateErr) {
    throw new Error(`Gagal memperbarui user: ${extractSupabaseErrorMessage(updateErr)}`);
  }
}

export async function saveManagedUserPermissions(
  userId: string,
  permissions: AppMenuPermissionsMap
): Promise<void> {
  const client = requireSupabaseClient();
  const { data: existing, error: fetchErr } = await client
    .from(APP_USERS_TABLE)
    .select('email')
    .eq('id', userId)
    .single();

  if (fetchErr) {
    throw new Error(`User tidak ditemukan: ${extractSupabaseErrorMessage(fetchErr)}`);
  }

  if (isSuperAdminEmail(String((existing as { email?: unknown })?.email ?? ''))) {
    await upsertUserPermissionsRows(userId, buildSuperAdminMenuPermissions());
    return;
  }

  await upsertUserPermissionsRows(userId, permissions);
}

export async function deleteManagedUser(userId: string): Promise<void> {
  const client = requireSupabaseClient();
  const { data: existing, error: fetchErr } = await client
    .from(APP_USERS_TABLE)
    .select('email')
    .eq('id', userId)
    .single();

  if (fetchErr) {
    throw new Error(`User tidak ditemukan: ${extractSupabaseErrorMessage(fetchErr)}`);
  }

  if (isSuperAdminEmail(String((existing as { email?: unknown })?.email ?? ''))) {
    throw new Error('Super Admin utama tidak dapat dihapus.');
  }

  const { error: permDelErr } = await client
    .from(APP_PERMISSIONS_TABLE)
    .delete()
    .eq('user_id', userId);
  if (permDelErr) {
    throw new Error(
      `Gagal menghapus hak akses user: ${extractSupabaseErrorMessage(permDelErr)}`
    );
  }

  const { error: userDelErr } = await client
    .from(APP_USERS_TABLE)
    .delete()
    .eq('id', userId);
  if (userDelErr) {
    throw new Error(`Gagal menghapus user: ${extractSupabaseErrorMessage(userDelErr)}`);
  }
}

export async function sendUserPasswordReset(email: string): Promise<void> {
  const client = requireSupabaseClient();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Email user tidak valid.');
  }
  const redirectTo =
    typeof window !== 'undefined' ? window.location.origin : undefined;
  const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo,
  });
  if (error) {
    throw new Error(
      `Gagal mengirim email reset password: ${extractSupabaseErrorMessage(error)}`
    );
  }
}
