import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import {
  BOSS_REPORT_COLOR_META,
  BossReportColorStatus,
} from '../types/bossReport';
import { COMPANY_INFO } from '../types/po';
import {
  BossReportComputedRow,
  BossReportViewModel,
  CashInSourceKind,
  computeBalanceAccountDetails,
} from './bossReportCalc';
import { formatDocumentDate, formatIDR, getTodayISODate } from './format';
import { printHtmlInNewTab } from './iframePrint';

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getColorLabel(color: BossReportColorStatus): string {
  const found = BOSS_REPORT_COLOR_META.find((c) => c.value === color);
  return found ? found.label : 'Projection';
}

function getCashInSourceLabel(source?: CashInSourceKind): string {
  if (source === 'investmentDisbursement') return 'Pencairan Pinjaman Investment';
  if (source === 'manual') return 'Manual';
  return 'Invoice';
}

function formatSignedIDR(amount: number): string {
  const abs = formatIDR(Math.abs(amount));
  return amount < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

function getRowDisplayNameWithHistory(row: BossReportComputedRow): string {
  const tags: string[] = [];
  if (row.rescheduledOutLabel) {
    tags.push(`${row.rescheduledOutLabel} — Tidak dihitung di bulan ini`);
  }
  if (row.rescheduleLabel) {
    tags.push(row.rescheduleLabel);
  }
  return tags.length > 0 ? `${row.name} (${tags.join(' | ')})` : row.name;
}

export function exportBossReportToExcel(vm: BossReportViewModel): void {
  const rows: Array<Array<string | number>> = [];

  rows.push([
    `${COMPANY_INFO.nameUpper} — PROJECTION LAPORAN BOS — ${vm.monthFullLabel.toUpperCase()}`,
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  rows.push(['RINGKASAN PROJECTION BULANAN (6 KOLOM TERPISAH)', '', '', '', '', '', '']);
  rows.push([
    'Saldo Awal (Rp)',
    'Cash In (Rp)',
    'Cash Out Opex (Rp)',
    'Cash Out Investment (Rp)',
    'Cash Out Project Cost (Rp)',
    'Ending Balance (Rp)',
  ]);
  rows.push([
    vm.saldoAwal,
    vm.totalCashIn,
    vm.totalOperasionalCost,
    vm.totalInvestmentCost,
    vm.totalProjectCost,
    vm.endingBalance,
  ]);
  rows.push(['', '', '', '', '', '', '']);

  rows.push([`Saldo Rekening Per ${formatDocumentDate(vm.asOfDate)}`, '', '', '', '', '', '']);
  rows.push([
    'Nama Rekening',
    'Saldo Awal (Rp)',
    'Cash In (Rp)',
    'Cash Out Opex (Rp)',
    'Cash Out Investment (Rp)',
    'Cash Out Project Cost (Rp)',
    'Ending Balance (Rp)',
  ]);

  for (const acc of vm.accountDetails) {
    rows.push([
      acc.isPrimary ? `${acc.name} (Rekening Utama)` : acc.name,
      acc.openingBalance,
      acc.projectedCashIn,
      acc.cashOutOperasional,
      acc.cashOutInvestment,
      acc.cashOutProjectCost,
      acc.endingBalance,
    ]);
  }
  rows.push([
    'Total Seluruh Rekening',
    vm.saldoAwal,
    vm.totalCashIn,
    vm.totalOperasionalCost,
    vm.totalInvestmentCost,
    vm.totalProjectCost,
    vm.endingBalance,
  ]);
  rows.push(['', '', '', '', '', '', '']);

  rows.push([
    `Cash In ${vm.monthNameOnly} (${vm.monthFullLabel})`,
    'Sumber',
    'Cash In Projection (Rp)',
    'Saldo (Rp)',
    'Status Warna',
  ]);
  rows.push([
    `SALDO AWAL (Sisa bulan lalu - ${vm.previousMonthLabel})`,
    '-',
    '-',
    vm.saldoAwal,
    vm.saldoAwalSource === 'manual' ? 'Input Manual' : 'Otomatis Bulan Lalu',
  ]);
  if (vm.cashInRows.length === 0) {
    rows.push(['(Belum ada item Cash In)', '-', 0, '-', '-']);
  } else {
    for (const row of vm.cashInRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        getCashInSourceLabel(row.cashInSource),
        row.projectedAmount,
        '-',
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['TOTAL CASH IN', '', vm.totalCashIn, '-', '']);
  rows.push(['Account Balance', '', '-', vm.accountBalance, 'Saldo Awal + TOTAL CASH IN']);
  rows.push(['', '', '', '', '']);

  rows.push([
    `Cash Out ${vm.monthNameOnly} (${vm.monthFullLabel})`,
    'Nominal Projection (Rp)',
    'Status Warna',
  ]);
  rows.push(['A. OPERASIONAL', '', '']);
  if (vm.operasionalRows.length === 0) {
    rows.push(['(Belum ada item Operasional)', 0, '-']);
  } else {
    for (const row of vm.operasionalRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        row.projectedAmount,
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['Total Operasional Cost', vm.totalOperasionalCost, '']);

  rows.push(['B. INVESTMENT', '', '']);
  if (vm.investmentRows.length === 0) {
    rows.push(['(Belum ada item Investment)', 0, '-']);
  } else {
    for (const row of vm.investmentRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        row.projectedAmount,
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['Total Investment Cost', vm.totalInvestmentCost, '']);
  if (vm.hiddenNotDuePrincipalCount > 0 && !vm.hasVisiblePrincipalRows) {
    rows.push(['Pokok belum jatuh tempo di bulan ini, hanya Bunga yang ditagihkan', '', '']);
  }

  rows.push(['C. PROJECT COST', '', '']);
  if (vm.projectCostRows.length === 0) {
    rows.push(['(Belum ada item Project Cost)', 0, '-']);
  } else {
    for (const row of vm.projectCostRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        row.projectedAmount,
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['Total Project Cost', vm.totalProjectCost, '']);
  rows.push([
    'Total Cost',
    vm.totalCost,
    'Operasional + Investment + Project Cost',
  ]);
  rows.push(['', '', '']);

  rows.push([
    `Ending Balance Projected Per ${vm.monthFullLabel}`,
    vm.endingBalance,
    vm.isMinus ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 48 },
    { wch: 28 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 26 },
  ];

  // Apply Indonesian currency display format to numeric cells in columns A..G
  for (let r = 0; r < rows.length; r += 1) {
    for (const c of [0, 1, 2, 3, 4, 5, 6]) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef];
      if (cell && typeof cell.v === 'number') {
        cell.z = '#,##0';
      }
    }
  }

  const fileSuffix =
    vm.isRange && vm.startMonthKey && vm.endMonthKey
      ? `${vm.startMonthKey}_sd_${vm.endMonthKey}`
      : vm.monthKey;
  const sheetSuffix =
    vm.isRange && vm.startMonthKey && vm.endMonthKey
      ? `${vm.startMonthKey}_${vm.endMonthKey}`
      : vm.monthKey;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Laporan ${sheetSuffix}`.slice(0, 31));
  XLSX.writeFile(wb, `Laporan-Bos-Cashflow-${fileSuffix}.xlsx`);
}

function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  const clean = String(text || '-');
  if (doc.getTextWidth(clean) <= maxWidth) return clean;
  let trimmed = clean;
  while (trimmed.length > 1 && doc.getTextWidth(`${trimmed}...`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function getPdfRowFill(color: BossReportColorStatus): readonly [number, number, number] {
  switch (color) {
    case 'red':
      return [241, 245, 249];
    case 'green':
      return [220, 252, 231];
    default:
      return [255, 255, 255];
  }
}

function getPdfStatusTextColor(color: BossReportColorStatus): readonly [number, number, number] {
  switch (color) {
    case 'red':
      return [100, 116, 139];
    case 'green':
      return [21, 128, 61];
    default:
      return [71, 85, 105];
  }
}

export function exportBossReportToPDF(vm: BossReportViewModel): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210
  const pageHeight = doc.internal.pageSize.getHeight(); // 297
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2; // 186
  const colNameW = 104;
  const colProjW = 40;
  const colStatusW = contentWidth - colNameW - colProjW; // 42
  let y = 13;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 14) {
      doc.addPage();
      y = 13;
    }
  };

  const drawSectionBar = (
    title: string,
    col2: string,
    col3: string,
    bg: readonly [number, number, number]
  ) => {
    ensureSpace(8);
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.rect(marginX, y, contentWidth, 6.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(fitText(doc, title, colNameW - 3), marginX + 2.5, y + 4.6);
    if (col2) {
      doc.text(col2, marginX + colNameW + colProjW - 2, y + 4.6, { align: 'right' });
    }
    if (col3) {
      doc.text(col3, marginX + colNameW + colProjW + 2.5, y + 4.6);
    }
    y += 6.8;
  };

  const drawItemRow = (row: BossReportComputedRow) => {
    const rowH = 6;
    ensureSpace(rowH);
    const fill = getPdfRowFill(row.color);
    const stColor = getPdfStatusTextColor(row.color);

    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(marginX, y, contentWidth, rowH, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, y + rowH, marginX + contentWidth, y + rowH);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      fitText(doc, getRowDisplayNameWithHistory(row), colNameW - 4),
      marginX + 2.5,
      y + 4.2
    );

    doc.setFont('helvetica', 'bold');
    doc.text(
      formatSignedIDR(row.projectedAmount),
      marginX + colNameW + colProjW - 2,
      y + 4.2,
      { align: 'right' }
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(stColor[0], stColor[1], stColor[2]);
    doc.text(
      fitText(doc, getColorLabel(row.color), colStatusW - 3),
      marginX + colNameW + colProjW + 2.5,
      y + 4.2
    );
    y += rowH;
  };

  const drawSubtotalRow = (
    label: string,
    projectedAmt: number,
    options?: {
      bg?: readonly [number, number, number];
      textColor?: readonly [number, number, number];
      height?: number;
      fontSize?: number;
      note?: string;
    }
  ) => {
    const h = options?.height ?? 6.8;
    const bg = options?.bg ?? ([241, 245, 249] as const);
    const tc = options?.textColor ?? ([15, 23, 42] as const);
    const fs = options?.fontSize ?? 8;

    ensureSpace(h);
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.rect(marginX, y, contentWidth, h, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(marginX, y + h, marginX + contentWidth, y + h);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fs);
    doc.setTextColor(tc[0], tc[1], tc[2]);
    doc.text(fitText(doc, label, colNameW - 3), marginX + 2.5, y + h * 0.66);
    doc.text(formatSignedIDR(projectedAmt), marginX + colNameW + colProjW - 2, y + h * 0.66, {
      align: 'right',
    });

    if (options?.note) {
      doc.setFontSize(7.2);
      doc.text(
        fitText(doc, options.note, colStatusW - 3),
        marginX + colNameW + colProjW + 2.5,
        y + h * 0.66
      );
    }
    y += h;
  };

  // Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(COMPANY_INFO.nameUpper, marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Dicetak: ${formatDocumentDate(getTodayISODate())}`, pageWidth - marginX, y, {
    align: 'right',
  });
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`PROJECTION — ${vm.monthFullLabel.toUpperCase()}`, marginX, y);
  y += 4.5;

  // Ringkasan 6 Kolom Terpisah (Saldo Awal | Cash In | Cash Out Opex | Cash Out Investment | Cash Out Project Cost | Ending Balance)
  const summaryCols: Array<{
    label: string;
    value: number;
    color: readonly [number, number, number];
  }> = [
    { label: 'Saldo Awal', value: vm.saldoAwal, color: [30, 64, 175] },
    { label: 'Cash In', value: vm.totalCashIn, color: [6, 95, 70] },
    { label: 'Cash Out Opex', value: vm.totalOperasionalCost, color: [15, 23, 42] },
    { label: 'Cash Out Invest.', value: vm.totalInvestmentCost, color: [15, 23, 42] },
    { label: 'Cash Out Project', value: vm.totalProjectCost, color: [15, 23, 42] },
    {
      label: 'Ending Balance',
      value: vm.endingBalance,
      color: vm.isMinus ? [185, 28, 28] : [21, 128, 61],
    },
  ];
  const sColW = contentWidth / 6; // 31mm per column
  ensureSpace(15);
  doc.setFillColor(15, 23, 42);
  doc.rect(marginX, y, contentWidth, 6.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(255, 255, 255);
  summaryCols.forEach((col, i) => {
    doc.text(col.label, marginX + sColW * i + sColW - 1.8, y + 4.3, { align: 'right' });
  });
  y += 6.2;

  doc.setFillColor(248, 250, 252);
  doc.rect(marginX, y, contentWidth, 7.2, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, y, contentWidth, 7.2, 'S');
  summaryCols.forEach((col, i) => {
    if (i > 0) {
      doc.line(marginX + sColW * i, y, marginX + sColW * i, y + 7.2);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(col.color[0], col.color[1], col.color[2]);
    doc.text(formatSignedIDR(col.value), marginX + sColW * i + sColW - 1.8, y + 4.9, {
      align: 'right',
    });
  });
  y += 10;

  // Section 1: Saldo Rekening (2 columns only: Nama Rekening | Saldo Awal (Rp))
  const accNameW = contentWidth - 48;
  const accOpenX = marginX + contentWidth - 2.5;
  ensureSpace(8);
  doc.setFillColor(15, 23, 42);
  doc.rect(marginX, y, contentWidth, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(
    fitText(doc, `Saldo Rekening Per ${formatDocumentDate(vm.asOfDate)}`, accNameW - 3),
    marginX + 2.5,
    y + 4.6
  );
  doc.text('Saldo Awal (Rp)', accOpenX, y + 4.6, { align: 'right' });
  y += 6.8;

  vm.accountDetails.forEach((acc, idx) => {
    ensureSpace(6);
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, contentWidth, 5.8, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, y + 5.8, marginX + contentWidth, y + 5.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(
      fitText(doc, acc.isPrimary ? `${acc.name} (Utama)` : acc.name, accNameW - 4),
      marginX + 2.5,
      y + 4.1
    );
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(formatSignedIDR(acc.openingBalance), accOpenX, y + 4.1, {
      align: 'right',
    });
    y += 5.8;
  });

  ensureSpace(7);
  doc.setFillColor(226, 232, 240);
  doc.rect(marginX, y, contentWidth, 7, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.line(marginX, y + 7, marginX + contentWidth, y + 7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(15, 23, 42);
  doc.text(fitText(doc, 'Total Saldo Awal', accNameW - 3), marginX + 2.5, y + 4.7);
  doc.text(formatSignedIDR(vm.saldoAwal), accOpenX, y + 4.7, { align: 'right' });
  y += 7;

  y += 4;

  // Section 2: Saldo Awal & Cash In (5 columns: Nama | Sumber | Cash In | Saldo | Status)
  const ciNameW = 62;
  const ciSourceW = 34;
  const ciProjW = 30;
  const ciSaldoW = 30;
  const ciStatusW = contentWidth - ciNameW - ciSourceW - ciProjW - ciSaldoW; // 30

  ensureSpace(8);
  doc.setFillColor(6, 95, 70);
  doc.rect(marginX, y, contentWidth, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(255, 255, 255);
  doc.text(
    fitText(doc, `Cash In ${vm.monthNameOnly} (${vm.monthFullLabel})`, ciNameW - 3),
    marginX + 2.5,
    y + 4.6
  );
  doc.text('Sumber', marginX + ciNameW + 2, y + 4.6);
  doc.text('Cash In', marginX + ciNameW + ciSourceW + ciProjW - 2, y + 4.6, { align: 'right' });
  doc.text(
    'Saldo',
    marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW - 2,
    y + 4.6,
    { align: 'right' }
  );
  doc.text(
    'Status',
    marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW + 2,
    y + 4.6
  );
  y += 6.8;

  // Separate First Row: SALDO AWAL (never included in Cash In)
  ensureSpace(6.8);
  doc.setFillColor(239, 246, 255);
  doc.rect(marginX, y, contentWidth, 6.6, 'F');
  doc.setDrawColor(191, 219, 254);
  doc.line(marginX, y + 6.6, marginX + contentWidth, y + 6.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(30, 58, 138);
  doc.text(
    fitText(doc, `SALDO AWAL (Sisa bulan lalu - ${vm.previousMonthLabel})`, ciNameW - 3),
    marginX + 2.5,
    y + 4.5
  );
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('-', marginX + ciNameW + 2, y + 4.5);
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW - 2, y + 4.5, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text(
    formatSignedIDR(vm.saldoAwal),
    marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW - 2,
    y + 4.5,
    { align: 'right' }
  );
  doc.setFontSize(6.8);
  doc.text(
    vm.saldoAwalSource === 'manual' ? 'Manual' : 'Saldo Awal',
    marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW + 2,
    y + 4.5
  );
  y += 6.6;

  if (vm.cashInRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Belum ada item Cash In pada bulan ini.', marginX + 2.5, y + 4.2);
    y += 6;
  } else {
    vm.cashInRows.forEach((row) => {
      const rowH = 6;
      ensureSpace(rowH);
      const fill = getPdfRowFill(row.color);
      const stColor = getPdfStatusTextColor(row.color);
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(marginX, y, contentWidth, rowH, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, y + rowH, marginX + contentWidth, y + rowH);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.1);
      doc.setTextColor(15, 23, 42);
      doc.text(
        fitText(doc, getRowDisplayNameWithHistory(row), ciNameW - 3),
        marginX + 2.5,
        y + 4.2
      );
      doc.setFontSize(6.8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        fitText(doc, getCashInSourceLabel(row.cashInSource), ciSourceW - 3),
        marginX + ciNameW + 2,
        y + 4.2
      );
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.1);
      doc.setTextColor(15, 23, 42);
      doc.text(
        formatSignedIDR(row.projectedAmount),
        marginX + ciNameW + ciSourceW + ciProjW - 2,
        y + 4.2,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(
        '-',
        marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW - 2,
        y + 4.2,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(stColor[0], stColor[1], stColor[2]);
      doc.text(
        fitText(doc, getColorLabel(row.color), ciStatusW - 2.5),
        marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW + 2,
        y + 4.2
      );
      y += rowH;
    });
  }

  // TOTAL CASH IN row
  ensureSpace(7);
  doc.setFillColor(236, 253, 245);
  doc.rect(marginX, y, contentWidth, 7, 'F');
  doc.setDrawColor(167, 243, 208);
  doc.line(marginX, y + 7, marginX + contentWidth, y + 7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(6, 95, 70);
  doc.text('TOTAL CASH IN', marginX + 2.5, y + 4.7);
  doc.text(
    formatSignedIDR(vm.totalCashIn),
    marginX + ciNameW + ciSourceW + ciProjW - 2,
    y + 4.7,
    { align: 'right' }
  );
  doc.text(
    '-',
    marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW - 2,
    y + 4.7,
    { align: 'right' }
  );
  y += 7;

  // Account Balance row (Saldo Awal + Total Cash In)
  ensureSpace(8);
  doc.setFillColor(209, 250, 229);
  doc.rect(marginX, y, contentWidth, 7.6, 'F');
  doc.setDrawColor(110, 231, 183);
  doc.line(marginX, y + 7.6, marginX + contentWidth, y + 7.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 78, 59);
  doc.text(
    fitText(doc, 'Account Balance (Saldo Awal + Cash In)', ciNameW + ciSourceW - 3),
    marginX + 2.5,
    y + 5.1
  );
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW - 2, y + 5.1, { align: 'right' });
  doc.text(
    formatSignedIDR(vm.accountBalance),
    marginX + ciNameW + ciSourceW + ciProjW + ciSaldoW - 2,
    y + 5.1,
    { align: 'right' }
  );
  y += 7.6;

  y += 4;

  // Section 3: Cash Out (3 Groups)
  drawSectionBar(
    `Cash Out ${vm.monthNameOnly} (${vm.monthFullLabel})`,
    'Nominal (Projection)',
    'Status Warna',
    [30, 41, 59]
  );

  // Group A: Operasional
  drawSectionBar('A. OPERASIONAL', '', '', [71, 85, 105]);
  if (vm.operasionalRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Belum ada item Operasional.', marginX + 2.5, y + 4.2);
    y += 6;
  } else {
    vm.operasionalRows.forEach((row) => drawItemRow(row));
  }
  drawSubtotalRow('Total Operasional Cost', vm.totalOperasionalCost);

  // Group B: Investment
  drawSectionBar('B. INVESTMENT', '', '', [71, 85, 105]);
  if (vm.investmentRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Belum ada item Investment.', marginX + 2.5, y + 4.2);
    y += 6;
  } else {
    vm.investmentRows.forEach((row) => drawItemRow(row));
  }
  drawSubtotalRow('Total Investment Cost', vm.totalInvestmentCost);
  if (vm.hiddenNotDuePrincipalCount > 0 && !vm.hasVisiblePrincipalRows) {
    ensureSpace(5.5);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.2);
    doc.setTextColor(71, 85, 105);
    doc.text(
      'Pokok belum jatuh tempo di bulan ini, hanya Bunga yang ditagihkan',
      marginX + 2.5,
      y + 3.8
    );
    y += 5.5;
  }

  // Group C: Project Cost
  drawSectionBar('C. PROJECT COST (Otomatis dari PO + Manual)', '', '', [71, 85, 105]);
  if (vm.projectCostRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Belum ada item Project Cost.', marginX + 2.5, y + 4.2);
    y += 6;
  } else {
    vm.projectCostRows.forEach((row) => drawItemRow(row));
  }
  drawSubtotalRow('Total Project Cost', vm.totalProjectCost);

  drawSubtotalRow('Total Cost', vm.totalCost, {
    bg: [226, 232, 240],
    height: 7.5,
    fontSize: 8.6,
  });

  y += 4;

  // Section 4: Footer Ending Balance
  drawSubtotalRow(`Ending Balance Per ${vm.monthFullLabel}`, vm.endingBalance, {
    bg: vm.isMinus ? ([254, 226, 226] as const) : ([220, 252, 231] as const),
    textColor: vm.isMinus ? ([185, 28, 28] as const) : ([21, 128, 61] as const),
    height: 9.5,
    fontSize: 9.2,
    note: vm.isMinus ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN',
  });

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Projection Cashflow — ${COMPANY_INFO.name}   |   Halaman ${p} dari ${totalPages}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }

  const fileSuffix =
    vm.isRange && vm.startMonthKey && vm.endMonthKey
      ? `${vm.startMonthKey}_sd_${vm.endMonthKey}`
      : vm.monthKey;

  doc.save(`Projection-Cashflow-${fileSuffix}.pdf`);
}

export function printBossReport(
  vm: BossReportViewModel,
  onError?: (message: string) => void
): void {
  const rowColorClass = (color: BossReportColorStatus) => {
    if (color === 'red') return 'row-red';
    if (color === 'green') return 'row-green';
    return 'row-white';
  };

  const renderCashOutRows = (rows: BossReportComputedRow[], emptyText: string) => {
    if (rows.length === 0) {
      return `<tr><td colspan="3" class="empty-cell">${escapeHtml(emptyText)}</td></tr>`;
    }
    return rows
      .map(
        (r) => `<tr class="${rowColorClass(r.color)}">
          <td>${escapeHtml(getRowDisplayNameWithHistory(r))}</td>
          <td class="num">${escapeHtml(formatSignedIDR(r.projectedAmount))}</td>
          <td class="status-cell">${escapeHtml(getColorLabel(r.color))}</td>
        </tr>`
      )
      .join('');
  };

  const accountRowsHtml = vm.accountDetails
    .map(
      (acc) => `<tr>
        <td>${escapeHtml(acc.isPrimary ? `${acc.name} (Utama)` : acc.name)}</td>
        <td class="num">${escapeHtml(formatSignedIDR(acc.openingBalance))}</td>
      </tr>`
    )
    .join('');

  const cashInRowsHtml =
    vm.cashInRows.length === 0
      ? `<tr><td colspan="5" class="empty-cell">Belum ada item Cash In pada periode ini.</td></tr>`
      : vm.cashInRows
          .map(
            (r) => `<tr class="${rowColorClass(r.color)}">
              <td>${escapeHtml(getRowDisplayNameWithHistory(r))}</td>
              <td>${escapeHtml(getCashInSourceLabel(r.cashInSource))}</td>
              <td class="num">${escapeHtml(formatSignedIDR(r.projectedAmount))}</td>
              <td class="num muted">-</td>
              <td class="status-cell">${escapeHtml(getColorLabel(r.color))}</td>
            </tr>`
          )
          .join('');

  const titleText = `PROJECTION — ${vm.monthFullLabel.toUpperCase()}`;

  const bodyHtml = `
    <div class="proj-print-doc">
      <div class="proj-header">
        <div>
          <div class="company-name">${escapeHtml(COMPANY_INFO.nameUpper)}</div>
          <div class="report-title">${escapeHtml(titleText)}</div>
        </div>
        <div class="printed-date">Dicetak: ${escapeHtml(formatDocumentDate(getTodayISODate()))}</div>
      </div>

      <table class="summary-table">
        <thead>
          <tr>
            <th>Saldo Awal</th>
            <th>Cash In</th>
            <th>Cash Out Opex</th>
            <th>Cash Out Invest.</th>
            <th>Cash Out Project</th>
            <th>Ending Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="num blue">${escapeHtml(formatSignedIDR(vm.saldoAwal))}</td>
            <td class="num green">${escapeHtml(formatSignedIDR(vm.totalCashIn))}</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalOperasionalCost))}</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalInvestmentCost))}</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalProjectCost))}</td>
            <td class="num ${vm.isMinus ? 'red' : 'green'}">${escapeHtml(formatSignedIDR(vm.endingBalance))}</td>
          </tr>
        </tbody>
      </table>

      <table class="data-table">
        <thead>
          <tr class="section-head">
            <th style="width: 72%">Saldo Rekening Per ${escapeHtml(formatDocumentDate(vm.asOfDate))}</th>
            <th class="num" style="width: 28%">Saldo Awal (Rp)</th>
          </tr>
        </thead>
        <tbody>
          ${accountRowsHtml}
          <tr class="subtotal-row">
            <td>Total Saldo Awal</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.saldoAwal))}</td>
          </tr>
        </tbody>
      </table>

      <table class="data-table">
        <thead>
          <tr class="section-head-green">
            <th style="width: 34%">Cash In ${escapeHtml(vm.monthNameOnly)} (${escapeHtml(vm.monthFullLabel)})</th>
            <th style="width: 18%">Sumber</th>
            <th class="num" style="width: 16%">Cash In</th>
            <th class="num" style="width: 16%">Saldo</th>
            <th style="width: 16%">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr class="saldo-awal-row">
            <td>SALDO AWAL (Sisa bulan lalu - ${escapeHtml(vm.previousMonthLabel)})</td>
            <td class="muted">-</td>
            <td class="num muted">-</td>
            <td class="num blue">${escapeHtml(formatSignedIDR(vm.saldoAwal))}</td>
            <td class="blue">${escapeHtml(vm.saldoAwalSource === 'manual' ? 'Manual' : 'Saldo Awal')}</td>
          </tr>
          ${cashInRowsHtml}
          <tr class="cashin-total-row">
            <td colspan="2">TOTAL CASH IN</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalCashIn))}</td>
            <td class="num muted">-</td>
            <td></td>
          </tr>
          <tr class="account-balance-row">
            <td colspan="2">Account Balance (Saldo Awal + Cash In)</td>
            <td class="num muted">-</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.accountBalance))}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <table class="data-table">
        <thead>
          <tr class="section-head">
            <th style="width: 56%">Cash Out ${escapeHtml(vm.monthNameOnly)} (${escapeHtml(vm.monthFullLabel)})</th>
            <th class="num" style="width: 22%">Nominal (Projection)</th>
            <th style="width: 22%">Status Warna</th>
          </tr>
        </thead>
        <tbody>
          <tr class="group-head"><td colspan="3">A. OPERASIONAL</td></tr>
          ${renderCashOutRows(vm.operasionalRows, 'Belum ada item Operasional.')}
          <tr class="subtotal-row">
            <td>Total Operasional Cost</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalOperasionalCost))}</td>
            <td></td>
          </tr>

          <tr class="group-head"><td colspan="3">B. INVESTMENT</td></tr>
          ${renderCashOutRows(vm.investmentRows, 'Belum ada item Investment.')}
          <tr class="subtotal-row">
            <td>Total Investment Cost</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalInvestmentCost))}</td>
            <td></td>
          </tr>
          ${
            vm.hiddenNotDuePrincipalCount > 0 && !vm.hasVisiblePrincipalRows
              ? `<tr><td colspan="3" class="empty-cell">Pokok belum jatuh tempo di bulan ini, hanya Bunga yang ditagihkan</td></tr>`
              : ''
          }

          <tr class="group-head"><td colspan="3">C. PROJECT COST (Otomatis dari PO + Manual)</td></tr>
          ${renderCashOutRows(vm.projectCostRows, 'Belum ada item Project Cost.')}
          <tr class="subtotal-row">
            <td>Total Project Cost</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalProjectCost))}</td>
            <td></td>
          </tr>

          <tr class="total-cost-row">
            <td>Total Cost</td>
            <td class="num">${escapeHtml(formatSignedIDR(vm.totalCost))}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <table class="data-table">
        <tbody>
          <tr class="${vm.isMinus ? 'ending-minus' : 'ending-safe'}">
            <td style="width: 56%">Ending Balance Per ${escapeHtml(vm.monthFullLabel)}</td>
            <td class="num" style="width: 22%">${escapeHtml(formatSignedIDR(vm.endingBalance))}</td>
            <td style="width: 22%">${vm.isMinus ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const extraCss = `
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; background: #fff; color: #0f172a; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
    .proj-print-doc { max-width: 190mm; margin: 0 auto; }
    .proj-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 2px solid #0f172a; padding-bottom: 6px; }
    .company-name { font-size: 14px; font-weight: 700; color: #0f172a; }
    .report-title { font-size: 12px; font-weight: 700; color: #1e293b; margin-top: 2px; }
    .printed-date { font-size: 10px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
    .num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; white-space: nowrap; }
    .summary-table th { background: #0f172a; color: #fff; font-size: 10px; text-align: right; }
    .summary-table td { background: #f8fafc; font-size: 10.5px; }
    .section-head th { background: #0f172a; color: #fff; font-size: 10.5px; font-weight: 700; }
    .section-head-green th { background: #065f46; color: #fff; font-size: 10.5px; font-weight: 700; }
    .group-head td { background: #475569; color: #fff; font-size: 10px; font-weight: 700; }
    .subtotal-row td { background: #f1f5f9; font-weight: 700; }
    .total-cost-row td { background: #e2e8f0; font-weight: 700; font-size: 11.5px; }
    .saldo-awal-row td { background: #eff6ff; font-weight: 700; color: #1e3a8a; }
    .cashin-total-row td { background: #ecfdf5; font-weight: 700; color: #065f46; }
    .account-balance-row td { background: #d1fae5; font-weight: 700; color: #064e3b; }
    .row-red td { background: #f1f5f9; color: #64748b; }
    .row-green td { background: #dcfce7; }
    .row-white td { background: #ffffff; }
    .status-cell { font-weight: 700; font-size: 10px; }
    .empty-cell { font-style: italic; color: #64748b; }
    .muted { color: #64748b; font-weight: 400; }
    .blue { color: #1e40af; }
    .green { color: #15803d; }
    .red { color: #b91c1c; }
    .ending-safe td { background: #dcfce7; color: #15803d; font-weight: 700; font-size: 12px; }
    .ending-minus td { background: #fee2e2; color: #b91c1c; font-weight: 700; font-size: 12px; }
    @media print {
      body { padding: 0; }
      tr { page-break-inside: avoid; }
    }
  `;

  printHtmlInNewTab({
    title: titleText,
    bodyHtml,
    extraCss,
    onError,
  });
}

// =========================================================================
// REALISASI EXPORTS (HANYA ITEM HIJAU - PAID)
// =========================================================================

export function exportBalanceReportToExcel(vm: BossReportViewModel): void {
  const paidCashInRows = vm.cashInRows.filter((r) => r.color === 'green');
  const paidOpexRows = vm.operasionalRows.filter((r) => r.color === 'green');
  const paidInvRows = vm.investmentRows.filter((r) => r.color === 'green');
  const paidProjectRows = vm.projectCostRows.filter((r) => r.color === 'green');
  const balanceAccounts = computeBalanceAccountDetails(vm);
  const accountBalanceRealisasi = vm.saldoAwal + vm.totalCashInRealisasi;
  const isMinusReal = vm.endingBalanceRealisasi < 0;

  const rows: Array<Array<string | number>> = [];

  rows.push([
    `${COMPANY_INFO.nameUpper} — REALISASI — ${vm.monthFullLabel.toUpperCase()}`,
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  rows.push(['RINGKASAN REALISASI (HANYA ITEM PAID)', '', '', '', '', '', '']);
  rows.push([
    'Saldo Awal (Rp)',
    'Cash In Realisasi (Rp)',
    'Cash Out Opex Realisasi (Rp)',
    'Cash Out Investment Realisasi (Rp)',
    'Cash Out Project Cost Realisasi (Rp)',
    'Saldo Tersedia Real (Rp)',
  ]);
  rows.push([
    vm.saldoAwal,
    vm.totalCashInRealisasi,
    vm.totalOperasionalRealisasi,
    vm.totalInvestmentRealisasi,
    vm.totalProjectRealisasi,
    vm.endingBalanceRealisasi,
  ]);
  rows.push(['', '', '', '', '', '', '']);

  rows.push([
    `Saldo Rekening & Saldo Tersedia Per ${formatDocumentDate(vm.asOfDate)}`,
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  rows.push([
    'Nama Rekening',
    'Saldo Awal (Rp)',
    'Cash In Paid (Rp)',
    'Cash Out Opex Paid (Rp)',
    'Cash Out Investment Paid (Rp)',
    'Cash Out Project Cost Paid (Rp)',
    'Saldo Tersedia (Rp)',
  ]);

  for (const acc of balanceAccounts) {
    rows.push([
      acc.isPrimary ? `${acc.name} (Rekening Utama)` : acc.name,
      acc.openingBalance,
      acc.projectedCashIn,
      acc.cashOutOperasional,
      acc.cashOutInvestment,
      acc.cashOutProjectCost,
      acc.endingBalance,
    ]);
  }
  rows.push([
    'Total Seluruh Rekening',
    vm.saldoAwal,
    vm.totalCashInRealisasi,
    vm.totalOperasionalRealisasi,
    vm.totalInvestmentRealisasi,
    vm.totalProjectRealisasi,
    vm.endingBalanceRealisasi,
  ]);
  rows.push(['', '', '', '', '', '', '']);

  rows.push([
    `Cash In Realisasi ${vm.monthNameOnly} (${vm.monthFullLabel})`,
    'Sumber',
    'Nominal Projection (Rp)',
    'Realisasi Paid (Rp)',
    'Saldo (Rp)',
    'Status Warna',
  ]);
  rows.push([
    `SALDO AWAL (Sisa bulan lalu - ${vm.previousMonthLabel})`,
    '-',
    '-',
    '-',
    vm.saldoAwal,
    vm.saldoAwalSource === 'manual' ? 'Input Manual' : 'Otomatis Bulan Lalu',
  ]);
  const paidCashInProjectedTotal = paidCashInRows.reduce((s, r) => s + r.projectedAmount, 0);
  const paidOpexProjectedTotal = paidOpexRows.reduce((s, r) => s + r.projectedAmount, 0);
  const paidInvProjectedTotal = paidInvRows.reduce((s, r) => s + r.projectedAmount, 0);
  const paidProjectProjectedTotal = paidProjectRows.reduce((s, r) => s + r.projectedAmount, 0);
  const totalCostPaidProjected =
    paidOpexProjectedTotal + paidInvProjectedTotal + paidProjectProjectedTotal;

  if (paidCashInRows.length === 0) {
    rows.push([
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      '-',
      0,
      0,
      '-',
      '-',
    ]);
  } else {
    for (const row of paidCashInRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        getCashInSourceLabel(row.cashInSource),
        row.projectedAmount,
        row.realisasiAmount,
        '-',
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push([
    `TOTAL CASH IN REALISASI (${paidCashInRows.length} ITEM PAID)`,
    '',
    paidCashInProjectedTotal,
    vm.totalCashInRealisasi,
    '-',
    '',
  ]);
  rows.push([
    'Account Balance Realisasi',
    '',
    '-',
    '-',
    accountBalanceRealisasi,
    'Saldo Awal + TOTAL CASH IN REALISASI',
  ]);
  rows.push(['', '', '', '', '', '']);

  rows.push([
    `Cash Out Realisasi ${vm.monthNameOnly} (${vm.monthFullLabel})`,
    'Nominal Projection (Rp)',
    'Realisasi Paid (Rp)',
    'Status Warna',
  ]);

  rows.push([`A. OPERASIONAL (${paidOpexRows.length} item Paid)`, '', '', '']);
  if (paidOpexRows.length === 0) {
    rows.push([
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      0,
      0,
      '-',
    ]);
  } else {
    for (const row of paidOpexRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        row.projectedAmount,
        row.realisasiAmount,
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['Total Operasional Realisasi', paidOpexProjectedTotal, vm.totalOperasionalRealisasi, '']);

  rows.push([`B. INVESTMENT (${paidInvRows.length} item Paid)`, '', '', '']);
  if (paidInvRows.length === 0) {
    rows.push([
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      0,
      0,
      '-',
    ]);
  } else {
    for (const row of paidInvRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        row.projectedAmount,
        row.realisasiAmount,
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['Total Investment Realisasi', paidInvProjectedTotal, vm.totalInvestmentRealisasi, '']);

  rows.push([`C. PROJECT COST (${paidProjectRows.length} item Paid)`, '', '', '']);
  if (paidProjectRows.length === 0) {
    rows.push([
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      0,
      0,
      '-',
    ]);
  } else {
    for (const row of paidProjectRows) {
      rows.push([
        getRowDisplayNameWithHistory(row),
        row.projectedAmount,
        row.realisasiAmount,
        getColorLabel(row.color),
      ]);
    }
  }
  rows.push(['Total Project Cost Realisasi', paidProjectProjectedTotal, vm.totalProjectRealisasi, '']);

  const totalOutPaidCount = paidOpexRows.length + paidInvRows.length + paidProjectRows.length;
  rows.push([
    `TOTAL (${totalOutPaidCount} ITEM PAID) — Total Cost Realisasi`,
    totalCostPaidProjected,
    vm.totalCostRealisasi,
    'Opex Paid + Investment Paid + Project Cost Paid',
  ]);
  rows.push(['', '', '', '']);

  rows.push([
    `Saldo Tersedia (Real) Per ${vm.monthFullLabel}`,
    vm.endingBalanceRealisasi,
    vm.endingBalanceRealisasi,
    isMinusReal ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 48 },
    { wch: 28 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 26 },
  ];

  for (let r = 0; r < rows.length; r += 1) {
    for (const c of [0, 1, 2, 3, 4, 5, 6]) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef];
      if (cell && typeof cell.v === 'number') {
        cell.z = '#,##0';
      }
    }
  }

  const fileSuffix =
    vm.isRange && vm.startMonthKey && vm.endMonthKey
      ? `${vm.startMonthKey}_sd_${vm.endMonthKey}`
      : vm.monthKey;
  const sheetSuffix =
    vm.isRange && vm.startMonthKey && vm.endMonthKey
      ? `${vm.startMonthKey}_${vm.endMonthKey}`
      : vm.monthKey;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Realisasi ${sheetSuffix}`.slice(0, 31));
  XLSX.writeFile(wb, `Laporan-Realisasi-${fileSuffix}.xlsx`);
}

export function exportBalanceReportToPDF(vm: BossReportViewModel): void {
  const paidCashInRows = vm.cashInRows.filter((r) => r.color === 'green');
  const paidOpexRows = vm.operasionalRows.filter((r) => r.color === 'green');
  const paidInvRows = vm.investmentRows.filter((r) => r.color === 'green');
  const paidProjectRows = vm.projectCostRows.filter((r) => r.color === 'green');
  const paidCashInProjectedTotal = paidCashInRows.reduce((s, r) => s + r.projectedAmount, 0);
  const paidOpexProjectedTotal = paidOpexRows.reduce((s, r) => s + r.projectedAmount, 0);
  const paidInvProjectedTotal = paidInvRows.reduce((s, r) => s + r.projectedAmount, 0);
  const paidProjectProjectedTotal = paidProjectRows.reduce((s, r) => s + r.projectedAmount, 0);
  const totalCostPaidProjected =
    paidOpexProjectedTotal + paidInvProjectedTotal + paidProjectProjectedTotal;
  const balanceAccounts = computeBalanceAccountDetails(vm);
  const accountBalanceRealisasi = vm.saldoAwal + vm.totalCashInRealisasi;
  const isMinusReal = vm.endingBalanceRealisasi < 0;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2;
  const colNameW = 80;
  const colProjW = 34;
  const colRealW = 34;
  const colStatusW = contentWidth - colNameW - colProjW - colRealW;
  let y = 13;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 14) {
      doc.addPage();
      y = 13;
    }
  };

  const drawSectionBar = (
    title: string,
    col2: string,
    col3: string,
    col4: string,
    bg: readonly [number, number, number]
  ) => {
    ensureSpace(8);
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.rect(marginX, y, contentWidth, 6.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(fitText(doc, title, colNameW - 3), marginX + 2.5, y + 4.6);
    if (col2) {
      doc.text(col2, marginX + colNameW + colProjW - 2, y + 4.6, { align: 'right' });
    }
    if (col3) {
      doc.text(col3, marginX + colNameW + colProjW + colRealW - 2, y + 4.6, {
        align: 'right',
      });
    }
    if (col4) {
      doc.text(col4, marginX + colNameW + colProjW + colRealW + 2.5, y + 4.6);
    }
    y += 6.8;
  };

  const drawPaidItemRow = (row: BossReportComputedRow) => {
    const rowH = 6;
    ensureSpace(rowH);
    const fill = getPdfRowFill(row.color);
    const stColor = getPdfStatusTextColor(row.color);

    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(marginX, y, contentWidth, rowH, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, y + rowH, marginX + contentWidth, y + rowH);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      fitText(doc, getRowDisplayNameWithHistory(row), colNameW - 4),
      marginX + 2.5,
      y + 4.2
    );

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(
      formatSignedIDR(row.projectedAmount),
      marginX + colNameW + colProjW - 2,
      y + 4.2,
      { align: 'right' }
    );

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(21, 128, 61);
    doc.text(
      formatSignedIDR(row.realisasiAmount),
      marginX + colNameW + colProjW + colRealW - 2,
      y + 4.2,
      { align: 'right' }
    );

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(stColor[0], stColor[1], stColor[2]);
    doc.text(
      fitText(doc, getColorLabel(row.color), colStatusW - 3),
      marginX + colNameW + colProjW + colRealW + 2.5,
      y + 4.2
    );
    y += rowH;
  };

  const drawSubtotalRow = (
    label: string,
    col2Amt: number,
    col3Amt: number | null,
    options?: {
      bg?: readonly [number, number, number];
      textColor?: readonly [number, number, number];
      height?: number;
      fontSize?: number;
      note?: string;
    }
  ) => {
    const h = options?.height ?? 6.8;
    const bg = options?.bg ?? ([241, 245, 249] as const);
    const tc = options?.textColor ?? ([15, 23, 42] as const);
    const fs = options?.fontSize ?? 8;

    ensureSpace(h);
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.rect(marginX, y, contentWidth, h, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.line(marginX, y + h, marginX + contentWidth, y + h);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fs);
    doc.setTextColor(tc[0], tc[1], tc[2]);
    doc.text(fitText(doc, label, colNameW - 3), marginX + 2.5, y + h * 0.66);
    doc.text(formatSignedIDR(col2Amt), marginX + colNameW + colProjW - 2, y + h * 0.66, {
      align: 'right',
    });

    if (col3Amt !== null) {
      doc.text(
        formatSignedIDR(col3Amt),
        marginX + colNameW + colProjW + colRealW - 2,
        y + h * 0.66,
        { align: 'right' }
      );
    }

    if (options?.note) {
      doc.setFontSize(7.2);
      doc.text(
        fitText(doc, options.note, colStatusW - 3),
        marginX + colNameW + colProjW + colRealW + 2.5,
        y + h * 0.66
      );
    }
    y += h;
  };

  // Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(COMPANY_INFO.nameUpper, marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Dicetak: ${formatDocumentDate(getTodayISODate())}`, pageWidth - marginX, y, {
    align: 'right',
  });
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`REALISASI — ${vm.monthFullLabel.toUpperCase()}`, marginX, y);
  y += 4.5;

  // 6 KPI Summary Strip
  const summaryCols: Array<{
    label: string;
    value: number;
    color: readonly [number, number, number];
  }> = [
    { label: 'Saldo Awal', value: vm.saldoAwal, color: [30, 64, 175] },
    { label: 'Cash In Real.', value: vm.totalCashInRealisasi, color: [6, 95, 70] },
    { label: 'Opex Realisasi', value: vm.totalOperasionalRealisasi, color: [15, 23, 42] },
    { label: 'Invest. Real.', value: vm.totalInvestmentRealisasi, color: [15, 23, 42] },
    { label: 'Project Real.', value: vm.totalProjectRealisasi, color: [15, 23, 42] },
    {
      label: 'Saldo Tersedia',
      value: vm.endingBalanceRealisasi,
      color: isMinusReal ? [185, 28, 28] : [21, 128, 61],
    },
  ];
  const sColW = contentWidth / 6;
  ensureSpace(15);
  doc.setFillColor(15, 23, 42);
  doc.rect(marginX, y, contentWidth, 6.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(255, 255, 255);
  summaryCols.forEach((col, i) => {
    doc.text(col.label, marginX + sColW * i + sColW - 1.8, y + 4.3, { align: 'right' });
  });
  y += 6.2;

  doc.setFillColor(248, 250, 252);
  doc.rect(marginX, y, contentWidth, 7.2, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, y, contentWidth, 7.2, 'S');
  summaryCols.forEach((col, i) => {
    if (i > 0) {
      doc.line(marginX + sColW * i, y, marginX + sColW * i, y + 7.2);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.7);
    doc.setTextColor(col.color[0], col.color[1], col.color[2]);
    doc.text(formatSignedIDR(col.value), marginX + sColW * i + sColW - 1.8, y + 4.9, {
      align: 'right',
    });
  });
  y += 10;

  // Section 1: Saldo Rekening (Realisasi)
  drawSectionBar(
    `Saldo Rekening & Saldo Tersedia Per ${formatDocumentDate(vm.asOfDate)}`,
    'Saldo Awal (Rp)',
    'Saldo Tersedia',
    '',
    [15, 23, 42]
  );
  balanceAccounts.forEach((acc, idx) => {
    ensureSpace(6);
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, contentWidth, 5.8, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, y + 5.8, marginX + contentWidth, y + 5.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(
      fitText(doc, acc.isPrimary ? `${acc.name} (Utama)` : acc.name, colNameW - 4),
      marginX + 2.5,
      y + 4.1
    );
    doc.setFont('helvetica', 'bold');
    doc.text(formatSignedIDR(acc.openingBalance), marginX + colNameW + colProjW - 2, y + 4.1, {
      align: 'right',
    });
    doc.setTextColor(
      acc.endingBalance < 0 ? 185 : 21,
      acc.endingBalance < 0 ? 28 : 128,
      acc.endingBalance < 0 ? 28 : 61
    );
    doc.text(
      formatSignedIDR(acc.endingBalance),
      marginX + colNameW + colProjW + colRealW - 2,
      y + 4.1,
      { align: 'right' }
    );
    y += 5.8;
  });
  drawSubtotalRow('Total Saldo Awal & Saldo Tersedia (Real)', vm.saldoAwal, vm.endingBalanceRealisasi, {
    bg: [226, 232, 240],
    height: 7,
    fontSize: 8.2,
  });

  y += 4;

  // Section 2: Saldo Awal & Cash In Realisasi
  const ciNameW = 52;
  const ciSourceW = 30;
  const ciProjW = 26;
  const ciRealW = 26;
  const ciSaldoW = 26;
  const ciStatusW = contentWidth - ciNameW - ciSourceW - ciProjW - ciRealW - ciSaldoW;

  ensureSpace(8);
  doc.setFillColor(6, 95, 70);
  doc.rect(marginX, y, contentWidth, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(255, 255, 255);
  doc.text(
    fitText(doc, `Cash In Realisasi ${vm.monthNameOnly} (${vm.monthFullLabel})`, ciNameW - 3),
    marginX + 2.5,
    y + 4.6
  );
  doc.text('Sumber', marginX + ciNameW + 2, y + 4.6);
  doc.text('Projected', marginX + ciNameW + ciSourceW + ciProjW - 2, y + 4.6, { align: 'right' });
  doc.text('Realisasi', marginX + ciNameW + ciSourceW + ciProjW + ciRealW - 2, y + 4.6, {
    align: 'right',
  });
  doc.text('Saldo', marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW - 2, y + 4.6, {
    align: 'right',
  });
  doc.text('Status', marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW + 2, y + 4.6);
  y += 6.8;

  // Separate First Row: SALDO AWAL
  ensureSpace(6.8);
  doc.setFillColor(239, 246, 255);
  doc.rect(marginX, y, contentWidth, 6.6, 'F');
  doc.setDrawColor(191, 219, 254);
  doc.line(marginX, y + 6.6, marginX + contentWidth, y + 6.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(30, 58, 138);
  doc.text(
    fitText(doc, `SALDO AWAL (Sisa bulan lalu - ${vm.previousMonthLabel})`, ciNameW - 3),
    marginX + 2.5,
    y + 4.5
  );
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('-', marginX + ciNameW + 2, y + 4.5);
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW - 2, y + 4.5, { align: 'right' });
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW + ciRealW - 2, y + 4.5, {
    align: 'right',
  });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text(
    formatSignedIDR(vm.saldoAwal),
    marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW - 2,
    y + 4.5,
    { align: 'right' }
  );
  doc.setFontSize(6.8);
  doc.text(
    vm.saldoAwalSource === 'manual' ? 'Manual' : 'Saldo Awal',
    marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW + 2,
    y + 4.5
  );
  y += 6.6;

  if (paidCashInRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      marginX + 2.5,
      y + 4.2
    );
    y += 6;
  } else {
    paidCashInRows.forEach((row) => {
      const rowH = 6;
      ensureSpace(rowH);
      const fill = getPdfRowFill(row.color);
      const stColor = getPdfStatusTextColor(row.color);
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(marginX, y, contentWidth, rowH, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, y + rowH, marginX + contentWidth, y + rowH);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.1);
      doc.setTextColor(15, 23, 42);
      doc.text(
        fitText(doc, getRowDisplayNameWithHistory(row), ciNameW - 3),
        marginX + 2.5,
        y + 4.2
      );
      doc.setFontSize(6.8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        fitText(doc, getCashInSourceLabel(row.cashInSource), ciSourceW - 3),
        marginX + ciNameW + 2,
        y + 4.2
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.1);
      doc.setTextColor(51, 65, 85);
      doc.text(
        formatSignedIDR(row.projectedAmount),
        marginX + ciNameW + ciSourceW + ciProjW - 2,
        y + 4.2,
        {
          align: 'right',
        }
      );
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(21, 128, 61);
      doc.text(
        formatSignedIDR(row.realisasiAmount),
        marginX + ciNameW + ciSourceW + ciProjW + ciRealW - 2,
        y + 4.2,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(
        '-',
        marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW - 2,
        y + 4.2,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(stColor[0], stColor[1], stColor[2]);
      doc.text(
        fitText(doc, getColorLabel(row.color), ciStatusW - 2.5),
        marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW + 2,
        y + 4.2
      );
      y += rowH;
    });
  }

  // TOTAL CASH IN REALISASI
  ensureSpace(7);
  doc.setFillColor(236, 253, 245);
  doc.rect(marginX, y, contentWidth, 7, 'F');
  doc.setDrawColor(167, 243, 208);
  doc.line(marginX, y + 7, marginX + contentWidth, y + 7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(6, 95, 70);
  doc.text(`TOTAL CASH IN REALISASI (${paidCashInRows.length} ITEM PAID)`, marginX + 2.5, y + 4.7);
  doc.text(
    formatSignedIDR(paidCashInProjectedTotal),
    marginX + ciNameW + ciSourceW + ciProjW - 2,
    y + 4.7,
    {
      align: 'right',
    }
  );
  doc.text(
    formatSignedIDR(vm.totalCashInRealisasi),
    marginX + ciNameW + ciSourceW + ciProjW + ciRealW - 2,
    y + 4.7,
    { align: 'right' }
  );
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW - 2, y + 4.7, {
    align: 'right',
  });
  y += 7;

  // Account Balance Realisasi
  ensureSpace(8);
  doc.setFillColor(209, 250, 229);
  doc.rect(marginX, y, contentWidth, 7.6, 'F');
  doc.setDrawColor(110, 231, 183);
  doc.line(marginX, y + 7.6, marginX + contentWidth, y + 7.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(6, 78, 59);
  doc.text(
    fitText(doc, 'Account Balance Realisasi (Saldo Awal + Cash In Paid)', ciNameW + ciSourceW - 3),
    marginX + 2.5,
    y + 5.1
  );
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW - 2, y + 5.1, { align: 'right' });
  doc.text('-', marginX + ciNameW + ciSourceW + ciProjW + ciRealW - 2, y + 5.1, {
    align: 'right',
  });
  doc.text(
    formatSignedIDR(accountBalanceRealisasi),
    marginX + ciNameW + ciSourceW + ciProjW + ciRealW + ciSaldoW - 2,
    y + 5.1,
    { align: 'right' }
  );
  y += 11.6;

  // Section 3: Cash Out Realisasi (Paid Only)
  drawSectionBar(
    `Cash Out Realisasi ${vm.monthNameOnly} (${vm.monthFullLabel})`,
    'Projected',
    'Realisasi (Paid)',
    'Status Warna',
    [30, 41, 59]
  );

  // Group A: Operasional
  drawSectionBar(`A. OPERASIONAL (${paidOpexRows.length} item Paid)`, '', '', '', [71, 85, 105]);
  if (paidOpexRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      marginX + 2.5,
      y + 4.2
    );
    y += 6;
  } else {
    paidOpexRows.forEach((row) => drawPaidItemRow(row));
  }
  drawSubtotalRow(
    'Total Operasional Realisasi',
    paidOpexProjectedTotal,
    vm.totalOperasionalRealisasi
  );

  // Group B: Investment
  drawSectionBar(`B. INVESTMENT (${paidInvRows.length} item Paid)`, '', '', '', [71, 85, 105]);
  if (paidInvRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      marginX + 2.5,
      y + 4.2
    );
    y += 6;
  } else {
    paidInvRows.forEach((row) => drawPaidItemRow(row));
  }
  drawSubtotalRow(
    'Total Investment Realisasi',
    paidInvProjectedTotal,
    vm.totalInvestmentRealisasi
  );

  // Group C: Project Cost
  drawSectionBar(`C. PROJECT COST (${paidProjectRows.length} item Paid)`, '', '', '', [71, 85, 105]);
  if (paidProjectRows.length === 0) {
    ensureSpace(6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Belum ada realisasi di bulan ini. Semua masih Projection / Pending.',
      marginX + 2.5,
      y + 4.2
    );
    y += 6;
  } else {
    paidProjectRows.forEach((row) => drawPaidItemRow(row));
  }
  drawSubtotalRow(
    'Total Project Cost Realisasi',
    paidProjectProjectedTotal,
    vm.totalProjectRealisasi
  );

  const totalOutPaidCount = paidOpexRows.length + paidInvRows.length + paidProjectRows.length;
  drawSubtotalRow(
    `TOTAL (${totalOutPaidCount} ITEM PAID) — Total Cost Realisasi`,
    totalCostPaidProjected,
    vm.totalCostRealisasi,
    {
      bg: [226, 232, 240],
      height: 7.5,
      fontSize: 8.4,
    }
  );

  y += 4;

  // Section 4: Footer Saldo Tersedia (Real)
  drawSubtotalRow(
    `Saldo Tersedia (Real) Per ${vm.monthFullLabel}`,
    vm.endingBalanceRealisasi,
    vm.endingBalanceRealisasi,
    {
      bg: isMinusReal ? ([254, 226, 226] as const) : ([220, 252, 231] as const),
      textColor: isMinusReal ? ([185, 28, 28] as const) : ([21, 128, 61] as const),
      height: 9.5,
      fontSize: 9.2,
      note: isMinusReal ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN',
    }
  );

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Laporan Realisasi — ${COMPANY_INFO.name}   |   Halaman ${p} dari ${totalPages}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }

  const fileSuffix =
    vm.isRange && vm.startMonthKey && vm.endMonthKey
      ? `${vm.startMonthKey}_sd_${vm.endMonthKey}`
      : vm.monthKey;

  doc.save(`Laporan-Realisasi-${fileSuffix}.pdf`);
}
