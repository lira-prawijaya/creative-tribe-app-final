export type OpexPaymentStatus =
  | 'Belum Bayar'
  | 'Sudah Bayar'
  | 'Lunas'
  | 'Pending'
  | 'Terlambat'
  | 'Not Paid'
  | 'Paid'
  | 'Reschedule';

export type OpexStatusWarna = 'PUTIH' | 'HIJAU' | 'MERAH';

export type OpexCategory =
  | 'OPERASIONAL'
  | 'Gaji & SDM'
  | 'Utilitas & Kantor'
  | 'Pajak & Iuran'
  | 'Konsultan & Jasa'
  | 'Operasional Lainnya'
  | (string & {});

export const OPEX_CATEGORIES: string[] = [
  'OPERASIONAL',
  'Gaji & SDM',
  'Utilitas & Kantor',
  'Pajak & Iuran',
  'Konsultan & Jasa',
  'Operasional Lainnya',
];

export interface OpexItem {
  id: string;
  name: string; // mapped to/from opex.description
  category: OpexCategory;
  amount: number;
  actualAmount?: number;
  realisasiAmount?: number;
  monthKey: string; // mapped to/from opex.month & opex.month_key (YYYY-MM)
  expenseDate?: string; // mapped to/from opex.expense_date (YYYY-MM-DD)
  endMonthKey?: string; // Optional end month for recurring YYYY-MM
  dueDay?: number; // Tanggal jatuh tempo 1..31
  sourceAccountId?: string; // ID rekening sumber dari Projection
  sourceAccountName?: string; // Nama rekening sumber (fallback matching)
  isRecurring: boolean;
  status: OpexPaymentStatus;
  statusWarna?: OpexStatusWarna;
  rescheduledFromMonth?: string;
  rescheduledToMonth?: string;
  rescheduledMonths?: Record<string, string>; // originMonthKey -> targetMonthKey
  deleteReason?: string;
  monthStatuses?: Record<string, OpexPaymentStatus>;
  monthRealisasi?: Record<string, number>;
  paidDates?: Record<string, string>; // YYYY-MM -> YYYY-MM-DD
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OpexInput {
  name: string;
  category: OpexCategory;
  amount: number;
  actualAmount?: number;
  realisasiAmount?: number;
  monthKey: string;
  expenseDate?: string;
  endMonthKey?: string;
  dueDay?: number;
  sourceAccountId?: string;
  sourceAccountName?: string;
  isRecurring: boolean;
  status: OpexPaymentStatus;
  statusWarna?: OpexStatusWarna;
  rescheduledFromMonth?: string;
  rescheduledToMonth?: string;
  rescheduledMonths?: Record<string, string>;
  monthStatuses?: Record<string, OpexPaymentStatus>;
  monthRealisasi?: Record<string, number>;
  paidDates?: Record<string, string>;
  notes?: string;
}

export function normalizeOpexStatus(
  status: OpexPaymentStatus,
  statusWarna?: OpexStatusWarna | string
): 'Not Paid' | 'Paid' | 'Reschedule' {
  const w = String(statusWarna ?? '').trim().toUpperCase();
  const s = String(status ?? '').trim().toLowerCase();
  if (w === 'HIJAU' || s === 'sudah bayar' || s === 'lunas' || s === 'paid' || s === 'hijau') {
    return 'Paid';
  }
  if (w === 'MERAH' || s === 'reschedule' || s === 'rescheduling' || s === 'merah') {
    return 'Reschedule';
  }
  return 'Not Paid';
}

export function mapOpexStatusToDbFields(
  status?: OpexPaymentStatus | string,
  statusWarna?: OpexStatusWarna | string
): { dbStatus: 'Not Paid' | 'Paid' | 'Reschedule'; dbWarna: OpexStatusWarna } {
  const w = String(statusWarna ?? '').trim().toUpperCase();
  const s = String(status ?? '').trim().toLowerCase();
  if (w === 'HIJAU' || s === 'paid' || s === 'sudah bayar' || s === 'lunas' || s === 'green') {
    return { dbStatus: 'Paid', dbWarna: 'HIJAU' };
  }
  if (w === 'MERAH' || s === 'reschedule' || s === 'rescheduling' || s === 'red') {
    return { dbStatus: 'Reschedule', dbWarna: 'MERAH' };
  }
  return { dbStatus: 'Not Paid', dbWarna: 'PUTIH' };
}

export function mapOpexDbFieldsToColor(
  status?: unknown,
  statusWarna?: unknown
): 'white' | 'green' | 'red' {
  const w = String(statusWarna ?? '').trim().toUpperCase();
  const s = String(status ?? '').trim().toLowerCase();
  if (w === 'HIJAU' || s === 'paid' || s === 'sudah bayar' || s === 'lunas' || s === 'green') {
    return 'green';
  }
  if (w === 'MERAH' || s === 'reschedule' || s === 'rescheduling' || s === 'red') {
    return 'red';
  }
  return 'white';
}

export const OPEX_STATUS_META: Record<
  'Not Paid' | 'Paid' | 'Reschedule',
  { label: string; badgeClass: string }
> = {
  'Not Paid': {
    label: 'Projection',
    badgeClass: 'bg-white text-slate-700 border-slate-300',
  },
  Paid: {
    label: 'Paid',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  Reschedule: {
    label: 'Pending',
    badgeClass: 'bg-red-50 text-red-800 border-red-300',
  },
};

export const OPEX_SCHEMA_LIMITS = {
  nameMax: 200,
  accountMax: 200,
  notesMax: 500,
  maxAmount: 100_000_000_000_000,
  monthKeyPattern: /^\d{4}-\d{2}$/,
} as const;
