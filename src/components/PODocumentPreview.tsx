import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, History, Pencil, Printer } from 'lucide-react';
import { AuditActor, PermissionsMap } from '../types/auth';
import {
  COMPANY_INFO,
  PO_NOTE_ITEMS,
  PO_PAYMENT_TERMS_LEFT,
  PO_PAYMENT_TERMS_RIGHT,
  POStatus,
  PurchaseOrder,
  VoidedInvoiceRecord,
} from '../types/po';
import { formatDocumentDate, formatIDR } from '../utils/format';
import { printHtmlInHiddenIframe } from '../utils/iframePrint';
import { ReviseDocumentModal, ReviseSubmitPayload } from './ReviseDocumentModal';
import { RevisionHistoryTable } from './RevisionHistoryTable';
import { VoidedInvoiceProofModal } from './VoidedInvoiceProofModal';

interface PODocumentPreviewProps {
  po: PurchaseOrder;
  permissions: PermissionsMap;
  currentActor: AuditActor;
  onBack: () => void;
  onEdit: (po: PurchaseOrder) => void;
  onDuplicate: (po: PurchaseOrder) => void;
  onStatusChange: (poId: string, status: POStatus) => Promise<void>;
  onRevisePO?: (po: PurchaseOrder, payload: ReviseSubmitPayload) => Promise<void>;
  isUpdatingStatus?: boolean;
  autoPrint?: boolean;
}

export const PODocumentPreview: React.FC<PODocumentPreviewProps> = ({
  po,
  permissions,
  currentActor,
  onBack,
  onEdit,
  onDuplicate,
  onStatusChange,
  onRevisePO,
  isUpdatingStatus = false,
  autoPrint = false,
}) => {
  const poContainerRef = useRef<HTMLDivElement | null>(null);
  const hasAutoPrintedRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReviseModal, setShowReviseModal] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [activeVoidRecord, setActiveVoidRecord] = useState<VoidedInvoiceRecord | null>(null);

  const safePoNumber = po.poNumber.trim().replace(/[/\\:*?"<>|]/g, '-') || '001-PO-KKB-2026';

  const handlePrintPO = () => {
    setActionError(null);
    const poElement =
      poContainerRef.current ?? document.querySelector<HTMLElement>('.po-container');
    if (!poElement) {
      setActionError('Elemen dokumen PO tidak ditemukan.');
      return;
    }

    printHtmlInHiddenIframe({
      title: `PO-KKB-${safePoNumber}`,
      bodyHtml: `<div class="${poElement.className}">${poElement.innerHTML}</div>`,
      extraCss: `
        @page {
          size: A4;
          margin: 0;
        }
        body {
          margin: 0;
          background: #ffffff;
          color: #000000;
        }
        .po-container {
          width: 794px;
          margin: 0 auto;
          box-shadow: none;
          border: none;
          box-sizing: border-box;
          background: #ffffff;
        }
        @media print {
          @page {
            size: A4;
            margin: 0;
          }
          body {
            margin: 0;
          }
          .po-container {
            width: 794px !important;
            margin: 0 auto !important;
            box-shadow: none !important;
            border: none !important;
          }
        }
        .po-data-table th {
          height: auto !important;
          padding: 8px 10px !important;
          vertical-align: middle !important;
          line-height: 1.3 !important;
        }
        .po-data-table td {
          height: auto !important;
          min-height: 0 !important;
          vertical-align: middle !important;
          padding: 8px 10px !important;
          line-height: 1.2 !important;
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
        handlePrintPO();
      }, 150);
      return () => window.clearTimeout(timer);
    }
  }, [autoPrint]);

  const isPaid = po.status === 'Paid';

  return (
    <div className="po-preview-wrapper min-h-screen bg-slate-100 pb-10 pt-4 px-4 sm:px-6 print:bg-white print:p-0">
      {/* Sticky Top Action Toolbar - Always visible on scroll, hidden when printing */}
      <div className="no-print sticky top-3 z-30 max-w-[210mm] mx-auto mb-5 bg-white/95 backdrop-blur-xs border border-slate-200 shadow-sm rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 print:hidden">
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
          <span className="text-xs font-mono text-slate-600 hidden sm:inline">
            {po.poNumber}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
          <div className="flex items-center gap-1.5 mr-1">
            <label htmlFor="po-preview-status" className="text-xs font-medium text-slate-600">
              Status:
            </label>
            <select
              id="po-preview-status"
              value={po.status}
              disabled={
                isPaid ||
                isUpdatingStatus ||
                (!permissions.edit_po_draft &&
                  !permissions.send_invoice &&
                  !permissions.mark_paid)
              }
              onChange={(e) => onStatusChange(po.id, e.target.value as POStatus)}
              className="text-xs font-medium bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer"
              title={isPaid ? 'PO berstatus Paid sudah terkunci' : 'Ubah status PO'}
            >
              <option value="Draft" disabled={!permissions.edit_po_draft}>
                DRAFT
              </option>
              <option value="Sent" disabled={!permissions.edit_po_draft}>
                TERKIRIM
              </option>
              <option value="Invoiced" disabled={!permissions.send_invoice}>
                SUDAH DITAGIH
              </option>
              <option value="Paid" disabled={!permissions.mark_paid}>
                LUNAS
              </option>
            </select>
          </div>

          {onRevisePO &&
            ((po.status === 'Invoiced' && permissions.revise_invoiced) ||
              (po.status === 'Paid' && permissions.revise_paid)) && (
              <button
                type="button"
                onClick={() => setShowReviseModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                Revisi
              </button>
            )}

          {!isPaid &&
            (po.status === 'Invoiced'
              ? permissions.send_invoice
              : permissions.edit_po_draft) && (
              <button
                type="button"
                onClick={() => onEdit(po)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}

          {permissions.create_po && (
            <button
              type="button"
              onClick={() => onDuplicate(po)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              Duplikat
            </button>
          )}

          {(permissions.edit_po_draft || permissions.create_po) && (
            <button
              type="button"
              onClick={handlePrintPO}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
          )}
        </div>
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

      {/* Official A4 Purchase Order Document */}
      <div className="overflow-x-auto print:overflow-visible">
        <div
          ref={poContainerRef}
          className="po-container font-[Arial,Helvetica,sans-serif] w-[210mm] min-h-[297mm] p-[12mm] mx-auto bg-white text-black box-border border border-[#cbd5e1] shadow-sm"
        >
          {/* 1. HEADER ATAS (Table 2 kolom, 1 baris, tanpa flex/absolute/negative margin) */}
          <table className="w-full border-collapse border-0 mb-4">
            <tbody>
              <tr>
                <td className="w-[55%] align-top text-left border-0 p-0">
                  <img
                    src="/assets/aistudio/ctribe_logo_trimmed.png"
                    alt="C.TRIBE"
                    className="w-[130px] h-auto block !m-0 !p-0 !mb-[2px]"
                  />
                  <div className="!m-0 !p-0 !mt-0 font-[Arial,Helvetica,sans-serif] text-black">
                    <div className="font-bold text-[11px] leading-[1.35] !m-0 !p-0">
                      {COMPANY_INFO.name}
                    </div>
                    <div className="text-[10px] leading-[1.35] !m-0 !p-0">
                      {COMPANY_INFO.addressLines[0]}
                      <br />
                      {COMPANY_INFO.addressLines[1]}
                      <br />
                      {COMPANY_INFO.addressLines[2]}
                    </div>
                  </div>
                </td>
                <td className="w-[45%] align-top text-right border-0 p-0">
                  <div className="font-[Arial,Helvetica,sans-serif] text-[18px] font-extrabold tracking-[0px] m-0 p-0 leading-none text-black uppercase whitespace-nowrap">
                    PURCHASE ORDER
                  </div>
                  <table className="po-data-table w-full border-[1.5px] border-black border-collapse mt-[6px]">
                    <tbody>
                      <tr>
                        <th className="bg-[#8FE388] font-bold text-center border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-[10px] text-black w-1/2">
                          P.O. NUMBER
                        </th>
                        <th className="bg-[#8FE388] font-bold text-center border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-[10px] text-black w-1/2">
                          DATE
                        </th>
                      </tr>
                      <tr>
                        <td className="bg-white text-center border border-black !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[11px] text-black">
                          {po.poNumber}
                        </td>
                        <td className="bg-white text-center border border-black !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[11px] text-black">
                          {formatDocumentDate(po.poDate)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          {/* 2. VENDOR BOX */}
          <table className="po-data-table w-full border-collapse border border-black mb-3.5">
            <thead>
              <tr className="bg-[#8ED973] text-black">
                <th
                  colSpan={2}
                  className="border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-left text-[12px] font-bold uppercase text-black"
                >
                  VENDOR
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-[#DCE6F1] text-black">
                <td className="w-[16%] border-0 !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12px] font-bold uppercase text-left text-black">
                  NAME
                </td>
                <td className="w-[84%] border-0 !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12px] font-medium text-left text-black">
                  {po.vendorName}
                </td>
              </tr>
              <tr className="bg-[#DCE6F1] text-black">
                <td className="w-[16%] border-0 !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12px] font-bold uppercase text-left text-black">
                  ADDRESS
                </td>
                <td className="w-[84%] border-0 !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12px] text-left text-black">
                  {po.vendorAddress}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 3. PROJECT INFO (teks biasa, bukan kotak) */}
          <div className="w-full mb-3.5 text-[12px] leading-[1.5] text-black space-y-1">
            <div className="grid grid-cols-12 gap-2">
              <span className="col-span-3 font-bold uppercase">PROJECT NAME</span>
              <span className="col-span-9">: {po.projectName}</span>
            </div>
            <div className="grid grid-cols-12 gap-2">
              <span className="col-span-3 font-bold uppercase">PROJECT NUMBER</span>
              <span className="col-span-9">: {po.projectNumber}</span>
            </div>
            <div className="grid grid-cols-12 gap-2">
              <span className="col-span-3 font-bold uppercase">DELIVERY DATE</span>
              <span className="col-span-9">: {formatDocumentDate(po.deliveryDate)}</span>
            </div>
          </div>

          {/* 4. TABEL ITEM */}
          <div className="w-full mb-3">
            <table className="po-data-table w-full border-collapse border border-black">
              <thead>
                <tr className="bg-[#8ED973] text-black">
                  <th className="border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-[12px] text-left font-bold uppercase w-[48%]">
                    PRODUCT DESCRIPTION
                  </th>
                  <th className="border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-[12px] text-center font-bold w-[12%]">
                    Quantity
                  </th>
                  <th className="border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-[12px] text-center font-bold w-[20%]">
                    Unit Price
                  </th>
                  <th className="border border-black !h-auto !py-[8px] !px-[10px] !align-middle !leading-[1.3] text-[12px] text-center font-bold w-[20%]">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="border border-black !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12.5px] text-black whitespace-pre-line">
                      {item.description}
                    </td>
                    <td className="border border-black !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12.5px] text-center text-black tabular-nums">
                      {formatIDR(item.quantity)}
                    </td>
                    <td className="border border-black !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12.5px] text-center text-black tabular-nums">
                      {formatIDR(item.unitPrice)}
                    </td>
                    <td className="border border-black !py-[8px] !px-[10px] !align-middle !leading-[1.2] text-[12.5px] text-center text-black tabular-nums">
                      {formatIDR(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total Amount (IDR) di bawah tabel, rata kanan, bold tanpa garis atas */}
            <div className="flex justify-end mt-2">
              <div className="text-[13px] font-bold text-black tabular-nums">
                Total Amount (IDR) : {formatIDR(po.totalAmount)}
              </div>
            </div>
          </div>

          {/* 5. NOTE BOX (kotak dengan border hitam tipis) */}
          <div className="w-full border border-black px-3 py-2.5 text-[9px] leading-[1.35] text-black mt-3.5">
            <p className="font-bold mb-1">Note :</p>
            <ul className="space-y-0.5 list-none pl-0 mb-2">
              {PO_NOTE_ITEMS.map((note, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="shrink-0">-</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>

            <p className="font-bold mb-1">Payment Terms :</p>
            <div className="grid grid-cols-2 gap-4">
              <ul className="space-y-0.5 list-none pl-0">
                {PO_PAYMENT_TERMS_LEFT.map((term, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="shrink-0">-</span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-0.5 list-none pl-0">
                {PO_PAYMENT_TERMS_RIGHT.map((term, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="shrink-0">-</span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 6. TANDA TANGAN (2 kolom sejajar di bawah Note Box) */}
          <div className="w-full grid grid-cols-2 gap-10 mt-5 text-[10.5px] text-black">
            <div>
              <p className="leading-snug">For and on behalf of</p>
              <p className="font-bold uppercase leading-snug">{COMPANY_INFO.nameUpper}</p>
              <p className="font-[Arial,Helvetica,sans-serif] italic text-[8pt] text-[#555555] text-left my-[12px] leading-snug">
                This is a computer-generated statement, no signature is required
              </p>
              <p className="font-bold">{COMPANY_INFO.signatoryName}</p>
              <p>{COMPANY_INFO.signatoryTitle}</p>
            </div>

            <div>
              <p className="leading-snug">Confirm and Accepted by :</p>
              <p className="leading-snug text-transparent select-none" aria-hidden="true">
                &nbsp;
              </p>
              <div className="h-[68px]" />
              <p className="font-bold">{po.vendorName}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Riwayat Revisi & Arsip Invoice VOID (no-print, di luar dokumen A4 PO) */}
      {((po.revisions && po.revisions.length > 0) ||
        (po.voidedInvoices && po.voidedInvoices.length > 0)) && (
        <div className="no-print max-w-[210mm] mx-auto mt-6 print:hidden">
          <RevisionHistoryTable
            revisions={po.revisions}
            voidedInvoices={po.voidedInvoices}
            onOpenVoidedInvoice={(rec) => setActiveVoidRecord(rec)}
          />
        </div>
      )}

      {showReviseModal && onRevisePO && (
        <ReviseDocumentModal
          docType="po"
          po={po}
          currentActor={currentActor}
          isSubmitting={isRevising}
          onCancel={() => setShowReviseModal(false)}
          onConfirm={async (payload) => {
            setIsRevising(true);
            try {
              await onRevisePO(po, payload);
              setShowReviseModal(false);
            } finally {
              setIsRevising(false);
            }
          }}
        />
      )}

      {activeVoidRecord && (
        <VoidedInvoiceProofModal
          po={po}
          record={activeVoidRecord}
          onClose={() => setActiveVoidRecord(null)}
        />
      )}
    </div>
  );
};
