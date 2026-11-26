import { jsPDF } from 'jspdf';
import { ClientInvoice } from '../types/clientInvoice';
import {
  resolveClientInvoiceBreakdown,
  resolveClientInvoiceGrossNominal,
} from './clientInvoiceFormat';
import { formatDocumentDate, formatIDR } from './format';

async function loadImageAsDataUrl(
  src: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 260;
          canvas.height = img.naturalHeight || 80;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          resolve({
            dataUrl: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  } catch {
    return null;
  }
}

export async function downloadClientInvoicePDF(
  invoice: ClientInvoice,
  overrides?: { showGRN?: boolean; showSystemGeneratedNote?: boolean }
): Promise<void> {
  const showGRN =
    overrides?.showGRN !== undefined ? overrides.showGRN : Boolean(invoice.showGRN);
  const showSystemNote =
    overrides?.showSystemGeneratedNote !== undefined
      ? overrides.showSystemGeneratedNote
      : invoice.showSystemGeneratedNote ?? true;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const marginX = 5.5; // ~20px padding
  const contentWidth = pageWidth - marginX * 2; // 199mm
  let y = 5.5;

  // 1. HEADER: Logo kiri, Teks PT + alamat center terhadap lebar penuh kertas
  const [logo, footerLogo] = await Promise.all([
    loadImageAsDataUrl('/assets/aistudio/ctribe_logo_trimmed.png'),
    loadImageAsDataUrl('/assets/aistudio/ctribe_badge_transparent.png'),
  ]);
  const headerCenterX = pageWidth / 2;

  const logoW = 28;
  const logoH =
    logo && logo.width > 0 && logo.height > 0
      ? (logo.height / logo.width) * logoW
      : 8.6;
  const textBlockH = 12.5;
  const headerH_block = Math.max(logoH, textBlockH);

  if (logo && logo.width > 0 && logo.height > 0) {
    const logoY = y + (headerH_block - logoH) / 2;
    doc.addImage(logo.dataUrl, 'PNG', marginX, logoY, logoW, logoH);
  }

  const textTopY = y + (headerH_block - textBlockH) / 2 + 3.2;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('PT. Kreatif Kebanggaan Bangsa', headerCenterX, textTopY, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(85, 85, 85);
  doc.text(
    'Kantor Taman A9 Unit A2 Lt.5 Kawasan Mega Kuningan',
    headerCenterX,
    textTopY + 4.35,
    { align: 'center', maxWidth: contentWidth }
  );
  doc.text(
    'Jl. DR. Ide Anak Agung Lot RT. 8 RW. 3, Kuningan Timur, Setiabudi Jakarta Selatan',
    headerCenterX,
    textTopY + 7.55,
    { align: 'center', maxWidth: contentWidth }
  );
  doc.setTextColor(0, 0, 0);

  y += headerH_block + 2.8;

  // 2. INFO ATAS: 2 columns, 11pt, no boxes, no background
  const leftLabelX = marginX;
  const leftColonX = marginX + 31;
  const leftValX = marginX + 34;
  const leftValMaxW = 78;

  const rightLabelX = marginX + 118;
  const rightColonX = marginX + 149;
  const rightValX = marginX + 152;
  const rightValMaxW = 47;

  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);

  let leftY = y;
  const leftRows: Array<[string, string]> = [
    ['Project Desc', invoice.projectName || '-'],
    ['Brand Name', invoice.brandName || '-'],
    ['Billed to', invoice.clientName || '-'],
    ['Billing Address', invoice.billingAddress || '-'],
  ];

  for (const [label, val] of leftRows) {
    doc.setFont('helvetica', 'normal');
    doc.text(label, leftLabelX, leftY);
    doc.text(':', leftColonX, leftY);
    const wrapped = doc.splitTextToSize(val, leftValMaxW);
    doc.text(wrapped, leftValX, leftY);
    leftY += Math.max(4.2, wrapped.length * 4.0);
  }

  let rightY = y;
  const rightRows: Array<[string, string]> = [
    ['Invoice Number', invoice.invoiceNumber || '-'],
    ['Invoice Date', formatDocumentDate(invoice.invoiceDate)],
  ];
  rightRows.push(['PO Number', invoice.poNumber || '-']);
  if (showGRN) {
    rightRows.push(['GRN', invoice.grnNumber || '-']);
  }
  if (invoice.isVoided) {
    rightRows.push([
      'Status',
      invoice.voidStatusLabel ||
        `VOID / DIREVISI - Diganti oleh ${invoice.replacedByInvoiceNumber || '-'}`,
    ]);
  }

  for (const [label, val] of rightRows) {
    const isVoidRow = label === 'Status';
    doc.setFont('helvetica', isVoidRow ? 'bold' : 'normal');
    if (isVoidRow) {
      doc.setTextColor(185, 28, 28);
    } else {
      doc.setTextColor(0, 0, 0);
    }
    doc.text(label, rightLabelX, rightY);
    doc.text(':', rightColonX, rightY);
    const wrapped = doc.splitTextToSize(val, rightValMaxW);
    doc.text(wrapped, rightValX, rightY);
    rightY += Math.max(4.2, wrapped.length * 4.0);
  }
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');

  y = Math.max(leftY, rightY) + 4.7; // +3.2mm (~12px) extra spacing above table

  // 3. TABEL ITEM: grid penuh 1px solid black (No | Description | Qty | Fee | Total Fee + garis horizontal antar baris)
  const colWidths = [10, 109.4, 15.9, 31.85, 31.85]; // sum = 199mm
  const headers = ['No', 'Description', 'Qty', 'Fee', 'Total Fee'];
  const headerH = 6.5;
  const tableStartY = y;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.28);

  let curX = marginX;
  for (let i = 0; i < headers.length; i += 1) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(headers[i], curX + colWidths[i] / 2, y + 4.5, { align: 'center' });
    curX += colWidths[i];
  }
  y += headerH;
  doc.line(marginX, y, marginX + contentWidth, y);

  const itemAreaStartY = y;
  let itemsUsedHeight = 0;

  invoice.items.forEach((item, idx) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const descLines = doc.splitTextToSize(item.description || '-', colWidths[1] - 3.5);
    const rowH = Math.max(5.8, descLines.length * 4.6 + 2);

    doc.text(String(idx + 1), marginX + colWidths[0] / 2, y + 4.3, {
      align: 'center',
    });
    doc.text(descLines, marginX + colWidths[0] + 1.6, y + 4.3);
    doc.text(
      formatIDR(item.quantity),
      marginX + colWidths[0] + colWidths[1] + colWidths[2] / 2,
      y + 4.3,
      { align: 'center' }
    );
    doc.text(
      formatIDR(item.unitPrice),
      marginX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 1.6,
      y + 4.3,
      { align: 'right' }
    );
    doc.text(formatIDR(item.amount), marginX + contentWidth - 1.6, y + 4.3, {
      align: 'right',
    });

    y += rowH;
    itemsUsedHeight += rowH;
  });

  const breakdown = resolveClientInvoiceBreakdown(invoice);
  const subtotal = breakdown.dpp;
  const ppnAmount = breakdown.ppnAmount;
  const grandTotal = resolveClientInvoiceGrossNominal(invoice) || subtotal + ppnAmount;

  const summaryRows: Array<{ label: string; value: number; bold: boolean }> = [
    { label: 'Subtotal', value: subtotal, bold: false },
  ];
  if (breakdown.includePPN) {
    summaryRows.push({
      label: `PPN ${breakdown.ppnPercent}%`,
      value: ppnAmount,
      bold: false,
    });
  }
  summaryRows.push({ label: 'Grand Total', value: grandTotal, bold: true });

  const sumRowH = 6.2;
  const summaryTotalH = summaryRows.length * sumRowH;
  const badgeEstH =
    footerLogo && footerLogo.width > 0 && footerLogo.height > 0
      ? (footerLogo.height / footerLogo.width) * 18
      : 17.4;
  // Reserve space below table: ~8.5mm (32px) top gap + Payment/TTD (~37mm) + ~5mm gap + Footer (~badgeEstH + 22mm)
  const bottomBlocksH = 8.5 + 37 + 5 + badgeEstH + 22;
  const maxItemBodyH = Math.max(24, 287 - itemAreaStartY - summaryTotalH - bottomBlocksH);
  const finalItemBodyH = Math.max(maxItemBodyH, itemsUsedHeight + 4);
  const itemAreaEndY = itemAreaStartY + finalItemBodyH;

  // Vertical dividers across Header + Items + Empty Spacer down to Subtotal
  let colX = marginX;
  for (let i = 0; i < colWidths.length - 1; i += 1) {
    colX += colWidths[i];
    if (i < colWidths.length - 2) {
      doc.line(colX, tableStartY, colX, itemAreaEndY);
    }
  }

  y = itemAreaEndY;
  doc.line(marginX, y, marginX + contentWidth, y);

  // Summary Rows (garis atas Subtotal & garis bawah Grand Total saja)
  summaryRows.forEach((row) => {
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(row.label, marginX + 1.6, y + 4.3);
    doc.text(formatIDR(row.value), marginX + contentWidth - 1.6, y + 4.3, {
      align: 'right',
    });

    y += sumRowH;
  });

  // Continuous vertical divider between Fee and Total Fee from top of table down to Grand Total bottom
  const totalFeeDividerX =
    marginX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  doc.line(totalFeeDividerX, tableStartY, totalFeeDividerX, y);

  // Outer table rectangle
  doc.rect(marginX, tableStartY, contentWidth, y - tableStartY, 'S');

  // 4. PAYMENT & TTD: ~32px (8.5mm) top spacing below Grand Total border, closer to bottom footer
  y += 8.5;
  const signYStart = y;

  // Bottom Left: Payment to
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Payment to:', marginX, y);
  y += 5.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Bank Mandiri', marginX, y);
  y += 4.3;
  doc.text('PT Kreatif Kebanggaan Bangsa', marginX, y);
  y += 4.3;
  doc.text('Acc No : 126 001 0057 890', marginX, y);
  y += 4.3;
  doc.text('KCP Jakarta Gandaria', marginX, y);

  // Bottom Right: Signature (11pt)
  let sigY = signYStart;
  const rightEdgeX = marginX + contentWidth;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('PT Kreatif Kebanggaan Bangsa', rightEdgeX, sigY, { align: 'right' });

  sigY += 21.5; // ~80px space
  if (showSystemNote) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.text(
      '* This invoice is generated by system, no signature required',
      rightEdgeX,
      sigY,
      { align: 'right' }
    );
    sigY += 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Adhitya Adji Dharma', rightEdgeX, sigY, { align: 'right' });
  sigY += 5;
  doc.text('Direktur', rightEdgeX, sigY, { align: 'right' });

  // 5. FOOTER (nempel di kiri bawah halaman 1)
  const badgeW = 15; // ~56px at 96 DPI, ~17% smaller
  const badgeH =
    footerLogo && footerLogo.width > 0 && footerLogo.height > 0
      ? (footerLogo.height / footerLogo.width) * badgeW
      : 14.5;
  const totalFooterH = badgeH + 22;
  let footerY = Math.max(Math.max(y, sigY) + 5, 297 - 6 - totalFooterH);
  if (footerY + totalFooterH > 291) {
    footerY = 291 - totalFooterH;
  }

  if (footerLogo && footerLogo.width > 0 && footerLogo.height > 0) {
    doc.addImage(footerLogo.dataUrl, 'PNG', marginX, footerY, badgeW, badgeH);
  }

  let textY = footerY + badgeH + 4.85;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('E. CONTACT@CREATIVETRIBEJKT.COM', marginX, textY);
  textY += 5.5;
  doc.text('TAMAN KANTOR A9 UNIT A2 LANTAI 5', marginX, textY);
  textY += 3.6;
  doc.text('KAWASAN MEGA KUNINGAN', marginX, textY);
  textY += 5.5;
  doc.setTextColor(48, 230, 45);
  doc.text('WWW.CREATIVETRIBEJKT.COM', marginX, textY);
  doc.setTextColor(0, 0, 0);

  const safeInvNumber =
    invoice.invoiceNumber.trim().replace(/[/\\:*?"<>|]/g, '-') || 'INV-KKB-071-2026';
  doc.save(`INVOICE-${safeInvNumber}.pdf`);
}
