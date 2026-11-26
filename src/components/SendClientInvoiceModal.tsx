import React, { useMemo, useState } from 'react';
import { CalendarClock, Send } from 'lucide-react';
import { CLIENT_INVOICE_SCHEMA_LIMITS, ClientInvoice } from '../types/clientInvoice';
import { PaymentTermsMode } from '../types/po';
import {
  calculateDueDate,
  formatDocumentDate,
  formatIDR,
  getTodayISODate,
} from '../utils/format';
import { resolveClientInvoiceNominal } from '../utils/clientInvoiceFormat';

interface SendClientInvoiceModalProps {
  invoice: ClientInvoice;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (params: {
    sentDate: string;
    dueDate: string;
    paymentTermsMode: PaymentTermsMode;
    paymentTermsDays?: number;
    manualDueDateNote?: string;
  }) => Promise<void>;
}

type QuickTermChoice = 'NET14' | 'NET30' | 'NET45' | 'CUSTOM';

const QUICK_TERMS: Array<{
  id: QuickTermChoice;
  label: string;
  days?: 14 | 30 | 45;
}> = [
  { id: 'NET14', label: 'NET 14', days: 14 },
  { id: 'NET30', label: 'NET 30', days: 30 },
  { id: 'NET45', label: 'NET 45', days: 45 },
  { id: 'CUSTOM', label: 'Custom' },
];

export const SendClientInvoiceModal: React.FC<SendClientInvoiceModalProps> = ({
  invoice,
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const initialSentDate =
    invoice.sentDate && CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(invoice.sentDate)
      ? invoice.sentDate
      : getTodayISODate();

  const initialChoice: QuickTermChoice = useMemo(() => {
    if (invoice.paymentTermsMode === 'MANUAL') return 'CUSTOM';
    if (invoice.paymentTermsDays === 14) return 'NET14';
    if (invoice.paymentTermsDays === 45) return 'NET45';
    if (invoice.paymentTermsDays === 30 || !invoice.dueDate) return 'NET30';
    return 'CUSTOM';
  }, [invoice.dueDate, invoice.paymentTermsDays, invoice.paymentTermsMode]);

  const initialDueDate = useMemo(() => {
    if (invoice.dueDate && CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(invoice.dueDate)) {
      return invoice.dueDate;
    }
    const days =
      initialChoice === 'NET14' ? 14 : initialChoice === 'NET45' ? 45 : 30;
    return calculateDueDate(initialSentDate, days);
  }, [initialChoice, initialSentDate, invoice.dueDate]);

  const [sentDate, setSentDate] = useState<string>(initialSentDate);
  const [quickChoice, setQuickChoice] = useState<QuickTermChoice>(initialChoice);
  const [dueDate, setDueDate] = useState<string>(initialDueDate);
  const [error, setError] = useState<string | null>(null);

  const selectedNetDays =
    quickChoice === 'NET14'
      ? 14
      : quickChoice === 'NET30'
      ? 30
      : quickChoice === 'NET45'
      ? 45
      : undefined;

  const handleSentDateChange = (nextSentDate: string) => {
    setSentDate(nextSentDate);
    if (
      selectedNetDays !== undefined &&
      CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(nextSentDate)
    ) {
      setDueDate(calculateDueDate(nextSentDate, selectedNetDays));
    }
  };

  const handlePickQuickTerm = (choice: QuickTermChoice) => {
    setQuickChoice(choice);
    const meta = QUICK_TERMS.find((item) => item.id === choice);
    if (
      meta?.days !== undefined &&
      CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(sentDate)
    ) {
      setDueDate(calculateDueDate(sentDate, meta.days));
    }
  };

  const handleManualDueDateChange = (nextDueDate: string) => {
    setDueDate(nextDueDate);
    setQuickChoice('CUSTOM');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sentDate || !CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(sentDate)) {
      setError('Tanggal Kirim Invoice wajib diisi.');
      return;
    }
    if (!dueDate || !CLIENT_INVOICE_SCHEMA_LIMITS.datePattern.test(dueDate)) {
      setError('Estimasi Pembayaran (Jatuh Tempo) wajib diisi.');
      return;
    }
    setError(null);

    try {
      await onConfirm({
        sentDate,
        dueDate,
        paymentTermsMode: selectedNetDays !== undefined ? 'NET' : 'MANUAL',
        paymentTermsDays: selectedNetDays,
        manualDueDateNote: '',
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal mengirim Invoice Client ke Supabase.'
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Kirim Invoice ${invoice.invoiceNumber}`}
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
            <Send className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">
              Kirim Invoice ke Client
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {invoice.invoiceNumber} · {invoice.clientName} · Rp{' '}
              {formatIDR(resolveClientInvoiceNominal(invoice))}
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* a. Tanggal Kirim Invoice */}
        <div>
          <label
            htmlFor="send-inv-date"
            className="block text-xs font-medium text-slate-700 mb-1.5"
          >
            Tanggal Kirim Invoice <span className="text-red-600">*</span>
          </label>
          <input
            id="send-inv-date"
            type="date"
            required
            value={sentDate}
            onChange={(e) => handleSentDateChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Default hari ini; ubah jika invoice dikirim di tanggal lain.
          </p>
        </div>

        {/* c. Pilih Cepat NET 14 / NET 30 / NET 45 / Custom */}
        <div>
          <span className="block text-xs font-medium text-slate-700 mb-1.5">
            Pilih Cepat Payment Terms
          </span>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_TERMS.map((opt) => {
              const active = quickChoice === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handlePickQuickTerm(opt.id)}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* b. Estimasi Pembayaran (Jatuh Tempo) */}
        <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="send-inv-due-date"
              className="text-xs font-medium text-slate-700 inline-flex items-center gap-1.5"
            >
              <CalendarClock className="w-3.5 h-3.5 text-slate-600" />
              <span>
                Estimasi Pembayaran (Jatuh Tempo){' '}
                <span className="text-red-600">*</span>
              </span>
            </label>
            <span className="text-[11px] font-semibold text-blue-700">
              {selectedNetDays !== undefined ? `NET ${selectedNetDays}` : 'Custom'}
            </span>
          </div>

          <input
            id="send-inv-due-date"
            type="date"
            required
            value={dueDate}
            onChange={(e) => handleManualDueDateChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />

          <p className="text-[11px] text-slate-600">
            {dueDate ? (
              <>
                Jatuh tempo tercatat:{' '}
                <strong className="text-slate-900">
                  {formatDocumentDate(dueDate)}
                </strong>
                {selectedNetDays !== undefined
                  ? ` (${selectedNetDays} hari dari Tanggal Kirim)`
                  : ' (tanggal pilihan manual)'}
                .
              </>
            ) : (
              'Pilih tanggal estimasi client melakukan pembayaran.'
            )}
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
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            {isSubmitting ? 'Mengirim...' : 'Kirim Invoice & Simpan'}
          </button>
        </div>
      </form>
    </div>
  );
};
