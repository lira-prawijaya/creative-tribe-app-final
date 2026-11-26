import {
  generateUuid,
  isUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseClient,
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
  CLIENT_INVOICE_SCHEMA_LIMITS,
  ClientInvoice,
  ClientInvoiceInput,
  ClientInvoiceStatus,
} from '../types/clientInvoice';
import {
  colorToDbStatusFields,
  normalizeStatusToColor,
  StatusColorKey,
  StatusWarna,
} from '../types/statusWarna';
import {
  DocumentRevisionEntry,
  PaymentTermsMode,
  PO_SCHEMA_LIMITS,
  POLineItem,
  RevisionSubStatus,
} from '../types/po';
import {
  calculateClientInvoiceBreakdown,
  computeClientInvoiceItemAmount,
  computeClientInvoiceItemsSubtotal,
  FlexibleInvoiceLineItem,
  isFFIClientOrBrand,
  resolveClientInvoiceBreakdown,
  resolveClientInvoiceNominal,
  sanitizeClientInvoiceInput,
} from '../utils/clientInvoiceFormat';
import {
  calculateDueDate,
  computeRevisionOutcome,
  generateNextRevisionInvoiceNumber,
  getNowRevisionTimestamp,
  getTodayISODate,
  normalizeToIsoDate,
  sanitizePaymentTermsDays,
  sanitizeRevisionEntries,
} from '../utils/format';
import { normalizeMonthKeyYYYYMM } from '../utils/bossReportCalc';
import { getEndOfMonthISODate } from './opexService';

const TABLE_NAME = 'client_invoices';

type ClientInvoicesListener = (invoices: ClientInvoice[]) => void;
const invoiceListeners = new Set<ClientInvoicesListener>();
let latestClientInvoices: ClientInvoice[] = [];
let channelSeq = 0;
const sentDateBackfilledIds = new Set<string>();

function generateClientInvoiceId(): string {
  return generateUuid();
}

const CLIENT_INVOICE_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'id',
  'invoice_number',
  'invoice_date',
  'client_name',
  'project_name',
  'project_number',
  'items',
  'total',
  'grand_total',
  'amount',
  'total_amount',
  'actual_amount',
  'realisasi_amount',
  'status',
  'sent_date',
  'due_date',
  'paid_date',
  'payment_terms_mode',
  'payment_terms_days',
  'is_deleted',
  'deleted_at',
  'deleted_by_name',
  'deleted_by_email',
  'delete_reason',
  'note',
  'created_at',
  'updated_at',
]);

const CLIENT_INVOICE_COLUMN_ALIASES: Record<string, string[]> = {
  note: ['notes'],
  notes: ['note'],
};

const CLIENT_INVOICE_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
  'total',
  'grand_total',
  'amount',
]);

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

function sortClientInvoices(list: ClientInvoice[]): ClientInvoice[] {
  return [...list].sort((a, b) => {
    const dateDiff = (b.invoiceDate || '').localeCompare(a.invoiceDate || '');
    if (dateDiff !== 0) return dateDiff;
    const timeDiff = getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return b.invoiceNumber.localeCompare(a.invoiceNumber);
  });
}

export function normalizeClientInvoice(
  raw: Record<string, unknown>,
  fallbackId: string
): ClientInvoice {
  const { items: unpackedItems, meta: itemsMeta } = unpackArrayWithMeta<POLineItem>(raw.items);
  const { notes: unpackedNote, meta: noteMeta } = unpackNotesWithMeta(raw.note ?? raw.notes);
  const meta: Record<string, unknown> = { ...noteMeta, ...itemsMeta };

  const invoiceDate =
    normalizeToIsoDate(
      raw.invoice_date ?? raw.invoiceDate ?? meta.invoice_date ?? meta.invoiceDate
    ) ??
    String(raw.invoice_date ?? raw.invoiceDate ?? meta.invoice_date ?? meta.invoiceDate ?? '');
  const rawStatusRaw = String(raw.status ?? meta.status ?? 'Unpaid').trim();
  const rawStatusStr = rawStatusRaw.toLowerCase();
  const rawStatusWarnaStr = String(
    raw.status_warna ?? raw.statusWarna ?? meta.status_warna ?? meta.statusWarna ?? ''
  ).trim();
  let status: ClientInvoiceStatus;
  let statusWarna: StatusWarna;
  if (rawStatusStr === 'draft') {
    status = 'Draft';
    statusWarna = 'PUTIH';
  } else {
    const color = normalizeStatusToColor(rawStatusRaw, rawStatusWarnaStr);
    if (color === 'green') {
      status = 'Paid';
      statusWarna = 'HIJAU';
    } else if (color === 'red') {
      status = 'Reschedule';
      statusWarna = 'MERAH';
    } else {
      status = rawStatusStr === 'not paid' ? 'Not Paid' : 'Unpaid';
      statusWarna = 'PUTIH';
    }
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

  const parsedSentDate =
    normalizeToIsoDate(
      raw.sent_date ?? raw.sentDate ?? meta.sent_date ?? meta.sentDate
    ) ?? '';
  const sentDate =
    status === 'Draft' ? parsedSentDate : parsedSentDate || getTodayISODate();

  let mode: PaymentTermsMode | undefined;
  let paymentTermsDays: number | undefined;
  let dueDate = '';

  const rawMode =
    raw.payment_terms_mode ??
    raw.paymentTermsMode ??
    meta.payment_terms_mode ??
    meta.paymentTermsMode;
  const rawDaysField =
    raw.payment_terms_days ??
    raw.paymentTermsDays ??
    meta.payment_terms_days ??
    meta.paymentTermsDays;

  if (status !== 'Draft') {
    if (rawMode === 'MANUAL') {
      mode = 'MANUAL';
    } else if (rawMode === 'NET') {
      mode = 'NET';
    }
    const rawTerms =
      rawDaysField !== undefined && rawDaysField !== null && rawDaysField !== ''
        ? Number(rawDaysField)
        : undefined;
    if (mode === 'NET') {
      paymentTermsDays = sanitizePaymentTermsDays(rawTerms);
    }

    const parsedDueDate =
      normalizeToIsoDate(
        raw.due_date ?? raw.dueDate ?? meta.due_date ?? meta.dueDate
      ) ?? '';
    if (parsedDueDate) {
      dueDate = parsedDueDate;
    } else if (mode === 'NET') {
      dueDate = calculateDueDate(sentDate || invoiceDate, paymentTermsDays ?? 30);
    }
  }

  const parsedPaidDate =
    normalizeToIsoDate(
      raw.paid_date ?? raw.paidDate ?? meta.paid_date ?? meta.paidDate
    ) ?? '';
  const paidDate = status === 'Paid' ? parsedPaidDate : '';

  const items: POLineItem[] = unpackedItems.map((it) => {
    const rawIt = it as unknown as FlexibleInvoiceLineItem;
    const rawQty = Number(rawIt.quantity ?? rawIt.qty);
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.round(rawQty) || 1 : 1;
    const rawPrice = Number(rawIt.unitPrice ?? rawIt.price);
    const computedAmount = computeClientInvoiceItemAmount(rawIt);
    const unitPrice =
      Number.isFinite(rawPrice) && rawPrice > 0
        ? Math.round(rawPrice)
        : computedAmount > 0
        ? Math.round(computedAmount / quantity)
        : Number.isFinite(rawPrice) && rawPrice >= 0
        ? Math.round(rawPrice)
        : 0;
    const amount = Math.round(quantity * unitPrice) || Math.round(computedAmount);
    return {
      description: String(rawIt.description ?? ''),
      quantity,
      unitPrice,
      amount,
    };
  });
  const includePPN = Boolean(
    raw.include_ppn ?? raw.includePPN ?? meta.include_ppn ?? meta.includePPN
  );
  const rawIncludePPh =
    raw.include_pph ?? raw.includePPh ?? meta.include_pph ?? meta.includePPh;
  const rawIncludeCitibank =
    raw.include_citibank ??
    raw.includeCitibank ??
    meta.include_citibank ??
    meta.includeCitibank;

  const breakdown = resolveClientInvoiceBreakdown({
    items,
    includePPN,
    ppnPercent:
      raw.ppn_percent ?? raw.ppnPercent ?? meta.ppn_percent ?? meta.ppnPercent,
    subtotalAmount:
      raw.subtotal_amount ??
      raw.subtotalAmount ??
      meta.subtotal_amount ??
      meta.subtotalAmount,
    ppnAmount: raw.ppn_amount ?? raw.ppnAmount ?? meta.ppn_amount ?? meta.ppnAmount,
    grossAmount:
      raw.gross_amount ?? raw.grossAmount ?? meta.gross_amount ?? meta.grossAmount,
    includePPh: rawIncludePPh,
    pphAmount: raw.pph_amount ?? raw.pphAmount ?? meta.pph_amount ?? meta.pphAmount,
    netAfterPph:
      raw.net_after_pph ??
      raw.netAfterPph ??
      meta.net_after_pph ??
      meta.netAfterPph,
    includeCitibank: rawIncludeCitibank,
    citibankFeeAmount:
      raw.citibank_fee_amount ??
      raw.citibankFeeAmount ??
      meta.citibank_fee_amount ??
      meta.citibankFeeAmount,
    netReceivable:
      raw.net_receivable ??
      raw.netReceivable ??
      meta.net_receivable ??
      meta.netReceivable,
    total: raw.total ?? meta.total,
    grand_total: raw.grand_total ?? meta.grand_total,
    amount: raw.amount ?? meta.amount,
    total_amount: raw.total_amount ?? meta.total_amount,
    totalAmount: raw.totalAmount ?? meta.totalAmount,
  });
  const subtotalAmount = breakdown.dpp;
  const ppnAmount = breakdown.ppnAmount;
  const resolvedTotal = breakdown.netReceivable;

  const rawClientIdText =
    typeof raw.client_id === 'string' && !isUuid(raw.client_id)
      ? raw.client_id
      : typeof raw.clientId === 'string' && !isUuid(raw.clientId)
      ? raw.clientId
      : '';
  const clientName = String(
    raw.client_name ??
      raw.clientName ??
      meta.client_name ??
      meta.clientName ??
      raw.client ??
      rawClientIdText ??
      ''
  );
  const brandName = String(
    raw.brand_name ?? raw.brandName ?? meta.brand_name ?? meta.brandName ?? ''
  );
  const rawShowGRN = raw.show_grn ?? raw.showGRN ?? meta.show_grn ?? meta.showGRN;
  const showGRN =
    typeof rawShowGRN === 'boolean'
      ? rawShowGRN
      : isFFIClientOrBrand(brandName, clientName);
  const rawShowSysNote =
    raw.show_system_generated_note ??
    raw.showSystemGeneratedNote ??
    meta.show_system_generated_note ??
    meta.showSystemGeneratedNote;
  const showSystemGeneratedNote =
    typeof rawShowSysNote === 'boolean' ? rawShowSysNote : true;

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
    status === 'Paid' &&
    rawRealisasiField !== undefined &&
    rawRealisasiField !== null &&
    rawRealisasiField !== '' &&
    Number.isFinite(Number(rawRealisasiField))
      ? Math.max(0, Math.round(Number(rawRealisasiField)))
      : undefined;

  return {
    id: String(raw.id ?? fallbackId),
    invoiceNumber: String(
      raw.invoice_number ?? raw.invoiceNumber ?? meta.invoice_number ?? ''
    ),
    invoiceDate,
    clientName,
    brandName,
    billingAddress: String(
      raw.billing_address ?? raw.billingAddress ?? meta.billing_address ?? ''
    ),
    poNumber: String(raw.po_number ?? raw.poNumber ?? meta.po_number ?? ''),
    grnNumber: String(raw.grn_number ?? raw.grnNumber ?? meta.grn_number ?? ''),
    showGRN,
    includePPN: breakdown.includePPN,
    ppnPercent: breakdown.ppnPercent,
    subtotalAmount,
    ppnAmount,
    grossAmount: breakdown.grossAmount,
    includePPh: breakdown.includePPh,
    pphAmount: breakdown.pphAmount,
    netAfterPph: breakdown.netAfterPph,
    includeCitibank: breakdown.includeCitibank,
    citibankFeeAmount: breakdown.citibankFeeAmount,
    netReceivable: breakdown.netReceivable,
    showSystemGeneratedNote,
    projectName: String(
      raw.project_name ??
        raw.projectName ??
        meta.project_name ??
        meta.projectName ??
        raw.project ??
        (typeof raw.project_id === 'string' && !isUuid(raw.project_id) ? raw.project_id : '') ??
        ''
    ),
    projectNumber: String(
      raw.project_number ?? raw.projectNumber ?? meta.project_number ?? meta.projectNumber ?? ''
    ),
    items,
    totalAmount: resolvedTotal,
    total: resolvedTotal,
    grand_total: resolvedTotal,
    amount: resolvedTotal,
    total_amount: resolvedTotal,
    ...(parsedRealisasi !== undefined
      ? { realisasiAmount: parsedRealisasi, actualAmount: parsedRealisasi }
      : {}),
    sentDate,
    paymentTermsMode: mode,
    paymentTermsDays,
    manualDueDateNote: String(
      raw.manual_due_date_note ??
        raw.manualDueDateNote ??
        meta.manual_due_date_note ??
        ''
    ),
    dueDate,
    status,
    statusWarna,
    ...(rescheduledFromMonth ? { rescheduledFromMonth } : {}),
    ...(rescheduledToMonth ? { rescheduledToMonth } : {}),
    paidDate,
    note: unpackedNote || String(meta.note ?? ''),
    isVoided: Boolean(raw.is_voided ?? raw.isVoided ?? meta.is_voided ?? meta.isVoided),
    voidStatusLabel: String(
      raw.void_status_label ?? raw.voidStatusLabel ?? meta.void_status_label ?? ''
    ),
    replacedByInvoiceId: String(
      raw.replaced_by_invoice_id ??
        raw.replacedByInvoiceId ??
        meta.replaced_by_invoice_id ??
        ''
    ),
    replacedByInvoiceNumber: String(
      raw.replaced_by_invoice_number ??
        raw.replacedByInvoiceNumber ??
        meta.replaced_by_invoice_number ??
        ''
    ),
    revisionSubStatus,
    previousPaidAmount,
    revisions,
    ...(() => {
      const rawDeletedAtVal =
        raw.deleted_at ?? raw.deletedAt ?? meta.deleted_at ?? meta.deletedAt;
      const deletedAtStr =
        rawDeletedAtVal !== undefined && rawDeletedAtVal !== null
          ? String(rawDeletedAtVal).trim()
          : '';
      const isDeletedFlag =
        raw.is_deleted === true ||
        raw.isDeleted === true ||
        meta.is_deleted === true ||
        meta.isDeleted === true ||
        Boolean(deletedAtStr);
      return {
        isDeleted: isDeletedFlag,
        deletedAt: deletedAtStr,
      };
    })(),
    deletedByName: String(
      raw.deleted_by_name ?? raw.deletedByName ?? meta.deleted_by_name ?? ''
    ),
    deletedByEmail: String(
      raw.deleted_by_email ?? raw.deletedByEmail ?? meta.deleted_by_email ?? ''
    ),
    deleteReason: String(
      raw.delete_reason ?? raw.deleteReason ?? meta.delete_reason ?? ''
    ),
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

function toRawClientInvoiceDbRecord(
  sanitized: ClientInvoiceInput,
  options?: { id?: string; createdAt?: string; updatedAt?: string }
): Record<string, unknown> {
  const breakdown = resolveClientInvoiceBreakdown(sanitized);
  const resolvedSubtotal = Math.round(breakdown.dpp);
  const resolvedPpnPercent = Math.round(breakdown.ppnPercent);
  const resolvedPpn = Math.round(breakdown.ppnAmount);
  const resolvedGross = Math.round(breakdown.grossAmount);
  const resolvedPph = Math.round(breakdown.pphAmount);
  const resolvedNetAfterPph = Math.round(breakdown.netAfterPph);
  const resolvedCitibankFee = Math.round(breakdown.citibankFeeAmount);
  const resolvedTotal = Math.round(
    breakdown.netReceivable || resolveClientInvoiceNominal(sanitized)
  );
  const roundedItems = (sanitized.items ?? []).map((it) => ({
    ...it,
    quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
    unitPrice: Math.max(0, Math.round(Number(it.unitPrice) || 0)),
    amount: Math.max(0, Math.round(Number(it.amount) || 0)),
  }));

  const invoiceDateIso = normalizeToIsoDate(sanitized.invoiceDate) ?? null;
  const sentDateIso =
    sanitized.sentDate && sanitized.sentDate.trim()
      ? normalizeToIsoDate(sanitized.sentDate) ?? null
      : sanitized.status !== 'Draft'
      ? getTodayISODate()
      : null;
  const dueDateIso =
    sanitized.dueDate && sanitized.dueDate.trim()
      ? normalizeToIsoDate(sanitized.dueDate) ?? null
      : null;
  const paidDateIso =
    sanitized.status === 'Paid' && sanitized.paidDate && sanitized.paidDate.trim()
      ? normalizeToIsoDate(sanitized.paidDate) ?? null
      : null;
  const deletedAtIso = sanitized.isDeleted
    ? sanitized.deletedAt && sanitized.deletedAt.trim()
      ? sanitized.deletedAt.trim()
      : new Date().toISOString()
    : null;

  const rawRealisasi =
    sanitized.status === 'Paid'
      ? sanitized.realisasiAmount ?? sanitized.actualAmount ?? null
      : null;
  const cleanRealisasi =
    typeof rawRealisasi === 'number' && Number.isFinite(rawRealisasi)
      ? Math.max(0, Math.round(rawRealisasi))
      : null;

  return {
    ...(options?.id ? { id: options.id } : {}),
    invoice_number: sanitized.invoiceNumber,
    invoice_date: invoiceDateIso,
    client_name: sanitized.clientName,
    brand_name: sanitized.brandName ?? '',
    billing_address: sanitized.billingAddress ?? '',
    po_number: sanitized.poNumber ?? '',
    grn_number: sanitized.grnNumber ?? '',
    show_grn: Boolean(sanitized.showGRN),
    include_ppn: Boolean(breakdown.includePPN),
    ppn_percent: resolvedPpnPercent,
    subtotal_amount: resolvedSubtotal || resolvedTotal,
    ppn_amount: resolvedPpn,
    gross_amount: resolvedGross || resolvedTotal,
    include_pph: Boolean(breakdown.includePPh),
    pph_amount: resolvedPph,
    net_after_pph: resolvedNetAfterPph,
    include_citibank: Boolean(breakdown.includeCitibank),
    citibank_fee_amount: resolvedCitibankFee,
    net_receivable: resolvedTotal,
    show_system_generated_note: sanitized.showSystemGeneratedNote ?? true,
    project_name: sanitized.projectName,
    project_number: sanitized.projectNumber,
    items: roundedItems,
    total: resolvedTotal,
    grand_total: resolvedTotal,
    amount: resolvedTotal,
    total_amount: resolvedTotal,
    actual_amount: cleanRealisasi,
    realisasi_amount: cleanRealisasi,
    sent_date: sentDateIso,
    payment_terms_mode:
      sanitized.paymentTermsMode === 'NET' || sanitized.paymentTermsMode === 'MANUAL'
        ? sanitized.paymentTermsMode
        : null,
    payment_terms_days:
      sanitized.paymentTermsMode === 'NET' &&
      typeof sanitized.paymentTermsDays === 'number' &&
      Number.isFinite(sanitized.paymentTermsDays)
        ? Math.round(sanitized.paymentTermsDays)
        : null,
    manual_due_date_note: sanitized.manualDueDateNote ?? '',
    due_date: dueDateIso,
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
    paid_date: paidDateIso,
    note: sanitized.note ?? '',
    is_voided: Boolean(sanitized.isVoided),
    void_status_label: sanitized.voidStatusLabel ?? '',
    replaced_by_invoice_id: sanitized.replacedByInvoiceId ?? '',
    replaced_by_invoice_number: sanitized.replacedByInvoiceNumber ?? '',
    revision_sub_status: sanitized.revisionSubStatus ?? '',
    previous_paid_amount:
      typeof sanitized.previousPaidAmount === 'number' &&
      Number.isFinite(sanitized.previousPaidAmount)
        ? Math.round(sanitized.previousPaidAmount)
        : null,
    revisions: sanitized.revisions ?? [],
    is_deleted: Boolean(sanitized.isDeleted),
    deleted_at: deletedAtIso,
    deleted_by_name: sanitized.deletedByName ?? '',
    deleted_by_email: sanitized.deletedByEmail ?? '',
    delete_reason: sanitized.deleteReason ?? '',
    ...(options?.createdAt ? { created_at: options.createdAt } : {}),
    updated_at: options?.updatedAt ?? new Date().toISOString(),
  };
}

export function sanitizeClientInvoiceDbPayload(
  sanitized: ClientInvoiceInput,
  schema: SupabaseTableSchema | null,
  options?: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    excludedColumns?: ReadonlySet<string>;
  }
): Record<string, unknown> {
  const rawRecord = toRawClientInvoiceDbRecord(sanitized, options);

  // Jika kolom tanggal di OpenAPI schema bertipe text (bukan date/timestamp), hindari null agar tidak memicu NOT NULL error 23502
  if (schema && schema.columns.size > 0) {
    for (const dateCol of ['invoice_date', 'sent_date', 'due_date', 'paid_date', 'deleted_at'] as const) {
      const colMeta = schema.columns.get(dateCol);
      if (colMeta && rawRecord[dateCol] === null) {
        const fmt = (colMeta.format ?? '').toLowerCase();
        const isTypedDateOrTs =
          fmt === 'date' || fmt.includes('timestamp') || fmt === 'date-time';
        if (!isTypedDateOrTs) {
          rawRecord[dateCol] = '';
        }
      }
    }
  }

  const aliases: Record<string, string[]> = { ...CLIENT_INVOICE_COLUMN_ALIASES };
  const clientIdMeta = schema?.columns.get('client_id');
  if (
    clientIdMeta &&
    !schema?.columns.has('client_name') &&
    (clientIdMeta.format ?? '').toLowerCase() !== 'uuid'
  ) {
    aliases.client_name = ['client_id'];
  }
  const projectIdMeta = schema?.columns.get('project_id');
  if (
    projectIdMeta &&
    !schema?.columns.has('project_name') &&
    (projectIdMeta.format ?? '').toLowerCase() !== 'uuid'
  ) {
    aliases.project_name = ['project_id'];
  }

  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: rawRecord,
    fallbackColumns: CLIENT_INVOICE_FALLBACK_WHITELIST,
    schema,
    aliases,
    excludeFromDropped: CLIENT_INVOICE_EXCLUDE_FROM_DROPPED,
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

function notifyListeners(invoices: ClientInvoice[]): void {
  const sorted = sortClientInvoices(invoices);
  latestClientInvoices = sorted;
  for (const listener of invoiceListeners) {
    listener(sorted);
  }
}

export async function getClientInvoices(): Promise<ClientInvoice[]> {
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
    throw reportSupabaseError(
      `Gagal mengambil Invoice Client dari Supabase (${TABLE_NAME})`,
      error,
      {
        showAlert: false,
      }
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const normalizedList = sortClientInvoices(
    (data ?? []).map((row, idx) =>
      normalizeClientInvoice(
        row as Record<string, unknown>,
        String((row as { id?: unknown }).id ?? `cli_${idx}`)
      )
    )
  );

  console.log(`Fetched ${normalizedList.length} invoices from Supabase`, {
    table: TABLE_NAME,
    count: normalizedList.length,
  });

  // Jika ada invoice berstatus SENT (Unpaid/Paid) di Supabase yang sent_date-nya NULL/kosong, simpan tanggal hari ini ke Supabase
  const rowsNeedingSentDate = (data ?? []).filter((row) => {
    const rec = row as Record<string, unknown>;
    const rowId = String(rec.id ?? '').trim();
    if (!rowId || sentDateBackfilledIds.has(rowId)) return false;
    const rawStatus = String(rec.status ?? '').trim().toLowerCase();
    if (!rawStatus || rawStatus === 'draft') return false;
    const { meta: itemsMeta } = unpackArrayWithMeta<POLineItem>(rec.items);
    const { meta: noteMeta } = unpackNotesWithMeta(rec.note ?? rec.notes);
    const existingSent = normalizeToIsoDate(
      rec.sent_date ?? rec.sentDate ?? itemsMeta.sent_date ?? noteMeta.sent_date
    );
    return !existingSent;
  });

  if (rowsNeedingSentDate.length > 0) {
    const today = getTodayISODate();
    for (const rawRow of rowsNeedingSentDate) {
      const rec = rawRow as Record<string, unknown>;
      const rowId = String(rec.id);
      sentDateBackfilledIds.add(rowId);
      const norm = normalizedList.find((inv) => inv.id === rowId);
      if (!norm) continue;
      const sanitizedBackfill = sanitizeClientInvoiceInput({
        ...norm,
        sentDate: today,
      });
      void runWhitelistedSupabaseMutation({
        tableName: TABLE_NAME,
        operation: 'update',
        buildPayload: (schema, excluded) =>
          sanitizeClientInvoiceDbPayload(sanitizedBackfill, schema, {
            updatedAt: new Date().toISOString(),
            excludedColumns: excluded,
          }),
        execute: (payload) =>
          client.from(TABLE_NAME).update(payload).eq('id', rowId).select(),
      }).catch(() => {
        sentDateBackfilledIds.delete(rowId);
      });
    }
  }

  return normalizedList;
}

export async function getClientInvoiceById(id: string): Promise<ClientInvoice | null> {
  if (!id || !id.trim()) return null;
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw reportSupabaseError(
      `Gagal mengambil detail Invoice Client (${id}) dari ${TABLE_NAME}`,
      error
    );
  }
  if (!data) return null;
  recordObservedTableColumns(TABLE_NAME, [data as Record<string, unknown>]);
  return normalizeClientInvoice(data as Record<string, unknown>, id);
}

export async function getClientInvoicesByRange(
  startMonthKey: string,
  endMonthKey: string
): Promise<ClientInvoice[]> {
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
  } else if (observed?.has('invoice_date')) {
    query = query.lte('invoice_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Gagal mengambil data Cash In (${safeStart} s/d ${safeEnd}): ${error.message}`
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  return sortClientInvoices(
    (data ?? []).map((row, idx) =>
      normalizeClientInvoice(
        row as Record<string, unknown>,
        String((row as { id?: unknown }).id ?? `cli_${idx}`)
      )
    )
  );
}

export async function refreshClientInvoicesRangeFromSupabase(
  startMonthKey: string,
  endMonthKey: string
): Promise<ClientInvoice[]> {
  const rangeList = await getClientInvoicesByRange(startMonthKey, endMonthKey);
  const byId = new Map<string, ClientInvoice>();
  for (const item of latestClientInvoices) {
    byId.set(item.id, item);
  }
  for (const item of rangeList) {
    byId.set(item.id, item);
  }
  const merged = sortClientInvoices(Array.from(byId.values()));
  notifyListeners(merged);
  return rangeList;
}

async function refreshClientInvoicesFromSupabase(): Promise<ClientInvoice[]> {
  const list = await getClientInvoices();
  notifyListeners(list);
  return list;
}

export function subscribeClientInvoices(
  onData: (invoices: ClientInvoice[]) => void,
  onError: (err: Error) => void,
  _options?: { readOnly?: boolean }
): () => void {
  invoiceListeners.add(onData);

  if (!supabase) {
    onData([]);
    onError(new Error('Supabase belum dikonfigurasi.'));
    return () => {
      invoiceListeners.delete(onData);
    };
  }

  let cancelled = false;
  let activeChannel: ReturnType<SupabaseClient['channel']> | null = null;

  const fetchClientInvoices = async () => {
    if (cancelled) return;
    try {
      const list = await getClientInvoices();
      if (cancelled) return;
      notifyListeners(list);
    } catch (err) {
      console.error('[Supabase] subscribeClientInvoices fetch error:', err);
      if (err instanceof Error) onError(err);
      if (!cancelled) onData(latestClientInvoices);
    }
  };

  void fetchClientInvoices();
  activeChannel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchClientInvoices();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    invoiceListeners.delete(onData);
    if (activeChannel) {
      void supabase?.removeChannel(activeChannel);
    }
  };
}

export async function createClientInvoice(input: ClientInvoiceInput): Promise<string> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan Invoice Client ke Supabase', configError);
  }

  const id = generateClientInvoiceId();
  const sanitized = sanitizeClientInvoiceInput(input);
  const nowIso = new Date().toISOString();

  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'insert',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(sanitized, schema, {
        id,
        createdAt: nowIso,
        updatedAt: nowIso,
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).insert([payload]).select(),
  });

  if (error) {
    throw reportSupabaseError(
      `Gagal menyimpan Invoice Client ke Supabase (${TABLE_NAME})`,
      error
    );
  }

  const insertedRow = Array.isArray(data) ? data[0] : data;
  if (!insertedRow) {
    throw reportSupabaseError(
      `Gagal menyimpan Invoice Client ke Supabase (${TABLE_NAME})`,
      new Error(
        `Supabase tidak mengembalikan baris baru setelah INSERT. Periksa RLS Policy INSERT/SELECT pada tabel ${TABLE_NAME}.`
      )
    );
  }

  const saved = normalizeClientInvoice(insertedRow as Record<string, unknown>, id);
  await refreshClientInvoicesFromSupabase();
  return saved.id;
}

export async function updateClientInvoice(
  id: string,
  input: ClientInvoiceInput
): Promise<void> {
  if (!id || !id.trim()) {
    throw new Error('ID Invoice Client wajib ada saat melakukan update.');
  }

  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memperbarui Invoice Client di Supabase', configError);
  }

  const sanitized = sanitizeClientInvoiceInput(input);
  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(sanitized, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(
      `Gagal memperbarui Invoice Client (${id}) di Supabase (${TABLE_NAME})`,
      error
    );
  }
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw reportSupabaseError(
      `Gagal memperbarui Invoice Client (${id}) di Supabase (${TABLE_NAME})`,
      new Error(
        `Data invoice tidak ter-update di database (cek ID atau RLS policy UPDATE pada tabel ${TABLE_NAME}).`
      )
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function sendClientInvoice(
  id: string,
  params: {
    sentDate: string;
    dueDate: string;
    paymentTermsMode: PaymentTermsMode;
    paymentTermsDays?: number;
    manualDueDateNote?: string;
  }
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal mengirim Invoice Client di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil Invoice Client (${id}) dari Supabase (${TABLE_NAME})`,
      fetchErr ?? new Error('Invoice tidak ditemukan')
    );
  }

  const existing = normalizeClientInvoice(row as Record<string, unknown>, id);
  const cleanSentDate = normalizeToIsoDate(params.sentDate) ?? getTodayISODate();
  const mode: PaymentTermsMode =
    params.paymentTermsMode === 'MANUAL' ? 'MANUAL' : 'NET';
  const cleanDays =
    mode === 'NET' ? sanitizePaymentTermsDays(params.paymentTermsDays) : undefined;
  const cleanDueDate =
    normalizeToIsoDate(params.dueDate) ??
    (mode === 'NET' ? calculateDueDate(cleanSentDate, cleanDays ?? 30) : '');
  const cleanManualNote = (params.manualDueDateNote ?? '')
    .trim()
    .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.manualDueDateNoteMax);

  const nextInvoice = sanitizeClientInvoiceInput({
    ...existing,
    status: 'Unpaid',
    sentDate: cleanSentDate,
    dueDate: cleanDueDate,
    paymentTermsMode: mode,
    paymentTermsDays: mode === 'NET' ? cleanDays : undefined,
    manualDueDateNote: cleanManualNote,
  });

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(nextInvoice, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal update status kirim Invoice (${id}) di Supabase`, error);
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal update status kirim Invoice (${id}) di Supabase`,
      new Error('Status kirim tidak tersimpan (cek policy UPDATE di Supabase).')
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function markClientInvoicePaid(
  id: string,
  paidDate: string
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menandai Invoice Paid di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil Invoice Client (${id}) dari Supabase`,
      fetchErr ?? new Error('Invoice tidak ditemukan')
    );
  }

  const existing = normalizeClientInvoice(row as Record<string, unknown>, id);
  const cleanPaidDate = paidDate.trim().slice(0, 10);
  const nextInvoice = sanitizeClientInvoiceInput({
    ...existing,
    status: 'Paid',
    statusWarna: 'HIJAU',
    rescheduledFromMonth: '',
    rescheduledToMonth: '',
    revisionSubStatus: '',
    paidDate: cleanPaidDate,
  });

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(nextInvoice, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal menandai Invoice (${id}) Lunas di Supabase`, error);
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal menandai Invoice (${id}) Lunas di Supabase`,
      new Error('Status Paid tidak tersimpan (cek policy UPDATE di Supabase).')
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function markClientInvoiceUnpaid(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal mengubah status Invoice di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil Invoice Client (${id}) dari Supabase`,
      fetchErr ?? new Error('Invoice tidak ditemukan')
    );
  }

  const existing = normalizeClientInvoice(row as Record<string, unknown>, id);
  const nextInvoice = sanitizeClientInvoiceInput({
    ...existing,
    status: 'Unpaid',
    statusWarna: 'PUTIH',
    rescheduledFromMonth: '',
    rescheduledToMonth: '',
    paidDate: '',
    realisasiAmount: undefined,
    actualAmount: undefined,
  });

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(nextInvoice, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal mengubah status Invoice (${id}) ke Unpaid di Supabase`, error);
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal mengubah status Invoice (${id}) ke Unpaid di Supabase`,
      new Error('Status Unpaid tidak tersimpan (cek policy UPDATE di Supabase).')
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function setClientInvoiceStatusWarna(
  id: string,
  params: {
    color: StatusColorKey;
    targetMonthKey?: string;
    originMonthKey?: string;
    paidDate?: string;
  }
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal mengubah status warna Invoice di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil Invoice Client (${id}) dari Supabase`,
      fetchErr ?? new Error('Invoice tidak ditemukan')
    );
  }

  const existing = normalizeClientInvoice(row as Record<string, unknown>, id);
  const { status, statusWarna } = colorToDbStatusFields(params.color);

  let nextInput: ClientInvoiceInput;
  if (params.color === 'green') {
    nextInput = sanitizeClientInvoiceInput({
      ...existing,
      status,
      statusWarna,
      paidDate: normalizeToIsoDate(params.paidDate) ?? getTodayISODate(),
      revisionSubStatus: '',
      rescheduledFromMonth: '',
      rescheduledToMonth: '',
    });
  } else if (params.color === 'red') {
    const originMonth =
      params.originMonthKey && /^\d{4}-\d{2}$/.test(params.originMonthKey)
        ? params.originMonthKey
        : (existing.dueDate || existing.invoiceDate || getTodayISODate()).slice(0, 7);
    const targetMonthKey =
      params.targetMonthKey && /^\d{4}-\d{2}$/.test(params.targetMonthKey)
        ? params.targetMonthKey
        : originMonth;
    nextInput = sanitizeClientInvoiceInput({
      ...existing,
      status: 'Reschedule',
      statusWarna: 'MERAH',
      paidDate: '',
      realisasiAmount: undefined,
      actualAmount: undefined,
      sentDate: existing.sentDate || existing.invoiceDate || getTodayISODate(),
      rescheduledFromMonth: originMonth,
      rescheduledToMonth: targetMonthKey,
    });
  } else {
    nextInput = sanitizeClientInvoiceInput({
      ...existing,
      status: 'Not Paid',
      statusWarna: 'PUTIH',
      paidDate: '',
      rescheduledFromMonth: '',
      rescheduledToMonth: '',
      realisasiAmount: undefined,
      actualAmount: undefined,
    });
  }

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(nextInput, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui Status Warna Invoice (${id}) di Supabase`, error);
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal memperbarui Status Warna Invoice (${id}) di Supabase`,
      new Error('Status Warna tidak tersimpan (cek policy UPDATE di Supabase).')
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function updateClientInvoicePrintOptions(
  id: string,
  options: { showGRN: boolean; showSystemGeneratedNote: boolean }
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan opsi cetak Invoice di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil Invoice Client (${id}) dari Supabase`,
      fetchErr ?? new Error('Invoice tidak ditemukan')
    );
  }

  const existing = normalizeClientInvoice(row as Record<string, unknown>, id);
  const nextInvoice: ClientInvoiceInput = {
    ...existing,
    showGRN: options.showGRN,
    showSystemGeneratedNote: options.showSystemGeneratedNote,
  };

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(nextInvoice, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui opsi cetak Invoice (${id}) di Supabase`, error);
  }

  await refreshClientInvoicesFromSupabase();
}

export interface ReviseClientInvoiceRequest {
  reason: string;
  revisedBy: string;
  newItems: POLineItem[];
  newInvoiceNumber?: string;
  newInvoiceDate?: string;
  newDueDate?: string;
}

export async function reviseClientInvoice(
  id: string,
  params: ReviseClientInvoiceRequest,
  fallbackInvoice?: ClientInvoice
): Promise<string> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal merevisi Invoice Client di Supabase', configError);
  }

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  const existing = row
    ? normalizeClientInvoice(row as Record<string, unknown>, id)
    : fallbackInvoice;
  if (fetchErr && !existing) {
    throw reportSupabaseError('Invoice Client tidak ditemukan untuk direvisi.', fetchErr);
  }
  if (!existing) {
    throw new Error('Invoice Client tidak ditemukan untuk direvisi.');
  }

  const cleanReason = params.reason.trim().slice(0, PO_SCHEMA_LIMITS.revisionReasonMax);
  if (!cleanReason) {
    throw new Error('Alasan revisi wajib diisi.');
  }
  const cleanRevisedBy =
    params.revisedBy.trim().slice(0, PO_SCHEMA_LIMITS.revisedByMax) ||
    PO_SCHEMA_LIMITS.defaultRevisionUser;

  const cleanedItems: POLineItem[] = params.newItems
    .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.maxItems)
    .map((item) => {
      const qty =
        Number.isFinite(item.quantity) && item.quantity > 0
          ? Math.round(item.quantity) || 1
          : 1;
      const unitPrice =
        Number.isFinite(item.unitPrice) && item.unitPrice >= 0
          ? Math.round(item.unitPrice)
          : 0;
      return {
        description:
          item.description
            .trim()
            .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.descriptionMax) || '-',
        quantity: qty,
        unitPrice,
        amount: Math.round(qty * unitPrice),
      };
    });

  const subtotalAmount = computeClientInvoiceItemsSubtotal(cleanedItems);
  const revBreakdown = calculateClientInvoiceBreakdown({
    dpp: subtotalAmount,
    includePPN: Boolean(existing.includePPN),
    ppnPercent: existing.ppnPercent ?? 11,
    includePPh: Boolean(existing.includePPh),
    includeCitibank: Boolean(existing.includeCitibank),
  });
  const includePPN = revBreakdown.includePPN;
  const ppnAmount = revBreakdown.ppnAmount;
  const newAmount = revBreakdown.netReceivable;
  const oldAmount = resolveClientInvoiceNominal(existing);

  const wasPaid = existing.status === 'Paid';
  const { diffAmount, revisionSubStatus, resolutionNote } = computeRevisionOutcome(
    wasPaid,
    oldAmount,
    newAmount
  );

  const newInvId = generateClientInvoiceId();
  const newInvNumber = (
    params.newInvoiceNumber?.trim() ||
    generateNextRevisionInvoiceNumber(existing.invoiceNumber)
  ).slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.invoiceNumberMax);

  const today = getTodayISODate();
  const nextInvoiceDate =
    params.newInvoiceDate &&
    CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(params.newInvoiceDate)
      ? params.newInvoiceDate
      : today;

  const nextSentDate = existing.sentDate || nextInvoiceDate;
  const nextMode: PaymentTermsMode =
    existing.paymentTermsMode === 'MANUAL' ? 'MANUAL' : 'NET';
  const nextTermsDays =
    nextMode === 'NET' ? sanitizePaymentTermsDays(existing.paymentTermsDays ?? 30) : undefined;
  const nextDueDate =
    params.newDueDate && CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(params.newDueDate)
      ? params.newDueDate
      : existing.dueDate && CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(existing.dueDate)
      ? existing.dueDate
      : calculateDueDate(nextSentDate, nextTermsDays ?? 30);

  const voidStatusLabel = `VOID / DIREVISI - Diganti oleh ${newInvNumber}`.slice(
    0,
    PO_SCHEMA_LIMITS.voidStatusLabelMax
  );

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
    oldInvoiceNumber: existing.invoiceNumber,
    newInvoiceNumber: newInvNumber,
    previousStatus: existing.status,
    resolutionNote,
  };

  const nextRevisions = [
    ...(existing.revisions ?? []),
    revisionEntry,
  ].slice(-PO_SCHEMA_LIMITS.maxRevisions);

  const nowIso = new Date().toISOString();
  const replacementRecord: ClientInvoice = {
    id: newInvId,
    invoiceNumber: newInvNumber,
    invoiceDate: nextInvoiceDate,
    clientName: existing.clientName,
    brandName: existing.brandName ?? '',
    billingAddress: existing.billingAddress ?? '',
    poNumber: existing.poNumber ?? '',
    grnNumber: existing.grnNumber ?? '',
    showGRN: existing.showGRN ?? false,
    includePPN,
    ppnPercent: revBreakdown.ppnPercent,
    subtotalAmount,
    ppnAmount,
    grossAmount: revBreakdown.grossAmount,
    includePPh: revBreakdown.includePPh,
    pphAmount: revBreakdown.pphAmount,
    netAfterPph: revBreakdown.netAfterPph,
    includeCitibank: revBreakdown.includeCitibank,
    citibankFeeAmount: revBreakdown.citibankFeeAmount,
    netReceivable: revBreakdown.netReceivable,
    showSystemGeneratedNote: existing.showSystemGeneratedNote ?? true,
    projectName: existing.projectName,
    projectNumber: existing.projectNumber,
    items: cleanedItems,
    totalAmount: newAmount,
    sentDate: nextSentDate,
    paymentTermsMode: nextMode,
    paymentTermsDays: nextTermsDays,
    manualDueDateNote: existing.manualDueDateNote ?? '',
    dueDate: nextDueDate,
    status: 'Unpaid',
    paidDate: '',
    note: existing.note ?? '',
    isVoided: false,
    revisionSubStatus,
    previousPaidAmount,
    revisions: nextRevisions,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const voidedExisting: ClientInvoiceInput = {
    ...existing,
    isVoided: true,
    voidStatusLabel,
    replacedByInvoiceId: newInvId,
    replacedByInvoiceNumber: newInvNumber,
    revisions: nextRevisions,
  };

  const { error: updateErr } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(voidedExisting, schema, {
        updatedAt: nowIso,
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (updateErr) {
    throw reportSupabaseError(`Gagal mem-void Invoice (${id}) di Supabase`, updateErr);
  }

  const sanitizedNew = sanitizeClientInvoiceInput(replacementRecord);
  const { error: insertErr } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'insert',
    buildPayload: (schema, excluded) =>
      sanitizeClientInvoiceDbPayload(sanitizedNew, schema, {
        id: newInvId,
        createdAt: nowIso,
        updatedAt: nowIso,
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).insert([payload]).select(),
  });

  if (insertErr) {
    throw reportSupabaseError(`Gagal membuat Invoice revisi (${newInvId}) di Supabase`, insertErr);
  }

  await refreshClientInvoicesFromSupabase();
  return newInvId;
}

export async function softDeleteClientInvoice(
  id: string,
  actor: AuditActor,
  reason?: string
): Promise<void> {
  if (!id || !id.trim()) {
    throw new Error('ID Invoice Client tidak valid untuk dihapus.');
  }

  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus Invoice Client di Supabase', configError);
  }

  const nowIso = new Date().toISOString();
  const cleanByName = `${actor.name} (${actor.roleName})`.trim().slice(0, 160);
  const cleanByEmail = (actor.email || '').trim().slice(0, 180);
  const cleanReason = (reason ?? '').trim().slice(0, 300);

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    throw reportSupabaseError(
      `Gagal membaca data Invoice (${id}) sebelum hapus`,
      fetchErr
    );
  }
  const existing = row ? normalizeClientInvoice(row as Record<string, unknown>, id) : null;

  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) => {
      if (existing) {
        return sanitizeClientInvoiceDbPayload(
          {
            ...existing,
            isDeleted: true,
            deletedAt: nowIso,
            deletedByName: cleanByName,
            deletedByEmail: cleanByEmail,
            deleteReason: cleanReason,
          },
          schema,
          { updatedAt: nowIso, excludedColumns: excluded }
        );
      }
      return sanitizePayloadByWhitelist({
        rawPayload: {
          is_deleted: true,
          deleted_at: nowIso,
          deleted_by_name: cleanByName,
          deleted_by_email: cleanByEmail,
          delete_reason: cleanReason,
          updated_at: nowIso,
        },
        fallbackColumns: CLIENT_INVOICE_FALLBACK_WHITELIST,
        schema,
        aliases: CLIENT_INVOICE_COLUMN_ALIASES,
        excludeFromDropped: CLIENT_INVOICE_EXCLUDE_FROM_DROPPED,
        excludedColumns: excluded,
      }).payload;
    },
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(
      `Gagal memindahkan Invoice (${id}) ke Riwayat Hapus di Supabase (${TABLE_NAME})`,
      error
    );
  }

  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal memindahkan Invoice (${id}) ke Riwayat Hapus di Supabase (${TABLE_NAME})`,
      new Error(
        `Baris invoice tidak ter-update di Supabase (periksa ID atau RLS policy UPDATE/SELECT pada tabel ${TABLE_NAME}).`
      )
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function restoreClientInvoice(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memulihkan Invoice Client di Supabase', configError);
  }

  const { data: row } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  const existing = row ? normalizeClientInvoice(row as Record<string, unknown>, id) : null;

  const nowIso = new Date().toISOString();
  const { data: updatedRows, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) => {
      if (existing) {
        return sanitizeClientInvoiceDbPayload(
          {
            ...existing,
            isDeleted: false,
            deletedAt: '',
            deletedByName: '',
            deletedByEmail: '',
            deleteReason: '',
          },
          schema,
          { updatedAt: nowIso, excludedColumns: excluded }
        );
      }
      return sanitizePayloadByWhitelist({
        rawPayload: {
          is_deleted: false,
          deleted_at: null,
          deleted_by_name: '',
          deleted_by_email: '',
          delete_reason: '',
          updated_at: nowIso,
        },
        fallbackColumns: CLIENT_INVOICE_FALLBACK_WHITELIST,
        schema,
        aliases: CLIENT_INVOICE_COLUMN_ALIASES,
        excludeFromDropped: CLIENT_INVOICE_EXCLUDE_FROM_DROPPED,
        excludedColumns: excluded,
      }).payload;
    },
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select(),
  });

  if (error) {
    throw reportSupabaseError(
      `Gagal memulihkan Invoice (${id}) di Supabase (${TABLE_NAME})`,
      error
    );
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal memulihkan Invoice (${id}) di Supabase (${TABLE_NAME})`,
      new Error('Baris invoice tidak ter-update saat memulihkan.')
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function deleteClientInvoice(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus permanen Invoice Client di Supabase', configError);
  }

  const { data: deletedRows, error } = await client
    .from(TABLE_NAME)
    .delete()
    .eq('id', id)
    .select();
  if (error) {
    throw reportSupabaseError(
      `Gagal menghapus permanen Invoice (${id}) di Supabase (${TABLE_NAME})`,
      error
    );
  }
  if (!deletedRows || (Array.isArray(deletedRows) && deletedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal menghapus permanen Invoice (${id}) di Supabase (${TABLE_NAME})`,
      new Error(
        `Data invoice tidak terhapus di Supabase (periksa ID atau RLS policy DELETE pada tabel ${TABLE_NAME}).`
      )
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export async function updateClientInvoiceRealisasi(
  id: string,
  realisasiAmount: number
): Promise<void> {
  if (!id || !id.trim()) {
    throw new Error('ID Invoice Client wajib ada saat update Realisasi.');
  }
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan Realisasi Invoice Client ke Supabase', configError);
  }

  const cleanAmount = Number.isFinite(realisasiAmount)
    ? Math.max(0, Math.min(CLIENT_INVOICE_SCHEMA_LIMITS.maxBankBalance, Math.round(realisasiAmount)))
    : 0;

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    throw reportSupabaseError(
      `Gagal membaca Invoice Client (${id}) sebelum update Realisasi`,
      fetchErr
    );
  }

  const rawRow = (row ?? {}) as Record<string, unknown>;
  const existing = row ? normalizeClientInvoice(rawRow, id) : null;
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
        fallbackColumns: CLIENT_INVOICE_FALLBACK_WHITELIST,
        schema,
        aliases: CLIENT_INVOICE_COLUMN_ALIASES,
        excludeFromDropped: CLIENT_INVOICE_EXCLUDE_FROM_DROPPED,
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
    throw reportSupabaseError(
      `Gagal menyimpan Realisasi Invoice Client (${id}) ke Supabase (${TABLE_NAME})`,
      error
    );
  }
  if (!updatedRows || (Array.isArray(updatedRows) && updatedRows.length === 0)) {
    throw reportSupabaseError(
      `Gagal menyimpan Realisasi Invoice Client (${id}) ke Supabase (${TABLE_NAME})`,
      new Error(`0 baris terupdate untuk Invoice Client (${id}). Periksa ID atau RLS policy.`)
    );
  }

  await refreshClientInvoicesFromSupabase();
}

export const createInvoice = createClientInvoice;
export const updateInvoice = updateClientInvoice;
export const deleteInvoice = softDeleteClientInvoice;
