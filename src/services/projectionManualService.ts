import {
  generateUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseTableSchema,
} from '../lib/supabaseClient';
import {
  packNotesWithMeta,
  recordObservedTableColumns,
  runWhitelistedSupabaseMutation,
  sanitizePayloadByWhitelist,
  unpackNotesWithMeta,
} from '../lib/supabaseWhitelist';
import { BOSS_REPORT_SCHEMA_LIMITS, BossReportColorStatus } from '../types/bossReport';
import {
  normalizeProjectionManualSection,
  ProjectionManualItem,
  ProjectionManualItemInput,
  resolveProjectionManualColor,
} from '../types/projectionManualItem';
import { getTodayISODate } from '../utils/format';

const TABLE_NAME = 'projection_manual_items';
const LOCAL_CACHE_KEY = 'kkb_projection_manual_items_cache_v1';

type ProjectionManualListener = (items: ProjectionManualItem[]) => void;
const listeners = new Set<ProjectionManualListener>();
let latestItems: ProjectionManualItem[] = loadLocalCache();
let channelSeq = 0;

const PROJECTION_MANUAL_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'id',
  'periode',
  'section',
  'nama_item',
  'nominal',
  'keterangan',
  'project_id',
  'project_name',
  'vendor',
  'status_warna',
  'created_by',
  'created_at',
  'updated_at',
]);

const PROJECTION_MANUAL_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
]);

function normalizePeriodMonthKey(raw: unknown): string {
  const match = /^\s*(\d{4})-(\d{1,2})/.exec(String(raw ?? ''));
  if (!match) return getTodayISODate().slice(0, 7);
  const y = match[1];
  const m = String(Math.min(12, Math.max(1, Number(match[2]) || 1))).padStart(2, '0');
  return `${y}-${m}`;
}

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    const s = String(err ?? '').toLowerCase();
    return s.includes('does not exist') || s.includes('could not find the table');
  }
  const rec = err as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(rec.code ?? '').toUpperCase();
  const msg = `${String(rec.message ?? '')} ${String(rec.details ?? '')}`.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

function sortItems(items: ProjectionManualItem[]): ProjectionManualItem[] {
  return [...items].sort((a, b) => {
    const pCmp = a.periode.localeCompare(b.periode);
    if (pCmp !== 0) return pCmp;
    const sCmp = a.section.localeCompare(b.section);
    if (sCmp !== 0) return sCmp;
    const cCmp = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    if (cCmp !== 0) return cCmp;
    return a.namaItem.localeCompare(b.namaItem, 'id');
  });
}

function loadLocalCache(): ProjectionManualItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sortItems(
      parsed
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        .map((row, idx) => normalizeProjectionManualItem(row, String(row.id ?? `pmi_cache_${idx}`)))
    );
  } catch {
    return [];
  }
}

function saveLocalCache(items: ProjectionManualItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function notifyListeners(items: ProjectionManualItem[]): void {
  const sorted = sortItems(items);
  latestItems = sorted;
  saveLocalCache(sorted);
  for (const listener of listeners) {
    listener(sorted);
  }
}

export function sanitizeProjectionManualInput(
  input: ProjectionManualItemInput
): ProjectionManualItemInput & {
  statusWarna: 'PUTIH' | 'HIJAU' | 'MERAH';
  color: BossReportColorStatus;
  keterangan: string;
  createdBy: string;
} {
  const periode = normalizePeriodMonthKey(input.periode);
  const section = normalizeProjectionManualSection(input.section);
  const namaItem =
    String(input.namaItem ?? '').trim().slice(0, BOSS_REPORT_SCHEMA_LIMITS.itemNameMax) ||
    'Item Manual Projection';
  const rawAmt = Number(input.nominal ?? 0);
  const nominal = Number.isFinite(rawAmt)
    ? Math.max(0, Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(rawAmt)))
    : 0;
  const keterangan = String(input.keterangan ?? '').trim().slice(0, 500);
  const projectId =
    section === 'PROJECT_COST' && input.projectId
      ? String(input.projectId).trim().slice(0, 128)
      : undefined;
  const projectName =
    section === 'PROJECT_COST' && input.projectName
      ? String(input.projectName).trim().slice(0, 200)
      : undefined;
  const vendor =
    section === 'PROJECT_COST' && input.vendor
      ? String(input.vendor).trim().slice(0, 200)
      : undefined;
  const { color, statusWarna } = resolveProjectionManualColor(input.statusWarna, input.color);
  const createdBy = String(input.createdBy ?? '').trim().slice(0, 160);

  return {
    periode,
    section,
    namaItem,
    nominal,
    keterangan,
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(vendor ? { vendor } : {}),
    statusWarna,
    color,
    createdBy,
  };
}

function normalizeProjectionManualItem(
  raw: Record<string, unknown>,
  fallbackId: string
): ProjectionManualItem {
  const { notes: unpackedKeterangan, meta } = unpackNotesWithMeta(
    raw.keterangan ?? raw.notes
  );
  const section = normalizeProjectionManualSection(raw.section ?? meta.section);
  const { color, statusWarna } = resolveProjectionManualColor(
    raw.status_warna ?? raw.statusWarna ?? meta.status_warna,
    raw.color
  );
  const clean = sanitizeProjectionManualInput({
    periode: String(raw.periode ?? raw.month_key ?? meta.periode ?? ''),
    section,
    namaItem: String(raw.nama_item ?? raw.namaItem ?? raw.name ?? meta.nama_item ?? ''),
    nominal: Number(raw.nominal ?? raw.amount ?? meta.nominal ?? 0),
    keterangan: unpackedKeterangan || String(meta.keterangan ?? ''),
    projectId:
      raw.project_id ?? raw.projectId ?? meta.project_id
        ? String(raw.project_id ?? raw.projectId ?? meta.project_id)
        : undefined,
    projectName:
      raw.project_name ?? raw.projectName ?? meta.project_name
        ? String(raw.project_name ?? raw.projectName ?? meta.project_name)
        : undefined,
    vendor:
      raw.vendor ?? meta.vendor ? String(raw.vendor ?? meta.vendor) : undefined,
    statusWarna,
    color,
    createdBy: String(raw.created_by ?? raw.createdBy ?? meta.created_by ?? ''),
  });

  return {
    id: String(raw.id ?? fallbackId),
    periode: clean.periode,
    section: clean.section,
    namaItem: clean.namaItem,
    nominal: clean.nominal,
    keterangan: clean.keterangan,
    ...(clean.projectId ? { projectId: clean.projectId } : {}),
    ...(clean.projectName ? { projectName: clean.projectName } : {}),
    ...(clean.vendor ? { vendor: clean.vendor } : {}),
    statusWarna: clean.statusWarna,
    color: clean.color,
    createdBy: clean.createdBy,
    createdAt: raw.created_at
      ? String(raw.created_at)
      : raw.createdAt
      ? String(raw.createdAt)
      : undefined,
    updatedAt: raw.updated_at
      ? String(raw.updated_at)
      : raw.updatedAt
      ? String(raw.updatedAt)
      : undefined,
  };
}

function toRawDbRecord(
  clean: ReturnType<typeof sanitizeProjectionManualInput>,
  options?: { id?: string; createdAt?: string; updatedAt?: string; isUpdate?: boolean }
): Record<string, unknown> {
  return {
    ...(!options?.isUpdate && options?.id ? { id: options.id } : {}),
    periode: clean.periode,
    section: clean.section,
    nama_item: clean.namaItem,
    nominal: clean.nominal,
    keterangan: clean.keterangan,
    project_id: clean.section === 'PROJECT_COST' ? clean.projectId ?? null : null,
    project_name: clean.section === 'PROJECT_COST' ? clean.projectName ?? null : null,
    vendor: clean.section === 'PROJECT_COST' ? clean.vendor ?? null : null,
    status_warna: clean.statusWarna,
    ...(!options?.isUpdate ? { created_by: clean.createdBy } : {}),
    ...(options?.createdAt && !options?.isUpdate ? { created_at: options.createdAt } : {}),
    updated_at: options?.updatedAt ?? new Date().toISOString(),
  };
}

function sanitizeDbPayload(
  clean: ReturnType<typeof sanitizeProjectionManualInput>,
  schema: SupabaseTableSchema | null,
  options?: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    excludedColumns?: ReadonlySet<string>;
    isUpdate?: boolean;
  }
): Record<string, unknown> {
  const rawRecord = toRawDbRecord(clean, options);
  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: rawRecord,
    fallbackColumns: PROJECTION_MANUAL_FALLBACK_WHITELIST,
    schema,
    excludeFromDropped: PROJECTION_MANUAL_EXCLUDE_FROM_DROPPED,
    excludedColumns: options?.excludedColumns,
  });

  if (options?.isUpdate) {
    delete payload.id;
    delete payload.created_at;
    delete payload.created_by;
  }

  if (Object.keys(dropped).length > 0 && 'keterangan' in payload) {
    payload.keterangan = packNotesWithMeta(String(payload.keterangan ?? ''), dropped, 2000);
  }

  return payload;
}

export async function getProjectionManualItems(): Promise<ProjectionManualItem[]> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch {
    return loadLocalCache();
  }

  const { data, error } = await client.from(TABLE_NAME).select('*');
  if (error) {
    if (isMissingTableError(error)) {
      console.warn(
        `[Supabase][${TABLE_NAME}] Tabel belum ada di Supabase, memakai cache lokal sementara.`
      );
      return loadLocalCache();
    }
    throw reportSupabaseError(
      'Gagal mengambil data item manual Projection dari Supabase',
      error,
      { showAlert: false }
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return sortItems(
    rows.map((row, idx) =>
      normalizeProjectionManualItem(row, String(row.id ?? `pmi_${idx}`))
    )
  );
}

export async function refreshProjectionManualItemsFromSupabase(): Promise<
  ProjectionManualItem[]
> {
  const list = await getProjectionManualItems();
  notifyListeners(list);
  return list;
}

export async function refreshProjectionManualItemsRangeFromSupabase(
  startMonthKey: string,
  endMonthKey: string
): Promise<ProjectionManualItem[]> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch {
    return loadLocalCache();
  }

  const safeStart = normalizePeriodMonthKey(startMonthKey);
  const safeEnd = normalizePeriodMonthKey(endMonthKey);
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .gte('periode', safeStart)
    .lte('periode', safeEnd);

  if (error) {
    if (isMissingTableError(error)) {
      return loadLocalCache();
    }
    throw reportSupabaseError(
      `Gagal mengambil data item manual Projection (${safeStart} s/d ${safeEnd})`,
      error,
      { showAlert: false }
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const rangeRows = rows.map((row, idx) =>
    normalizeProjectionManualItem(row, String(row.id ?? `pmi_${idx}`))
  );

  const byId = new Map<string, ProjectionManualItem>();
  for (const existing of latestItems) {
    if (existing.periode < safeStart || existing.periode > safeEnd) {
      byId.set(existing.id, existing);
    }
  }
  for (const item of rangeRows) {
    byId.set(item.id, item);
  }
  notifyListeners(Array.from(byId.values()));
  return sortItems(rangeRows);
}

export function subscribeProjectionManualItems(
  onData: (items: ProjectionManualItem[]) => void
): () => void {
  listeners.add(onData);

  if (!supabase) {
    const cached = loadLocalCache();
    latestItems = cached;
    onData(cached);
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const fetchItems = async () => {
    if (cancelled) return;
    try {
      const list = await getProjectionManualItems();
      if (cancelled) return;
      notifyListeners(list);
    } catch {
      if (!cancelled) {
        onData(latestItems);
      }
    }
  };

  void fetchItems();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchItems();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function createProjectionManualItem(
  input: ProjectionManualItemInput
): Promise<ProjectionManualItem> {
  const clean = sanitizeProjectionManualInput(input);
  const id = `pmi_${generateUuid()}`;
  const nowIso = new Date().toISOString();

  if (!supabase) {
    const created: ProjectionManualItem = {
      id,
      periode: clean.periode,
      section: clean.section,
      namaItem: clean.namaItem,
      nominal: clean.nominal,
      keterangan: clean.keterangan,
      ...(clean.projectId ? { projectId: clean.projectId } : {}),
      ...(clean.projectName ? { projectName: clean.projectName } : {}),
      ...(clean.vendor ? { vendor: clean.vendor } : {}),
      statusWarna: clean.statusWarna,
      color: clean.color,
      createdBy: clean.createdBy,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    notifyListeners([...latestItems, created]);
    return created;
  }

  const client = requireSupabaseClient();
  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'insert',
    buildPayload: (schema, excluded) =>
      sanitizeDbPayload(clean, schema, {
        id,
        createdAt: nowIso,
        updatedAt: nowIso,
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).insert([payload]).select().single(),
  });

  if (error) {
    if (isMissingTableError(error)) {
      console.warn(
        `[Supabase][${TABLE_NAME}] Tabel belum ada di Supabase, menyimpan ke cache lokal sementara.`
      );
      const created: ProjectionManualItem = {
        id,
        periode: clean.periode,
        section: clean.section,
        namaItem: clean.namaItem,
        nominal: clean.nominal,
        keterangan: clean.keterangan,
        ...(clean.projectId ? { projectId: clean.projectId } : {}),
        ...(clean.projectName ? { projectName: clean.projectName } : {}),
        ...(clean.vendor ? { vendor: clean.vendor } : {}),
        statusWarna: clean.statusWarna,
        color: clean.color,
        createdBy: clean.createdBy,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      notifyListeners([...latestItems, created]);
      return created;
    }
    throw reportSupabaseError(
      'Gagal menyimpan item manual Projection ke Supabase',
      error
    );
  }

  const saved = normalizeProjectionManualItem((data ?? {}) as Record<string, unknown>, id);
  await refreshProjectionManualItemsFromSupabase().catch(() => {
    notifyListeners([...latestItems.filter((x) => x.id !== saved.id), saved]);
  });
  return saved;
}

export async function updateProjectionManualItem(
  id: string,
  input: ProjectionManualItemInput
): Promise<ProjectionManualItem> {
  const cleanId = String(id ?? '').trim();
  if (!cleanId) {
    throw new Error('ID item manual Projection tidak valid.');
  }

  const existing = latestItems.find((item) => item.id === cleanId);
  const clean = sanitizeProjectionManualInput({
    ...existing,
    ...input,
  });
  const nowIso = new Date().toISOString();

  if (!supabase) {
    const updated: ProjectionManualItem = {
      id: cleanId,
      periode: clean.periode,
      section: clean.section,
      namaItem: clean.namaItem,
      nominal: clean.nominal,
      keterangan: clean.keterangan,
      ...(clean.projectId ? { projectId: clean.projectId } : {}),
      ...(clean.projectName ? { projectName: clean.projectName } : {}),
      ...(clean.vendor ? { vendor: clean.vendor } : {}),
      statusWarna: clean.statusWarna,
      color: clean.color,
      createdBy: existing?.createdBy ?? clean.createdBy,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    notifyListeners(
      latestItems.map((item) => (item.id === cleanId ? updated : item))
    );
    return updated;
  }

  const client = requireSupabaseClient();
  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeDbPayload(clean, schema, {
        updatedAt: nowIso,
        excludedColumns: excluded,
        isUpdate: true,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', cleanId).select().single(),
  });

  if (error) {
    if (isMissingTableError(error)) {
      const updated: ProjectionManualItem = {
        id: cleanId,
        periode: clean.periode,
        section: clean.section,
        namaItem: clean.namaItem,
        nominal: clean.nominal,
        keterangan: clean.keterangan,
        ...(clean.projectId ? { projectId: clean.projectId } : {}),
        ...(clean.projectName ? { projectName: clean.projectName } : {}),
        ...(clean.vendor ? { vendor: clean.vendor } : {}),
        statusWarna: clean.statusWarna,
        color: clean.color,
        createdBy: existing?.createdBy ?? clean.createdBy,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };
      notifyListeners(
        latestItems.map((item) => (item.id === cleanId ? updated : item))
      );
      return updated;
    }
    throw reportSupabaseError(
      `Gagal memperbarui item manual Projection (${cleanId}) di Supabase`,
      error
    );
  }

  const saved = normalizeProjectionManualItem((data ?? {}) as Record<string, unknown>, cleanId);
  await refreshProjectionManualItemsFromSupabase().catch(() => {
    notifyListeners(
      latestItems.map((item) => (item.id === saved.id ? saved : item))
    );
  });
  return saved;
}

export async function updateProjectionManualItemStatus(
  id: string,
  color: BossReportColorStatus
): Promise<ProjectionManualItem> {
  const cleanId = String(id ?? '').trim();
  const existing = latestItems.find((item) => item.id === cleanId);
  if (!existing) {
    throw new Error('Item manual Projection tidak ditemukan.');
  }
  const { statusWarna } = resolveProjectionManualColor(undefined, color);
  return updateProjectionManualItem(cleanId, {
    periode: existing.periode,
    section: existing.section,
    namaItem: existing.namaItem,
    nominal: existing.nominal,
    keterangan: existing.keterangan,
    projectId: existing.projectId,
    projectName: existing.projectName,
    vendor: existing.vendor,
    statusWarna,
    color,
    createdBy: existing.createdBy,
  });
}

export async function deleteProjectionManualItem(id: string): Promise<void> {
  const cleanId = String(id ?? '').trim();
  if (!cleanId) {
    throw new Error('ID item manual Projection tidak valid.');
  }

  if (!supabase) {
    notifyListeners(latestItems.filter((item) => item.id !== cleanId));
    return;
  }

  const client = requireSupabaseClient();
  const { error } = await client.from(TABLE_NAME).delete().eq('id', cleanId);
  if (error) {
    if (isMissingTableError(error)) {
      notifyListeners(latestItems.filter((item) => item.id !== cleanId));
      return;
    }
    throw reportSupabaseError(
      `Gagal menghapus item manual Projection (${cleanId}) di Supabase`,
      error
    );
  }

  notifyListeners(latestItems.filter((item) => item.id !== cleanId));
  await refreshProjectionManualItemsFromSupabase().catch(() => undefined);
}
