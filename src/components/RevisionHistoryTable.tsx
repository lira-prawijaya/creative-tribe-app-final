import React from 'react';
import { History, Printer, ShieldAlert } from 'lucide-react';
import { DocumentRevisionEntry, VoidedInvoiceRecord } from '../types/po';
import { formatIDR, formatShortDateID } from '../utils/format';

interface RevisionHistoryTableProps {
  revisions?: DocumentRevisionEntry[];
  voidedInvoices?: VoidedInvoiceRecord[];
  onOpenVoidedInvoice?: (record: VoidedInvoiceRecord) => void;
  title?: string;
}

export const RevisionHistoryTable: React.FC<RevisionHistoryTableProps> = ({
  revisions = [],
  voidedInvoices = [],
  onOpenVoidedInvoice,
  title = 'Riwayat Revisi (Audit Log Permanen)',
}) => {
  if (revisions.length === 0 && voidedInvoices.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        </div>
        <span className="text-[11px] text-slate-500">
          Catatan permanen (tidak dapat dihapus)
        </span>
      </div>

      {revisions.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2 px-3 whitespace-nowrap">Tanggal</th>
                <th className="py-2 px-3 whitespace-nowrap">Oleh Siapa</th>
                <th className="py-2 px-3">Alasan</th>
                <th className="py-2 px-3 whitespace-nowrap">Nominal Lama -&gt; Baru</th>
                <th className="py-2 px-3 whitespace-nowrap">No. Invoice Lama -&gt; Baru</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {revisions.map((rev) => (
                <tr key={rev.id} className="hover:bg-slate-50/70">
                  <td className="py-2 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                    {rev.revisedAt}
                  </td>
                  <td className="py-2 px-3 text-slate-800 whitespace-nowrap">
                    {rev.revisedBy}
                  </td>
                  <td className="py-2 px-3 text-slate-800 max-w-[260px]">
                    <div className="font-medium">{rev.reason}</div>
                    {rev.resolutionNote && (
                      <div className="text-[11px] text-amber-800 mt-0.5">
                        {rev.resolutionNote}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap">
                    <span className="text-slate-500">Rp {formatIDR(rev.oldAmount)}</span>{' '}
                    <span className="text-slate-400">-&gt;</span>{' '}
                    <span className="font-semibold text-slate-900">
                      Rp {formatIDR(rev.newAmount)}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] whitespace-nowrap">
                    <span className="text-slate-500 line-through">
                      {rev.oldInvoiceNumber || '-'}
                    </span>{' '}
                    <span className="text-slate-400">-&gt;</span>{' '}
                    <span className="font-semibold text-slate-900">
                      {rev.newInvoiceNumber}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {voidedInvoices.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
            Arsip Invoice Lama (VOID / DIREVISI — Tersimpan Sebagai Bukti)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {voidedInvoices.map((v) => (
              <div
                key={v.id}
                className="p-3 rounded-lg border border-rose-200 bg-rose-50/50 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono font-bold text-rose-900 truncate">
                    {v.invoiceNumber || '-'}
                  </div>
                  <div className="text-[11px] text-rose-800 font-medium mt-0.5">
                    {v.statusLabel}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 tabular-nums">
                    Rp {formatIDR(v.totalAmount)} · Voided {formatShortDateID(v.voidedAt)}
                  </div>
                </div>
                {onOpenVoidedInvoice && (
                  <button
                    type="button"
                    onClick={() => onOpenVoidedInvoice(v)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md shrink-0 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Buka / Print Bukti
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
