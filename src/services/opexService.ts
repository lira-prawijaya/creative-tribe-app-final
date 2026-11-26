import {
  generateUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseTableSchema,
} from '../lib/supabaseClient';
import {
  getObservedTableColumns,
  isNumericColumnSchema,
  packNotesWithMeta,
  packObjectWithMeta,
  recordObservedTableColumns,
  runWhitelistedSupabaseMutation,
  sanitizePayloadByWhitelist,
  unpackNotesWithMeta,
  unpackObjectWithMeta,
} from '../lib/supabaseWhitelist';
import {
  mapOpexDbFieldsToColor,
  mapOpexStatusToDbFields,
  normalizeOpexStatus,
  OPEX_SCHEMA_LIMITS,
  OpexCategory,
  OpexInput,
  OpexItem,
  OpexPaymentStatus,
  OpexStatusWarna,
} from '../types/opex';
import { getTodayISODate, normalizeToIsoDate } from '../utils/format';
import { normalizeMonthKeyYYYYMM } from '../utils/bossReportCalc';

const TABLE_NAME = 'opex';

type OpexListener = (items: OpexItem[]) => void;
const listeners = new Set<OpexListener>();
let latestOpexItems: OpexItem[] = [];
let channelSeq = 0;

const OPEX_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'description',
  'category',
  'amount',
  'actual_amount',
  'realisasi_amount',
  'month_realisasi',
  'expense_date',
  'month',
  'month_key',
  'status',
  'status_warna',
  'delete_reason',
  'created_at',
]);

const OPEX_COLUMN_ALIASES: Record<string, string[]> = {
  description: ['name'],
  notes: ['note'],
  note: ['notes'],
};

const OPEX_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'name',
  'created_at',
  'updated_at',
  'delete_reason',
]);

export function getEndOfMonthISODate(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return getTodayISODate();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(year, month, 0).getDate();
  return `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
}

function sanitizeStatus(
  value: unknown,
  statusWarna?: unknown
): OpexPaymentStatus {
  const w = String(statusWarna ?? '').trim().toUpperCase();
  const s = String(value ?? '').trim();
  const lower = s.toLowerCase();
  if (w === 'HIJAU' || lower === 'paid' || lower === 'sudah bayar' || lower === 'lunas') {
    return 'Paid';
  }
  if (w === 'MERAH' || lower === 'reschedule' || lower === 'rescheduling') {
    return 'Reschedule';
  }
  return 'Not Paid';
}

function sanitizeStatusWarna(
  statusWarna: unknown,
  status: unknown
): OpexStatusWarna {
  return mapOpexStatusToDbFields(
    String(status ?? 'Not Paid') as OpexPaymentStatus,
    typeof statusWarna === 'string' ? statusWarna : undefined
  ).dbWarna;
}

function sanitizeCategory(value: unknown): OpexCategory {
  const trimmed = String(value ?? '').trim().slice(0, 100);
  return trimmed || 'OPERASIONAL';
}

function sanitizeMonthStatuses(raw: unknown): Record<string, OpexPaymentStatus> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, OpexPaymentStatus> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (OPEX_SCHEMA_LIMITS.monthKeyPattern.test(k)) {
      result[k] = sanitizeStatus(v);
    }
  }
  return result;
}

function sanitizePaidDates(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (OPEX_SCHEMA_LIMITS.monthKeyPattern.test(k) && typeof v === 'string') {
      result[k] = v.trim().slice(0, 10);
    }
  }
  return result;
}

function sanitizeRescheduledMonths(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (
      OPEX_SCHEMA_LIMITS.monthKeyPattern.test(k) &&
      typeof v === 'string' &&
      OPEX_SCHEMA_LIMITS.monthKeyPattern.test(v.trim())
    ) {
      result[k] = v.trim();
    }
  }
  return result;
}

function sanitizeMonthRealisasi(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (OPEX_SCHEMA_LIMITS.monthKeyPattern.test(k) && v !== undefined && v !== null && v !== '') {
      const num = Number(v);
      if (Number.isFinite(num)) {
        result[k] = Math.max(0, Math.min(OPEX_SCHEMA_LIMITS.maxAmount, Math.round(num)));
      }
    }
  }
  return result;
}

function sanitizeOptionalRealisasi(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(OPEX_SCHEMA_LIMITS.maxAmount, Math.round(num)));
}

export function sanitizeOpexInput(input: OpexInput): OpexInput {
  const defaultMonth = getTodayISODate().slice(0, 7);
  const monthKey = OPEX_SCHEMA_LIMITS.monthKeyPattern.test(input.monthKey)
    ? input.monthKey
    : defaultMonth;
  const endMonthKey =
    input.endMonthKey && OPEX_SCHEMA_LIMITS.monthKeyPattern.test(input.endMonthKey)
      ? input.endMonthKey
      : '';
  const rawAmt = Number(input.amount ?? 0);
  const amount = Number.isFinite(rawAmt)
    ? Math.max(0, Math.min(OPEX_SCHEMA_LIMITS.maxAmount, Math.round(rawAmt)))
    : 0;
  const rawDueDay = Number(input.dueDay ?? 0);
  const dueDay =
    Number.isFinite(rawDueDay) && rawDueDay >= 1 && rawDueDay <= 31
      ? Math.round(rawDueDay)
      : undefined;
  const sourceAccountId = input.sourceAccountId
    ? String(input.sourceAccountId).trim().slice(0, 64)
    : undefined;
  const sourceAccountName = input.sourceAccountName
    ? String(input.sourceAccountName).trim().slice(0, OPEX_SCHEMA_LIMITS.accountMax)
    : undefined;

  const { dbStatus, dbWarna } = mapOpexStatusToDbFields(
    input.status,
    input.statusWarna
  );
  const expenseDate =
    normalizeToIsoDate(input.expenseDate) ?? getEndOfMonthISODate(monthKey);
  const rescheduledFromMonth =
    input.rescheduledFromMonth &&
    OPEX_SCHEMA_LIMITS.monthKeyPattern.test(input.rescheduledFromMonth.trim())
      ? input.rescheduledFromMonth.trim()
      : undefined;
  const rescheduledToMonth =
    dbStatus === 'Reschedule' &&
    input.rescheduledToMonth &&
    OPEX_SCHEMA_LIMITS.monthKeyPattern.test(input.rescheduledToMonth.trim())
      ? input.rescheduledToMonth.trim()
      : undefined;

  const cleanRealisasi = sanitizeOptionalRealisasi(
    input.realisasiAmount ?? input.actualAmount
  );
  const monthRealisasi = sanitizeMonthRealisasi(input.monthRealisasi);

  return {
    name:
      String(input.name ?? '').trim().slice(0, OPEX_SCHEMA_LIMITS.nameMax) ||
      'Biaya Operasional',
    category: sanitizeCategory(input.category),
    amount,
    ...(cleanRealisasi !== undefined
      ? { realisasiAmount: cleanRealisasi, actualAmount: cleanRealisasi }
      : {}),
    monthKey,
    expenseDate,
    ...(endMonthKey ? { endMonthKey } : {}),
    ...(dueDay ? { dueDay } : {}),
    ...(sourceAccountId ? { sourceAccountId } : {}),
    ...(sourceAccountName ? { sourceAccountName } : {}),
    isRecurring: Boolean(input.isRecurring),
    status: dbStatus,
    statusWarna: dbWarna,
    ...(rescheduledFromMonth ? { rescheduledFromMonth } : {}),
    ...(rescheduledToMonth ? { rescheduledToMonth } : {}),
    rescheduledMonths: sanitizeRescheduledMonths(input.rescheduledMonths),
    monthStatuses: sanitizeMonthStatuses(input.monthStatuses),
    ...(Object.keys(monthRealisasi).length > 0 ? { monthRealisasi } : {}),
    paidDates: sanitizePaidDates(input.paidDates),
    notes: String(input.notes ?? '').trim().slice(0, OPEX_SCHEMA_LIMITS.notesMax),
  };
}

function normalizeOpexItem(raw: Record<string, unknown>, fallbackId: string): OpexItem {
  const { data: monthRealisasiData, meta: monthRealisasiMeta } = unpackObjectWithMeta(
    raw.month_realisasi ?? raw.monthRealisasi
  );
  const { data: monthStatusesData, meta: monthStatusesMeta } = unpackObjectWithMeta(
    raw.month_statuses ?? raw.monthStatuses
  );
  const { data: paidDatesData, meta: paidDatesMeta } = unpackObjectWithMeta(
    raw.paid_dates ?? raw.paidDates
  );
  const { notes: unpackedNotes, meta: notesMeta } = unpackNotesWithMeta(
    raw.notes ?? raw.note
  );
  const meta: Record<string, unknown> = {
    ...notesMeta,
    ...paidDatesMeta,
    ...monthStatusesMeta,
    ...monthRealisasiMeta,
  };

  const rawEndMonth =
    raw.end_month_key ?? raw.endMonthKey ?? meta.end_month_key ?? meta.endMonthKey;
  const rawDueDay = raw.due_day ?? raw.dueDay ?? meta.due_day ?? meta.dueDay;
  const rawSourceAccountId =
    raw.source_account_id ??
    raw.sourceAccountId ??
    meta.source_account_id ??
    meta.sourceAccountId;
  const rawSourceAccountName =
    raw.source_account_name ??
    raw.sourceAccountName ??
    meta.source_account_name ??
    meta.sourceAccountName;
  const rawIsRecurring =
    raw.is_recurring ?? raw.isRecurring ?? meta.is_recurring ?? meta.isRecurring;

  const resolvedMonthStatuses =
    Object.keys(monthStatusesData).length > 0
      ? monthStatusesData
      : meta.month_statuses ?? meta.monthStatuses;
  const resolvedPaidDates =
    Object.keys(paidDatesData).length > 0
      ? paidDatesData
      : meta.paid_dates ?? meta.paidDates;

  const rawExpenseDate = normalizeToIsoDate(
    raw.expense_date ?? raw.expenseDate ?? meta.expense_date
  );
  const resolvedMonthKey = String(
    raw.month ??
      raw.month_key ??
      raw.monthKey ??
      meta.month ??
      meta.month_key ??
      (rawExpenseDate ? rawExpenseDate.slice(0, 7) : '') ??
      getTodayISODate().slice(0, 7)
  )
    .trim()
    .slice(0, 7);

  const statusWarna = sanitizeStatusWarna(
    raw.status_warna ?? raw.statusWarna ?? meta.status_warna,
    raw.status ?? meta.status
  );
  const status = sanitizeStatus(raw.status ?? meta.status, statusWarna);

  const resolvedRescheduledMonths = sanitizeRescheduledMonths(
    raw.rescheduled_months ??
      raw.rescheduledMonths ??
      meta.rescheduled_months ??
      meta.rescheduledMonths
  );
  const rawRescheduledFrom =
    raw.rescheduled_from_month ??
    raw.rescheduledFromMonth ??
    meta.rescheduled_from_month ??
    meta.rescheduledFromMonth;
  const rawRescheduledTo =
    raw.rescheduled_to_month ??
    raw.rescheduledToMonth ??
    meta.rescheduled_to_month ??
    meta.rescheduledToMonth;

  const resolvedMonthRealisasi =
    Object.keys(monthRealisasiData).length > 0
      ? monthRealisasiData
      : meta.month_realisasi ?? meta.monthRealisasi;
  const resolvedRealisasiAmount = sanitizeOptionalRealisasi(
    raw.realisasi_amount ??
      raw.realisasiAmount ??
      raw.actual_amount ??
      raw.actualAmount ??
      meta.realisasi_amount ??
      meta.realisasiAmount ??
      meta.actual_amount ??
      meta.actualAmount
  );

  const clean = sanitizeOpexInput({
    name: String(raw.description ?? raw.name ?? meta.description ?? meta.name ?? ''),
    category: sanitizeCategory(raw.category ?? meta.category ?? 'OPERASIONAL'),
    amount: Number(raw.amount ?? meta.amount ?? 0),
    ...(resolvedRealisasiAmount !== undefined
      ? { realisasiAmount: resolvedRealisasiAmount, actualAmount: resolvedRealisasiAmount }
      : {}),
    monthKey: OPEX_SCHEMA_LIMITS.monthKeyPattern.test(resolvedMonthKey)
      ? resolvedMonthKey
      : getTodayISODate().slice(0, 7),
    expenseDate: rawExpenseDate ?? undefined,
    endMonthKey: rawEndMonth ? String(rawEndMonth) : undefined,
    dueDay: rawDueDay ? Number(rawDueDay) : undefined,
    sourceAccountId: rawSourceAccountId ? String(rawSourceAccountId) : undefined,
    sourceAccountName: rawSourceAccountName ? String(rawSourceAccountName) : undefined,
    isRecurring: Boolean(rawIsRecurring),
    status,
    statusWarna,
    rescheduledFromMonth: rawRescheduledFrom ? String(rawRescheduledFrom) : undefined,
    rescheduledToMonth: rawRescheduledTo ? String(rawRescheduledTo) : undefined,
    rescheduledMonths: resolvedRescheduledMonths,
    monthStatuses: sanitizeMonthStatuses(resolvedMonthStatuses),
    monthRealisasi: sanitizeMonthRealisasi(resolvedMonthRealisasi),
    paidDates: sanitizePaidDates(resolvedPaidDates),
    notes: unpackedNotes || String(meta.notes ?? ''),
  });

  const deleteReason =
    typeof raw.delete_reason === 'string' && raw.delete_reason.trim()
      ? raw.delete_reason.trim()
      : undefined;

  return {
    id: String(raw.id ?? fallbackId),
    ...clean,
    ...(deleteReason ? { deleteReason } : {}),
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

function toRawOpexDbRecord(
  clean: OpexInput,
  options?: { id?: string; createdAt?: string; updatedAt?: string }
): Record<string, unknown> {
  const { dbStatus, dbWarna } = mapOpexStatusToDbFields(
    clean.status,
    clean.statusWarna
  );
  const expenseDate =
    normalizeToIsoDate(clean.expenseDate) ?? getEndOfMonthISODate(clean.monthKey);

  const cleanRealisasi = clean.realisasiAmount ?? clean.actualAmount ?? null;

  return {
    ...(options?.id ? { id: options.id } : {}),
    description: clean.name,
    name: clean.name,
    category: clean.category || 'OPERASIONAL',
    amount: clean.amount,
    actual_amount: cleanRealisasi,
    realisasi_amount: cleanRealisasi,
    expense_date: expenseDate,
    month: clean.monthKey,
    month_key: clean.monthKey,
    status: dbStatus,
    status_warna: dbWarna,
    rescheduled_from_month: clean.rescheduledFromMonth ?? '',
    rescheduled_to_month: clean.rescheduledToMonth ?? '',
    rescheduled_months: clean.rescheduledMonths ?? {},
    end_month_key: clean.endMonthKey ?? '',
    due_day: clean.dueDay ?? null,
    source_account_id: clean.sourceAccountId ?? null,
    source_account_name: clean.sourceAccountName ?? null,
    is_recurring: Boolean(clean.isRecurring),
    month_statuses: clean.monthStatuses ?? {},
    month_realisasi: clean.monthRealisasi ?? {},
    paid_dates: clean.paidDates ?? {},
    notes: clean.notes ?? '',
    ...(options?.createdAt ? { created_at: options.createdAt } : {}),
    updated_at: options?.updatedAt ?? new Date().toISOString(),
  };
}

export function sanitizeOpexDbPayload(
  clean: OpexInput,
  schema: SupabaseTableSchema | null,
  options?: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    excludedColumns?: ReadonlySet<string>;
    isUpdate?: boolean;
  }
): Record<string, unknown> {
  const idColMeta = schema?.columns.get('id');
  const idIsNumeric = isNumericColumnSchema(idColMeta);
  const shouldIncludeId =
    !options?.isUpdate &&
    Boolean(options?.id) &&
    !idIsNumeric &&
    !options?.excludedColumns?.has('id') &&
    (!schema || (idColMeta?.format ?? '').toLowerCase() === 'uuid');

  const rawRecord = toRawOpexDbRecord(clean, {
    ...options,
    id: shouldIncludeId ? options?.id : undefined,
  });

  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: rawRecord,
    fallbackColumns: OPEX_FALLBACK_WHITELIST,
    schema,
    aliases: OPEX_COLUMN_ALIASES,
    excludeFromDropped: OPEX_EXCLUDE_FROM_DROPPED,
    excludedColumns: options?.excludedColumns,
  });

  if (options?.isUpdate) {
    delete payload.id;
    delete payload.created_at;
  }

  if (Object.keys(dropped).length > 0) {
    if ('month_statuses' in payload) {
      payload.month_statuses = packObjectWithMeta(
        (clean.monthStatuses ?? {}) as Record<string, unknown>,
        dropped
      );
    } else if ('paid_dates' in payload) {
      payload.paid_dates = packObjectWithMeta(
        (clean.paidDates ?? {}) as Record<string, unknown>,
        dropped
      );
    } else if ('notes' in payload) {
      payload.notes = packNotesWithMeta(String(payload.notes ?? ''), dropped, 4000);
    } else if ('note' in payload) {
      payload.note = packNotesWithMeta(String(payload.note ?? ''), dropped, 4000);
    }
  }

  return payload;
}

function sortOpex(items: OpexItem[]): OpexItem[] {
  return [...items].sort((a, b) => {
    const dueA = a.dueDay ?? 99;
    const dueB = b.dueDay ?? 99;
    if (dueA !== dueB) return dueA - dueB;
    return a.name.localeCompare(b.name, 'id');
  });
}

function notifyListeners(items: OpexItem[]): void {
  const sorted = sortOpex(items);
  latestOpexItems = sorted;
  for (const listener of listeners) {
    listener(sorted);
  }
}

export function isOpexActiveInMonth(item: OpexItem, monthKey: string): boolean {
  if (item.deleteReason) return false;
  if (!OPEX_SCHEMA_LIMITS.monthKeyPattern.test(monthKey)) return false;
  if (!item.isRecurring) {
    return item.monthKey === monthKey;
  }
  if (monthKey < item.monthKey) return false;
  if (item.endMonthKey && monthKey > item.endMonthKey) return false;
  return true;
}

export function getOpexColorForMonth(
  item: OpexItem,
  monthKey: string
): 'white' | 'green' | 'red' {
  const monthStatus = item.monthStatuses?.[monthKey];
  if (monthStatus) {
    return mapOpexDbFieldsToColor(monthStatus, undefined);
  }
  if (item.rescheduledMonths?.[monthKey] && item.rescheduledMonths[monthKey] !== monthKey) {
    return 'red';
  }
  if (item.isRecurring) {
    return 'white';
  }
  return mapOpexDbFieldsToColor(item.status, item.statusWarna);
}

export function getOpexStatusForMonth(
  item: OpexItem,
  monthKey: string
): 'Not Paid' | 'Paid' | 'Reschedule' {
  const color = getOpexColorForMonth(item, monthKey);
  if (color === 'green') return 'Paid';
  if (color === 'red') return 'Reschedule';
  return 'Not Paid';
}

function resolveRealOpexRowId(rawId: string): string {
  const trimmed = String(rawId ?? '').trim();
  if (
    !trimmed ||
    trimmed.startsWith('grp_') ||
    trimmed.includes('|')
  ) {
    throw new Error(
      `ID Opex tidak valid ("${trimmed || 'kosong'}"). Aksi harus memakai ID baris asli dari Supabase, bukan ID grup.`
    );
  }
  const clean = trimmed.replace(/^opex_/, '').replace(/__\d{4}-\d{2}$/, '');
  if (!clean) {
    throw new Error('ID baris Opex asli tidak ditemukan.');
  }
  return clean;
}

function isTransientFetchError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message).toLowerCase()
      : String(err).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('err_network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch')
  );
}

function isRlsPolicyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: unknown; message?: unknown; status?: unknown };
  const code = String(rec.code ?? '');
  const status = Number(rec.status ?? 0);
  const msg = String(rec.message ?? '').toLowerCase();
  return (
    code === '42501' ||
    status === 401 ||
    status === 403 ||
    msg.includes('row-level security') ||
    msg.includes('permission denied') ||
    msg.includes('policy')
  );
}

function formatOpexMutationError(context: string, err: unknown): Error {
  if (isTransientFetchError(err)) {
    const offlineHint =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'Perangkat sedang offline.'
        : 'Periksa koneksi internet, URL Supabase, atau konfigurasi CORS / RLS DELETE pada tabel opex.';
    return reportSupabaseError(
      context,
      new Error(`Koneksi jaringan ke Supabase gagal (Failed to fetch). ${offlineHint}`)
    );
  }
  if (isRlsPolicyError(err)) {
    return reportSupabaseError(
      context,
      new Error(
        'Akses ditolak oleh RLS Policy Supabase pada tabel opex. Pastikan policy SELECT/INSERT/UPDATE/DELETE sudah aktif.'
      )
    );
  }
  return reportSupabaseError(context, err);
}

async function runWithFetchRetry<T>(
  operation: () => PromiseLike<T>,
  isRetryableResult?: (res: T) => unknown,
  maxAttempts = 3
): Promise<T> {
  const delays = [350, 800, 1200];
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      const errInside = isRetryableResult ? isRetryableResult(result) : null;
      if (!errInside || !isTransientFetchError(errInside) || attempt === maxAttempts - 1) {
        return result;
      }
      lastError = errInside;
    } catch (err) {
      if (!isTransientFetchError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, delays[attempt] ?? 500));
  }
  throw lastError;
}

export async function getOpexItems(): Promise<OpexItem[]> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Konfigurasi Supabase belum lengkap', configError, {
      showAlert: false,
    });
  }

  const { data, error } = await runWithFetchRetry(
    () => client.from(TABLE_NAME).select('*'),
    (res) => res.error
  );
  if (error) {
    throw reportSupabaseError('Gagal mengambil data Opex dari Supabase', error, {
      showAlert: false,
    });
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const normalized = rows
    .filter((row) => !(typeof row.delete_reason === 'string' && row.delete_reason.trim()))
    .map((row, idx) => normalizeOpexItem(row, String(row.id ?? `opx_${idx}`)));
  console.log(`[Supabase][${TABLE_NAME}] Fetched ${normalized.length} opex records`);
  return sortOpex(normalized);
}

export async function getOpexItemsByMonth(monthKey: string): Promise<OpexItem[]> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Konfigurasi Supabase belum lengkap', configError, {
      showAlert: false,
    });
  }

  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('month', monthKey);

  if (error) {
    throw reportSupabaseError(
      `Gagal mengambil data Opex bulan ${monthKey} dari Supabase`,
      error,
      { showAlert: false }
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const normalized = rows
    .filter((row) => !(typeof row.delete_reason === 'string' && row.delete_reason.trim()))
    .map((row, idx) => normalizeOpexItem(row, String(row.id ?? `opx_${idx}`)));
  console.log(
    `[Supabase][${TABLE_NAME}] Fetched ${normalized.length} opex records for month="${monthKey}"`
  );
  return sortOpex(normalized);
}

export async function getOpexItemsByRange(
  startMonthKey: string,
  endMonthKey: string
): Promise<OpexItem[]> {
  const client = requireSupabaseClient();
  const safeStart = normalizeMonthKeyYYYYMM(startMonthKey);
  const safeEnd = normalizeMonthKeyYYYYMM(endMonthKey);
  const observed = getObservedTableColumns(TABLE_NAME);

  let query = client.from(TABLE_NAME).select('*');
  if (!observed || observed.has('month')) {
    query = query.gte('month', safeStart).lte('month', safeEnd);
  } else if (observed.has('month_key')) {
    query = query.gte('month_key', safeStart).lte('month_key', safeEnd);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Gagal mengambil data Opex (${safeStart} s/d ${safeEnd}): ${error.message}`
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const normalized = rows
    .filter((row) => !(typeof row.delete_reason === 'string' && row.delete_reason.trim()))
    .map((row, idx) => normalizeOpexItem(row, String(row.id ?? `opx_${idx}`)));
  return sortOpex(normalized);
}

export async function refreshOpexRangeFromSupabase(
  startMonthKey: string,
  endMonthKey: string
): Promise<OpexItem[]> {
  const safeStart = normalizeMonthKeyYYYYMM(startMonthKey);
  const safeEnd = normalizeMonthKeyYYYYMM(endMonthKey);
  const rangeRows = await getOpexItemsByRange(safeStart, safeEnd);
  const byId = new Map<string, OpexItem>();
  for (const existing of latestOpexItems) {
    if (existing.monthKey < safeStart || existing.monthKey > safeEnd) {
      byId.set(existing.id, existing);
    }
  }
  for (const item of rangeRows) {
    byId.set(item.id, item);
  }
  const merged = sortOpex(Array.from(byId.values()));
  notifyListeners(merged);
  return rangeRows;
}

export async function refreshOpexFromSupabase(): Promise<OpexItem[]> {
  const list = await getOpexItems();
  notifyListeners(list);
  return list;
}

export async function refreshOpexByMonthFromSupabase(
  monthKey: string
): Promise<OpexItem[]> {
  const safeMonth = normalizeMonthKeyYYYYMM(monthKey);
  return refreshOpexRangeFromSupabase(safeMonth, safeMonth);
}

export function subscribeOpexItems(
  onData: (items: OpexItem[]) => void,
  _options?: { readOnly?: boolean }
): () => void {
  listeners.add(onData);

  if (!supabase) {
    onData([]);
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const fetchOpexItems = async () => {
    if (cancelled) return;
    try {
      const list = await getOpexItems();
      if (cancelled) return;
      notifyListeners(list);
    } catch {
      if (!cancelled) {
        onData(latestOpexItems);
      }
    }
  };

  void fetchOpexItems();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchOpexItems();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function createOpexItem(input: OpexInput): Promise<string> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan data Opex ke Supabase', configError);
  }

  const generatedId = generateUuid();
  const clean = sanitizeOpexInput(input);
  const nowIso = new Date().toISOString();

  const { data, error } = await runWithFetchRetry(
    () =>
      runWhitelistedSupabaseMutation({
        tableName: TABLE_NAME,
        operation: 'insert',
        buildPayload: (schema, excluded) =>
          sanitizeOpexDbPayload(clean, schema, {
            id: generatedId,
            createdAt: nowIso,
            updatedAt: nowIso,
            excludedColumns: excluded,
          }),
        execute: (payload) =>
          client.from(TABLE_NAME).insert([payload]).select().single(),
      }),
    (res) => res.error
  );

  if (error) {
    throw formatOpexMutationError('Gagal menyimpan data Opex ke Supabase', error);
  }

  const saved = normalizeOpexItem((data ?? {}) as Record<string, unknown>, generatedId);
  await refreshOpexFromSupabase();
  return saved.id;
}

export async function updateOpexItem(id: string, input: OpexInput): Promise<void> {
  const cleanId = resolveRealOpexRowId(id);
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memperbarui data Opex di Supabase', configError);
  }

  const clean = sanitizeOpexInput(input);
  const { data, error } = await runWithFetchRetry(
    () =>
      runWhitelistedSupabaseMutation({
        tableName: TABLE_NAME,
        operation: 'update',
        buildPayload: (schema, excluded) =>
          sanitizeOpexDbPayload(clean, schema, {
            updatedAt: new Date().toISOString(),
            excludedColumns: excluded,
            isUpdate: true,
          }),
        execute: (payload) =>
          client.from(TABLE_NAME).update(payload).eq('id', cleanId).select().single(),
      }),
    (res) => res.error
  );

  if (error) {
    throw formatOpexMutationError(`Gagal memperbarui data Opex (${cleanId}) di Supabase`, error);
  }
  if (!data) {
    throw reportSupabaseError(
      `Data Opex (${cleanId}) tidak terupdate di Supabase`,
      new Error('0 baris terupdate. Periksa RLS policy atau ID baris.')
    );
  }

  await refreshOpexFromSupabase();
}

export async function setOpexMonthPaymentStatus(
  id: string,
  monthKey: string,
  status: OpexPaymentStatus,
  statusWarna?: OpexStatusWarna,
  targetMonthKey?: string
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memperbarui status Opex di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data Opex (${id}) dari Supabase`,
      fetchErr ?? new Error('Data tidak ditemukan')
    );
  }

  const target = normalizeOpexItem(row as Record<string, unknown>, id);
  const { dbStatus, dbWarna } = mapOpexStatusToDbFields(status, statusWarna);
  const nextMonthStatuses: Record<string, OpexPaymentStatus> = {
    ...(target.monthStatuses ?? {}),
  };
  const nextPaidDates: Record<string, string> = { ...(target.paidDates ?? {}) };
  const nextMonthRealisasi: Record<string, number> = { ...(target.monthRealisasi ?? {}) };
  const nextRescheduledMonths: Record<string, string> = {
    ...(target.rescheduledMonths ?? {}),
  };

  let nextMonthKey = target.monthKey;
  let nextExpenseDate = target.expenseDate;
  let nextRescheduledFromMonth = target.rescheduledFromMonth;
  let nextRescheduledToMonth = target.rescheduledToMonth;
  let nextRealisasiAmount = target.realisasiAmount ?? target.actualAmount;
  let effectiveItemStatus: OpexPaymentStatus = dbStatus;
  let effectiveItemWarna: OpexStatusWarna = dbWarna;

  if (dbStatus === 'Paid') {
    nextMonthStatuses[monthKey] = 'Paid';
    nextPaidDates[monthKey] = getTodayISODate();
    delete nextRescheduledMonths[monthKey];
    if (!target.isRecurring) {
      nextRescheduledToMonth = undefined;
    }
  } else if (dbStatus === 'Reschedule') {
    delete nextPaidDates[monthKey];
    delete nextMonthRealisasi[monthKey];
    if (!target.isRecurring) {
      nextRealisasiAmount = undefined;
    }
    const cleanTargetMonth =
      targetMonthKey && OPEX_SCHEMA_LIMITS.monthKeyPattern.test(targetMonthKey.trim())
        ? targetMonthKey.trim()
        : undefined;

    nextMonthStatuses[monthKey] = 'Reschedule';
    if (cleanTargetMonth && cleanTargetMonth !== monthKey) {
      nextRescheduledMonths[monthKey] = cleanTargetMonth;
      nextRescheduledFromMonth = monthKey;
      nextRescheduledToMonth = cleanTargetMonth;
    } else {
      nextRescheduledFromMonth = monthKey;
      nextRescheduledToMonth = cleanTargetMonth ?? target.rescheduledToMonth ?? monthKey;
    }
    if (!target.isRecurring) {
      effectiveItemStatus = 'Reschedule';
      effectiveItemWarna = 'MERAH';
    }
  } else {
    nextMonthStatuses[monthKey] = 'Not Paid';
    delete nextPaidDates[monthKey];
    delete nextMonthRealisasi[monthKey];
    delete nextRescheduledMonths[monthKey];
    if (nextRescheduledFromMonth === monthKey) {
      nextRescheduledFromMonth = undefined;
      nextRescheduledToMonth = undefined;
    }
    if (!target.isRecurring) {
      nextRescheduledFromMonth = undefined;
      nextRescheduledToMonth = undefined;
      nextRealisasiAmount = undefined;
    }
  }

  const nextInput: OpexInput = sanitizeOpexInput({
    ...target,
    ...(nextRealisasiAmount !== undefined
      ? { realisasiAmount: nextRealisasiAmount, actualAmount: nextRealisasiAmount }
      : { realisasiAmount: undefined, actualAmount: undefined }),
    monthKey: nextMonthKey,
    expenseDate: nextExpenseDate,
    status: target.isRecurring ? target.status : effectiveItemStatus,
    statusWarna: target.isRecurring ? target.statusWarna : effectiveItemWarna,
    rescheduledFromMonth: nextRescheduledFromMonth,
    rescheduledToMonth: nextRescheduledToMonth,
    rescheduledMonths: nextRescheduledMonths,
    monthStatuses: nextMonthStatuses,
    monthRealisasi: nextMonthRealisasi,
    paidDates: nextPaidDates,
  });

  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeOpexDbPayload(nextInput, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
        isUpdate: true,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui status Opex (${id}) di Supabase`, error);
  }
  if (!data) {
    throw reportSupabaseError(
      `Status Opex (${id}) tidak terupdate di Supabase`,
      new Error('0 baris terupdate.')
    );
  }

  await refreshOpexFromSupabase();
}

export async function deleteOpexItem(id: string): Promise<void> {
  const cleanId = resolveRealOpexRowId(id);
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus data Opex di Supabase', configError);
  }

  const deleteResult = await runWithFetchRetry(
    async () => {
      const withSelect = await client
        .from(TABLE_NAME)
        .delete()
        .eq('id', cleanId)
        .select('id');
      if (!withSelect.error) {
        return withSelect;
      }
      // Jika policy RLS mengizinkan DELETE tetapi memblokir RETURNING/SELECT, fallback ke delete tanpa select
      if (isRlsPolicyError(withSelect.error)) {
        const plainDelete = await client.from(TABLE_NAME).delete().eq('id', cleanId);
        return { data: null, error: plainDelete.error };
      }
      return withSelect;
    },
    (res) => res.error
  );

  if (deleteResult.error) {
    throw formatOpexMutationError(
      `Gagal menghapus data Opex (${cleanId}) di Supabase`,
      deleteResult.error
    );
  }

  // Verifikasi jika .delete().select('id') mengembalikan 0 baris (mungkin terblokir RLS DELETE)
  if (Array.isArray(deleteResult.data) && deleteResult.data.length === 0) {
    try {
      const { data: stillExists } = await client
        .from(TABLE_NAME)
        .select('id')
        .eq('id', cleanId)
        .maybeSingle();
      if (stillExists) {
        throw formatOpexMutationError(
          `Gagal menghapus data Opex (${cleanId}) di Supabase`,
          new Error(
            '0 baris terhapus (row masih ada di database). Pastikan policy RLS DELETE untuk tabel opex aktif.'
          )
        );
      }
    } catch (verifyErr) {
      if (verifyErr instanceof Error && verifyErr.message.includes('RLS')) {
        throw verifyErr;
      }
    }
  }

  // Optimistic notify + full refresh dari Supabase
  if (latestOpexItems.some((item) => item.id === cleanId)) {
    notifyListeners(latestOpexItems.filter((item) => item.id !== cleanId));
  }
  await refreshOpexFromSupabase();
}

export async function updateOpexRealisasi(
  id: string,
  monthKey: string,
  realisasiAmount: number
): Promise<void> {
  if (!id || !id.trim()) {
    throw new Error('ID Opex wajib ada saat update Realisasi.');
  }

  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan Realisasi Opex ke Supabase', configError);
  }

  const cleanAmount = Number.isFinite(realisasiAmount)
    ? Math.max(0, Math.min(OPEX_SCHEMA_LIMITS.maxAmount, Math.round(realisasiAmount)))
    : 0;
  const cleanMonthKey = OPEX_SCHEMA_LIMITS.monthKeyPattern.test(monthKey)
    ? monthKey
    : getTodayISODate().slice(0, 7);

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw reportSupabaseError(`Gagal membaca Opex (${id}) sebelum update Realisasi`, fetchErr);
  }

  const rawRow = (row ?? {}) as Record<string, unknown>;
  const existing = row ? normalizeOpexItem(rawRow, id) : null;
  const { meta: monthRealisasiMeta } = unpackObjectWithMeta(
    rawRow.month_realisasi ?? rawRow.monthRealisasi
  );
  const { meta: monthStatusesMeta } = unpackObjectWithMeta(
    rawRow.month_statuses ?? rawRow.monthStatuses
  );
  const { meta: paidDatesMeta } = unpackObjectWithMeta(rawRow.paid_dates ?? rawRow.paidDates);
  const { meta: notesMeta } = unpackNotesWithMeta(rawRow.notes ?? rawRow.note);

  const nextMonthRealisasi: Record<string, number> = {
    ...(existing?.monthRealisasi ?? {}),
    [cleanMonthKey]: cleanAmount,
  };
  const isSingleMonthMatch = !existing?.isRecurring || cleanMonthKey === existing.monthKey;

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) => {
      const nowIso = new Date().toISOString();
      const rawPatch: Record<string, unknown> = {
        month_realisasi: nextMonthRealisasi,
        ...(isSingleMonthMatch
          ? { realisasi_amount: cleanAmount, actual_amount: cleanAmount }
          : {}),
        updated_at: nowIso,
      };
      const { payload } = sanitizePayloadByWhitelist({
        rawPayload: rawPatch,
        fallbackColumns: OPEX_FALLBACK_WHITELIST,
        schema,
        aliases: OPEX_COLUMN_ALIASES,
        excludeFromDropped: OPEX_EXCLUDE_FROM_DROPPED,
        excludedColumns: excluded,
      });

      const hasMonthRealCol = 'month_realisasi' in payload;
      const hasAmountRealCol = 'realisasi_amount' in payload || 'actual_amount' in payload;

      if (!hasMonthRealCol && (!isSingleMonthMatch || !hasAmountRealCol)) {
        const mergedMeta: Record<string, unknown> = {
          ...notesMeta,
          ...paidDatesMeta,
          ...monthStatusesMeta,
          ...monthRealisasiMeta,
          month_realisasi: nextMonthRealisasi,
          ...(isSingleMonthMatch
            ? { realisasi_amount: cleanAmount, actual_amount: cleanAmount }
            : {}),
        };
        if (existing && (!schema || schema.columns.has('month_statuses')) && !excluded.has('month_statuses')) {
          payload.month_statuses = packObjectWithMeta(
            (existing.monthStatuses ?? {}) as Record<string, unknown>,
            mergedMeta
          );
        } else if (existing && (!schema || schema.columns.has('paid_dates')) && !excluded.has('paid_dates')) {
          payload.paid_dates = packObjectWithMeta(
            (existing.paidDates ?? {}) as Record<string, unknown>,
            mergedMeta
          );
        } else if ((!schema || schema.columns.has('notes')) && !excluded.has('notes')) {
          payload.notes = packNotesWithMeta(existing?.notes ?? '', mergedMeta, 4000);
        } else if (schema?.columns.has('note') && !excluded.has('note')) {
          payload.note = packNotesWithMeta(existing?.notes ?? '', mergedMeta, 4000);
        }
      }

      return payload;
    },
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal menyimpan Realisasi Opex (${id}) ke Supabase`, error);
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal menyimpan Realisasi Opex (${id}) ke Supabase`,
      new Error(`0 baris terupdate untuk Opex (${id}). Periksa ID atau RLS policy.`)
    );
  }

  await refreshOpexFromSupabase();
}
