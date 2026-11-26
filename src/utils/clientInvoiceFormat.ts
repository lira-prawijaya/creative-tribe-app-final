import {
  CLIENT_INVOICE_SCHEMA_LIMITS,
  ClientInvoice,
  ClientInvoiceEffectiveStatus,
  ClientInvoiceInput,
} from '../types/clientInvoice';
import { PaymentTermsMode, POLineItem } from '../types/po';
import {
  calculateDueDate,
  getRemainingDays,
  getTodayISODate,
  normalizeToIsoDate,
  sanitizePaymentTermsDays,
  sanitizeRevisionEntries,
} from './format';

export function isFFIClientOrBrand(brandName?: string, clientName?: string): boolean {
  const brand = (brandName ?? '').trim().toLowerCase();
  const client = (clientName ?? '').trim().toLowerCase();
  return (
    brand === 'ffi' ||
    /\bffi\b/i.test(brand) ||
    brand.includes('frisian flag') ||
    client.includes('frisian flag') ||
    /\bffi\b/i.test(client)
  );
}

export function generateNextClientInvoiceNumber(existingInvoices: ClientInvoice[]): string {
  let maxSeq = 0;

  for (const inv of existingInvoices) {
    const match = inv.invoiceNumber.trim().match(/^INV-CLI-(\d{1,5})$/i);
    if (match) {
      const seq = Number.parseInt(match[1], 10);
      if (Number.isFinite(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `INV-CLI-${nextSeq}`;
}

export function getClientInvoiceEffectiveStatus(
  invoice: Pick<ClientInvoice, 'status' | 'statusWarna' | 'dueDate' | 'isVoided'>
): ClientInvoiceEffectiveStatus {
  if (invoice.isVoided) return 'Void';
  if (invoice.status === 'Paid' || invoice.statusWarna === 'HIJAU') return 'Paid';
  if (invoice.status === 'Reschedule' || invoice.statusWarna === 'MERAH') return 'Reschedule';
  if (invoice.status === 'Draft') return 'Draft';
  const rem = invoice.dueDate ? getRemainingDays(invoice.dueDate) : null;
  if (rem !== null && rem < 0) return 'Overdue';
  return 'Unpaid';
}

export function isClientInvoiceOverdue(
  invoice: Pick<ClientInvoice, 'status' | 'dueDate'>
): boolean {
  return getClientInvoiceEffectiveStatus(invoice) === 'Overdue';
}

export interface FlexibleInvoiceLineItem {
  description?: string;
  quantity?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  price?: unknown;
  amount?: unknown;
  total?: unknown;
}

export function toPositiveAmount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }
  if (typeof value === 'string') {
    const cleaned = value.trim();
    if (!cleaned) return 0;
    const direct = Number(cleaned);
    if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
    const digits = cleaned.replace(/[^0-9-]/g, '');
    if (digits) {
      const parsed = Number(digits);
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
  }
  return 0;
}

export function computeClientInvoiceItemAmount(item: FlexibleInvoiceLineItem): number {
  const explicitTotal = toPositiveAmount(item.total) || toPositiveAmount(item.amount);
  if (explicitTotal > 0) return explicitTotal;
  const qty = Number(item.qty ?? item.quantity);
  const price = Number(item.price ?? item.unitPrice);
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0) {
    return Math.round(qty * price);
  }
  return 0;
}

export function computeClientInvoiceItemsSubtotal(
  items: readonly FlexibleInvoiceLineItem[] | undefined | null
): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const explicitSum = items.reduce(
    (sum, item) => sum + (toPositiveAmount(item.total) || toPositiveAmount(item.amount)),
    0
  );
  if (explicitSum > 0) return explicitSum;

  return items.reduce((sum, item) => {
    const qty = Number(item.qty ?? item.quantity);
    const price = Number(item.price ?? item.unitPrice);
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0) {
      return sum + Math.round(qty * price);
    }
    return sum;
  }, 0);
}

export interface ClientInvoiceBreakdown {
  dpp: number;
  includePPN: boolean;
  ppnPercent: number;
  ppnAmount: number;
  grossAmount: number;
  includePPh: boolean;
  pphAmount: number;
  netAfterPph: number;
  includeCitibank: boolean;
  citibankFeeAmount: number;
  netReceivable: number;
}

export function sanitizePpnPercent(raw: unknown, includePPN: boolean): number {
  if (!includePPN) return 0;
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 0 && num <= 100) {
    return Math.round(num);
  }
  return 11;
}

export function calculateClientInvoiceBreakdown(params: {
  dpp: number;
  includePPN?: boolean;
  ppnPercent?: number;
  includePPh?: boolean;
  includeCitibank?: boolean;
}): ClientInvoiceBreakdown {
  const dpp = Math.max(0, Math.round(Number.isFinite(params.dpp) ? params.dpp : 0));
  const includePPN = Boolean(params.includePPN);
  const ppnPercent = sanitizePpnPercent(params.ppnPercent, includePPN);
  const ppnAmount = includePPN ? Math.round((dpp * ppnPercent) / 100) : 0;
  const grossAmount = dpp + ppnAmount;

  const includePPh = Boolean(params.includePPh);
  const pphAmount = includePPh ? Math.round((dpp * 2) / 100) : 0;
  const netAfterPph = grossAmount - pphAmount;

  const includeCitibank = Boolean(params.includeCitibank);
  const citibankFeeAmount = includeCitibank ? Math.round((netAfterPph * 2) / 100) : 0;
  const netReceivable = grossAmount - pphAmount - citibankFeeAmount;

  return {
    dpp,
    includePPN,
    ppnPercent,
    ppnAmount,
    grossAmount,
    includePPh,
    pphAmount,
    netAfterPph,
    includeCitibank,
    citibankFeeAmount,
    netReceivable,
  };
}

export interface ClientInvoiceCalculationSource {
  total?: unknown;
  grand_total?: unknown;
  amount?: unknown;
  total_amount?: unknown;
  totalAmount?: unknown;
  subtotalAmount?: unknown;
  subtotal_amount?: unknown;
  ppnAmount?: unknown;
  ppn_amount?: unknown;
  ppnPercent?: unknown;
  ppn_percent?: unknown;
  includePPN?: unknown;
  include_ppn?: unknown;
  grossAmount?: unknown;
  gross_amount?: unknown;
  includePPh?: unknown;
  include_pph?: unknown;
  pphAmount?: unknown;
  pph_amount?: unknown;
  netAfterPph?: unknown;
  net_after_pph?: unknown;
  includeCitibank?: unknown;
  include_citibank?: unknown;
  citibankFeeAmount?: unknown;
  citibank_fee_amount?: unknown;
  netReceivable?: unknown;
  net_receivable?: unknown;
  items?: readonly FlexibleInvoiceLineItem[] | null;
}

function readOptionalBoolFlag(a: unknown, b: unknown): boolean {
  const v = a !== undefined ? a : b;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  return false;
}

export function resolveClientInvoiceBreakdown(
  inv: ClientInvoiceCalculationSource
): ClientInvoiceBreakdown {
  const items = Array.isArray(inv.items) ? inv.items : [];
  const itemTotalsSum = items.reduce(
    (sum, item) => sum + (toPositiveAmount(item.total) || toPositiveAmount(item.amount)),
    0
  );
  const itemQtyPriceSum = items.reduce((sum, item) => {
    const qty = Number(item.qty ?? item.quantity);
    const price = Number(item.price ?? item.unitPrice);
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0) {
      return sum + Math.round(qty * Math.round(price));
    }
    return sum;
  }, 0);

  const includePPN = readOptionalBoolFlag(inv.includePPN, inv.include_ppn);
  const rawPpnPct = inv.ppnPercent ?? inv.ppn_percent;
  const ppnPercent = sanitizePpnPercent(rawPpnPct, includePPN);
  const includePPh =
    readOptionalBoolFlag(inv.includePPh, inv.include_pph) ||
    toPositiveAmount(inv.pphAmount ?? inv.pph_amount) > 0;
  const includeCitibank =
    readOptionalBoolFlag(inv.includeCitibank, inv.include_citibank) ||
    toPositiveAmount(inv.citibankFeeAmount ?? inv.citibank_fee_amount) > 0;

  const explicitSubtotal =
    toPositiveAmount(inv.subtotalAmount) || toPositiveAmount(inv.subtotal_amount);
  const explicitGross =
    toPositiveAmount(inv.grossAmount) || toPositiveAmount(inv.gross_amount);
  const directNominal =
    toPositiveAmount(inv.netReceivable) ||
    toPositiveAmount(inv.net_receivable) ||
    toPositiveAmount(inv.amount) ||
    toPositiveAmount(inv.total) ||
    toPositiveAmount(inv.grand_total) ||
    toPositiveAmount(inv.total_amount) ||
    toPositiveAmount(inv.totalAmount);

  const dpp =
    itemTotalsSum ||
    itemQtyPriceSum ||
    explicitSubtotal ||
    (explicitGross > 0
      ? includePPN
        ? Math.round(explicitGross / (1 + ppnPercent / 100))
        : explicitGross
      : directNominal > 0
      ? includePPN
        ? Math.round(directNominal / (1 + ppnPercent / 100))
        : directNominal
      : 0);

  if (dpp > 0) {
    return calculateClientInvoiceBreakdown({
      dpp,
      includePPN,
      ppnPercent,
      includePPh,
      includeCitibank,
    });
  }

  return calculateClientInvoiceBreakdown({
    dpp: 0,
    includePPN: false,
    ppnPercent: 0,
    includePPh: false,
    includeCitibank: false,
  });
}

export function resolveClientInvoiceGrossNominal(
  inv: ClientInvoiceCalculationSource
): number {
  const breakdown = resolveClientInvoiceBreakdown(inv);
  if (breakdown.grossAmount > 0) {
    return breakdown.grossAmount;
  }
  return (
    toPositiveAmount(inv.grossAmount) ||
    toPositiveAmount(inv.gross_amount) ||
    toPositiveAmount(inv.amount) ||
    toPositiveAmount(inv.total) ||
    toPositiveAmount(inv.grand_total) ||
    toPositiveAmount(inv.total_amount) ||
    toPositiveAmount(inv.totalAmount)
  );
}

/**
 * Mengembalikan Net Akhir / Net Receivable (Gross - PPh 23 - Biaya Citibank) sebagai integer Rupiah.
 * Jika PPh & Citibank nonaktif, Net Akhir sama dengan Gross.
 */
export function resolveClientInvoiceNominal(
  inv: ClientInvoiceCalculationSource
): number {
  const breakdown = resolveClientInvoiceBreakdown(inv);
  if (breakdown.dpp > 0) {
    return breakdown.netReceivable;
  }
  return (
    toPositiveAmount(inv.netReceivable) ||
    toPositiveAmount(inv.net_receivable) ||
    toPositiveAmount(inv.amount) ||
    toPositiveAmount(inv.total) ||
    toPositiveAmount(inv.grand_total) ||
    toPositiveAmount(inv.total_amount) ||
    toPositiveAmount(inv.totalAmount)
  );
}

export function sanitizeClientInvoiceInput(
  input: ClientInvoiceInput
): ClientInvoiceInput {
  const cleanedItems: POLineItem[] = (input.items ?? [])
    .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.maxItems)
    .map((item) => {
      const rawItem = item as FlexibleInvoiceLineItem;
      const rawQty = Number(rawItem.quantity ?? rawItem.qty);
      const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      const rawUnitPrice = Number(rawItem.unitPrice ?? rawItem.price);
      const explicitItemTotal =
        toPositiveAmount(rawItem.total) || toPositiveAmount(rawItem.amount);
      const unitPrice =
        Number.isFinite(rawUnitPrice) && rawUnitPrice > 0
          ? Math.round(rawUnitPrice)
          : explicitItemTotal > 0
          ? Math.round(explicitItemTotal / qty)
          : Number.isFinite(rawUnitPrice) && rawUnitPrice >= 0
          ? Math.round(rawUnitPrice)
          : 0;
      const amount = Math.round(qty * unitPrice) || explicitItemTotal;
      return {
        description: String(rawItem.description ?? '')
          .trim()
          .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.descriptionMax),
        quantity: qty,
        unitPrice,
        amount,
      };
    });

  const computedSub = cleanedItems.reduce((sum, item) => sum + item.amount, 0);
  const includePPN = Boolean(input.includePPN);
  const ppnPercent = sanitizePpnPercent(
    input.ppnPercent ?? input.ppn_percent,
    includePPN
  );
  const includePPh = Boolean(input.includePPh ?? input.include_pph);
  const includeCitibank = Boolean(input.includeCitibank ?? input.include_citibank);
  const explicitSub = toPositiveAmount(input.subtotalAmount ?? input.subtotal_amount);
  const fallbackNominal = resolveClientInvoiceNominal(input);
  const dpp =
    computedSub > 0
      ? computedSub
      : explicitSub ||
        (fallbackNominal > 0 && includePPN
          ? Math.round(fallbackNominal / (1 + ppnPercent / 100))
          : fallbackNominal);

  const breakdown = calculateClientInvoiceBreakdown({
    dpp,
    includePPN,
    ppnPercent,
    includePPh,
    includeCitibank,
  });

  const subtotalAmount = breakdown.dpp;
  const ppnAmount = breakdown.ppnAmount;
  const grossAmount = breakdown.grossAmount;
  const pphAmount = breakdown.pphAmount;
  const netAfterPph = breakdown.netAfterPph;
  const citibankFeeAmount = breakdown.citibankFeeAmount;
  const netReceivable = breakdown.netReceivable;
  const totalAmount = netReceivable;

  const rawStatusLower = String(input.status ?? '').trim().toLowerCase();
  const rawWarnaUpper = String(input.statusWarna ?? '').trim().toUpperCase();
  const cleanStatus: ClientInvoiceInput['status'] =
    rawStatusLower === 'paid' || rawWarnaUpper === 'HIJAU'
      ? 'Paid'
      : rawStatusLower === 'reschedule' ||
        rawStatusLower === 'rescheduling' ||
        rawWarnaUpper === 'MERAH'
      ? 'Reschedule'
      : rawStatusLower === 'draft'
      ? 'Draft'
      : 'Unpaid';
  const cleanStatusWarna =
    cleanStatus === 'Paid' ? 'HIJAU' : cleanStatus === 'Reschedule' ? 'MERAH' : 'PUTIH';
  const cleanRescheduledFromMonth =
    typeof input.rescheduledFromMonth === 'string' &&
    /^\d{4}-\d{2}$/.test(input.rescheduledFromMonth.trim())
      ? input.rescheduledFromMonth.trim()
      : undefined;
  const cleanRescheduledToMonth =
    cleanStatus === 'Reschedule' &&
    typeof input.rescheduledToMonth === 'string' &&
    /^\d{4}-\d{2}$/.test(input.rescheduledToMonth.trim())
      ? input.rescheduledToMonth.trim()
      : undefined;

  const cleanInvoiceDate =
    normalizeToIsoDate(input.invoiceDate) ?? input.invoiceDate.trim().slice(0, 10);
  const rawSentDate = (input.sentDate ?? '').trim();
  const normalizedSentDate = normalizeToIsoDate(rawSentDate) ?? '';
  const rawDueDate = (input.dueDate ?? '').trim();
  const normalizedDueDate = normalizeToIsoDate(rawDueDate) ?? '';

  let sentDate = normalizedSentDate;
  let mode: PaymentTermsMode | undefined;
  let cleanTermsDays: number | undefined;
  let cleanDueDate = '';
  let cleanManualNote = '';

  if (cleanStatus !== 'Draft') {
    sentDate = normalizedSentDate || getTodayISODate();
    if (input.paymentTermsMode === 'MANUAL') {
      mode = 'MANUAL';
      cleanDueDate = normalizedDueDate;
      cleanManualNote = (input.manualDueDateNote ?? '')
        .trim()
        .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.manualDueDateNoteMax);
    } else if (input.paymentTermsMode === 'NET') {
      mode = 'NET';
      cleanTermsDays = sanitizePaymentTermsDays(input.paymentTermsDays);
      if (normalizedDueDate) {
        cleanDueDate = normalizedDueDate;
      } else {
        const baseDate = sentDate || cleanInvoiceDate;
        cleanDueDate = baseDate ? calculateDueDate(baseDate, cleanTermsDays) : '';
      }
    } else if (normalizedDueDate) {
      mode = 'MANUAL';
      cleanDueDate = normalizedDueDate;
    }
  }

  const cleanPaidDate =
    cleanStatus === 'Paid' ? (input.paidDate ?? '').trim().slice(0, 10) : '';

  const cleanBrand = (input.brandName ?? '')
    .trim()
    .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.brandNameMax);
  const cleanClient = input.clientName
    .trim()
    .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.clientNameMax);

  const showGRN =
    typeof input.showGRN === 'boolean'
      ? input.showGRN
      : isFFIClientOrBrand(cleanBrand, cleanClient);

  const showSystemGeneratedNote =
    typeof input.showSystemGeneratedNote === 'boolean'
      ? input.showSystemGeneratedNote
      : true;

  const rawRealisasi =
    input.realisasiAmount !== undefined
      ? input.realisasiAmount
      : input.actualAmount !== undefined
      ? input.actualAmount
      : undefined;
  const cleanRealisasi =
    cleanStatus === 'Paid' &&
    typeof rawRealisasi === 'number' &&
    Number.isFinite(rawRealisasi) &&
    rawRealisasi >= 0
      ? Math.round(rawRealisasi)
      : undefined;

  return {
    invoiceNumber: input.invoiceNumber
      .trim()
      .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.invoiceNumberMax),
    invoiceDate: cleanInvoiceDate,
    clientName: cleanClient,
    brandName: cleanBrand,
    billingAddress: (input.billingAddress ?? '')
      .trim()
      .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.billingAddressMax),
    poNumber: (input.poNumber ?? '')
      .trim()
      .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.poNumberMax),
    grnNumber: (input.grnNumber ?? '')
      .trim()
      .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.grnNumberMax),
    showGRN,
    includePPN,
    ppnPercent: breakdown.ppnPercent,
    subtotalAmount,
    ppnAmount,
    grossAmount,
    includePPh,
    pphAmount,
    netAfterPph,
    includeCitibank,
    citibankFeeAmount,
    netReceivable,
    showSystemGeneratedNote,
    projectName: input.projectName
      .trim()
      .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.projectNameMax),
    projectNumber: input.projectNumber
      .trim()
      .slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.projectNumberMax),
    items: cleanedItems,
    totalAmount,
    total: totalAmount,
    grand_total: totalAmount,
    amount: totalAmount,
    total_amount: totalAmount,
    ...(cleanRealisasi !== undefined
      ? { realisasiAmount: cleanRealisasi, actualAmount: cleanRealisasi }
      : {}),
    sentDate,
    paymentTermsMode: mode,
    paymentTermsDays: cleanTermsDays,
    manualDueDateNote: cleanManualNote,
    dueDate: cleanDueDate,
    status: cleanStatus,
    statusWarna: cleanStatusWarna,
    ...(cleanRescheduledFromMonth ? { rescheduledFromMonth: cleanRescheduledFromMonth } : {}),
    ...(cleanRescheduledToMonth ? { rescheduledToMonth: cleanRescheduledToMonth } : {}),
    paidDate: cleanPaidDate,
    note: (input.note ?? '').trim().slice(0, CLIENT_INVOICE_SCHEMA_LIMITS.noteMax),
    isVoided: input.isVoided,
    voidStatusLabel: input.voidStatusLabel,
    replacedByInvoiceId: input.replacedByInvoiceId,
    replacedByInvoiceNumber: input.replacedByInvoiceNumber,
    revisionSubStatus: input.revisionSubStatus,
    previousPaidAmount:
      typeof input.previousPaidAmount === 'number' && Number.isFinite(input.previousPaidAmount)
        ? Math.round(input.previousPaidAmount)
        : input.previousPaidAmount,
    revisions: sanitizeRevisionEntries(input.revisions),
    isDeleted: Boolean(input.isDeleted),
    deletedAt: input.deletedAt ? String(input.deletedAt).trim() : '',
    deletedByName: (input.deletedByName ?? '').trim().slice(0, 160),
    deletedByEmail: (input.deletedByEmail ?? '').trim().slice(0, 180),
    deleteReason: (input.deleteReason ?? '').trim().slice(0, 300),
  };
}

export function validateClientInvoiceInput(input: ClientInvoiceInput): string | null {
  if (!input.invoiceNumber.trim()) return 'No. Invoice Client wajib diisi.';
  if (input.invoiceNumber.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.invoiceNumberMax) {
    return `No. Invoice Client maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.invoiceNumberMax} karakter.`;
  }
  if (!CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(input.invoiceDate)) {
    return 'Tanggal Invoice wajib diisi.';
  }
  if (!input.clientName.trim()) return 'Nama Client / Billed to wajib diisi.';
  if (input.clientName.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.clientNameMax) {
    return `Nama Client maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.clientNameMax} karakter.`;
  }
  if (input.brandName && input.brandName.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.brandNameMax) {
    return `Brand Name maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.brandNameMax} karakter.`;
  }
  if (
    input.billingAddress &&
    input.billingAddress.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.billingAddressMax
  ) {
    return `Billing Address maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.billingAddressMax} karakter.`;
  }
  if (input.poNumber && input.poNumber.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.poNumberMax) {
    return `PO Number maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.poNumberMax} karakter.`;
  }
  if (input.grnNumber && input.grnNumber.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.grnNumberMax) {
    return `GRN maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.grnNumberMax} karakter.`;
  }
  if (!input.projectName.trim()) return 'Project Name wajib diisi.';
  if (input.projectName.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.projectNameMax) {
    return `Project Name maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.projectNameMax} karakter.`;
  }
  if (!input.projectNumber.trim()) return 'Project Number wajib diisi.';
  if (input.projectNumber.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.projectNumberMax) {
    return `Project Number maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.projectNumberMax} karakter.`;
  }
  if (
    input.sentDate &&
    !CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(input.sentDate)
  ) {
    return 'Tanggal Kirim Invoice tidak valid.';
  }
  if (
    input.dueDate &&
    !CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(input.dueDate)
  ) {
    return 'Tanggal Jatuh Tempo tidak valid.';
  }
  if (
    input.status === 'Paid' &&
    (!input.paidDate || !CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(input.paidDate))
  ) {
    return 'Tanggal Dibayar wajib diisi jika status sudah PAID.';
  }
  if (input.note && input.note.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.noteMax) {
    return `Note maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.noteMax} karakter.`;
  }
  if (!input.items.length || input.items.length > CLIENT_INVOICE_SCHEMA_LIMITS.maxItems) {
    return `Daftar item harus berisi 1 sampai ${CLIENT_INVOICE_SCHEMA_LIMITS.maxItems} baris.`;
  }
  for (let i = 0; i < input.items.length; i += 1) {
    const item = input.items[i];
    if (!item.description.trim()) {
      return `Deskripsi item pada baris ${i + 1} wajib diisi.`;
    }
    if (item.description.trim().length > CLIENT_INVOICE_SCHEMA_LIMITS.descriptionMax) {
      return `Deskripsi item baris ${i + 1} maksimal ${CLIENT_INVOICE_SCHEMA_LIMITS.descriptionMax} karakter.`;
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return `Qty pada baris ${i + 1} harus lebih besar dari 0.`;
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return `Harga pada baris ${i + 1} tidak boleh negatif.`;
    }
  }
  return null;
}
