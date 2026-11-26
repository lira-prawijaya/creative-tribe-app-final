import React, { useRef } from 'react';
import { Printer, X } from 'lucide-react';
import { COMPANY_INFO, PurchaseOrder, VoidedInvoiceRecord } from '../types/po';
import { formatDocumentDate, formatIDR } from '../utils/format';
import { printHtmlInNewTab } from '../utils/iframePrint';

interface VoidedInvoiceProofModalProps {
  po: PurchaseOrder;
  record: VoidedInvoiceRecord;
  onClose: () => void;
}

export const VoidedInvoiceProofModal: React.FC<VoidedInvoiceProofModalProps> = ({
  po,
  record,
  onClose,
}) => {
  const proofRef = useRef<HTMLDivElement | null>(null);

  const handlePrintProof = () => {
    const el = proofRef.current;
    if (!el) return;
    printHtmlInNewTab({
      title: `VOID-PROOF-${record.invoiceNumber || po.poNumber}`,
      bodyHtml: el.outerHTML,
      extraCss: `
        @page { size: A4; margin: 12mm; }
        body { margin: 0; background: #fff; color: #000; padding: 12mm; }
        @media print {
          body { padding: 0 !important; }
        }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      `,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden my-6">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-slate-900">
            Arsip Bukti Invoice Lama (VOID / DIREVISI)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintProof}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Bukti
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              aria-label="Tutup arsip"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 max-h-[80vh] overflow-y-auto bg-slate-50">
          <div
            ref={proofRef}
            className="bg-white border border-slate-300 p-6 text-black space-y-4 font-[Arial,Helvetica,sans-serif]"
          >
            <div className="border-2 border-rose-700 bg-rose-50 px-3 py-2 text-center">
              <p className="text-sm font-extrabold text-rose-800 uppercase">
                {record.statusLabel}
              </p>
              <p className="text-xs text-rose-700 mt-0.5">
                Tanggal Void: {formatDocumentDate(record.voidedAt)} · Alasan: {record.reason}
              </p>
            </div>

            <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
              <div>
                <p className="text-sm font-bold">{COMPANY_INFO.name}</p>
                <p className="text-xs text-slate-600">{COMPANY_INFO.address}</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-bold">ARSIP INVOICE VENDOR (VOID)</p>
                <p className="font-mono mt-0.5">No. Invoice: {record.invoiceNumber || '-'}</p>
                <p>No. PO: {po.poNumber}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p>
                  <strong>Vendor:</strong> {po.vendorName}
                </p>
                <p>
                  <strong>Project:</strong> {po.projectName} ({po.projectNumber})
                </p>
              </div>
              <div className="text-right">
                <p>
                  <strong>Tgl Invoice Lama:</strong>{' '}
                  {record.invoiceDate ? formatDocumentDate(record.invoiceDate) : '-'}
                </p>
                <p>
                  <strong>Jatuh Tempo Lama:</strong>{' '}
                  {record.dueDate ? formatDocumentDate(record.dueDate) : '-'}
                </p>
              </div>
            </div>

            <table className="w-full border-collapse border border-black text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-black px-2 py-1.5 text-left">Description</th>
                  <th className="border border-black px-2 py-1.5 text-center">Qty</th>
                  <th className="border border-black px-2 py-1.5 text-right">Unit Price</th>
                  <th className="border border-black px-2 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {record.items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="border border-black px-2 py-1.5">{it.description}</td>
                    <td className="border border-black px-2 py-1.5 text-center tabular-nums">
                      {formatIDR(it.quantity)}
                    </td>
                    <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                      {formatIDR(it.unitPrice)}
                    </td>
                    <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                      {formatIDR(it.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-right text-sm font-bold tabular-nums">
              Total Nominal Lama (IDR): Rp {formatIDR(record.totalAmount)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
