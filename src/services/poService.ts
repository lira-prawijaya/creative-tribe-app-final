import {
  generateUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseTableSchema,
} from '../lib/supabaseClient';
import {
  getObservedTableColumns,
  packArrayWithMeta,
  packNotesWithMeta,
  recordObservedTableColumns,
  runWhitelistedSupabaseMutation,
  sanitizePayloadByWhitelist,
  unpackArrayWithMeta,
  unpackNotesWithMeta,
} from '../lib/supabaseWhitelist';
import { AuditActor } from '../types/auth';
import { formatAuditTimestamp } from './auditLogService';
import {
  DocumentRevisionEntry,
  PaymentTermsMode,
  PO_SCHEMA_LIMITS,
  POLineItem,
  POStatus,
  PurchaseOrder,
  PurchaseOrderInput,
  RevisionSubStatus,
  VendorPphStatus,
  VendorPphType,
  VoidedInvoiceRecord,
} from '../types/po';
import {
  colorToDbStatusFields,
  StatusColorKey,
  StatusWarna,
} from '../types/statusWarna';
import {
  calculateDueDate,
  calculateVendorInvoiceTaxBreakdown,
  computeRevisionOutcome,
  generateNextRevisionInvoiceNumber,
  getNowRevisionTimestamp,
  getTodayISODate,
  getVendorPOEffectiveCostAmount,
  hasVendorInvoice,
  sanitizeOptionalPaymentTermsDays,
  sanitizePaymentTermsDays,
  sanitizePOInput,
  sanitizeRevisionEntries,
  sanitizeVendorPphStatus,
  sanitizeVendorPphType,
  sanitizeVoidedInvoiceRecords,
} from '../utils/format';
import { normalizeMonthKeyYYYYMM } from '../utils/bossReportCalc';
import { getEndOfMonthISODate } from './opexService';

const TABLE_NAME = 'purchase_orders';

type OrdersListener = (orders: PurchaseOrder[]) => void;
const listeners = new Set<OrdersListener>();
let latestOrders: PurchaseOrder[] = [];
let channelSeq = 0;

function generateDocumentId(): string {
  return generateUuid();
}

function getTimestampMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    const secs = Number((value as { seconds: unknown }).seconds);
    if (Number.isFinite(secs)) return secs * 1000;
  }
  return 0;
}

function sortOrders(list: PurchaseOrder[]): PurchaseOrder[] {
  return [...list].sort((a, b) => {
    const dateDiff = (b.poDate || '').localeCompare(a.poDate || '');
    if (dateDiff !== 0) return dateDiff;
    const timeDiff = getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return b.poNumber.localeCompare(a.poNumber);
  });
}

const PO_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'id',
  'po_number',
  'po_date',
  'vendor_name',
  'vendor_address',
  'project_name',
  'project_number',
  'items',
  'total_amount',
  'actual_amount',
  'realisasi_amount',
  'status',
  'note',
  'created_at',
  'updated_at',
]);

const PO_COLUMN_ALIASES: Record<string, string[]> = {
  note: ['notes'],
  notes: ['note'],
  dpp_amount: ['dpp'],
  net_akhir: ['net_amount'],
};

const PO_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
]);

function normalizePO(raw: Record<string, unknown>, fallbackId: string): PurchaseOrder {
  const { items: unpackedItems, meta: itemsMeta } = unpackArrayWithMeta<POLineItem>(raw.items);
  const { notes: unpackedNote, meta: noteMeta } = unpackNotesWithMeta(raw.note ?? raw.notes);
  const meta: Record<string, unknown> = { ...noteMeta, ...itemsMeta };

  const rawStatus = String(raw.status ?? meta.status ?? 'Draft').trim();
  const rawStatusLower = rawStatus.toLowerCase();
  const rawStatusWarna = String(
    raw.status_warna ?? raw.statusWarna ?? meta.status_warna ?? meta.statusWarna ?? ''
  )
    .trim()
    .toUpperCase();

  let validStatus: POStatus;
  let statusWarna: StatusWarna;
  if (rawStatusLower === 'paid' || rawStatusLower === 'lunas' || rawStatusWarna === 'HIJAU') {
    validStatus = 'Paid';
    statusWarna = 'HIJAU';
  } else if (
    rawStatusLower === 'reschedule' ||
    rawStatusLower === 'rescheduling' ||
    rawStatusLower === 'pending' ||
    rawStatusWarna === 'MERAH'
  ) {
    validStatus = 'Reschedule';
    statusWarna = 'MERAH';
  } else if (
    rawStatusLower === 'invoiced' ||
    rawStatusLower === 'sudah ditagih' ||
    rawStatusLower === 'overdue'
  ) {
    validStatus = 'Invoiced';
    statusWarna = 'PUTIH';
  } else if (rawStatusLower === 'sent' || rawStatusLower === 'terkirim') {
    validStatus = 'Sent';
    statusWarna = 'PUTIH';
  } else if (rawStatusLower === 'draft') {
    validStatus = 'Draft';
    statusWarna = 'PUTIH';
  } else if (rawStatusLower === 'not paid') {
    validStatus = 'Not Paid';
    statusWarna = 'PUTIH';
  } else {
    validStatus = 'Draft';
    statusWarna = 'PUTIH';
  }

  const rawReschedFrom = String(
    raw.rescheduled_from_month ??
      raw.rescheduledFromMonth ??
      meta.rescheduled_from_month ??
      meta.rescheduledFromMonth ??
      ''
  ).trim();
  const rescheduledFromMonth = /^\d{4}-\d{2}$/.test(rawReschedFrom) ? rawReschedFrom : undefined;

  const rawReschedTo = String(
    raw.rescheduled_to_month ??
      raw.rescheduledToMonth ??
      meta.rescheduled_to_month ??
      meta.rescheduledToMonth ??
      ''
  ).trim();
  const rescheduledToMonth = /^\d{4}-\d{2}$/.test(rawReschedTo) ? rawReschedTo : undefined;

  const invoiceDate = String(
    raw.invoice_date ?? raw.invoiceDate ?? meta.invoice_date ?? meta.invoiceDate ?? ''
  );
  const hasInvoiceDate = Boolean(
    invoiceDate && PO_SCHEMA_LIMITS.datePattern.test(invoiceDate)
  );
  const rawMode = String(
    raw.payment_terms_mode ??
      raw.paymentTermsMode ??
      meta.payment_terms_mode ??
      meta.paymentTermsMode ??
      ''
  );
  const paymentTermsMode: PaymentTermsMode | undefined =
    rawMode === 'MANUAL' ? 'MANUAL' : rawMode === 'NET' || hasInvoiceDate ? 'NET' : undefined;

  const rawTermsField =
    raw.payment_terms_days ??
    raw.paymentTermsDays ??
    meta.payment_terms_days ??
    meta.paymentTermsDays;
  const rawTerms =
    rawTermsField !== undefined && rawTermsField !== null && rawTermsField !== ''
      ? Number(rawTermsField)
      : undefined;
  const paymentTermsDays =
    paymentTermsMode === 'MANUAL'
      ? undefined
      : hasInvoiceDate
      ? sanitizePaymentTermsDays(rawTerms)
      : undefined;

  const rawDueDate = String(
    raw.due_date ?? raw.dueDate ?? meta.due_date ?? meta.dueDate ?? ''
  );
  const dueDate =
    paymentTermsMode === 'MANUAL'
      ? PO_SCHEMA_LIMITS.datePattern.test(rawDueDate)
        ? rawDueDate
        : ''
      : hasInvoiceDate && paymentTermsDays !== undefined
      ? PO_SCHEMA_LIMITS.datePattern.test(rawDueDate)
        ? rawDueDate
        : calculateDueDate(invoiceDate, paymentTermsDays)
      : '';

  const rawSub = String(
    raw.revision_sub_status ??
      raw.revisionSubStatus ??
      meta.revision_sub_status ??
      meta.revisionSubStatus ??
      ''
  );
  const revisionSubStatus: RevisionSubStatus | undefined =
    rawSub === 'Revisi' ||
    rawSub === 'Menunggu Pembayaran Ulang' ||
    rawSub === 'Menunggu Konfirmasi'
      ? rawSub
      : rawSub === ''
      ? ''
      : undefined;

  const rawPrevPaid =
    raw.previous_paid_amount ??
    raw.previousPaidAmount ??
    meta.previous_paid_amount ??
    meta.previousPaidAmount;
  const previousPaidAmount =
    rawPrevPaid !== undefined && rawPrevPaid !== null && Number.isFinite(Number(rawPrevPaid))
      ? Number(rawPrevPaid)
      : undefined;

  const rawRevisions = raw.revisions ?? meta.revisions;
  const revisions = sanitizeRevisionEntries(
    Array.isArray(rawRevisions) ? (rawRevisions as DocumentRevisionEntry[]) : undefined
  );
  const rawVoided =
    raw.voided_invoices ??
    raw.voidedInvoices ??
    meta.voided_invoices ??
    meta.voidedInvoices;
  const voidedInvoices = sanitizeVoidedInvoiceRecords(
    Array.isArray(rawVoided) ? (rawVoided as VoidedInvoiceRecord[]) : undefined
  );

  const rawRealisasiField =
    raw.realisasi_amount ??
    raw.realisasiAmount ??
    raw.actual_amount ??
    raw.actualAmount ??
    meta.realisasi_amount ??
    meta.realisasiAmount ??
    meta.actual_amount ??
    meta.actualAmount;
  const parsedRealisasi =
    validStatus === 'Paid' &&
    rawRealisasiField !== undefined &&
    rawRealisasiField !== null &&
    rawRealisasiField !== '' &&
    Number.isFinite(Number(rawRealisasiField))
      ? Math.max(0, Math.round(Number(rawRealisasiField)))
      : undefined;

  const parseSafeNum = (v: unknown): number => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const parseSafeInt = (v: unknown): number => Math.round(parseSafeNum(v));

  const pphType: VendorPphType = sanitizeVendorPphType(
    raw.pph_type ?? raw.pphType ?? meta.pph_type ?? meta.pphType ?? 'NONE'
  );
  const ppnRate = Math.min(
    100,
    parseSafeNum(raw.ppn_rate ?? raw.ppnRate ?? meta.ppn_rate ?? meta.ppnRate)
  );
  const pphRate =
    pphType === 'NONE'
      ? 0
      : Math.min(
          100,
          parseSafeNum(raw.pph_rate ?? raw.pphRate ?? meta.pph_rate ?? meta.pphRate)
        );
  const dppAmount = parseSafeInt(
    raw.dpp_amount ?? raw.dppAmount ?? raw.dpp ?? meta.dpp_amount ?? meta.dppAmount ?? meta.dpp
  );
  const ppnAmount = parseSafeInt(
    raw.ppn_amount ?? raw.ppnAmount ?? meta.ppn_amount ?? meta.ppnAmount
  );
  const grossAmount = parseSafeInt(
    raw.gross_amount ?? raw.grossAmount ?? meta.gross_amount ?? meta.grossAmount
  );
  const pphAmount = parseSafeInt(
    raw.pph_amount ?? raw.pphAmount ?? meta.pph_amount ?? meta.pphAmount
  );
  const pphStatus: VendorPphStatus | undefined = (() => {
    const rawVal =
      raw.pph_status ?? raw.pphStatus ?? meta.pph_status ?? meta.pphStatus;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
      return undefined;
    }
    return sanitizeVendorPphStatus(rawVal);
  })();
  const pphDate = String(
    raw.pph_date ?? raw.pphDate ?? meta.pph_date ?? meta.pphDate ?? ''
  ).trim();
  const netAkhir = parseSafeInt(
    raw.net_akhir ??
      raw.net_amount ??
      raw.netAkhir ??
      meta.net_akhir ??
      meta.net_amount ??
      meta.netAkhir
  );

  return {
    id: String(raw.id ?? fallbackId),
    poNumber: String(raw.po_number ?? raw.poNumber ?? meta.po_number ?? ''),
    poDate: String(raw.po_date ?? raw.poDate ?? meta.po_date ?? ''),
    vendorName: String(raw.vendor_name ?? raw.vendorName ?? meta.vendor_name ?? ''),
    vendorAddress: String(raw.vendor_address ?? raw.vendorAddress ?? meta.vendor_address ?? ''),
    projectName: String(raw.project_name ?? raw.projectName ?? meta.project_name ?? ''),
    projectNumber: String(raw.project_number ?? raw.projectNumber ?? meta.project_number ?? ''),
    deliveryDate: String(
      raw.delivery_date ?? raw.deliveryDate ?? meta.delivery_date ?? meta.deliveryDate ?? ''
    ),
    items: unpackedItems,
    totalAmount: Number(raw.total_amount ?? raw.totalAmount ?? meta.total_amount ?? 0),
    ...(parsedRealisasi !== undefined
      ? { realisasiAmount: parsedRealisasi, actualAmount: parsedRealisasi }
      : {}),
    status: validStatus,
    statusWarna,
    ...(rescheduledFromMonth ? { rescheduledFromMonth } : {}),
    ...(rescheduledToMonth ? { rescheduledToMonth } : {}),
    invoiceDate,
    invoiceNumber: String(
      raw.invoice_number ?? raw.invoiceNumber ?? meta.invoice_number ?? meta.invoiceNumber ?? ''
    ),
    invoiceFileUrl: String(
      raw.invoice_file_url ??
        raw.invoiceFileUrl ??
        meta.invoice_file_url ??
        meta.invoiceFileUrl ??
        ''
    ),
    invoiceFileName: String(
      raw.invoice_file_name ??
        raw.invoiceFileName ??
        meta.invoice_file_name ??
        meta.invoiceFileName ??
        ''
    ),
    paymentTermsMode,
    paymentTermsDays,
    manualDueDateNote: String(
      raw.manual_due_date_note ??
        raw.manualDueDateNote ??
        meta.manual_due_date_note ??
        meta.manualDueDateNote ??
        ''
    ),
    dueDate,
    dppAmount,
    ppnRate,
    ppnAmount,
    grossAmount: grossAmount > 0 ? grossAmount : dppAmount > 0 ? dppAmount + ppnAmount : 0,
    pphType,
    pphRate,
    pphAmount,
    ...(pphStatus ? { pphStatus } : {}),
    ...(pphDate ? { pphDate } : {}),
    netAkhir,
    note: unpackedNote || String(meta.note ?? ''),
    revisionSubStatus,
    previousPaidAmount,
    revisions,
    voidedInvoices,
    isDeleted: Boolean(
      raw.is_deleted ?? raw.isDeleted ?? meta.is_deleted ?? meta.isDeleted
    ),
    deletedAt: String(
      raw.deleted_at ?? raw.deletedAt ?? meta.deleted_at ?? meta.deletedAt ?? ''
    ),
    deletedByName: String(
      raw.deleted_by_name ??
        raw.deletedByName ??
        meta.deleted_by_name ??
        meta.deletedByName ??
        ''
    ),
    deletedByEmail: String(
      raw.deleted_by_email ??
        raw.deletedByEmail ??
        meta.deleted_by_email ??
        meta.deletedByEmail ??
        ''
    ),
    deleteReason: String(
      raw.delete_reason ?? raw.deleteReason ?? meta.delete_reason ?? meta.deleteReason ?? ''
    ),
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

function toRawPODbRecord(
  sanitized: PurchaseOrderInput,
  options?: { id?: string; createdAt?: string; updatedAt?: string }
): Record<string, unknown> {
  const cleanRealisasi =
    sanitized.status === 'Paid'
      ? sanitized.realisasiAmount ?? sanitized.actualAmount ?? null
      : null;

  return {
    ...(options?.id ? { id: options.id } : {}),
    po_number: sanitized.poNumber,
    po_date: sanitized.poDate,
    vendor_name: sanitized.vendorName,
    vendor_address: sanitized.vendorAddress,
    project_name: sanitized.projectName,
    project_number: sanitized.projectNumber,
    delivery_date: sanitized.deliveryDate,
    items: sanitized.items,
    total_amount: sanitized.totalAmount,
    actual_amount: cleanRealisasi,
    realisasi_amount: cleanRealisasi,
    status: sanitized.status,
    status_warna:
      sanitized.statusWarna ??
      (sanitized.status === 'Paid'
        ? 'HIJAU'
        : sanitized.status === 'Reschedule'
        ? 'MERAH'
        : 'PUTIH'),
    rescheduled_from_month: sanitized.rescheduledFromMonth ?? '',
    rescheduled_to_month: sanitized.rescheduledToMonth ?? '',
    invoice_date: sanitized.invoiceDate ?? '',
    invoice_number: sanitized.invoiceNumber ?? '',
    invoice_file_url: sanitized.invoiceFileUrl ?? '',
    invoice_file_name: sanitized.invoiceFileName ?? '',
    payment_terms_mode:
      sanitized.paymentTermsMode === 'NET' || sanitized.paymentTermsMode === 'MANUAL'
        ? sanitized.paymentTermsMode
        : null,
    payment_terms_days:
      sanitized.paymentTermsMode !== 'MANUAL' &&
      typeof sanitized.paymentTermsDays === 'number' &&
      Number.isFinite(sanitized.paymentTermsDays)
        ? sanitized.paymentTermsDays
        : null,
    manual_due_date_note: sanitized.manualDueDateNote ?? '',
    due_date: sanitized.dueDate ?? '',
    dpp_amount:
      typeof sanitized.dppAmount === 'number' && Number.isFinite(sanitized.dppAmount)
        ? Math.max(0, Math.round(sanitized.dppAmount))
        : 0,
    ppn_rate:
      typeof sanitized.ppnRate === 'number' && Number.isFinite(sanitized.ppnRate)
        ? Math.max(0, Math.min(100, sanitized.ppnRate))
        : 0,
    ppn_amount:
      typeof sanitized.ppnAmount === 'number' && Number.isFinite(sanitized.ppnAmount)
        ? Math.max(0, Math.round(sanitized.ppnAmount))
        : 0,
    gross_amount:
      typeof sanitized.grossAmount === 'number' && Number.isFinite(sanitized.grossAmount)
        ? Math.max(0, Math.round(sanitized.grossAmount))
        : Math.max(
            0,
            Math.round((sanitized.dppAmount ?? 0) + (sanitized.ppnAmount ?? 0))
          ),
    pph_type: sanitizeVendorPphType(sanitized.pphType),
    pph_rate:
      sanitizeVendorPphType(sanitized.pphType) === 'NONE'
        ? 0
        : typeof sanitized.pphRate === 'number' && Number.isFinite(sanitized.pphRate)
        ? Math.max(0, Math.min(100, sanitized.pphRate))
        : 0,
    pph_amount:
      typeof sanitized.pphAmount === 'number' && Number.isFinite(sanitized.pphAmount)
        ? Math.max(0, Math.round(sanitized.pphAmount))
        : 0,
    pph_status: sanitized.pphStatus ?? '',
    pph_date: sanitized.pphDate ?? '',
    net_akhir:
      typeof sanitized.netAkhir === 'number' && Number.isFinite(sanitized.netAkhir)
        ? Math.max(0, Math.round(sanitized.netAkhir))
        : 0,
    note: sanitized.note ?? '',
    revision_sub_status: sanitized.revisionSubStatus ?? '',
    previous_paid_amount:
      typeof sanitized.previousPaidAmount === 'number' &&
      Number.isFinite(sanitized.previousPaidAmount)
        ? sanitized.previousPaidAmount
        : null,
    revisions: sanitized.revisions ?? [],
    voided_invoices: sanitized.voidedInvoices ?? [],
    is_deleted: Boolean(sanitized.isDeleted),
    deleted_at: sanitized.deletedAt ?? '',
    deleted_by_name: sanitized.deletedByName ?? '',
    deleted_by_email: sanitized.deletedByEmail ?? '',
    delete_reason: sanitized.deleteReason ?? '',
    ...(options?.createdAt ? { created_at: options.createdAt } : {}),
    updated_at: options?.updatedAt ?? new Date().toISOString(),
  };
}

export function sanitizePurchaseOrderDbPayload(
  sanitized: PurchaseOrderInput,
  schema: SupabaseTableSchema | null,
  options?: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    excludedColumns?: ReadonlySet<string>;
  }
): Record<string, unknown> {
  const rawRecord = toRawPODbRecord(sanitized, options);
  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: rawRecord,
    fallbackColumns: PO_FALLBACK_WHITELIST,
    schema,
    aliases: PO_COLUMN_ALIASES,
    excludeFromDropped: PO_EXCLUDE_FROM_DROPPED,
    excludedColumns: options?.excludedColumns,
  });

  if (Object.keys(dropped).length > 0) {
    if ('items' in payload) {
      payload.items = packArrayWithMeta(sanitized.items, dropped);
    } else if ('note' in payload) {
      payload.note = packNotesWithMeta(String(payload.note ?? ''), dropped, 4000);
    } else if ('notes' in payload) {
      payload.notes = packNotesWithMeta(String(payload.notes ?? ''), dropped, 4000);
    }
  }

  return payload;
}

function notifyListeners(orders: PurchaseOrder[]): void {
  const sorted = sortOrders(orders);
  latestOrders = sorted;
  for (const listener of listeners) {
    listener(sorted);
  }
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Konfigurasi Supabase belum lengkap', configError, {
      showAlert: false,
    });
  }

  const { data, error } = await client.from(TABLE_NAME).select('*');
  if (error) {
    throw reportSupabaseError('Gagal mengambil data Purchase Order dari Supabase', error, {
      showAlert: false,
    });
  }

  recordObservedTableColumns(TABLE_NAME, data);

  return sortOrders(
    (data ?? []).map((row, idx) =>
      normalizePO(
        row as Record<string, unknown>,
        String((row as { id?: unknown }).id ?? `po_${idx}`)
      )
    )
  );
}

export async function getPurchaseOrdersByRange(
  startMonthKey: string,
  endMonthKey: string
): Promise<PurchaseOrder[]> {
  const client = requireSupabaseClient();
  const safeStart = normalizeMonthKeyYYYYMM(startMonthKey);
  const safeEnd = normalizeMonthKeyYYYYMM(endMonthKey);
  const startDate = `${safeStart}-01`;
  const endDate = getEndOfMonthISODate(safeEnd);
  const observed = getObservedTableColumns(TABLE_NAME);

  let query = client.from(TABLE_NAME).select('*');
  if (observed?.has('month')) {
    query = query.gte('month', safeStart).lte('month', safeEnd);
  } else if (observed?.has('due_date')) {
    query = query.gte('due_date', startDate).lte('due_date', endDate);
  } else if (observed?.has('po_date')) {
    query = query.lte('po_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Gagal mengambil data Project Cost (${safeStart} s/d ${safeEnd}): ${error.message}`
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  return sortOrders(
    (data ?? []).map((row, idx) =>
      normalizePO(
        row as Record<string, unknown>,
        String((row as { id?: unknown }).id ?? `po_${idx}`)
      )
    )
  );
}

export async function refreshPurchaseOrdersRangeFromSupabase(
  startMonthKey: string,
  endMonthKey: string
): Promise<PurchaseOrder[]> {
  const rangeList = await getPurchaseOrdersByRange(startMonthKey, endMonthKey);
  const byId = new Map<string, PurchaseOrder>();
  for (const item of latestOrders) {
    byId.set(item.id, item);
  }
  for (const item of rangeList) {
    byId.set(item.id, item);
  }
  const merged = sortOrders(Array.from(byId.values()));
  notifyListeners(merged);
  return rangeList;
}

async function refreshPurchaseOrdersFromSupabase(): Promise<PurchaseOrder[]> {
  const list = await getPurchaseOrders();
  notifyListeners(list);
  return list;
}

export function subscribePurchaseOrders(
  onData: (orders: PurchaseOrder[]) => void,
  onError: (err: Error) => void,
  _options?: { readOnly?: boolean }
): () => void {
  listeners.add(onData);

  if (!supabase) {
    onData([]);
    onError(new Error('Supabase belum dikonfigurasi.'));
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const fetchPurchaseOrders = async () => {
    if (cancelled) return;
    try {
      const list = await getPurchaseOrders();
      if (cancelled) return;
      notifyListeners(list);
    } catch (err) {
      if (err instanceof Error) onError(err);
      if (!cancelled) onData(latestOrders);
    }
  };

  void fetchPurchaseOrders();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchPurchaseOrders();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function createPurchaseOrder(
  input: PurchaseOrderInput
): Promise<string> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan Purchase Order ke Supabase', configError);
  }

  const id = generateDocumentId();
  const sanitized = sanitizePOInput(input);
  const nowIso = new Date().toISOString();

  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'insert',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(sanitized, schema, {
        id,
        createdAt: nowIso,
        updatedAt: nowIso,
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).insert([payload]).select().single(),
  });

  if (error) {
    throw reportSupabaseError('Gagal menyimpan Purchase Order ke Supabase', error);
  }

  const saved = normalizePO((data ?? {}) as Record<string, unknown>, id);
  await refreshPurchaseOrdersFromSupabase().catch(() => {
    notifyListeners([saved, ...latestOrders.filter((x) => x.id !== saved.id)]);
  });
  return saved.id;
}

export async function updatePurchaseOrder(
  id: string,
  input: PurchaseOrderInput
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memperbarui Purchase Order di Supabase', configError);
  }

  const sanitized = sanitizePOInput(input);
  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(sanitized, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui Purchase Order (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export async function updatePurchaseOrderStatus(
  id: string,
  status: POStatus,
  invoiceMeta?: {
    invoiceDate?: string;
    invoiceNumber?: string;
    invoiceFileUrl?: string;
    invoiceFileName?: string;
    localAttachmentDataUrl?: string;
    paymentTermsMode?: PaymentTermsMode;
    paymentTermsDays?: number;
    manualDueDateNote?: string;
    dueDate?: string;
    dppAmount?: number;
    ppnRate?: number;
    ppnAmount?: number;
    grossAmount?: number;
    pphType?: VendorPphType;
    pphRate?: number;
    pphAmount?: number;
    pphStatus?: VendorPphStatus;
    pphDate?: string;
    netAkhir?: number;
  }
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memperbarui status PO di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data PO (${id}) dari Supabase`,
      fetchErr ?? new Error('PO tidak ditemukan')
    );
  }

  const po = normalizePO(row as Record<string, unknown>, id);
  const nextInvoiceDate =
    invoiceMeta?.invoiceDate !== undefined ? invoiceMeta.invoiceDate : po.invoiceDate ?? '';
  const hasInvDate = Boolean(
    nextInvoiceDate && PO_SCHEMA_LIMITS.datePattern.test(nextInvoiceDate)
  );
  const nextMode: PaymentTermsMode | undefined =
    invoiceMeta?.paymentTermsMode !== undefined
      ? invoiceMeta.paymentTermsMode
      : po.paymentTermsMode ?? (hasInvDate ? 'NET' : undefined);

  const nextTerms =
    nextMode === 'MANUAL'
      ? undefined
      : hasInvDate
      ? sanitizeOptionalPaymentTermsDays(
          invoiceMeta?.paymentTermsDays !== undefined
            ? invoiceMeta.paymentTermsDays
            : po.paymentTermsDays
        ) ?? 30
      : undefined;

  const nextDueDate =
    nextMode === 'MANUAL'
      ? (invoiceMeta?.dueDate !== undefined ? invoiceMeta.dueDate : po.dueDate ?? '').slice(0, 10)
      : hasInvDate && nextTerms !== undefined
      ? invoiceMeta?.dueDate !== undefined && invoiceMeta.dueDate !== ''
        ? invoiceMeta.dueDate
        : calculateDueDate(nextInvoiceDate, nextTerms)
      : '';

  const nextManualNote =
    nextMode === 'MANUAL'
      ? (invoiceMeta?.manualDueDateNote !== undefined
          ? invoiceMeta.manualDueDateNote
          : po.manualDueDateNote ?? ''
        )
          .trim()
          .slice(0, PO_SCHEMA_LIMITS.manualDueDateNoteMax)
      : '';

  const nextPO = sanitizePOInput({
    ...po,
    status,
    statusWarna:
      status === 'Paid' ? 'HIJAU' : status === 'Reschedule' ? 'MERAH' : 'PUTIH',
    ...(status === 'Paid'
      ? { rescheduledFromMonth: '', rescheduledToMonth: '' }
      : { realisasiAmount: undefined, actualAmount: undefined }),
    revisionSubStatus: status === 'Paid' ? '' : po.revisionSubStatus,
    invoiceDate:
      invoiceMeta?.invoiceDate !== undefined ? invoiceMeta.invoiceDate : po.invoiceDate ?? '',
    invoiceNumber:
      invoiceMeta?.invoiceNumber !== undefined
        ? invoiceMeta.invoiceNumber
        : po.invoiceNumber ?? '',
    invoiceFileUrl:
      invoiceMeta?.invoiceFileUrl !== undefined
        ? invoiceMeta.invoiceFileUrl.slice(0, PO_SCHEMA_LIMITS.invoiceFileUrlMax)
        : po.invoiceFileUrl ?? '',
    invoiceFileName:
      invoiceMeta?.invoiceFileName !== undefined
        ? invoiceMeta.invoiceFileName.slice(0, PO_SCHEMA_LIMITS.invoiceFileNameMax)
        : po.invoiceFileName ?? '',
    paymentTermsMode: nextMode,
    paymentTermsDays: nextMode === 'MANUAL' ? undefined : nextTerms,
    manualDueDateNote: nextManualNote,
    dueDate: nextDueDate,
    dppAmount:
      invoiceMeta?.dppAmount !== undefined
        ? Math.max(0, Math.round(Number(invoiceMeta.dppAmount) || 0))
        : po.dppAmount ?? 0,
    ppnRate:
      invoiceMeta?.ppnRate !== undefined
        ? Math.max(0, Math.min(100, Number(invoiceMeta.ppnRate) || 0))
        : po.ppnRate ?? 0,
    ppnAmount:
      invoiceMeta?.ppnAmount !== undefined
        ? Math.max(0, Math.round(Number(invoiceMeta.ppnAmount) || 0))
        : po.ppnAmount ?? 0,
    grossAmount:
      invoiceMeta?.grossAmount !== undefined
        ? Math.max(0, Math.round(Number(invoiceMeta.grossAmount) || 0))
        : Math.max(
            0,
            Math.round(
              (invoiceMeta?.dppAmount ?? po.dppAmount ?? 0) +
                (invoiceMeta?.ppnAmount ?? po.ppnAmount ?? 0)
            )
          ),
    pphType:
      invoiceMeta?.pphType !== undefined
        ? sanitizeVendorPphType(invoiceMeta.pphType)
        : po.pphType ?? 'NONE',
    pphRate:
      invoiceMeta?.pphRate !== undefined
        ? sanitizeVendorPphType(invoiceMeta.pphType ?? po.pphType) === 'NONE'
          ? 0
          : Math.max(0, Math.min(100, Number(invoiceMeta.pphRate) || 0))
        : po.pphRate ?? 0,
    pphAmount:
      invoiceMeta?.pphAmount !== undefined
        ? Math.max(0, Math.round(Number(invoiceMeta.pphAmount) || 0))
        : po.pphAmount ?? 0,
    pphStatus:
      invoiceMeta?.pphStatus !== undefined
        ? sanitizeVendorPphStatus(invoiceMeta.pphStatus)
        : po.pphStatus,
    pphDate:
      invoiceMeta?.pphDate !== undefined
        ? invoiceMeta.pphDate
        : po.pphDate ?? '',
    netAkhir:
      invoiceMeta?.netAkhir !== undefined
        ? Math.max(0, Math.round(Number(invoiceMeta.netAkhir) || 0))
        : po.netAkhir ?? 0,
  });

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(nextPO, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui status PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export async function submitPurchaseOrderPph(
  id: string,
  params: {
    pphType: VendorPphType;
    pphRate: number;
    pphDate?: string;
  }
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal submit PPh PO di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data PO (${id}) dari Supabase`,
      fetchErr ?? new Error('PO tidak ditemukan')
    );
  }

  const po = normalizePO(row as Record<string, unknown>, id);
  const dpp =
    Math.max(0, Math.round(Number(po.dppAmount) || 0)) ||
    Math.max(0, Math.round(Number(po.totalAmount) || 0));
  const ppnRate = Math.max(0, Math.min(100, Number(po.ppnRate) || 0));
  const pphType = sanitizeVendorPphType(params.pphType);
  const pphRate =
    pphType === 'NONE'
      ? 0
      : Math.max(0, Math.min(100, Number(params.pphRate) || (pphType === 'PPH21' ? 2.5 : 2)));
  const tax = calculateVendorInvoiceTaxBreakdown({
    dpp,
    ppnRate,
    pphType,
    pphRate,
  });
  const ppnAmount =
    tax.ppnAmount > 0 ? tax.ppnAmount : Math.max(0, Math.round(Number(po.ppnAmount) || 0));
  const grossAmount = dpp + ppnAmount;
  const netAkhir = Math.max(0, grossAmount - tax.pphAmount);
  const pphDate =
    params.pphDate && PO_SCHEMA_LIMITS.datePattern.test(params.pphDate)
      ? params.pphDate
      : getTodayISODate();

  const nextPO = sanitizePOInput({
    ...po,
    dppAmount: dpp,
    ppnRate,
    ppnAmount,
    grossAmount,
    pphType,
    pphRate,
    pphAmount: tax.pphAmount,
    pphStatus: 'Sudah Disubmit',
    pphDate,
    netAkhir,
  });

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(nextPO, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal menyimpan submit PPh PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export async function cancelPurchaseOrderInvoice(
  id: string,
  params: {
    targetStatus: 'Draft' | 'Sent';
    reason: string;
  }
): Promise<{
  poNumber: string;
  vendorName: string;
  previousInvoiceNumber: string;
  cancelledAmount: number;
  targetStatus: 'Draft' | 'Sent';
}> {
  const targetStatus: 'Draft' | 'Sent' =
    params.targetStatus === 'Sent' ? 'Sent' : 'Draft';
  const cleanReason = String(params.reason ?? '').trim();
  if (cleanReason.length < 5) {
    throw new Error('Alasan pembatalan wajib diisi minimal 5 karakter.');
  }

  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal membatalkan tagihan PO di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data PO (${id}) dari Supabase`,
      fetchErr ?? new Error('PO tidak ditemukan')
    );
  }

  const po = normalizePO(row as Record<string, unknown>, id);
  const rawDbStatus = String((row as Record<string, unknown>).status ?? '')
    .trim()
    .toUpperCase();
  if (po.status === 'Paid' || rawDbStatus === 'PAID' || rawDbStatus === 'LUNAS') {
    throw new Error('PO sudah lunas, batalkan pembayaran dulu');
  }

  const cancelledAmount = getVendorPOEffectiveCostAmount(po);
  const previousInvoiceNumber = po.invoiceNumber || '';

  const nextPO = sanitizePOInput({
    ...po,
    status: targetStatus,
    statusWarna: 'PUTIH',
    rescheduledFromMonth: '',
    rescheduledToMonth: '',
    realisasiAmount: undefined,
    actualAmount: undefined,
    revisionSubStatus: '',
    invoiceDate: '',
    invoiceNumber: '',
    invoiceFileUrl: '',
    invoiceFileName: '',
    paymentTermsMode: undefined,
    paymentTermsDays: undefined,
    manualDueDateNote: '',
    dueDate: '',
    dppAmount: 0,
    ppnRate: 0,
    ppnAmount: 0,
    grossAmount: 0,
    pphType: 'NONE',
    pphRate: 0,
    pphAmount: 0,
    pphStatus: undefined,
    pphDate: '',
    netAkhir: 0,
  });

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(nextPO, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal membatalkan tagihan PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();

  return {
    poNumber: po.poNumber,
    vendorName: po.vendorName,
    previousInvoiceNumber,
    cancelledAmount,
    targetStatus,
  };
}

export async function cancelPurchaseOrderPaid(
  id: string,
  params: {
    targetStatus: 'Draft' | 'Sent' | 'Invoiced';
    reason: string;
  }
): Promise<{
  poNumber: string;
  vendorName: string;
  previousInvoiceNumber: string;
  cancelledAmount: number;
  targetStatus: 'Draft' | 'Sent' | 'Invoiced';
}> {
  const targetStatus: 'Draft' | 'Sent' | 'Invoiced' =
    params.targetStatus === 'Sent'
      ? 'Sent'
      : params.targetStatus === 'Invoiced'
      ? 'Invoiced'
      : 'Draft';
  const cleanReason = String(params.reason ?? '').trim();
  if (cleanReason.length < 5) {
    throw new Error('Alasan pembatalan wajib diisi minimal 5 karakter.');
  }

  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal membatalkan status Lunas PO di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data PO (${id}) dari Supabase`,
      fetchErr ?? new Error('PO tidak ditemukan')
    );
  }

  const po = normalizePO(row as Record<string, unknown>, id);
  const cancelledAmount =
    po.realisasiAmount ?? po.actualAmount ?? getVendorPOEffectiveCostAmount(po);
  const previousInvoiceNumber = po.invoiceNumber || '';
  const clearInvoiceAndTax = targetStatus === 'Draft' || targetStatus === 'Sent';
  const keepInvDate = po.invoiceDate || getTodayISODate();
  const keepDueDate =
    po.dueDate ||
    calculateDueDate(
      keepInvDate,
      typeof po.paymentTermsDays === 'number' ? po.paymentTermsDays : 30
    );

  const nextPO = sanitizePOInput({
    ...po,
    status: targetStatus,
    statusWarna: 'PUTIH',
    rescheduledFromMonth: '',
    rescheduledToMonth: '',
    realisasiAmount: undefined,
    actualAmount: undefined,
    previousPaidAmount: undefined,
    revisionSubStatus: '',
    ...(clearInvoiceAndTax
      ? {
          invoiceDate: '',
          invoiceNumber: '',
          invoiceFileUrl: '',
          invoiceFileName: '',
          paymentTermsMode: undefined,
          paymentTermsDays: undefined,
          manualDueDateNote: '',
          dueDate: '',
          dppAmount: 0,
          ppnRate: 0,
          ppnAmount: 0,
          grossAmount: 0,
          pphType: 'NONE' as VendorPphType,
          pphRate: 0,
          pphAmount: 0,
          pphStatus: undefined,
          pphDate: '',
          netAkhir: 0,
        }
      : {
          invoiceDate: keepInvDate,
          dueDate: keepDueDate,
          paymentTermsMode: po.paymentTermsMode ?? 'NET',
          paymentTermsDays:
            po.paymentTermsMode === 'MANUAL' ? undefined : po.paymentTermsDays ?? 30,
        }),
  });

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(nextPO, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal membatalkan status Lunas PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();

  return {
    poNumber: po.poNumber,
    vendorName: po.vendorName,
    previousInvoiceNumber,
    cancelledAmount,
    targetStatus,
  };
}

export async function setPurchaseOrderStatusWarna(
  id: string,
  params: {
    color: StatusColorKey;
    targetMonthKey?: string;
    originMonthKey?: string;
  }
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal mengubah status warna PO di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data PO (${id}) dari Supabase`,
      fetchErr ?? new Error('PO tidak ditemukan')
    );
  }

  const po = normalizePO(row as Record<string, unknown>, id);
  const { status, statusWarna } = colorToDbStatusFields(params.color);

  let nextPO: PurchaseOrderInput;
  if (params.color === 'green') {
    nextPO = sanitizePOInput({
      ...po,
      status,
      statusWarna,
      revisionSubStatus: '',
      rescheduledFromMonth: '',
      rescheduledToMonth: '',
    });
  } else if (params.color === 'red') {
    const originMonth =
      params.originMonthKey && /^\d{4}-\d{2}$/.test(params.originMonthKey)
        ? params.originMonthKey
        : (
            po.dueDate ||
            po.invoiceDate ||
            po.deliveryDate ||
            po.poDate ||
            getTodayISODate()
          ).slice(0, 7);
    const targetMonthKey =
      params.targetMonthKey && /^\d{4}-\d{2}$/.test(params.targetMonthKey)
        ? params.targetMonthKey
        : originMonth;
    nextPO = sanitizePOInput({
      ...po,
      status: 'Reschedule',
      statusWarna: 'MERAH',
      realisasiAmount: undefined,
      actualAmount: undefined,
      rescheduledFromMonth: originMonth,
      rescheduledToMonth: targetMonthKey,
    });
  } else {
    const restoredStatus: POStatus = hasVendorInvoice(po)
      ? 'Invoiced'
      : po.status === 'Draft' || po.status === 'Sent'
      ? po.status
      : 'Not Paid';
    nextPO = sanitizePOInput({
      ...po,
      status: restoredStatus,
      statusWarna: 'PUTIH',
      realisasiAmount: undefined,
      actualAmount: undefined,
      rescheduledFromMonth: '',
      rescheduledToMonth: '',
    });
  }

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(nextPO, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui Status Warna PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export interface RevisePORequest {
  reason: string;
  revisedBy: string;
  newItems: POLineItem[];
  newInvoiceNumber?: string;
  newInvoiceDate?: string;
  newDueDate?: string;
  paymentTermsMode?: PaymentTermsMode;
  paymentTermsDays?: number;
  manualDueDateNote?: string;
}

export async function revisePurchaseOrder(
  id: string,
  params: RevisePORequest,
  fallbackPO?: PurchaseOrder
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal merevisi PO di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  const existing = row ? normalizePO(row as Record<string, unknown>, id) : fallbackPO;
  if (fetchErr && !existing) {
    throw reportSupabaseError('Purchase Order tidak ditemukan untuk direvisi.', fetchErr);
  }
  if (!existing) {
    throw new Error('Purchase Order tidak ditemukan untuk direvisi.');
  }

  const cleanReason = params.reason.trim().slice(0, PO_SCHEMA_LIMITS.revisionReasonMax);
  if (!cleanReason) {
    throw new Error('Alasan revisi wajib diisi.');
  }

  const cleanRevisedBy =
    params.revisedBy.trim().slice(0, PO_SCHEMA_LIMITS.revisedByMax) ||
    PO_SCHEMA_LIMITS.defaultRevisionUser;

  const cleanedItems: POLineItem[] = params.newItems
    .slice(0, PO_SCHEMA_LIMITS.maxItems)
    .map((item) => {
      const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
      const unitPrice =
        Number.isFinite(item.unitPrice) && item.unitPrice >= 0 ? item.unitPrice : 0;
      return {
        description:
          item.description.trim().slice(0, PO_SCHEMA_LIMITS.descriptionMax) || '-',
        quantity: qty,
        unitPrice,
        amount: Math.round(qty * unitPrice),
      };
    });

  const oldAmount = Math.max(0, Math.round(existing.totalAmount || 0));
  const newAmount = cleanedItems.reduce((sum, it) => sum + it.amount, 0);
  const wasPaid = existing.status === 'Paid';
  const { diffAmount, revisionSubStatus, resolutionNote } = computeRevisionOutcome(
    wasPaid,
    oldAmount,
    newAmount
  );

  const oldInvNumber = (existing.invoiceNumber || existing.poNumber || '').trim();
  const newInvNumber = (
    params.newInvoiceNumber?.trim() ||
    generateNextRevisionInvoiceNumber(existing.invoiceNumber || `INV-${existing.poNumber}`)
  ).slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax);

  const today = getTodayISODate();
  const nextInvoiceDate =
    params.newInvoiceDate && PO_SCHEMA_LIMITS.datePattern.test(params.newInvoiceDate)
      ? params.newInvoiceDate
      : existing.invoiceDate && PO_SCHEMA_LIMITS.datePattern.test(existing.invoiceDate)
      ? existing.invoiceDate
      : today;

  const nextMode: PaymentTermsMode =
    params.paymentTermsMode === 'MANUAL'
      ? 'MANUAL'
      : params.paymentTermsMode === 'NET'
      ? 'NET'
      : existing.paymentTermsMode ?? 'NET';

  const nextTermsDays =
    nextMode === 'MANUAL'
      ? undefined
      : sanitizePaymentTermsDays(params.paymentTermsDays ?? existing.paymentTermsDays ?? 30);

  const nextDueDate =
    nextMode === 'MANUAL'
      ? params.newDueDate && PO_SCHEMA_LIMITS.datePattern.test(params.newDueDate)
        ? params.newDueDate
        : existing.dueDate || today
      : params.newDueDate && PO_SCHEMA_LIMITS.datePattern.test(params.newDueDate)
      ? params.newDueDate
      : calculateDueDate(nextInvoiceDate, nextTermsDays ?? 30);

  const nextManualNote =
    nextMode === 'MANUAL'
      ? (params.manualDueDateNote ?? existing.manualDueDateNote ?? '')
          .trim()
          .slice(0, PO_SCHEMA_LIMITS.manualDueDateNoteMax)
      : '';

  const previousPaidAmount = wasPaid
    ? oldAmount
    : typeof existing.previousPaidAmount === 'number'
    ? existing.previousPaidAmount
    : undefined;

  const revisionEntry: DocumentRevisionEntry = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    revisedAt: getNowRevisionTimestamp(),
    revisedBy: cleanRevisedBy,
    reason: cleanReason,
    oldAmount,
    newAmount,
    diffAmount,
    oldInvoiceNumber: oldInvNumber,
    newInvoiceNumber: newInvNumber,
    previousStatus: existing.status,
    resolutionNote,
  };

  const nextRevisions = [
    ...(existing.revisions ?? []),
    revisionEntry,
  ].slice(-PO_SCHEMA_LIMITS.maxRevisions);

  const voidRecord: VoidedInvoiceRecord = {
    id: `void_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    invoiceNumber: oldInvNumber || '-',
    invoiceDate:
      existing.invoiceDate && PO_SCHEMA_LIMITS.datePattern.test(existing.invoiceDate)
        ? existing.invoiceDate
        : '',
    dueDate:
      existing.dueDate && PO_SCHEMA_LIMITS.datePattern.test(existing.dueDate)
        ? existing.dueDate
        : '',
    totalAmount: oldAmount,
    items: existing.items.length
      ? existing.items
      : [{ description: existing.projectName || '-', quantity: 1, unitPrice: oldAmount, amount: oldAmount }],
    statusLabel: `VOID / DIREVISI - Diganti oleh ${newInvNumber}`.slice(
      0,
      PO_SCHEMA_LIMITS.voidStatusLabelMax
    ),
    replacedByInvoiceNumber: newInvNumber,
    voidedAt: today,
    reason: cleanReason,
  };

  const nextVoidedInvoices = [
    ...(existing.voidedInvoices ?? []),
    voidRecord,
  ].slice(-PO_SCHEMA_LIMITS.maxVoidedInvoices);

  const nextPO: PurchaseOrderInput = {
    ...existing,
    items: cleanedItems,
    totalAmount: newAmount,
    status: 'Invoiced',
    invoiceDate: nextInvoiceDate,
    invoiceNumber: newInvNumber,
    paymentTermsMode: nextMode,
    paymentTermsDays: nextMode === 'MANUAL' ? undefined : nextTermsDays,
    manualDueDateNote: nextManualNote,
    dueDate: nextDueDate,
    revisionSubStatus,
    previousPaidAmount,
    revisions: nextRevisions,
    voidedInvoices: nextVoidedInvoices,
  };

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizePurchaseOrderDbPayload(nextPO, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal menyimpan revisi PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export async function softDeletePurchaseOrder(
  id: string,
  actor: AuditActor,
  reason?: string
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus PO di Supabase', configError);
  }

  const deletedAt = formatAuditTimestamp();
  const cleanByName = `${actor.name} (${actor.roleName})`.trim().slice(0, 160);
  const cleanByEmail = actor.email.trim().slice(0, 180);
  const cleanReason = (reason ?? '').trim().slice(0, 300);

  const { data: row } = await client.from(TABLE_NAME).select('*').eq('id', id).single();
  const existing = row ? normalizePO(row as Record<string, unknown>, id) : null;

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) => {
      if (existing) {
        return sanitizePurchaseOrderDbPayload(
          {
            ...existing,
            isDeleted: true,
            deletedAt,
            deletedByName: cleanByName,
            deletedByEmail: cleanByEmail,
            deleteReason: cleanReason,
          },
          schema,
          { updatedAt: new Date().toISOString(), excludedColumns: excluded }
        );
      }
      return sanitizePayloadByWhitelist({
        rawPayload: {
          is_deleted: true,
          deleted_at: deletedAt,
          deleted_by_name: cleanByName,
          deleted_by_email: cleanByEmail,
          delete_reason: cleanReason,
          updated_at: new Date().toISOString(),
        },
        fallbackColumns: PO_FALLBACK_WHITELIST,
        schema,
        excludedColumns: excluded,
      }).payload;
    },
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memindahkan PO (${id}) ke Riwayat Hapus di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export async function restorePurchaseOrder(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memulihkan PO di Supabase', configError);
  }

  const { data: row } = await client.from(TABLE_NAME).select('*').eq('id', id).single();
  const existing = row ? normalizePO(row as Record<string, unknown>, id) : null;

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) => {
      if (existing) {
        return sanitizePurchaseOrderDbPayload(
          {
            ...existing,
            isDeleted: false,
            deletedAt: '',
            deletedByName: '',
            deletedByEmail: '',
            deleteReason: '',
          },
          schema,
          { updatedAt: new Date().toISOString(), excludedColumns: excluded }
        );
      }
      return sanitizePayloadByWhitelist({
        rawPayload: {
          is_deleted: false,
          deleted_at: '',
          deleted_by_name: '',
          deleted_by_email: '',
          delete_reason: '',
          updated_at: new Date().toISOString(),
        },
        fallbackColumns: PO_FALLBACK_WHITELIST,
        schema,
        excludedColumns: excluded,
      }).payload;
    },
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memulihkan PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase();
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus permanen PO di Supabase', configError);
  }

  const { error } = await client.from(TABLE_NAME).delete().eq('id', id);
  if (error) {
    throw reportSupabaseError(`Gagal menghapus permanen PO (${id}) di Supabase`, error);
  }

  await refreshPurchaseOrdersFromSupabase().catch(() => {
    notifyListeners(latestOrders.filter((po) => po.id !== id));
  });
}

export async function updatePurchaseOrderRealisasi(
  id: string,
  realisasiAmount: number
): Promise<void> {
  if (!id || !id.trim()) {
    throw new Error('ID Purchase Order wajib ada saat update Realisasi.');
  }

  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan Realisasi PO ke Supabase', configError);
  }

  const cleanAmount = Number.isFinite(realisasiAmount)
    ? Math.max(0, Math.round(realisasiAmount))
    : 0;

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw reportSupabaseError(`Gagal membaca PO (${id}) sebelum update Realisasi`, fetchErr);
  }

  const rawRow = (row ?? {}) as Record<string, unknown>;
  const existing = row ? normalizePO(rawRow, id) : null;
  const { meta: itemsMeta } = unpackArrayWithMeta<POLineItem>(rawRow.items);
  const { meta: noteMeta } = unpackNotesWithMeta(rawRow.note ?? rawRow.notes);

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) => {
      const nowIso = new Date().toISOString();
      const { payload } = sanitizePayloadByWhitelist({
        rawPayload: {
          realisasi_amount: cleanAmount,
          actual_amount: cleanAmount,
          updated_at: nowIso,
        },
        fallbackColumns: PO_FALLBACK_WHITELIST,
        schema,
        aliases: PO_COLUMN_ALIASES,
        excludeFromDropped: PO_EXCLUDE_FROM_DROPPED,
        excludedColumns: excluded,
      });

      if (!('realisasi_amount' in payload) && !('actual_amount' in payload)) {
        const mergedMeta = {
          ...noteMeta,
          ...itemsMeta,
          realisasi_amount: cleanAmount,
          actual_amount: cleanAmount,
        };
        if (existing && (!schema || schema.columns.has('items')) && !excluded.has('items')) {
          payload.items = packArrayWithMeta(existing.items, mergedMeta);
        } else if ((!schema || schema.columns.has('note')) && !excluded.has('note')) {
          payload.note = packNotesWithMeta(existing?.note ?? '', mergedMeta, 4000);
        } else if (schema?.columns.has('notes') && !excluded.has('notes')) {
          payload.notes = packNotesWithMeta(existing?.note ?? '', mergedMeta, 4000);
        }
      }

      return payload;
    },
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal menyimpan Realisasi PO (${id}) ke Supabase`, error);
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal menyimpan Realisasi PO (${id}) ke Supabase`,
      new Error(`0 baris terupdate untuk PO (${id}). Periksa ID atau RLS policy.`)
    );
  }

  await refreshPurchaseOrdersFromSupabase();
}
