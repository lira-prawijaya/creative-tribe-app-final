import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  Download,
  History,
  Pencil,
  Printer,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { AuditActor, PermissionsMap } from '../types/auth';
import { ClientInvoice } from '../types/clientInvoice';
import { PaymentTermsMode } from '../types/po';
import { downloadClientInvoicePDF } from '../utils/clientInvoicePdf';
import { printHtmlInNewTab } from '../utils/iframePrint';
import { ClientInvoiceSheet } from './ClientInvoiceSheet';
import { ReviseDocumentModal, ReviseSubmitPayload } from './ReviseDocumentModal';
import { RevisionHistoryTable } from './RevisionHistoryTable';
import { SendClientInvoiceModal } from './SendClientInvoiceModal';

interface ClientInvoiceDocumentPreviewProps {
  invoice: ClientInvoice;
  permissions: PermissionsMap;
  currentActor: AuditActor;
  onBack: () => void;
  onEdit: (invoice: ClientInvoice) => void;
  onDuplicate: (invoice: ClientInvoice) => void;
  onSendInvoice?: (
    invoiceId: string,
    params: {
      sentDate: string;
      dueDate: string;
      paymentTermsMode: PaymentTermsMode;
      paymentTermsDays?: number;
      manualDueDateNote?: string;
    }
  ) => Promise<void>;
  onReviseInvoice?: (
    invoice: ClientInvoice,
    payload: ReviseSubmitPayload
  ) => Promise<void>;
  onUpdatePrintOptions?: (
    invoiceId: string,
    options: { showGRN: boolean; showSystemGeneratedNote: boolean }
  ) => Promise<void>;
  autoPrint?: boolean;
}

export const ClientInvoiceDocumentPreview: React.FC<
  ClientInvoiceDocumentPreviewProps
> = ({
  invoice,
  permissions,
  currentActor,
  onBack,
  onEdit,
  onDuplicate,
  onSendInvoice,
  onReviseInvoice,
  onUpdatePrintOptions,
  autoPrint = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasAutoPrintedRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [showReviseModal, setShowReviseModal] = useState(false);
  const [isRevising, setIsRevising] = useState(false);

  const [showGRN, setShowGRN] = useState<boolean>(Boolean(invoice.showGRN));
  const [showSystemNote, setShowSystemNote] = useState<boolean>(
    invoice.showSystemGeneratedNote ?? true
  );

  useEffect(() => {
    setShowGRN(Boolean(invoice.showGRN));
    setShowSystemNote(invoice.showSystemGeneratedNote ?? true);
  }, [invoice.id, invoice.showGRN, invoice.showSystemGeneratedNote]);

  useEffect(() => {
    document.body.classList.add('printing-client-invoice');
    return () => {
      document.body.classList.remove('printing-client-invoice');
    };
  }, []);

  const handleToggleGRN = () => {
    const next = !showGRN;
    setShowGRN(next);
    if (onUpdatePrintOptions) {
      void onUpdatePrintOptions(invoice.id, {
        showGRN: next,
        showSystemGeneratedNote: showSystemNote,
      });
    }
  };

  const handleToggleSystemNote = () => {
    const next = !showSystemNote;
    setShowSystemNote(next);
    if (onUpdatePrintOptions) {
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

  useEffect(() => {
    if (autoPrint && !hasAutoPrintedRef.current) {
      hasAutoPrintedRef.current = true;
      const timer = window.setTimeout(() => {
        handlePrintInvoice();
      }, 150);
      return () => window.clearTimeout(timer);
    }
  }, [autoPrint]);

  const isPaid = invoice.status === 'Paid';
  const isVoided = Boolean(invoice.isVoided);

  return (
    <div className="min-h-screen bg-slate-200/80 pb-10 pt-4 px-4 sm:px-6 print:bg-white print:p-0">
      {/* Top Sticky Action Bar + 2 Live Toggles (no-print) */}
      <div className="no-print sticky top-3 z-30 max-w-[210mm] mx-auto mb-5 bg-white/95 backdrop-blur-xs border border-slate-200 shadow-sm rounded-xl px-4 py-2.5 space-y-2.5 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Kembali
            </button>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span className="text-xs font-mono font-semibold text-slate-700 hidden sm:inline">
              {invoice.invoiceNumber}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
            {!isVoided && invoice.status === 'Draft' && onSendInvoice && permissions.send_invoice && (
              <button
                type="button"
                onClick={() => setShowSendModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Kirim Invoice
              </button>
            )}

            {onReviseInvoice &&
              !isVoided &&
              invoice.status !== 'Draft' &&
              ((isPaid && permissions.revise_paid) ||
                (!isPaid && permissions.revise_invoiced)) && (
                <button
                  type="button"
                  onClick={() => setShowReviseModal(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  Revisi
                </button>
              )}

            {!isPaid && !isVoided && permissions.edit_po_draft && (
              <button
                type="button"
                onClick={() => onEdit(invoice)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}

            {permissions.create_po && (
              <button
                type="button"
                onClick={() => onDuplicate(invoice)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                Duplikat
              </button>
            )}

            {(permissions.edit_po_draft || permissions.create_po) && (
              <>
                <button
                  type="button"
                  onClick={handlePrintInvoice}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Invoice
                </button>

                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => {
                    setActionError(null);
                    setIsDownloading(true);
                    void downloadClientInvoicePDF(invoice, {
                      showGRN,
                      showSystemGeneratedNote: showSystemNote,
                    })
                      .catch(() => setActionError('Gagal membuat file PDF Invoice.'))
                      .finally(() => setIsDownloading(false));
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isDownloading ? 'Membuat PDF...' : 'Download PDF'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 2 Live Preview Toggles */}
        {(permissions.edit_po_draft || permissions.create_po) && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-[11px] font-semibold text-slate-500">
              Opsi Tampilan Cetak:
            </span>

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
          className="no-print max-w-[210mm] mx-auto mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between gap-3 print:hidden"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold text-red-800 hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {isVoided && (
        <div className="no-print max-w-[210mm] mx-auto mb-4 px-4 py-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-950 flex items-start gap-2.5 print:hidden">
          <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              {invoice.voidStatusLabel ||
                `VOID / DIREVISI - Diganti oleh ${invoice.replacedByInvoiceNumber || '-'}`}
            </p>
            <p className="mt-0.5">
              Dokumen ini merupakan arsip bukti invoice lama yang telah diganti. Tetap dapat dicetak
              atau diunduh sebagai PDF.
            </p>
          </div>
        </div>
      )}

      {/* Official Plain White A4 Client Invoice Document */}
      <div className="overflow-x-auto print:overflow-visible">
        <ClientInvoiceSheet
          invoice={invoice}
          showGRN={showGRN}
          showSystemNote={showSystemNote}
          sheetRef={containerRef}
        />
      </div>

      {invoice.revisions && invoice.revisions.length > 0 && (
        <div className="no-print max-w-[210mm] mx-auto mt-6 print:hidden">
          <RevisionHistoryTable
            revisions={invoice.revisions}
            title="Riwayat Revisi Invoice (Audit Log Permanen)"
          />
        </div>
      )}

      {showSendModal && onSendInvoice && (
        <SendClientInvoiceModal
          invoice={invoice}
          isSubmitting={isSendingInvoice}
          onCancel={() => setShowSendModal(false)}
          onConfirm={async (params) => {
            setIsSendingInvoice(true);
            try {
              await onSendInvoice(invoice.id, params);
              setShowSendModal(false);
            } finally {
              setIsSendingInvoice(false);
            }
          }}
        />
      )}

      {showReviseModal && onReviseInvoice && (
        <ReviseDocumentModal
          docType="client-invoice"
          invoice={invoice}
          currentActor={currentActor}
          isSubmitting={isRevising}
          onCancel={() => setShowReviseModal(false)}
          onConfirm={async (payload) => {
            setIsRevising(true);
            try {
              await onReviseInvoice(invoice, payload);
              setShowReviseModal(false);
            } finally {
              setIsRevising(false);
            }
          }}
        />
      )}
    </div>
  );
};
