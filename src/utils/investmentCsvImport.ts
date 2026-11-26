import { deterministicUuid } from '../lib/supabaseClient';
import {
  DEFAULT_INVESTMENT_CUTOFF_DATE,
  InvestmentInput,
} from '../types/investment';
import { normalizeToIsoDate } from './format';
import { addMonthsToInvestmentKey, computeLoanEndDate } from './investmentCalc';

export const EXPECTED_KKB_TOTAL_PRINCIPAL = 13_981_672_800;
export const EXPECTED_KKB_TOTAL_MONTHLY_INTEREST = 438_190_000;

export interface InvestmentCsvRowError {
  lineNumber: number; // 1-indexed line in CSV file
  rowNo: string;
  contractNumber: string;
  investorName: string;
  field: string;
  rawValue: string;
  message: string;
}

export interface ParsedInvestmentCsvRow {
  rowIndex: number; // 1..N
  deterministicId: string;
  rawNo: string;
  input: InvestmentInput;
}

export interface InvestmentCsvImportResult {
  valid: boolean;
  rows: ParsedInvestmentCsvRow[];
  errors: InvestmentCsvRowError[];
  totalPrincipal: number;
  totalMonthlyInterest: number;
  totalBonus: number;
  principalMismatch: boolean;
  interestMismatch: boolean;
  summaryMessage: string;
}

/**
 * RFC-4180 CSV line parser that supports escaped quotes ("").
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

const REQUIRED_HEADERS = [
  'No_Kontrak',
  'Tgl_Kontrak',
  'Periode_Bulan',
  'Tgl_Bayar_Bunga',
  'Tgl_Jatuh_Tempo',
  'Nama_Investor',
  'Nilai_Pinjaman',
  'Bunga_Per_Bulan',
  'Bonus',
  'Tgl_Bonus_Dicairkan',
  'Metode',
] as const;

function isValidCalendarDateISO(iso: string): boolean {
  return Boolean(normalizeToIsoDate(iso));
}

function parseNonNegativeNumeric(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  // Support pure digits or Indonesian dot thousand separators (e.g. "250.000.000")
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(trimmed)
    ? trimmed.replace(/\./g, '')
    : trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
}

function formatNumberID(val: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(
    Math.round(val || 0)
  );
}

export function parseAndValidateInvestmentCsv(
  csvText: string,
  options?: { requireExactTotals?: boolean }
): InvestmentCsvImportResult {
  const requireExactTotals = options?.requireExactTotals !== false;
  const normalizedText = (csvText || '').replace(/^\uFEFF/, '').trim();
  if (!normalizedText) {
    return {
      valid: false,
      rows: [],
      errors: [
        {
          lineNumber: 1,
          rowNo: '-',
          contractNumber: '-',
          investorName: '-',
          field: 'File CSV',
          rawValue: '',
          message: 'File CSV kosong.',
        },
      ],
      totalPrincipal: 0,
      totalMonthlyInterest: 0,
      totalBonus: 0,
      principalMismatch: true,
      interestMismatch: true,
      summaryMessage: 'Import ditolak: File CSV kosong.',
    };
  }

  const rawLines = normalizedText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (rawLines.length < 2) {
    return {
      valid: false,
      rows: [],
      errors: [
        {
          lineNumber: 1,
          rowNo: '-',
          contractNumber: '-',
          investorName: '-',
          field: 'Header / Data',
          rawValue: rawLines[0] ?? '',
          message: 'File CSV tidak memiliki baris data.',
        },
      ],
      totalPrincipal: 0,
      totalMonthlyInterest: 0,
      totalBonus: 0,
      principalMismatch: true,
      interestMismatch: true,
      summaryMessage: 'Import ditolak: Tidak ada baris data pada file CSV.',
    };
  }

  let headerFields = parseCsvLine(rawLines[0]).map((h) => h.trim());
  if (headerFields.length === 1 && headerFields[0].includes(',')) {
    headerFields = parseCsvLine(headerFields[0]).map((h) => h.trim());
  }

  const headerIndex = new Map<string, number>();
  headerFields.forEach((name, idx) => {
    headerIndex.set(name, idx);
  });

  const errors: InvestmentCsvRowError[] = [];
  for (const reqHeader of REQUIRED_HEADERS) {
    if (!headerIndex.has(reqHeader)) {
      errors.push({
        lineNumber: 1,
        rowNo: 'Header',
        contractNumber: '-',
        investorName: '-',
        field: reqHeader,
        rawValue: headerFields.join(', '),
        message: `Kolom wajib "${reqHeader}" tidak ditemukan di header CSV.`,
      });
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      rows: [],
      errors,
      totalPrincipal: 0,
      totalMonthlyInterest: 0,
      totalBonus: 0,
      principalMismatch: true,
      interestMismatch: true,
      summaryMessage: `Import ditolak: Header CSV tidak sesuai (${errors.length} kolom hilang).`,
    };
  }

  const getCell = (fields: string[], col: string): string => {
    const idx = headerIndex.get(col);
    if (idx === undefined) return '';
    return (fields[idx] ?? '').trim();
  };

  const parsedRows: ParsedInvestmentCsvRow[] = [];
  const seenContractNumbers = new Map<string, number>();
  let totalPrincipal = 0;
  let totalMonthlyInterest = 0;
  let totalBonus = 0;

  for (let i = 1; i < rawLines.length; i += 1) {
    const lineNumber = i + 1;
    let fields = parseCsvLine(rawLines[i]);
    // Handle Excel/CSV lines where entire row is wrapped in outer quotes: "1,WB-KKB.01.I/2026,...,0"
    if (fields.length === 1 && fields[0].includes(',')) {
      fields = parseCsvLine(fields[0]);
    }

    const rawNo = getCell(fields, 'No') || String(i);
    const contractNumber = getCell(fields, 'No_Kontrak');
    const startDateRaw = getCell(fields, 'Tgl_Kontrak');
    const tenorRaw = getCell(fields, 'Periode_Bulan');
    const dueDayRaw = getCell(fields, 'Tgl_Bayar_Bunga');
    const endDateRaw = getCell(fields, 'Tgl_Jatuh_Tempo');
    const investorName = getCell(fields, 'Nama_Investor');
    const principalRaw = getCell(fields, 'Nilai_Pinjaman');
    const bungaRaw = getCell(fields, 'Bunga_Per_Bulan');
    const bonusRaw = getCell(fields, 'Bonus');
    const bonusDateRaw = getCell(fields, 'Tgl_Bonus_Dicairkan');
    const keteranganRaw = getCell(fields, 'Keterangan');
    const metodeRaw = getCell(fields, 'Metode');
    const dendaRaw = getCell(fields, 'Denda');

    const rowErrors: InvestmentCsvRowError[] = [];
    const pushErr = (field: string, rawValue: string, message: string) => {
      rowErrors.push({
        lineNumber,
        rowNo: rawNo,
        contractNumber: contractNumber || '-',
        investorName: investorName || '-',
        field,
        rawValue,
        message,
      });
    };

    if (fields.length < 13) {
      pushErr(
        'Format Baris',
        rawLines[i],
        `Jumlah kolom tidak lengkap (${fields.length} kolom, minimal 13 kolom).`
      );
    }

    if (!contractNumber) {
      pushErr('No_Kontrak', contractNumber, 'No. Kontrak tidak boleh kosong.');
    } else {
      const normalizedKey = contractNumber.trim().toLowerCase();
      const firstLine = seenContractNumbers.get(normalizedKey);
      if (firstLine !== undefined) {
        pushErr(
          'No_Kontrak',
          contractNumber,
          `No. Kontrak duplikat dengan baris ${firstLine}.`
        );
      } else {
        seenContractNumbers.set(normalizedKey, lineNumber);
      }
    }

    if (!investorName) {
      pushErr('Nama_Investor', investorName, 'Nama Investor tidak boleh kosong.');
    }

    const startDate = normalizeToIsoDate(startDateRaw) ?? '';
    if (!startDate) {
      pushErr(
        'Tgl_Kontrak',
        startDateRaw,
        'Format Tgl Kontrak harus YYYY-MM-DD atau DD/MM/YYYY yang valid.'
      );
    }

    const parsedTenor = parseNonNegativeNumeric(tenorRaw);
    if (parsedTenor === null || parsedTenor < 1 || parsedTenor > 360) {
      pushErr(
        'Periode_Bulan',
        tenorRaw,
        'Periode (Bulan) harus angka bulat antara 1 sampai 360.'
      );
    }

    let parsedDueDay: number | undefined;
    if (dueDayRaw) {
      const dd = parseNonNegativeNumeric(dueDayRaw);
      if (dd === null || dd < 1 || dd > 31) {
        pushErr(
          'Tgl_Bayar_Bunga',
          dueDayRaw,
          'Tgl. Bayar Bunga harus kosong atau angka 1–31.'
        );
      } else {
        parsedDueDay = dd;
      }
    }

    const endDateIso = normalizeToIsoDate(endDateRaw) ?? '';
    if (!endDateIso) {
      pushErr(
        'Tgl_Jatuh_Tempo',
        endDateRaw,
        'Format Tgl Jatuh Tempo harus YYYY-MM-DD atau DD/MM/YYYY yang valid.'
      );
    }

    const parsedPrincipal = parseNonNegativeNumeric(principalRaw);
    if (parsedPrincipal === null || parsedPrincipal <= 0) {
      pushErr(
        'Nilai_Pinjaman',
        principalRaw,
        'Nilai Pinjaman harus berupa angka positif > 0.'
      );
    }

    const parsedBunga = parseNonNegativeNumeric(bungaRaw);
    if (parsedBunga === null || parsedBunga < 0) {
      pushErr(
        'Bunga_Per_Bulan',
        bungaRaw,
        'Bunga Per Bulan harus berupa angka >= 0.'
      );
    }

    const parsedBonus = parseNonNegativeNumeric(bonusRaw);
    if (parsedBonus === null || parsedBonus < 0) {
      pushErr('Bonus', bonusRaw, 'Bonus harus berupa angka >= 0.');
    }

    const resolvedBonusDate = bonusDateRaw
      ? normalizeToIsoDate(bonusDateRaw) ?? ''
      : endDateIso;
    if (bonusDateRaw && !resolvedBonusDate) {
      pushErr(
        'Tgl_Bonus_Dicairkan',
        bonusDateRaw,
        'Format Tgl Bonus Dicairkan harus YYYY-MM-DD atau DD/MM/YYYY yang valid.'
      );
    }

    const metodeLower = metodeRaw.toLowerCase();
    const isPokokPlusBunga =
      metodeLower === 'pokok + bunga' ||
      metodeLower === 'pokok+bunga' ||
      metodeLower === 'anuitas';
    const isPokokAkhir =
      metodeLower === 'pokok di akhir' || metodeLower === 'balloon';
    if (!isPokokPlusBunga && !isPokokAkhir) {
      pushErr(
        'Metode',
        metodeRaw,
        'Metode harus "Pokok di Akhir" atau "Pokok + Bunga".'
      );
    }

    const parsedDenda = parseNonNegativeNumeric(dendaRaw);
    if (parsedDenda === null || parsedDenda < 0) {
      pushErr('Denda', dendaRaw, 'Denda harus berupa angka >= 0.');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    const principalVal = parsedPrincipal!;
    const bungaVal = parsedBunga!;
    const bonusVal = parsedBonus ?? 0;
    const dendaVal = parsedDenda ?? 0;
    const tenorVal = parsedTenor!;
    const paymentMethod = isPokokPlusBunga ? 'ANUITAS' : 'BALLOON';

    let fixedPrincipalPerMonth = 0;
    let monthlyInterestAmount = bungaVal;
    let monthlyInstallment = bungaVal;

    if (paymentMethod === 'ANUITAS') {
      const rawFixed = Math.round(principalVal / Math.max(1, tenorVal));
      fixedPrincipalPerMonth = bungaVal > 0 ? Math.min(rawFixed, bungaVal) : rawFixed;
      monthlyInterestAmount = Math.max(0, bungaVal - fixedPrincipalPerMonth);
      monthlyInstallment = bungaVal > 0 ? bungaVal : fixedPrincipalPerMonth;
    }

    const endDate = endDateIso || computeLoanEndDate(startDate, tenorVal);
    const notesClean =
      keteranganRaw && keteranganRaw.toLowerCase() !== metodeLower ? keteranganRaw : '';

    totalPrincipal += principalVal;
    totalMonthlyInterest += bungaVal;
    totalBonus += bonusVal;

    const seqNum = Number.parseInt(rawNo, 10);
    const seqPadded = String(
      Number.isFinite(seqNum) && seqNum > 0 ? seqNum : parsedRows.length + 1
    ).padStart(2, '0');

    parsedRows.push({
      rowIndex: parsedRows.length + 1,
      deterministicId: deterministicUuid(`inv_kkb_${seqPadded}`),
      rawNo,
      input: {
        contractNumber,
        name: investorName,
        institution: investorName,
        category: 'Pinjaman / Kredit',
        principalAmount: principalVal,
        paymentMethod,
        fixedPrincipalPerMonth,
        interestInputType: 'RP',
        monthlyInterestAmount,
        monthlyInterestRate: 0,
        lateFeeInputType: 'RP',
        lateFeePerMonthAmount: dendaVal,
        lateFeePerMonthRate: 0,
        bonusInputType: 'RP',
        bonusAmount: bonusVal,
        bonusRate: 0,
        bonusDate: resolvedBonusDate || endDate,
        monthlyInstallment,
        tenorMonths: tenorVal,
        startMonthKey: addMonthsToInvestmentKey(startDate.slice(0, 7), 1),
        startDate,
        endDate,
        cutoffDate: DEFAULT_INVESTMENT_CUTOFF_DATE,
        legacyLateFeeBeforeCutoff: 0,
        ...(parsedDueDay ? { dueDay: parsedDueDay } : {}),
        paidMonths: [],
        status: 'Aktif',
        notes: notesClean,
      },
    });
  }

  const principalMismatch =
    requireExactTotals && totalPrincipal !== EXPECTED_KKB_TOTAL_PRINCIPAL;
  const interestMismatch =
    requireExactTotals && totalMonthlyInterest !== EXPECTED_KKB_TOTAL_MONTHLY_INTEREST;

  if (principalMismatch) {
    const diff = totalPrincipal - EXPECTED_KKB_TOTAL_PRINCIPAL;
    errors.push({
      lineNumber: 0,
      rowNo: 'TOTAL',
      contractNumber: '-',
      investorName: '-',
      field: 'Total Nilai Pinjaman',
      rawValue: `Rp ${formatNumberID(totalPrincipal)}`,
      message: `Total Nilai Pinjaman Rp ${formatNumberID(
        totalPrincipal
      )} tidak sama dengan target Rp ${formatNumberID(
        EXPECTED_KKB_TOTAL_PRINCIPAL
      )} (selisih ${diff >= 0 ? '+' : ''}Rp ${formatNumberID(diff)}).`,
    });
  }

  if (interestMismatch) {
    const diff = totalMonthlyInterest - EXPECTED_KKB_TOTAL_MONTHLY_INTEREST;
    errors.push({
      lineNumber: 0,
      rowNo: 'TOTAL',
      contractNumber: '-',
      investorName: '-',
      field: 'Total Bunga Per Bulan',
      rawValue: `Rp ${formatNumberID(totalMonthlyInterest)}`,
      message: `Total Bunga Per Bulan Rp ${formatNumberID(
        totalMonthlyInterest
      )} tidak sama dengan target Rp ${formatNumberID(
        EXPECTED_KKB_TOTAL_MONTHLY_INTEREST
      )} (selisih ${diff >= 0 ? '+' : ''}Rp ${formatNumberID(diff)}).`,
    });
  }

  const valid = errors.length === 0 && parsedRows.length > 0;
  let summaryMessage = '';
  if (valid) {
    summaryMessage = `${parsedRows.length} kontrak valid. Total Nilai Pinjaman Rp ${formatNumberID(
      totalPrincipal
    )} & Total Bunga Per Bulan Rp ${formatNumberID(totalMonthlyInterest)} cocok.`;
  } else {
    summaryMessage = `Import ditolak (${errors.length} kesalahan validasi). Periksa baris yang ditandai sebelum melanjutkan.`;
  }

  return {
    valid,
    rows: parsedRows,
    errors,
    totalPrincipal,
    totalMonthlyInterest,
    totalBonus,
    principalMismatch,
    interestMismatch,
    summaryMessage,
  };
}
