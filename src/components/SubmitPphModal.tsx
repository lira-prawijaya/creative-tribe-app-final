import React, { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, X } from 'lucide-react';
import { PO_SCHEMA_LIMITS, PurchaseOrder, VendorPphType } from '../types/po';
import {
  calculateVendorInvoiceTaxBreakdown,
  formatIDR,
  formatTaxRateForInput,
  getTodayISODate,
  parseTaxRateInput,
  sanitizeVendorPphType,
} from '../utils/format';

interface SubmitPphModalProps {
  po: PurchaseOrder;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (params: {
    pphType: VendorPphType;
    pphRate: number;
    pphDate: string;
  }) => Promise<void>;
}

export const SubmitPphModal: React.FC<SubmitPphModalProps> = ({
  po,
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const initialType: Exclude<VendorPphType, 'NONE'> =
    sanitizeVendorPphType(po.pphType) === 'PPH23' ? 'PPH23' : 'PPH21';
  const initialRate =
    typeof po.pphRate === 'number' && po.pphRate > 0
      ? po.pphRate
      : initialType === 'PPH21'
      ? 2.5
      : 2;

  const [pphType, setPphType] = useState<Exclude<VendorPphType, 'NONE'>>(initialType);
  const [pphRateInput, setPphRateInput] = useState<string>(
    formatTaxRateForInput(initialRate)
  );
  const [pphDate, setPphDate] = useState<string>(
    po.pphDate && PO_SCHEMA_LIMITS.datePattern.test(po.pphDate)
      ? po.pphDate
      : getTodayISODate()
  );
  const [error, setError] = useState<string | null>(null);

  const dpp = Math.max(
    0,
    Math.round(Number(po.dppAmount) || 0) || Math.round(Number(po.totalAmount) || 0)
  );
  const ppnRate = Math.max(0, Math.min(100, Number(po.ppnRate) || 0));
  const parsedPphRate = parseTaxRateInput(pphRateInput);

  const breakdown = useMemo(
    () =>
      calculateVendorInvoiceTaxBreakdown({
        dpp,
        ppnRate,
        pphType,
        pphRate: parsedPphRate,
      }),
    [dpp, ppnRate, pphType, parsedPphRate]
  );

  const handleTypeChange = (next: Exclude<VendorPphType, 'NONE'>) => {
    setPphType(next);
    setPphRateInput(next === 'PPH21' ? '2,5' : '2');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PO_SCHEMA_LIMITS.datePattern.test(pphDate)) {
      setError('Tanggal submit PPh wajib diisi.');
      return;
    }
    if (parsedPphRate <= 0) {
      setError('Tarif PPh harus lebih besar dari 0%.');
      return;
    }
    setError(null);
    try {
      await onConfirm({
        pphType,
        pphRate: parsedPphRate,
        pphDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Submit PPh Invoice Vendor</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {po.poNumber} · {po.vendorName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="submit-pph-type"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Jenis PPh
            </label>
            <select
              id="submit-pph-type"
              value={pphType}
              onChange={(e) =>
                handleTypeChange(e.target.value as Exclude<VendorPphType, 'NONE'>)
              }
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="PPH21">PPh 21 (2,5%)</option>
              <option value="PPH23">PPh 23 (2%)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="submit-pph-rate"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Tarif PPh (%)
            </label>
            <input
              id="submit-pph-rate"
              type="text"
              inputMode="decimal"
              value={pphRateInput}
              onChange={(e) => setPphRateInput(e.target.value.replace(/[^0-9.,]/g, ''))}
              className="w-full px-3 py-2 text-xs font-mono text-right bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="submit-pph-date"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Tanggal Submit PPh
          </label>
          <input
            id="submit-pph-date"
            type="date"
            required
            value={pphDate}
            onChange={(e) => setPphDate(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>DPP</span>
            <span className="font-mono tabular-nums">Rp {formatIDR(breakdown.dppAmount)}</span>
          </div>
          <div className="flex justify-between text-slate-700">
            <span>+ PPN ({formatTaxRateForInput(breakdown.ppnRate)}%)</span>
            <span className="font-mono tabular-nums">
              {breakdown.ppnAmount > 0 ? `+ Rp ${formatIDR(breakdown.ppnAmount)}` : 'Rp 0'}
            </span>
          </div>
          <div className="flex justify-between font-semibold text-slate-800 pt-1 border-t border-dashed border-slate-200">
            <span>(=) GROSS</span>
            <span className="font-mono tabular-nums">Rp {formatIDR(breakdown.grossAmount)}</span>
          </div>
          <div className="flex justify-between text-rose-700">
            <span>
              - {pphType === 'PPH21' ? 'PPh 21' : 'PPh 23'} (
              {formatTaxRateForInput(breakdown.pphRate)}%)
            </span>
            <span className="font-mono tabular-nums font-semibold">
              - Rp {formatIDR(breakdown.pphAmount)}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-300">
            <span className="font-bold text-slate-900">= NET (Setelah Submit PPh)</span>
            <span className="text-base font-extrabold font-mono tabular-nums text-emerald-700">
              Rp {formatIDR(breakdown.netAkhir)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isSubmitting ? 'Menyimpan...' : 'Submit PPh & Update NET'}
          </button>
        </div>
      </form>
    </div>
  );
};
