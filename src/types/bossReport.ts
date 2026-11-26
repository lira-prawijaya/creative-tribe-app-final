export type BossReportColorStatus = 'white' | 'green' | 'red';
export type CashInColorStatus = BossReportColorStatus;
export type CashOutColorStatus = BossReportColorStatus;

export type BossReportSectionKey =
  | 'cashIn'
  | 'operasional'
  | 'investment'
  | 'projectCost';

export type BossReportSourceCategory =
  | 'clientInvoice'
  | 'opex'
  | 'investment'
  | 'vendorPO'
  | 'manual';

export type InvestmentComponentKind =
  | 'principal'
  | 'interest'
  | 'lateFee'
  | 'bonus';

export interface BankAccountRow {
  id: string;
  name: string;
  balance: number;
  isPrimary?: boolean;
}

export type RolloverKind = 'pending' | 'auto';

export interface BossReportManualItem {
  id: string;
  name: string;
  amount: number;
  actualAmount?: number; // Manual Realisasi (override saat status === 'green')
  realisasiAmount?: number;
  actual_amount?: number;
  color: BossReportColorStatus;
  accountId?: string;
  rescheduledToMonth?: string; // YYYY-MM when color === 'red'
  rolloverKind?: RolloverKind;
}

export interface BossReportAutoOverride {
  sourceId: string;
  hasCustomName: boolean;
  name: string;
  hasCustomAmount: boolean;
  amount: number;
  hasCustomRealisasi?: boolean;
  realisasiAmount?: number;
  actual_amount?: number;
  hasCustomColor: boolean;
  color: BossReportColorStatus;
  rescheduledToMonth?: string; // YYYY-MM when color === 'red'
  rolloverKind?: RolloverKind;
}

export interface BossReportRescheduledItem {
  id: string; // deterministic: rs_{originMonthKey}_{sourceId}
  section: BossReportSectionKey;
  sourceCategory: BossReportSourceCategory;
  sourceId: string;
  originMonthKey: string; // Initial month YYYY-MM
  fromMonthKey: string; // Immediate previous month YYYY-MM
  rescheduledFromMonth?: string; // Alias/explicit immediate source month YYYY-MM
  historyMonths: string[]; // ['2026-12', '2027-01', ...]
  name: string;
  amount: number;
  hasCustomRealisasi?: boolean;
  realisasiAmount?: number;
  actual_amount?: number;
  color: BossReportColorStatus;
  accountId?: string;
  dueISO?: string;
  rescheduledToMonth?: string; // YYYY-MM when color === 'red'
  rolloverKind?: RolloverKind;
  investmentAssetId?: string;
  investmentComponent?: InvestmentComponentKind;
  investmentInstallmentNumber?: number;
  investmentInstallmentMonthKey?: string;
  hasCustomOverride?: boolean;
}

export interface BossReportMonthData {
  monthKey: string; // YYYY-MM
  asOfDate: string; // YYYY-MM-DD
  cutoffGlobalDate?: string; // YYYY-MM-DD (Cutoff Global Bunga untuk periode ini)
  accounts: BankAccountRow[];
  manualOpeningBalance?: number;
  cashInManual: BossReportManualItem[];
  operasional: BossReportManualItem[];
  investment: BossReportManualItem[];
  projectCostManual: BossReportManualItem[];
  autoOverrides: BossReportAutoOverride[];
  rescheduledIn?: BossReportRescheduledItem[];
  updatedAt?: unknown;
}

export const BOSS_REPORT_SCHEMA_LIMITS = {
  monthKeyPattern: /^\d{4}-\d{2}$/,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
  maxAccounts: 50,
  maxItemsPerGroup: 100,
  maxOverrides: 150,
  maxRescheduledIn: 150,
  accountNameMax: 200,
  itemNameMax: 300,
  maxAmount: 100_000_000_000_000,
} as const;

export const DEFAULT_BANK_ACCOUNT_NAMES: string[] = [
  'PT Kreatif Kebanggaan Bangsa - Utama',
  'PT Kreatif Kebanggaan Bangsa - Operasional',
  'PT Kreatif Kebanggaan Bangsa - Project 1',
  'PT Kreatif Kebanggaan Bangsa - BRI KCP Bintaro',
  'PT Kreatif Kebanggaan Bangsa - BRI Rasuna',
  'BNI Menteng Bintaro',
  'KAS an Adji',
  'PT Kreatif Kebanggaan Bangsa - Project 2 / PPN',
  'Plafon KMK',
];

export const OPERASIONAL_TEMPLATE_ITEMS: string[] = [
  'Gaji',
  'Other Expense',
  'Listrik IDPEL',
  'Konsultan',
  'Belanja Dapur',
  'Internet',
  'CC',
  'Iuran IPL',
  'Iuran Security',
  'PPN',
  'Hutang PPN',
  'Asuransi',
  'Training',
  'Iuran tahunan P3I',
];

export const INVESTMENT_TEMPLATE_ITEMS: string[] = [
  'Cicilan BRI',
  'Bunga',
  'Pokok',
  'Bonus Daiva',
  'Alphard',
];

export const BOSS_REPORT_COLOR_META: Array<{
  value: BossReportColorStatus;
  shortLabel: string;
  label: string;
  rowClass: string;
  badgeClass: string;
}> = [
  {
    value: 'white',
    shortLabel: 'PROJECTION',
    label: 'Projection',
    rowClass: 'bg-white',
    badgeClass: 'bg-white text-slate-700 border-slate-300',
  },
  {
    value: 'green',
    shortLabel: 'PAID',
    label: 'Paid',
    rowClass: 'bg-emerald-50',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  {
    value: 'red',
    shortLabel: 'PENDING',
    label: 'Pending',
    rowClass: 'bg-slate-100/80 text-slate-400 opacity-80',
    badgeClass: 'bg-slate-200 text-slate-700 border-slate-300',
  },
];

export const CASH_IN_COLOR_META = BOSS_REPORT_COLOR_META;
export const CASH_OUT_COLOR_META = BOSS_REPORT_COLOR_META;
