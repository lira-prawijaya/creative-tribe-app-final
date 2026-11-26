import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Printer, X } from 'lucide-react';
import { ClientInvoice } from '../types/clientInvoice';
import { downloadClientInvoicePDF } from '../utils/clientInvoicePdf';
import { printHtmlInNewTab } from '../utils/iframePrint';
import { ClientInvoiceSheet } from './ClientInvoiceSheet';

interface ClientInvoicePreviewModalProps {
  invoice: ClientInvoice | null;
  onClose: () => void;
  canDownload?: boolean;
  onUpdatePrintOptions?: (
    invoiceId: string,
    options: { showGRN: boolean; showSystemGeneratedNote: boolean }
  ) => Promise<void>;
}

export const ClientInvoicePreviewModal: React.FC<
  ClientInvoicePreviewModalProps
> = ({ invoice, onClose, canDownload = true, onUpdatePrintOptions }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const [showGRN, setShowGRN] = useState<boolean>(Boolean(invoice?.showGRN));
  const [showSystemNote, setShowSystemNote] = useState<boolean>(
    invoice?.showSystemGeneratedNote ?? true
  );

  useEffect(() => {
    if (!invoice) return;
    setShowGRN(Boolean(invoice.showGRN));
    setShowSystemNote(invoice.showSystemGeneratedNote ?? true);
    setActionError(null);
  }, [invoice?.id, invoice?.showGRN, invoice?.showSystemGeneratedNote]);

  // Esc key to close & isolate .invoice-print-area during native print
  useEffect(() => {
    document.body.classList.add('printing-client-invoice');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('printing-client-invoice');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  if (!invoice || !invoice.invoiceNumber) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      >
        <div
          role="alert"
          className="w-full max-w-md bg-white border border-red-200 rounded-xl p-6 space-y-4 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-800">
                Preview Invoice gagal dimuat
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                Data invoice tidak ditemukan atau belum lengkap untuk ditampilkan.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleToggleGRN = () => {
    const next = !showGRN;
    setShowGRN(next);
    if (onUpdatePrintOptions && invoice.id) {
      void onUpdatePrintOptions(invoice.id, {
        showGRN: next,
        showSystemGeneratedNote: showSystemNote,
      });
    }
  };

  const handleToggleSystemNote = () => {
    const next = !showSystemNote;
    setShowSystemNote(next);
    if (onUpdatePrintOptions && invoice.id) {
      void onUpdatePrintOptions(invoice.id, {
        showGRN,
        showSystemGeneratedNote: next,
      });
    }
  };

  const safeInvNumber =
    invoice.invoiceNumber.trim().replace(/[/\\:*?"<>|]/g, '-') || 'INV-KKB-071-2026';

  const handlePrintInvoice = () => {
    setActionError(null);
    const el =
      containerRef.current ??
      document.querySelector<HTMLElement>('.invoice-print-area');
    if (!el) {
      setActionError('Preview Invoice gagal dimuat.');
      return;
    }

    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.invoice-due-date-row').forEach((node) => node.remove());

    printHtmlInNewTab({
      title: `INVOICE-${safeInvNumber}`,
      bodyHtml: `<div class="${clone.className}">${clone.innerHTML}</div>`,
      extraCss: `
        @page {
          size: A4 portrait;
          margin: 0;
        }
        html, body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: #000000;
        }
        .no-print, .print\\:hidden, .invoice-due-date-row {
          display: none !important;
        }
        .invoice-print-area {
          width: 210mm !important;
          min-height: 296mm !important;
          height: 296mm !important;
          margin: 0 auto !important;
          padding: 20px !important;
          box-shadow: none !important;
          border: none !important;
          background: #ffffff !important;
          box-sizing: border-box !important;
        }
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
          }
          .no-print, .print\\:hidden {
            display: none !important;
          }
          .invoice-print-area {
            position: static !important;
            width: 210mm !important;
            min-height: 296mm !important;
            height: 296mm !important;
            margin: 0 auto !important;
            padding: 20px !important;
            box-shadow: none !important;
            border: none !important;
            background: #ffffff !important;
            visibility: visible !important;
          }
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      `,
      onError: setActionError,
    });
  };

  const handleDownloadPDF = async () => {
    setActionError(null);
    setIsDownloading(true);
    try {
      await downloadClientInvoicePDF(invoice, {
        showGRN,
        showSystemGeneratedNote: showSystemNote,
      });
    } catch {
      setActionError('Gagal membuat file PDF Invoice.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview Invoice ${invoice.invoiceNumber}`}
      className="fixed inset-0 z-50 bg-slate-900/65 flex items-center justify-center p-2 sm:p-4"
    >
      <div className="w-full max-w-5xl max-h-[95vh] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header + 2 Toggles (no-print) */}
        <div className="no-print px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                Preview Invoice — {invoice.invoiceNumber}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {invoice.clientName} · {invoice.projectName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup modal preview"
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {canDownload && (
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-200/80 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showGRN}
                  onChange={handleToggleGRN}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                />
                <span className="font-medium text-slate-800">Tampilkan GRN</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showSystemNote}
                  onChange={handleToggleSystemNote}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                />
                <span className="font-medium text-slate-800">
                  Tampilkan Note Generated by System
                </span>
              </label>
            </div>
          )}
        </div>

        {actionError && (
          <div
            role="alert"
            className="no-print mx-4 mt-3 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between gap-2 shrink-0"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="font-semibold text-red-800 hover:underline cursor-pointer shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Plain A4 Paper Preview Area (subtle drop shadow around sheet only) */}
        <div className="flex-1 overflow-auto bg-slate-200/80 p-3 sm:p-6">
          <ClientInvoiceSheet
            invoice={invoice}
            showGRN={showGRN}
            showSystemNote={showSystemNote}
            sheetRef={containerRef}
          />
        </div>

        {/* Modal Bottom Footer: Print + Download PDF (no-print) */}
        <div className="no-print px-4 sm:px-5 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            Tutup
          </button>

          {canDownload && (
            <div className="flex flex-wrap items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={handlePrintInvoice}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>

              <button
                type="button"
                disabled={isDownloading}
                onClick={() => void handleDownloadPDF()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {isDownloading ? 'Membuat PDF...' : 'Download PDF'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
