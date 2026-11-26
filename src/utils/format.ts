import {
  DocumentRevisionEntry,
  PAYMENT_TERM_RULES,
  PaymentTermDays,
  PaymentTermsMode,
  PO_SCHEMA_LIMITS,
  PO_STATUS_META,
  POLineItem,
  PurchaseOrder,
  PurchaseOrderInput,
  RevisionSubStatus,
  VendorPphStatus,
  VendorPphType,
  VoidedInvoiceRecord,
} from '../types/po';

const idNumberFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatIDR(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return idNumberFormatter.format(Math.round(value));
}

const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

const MONTH_NAMES_ID_SHORT = [
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

const MONTH_NAMES_EN_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatDocumentDate(isoDate: string): string {
  if (!isoDate || !PO_SCHEMA_LIMITS.datePattern.test(isoDate)) return isoDate || '-';
  const [year, monthStr, dayStr] = isoDate.split('-');
  const monthIdx = Number(monthStr) - 1;
  const day = dayStr.padStart(2, '0');
  const monthName = MONTH_NAMES_ID[monthIdx] || monthStr;
  return `${day} ${monthName} ${year}`;
}

export function formatShortDateID(isoDate: string): string {
  if (!isoDate || !PO_SCHEMA_LIMITS.datePattern.test(isoDate)) return isoDate || '-';
  const [year, monthStr, dayStr] = isoDate.split('-');
  const monthIdx = Number(monthStr) - 1;
  const day = String(Number(dayStr));
  const monthName = MONTH_NAMES_ID_SHORT[monthIdx] || monthStr;
  return `${day} ${monthName} ${year}`;
}

export function formatEnglishShortDate(isoDate: string): string {
  if (!isoDate || !PO_SCHEMA_LIMITS.datePattern.test(isoDate)) return isoDate || '-';
  const [year, monthStr, dayStr] = isoDate.split('-');
  const monthIdx = Number(monthStr) - 1;
  const day = String(Number(dayStr));
  const monthName = MONTH_NAMES_EN_SHORT[monthIdx] || monthStr;
  return `${day} ${monthName} ${year}`;
}

export function getTodayISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatMonthYearID(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec((monthKey || '').trim());
  if (!match) return monthKey || '-';
  const year = match[1];
  const idx = Number(match[2]) - 1;
  const monthName = MONTH_NAMES_ID[idx] || match[2];
  return `${monthName} ${year}`;
}

export function diffCalendarMonths(fromMonthOrISO: string, toMonthOrISO: string): number {
  const fromMK = (fromMonthOrISO || '').slice(0, 7);
  const toMK = (toMonthOrISO || '').slice(0, 7);
  const m1 = /^(\d{4})-(\d{2})$/.exec(fromMK);
  const m2 = /^(\d{4})-(\d{2})$/.exec(toMK);
  if (!m1 || !m2) return 0;
  return (Number(m2[1]) - Number(m1[1])) * 12 + (Number(m2[2]) - Number(m1[2]));
}

export interface DueTunggakanStatus {
  isOverdue: boolean;
  isTunggakan: boolean;
  monthsLate: number;
  dueMonthKey: string;
  dueMonthLabel: string;
  statusText: string;
  lateBadgeText: string;
}

export function computeDueTunggakanStatus(params: {
  dueISO?: string;
  originMonthKey?: string;
  todayISO?: string;
  isPaid?: boolean;
}): DueTunggakanStatus {
  const todayISO =
    params.todayISO && PO_SCHEMA_LIMITS.datePattern.test(params.todayISO)
      ? params.todayISO
      : getTodayISODate();
  const validDueISO =
    params.dueISO && PO_SCHEMA_LIMITS.datePattern.test(params.dueISO)
      ? params.dueISO
      : '';
  const validOriginMK =
    params.originMonthKey && /^\d{4}-\d{2}$/.test(params.originMonthKey)
      ? params.originMonthKey
      : '';

  const fallbackMK = validDueISO
    ? validDueISO.slice(0, 7)
    : validOriginMK || todayISO.slice(0, 7);
  const dueMonthLabel = formatMonthYearID(fallbackMK);

  if (params.isPaid) {
    return {
      isOverdue: false,
      isTunggakan: false,
      monthsLate: 0,
      dueMonthKey: fallbackMK,
      dueMonthLabel,
      statusText: 'Lunas',
      lateBadgeText: '',
    };
  }

  if (validDueISO) {
    // Jika hari ini < tanggal jatuh tempo: status = "Belum Jatuh Tempo" / "Projection", JANGAN tampilkan label "Tunggakan".
    if (todayISO < validDueISO) {
      return {
        isOverdue: false,
        isTunggakan: false,
        monthsLate: 0,
        dueMonthKey: fallbackMK,
        dueMonthLabel,
        statusText: 'Belum Jatuh Tempo',
        lateBadgeText: '',
      };
    }

    // Hari ini >= tanggal jatuh tempo dan belum lunas -> "Tunggakan dari [Bulan Jatuh Tempo itu sendiri]"
    const monthsLate = Math.max(0, diffCalendarMonths(validDueISO, todayISO));
    return {
      isOverdue: todayISO > validDueISO,
      isTunggakan: true,
      monthsLate,
      dueMonthKey: fallbackMK,
      dueMonthLabel,
      statusText: `Tunggakan dari ${dueMonthLabel}`,
      lateBadgeText: monthsLate > 0 ? `TERLAMBAT ${monthsLate} BULAN` : '',
    };
  }

  if (validOriginMK) {
    const todayMK = todayISO.slice(0, 7);
    if (todayMK < validOriginMK) {
      return {
        isOverdue: false,
        isTunggakan: false,
        monthsLate: 0,
        dueMonthKey: validOriginMK,
        dueMonthLabel,
        statusText: 'Belum Jatuh Tempo',
        lateBadgeText: '',
      };
    }
    const monthsLate = Math.max(0, diffCalendarMonths(validOriginMK, todayMK));
    return {
      isOverdue: monthsLate > 0,
      isTunggakan: true,
      monthsLate,
      dueMonthKey: validOriginMK,
      dueMonthLabel,
      statusText: `Tunggakan dari ${dueMonthLabel}`,
      lateBadgeText: monthsLate > 0 ? `TERLAMBAT ${monthsLate} BULAN` : '',
    };
  }

  return {
    isOverdue: false,
    isTunggakan: false,
    monthsLate: 0,
    dueMonthKey: fallbackMK,
    dueMonthLabel,
    statusText: 'Projection',
    lateBadgeText: '',
  };
}

export function isValidIsoCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

/**
 * Mengonversi berbagai format tanggal (DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD, YYYY-MM-DD, ISO timestamp)
 * menjadi string ISO YYYY-MM-DD yang valid, atau undefined jika kosong/tidak valid.
 */
export function normalizeToIsoDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const iso = `${String(y).padStart(4, '0')}-${m}-${d}`;
    return isValidIsoCalendarDate(iso) ? iso : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(trimmed);
  if (isoPrefix) {
    const candidate = `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;
    return isValidIsoCalendarDate(candidate) ? candidate : undefined;
  }

  // DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY or D-M-YYYY
  const dmyMatch = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    const y = dmyMatch[3];
    const candidate = `${y}-${m}-${d}`;
    return isValidIsoCalendarDate(candidate) ? candidate : undefined;
  }

  // YYYY/MM/DD or YYYY/M/D
  const ymdSlashMatch = /^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/.exec(trimmed);
  if (ymdSlashMatch) {
    const y = ymdSlashMatch[1];
    const m = ymdSlashMatch[2].padStart(2, '0');
    const d = ymdSlashMatch[3].padStart(2, '0');
    const candidate = `${y}-${m}-${d}`;
    return isValidIsoCalendarDate(candidate) ? candidate : undefined;
  }

  return undefined;
}


export function sanitizePaymentTermsDays(days?: number): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return 30;
  return Math.min(PO_SCHEMA_LIMITS.paymentTermsMaxDays, Math.max(0, Math.round(days)));
}

export function sanitizeOptionalPaymentTermsDays(days?: number): number | undefined {
  if (typeof days !== 'number' || !Number.isFinite(days)) return undefined;
  return Math.min(PO_SCHEMA_LIMITS.paymentTermsMaxDays, Math.max(0, Math.round(days)));
}

export function hasVendorInvoice(
  po: Pick<PurchaseOrder, 'invoiceDate' | 'invoiceNumber' | 'paymentTermsMode' | 'dueDate'>
): boolean {
  if (po.invoiceDate && PO_SCHEMA_LIMITS.datePattern.test(po.invoiceDate)) {
    return true;
  }
  return Boolean(
    po.paymentTermsMode === 'MANUAL' &&
      po.dueDate &&
      PO_SCHEMA_LIMITS.datePattern.test(po.dueDate)
  );
}

export function isVendorPOLunas(
  po: Pick<PurchaseOrder, 'status' | 'statusWarna'>
): boolean {
  const st = String(po.status ?? '').trim().toUpperCase();
  const sw = String(po.statusWarna ?? '').trim().toUpperCase();
  const sl = String(
    PO_STATUS_META[po.status as keyof typeof PO_STATUS_META]?.label ?? ''
  )
    .trim()
    .toUpperCase();
  return (
    st === 'PAID' ||
    st === 'LUNAS' ||
    sw === 'HIJAU' ||
    sw === 'PAID' ||
    sw === 'LUNAS' ||
    sl === 'LUNAS'
  );
}

export function isVendorPODitagih(
  po: Pick<
    PurchaseOrder,
    'status' | 'statusWarna' | 'invoiceDate' | 'invoiceNumber' | 'paymentTermsMode' | 'dueDate'
  >
): boolean {
  if (isVendorPOLunas(po)) return false;
  const st = String(po.status ?? '').trim().toUpperCase();
  return (
    st === 'INVOICED' ||
    st === 'SUDAH DITAGIH' ||
    st === 'OVERDUE' ||
    st === 'PENDING' ||
    st === 'RESCHEDULE' ||
    (st === 'NOT PAID' && hasVendorInvoice(po))
  );
}

export function canCancelVendorPOInvoice(
  po: Pick<
    PurchaseOrder,
    'status' | 'statusWarna' | 'invoiceDate' | 'invoiceNumber' | 'paymentTermsMode' | 'dueDate'
  >
): boolean {
  return isVendorPOLunas(po) || isVendorPODitagih(po);
}

export function getSuggestedPaymentTermsDays(totalAmount: number): PaymentTermDays {
  const safeTotal = Number.isFinite(totalAmount) ? totalAmount : 0;
  if (safeTotal < 10_000_000) return 30;
  if (safeTotal < 50_000_000) return 45;
  if (safeTotal <= 100_000_000) return 60;
  return 90;
}

export function formatPaymentTermsLabel(
  days?: number,
  mode?: PaymentTermsMode
): string {
  if (mode === 'MANUAL') return 'MANUAL';
  if (typeof days !== 'number' || !Number.isFinite(days)) return '-';
  const rounded = Math.min(PO_SCHEMA_LIMITS.paymentTermsMaxDays, Math.max(0, Math.round(days)));
  if (rounded === 30 || rounded === 45 || rounded === 60 || rounded === 90) {
    return PAYMENT_TERM_RULES[rounded].shortRangeLabel;
  }
  return `NET ${rounded}`;
}

export function calculateDueDate(invoiceDate: string, paymentTermsDays = 30): string {
  if (!invoiceDate || !PO_SCHEMA_LIMITS.datePattern.test(invoiceDate)) return '';
  const [yStr, mStr, dStr] = invoiceDate.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  const safeDays = sanitizePaymentTermsDays(paymentTermsDays);
  const utc = new Date(Date.UTC(y, m - 1, d + safeDays));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getEffectiveDueDate(
  po: Pick<PurchaseOrder, 'dueDate' | 'invoiceDate' | 'paymentTermsDays' | 'paymentTermsMode'>
): string {
  if (po.paymentTermsMode === 'MANUAL') {
    return po.dueDate && PO_SCHEMA_LIMITS.datePattern.test(po.dueDate) ? po.dueDate : '';
  }
  if (!po.invoiceDate || !PO_SCHEMA_LIMITS.datePattern.test(po.invoiceDate)) {
    return '';
  }
  if (po.dueDate && PO_SCHEMA_LIMITS.datePattern.test(po.dueDate)) {
    return po.dueDate;
  }
  if (typeof po.paymentTermsDays === 'number' && Number.isFinite(po.paymentTermsDays)) {
    return calculateDueDate(po.invoiceDate, po.paymentTermsDays);
  }
  return '';
}

export function getRemainingDays(dueDate: string): number | null {
  if (!dueDate || !PO_SCHEMA_LIMITS.datePattern.test(dueDate)) return null;
  const [dyStr, dmStr, ddStr] = dueDate.split('-');
  const dueMs = Date.UTC(Number(dyStr), Number(dmStr) - 1, Number(ddStr));
  const [tyStr, tmStr, tdStr] = getTodayISODate().split('-');
  const todayMs = Date.UTC(Number(tyStr), Number(tmStr) - 1, Number(tdStr));
  return Math.round((dueMs - todayMs) / 86400000);
}

export function isEffectiveOverdue(po: PurchaseOrder): boolean {
  if (po.status === 'Paid') return false;
  const due = getEffectiveDueDate(po);
  const rem = getRemainingDays(due);
  return rem !== null && rem < 0;
}

export function isDueWithinWeek(po: PurchaseOrder): boolean {
  if (po.status === 'Paid') return false;
  const due = getEffectiveDueDate(po);
  const rem = getRemainingDays(due);
  return rem !== null && rem >= 0 && rem <= 7;
}

export function generateNextPONumber(existingPOs: PurchaseOrder[], targetYear?: number): string {
  const year = targetYear ?? new Date().getFullYear();
  let maxSeq = 0;

  for (const po of existingPOs) {
    const match = po.poNumber.trim().match(/^(\d{1,5})\/PO-KKB\/(\d{4})$/i);
    if (match) {
      const seq = Number.parseInt(match[1], 10);
      const poYear = Number.parseInt(match[2], 10);
      if (poYear === year && Number.isFinite(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${nextSeq}/PO-KKB/${year}`;
}

export function generateDefaultInvoiceNumber(poNumber: string, existingPOs: PurchaseOrder[]): string {
  const match = poNumber.trim().match(/^(\d{1,5})\/PO-KKB\/(\d{4})$/i);
  if (match) {
    return `INV-${match[1]}/KKB/${match[2]}`;
  }
  const invoicedCount = existingPOs.filter(
    (item) => item.status === 'Invoiced' || item.status === 'Paid'
  ).length;
  const seq = String(invoicedCount + 1).padStart(3, '0');
  return `INV-${seq}/KKB/${new Date().getFullYear()}`;
}

export function generateNextRevisionInvoiceNumber(
  currentInvNumber: string,
  fallbackBase = 'INV-001'
): string {
  const clean = (currentInvNumber || fallbackBase).trim();
  const match = clean.match(/^(.*?)\s+REV\s+(\d+)$/i);
  if (match) {
    const base = match[1].trim();
    const nextRev = Number.parseInt(match[2], 10) + 1;
    const candidate = `${base} REV ${nextRev}`;
    return candidate.slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax);
  }
  const suffix = ' REV 1';
  const maxBaseLen = PO_SCHEMA_LIMITS.invoiceNumberMax - suffix.length;
  return `${clean.slice(0, maxBaseLen)}${suffix}`;
}

export function getNowRevisionTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function computeRevisionOutcome(
  previousWasPaid: boolean,
  oldAmount: number,
  newAmount: number
): {
  diffAmount: number;
  revisionSubStatus: RevisionSubStatus;
  resolutionNote: string;
} {
  const cleanOld = Math.round(Number.isFinite(oldAmount) ? oldAmount : 0);
  const cleanNew = Math.round(Number.isFinite(newAmount) ? newAmount : 0);
  const diffAmount = cleanNew - cleanOld;

  if (previousWasPaid) {
    if (diffAmount < 0) {
      return {
        diffAmount,
        revisionSubStatus: 'Menunggu Konfirmasi',
        resolutionNote: `Kelebihan bayar Rp ${formatIDR(
          Math.abs(diffAmount)
        )}, perlu refund / jadi kredit client`,
      };
    }
    if (diffAmount > 0) {
      return {
        diffAmount,
        revisionSubStatus: 'Menunggu Pembayaran Ulang',
        resolutionNote: `Kurang bayar Rp ${formatIDR(diffAmount)}, perlu tagih susulan`,
      };
    }
    return {
      diffAmount: 0,
      revisionSubStatus: 'Revisi',
      resolutionNote: 'Revisi dari status LUNAS (nominal tetap)',
    };
  }

  return {
    diffAmount,
    revisionSubStatus: 'Revisi',
    resolutionNote:
      diffAmount === 0
        ? 'Revisi keterangan / termin (nominal tetap)'
        : diffAmount > 0
        ? `Selisih tambah +Rp ${formatIDR(diffAmount)}`
        : `Selisih kurang -Rp ${formatIDR(Math.abs(diffAmount))}`,
  };
}

export function sanitizeRevisionEntries(
  entries?: DocumentRevisionEntry[]
): DocumentRevisionEntry[] | undefined {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  return entries.slice(0, PO_SCHEMA_LIMITS.maxRevisions).map((e) => ({
    id: String(e.id || '').slice(0, 64) || `rev_${Date.now()}`,
    revisedAt: String(e.revisedAt || getNowRevisionTimestamp()).slice(0, 32),
    revisedBy:
      String(e.revisedBy || PO_SCHEMA_LIMITS.defaultRevisionUser)
        .trim()
        .slice(0, PO_SCHEMA_LIMITS.revisedByMax) || PO_SCHEMA_LIMITS.defaultRevisionUser,
    reason: String(e.reason || '-').trim().slice(0, PO_SCHEMA_LIMITS.revisionReasonMax) || '-',
    oldAmount: Math.max(0, Math.round(Number(e.oldAmount) || 0)),
    newAmount: Math.max(0, Math.round(Number(e.newAmount) || 0)),
    diffAmount: Math.round(Number(e.diffAmount) || 0),
    oldInvoiceNumber: String(e.oldInvoiceNumber || '').slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax),
    newInvoiceNumber:
      String(e.newInvoiceNumber || '-').slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax) || '-',
    previousStatus: String(e.previousStatus || 'Invoiced').slice(0, 32) || 'Invoiced',
    resolutionNote: String(e.resolutionNote || '').slice(0, PO_SCHEMA_LIMITS.resolutionNoteMax),
  }));
}

export function sanitizeVoidedInvoiceRecords(
  records?: VoidedInvoiceRecord[]
): VoidedInvoiceRecord[] | undefined {
  if (!Array.isArray(records) || records.length === 0) return undefined;
  return records.slice(0, PO_SCHEMA_LIMITS.maxVoidedInvoices).map((v) => ({
    id: String(v.id || '').slice(0, 64) || `void_${Date.now()}`,
    invoiceNumber: String(v.invoiceNumber || '').slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax),
    invoiceDate: PO_SCHEMA_LIMITS.datePattern.test(String(v.invoiceDate || ''))
      ? String(v.invoiceDate)
      : '',
    dueDate: PO_SCHEMA_LIMITS.datePattern.test(String(v.dueDate || ''))
      ? String(v.dueDate)
      : '',
    totalAmount: Math.max(0, Math.round(Number(v.totalAmount) || 0)),
    items: Array.isArray(v.items) && v.items.length > 0
      ? v.items.slice(0, PO_SCHEMA_LIMITS.maxItems).map((it) => ({
          description: String(it.description || '-').slice(0, PO_SCHEMA_LIMITS.descriptionMax) || '-',
          quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
          unitPrice: Math.max(0, Number(it.unitPrice) || 0),
          amount: Math.max(0, Math.round(Number(it.amount) || 0)),
        }))
      : [{ description: '-', quantity: 1, unitPrice: 0, amount: 0 }],
    statusLabel:
      String(v.statusLabel || 'VOID / DIREVISI').slice(0, PO_SCHEMA_LIMITS.voidStatusLabelMax) ||
      'VOID / DIREVISI',
    replacedByInvoiceNumber:
      String(v.replacedByInvoiceNumber || '-').slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax) || '-',
    voidedAt: PO_SCHEMA_LIMITS.datePattern.test(String(v.voidedAt || ''))
      ? String(v.voidedAt)
      : getTodayISODate(),
    reason: String(v.reason || '-').trim().slice(0, PO_SCHEMA_LIMITS.revisionReasonMax) || '-',
  }));
}

export interface VendorInvoiceTaxBreakdown {
  dppAmount: number;
  ppnRate: number;
  ppnAmount: number;
  grossAmount: number;
  pphType: VendorPphType;
  pphRate: number;
  pphAmount: number;
  netAkhir: number;
}

export function sanitizeVendorPphType(raw: unknown): VendorPphType {
  const upper = String(raw ?? '').trim().toUpperCase();
  if (upper === 'PPH21') return 'PPH21';
  if (upper === 'PPH23') return 'PPH23';
  return 'NONE';
}

export function sanitizeVendorPphStatus(raw: unknown): VendorPphStatus {
  const clean = String(raw ?? '').trim().toLowerCase();
  if (clean === 'sudah disubmit' || clean === 'submitted' || clean === 'sudah') {
    return 'Sudah Disubmit';
  }
  return 'Belum Disubmit';
}

export function parseTaxRateInput(raw: string): number {
  const normalized = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/,/g, '.');
  if (!normalized) return 0;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

export function formatTaxRateForInput(rate: number): string {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return '0';
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded).replace('.', ',');
}

export function calculateVendorInvoiceTaxBreakdown(params: {
  dpp: number;
  ppnRate: number;
  pphType: VendorPphType;
  pphRate: number;
}): VendorInvoiceTaxBreakdown {
  const dppAmount = Math.max(0, Math.round(Number(params.dpp) || 0));
  const rawPpnRate = Number(params.ppnRate);
  const ppnRate =
    Number.isFinite(rawPpnRate) && rawPpnRate > 0 ? Math.min(100, rawPpnRate) : 0;
  const ppnAmount = Math.floor((dppAmount * ppnRate) / 100);
  const grossAmount = Math.round(dppAmount + ppnAmount);

  const pphType = sanitizeVendorPphType(params.pphType);
  const rawPphRate = Number(params.pphRate);
  const pphRate =
    pphType === 'NONE'
      ? 0
      : Number.isFinite(rawPphRate) && rawPphRate > 0
      ? Math.min(100, rawPphRate)
      : 0;
  const pphAmount = pphType === 'NONE' ? 0 : Math.floor((dppAmount * pphRate) / 100);
  const netAkhir = Math.max(0, Math.round(dppAmount + ppnAmount - pphAmount));

  return {
    dppAmount,
    ppnRate,
    ppnAmount,
    grossAmount,
    pphType,
    pphRate,
    pphAmount,
    netAkhir,
  };
}

export interface ResolvedVendorPOTaxDetails extends VendorInvoiceTaxBreakdown {
  isBilled: boolean;
  isTaxIncomplete: boolean;
  hasPph: boolean;
  pphStatus: VendorPphStatus;
  pphDate: string;
  isPphSubmitted: boolean;
  effectiveAmount: number;
}

export function resolveVendorPOTaxDetails(
  po: Pick<
    PurchaseOrder,
    | 'status'
    | 'totalAmount'
    | 'invoiceDate'
    | 'invoiceNumber'
    | 'paymentTermsMode'
    | 'dueDate'
    | 'dppAmount'
    | 'ppnRate'
    | 'ppnAmount'
    | 'grossAmount'
    | 'pphType'
    | 'pphRate'
    | 'pphAmount'
    | 'pphStatus'
    | 'pphDate'
    | 'netAkhir'
  >
): ResolvedVendorPOTaxDetails {
  const isBilled =
    po.status === 'Invoiced' ||
    po.status === 'Paid' ||
    po.status === 'Reschedule' ||
    hasVendorInvoice(po);

  const dppAmount = Math.max(0, Math.round(Number(po.dppAmount) || 0));
  const rawPpnRate = Number(po.ppnRate);
  const ppnRate =
    Number.isFinite(rawPpnRate) && rawPpnRate > 0 ? Math.min(100, rawPpnRate) : 0;
  const storedPpn = Math.max(0, Math.round(Number(po.ppnAmount) || 0));
  const ppnAmount =
    storedPpn > 0
      ? storedPpn
      : ppnRate > 0 && dppAmount > 0
      ? Math.floor((dppAmount * ppnRate) / 100)
      : 0;

  const pphType = sanitizeVendorPphType(po.pphType);
  const rawPphRate = Number(po.pphRate);
  const pphRate =
    pphType === 'NONE'
      ? 0
      : Number.isFinite(rawPphRate) && rawPphRate > 0
      ? Math.min(100, rawPphRate)
      : pphType === 'PPH21'
      ? 2.5
      : pphType === 'PPH23'
      ? 2
      : 0;
  const storedPph = Math.max(0, Math.round(Number(po.pphAmount) || 0));
  const pphAmount =
    pphType === 'NONE'
      ? 0
      : storedPph > 0
      ? storedPph
      : pphRate > 0 && dppAmount > 0
      ? Math.floor((dppAmount * pphRate) / 100)
      : 0;

  const storedGross = Math.max(0, Math.round(Number(po.grossAmount) || 0));
  const grossAmount =
    dppAmount > 0 ? dppAmount + ppnAmount : storedGross;

  const storedNet = Math.max(0, Math.round(Number(po.netAkhir) || 0));
  const netAkhir =
    dppAmount > 0 ? Math.max(0, grossAmount - pphAmount) : storedNet;

  const isTaxIncomplete = isBilled && dppAmount <= 0 && storedNet <= 0;
  const hasPph = pphType !== 'NONE' && pphAmount > 0;
  const pphStatus = sanitizeVendorPphStatus(po.pphStatus);
  const isPphSubmitted = !hasPph || pphStatus === 'Sudah Disubmit';
  const pphDate =
    po.pphDate && PO_SCHEMA_LIMITS.datePattern.test(po.pphDate) ? po.pphDate : '';

  let effectiveAmount = Math.max(0, Math.round(Number(po.totalAmount) || 0));
  if (isBilled) {
    if (isTaxIncomplete) {
      effectiveAmount = 0;
    } else if (hasPph && !isPphSubmitted) {
      // PPh belum disubmit -> masih Gross (DPP + PPN)
      effectiveAmount = grossAmount;
    } else {
      // Sudah disubmit atau tanpa PPh -> langsung NET (DPP + PPN - PPh)
      effectiveAmount = netAkhir;
    }
  }

  return {
    dppAmount,
    ppnRate,
    ppnAmount,
    grossAmount,
    pphType,
    pphRate,
    pphAmount,
    netAkhir,
    isBilled,
    isTaxIncomplete,
    hasPph,
    pphStatus,
    pphDate,
    isPphSubmitted,
    effectiveAmount,
  };
}

export function getVendorPOEffectiveCostAmount(
  po: Parameters<typeof resolveVendorPOTaxDetails>[0]
): number {
  return resolveVendorPOTaxDetails(po).effectiveAmount;
}

export function sanitizePOInput(input: PurchaseOrderInput): PurchaseOrderInput {
  const cleanedItems: POLineItem[] = input.items
    .slice(0, PO_SCHEMA_LIMITS.maxItems)
    .map((item) => {
      const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
      const unitPrice = Number.isFinite(item.unitPrice) && item.unitPrice >= 0 ? item.unitPrice : 0;
      const amount = Math.round(qty * unitPrice);
      return {
        description: item.description.trim().slice(0, PO_SCHEMA_LIMITS.descriptionMax),
        quantity: qty,
        unitPrice,
        amount,
      };
    });

  const totalAmount = cleanedItems.reduce((sum, item) => sum + item.amount, 0);
  const cleanInvoiceDate = (input.invoiceDate ?? '').trim().slice(0, 10);
  const hasInvDate = Boolean(
    cleanInvoiceDate && PO_SCHEMA_LIMITS.datePattern.test(cleanInvoiceDate)
  );
  const isManualMode = input.paymentTermsMode === 'MANUAL';
  const cleanManualDueDate = (input.dueDate ?? '').trim().slice(0, 10);
  const cleanManualNote = (input.manualDueDateNote ?? '')
    .trim()
    .slice(0, PO_SCHEMA_LIMITS.manualDueDateNoteMax);

  const cleanTermsDays = isManualMode
    ? undefined
    : hasInvDate
    ? sanitizePaymentTermsDays(input.paymentTermsDays)
    : sanitizeOptionalPaymentTermsDays(undefined);

  const computedDueDate = isManualMode
    ? cleanManualDueDate
    : hasInvDate && cleanTermsDays !== undefined
    ? calculateDueDate(cleanInvoiceDate, cleanTermsDays)
    : '';

  const resolvedMode: PaymentTermsMode | undefined = isManualMode
    ? 'MANUAL'
    : hasInvDate
    ? 'NET'
    : undefined;

  const resolvedStatusWarna =
    input.status === 'Paid' || input.statusWarna === 'HIJAU'
      ? 'HIJAU'
      : input.status === 'Reschedule' || input.statusWarna === 'MERAH'
      ? 'MERAH'
      : 'PUTIH';
  const cleanRescheduledFromMonth =
    typeof input.rescheduledFromMonth === 'string' &&
    /^\d{4}-\d{2}$/.test(input.rescheduledFromMonth.trim())
      ? input.rescheduledFromMonth.trim()
      : undefined;
  const cleanRescheduledToMonth =
    input.status === 'Reschedule' &&
    typeof input.rescheduledToMonth === 'string' &&
    /^\d{4}-\d{2}$/.test(input.rescheduledToMonth.trim())
      ? input.rescheduledToMonth.trim()
      : undefined;

  const rawRealisasi =
    input.realisasiAmount !== undefined
      ? input.realisasiAmount
      : input.actualAmount !== undefined
      ? input.actualAmount
      : undefined;
  const cleanRealisasi =
    input.status === 'Paid' &&
    typeof rawRealisasi === 'number' &&
    Number.isFinite(rawRealisasi) &&
    rawRealisasi >= 0
      ? Math.round(rawRealisasi)
      : undefined;

  return {
    poNumber: input.poNumber.trim().slice(0, PO_SCHEMA_LIMITS.poNumberMax),
    poDate: input.poDate.trim(),
    vendorName: input.vendorName.trim().slice(0, PO_SCHEMA_LIMITS.vendorNameMax),
    vendorAddress: input.vendorAddress.trim().slice(0, PO_SCHEMA_LIMITS.vendorAddressMax),
    projectName: input.projectName.trim().slice(0, PO_SCHEMA_LIMITS.projectNameMax),
    projectNumber: input.projectNumber.trim().slice(0, PO_SCHEMA_LIMITS.projectNumberMax),
    deliveryDate: input.deliveryDate.trim(),
    items: cleanedItems,
    totalAmount,
    ...(cleanRealisasi !== undefined
      ? { realisasiAmount: cleanRealisasi, actualAmount: cleanRealisasi }
      : {}),
    status: input.status,
    statusWarna: resolvedStatusWarna,
    ...(cleanRescheduledFromMonth ? { rescheduledFromMonth: cleanRescheduledFromMonth } : {}),
    ...(cleanRescheduledToMonth ? { rescheduledToMonth: cleanRescheduledToMonth } : {}),
    invoiceDate: cleanInvoiceDate,
    invoiceNumber: (input.invoiceNumber ?? '').trim().slice(0, PO_SCHEMA_LIMITS.invoiceNumberMax),
    invoiceFileUrl: (input.invoiceFileUrl ?? '').trim().slice(0, PO_SCHEMA_LIMITS.invoiceFileUrlMax),
    invoiceFileName: (input.invoiceFileName ?? '').trim().slice(0, PO_SCHEMA_LIMITS.invoiceFileNameMax),
    paymentTermsMode: resolvedMode,
    paymentTermsDays: cleanTermsDays,
    manualDueDateNote: isManualMode ? cleanManualNote : '',
    dueDate: computedDueDate,
    ...(typeof input.dppAmount === 'number' && Number.isFinite(input.dppAmount)
      ? { dppAmount: Math.max(0, Math.round(input.dppAmount)) }
      : {}),
    ...(typeof input.ppnRate === 'number' && Number.isFinite(input.ppnRate)
      ? { ppnRate: Math.max(0, Math.min(100, input.ppnRate)) }
      : {}),
    ...(typeof input.ppnAmount === 'number' && Number.isFinite(input.ppnAmount)
      ? { ppnAmount: Math.max(0, Math.round(input.ppnAmount)) }
      : {}),
    ...(typeof input.grossAmount === 'number' && Number.isFinite(input.grossAmount)
      ? { grossAmount: Math.max(0, Math.round(input.grossAmount)) }
      : {}),
    ...(input.pphType !== undefined
      ? { pphType: sanitizeVendorPphType(input.pphType) }
      : {}),
    ...(typeof input.pphRate === 'number' && Number.isFinite(input.pphRate)
      ? {
          pphRate:
            sanitizeVendorPphType(input.pphType) === 'NONE'
              ? 0
              : Math.max(0, Math.min(100, input.pphRate)),
        }
      : {}),
    ...(typeof input.pphAmount === 'number' && Number.isFinite(input.pphAmount)
      ? { pphAmount: Math.max(0, Math.round(input.pphAmount)) }
      : {}),
    ...(input.pphStatus !== undefined
      ? { pphStatus: sanitizeVendorPphStatus(input.pphStatus) }
      : {}),
    ...(input.pphDate !== undefined
      ? {
          pphDate: PO_SCHEMA_LIMITS.datePattern.test(String(input.pphDate || '').trim())
            ? String(input.pphDate).trim()
            : '',
        }
      : {}),
    ...(typeof input.netAkhir === 'number' && Number.isFinite(input.netAkhir)
      ? { netAkhir: Math.max(0, Math.round(input.netAkhir)) }
      : {}),
    note: (input.note ?? '').trim().slice(0, PO_SCHEMA_LIMITS.noteMax),
    revisionSubStatus: input.revisionSubStatus,
    previousPaidAmount: input.previousPaidAmount,
    revisions: sanitizeRevisionEntries(input.revisions),
    voidedInvoices: sanitizeVoidedInvoiceRecords(input.voidedInvoices),
  };
}

export function validatePOInput(input: PurchaseOrderInput): string | null {
  if (!input.poNumber.trim()) return 'P.O. Number wajib diisi.';
  if (input.poNumber.trim().length > PO_SCHEMA_LIMITS.poNumberMax) {
    return `P.O. Number maksimal ${PO_SCHEMA_LIMITS.poNumberMax} karakter.`;
  }
  if (!PO_SCHEMA_LIMITS.datePattern.test(input.poDate)) {
    return 'Tanggal PO tidak valid.';
  }
  if (!input.vendorName.trim()) return 'Vendor Name wajib diisi.';
  if (input.vendorName.trim().length > PO_SCHEMA_LIMITS.vendorNameMax) {
    return `Vendor Name maksimal ${PO_SCHEMA_LIMITS.vendorNameMax} karakter.`;
  }
  if (!input.vendorAddress.trim()) return 'Vendor Address wajib diisi.';
  if (input.vendorAddress.trim().length > PO_SCHEMA_LIMITS.vendorAddressMax) {
    return `Vendor Address maksimal ${PO_SCHEMA_LIMITS.vendorAddressMax} karakter.`;
  }
  if (!input.projectName.trim()) return 'Project Name wajib diisi.';
  if (input.projectName.trim().length > PO_SCHEMA_LIMITS.projectNameMax) {
    return `Project Name maksimal ${PO_SCHEMA_LIMITS.projectNameMax} karakter.`;
  }
  if (!input.projectNumber.trim()) return 'Project Number wajib diisi.';
  if (input.projectNumber.trim().length > PO_SCHEMA_LIMITS.projectNumberMax) {
    return `Project Number maksimal ${PO_SCHEMA_LIMITS.projectNumberMax} karakter.`;
  }
  if (!PO_SCHEMA_LIMITS.datePattern.test(input.deliveryDate)) {
    return 'Delivery Date wajib diisi dengan format tanggal yang valid.';
  }
  if (input.invoiceDate && !PO_SCHEMA_LIMITS.datePattern.test(input.invoiceDate)) {
    return 'Tanggal Invoice tidak valid.';
  }
  if (input.invoiceNumber && input.invoiceNumber.trim().length > PO_SCHEMA_LIMITS.invoiceNumberMax) {
    return `No. Invoice maksimal ${PO_SCHEMA_LIMITS.invoiceNumberMax} karakter.`;
  }
  if (
    input.invoiceFileUrl &&
    input.invoiceFileUrl.trim().length > PO_SCHEMA_LIMITS.invoiceFileUrlMax
  ) {
    return `Link File Invoice maksimal ${PO_SCHEMA_LIMITS.invoiceFileUrlMax} karakter.`;
  }
  if (
    input.paymentTermsMode === 'MANUAL' &&
    (!input.dueDate || !PO_SCHEMA_LIMITS.datePattern.test(input.dueDate))
  ) {
    return 'Jatuh Tempo Manual wajib diisi kalau pilih MANUAL.';
  }
  if (
    input.manualDueDateNote &&
    input.manualDueDateNote.trim().length > PO_SCHEMA_LIMITS.manualDueDateNoteMax
  ) {
    return `Keterangan Manual maksimal ${PO_SCHEMA_LIMITS.manualDueDateNoteMax} karakter.`;
  }
  if (
    input.paymentTermsDays !== undefined &&
    (!Number.isFinite(input.paymentTermsDays) ||
      input.paymentTermsDays < 0 ||
      input.paymentTermsDays > PO_SCHEMA_LIMITS.paymentTermsMaxDays)
  ) {
    return `Payment Terms harus antara 0 sampai ${PO_SCHEMA_LIMITS.paymentTermsMaxDays} hari.`;
  }
  if (input.note && input.note.trim().length > PO_SCHEMA_LIMITS.noteMax) {
    return `Note maksimal ${PO_SCHEMA_LIMITS.noteMax} karakter.`;
  }
  if (!input.items.length || input.items.length > PO_SCHEMA_LIMITS.maxItems) {
    return `Daftar produk harus berisi 1 sampai ${PO_SCHEMA_LIMITS.maxItems} baris.`;
  }
  for (let i = 0; i < input.items.length; i += 1) {
    const item = input.items[i];
    if (!item.description.trim()) {
      return `Product Description pada baris ${i + 1} wajib diisi.`;
    }
    if (item.description.trim().length > PO_SCHEMA_LIMITS.descriptionMax) {
      return `Product Description baris ${i + 1} maksimal ${PO_SCHEMA_LIMITS.descriptionMax} karakter.`;
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return `Quantity pada baris ${i + 1} harus lebih besar dari 0.`;
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return `Unit Price pada baris ${i + 1} tidak boleh negatif.`;
    }
  }
  return null;
}
