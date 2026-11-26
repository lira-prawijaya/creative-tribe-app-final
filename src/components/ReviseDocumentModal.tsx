import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileWarning,
  History,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { AuditActor } from '../types/auth';
import { ClientInvoice, CLIENT_INVOICE_SCHEMA_LIMITS } from '../types/clientInvoice';
import {
  PO_SCHEMA_LIMITS,
  POLineItem,
  PurchaseOrder,
} from '../types/po';
import {
  calculateClientInvoiceBreakdown,
  resolveClientInvoiceNominal,
} from '../utils/clientInvoiceFormat';
import {
  computeRevisionOutcome,
  formatIDR,
  generateNextRevisionInvoiceNumber,
  getTodayISODate,
} from '../utils/format';

export interface ReviseSubmitPayload {
  reason: string;
  revisedBy: string;
  newItems: POLineItem[];
  newInvoiceNumber: string;
  newInvoiceDate: string;
  newDueDate: string;
}

interface ReviseDocumentModalProps {
  docType: 'po' | 'client-invoice';
  po?: PurchaseOrder;
  invoice?: ClientInvoice;
  currentActor?: AuditActor;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (payload: ReviseSubmitPayload) => Promise<void>;
}

export const ReviseDocumentModal: React.FC<ReviseDocumentModalProps> = ({
  docType,
  po,
  invoice,
  currentActor,
  isSubmitting,
  onCancel,
  onConfirm,
}) => {
  const sourceItems: POLineItem[] =
    docType === 'po' ? po?.items ?? [] : invoice?.items ?? [];
  const oldAmount =
    docType === 'po'
      ? Math.round(po?.totalAmount || 0)
      : invoice
      ? resolveClientInvoiceNominal(invoice)
      : 0;
  const includePPN = docType === 'client-invoice' && Boolean(invoice?.includePPN);
  const ppnPercent = docType === 'client-invoice' ? invoice?.ppnPercent ?? 11 : 0;
  const includePPh = docType === 'client-invoice' && Boolean(invoice?.includePPh);
  const includeCitibank =
    docType === 'client-invoice' && Boolean(invoice?.includeCitibank);
  const wasPaid =
    docType === 'po' ? po?.status === 'Paid' : invoice?.status === 'Paid';

  const oldInvoiceNumber =
    docType === 'po'
      ? (po?.invoiceNumber || po?.poNumber || '').trim()
      : (invoice?.invoiceNumber || '').trim();

  const defaultNewInvNumber = useMemo(
    () =>
      generateNextRevisionInvoiceNumber(
        oldInvoiceNumber,
        docType === 'po' ? `INV-${po?.poNumber || '001'}` : 'INV-CLI-001'
      ),
    [oldInvoiceNumber, docType, po?.poNumber]
  );

  const today = getTodayISODate();
  const [reason, setReason] = useState('');
  const [revisedBy, setRevisedBy] = useState<string>(PO_SCHEMA_LIMITS.defaultRevisionUser);
  const [newInvoiceNumber, setNewInvoiceNumber] = useState(defaultNewInvNumber);
  const [newInvoiceDate, setNewInvoiceDate] = useState(
    (docType === 'po' ? po?.invoiceDate : invoice?.invoiceDate) || today
  );
  const [newDueDate, setNewDueDate] = useState(
    (docType === 'po' ? po?.dueDate : invoice?.dueDate) || today
  );
  const [items, setItems] = useState<POLineItem[]>(() =>
    sourceItems.length > 0
      ? sourceItems.map((it) => ({ ...it }))
      : [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }]
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const subtotalNew = useMemo(
    () => items.reduce((sum, it) => sum + Math.round(Number(it.amount) || 0), 0),
    [items]
  );
  const clientRevBreakdown = useMemo(
    () =>
      docType === 'client-invoice'
        ? calculateClientInvoiceBreakdown({
            dpp: subtotalNew,
            includePPN,
            ppnPercent,
            includePPh,
            includeCitibank,
          })
        : null,
    [docType, subtotalNew, includePPN, ppnPercent, includePPh, includeCitibank]
  );
  const ppnNew = clientRevBreakdown ? clientRevBreakdown.ppnAmount : 0;
  const newAmount = clientRevBreakdown ? clientRevBreakdown.netReceivable : subtotalNew;

  const outcome = useMemo(
    () => computeRevisionOutcome(wasPaid, oldAmount, newAmount),
    [wasPaid, oldAmount, newAmount]
  );

  const handleItemChange = (
    idx: number,
    field: 'description' | 'quantity' | 'unitPrice',
    rawVal: string
  ) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (field === 'description') {
          return { ...item, description: rawVal };
        }
        const num = Number(rawVal);
        const safeNum = Number.isFinite(num) ? num : 0;
        const qty = field === 'quantity' ? Math.max(0, Math.round(safeNum)) : item.quantity;
        const price =
          field === 'unitPrice' ? Math.max(0, Math.round(safeNum)) : item.unitPrice;
        return {
          ...item,
          quantity: qty,
          unitPrice: price,
          amount: Math.round(qty * price),
        };
      })
    );
  };

  const handleAddRow = () => {
    if (items.length >= PO_SCHEMA_LIMITS.maxItems) return;
    setItems((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const handleRemoveRow = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMsg('Alasan Revisi wajib diisi, tidak boleh kosong.');
      return;
    }
    if (!revisedBy.trim()) {
      setErrorMsg('Nama / Email pengubah revisi (Oleh Siapa) wajib diisi.');
      return;
    }
    if (!newInvoiceNumber.trim()) {
      setErrorMsg('Nomor Invoice Pengganti wajib diisi.');
      return;
    }
    for (let i = 0; i < items.length; i += 1) {
      if (!items[i].description.trim()) {
        setErrorMsg(`Deskripsi item baris ${i + 1} wajib diisi.`);
        return;
      }
      if (!Number.isFinite(items[i].quantity) || items[i].quantity <= 0) {
        setErrorMsg(`Qty item baris ${i + 1} harus lebih dari 0.`);
        return;
      }
    }

    setErrorMsg(null);
    await onConfirm({
      reason: reason.trim(),
      revisedBy: revisedBy.trim(),
      newItems: items,
      newInvoiceNumber: newInvoiceNumber.trim(),
      newInvoiceDate,
      newDueDate,
    });
  };

  const docTitle =
    docType === 'po'
      ? `Revisi PO & Invoice — ${po?.poNumber ?? ''}`
      : `Revisi Invoice Client — ${invoice?.invoiceNumber ?? ''}`;

  const partyName =
    docType === 'po' ? po?.vendorName ?? '-' : invoice?.clientName ?? '-';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="revise-doc-title"
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden my-6">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="revise-doc-title" className="text-base font-bold text-slate-900 truncate">
                {docTitle}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {docType === 'po' ? 'Vendor' : 'Client'}: {partyName} · Status saat ini:{' '}
                <strong className={wasPaid ? 'text-emerald-800' : 'text-slate-800'}>
                  {wasPaid
                    ? 'LUNAS (Paid)'
                    : docType === 'po'
                    ? po?.status
                    : invoice?.status}
                </strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer shrink-0"
            aria-label="Tutup modal revisi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {wasPaid && (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Revisi Dokumen Berstatus LUNAS (Ketat &amp; Tercatat)</p>
                <p className="leading-relaxed">
                  Invoice lama akan diubah statusnya menjadi{' '}
                  <strong>VOID / DIREVISI - Diganti oleh {newInvoiceNumber || '... REV 1'}</strong>{' '}
                  (tidak dihapus &amp; tetap dapat dibuka/di-print sebagai bukti), dan sistem akan
                  mencatat riwayat revisi permanen.
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium"
            >
              {errorMsg}
            </div>
          )}

          {/* Nominal Lama vs Nominal Baru vs Selisih */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Nominal Lama
              </span>
              <span className="block text-base font-bold font-mono text-slate-900 mt-1 tabular-nums">
                Rp {formatIDR(oldAmount)}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                Nominal Baru
              </span>
              <span className="block text-base font-bold font-mono text-blue-900 mt-1 tabular-nums">
                Rp {formatIDR(newAmount)}
              </span>
              {clientRevBreakdown &&
                (clientRevBreakdown.includePPN ||
                  clientRevBreakdown.includePPh ||
                  clientRevBreakdown.includeCitibank) && (
                  <span className="block text-[10px] text-blue-700 mt-0.5 tabular-nums">
                    {includePPN ? `PPN ${clientRevBreakdown.ppnPercent}% Rp ${formatIDR(ppnNew)}` : 'Tanpa PPN'}
                    {clientRevBreakdown.pphAmount > 0
                      ? ` · -PPh23 Rp ${formatIDR(clientRevBreakdown.pphAmount)}`
                      : ''}
                    {clientRevBreakdown.citibankFeeAmount > 0
                      ? ` · -Citibank Rp ${formatIDR(clientRevBreakdown.citibankFeeAmount)}`
                      : ''}
                  </span>
                )}
            </div>

            <div
              className={`p-3 rounded-lg border ${
                outcome.diffAmount > 0
                  ? 'bg-rose-50 border-rose-200'
                  : outcome.diffAmount < 0
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Selisih (Baru - Lama)
              </span>
              <span
                className={`block text-base font-bold font-mono mt-1 tabular-nums ${
                  outcome.diffAmount > 0
                    ? 'text-rose-700'
                    : outcome.diffAmount < 0
                    ? 'text-amber-800'
                    : 'text-slate-700'
                }`}
              >
                {outcome.diffAmount > 0
                  ? `+Rp ${formatIDR(outcome.diffAmount)}`
                  : outcome.diffAmount < 0
                  ? `-Rp ${formatIDR(Math.abs(outcome.diffAmount))}`
                  : 'Rp 0'}
              </span>
            </div>
          </div>

          {/* Overpayment / Underpayment Live Warning */}
          {wasPaid && outcome.diffAmount < 0 && (
            <div className="p-3 rounded-lg bg-amber-100/80 border border-amber-300 text-xs text-amber-950 flex items-center gap-2 font-semibold">
              <FileWarning className="w-4 h-4 text-amber-800 shrink-0" />
              <span>
                Kelebihan bayar Rp {formatIDR(Math.abs(outcome.diffAmount))}, perlu refund / jadi
                kredit client · Status menjadi: MENUNGGU KONFIRMASI
              </span>
            </div>
          )}

          {wasPaid && outcome.diffAmount > 0 && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-xs text-rose-900 flex items-center gap-2 font-semibold">
              <FileWarning className="w-4 h-4 text-rose-700 shrink-0" />
              <span>
                Kurang bayar Rp {formatIDR(outcome.diffAmount)}, perlu tagih susulan · Status menjadi:
                MENUNGGU PEMBAYARAN ULANG
              </span>
            </div>
          )}

          {/* Reason + User */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label
                htmlFor="revise-reason"
                className="block text-xs font-semibold text-slate-800 mb-1"
              >
                Alasan Revisi <span className="text-red-600">*</span>
              </label>
              <textarea
                id="revise-reason"
                required
                rows={2}
                maxLength={PO_SCHEMA_LIMITS.revisionReasonMax}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Wajib diisi: jelaskan alasan perubahan nominal, item, atau tanggal..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="revise-by"
                className="block text-xs font-semibold text-slate-800 mb-1"
              >
                Oleh Siapa <span className="text-red-600">*</span>
              </label>
              <input
                id="revise-by"
                type="text"
                required
                maxLength={PO_SCHEMA_LIMITS.revisedByMax}
                value={revisedBy}
                onChange={(e) => setRevisedBy(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {/* Replacement Invoice Number + Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="revise-inv-no"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                No. Invoice Pengganti
              </label>
              <input
                id="revise-inv-no"
                type="text"
                required
                maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.invoiceNumberMax}
                value={newInvoiceNumber}
                onChange={(e) => setNewInvoiceNumber(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="revise-inv-date"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Tanggal Invoice Pengganti
              </label>
              <input
                id="revise-inv-date"
                type="date"
                required
                value={newInvoiceDate}
                onChange={(e) => setNewInvoiceDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="revise-due-date"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Jatuh Tempo
              </label>
              <input
                id="revise-due-date"
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {/* Editable Line Items for New Nominal */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                Rincian Item &amp; Nominal Baru
              </span>
              <button
                type="button"
                onClick={handleAddRow}
                disabled={items.length >= PO_SCHEMA_LIMITS.maxItems}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Baris
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                >
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Deskripsi #{idx + 1}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={PO_SCHEMA_LIMITS.descriptionMax}
                      value={item.description}
                      onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Qty
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      required
                      value={item.quantity || ''}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Harga Satuan (IDR)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="1"
                      required
                      value={item.unitPrice ?? 0}
                      onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-1 flex justify-end">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(idx)}
                        className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                        title="Hapus baris"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg disabled:opacity-60 cursor-pointer"
            >
              {isSubmitting ? 'Memproses Revisi...' : 'Ya, Revisi & Buat Invoice Pengganti'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
