export type InvestmentCategory =
  | 'Pinjaman / Kredit'
  | 'Aset Tetap'
  | 'Investasi Modal'
  | 'Lainnya';

export type InvestmentStatus = 'Aktif' | 'Lunas' | 'Ditunda';

export type InvestmentPaymentMethod = 'ANUITAS' | 'BALLOON';

export type InterestInputType = 'RP' | 'PERCENT';

export const DEFAULT_INVESTMENT_CUTOFF_DATE = '2026-02-01';

export const INVESTMENT_CATEGORIES: InvestmentCategory[] = [
  'Pinjaman / Kredit',
  'Aset Tetap',
  'Investasi Modal',
  'Lainnya',
];

export const INVESTMENT_PAYMENT_METHODS: Array<{
  value: InvestmentPaymentMethod;
  label: string;
  shortLabel: string;
  badgeClass: string;
  description: string;
}> = [
  {
    value: 'ANUITAS',
    label: 'Pokok + Bunga (Angsuran Tetap)',
    shortLabel: 'Pokok + Bunga',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    description:
      'Setiap bulan bayar Total Cicilan (Pokok + Bunga digabung). Porsi pokok dibagi rata per periode.',
  },
  {
    value: 'BALLOON',
    label: 'Pokok di Akhir (Bunga Saja / Balloon)',
    shortLabel: 'Pokok di Akhir',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    description:
      'Setiap bulan hanya bayar Bunga. Di akhir periode, bayar Pokok + Bunga. Bunga tetap jalan selama Pokok belum lunas.',
  },
];

export interface InvestmentOriginalContract {
  contractNumber?: string;
  principalAmount: number;
  paymentMethod: InvestmentPaymentMethod;
  fixedPrincipalPerMonth: number;
  interestInputType: InterestInputType;
  monthlyInterestAmount: number;
  monthlyInterestRate: number;
  lateFeeInputType: InterestInputType;
  lateFeePerMonthAmount: number;
  lateFeePerMonthRate: number;
  bonusInputType: InterestInputType;
  bonusAmount: number;
  bonusRate: number;
  bonusDate: string;
  tenorMonths: number;
  startMonthKey: string;
  startDate: string;
  endDate: string;
  dueDay?: number;
  notes?: string;
}

export interface InvestmentAddendum {
  id: string;
  sequenceNumber: number;
  addendumDate: string; // YYYY-MM-DD
  addendumNumber: string; // Nomor Adendum / Kontrak Baru
  additionalTenorMonths: number;
  previousTenorMonths: number;
  newTotalTenorMonths: number;
  previousEndDate: string; // YYYY-MM-DD
  newEndDate: string; // YYYY-MM-DD
  additionalPrincipal: number;
  effectiveFromInstallment: number; // Cicilan ke-berapa adendum berlaku
  newInterestInputType: InterestInputType;
  newMonthlyInterestAmount: number;
  newMonthlyInterestRate: number;
  newMonthlyInstallment?: number;
  newLateFeeInputType: InterestInputType;
  newLateFeePerMonthAmount: number;
  newLateFeePerMonthRate: number;
  newBonusInputType: InterestInputType;
  newBonusAmount: number;
  newBonusRate: number;
  newBonusDate: string; // YYYY-MM-DD
  notes?: string;
  pdfFileName?: string;
  pdfAttachmentId?: string;
  createdAt?: string;
}

export interface InvestmentAsset {
  id: string;
  contractNumber?: string; // No. Kontrak (contoh: WB-KKB.01.I/2026)
  name: string; // Nama Investor / Pinjaman
  institution: string;
  category: InvestmentCategory;
  principalAmount: number; // Nilai Pinjaman / Pokok
  paymentMethod: InvestmentPaymentMethod; // ANUITAS (Pokok + Bunga) | BALLOON (Pokok di Akhir)
  fixedPrincipalPerMonth: number; // Porsi pokok tetap per bulan (Rp) untuk Metode Pokok + Bunga
  interestInputType: InterestInputType; // 'RP' | 'PERCENT'
  monthlyInterestAmount: number; // Nominal bunga (Rp / bln) jika pilih 'RP'
  monthlyInterestRate: number; // Persentase bunga (% / bln) jika pilih 'PERCENT'
  lateFeeInputType?: InterestInputType; // 'RP' (Rp/bln) | 'PERCENT' (%/bln dari Sisa Pokok)
  lateFeePerMonthAmount?: number; // Nominal denda per bulan (Rp)
  lateFeePerMonthRate?: number; // Persentase denda per bulan (%) dari Sisa Pokok
  bonusInputType?: InterestInputType; // 'RP' | 'PERCENT'
  bonusAmount?: number; // Nominal bonus (Rp) jika pilih 'RP'
  bonusRate?: number; // Persentase bonus (%) dari Nilai Pokok / Sisa Pokok jika pilih 'PERCENT'
  bonusDate?: string; // Tanggal Bonus Dicairkan (YYYY-MM-DD, default = endDate)
  monthlyInstallment: number; // Referensi total cicilan per bulan
  tenorMonths: number; // Periode / Tenor dalam bulan (1..360)
  startMonthKey: string; // Mulai Cicilan Bulan YYYY-MM
  startDate?: string; // Tgl Kontrak / Tanggal Awal Pinjaman YYYY-MM-DD
  endDate?: string; // Tgl Jatuh Tempo / Tanggal Akhir Pinjaman YYYY-MM-DD
  cutoffDate?: string; // Tanggal Cutoff Denda YYYY-MM-DD (default: 2026-02-01)
  legacyLateFeeBeforeCutoff?: number; // Sisa Denda Lama sebelum Cutoff (Rp)
  dueDay?: number; // Tgl. Bayar Bunga tiap bulan (1..31, opsional)
  paidMonths: string[]; // Daftar YYYY-MM yang sudah lunas
  monthStatuses?: Record<string, 'Not Paid' | 'Paid' | 'Reschedule'>;
  monthStatusWarnas?: Record<string, 'PUTIH' | 'HIJAU' | 'MERAH'>;
  rescheduledMonths?: Record<string, string>; // originMonthKey -> targetMonthKey
  monthRealisasi?: Record<string, number>;
  status: InvestmentStatus;
  disbursementStatus?: 'white' | 'green' | 'red';
  disbursementStatusWarna?: 'PUTIH' | 'HIJAU' | 'MERAH';
  disbursementPaidDate?: string;
  disbursementRealisasiAmount?: number;
  disbursementRescheduledFromMonth?: string;
  disbursementRescheduledToMonth?: string;
  notes?: string;
  originalContract?: InvestmentOriginalContract;
  addendums?: InvestmentAddendum[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InvestmentInput {
  contractNumber?: string;
  name: string;
  institution: string;
  category: InvestmentCategory;
  principalAmount: number;
  paymentMethod: InvestmentPaymentMethod;
  fixedPrincipalPerMonth: number;
  interestInputType: InterestInputType;
  monthlyInterestAmount: number;
  monthlyInterestRate: number;
  lateFeeInputType?: InterestInputType;
  lateFeePerMonthAmount?: number;
  lateFeePerMonthRate?: number;
  bonusInputType?: InterestInputType;
  bonusAmount?: number;
  bonusRate?: number;
  bonusDate?: string;
  monthlyInstallment: number;
  tenorMonths: number;
  startMonthKey: string;
  startDate?: string;
  endDate?: string;
  cutoffDate?: string;
  legacyLateFeeBeforeCutoff?: number;
  dueDay?: number;
  paidMonths: string[];
  monthStatuses?: Record<string, 'Not Paid' | 'Paid' | 'Reschedule'>;
  monthStatusWarnas?: Record<string, 'PUTIH' | 'HIJAU' | 'MERAH'>;
  rescheduledMonths?: Record<string, string>;
  monthRealisasi?: Record<string, number>;
  status: InvestmentStatus;
  disbursementStatus?: 'white' | 'green' | 'red';
  disbursementStatusWarna?: 'PUTIH' | 'HIJAU' | 'MERAH';
  disbursementPaidDate?: string;
  disbursementRealisasiAmount?: number;
  disbursementRescheduledFromMonth?: string;
  disbursementRescheduledToMonth?: string;
  notes?: string;
  originalContract?: InvestmentOriginalContract;
  addendums?: InvestmentAddendum[];
}

export interface InvestmentAddendumFormSubmission {
  addendumDate: string;
  addendumNumber: string;
  additionalTenorMonths: number;
  newEndDate: string;
  additionalPrincipal: number;
  newInterestInputType: InterestInputType;
  newMonthlyInterestAmount: number;
  newMonthlyInterestRate: number;
  newMonthlyInstallment?: number;
  newLateFeeInputType: InterestInputType;
  newLateFeePerMonthAmount: number;
  newLateFeePerMonthRate: number;
  newBonusInputType: InterestInputType;
  newBonusAmount: number;
  newBonusRate: number;
  newBonusDate: string;
  notes: string;
  pdfFileName?: string;
  pdfDataUrl?: string;
}

export const INVESTMENT_STATUS_META: Record<
  InvestmentStatus,
  { label: string; badgeClass: string }
> = {
  Aktif: {
    label: 'Aktif Berjalan',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  Lunas: {
    label: 'Lunas',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  Ditunda: {
    label: 'Ditunda',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
};

export const INVESTMENT_SCHEMA_LIMITS = {
  nameMax: 200,
  institutionMax: 200,
  notesMax: 500,
  addendumNumberMax: 80,
  pdfFileNameMax: 200,
  maxAddendums: 50,
  maxAmount: 100_000_000_000_000,
  maxRatePercent: 100,
  maxTenor: 360,
  monthKeyPattern: /^\d{4}-\d{2}$/,
  componentMonthKeyPattern: /^\d{4}-\d{2}(?:__(?:principal|interest|lateFee|bonus))?$/,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
} as const;

export type InvestmentComponentKey = 'principal' | 'interest' | 'lateFee' | 'bonus';

export const INVESTMENT_COMPONENT_KEYS: readonly InvestmentComponentKey[] = [
  'principal',
  'interest',
  'lateFee',
  'bonus',
] as const;

export function buildInvestmentComponentPeriodKey(
  monthKey: string,
  component?: InvestmentComponentKey
): string {
  const cleanMonth = String(monthKey ?? '').trim();
  return component ? `${cleanMonth}__${component}` : cleanMonth;
}

export function parseInvestmentComponentPeriodKey(rawKey: string): {
  monthKey: string;
  component?: InvestmentComponentKey;
} | null {
  const trimmed = String(rawKey ?? '').trim();
  const match = /^(\d{4}-\d{2})(?:__(principal|interest|lateFee|bonus))?$/.exec(trimmed);
  if (!match) return null;
  return {
    monthKey: match[1],
    ...(match[2] ? { component: match[2] as InvestmentComponentKey } : {}),
  };
}

export function hasInvestmentComponentEntriesForMonth(
  keys: Iterable<string>,
  monthKey: string
): boolean {
  const prefix = `${monthKey}__`;
  for (const k of keys) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}

export function isInvestmentComponentPaidInSet(
  paidSet: ReadonlySet<string>,
  monthKey: string,
  component: InvestmentComponentKey
): boolean {
  if (paidSet.has(`${monthKey}__${component}`)) {
    return true;
  }
  if (hasInvestmentComponentEntriesForMonth(paidSet, monthKey)) {
    return false;
  }
  return paidSet.has(monthKey);
}

