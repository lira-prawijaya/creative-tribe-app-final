import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { CLIENT_INVOICE_SCHEMA_LIMITS, ClientInvoice } from '../types/clientInvoice';
import { formatIDR, getTodayISODate } from '../utils/format';
import { resolveClientInvoiceNominal } from '../utils/clientInvoiceFormat';

interface MarkClientInvoicePaidModalProps {
  invoice: ClientInvoice;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (paidDate: string) => Promise<void>;
}

export const MarkClientInvoicePaidModal: React.FC<MarkClientInvoicePaidModalProps> = ({
  invoice,
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const [paidDate, setPaidDate] = useState<string>(
    invoice.paidDate || getTodayISODate()
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paidDate || !CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(paidDate)) {
      setError('Tanggal Dibayar wajib diisi.');
      return;
    }
    setError(null);
    try {
      await onConfirm(paidDate);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal menandai Invoice sebagai Paid di Supabase.'
      );
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
        className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-lg"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Tandai Sudah Dibayar (PAID)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {invoice.invoiceNumber} · {invoice.clientName} · Rp{' '}
              {formatIDR(resolveClientInvoiceNominal(invoice))}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="client-paid-date"
            className="block text-xs font-medium text-slate-700 mb-1.5"
          >
            Tanggal Dibayar Client <span className="text-red-600">*</span>
          </label>
          <input
            id="client-paid-date"
            type="date"
            required
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            Di halaman Projection, Cash In untuk invoice yang sudah PAID akan masuk ke bulan sesuai Tanggal Dibayar ini.
          </p>
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
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? 'Menyimpan...' : 'Simpan & Tandai PAID'}
          </button>
        </div>
      </form>
    </div>
  );
};
