import React, { useState } from 'react';
import { AlertTriangle, Undo2, X } from 'lucide-react';
import { PurchaseOrder } from '../types/po';
import {
  formatIDR,
  formatShortDateID,
  getVendorPOEffectiveCostAmount,
  resolveVendorPOTaxDetails,
} from '../utils/format';

export type CancelVendorPOTargetStatus = 'Draft' | 'Sent' | 'Invoiced';

interface CancelVendorInvoiceModalProps {
  po: PurchaseOrder;
  mode?: 'tagihan' | 'lunas';
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (payload: {
    targetStatus: CancelVendorPOTargetStatus;
    reason: string;
  }) => Promise<void> | void;
}

function formatPaymentDateDisplay(updatedAt: unknown, fallbackDate?: string): string {
  if (typeof updatedAt === 'string' && updatedAt.trim()) {
    const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(updatedAt.trim());
    if (isoMatch) return formatShortDateID(isoMatch[1]);
    const ms = Date.parse(updatedAt.trim());
    if (Number.isFinite(ms)) {
      const dt = new Date(ms);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return formatShortDateID(`${y}-${m}-${d}`);
    }
  }
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) {
    const dt = new Date(updatedAt);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return formatShortDateID(`${y}-${m}-${d}`);
  }
  if (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
    return formatShortDateID(fallbackDate);
  }
  return '-';
}

export const CancelVendorInvoiceModal: React.FC<CancelVendorInvoiceModalProps> = ({
  po,
  mode = 'tagihan',
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const [targetStatus, setTargetStatus] = useState<CancelVendorPOTargetStatus | ''>('');
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isLunasMode = mode === 'lunas';
  const tax = resolveVendorPOTaxDetails(po);
  const effectiveNominal = getVendorPOEffectiveCostAmount(po);
  const paidDisplayNominal =
    po.realisasiAmount ?? po.actualAmount ?? (effectiveNominal > 0 ? effectiveNominal : po.totalAmount);
  const paidDateDisplay = formatPaymentDateDisplay(po.updatedAt, po.invoiceDate || po.poDate);

  const pphSummaryText = tax.hasPph
    ? tax.isPphSubmitted
      ? ` (PPh Sudah Disubmit - Rp ${formatIDR(tax.pphAmount)})`
      : ` (PPh Belum Disubmit - Rp ${formatIDR(tax.pphAmount)})`
    : '';

  const trimmedReason = reason.trim();
  const canSubmit = targetStatus !== '' && trimmedReason.length >= 5 && !isSubmitting;

  const radioOptions: Array<{ value: CancelVendorPOTargetStatus; label: string }> = isLunasMode
    ? [
        { value: 'Draft', label: 'Kembalikan ke DRAFT' },
        { value: 'Sent', label: 'Kembalikan ke SENT' },
        { value: 'Invoiced', label: 'Kembalikan ke SUDAH DITAGIH' },
      ]
    : [
        { value: 'Draft', label: 'Kembalikan ke DRAFT' },
        { value: 'Sent', label: 'Kembalikan ke SENT' },
      ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetStatus) {
      setErrorMsg(
        isLunasMode
          ? 'Pilih tujuan status PO terlebih dahulu (DRAFT, SENT, atau SUDAH DITAGIH).'
          : 'Pilih tujuan status PO terlebih dahulu (DRAFT atau SENT).'
      );
      return;
    }
    if (trimmedReason.length < 5) {
      setErrorMsg('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    setErrorMsg(null);
    await onConfirm({
      targetStatus,
      reason: trimmedReason,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-vendor-invoice-title"
        className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
      >
        <div
          className={`px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 ${
            isLunasMode ? 'bg-red-50/80' : 'bg-orange-50/70'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0 ${
                isLunasMode ? 'bg-[#DC2626]' : 'bg-[#EA580C]'
              }`}
            >
              <Undo2 className="w-4 h-4" />
            </div>
            <h3
              id="cancel-vendor-invoice-title"
              className="text-sm font-bold text-slate-900 truncate"
            >
              {isLunasMode
                ? `Batalkan Lunas PO ${po.poNumber} - ${po.vendorName}?`
                : `Batalkan Tagihan PO ${po.poNumber} - ${po.vendorName}`}
            </h3>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            aria-label="Tutup modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {isLunasMode ? (
            <>
              <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  PO ini sudah LUNAS{' '}
                  <span className="font-mono font-bold">Rp {formatIDR(paidDisplayNominal)}</span>
                  {pphSummaryText}. Pembayaran akan dibatalkan dan PO dikembalikan.
                </p>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs space-y-1">
                <div className="font-semibold text-slate-700 mb-1">
                  Info Pembayaran yang Akan Dibatalkan:
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Nominal</span>
                  <span className="font-mono font-bold text-slate-900">
                    Rp {formatIDR(paidDisplayNominal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Tanggal Bayar</span>
                  <span className="font-mono font-medium text-slate-800">{paidDateDisplay}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Metode</span>
                  <span className="font-medium text-slate-800">
                    Pelunasan PO Vendor{po.invoiceNumber ? ` (${po.invoiceNumber})` : ''}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                PO ini sudah ditagih{' '}
                <span className="font-mono font-bold">Rp {formatIDR(effectiveNominal)}</span>.
                Tagihan invoice akan dihapus dan PO dikembalikan. Pilih tujuan:
              </p>
            </div>
          )}

          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-700">
              Tujuan Status PO <span className="text-red-600">*</span>
            </span>
            {radioOptions.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2.5 p-3 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                  targetStatus === opt.value
                    ? isLunasMode
                      ? 'border-[#DC2626] bg-red-50 text-slate-900'
                      : 'border-[#EA580C] bg-orange-50 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="cancelInvoiceTargetStatus"
                  value={opt.value}
                  checked={targetStatus === opt.value}
                  onChange={() => {
                    setTargetStatus(opt.value);
                    setErrorMsg(null);
                  }}
                  className={isLunasMode ? 'accent-[#DC2626]' : 'accent-[#EA580C]'}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <div>
            <label
              htmlFor="cancel-invoice-reason"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Alasan Pembatalan <span className="text-red-600">*</span>
            </label>
            <textarea
              id="cancel-invoice-reason"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder={
                isLunasMode
                  ? 'Contoh: Salah tandai lunas / pembayaran batal atau retur...'
                  : 'Contoh: Salah input invoice vendor / tagihan dibatalkan vendor...'
              }
              className={`w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 ${
                isLunasMode
                  ? 'focus:ring-[#DC2626] focus:border-[#DC2626]'
                  : 'focus:ring-[#EA580C] focus:border-[#EA580C]'
              }`}
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Wajib diisi (minimal 5 karakter)</span>
              <span
                className={`font-mono ${
                  trimmedReason.length >= 5 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {trimmedReason.length}/5
              </span>
            </div>
          </div>

          {errorMsg && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isLunasMode
                  ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                  : 'bg-[#EA580C] hover:bg-[#C2410C]'
              }`}
            >
              <Undo2 className="w-3.5 h-3.5" />
              {isSubmitting
                ? 'Memproses...'
                : isLunasMode
                ? 'Ya, Batalkan Lunas'
                : 'Ya, Batalkan Tagihan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
