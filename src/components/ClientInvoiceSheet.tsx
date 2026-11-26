import React from 'react';
import { ClientInvoice } from '../types/clientInvoice';
import {
  resolveClientInvoiceBreakdown,
  resolveClientInvoiceGrossNominal,
} from '../utils/clientInvoiceFormat';
import { formatDocumentDate, formatIDR } from '../utils/format';

interface ClientInvoiceSheetProps {
  invoice: ClientInvoice;
  showGRN: boolean;
  showSystemNote: boolean;
  sheetRef?: React.RefObject<HTMLDivElement | null>;
}

export const ClientInvoiceSheet: React.FC<ClientInvoiceSheetProps> = ({
  invoice,
  showGRN,
  showSystemNote,
  sheetRef,
}) => {
  const breakdown = resolveClientInvoiceBreakdown(invoice);
  const subtotal = breakdown.dpp;
  const ppnAmount = breakdown.ppnAmount;
  const grandTotal = resolveClientInvoiceGrossNominal(invoice) || subtotal + ppnAmount;

  // Shortened slightly (-40px) so Payment to + TTD sits lower near footer while keeping 1 strict A4 page
  const voidRowOffset = invoice.isVoided ? 22 : 0;
  const fillerHeightPx = Math.max(
    70,
    360 - voidRowOffset - (invoice.items.length - 1) * 26
  );

  return (
    <div
      ref={sheetRef}
      className="invoice-print-area relative w-[210mm] min-h-[296mm] h-[296mm] mx-auto bg-white text-black p-[20px] box-border shadow-md font-[Calibri,Arial,Helvetica,sans-serif] text-[11pt] leading-[1.35] flex flex-col justify-between"
    >
      <div>
        {/* 1. HEADER: Logo absolute kiri, Teks PT + alamat rata tengah terhadap lebar penuh kertas */}
        <div className="relative w-full mb-[8px]">
          <img
            src="/assets/aistudio/ctribe_logo_trimmed.png"
            alt="C.TRIBE"
            className="w-[108px] h-auto block !m-0 !p-0 absolute left-0 top-1/2 -translate-y-1/2"
          />

          <div className="w-full text-center text-black pl-0 mx-auto">
            <div className="text-[11pt] font-bold leading-[1.35] text-center">
              PT. Kreatif Kebanggaan Bangsa
            </div>
            <div className="pt-[1pt] text-[9px] text-[#555] leading-[1.3] text-center">
              Kantor Taman A9 Unit A2 Lt.5 Kawasan Mega Kuningan
            </div>
            <div className="text-[9px] text-[#555] leading-[1.3] text-center">
              Jl. DR. Ide Anak Agung Lot RT. 8 RW. 3, Kuningan Timur, Setiabudi Jakarta Selatan
            </div>
          </div>
        </div>

        {/* 2. INFO ATAS: 2 kolom, tanpa kotak, tanpa background, 11pt */}
        <div className="grid grid-cols-12 gap-4 mb-[8px] text-[11pt] leading-[1.25] text-black">
          {/* Kolom Kiri */}
          <div className="col-span-7">
            <table className="w-full border-collapse border-0 text-[11pt] leading-[1.25]">
              <tbody>
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap w-[125px] border-0">
                    Project Desc
                  </td>
                  <td className="align-top py-[1px] pr-2 w-[10px] border-0">:</td>
                  <td className="align-top py-[1px] border-0">
                    {invoice.projectName || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                    Brand Name
                  </td>
                  <td className="align-top py-[1px] pr-2 border-0">:</td>
                  <td className="align-top py-[1px] border-0">
                    {invoice.brandName || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                    Billed to
                  </td>
                  <td className="align-top py-[1px] pr-2 border-0">:</td>
                  <td className="align-top py-[1px] border-0">
                    {invoice.clientName || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                    Billing Address
                  </td>
                  <td className="align-top py-[1px] pr-2 border-0">:</td>
                  <td className="align-top py-[1px] border-0 whitespace-pre-line break-words">
                    {invoice.billingAddress || '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Kolom Kanan */}
          <div className="col-span-5">
            <table className="w-full border-collapse border-0 text-[11pt] leading-[1.25]">
              <tbody>
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap w-[115px] border-0">
                    Invoice Number
                  </td>
                  <td className="align-top py-[1px] pr-2 w-[10px] border-0">:</td>
                  <td className="align-top py-[1px] border-0">
                    {invoice.invoiceNumber || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                    Invoice Date
                  </td>
                  <td className="align-top py-[1px] pr-2 border-0">:</td>
                  <td className="align-top py-[1px] border-0">
                    {formatDocumentDate(invoice.invoiceDate)}
                  </td>
                </tr>
                {invoice.dueDate && (
                  <tr className="no-print print:hidden invoice-due-date-row">
                    <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                      Due Date
                    </td>
                    <td className="align-top py-[1px] pr-2 border-0">:</td>
                    <td className="align-top py-[1px] border-0">
                      {formatDocumentDate(invoice.dueDate)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                    PO Number
                  </td>
                  <td className="align-top py-[1px] pr-2 border-0">:</td>
                  <td className="align-top py-[1px] border-0">
                    {invoice.poNumber || '-'}
                  </td>
                </tr>
                {showGRN && (
                  <tr>
                    <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0">
                      GRN
                    </td>
                    <td className="align-top py-[1px] pr-2 border-0">:</td>
                    <td className="align-top py-[1px] border-0">
                      {invoice.grnNumber || '-'}
                    </td>
                  </tr>
                )}
                {invoice.isVoided && (
                  <tr>
                    <td className="align-top py-[1px] pr-2 whitespace-nowrap border-0 font-bold text-red-700">
                      Status
                    </td>
                    <td className="align-top py-[1px] pr-2 border-0 font-bold text-red-700">
                      :
                    </td>
                    <td className="align-top py-[1px] border-0 font-bold text-red-700 break-words">
                      {invoice.voidStatusLabel ||
                        `VOID / DIREVISI - Diganti oleh ${invoice.replacedByInvoiceNumber || '-'}`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. TABEL ITEM: kotak luar + garis bawah header + garis vertikal kolom + garis atas Subtotal & bawah Grand Total (isi item plong tanpa garis horizontal) */}
        <div className="pt-[12px]">
          <table className="w-full table-fixed border-collapse border border-black text-[11pt] text-black">
            <thead>
              <tr className="bg-white">
                <th className="border border-black py-[4px] px-[6px] text-center font-bold bg-white w-[5%]">
                  No
                </th>
                <th className="border border-black py-[4px] px-[6px] text-center font-bold bg-white w-[55%]">
                  Description
                </th>
                <th className="border border-black py-[4px] px-[6px] text-center font-bold bg-white w-[8%]">
                  Qty
                </th>
                <th className="border border-black py-[4px] px-[6px] text-center font-bold bg-white w-[16%]">
                  Fee
                </th>
                <th className="border border-black py-[4px] px-[6px] text-center font-bold bg-white w-[16%]">
                  Total Fee
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-center align-top tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-left align-top whitespace-pre-line break-words">
                    {item.description}
                  </td>
                  <td className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-center align-top tabular-nums">
                    {formatIDR(item.quantity)}
                  </td>
                  <td className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-right align-top tabular-nums">
                    {formatIDR(item.unitPrice)}
                  </td>
                  <td className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-right align-top tabular-nums">
                    {formatIDR(item.amount)}
                  </td>
                </tr>
              ))}

              {/* Baris kosong tinggi plong (hanya garis kolom vertikal sampai ke atas Subtotal) */}
              <tr>
                <td
                  style={{ height: `${fillerHeightPx}px` }}
                  className="border-x border-t-0 border-b-0 border-black p-0"
                >
                  &nbsp;
                </td>
                <td className="border-x border-t-0 border-b-0 border-black p-0">&nbsp;</td>
                <td className="border-x border-t-0 border-b-0 border-black p-0">&nbsp;</td>
                <td className="border-x border-t-0 border-b-0 border-black p-0">&nbsp;</td>
                <td className="border-x border-t-0 border-b-0 border-black p-0">&nbsp;</td>
              </tr>

              {/* 3 Summary Rows: garis atas Subtotal & garis bawah Grand Total saja, tanpa garis pemisah antar Subtotal/PPN/Grand Total */}
              <tr>
                <td
                  colSpan={4}
                  className="border-x border-t border-b-0 border-black py-[4px] px-[6px] text-left"
                >
                  Subtotal
                </td>
                <td className="border-x border-t border-b-0 border-black py-[4px] px-[6px] text-right tabular-nums">
                  {formatIDR(subtotal)}
                </td>
              </tr>

              {breakdown.includePPN && (
                <tr>
                  <td
                    colSpan={4}
                    className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-left"
                  >
                    PPN {breakdown.ppnPercent}%
                  </td>
                  <td className="border-x border-t-0 border-b-0 border-black py-[4px] px-[6px] text-right tabular-nums">
                    {formatIDR(ppnAmount)}
                  </td>
                </tr>
              )}

              <tr>
                <td
                  colSpan={4}
                  className="border-x border-t-0 border-b border-black py-[4px] px-[6px] text-left font-bold"
                >
                  Grand Total
                </td>
                <td className="border-x border-t-0 border-b border-black py-[4px] px-[6px] text-right font-bold tabular-nums">
                  {formatIDR(grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      {/* 4. PAYMENT & TTD: turun lebih ke bawah (min 32px dari garis Grand Total, dekat ke footer) */}
      <div className="flex justify-between items-start gap-6 mt-[32px] mb-[12px] text-[11pt] text-black">
        {/* Kiri bawah: Payment to (lebar 45%) */}
        <div className="w-[45%] shrink-0 text-left">
          <p className="!text-[10pt] !font-bold !leading-[1.4] mb-1.5">
            Payment to:
          </p>
          <div className="!text-[9pt] !font-normal !leading-[1.4]">
            <p className="!text-[9pt] !font-normal !leading-[1.4] whitespace-nowrap">
              Bank Mandiri
            </p>
            <p className="!text-[9pt] !font-normal !leading-[1.4] whitespace-nowrap">
              PT Kreatif Kebanggaan Bangsa
            </p>
            <p className="!text-[9pt] !font-normal !leading-[1.4] whitespace-nowrap">
              Acc No : 126 001 0057 890
            </p>
            <p className="!text-[9pt] !font-normal !leading-[1.4] whitespace-nowrap">
              KCP Jakarta Gandaria
            </p>
          </div>
        </div>

        {/* Kanan bawah: TTD */}
        <div className="flex-1 text-right text-[11pt] leading-[1.45]">
          <p className="font-bold">PT Kreatif Kebanggaan Bangsa</p>
          <div className="h-[80px]" />
          {showSystemNote && (
            <p className="font-normal italic text-[11pt] mb-1">
              * This invoice is generated by system, no signature required
            </p>
          )}
          <p className="font-bold">Adhitya Adji Dharma</p>
          <p className="font-bold">Direktur</p>
        </div>
      </div>

      {/* 5. FOOTER (nempel di kiri bawah halaman, background putih transparan) */}
      <div className="w-[220px] text-left shrink-0">
        <img
          src="/assets/aistudio/ctribe_badge_transparent.png"
          alt="Creative Tribe"
          className="w-[56px] h-auto block !m-0 !p-0 mb-2.5 bg-transparent"
        />
        <div className="pt-[1pt] text-[8pt] font-bold leading-[1.35] text-black tracking-[0.01em]">
          <p className="mb-2 text-black whitespace-nowrap">
            E. CONTACT@CREATIVETRIBEJKT.COM
          </p>
          <p className="text-black whitespace-nowrap">
            TAMAN KANTOR A9 UNIT A2 LANTAI 5
          </p>
          <p className="mb-2 text-black whitespace-nowrap">
            KAWASAN MEGA KUNINGAN
          </p>
          <p className="text-[#30E62D] whitespace-nowrap">
            WWW.CREATIVETRIBEJKT.COM
          </p>
        </div>
      </div>
    </div>
  );
};
