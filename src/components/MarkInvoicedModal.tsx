import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Calculator, Link2, Paperclip, Receipt, Upload, X } from 'lucide-react';
import {
  PAYMENT_TERM_OPTIONS,
  PAYMENT_TERM_RULES,
  PaymentTermDays,
  PaymentTermsMode,
  PO_SCHEMA_LIMITS,
  PurchaseOrder,
  VendorPphStatus,
  VendorPphType,
} from '../types/po';
import {
  calculateDueDate,
  calculateVendorInvoiceTaxBreakdown,
  formatDocumentDate,
  formatIDR,
  formatTaxRateForInput,
  generateDefaultInvoiceNumber,
  getSuggestedPaymentTermsDays,
  getTodayISODate,
  parseTaxRateInput,
  sanitizeVendorPphStatus,
  sanitizeVendorPphType,
} from '../utils/format';
import { RupiahInput } from './RupiahInput';

export interface InvoiceSubmissionPayload {
  invoiceDate: string;
  invoiceNumber: string;
  paymentTermsMode: PaymentTermsMode;
  paymentTermsDays?: number;
  manualDueDateNote: string;
  dueDate: string;
  invoiceFileUrl: string;
  invoiceFileName: string;
  localAttachmentDataUrl?: string;
  dppAmount: number;
  ppnRate: number;
  ppnAmount: number;
  grossAmount: number;
  pphType: VendorPphType;
  pphRate: number;
  pphAmount: number;
  pphStatus?: VendorPphStatus;
  pphDate?: string;
  netAkhir: number;
}

type PaymentTermSelection = PaymentTermDays | 'MANUAL';
type PpnPresetOption = 'NONE' | '11' | '12' | 'CUSTOM';

interface MarkInvoicedModalProps {
  po: PurchaseOrder;
  existingPOs: PurchaseOrder[];
  mode?: 'mark-invoiced' | 'edit-invoice';
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (payload: InvoiceSubmissionPayload) => Promise<void>;
}

const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 MB batas ukuran file

function sanitizeDecimalRateTyping(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,]/g, '');
  let hasSep = false;
  let result = '';
  for (const ch of cleaned) {
    if (ch === ',' || ch === '.') {
      if (!hasSep) {
        hasSep = true;
        result += ch;
      }
    } else {
      result += ch;
    }
  }
  return result;
}

function resolveInitialPpnPreset(rate: number): PpnPresetOption {
  if (rate <= 0) return 'NONE';
  if (rate === 11) return '11';
  if (rate === 12) return '12';
  return 'CUSTOM';
}

export const MarkInvoicedModal: React.FC<MarkInvoicedModalProps> = ({
  po,
  existingPOs,
  mode = 'mark-invoiced',
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const suggestedTermsDays = useMemo(
    () => getSuggestedPaymentTermsDays(po.totalAmount),
    [po.totalAmount]
  );

  const initialSelection: PaymentTermSelection =
    po.paymentTermsMode === 'MANUAL'
      ? 'MANUAL'
      : mode === 'edit-invoice' &&
        typeof po.paymentTermsDays === 'number' &&
        PAYMENT_TERM_OPTIONS.includes(po.paymentTermsDays as PaymentTermDays)
      ? (po.paymentTermsDays as PaymentTermDays)
      : suggestedTermsDays;

  const initialDppValue =
    mode === 'edit-invoice' && typeof po.dppAmount === 'number' && po.dppAmount > 0
      ? Math.round(po.dppAmount)
      : Math.round(Number(po.totalAmount) || 0);

  const initialPpnRateNum =
    typeof po.ppnRate === 'number' && Number.isFinite(po.ppnRate) && po.ppnRate >= 0
      ? po.ppnRate
      : 0;
  const initialPpnPreset = resolveInitialPpnPreset(initialPpnRateNum);

  const initialPphType = sanitizeVendorPphType(po.pphType);
  const initialPphRateNum =
    initialPphType === 'NONE'
      ? 0
      : typeof po.pphRate === 'number' && Number.isFinite(po.pphRate) && po.pphRate >= 0
      ? po.pphRate
      : initialPphType === 'PPH21'
      ? 2.5
      : 2;

  const [invoiceNumber, setInvoiceNumber] = useState<string>(
    po.invoiceNumber || generateDefaultInvoiceNumber(po.poNumber, existingPOs)
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(
    po.invoiceDate || getTodayISODate()
  );
  const [selectedTerm, setSelectedTerm] = useState<PaymentTermSelection>(initialSelection);
  const [manualDueDate, setManualDueDate] = useState<string>(
    po.paymentTermsMode === 'MANUAL' ? po.dueDate ?? '' : ''
  );
  const [manualDueDateNote, setManualDueDateNote] = useState<string>(
    po.paymentTermsMode === 'MANUAL' ? po.manualDueDateNote ?? '' : ''
  );
  const [dppInput, setDppInput] = useState<string>(String(initialDppValue));
  const [ppnPreset, setPpnPreset] = useState<PpnPresetOption>(initialPpnPreset);
  const [ppnRateInput, setPpnRateInput] = useState<string>(
    formatTaxRateForInput(initialPpnRateNum)
  );
  const [pphType, setPphType] = useState<VendorPphType>(initialPphType);
  const [pphRateInput, setPphRateInput] = useState<string>(
    formatTaxRateForInput(initialPphRateNum)
  );
  const [pphStatus, setPphStatus] = useState<VendorPphStatus>(() =>
    po.pphStatus ? sanitizeVendorPphStatus(po.pphStatus) : 'Sudah Disubmit'
  );
  const [pphDate, setPphDate] = useState<string>(
    po.pphDate || po.invoiceDate || getTodayISODate()
  );
  const [invoiceFileUrl, setInvoiceFileUrl] = useState<string>(po.invoiceFileUrl ?? '');
  const [invoiceFileName, setInvoiceFileName] = useState<string>(po.invoiceFileName || '');
  const [localAttachmentDataUrl, setLocalAttachmentDataUrl] = useState<string | undefined>(
    undefined
  );
  const [error, setError] = useState<string | null>(null);

  const isManualSelected = selectedTerm === 'MANUAL';
  const isManualDueDateMissing =
    isManualSelected && (!manualDueDate || !PO_SCHEMA_LIMITS.datePattern.test(manualDueDate));
  const isOutOfSuggestedRange = !isManualSelected && selectedTerm !== suggestedTermsDays;

  const computedDueDate = useMemo(
    () => (isManualSelected ? '' : calculateDueDate(invoiceDate, selectedTerm)),
    [invoiceDate, isManualSelected, selectedTerm]
  );

  const parsedDpp = Math.max(0, Math.round(Number(dppInput) || 0));
  const parsedPpnRate = ppnPreset === 'NONE' ? 0 : parseTaxRateInput(ppnRateInput);
  const parsedPphRate = pphType === 'NONE' ? 0 : parseTaxRateInput(pphRateInput);

  const taxBreakdown = useMemo(
    () =>
      calculateVendorInvoiceTaxBreakdown({
        dpp: parsedDpp,
        ppnRate: parsedPpnRate,
        pphType,
        pphRate: parsedPphRate,
      }),
    [parsedDpp, parsedPpnRate, pphType, parsedPphRate]
  );

  const handleTermChange = (rawValue: string) => {
    if (rawValue === 'MANUAL') {
      setSelectedTerm('MANUAL');
      return;
    }
    setSelectedTerm(Number(rawValue) as PaymentTermDays);
  };

  const handlePpnPresetChange = (nextPreset: PpnPresetOption) => {
    setPpnPreset(nextPreset);
    if (nextPreset === 'NONE') {
      setPpnRateInput('0');
    } else if (nextPreset === '11') {
      setPpnRateInput('11');
    } else if (nextPreset === '12') {
      setPpnRateInput('12');
    } else if (ppnRateInput === '0' || ppnRateInput === '') {
      setPpnRateInput('0');
    }
  };

  const handlePpnRateInputChange = (raw: string) => {
    const sanitized = sanitizeDecimalRateTyping(raw);
    setPpnRateInput(sanitized);
    const parsed = parseTaxRateInput(sanitized);
    if (parsed !== 11 && parsed !== 12 && ppnPreset !== 'CUSTOM') {
      setPpnPreset('CUSTOM');
    }
  };

  const handlePphTypeChange = (nextType: VendorPphType) => {
    setPphType(nextType);
    if (nextType === 'NONE') {
      setPphRateInput('0');
    } else if (nextType === 'PPH21') {
      setPphRateInput('2,5');
    } else if (nextType === 'PPH23') {
      setPphRateInput('2');
    }
  };

  const handlePphRateInputChange = (raw: string) => {
    if (pphType === 'NONE') return;
    setPphRateInput(sanitizeDecimalRateTyping(raw));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Ukuran file invoice maksimal 1.5 MB. Gunakan link URL jika file lebih besar.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setError(null);
        setLocalAttachmentDataUrl(reader.result);
        setInvoiceFileName(file.name.slice(0, PO_SCHEMA_LIMITS.invoiceFileNameMax));
      }
    };
    reader.onerror = () => {
      setError('Gagal membaca file invoice yang dipilih.');
    };
    reader.readAsDataURL(file);
  };

  const handleClearFile = () => {
    setLocalAttachmentDataUrl(undefined);
    setInvoiceFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber.trim()) {
      setError('No. Invoice Vendor wajib diisi.');
      return;
    }
    if (!PO_SCHEMA_LIMITS.datePattern.test(invoiceDate)) {
      setError('Tanggal Invoice wajib diisi.');
      return;
    }
    if (isManualDueDateMissing) {
      setError('Jatuh Tempo Manual wajib diisi kalau pilih MANUAL');
      return;
    }
    const cleanManualNote = manualDueDateNote.trim();
    if (
      isManualSelected &&
      cleanManualNote.length > PO_SCHEMA_LIMITS.manualDueDateNoteMax
    ) {
      setError(`Keterangan Manual maksimal ${PO_SCHEMA_LIMITS.manualDueDateNoteMax} karakter.`);
      return;
    }
    const cleanUrl = invoiceFileUrl.trim();
    if (cleanUrl.length > PO_SCHEMA_LIMITS.invoiceFileUrlMax) {
      setError(`Link File Invoice maksimal ${PO_SCHEMA_LIMITS.invoiceFileUrlMax} karakter.`);
      return;
    }

    setError(null);
    const hasActivePph = taxBreakdown.pphType !== 'NONE' && taxBreakdown.pphAmount > 0;
    const taxPayload = {
      dppAmount: taxBreakdown.dppAmount,
      ppnRate: taxBreakdown.ppnRate,
      ppnAmount: taxBreakdown.ppnAmount,
      grossAmount: taxBreakdown.grossAmount,
      pphType: taxBreakdown.pphType,
      pphRate: taxBreakdown.pphRate,
      pphAmount: taxBreakdown.pphAmount,
      pphStatus: hasActivePph ? pphStatus : undefined,
      pphDate: hasActivePph && pphStatus === 'Sudah Disubmit' ? pphDate || invoiceDate : undefined,
      netAkhir: taxBreakdown.netAkhir,
    };

    try {
      if (isManualSelected) {
        await onConfirm({
          invoiceDate,
          invoiceNumber: invoiceNumber.trim(),
          paymentTermsMode: 'MANUAL',
          paymentTermsDays: undefined,
          manualDueDateNote: cleanManualNote,
          dueDate: manualDueDate,
          invoiceFileUrl: cleanUrl,
          invoiceFileName: invoiceFileName.trim(),
          localAttachmentDataUrl,
          ...taxPayload,
        });
        return;
      }

      await onConfirm({
        invoiceDate,
        invoiceNumber: invoiceNumber.trim(),
        paymentTermsMode: 'NET',
        paymentTermsDays: selectedTerm,
        manualDueDateNote: '',
        dueDate: calculateDueDate(invoiceDate, selectedTerm),
        invoiceFileUrl: cleanUrl,
        invoiceFileName: invoiceFileName.trim(),
        localAttachmentDataUrl,
        ...taxPayload,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pphLabel =
    pphType === 'PPH21' ? 'PPh 21' : pphType === 'PPH23' ? 'PPh 23' : 'PPh';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-lg max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <Receipt className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {mode === 'edit-invoice'
                ? 'Ubah Info Invoice Vendor'
                : 'Input Invoice Vendor'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {po.poNumber} · {po.vendorName} · {po.projectName}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="modal-invoice-number"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                No. Invoice Vendor
              </label>
              <input
                id="modal-invoice-number"
                type="text"
                required
                maxLength={PO_SCHEMA_LIMITS.invoiceNumberMax}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="INV-001/KKB/2026"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="modal-invoice-date"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Tanggal Invoice
              </label>
              <input
                id="modal-invoice-date"
                type="date"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="modal-payment-terms"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Payment Terms
            </label>
            <select
              id="modal-payment-terms"
              value={String(selectedTerm)}
              onChange={(e) => handleTermChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {PAYMENT_TERM_OPTIONS.map((days) => (
                <option key={days} value={String(days)}>
                  {PAYMENT_TERM_RULES[days].optionLabel}
                </option>
              ))}
              <option value="MANUAL">MANUAL (Custom)</option>
            </select>

            {!isManualSelected && (
              <>
                <p className="text-[11px] text-slate-600 mt-1.5 tabular-nums">
                  Total Invoice Rp {formatIDR(po.totalAmount)}, masuk range NET {suggestedTermsDays}
                </p>
                {isOutOfSuggestedRange && (
                  <div
                    role="status"
                    className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-800 flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
                    <span>Total Invoice ini di luar range NET ini. Yakin lanjut?</span>
                  </div>
                )}
              </>
            )}
          </div>

          {isManualSelected && (
            <div className="space-y-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <label
                  htmlFor="modal-manual-due-date"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Jatuh Tempo (Manual) <span className="text-red-600">*</span>
                </label>
                <input
                  id="modal-manual-due-date"
                  type="date"
                  required
                  value={manualDueDate}
                  onChange={(e) => setManualDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Isi tanggal jatuh tempo sesuai kesepakatan / invoice vendor
                </p>
              </div>

              <div>
                <label
                  htmlFor="modal-manual-due-note"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Keterangan Manual (Opsional)
                </label>
                <input
                  id="modal-manual-due-note"
                  type="text"
                  maxLength={PO_SCHEMA_LIMITS.manualDueDateNoteMax}
                  value={manualDueDateNote}
                  onChange={(e) => setManualDueDateNote(e.target.value)}
                  placeholder="Contoh: Bayar tiap tanggal 25 / Termin nego khusus"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              {isManualDueDateMissing && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>Jatuh Tempo Manual wajib diisi kalau pilih MANUAL</span>
                </div>
              )}
            </div>
          )}

          {!isManualSelected && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600 font-medium">Jatuh Tempo (Otomatis):</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {computedDueDate ? formatDocumentDate(computedDueDate) : '-'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Dihitung otomatis dari Tanggal Invoice + {selectedTerm} hari (NET {selectedTerm}).
              </p>
            </div>
          )}

          {/* SECTION: Perhitungan Pajak (PPN & PPh) */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-slate-700" />
                <span className="text-xs font-semibold text-slate-900">
                  Perhitungan Pajak
                </span>
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums">
                Nilai PO: Rp {formatIDR(po.totalAmount)}
              </span>
            </div>

            {/* 1. DPP */}
            <div>
              <label
                htmlFor="modal-tax-dpp"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                DPP (Dasar Pengenaan Pajak)
              </label>
              <div className="relative">
                <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  id="modal-tax-dpp"
                  value={dppInput}
                  onValueChange={(raw) => setDppInput(raw)}
                  placeholder="0"
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            {/* 2. PPN (Penambah) */}
            <div>
              <label
                htmlFor="modal-tax-ppn-select"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                PPN (Penambah ke DPP)
              </label>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-8">
                  <select
                    id="modal-tax-ppn-select"
                    value={ppnPreset}
                    onChange={(e) => handlePpnPresetChange(e.target.value as PpnPresetOption)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="NONE">Tidak Ada PPN</option>
                    <option value="11">PPN 11%</option>
                    <option value="12">PPN 12%</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div className="col-span-4 relative">
                  <input
                    id="modal-tax-ppn-rate"
                    type="text"
                    inputMode="decimal"
                    aria-label="Rate PPN (%)"
                    disabled={ppnPreset === 'NONE'}
                    value={ppnPreset === 'NONE' ? '0' : ppnRateInput}
                    onChange={(e) => handlePpnRateInputChange(e.target.value)}
                    placeholder="0"
                    className="w-full pl-2.5 pr-6 py-2 text-xs font-mono text-right tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                  <span className="text-xs text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    %
                  </span>
                </div>
              </div>
            </div>

            {/* 3. PPh (Pengurang dari Gross, basis DPP) */}
            <div>
              <label
                htmlFor="modal-tax-pph-select"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                PPh (Pengurang dari Gross, basis DPP)
              </label>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-8">
                  <select
                    id="modal-tax-pph-select"
                    value={pphType}
                    onChange={(e) => handlePphTypeChange(e.target.value as VendorPphType)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="NONE">Tidak Ada PPh</option>
                    <option value="PPH21">PPh 21</option>
                    <option value="PPH23">PPh 23</option>
                  </select>
                </div>
                <div className="col-span-4 relative">
                  <input
                    id="modal-tax-pph-rate"
                    type="text"
                    inputMode="decimal"
                    aria-label="Rate PPh (%)"
                    disabled={pphType === 'NONE'}
                    value={pphType === 'NONE' ? '0' : pphRateInput}
                    onChange={(e) => handlePphRateInputChange(e.target.value)}
                    placeholder="0"
                    className="w-full pl-2.5 pr-6 py-2 text-xs font-mono text-right tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                  <span className="text-xs text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    %
                  </span>
                </div>
              </div>

              {pphType !== 'NONE' && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="modal-tax-pph-status"
                      className="block text-[11px] font-medium text-slate-700 mb-1"
                    >
                      Status Submit PPh
                    </label>
                    <select
                      id="modal-tax-pph-status"
                      value={pphStatus}
                      onChange={(e) => setPphStatus(e.target.value as VendorPphStatus)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      <option value="Sudah Disubmit">Sudah Disubmit (Masuk NET)</option>
                      <option value="Belum Disubmit">Belum Disubmit (Masih Gross)</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="modal-tax-pph-date"
                      className="block text-[11px] font-medium text-slate-700 mb-1"
                    >
                      Tanggal Submit PPh
                    </label>
                    <input
                      id="modal-tax-pph-date"
                      type="date"
                      disabled={pphStatus !== 'Sudah Disubmit'}
                      value={pphStatus === 'Sudah Disubmit' ? pphDate : ''}
                      onChange={(e) => setPphDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 5. Breakdown Live */}
            <div className="pt-2.5 border-t border-slate-200 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>DPP</span>
                <span className="font-mono font-medium tabular-nums">
                  Rp {formatIDR(taxBreakdown.dppAmount)}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-700">
                <span>
                  + PPN ({formatTaxRateForInput(taxBreakdown.ppnRate)}%)
                </span>
                <span className="font-mono font-medium tabular-nums">
                  {taxBreakdown.ppnAmount > 0
                    ? `+ Rp ${formatIDR(taxBreakdown.ppnAmount)}`
                    : 'Rp 0'}
                </span>
              </div>

              <div className="flex items-center justify-between font-semibold text-slate-800 pt-1 border-t border-dashed border-slate-200">
                <span>(=) GROSS</span>
                <span className="font-mono tabular-nums">
                  Rp {formatIDR(taxBreakdown.grossAmount)}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-700">
                <span>
                  - {pphLabel} ({formatTaxRateForInput(taxBreakdown.pphRate)}%)
                </span>
                <span
                  className={`font-mono font-medium tabular-nums ${
                    taxBreakdown.pphAmount > 0 ? 'text-rose-700' : 'text-slate-600'
                  }`}
                >
                  {taxBreakdown.pphAmount > 0
                    ? `- Rp ${formatIDR(taxBreakdown.pphAmount)}`
                    : 'Rp 0'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2.5 border-t border-slate-300 bg-white rounded-lg px-3 py-2.5 border border-emerald-200">
                <div>
                  <span className="block text-xs font-bold text-slate-900">
                    = NET
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    DPP + PPN - {pphLabel}
                    {pphType !== 'NONE' && pphStatus === 'Belum Disubmit'
                      ? ' (Total aktif masih Gross sebelum submit PPh)'
                      : ''}
                  </span>
                </div>
                <span className="text-base sm:text-lg font-extrabold font-mono tabular-nums text-emerald-700">
                  Rp {formatIDR(taxBreakdown.netAkhir)}
                </span>
              </div>
            </div>
          </div>

          {/* Optional File Upload or Link */}
          <div className="space-y-2 pt-1">
            <span className="block text-xs font-medium text-slate-700">
              Upload / Link File Invoice (Opsional)
            </span>

            <div className="relative">
              <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="modal-invoice-url"
                type="url"
                maxLength={PO_SCHEMA_LIMITS.invoiceFileUrlMax}
                value={invoiceFileUrl}
                onChange={(e) => setInvoiceFileUrl(e.target.value)}
                placeholder="https://drive.google.com/... (link file invoice)"
                className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={handleFileChange}
                className="hidden"
                id="modal-invoice-file-upload"
              />
              <label
                htmlFor="modal-invoice-file-upload"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload File PDF / Gambar
              </label>

              {invoiceFileName && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 max-w-full">
                  <Paperclip className="w-3 h-3 shrink-0 text-slate-500" />
                  <span className="truncate max-w-[180px]">{invoiceFileName}</span>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    title="Hapus file terlampir"
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isManualDueDateMissing}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting
              ? 'Menyimpan...'
              : mode === 'edit-invoice'
              ? 'Simpan Perubahan'
              : 'Simpan Invoice & Tandai Ditagih'}
          </button>
        </div>
      </form>
    </div>
  );
};
