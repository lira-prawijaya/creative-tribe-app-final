export type StatusColorKey = 'white' | 'green' | 'red';
export type StatusWarna = 'PUTIH' | 'HIJAU' | 'MERAH';
export type StandardDbStatus = 'Not Paid' | 'Paid' | 'Reschedule';

export interface StatusWarnaDropdownOption {
  color: 'green' | 'red';
  status: 'Paid' | 'Reschedule';
  statusWarna: 'HIJAU' | 'MERAH';
  label: 'Paid' | 'Pending';
  dotClass: string;
  itemClass: string;
}

/**
 * STRICTLY 2 OPTIONS ONLY in every Status dropdown across the entire app:
 * - Paid
 * - Pending
 *
 * Projection is NEVER a selectable dropdown option; it is only the default
 * display when a new item is created and neither Paid nor Pending has been chosen.
 */
export const STATUS_WARNA_DROPDOWN_OPTIONS: readonly StatusWarnaDropdownOption[] = [
  {
    color: 'green',
    status: 'Paid',
    statusWarna: 'HIJAU',
    label: 'Paid',
    dotClass: 'bg-emerald-500',
    itemClass: 'text-emerald-900 hover:bg-emerald-50',
  },
  {
    color: 'red',
    status: 'Reschedule',
    statusWarna: 'MERAH',
    label: 'Pending',
    dotClass: 'bg-red-500',
    itemClass: 'text-red-900 hover:bg-red-50',
  },
] as const;

export const STATUS_WARNA_DISPLAY_META: Record<
  StatusColorKey,
  {
    color: StatusColorKey;
    status: StandardDbStatus;
    statusWarna: StatusWarna;
    label: string;
    badgeClass: string;
    rowClass: string;
    dotClass: string;
  }
> = {
  white: {
    color: 'white',
    status: 'Not Paid',
    statusWarna: 'PUTIH',
    label: 'Projection',
    badgeClass: 'bg-white text-slate-800 border-slate-300',
    rowClass: 'bg-white hover:bg-slate-50/70',
    dotClass: 'bg-slate-300 border border-slate-400',
  },
  green: {
    color: 'green',
    status: 'Paid',
    statusWarna: 'HIJAU',
    label: 'Paid',
    badgeClass: 'bg-emerald-50 text-emerald-900 border-emerald-300',
    rowClass: 'bg-emerald-50/60 hover:bg-emerald-50',
    dotClass: 'bg-emerald-500',
  },
  red: {
    color: 'red',
    status: 'Reschedule',
    statusWarna: 'MERAH',
    label: 'Pending',
    badgeClass: 'bg-slate-200 text-slate-700 border-slate-300',
    rowClass: 'bg-slate-100/80 text-slate-400 opacity-80',
    dotClass: 'bg-slate-400',
  },
};

/**
 * Normalizes any persisted or legacy status + status_warna pair to canonical
 * color key ('white' | 'green' | 'red').
 */
export function normalizeStatusToColor(
  status?: string | null,
  statusWarna?: string | null
): StatusColorKey {
  const s = (status ?? '').trim().toLowerCase();
  const w = (statusWarna ?? '').trim().toUpperCase();

  if (
    w === 'HIJAU' ||
    s === 'paid' ||
    s === 'sudah bayar' ||
    s === 'lunas' ||
    s === 'green' ||
    s === 'hijau'
  ) {
    return 'green';
  }

  if (
    w === 'MERAH' ||
    s === 'reschedule' ||
    s === 'rescheduling' ||
    s === 'red' ||
    s === 'merah' ||
    s === 'ditunda'
  ) {
    return 'red';
  }

  return 'white';
}

export function colorToDbStatusFields(color: StatusColorKey): {
  status: StandardDbStatus;
  statusWarna: StatusWarna;
} {
  if (color === 'green') {
    return { status: 'Paid', statusWarna: 'HIJAU' };
  }
  if (color === 'red') {
    return { status: 'Reschedule', statusWarna: 'MERAH' };
  }
  return { status: 'Not Paid', statusWarna: 'PUTIH' };
}

export function getStatusWarnaLabel(color: StatusColorKey): string {
  return STATUS_WARNA_DISPLAY_META[color].label;
}

/**
 * Shifts a YYYY-MM-DD ISO date into targetMonthKey (YYYY-MM), clamping day
 * to the maximum days in the destination month.
 */
export function shiftIsoDateToMonth(
  isoDate: string | undefined | null,
  targetMonthKey: string,
  fallbackDay = 1
): string {
  const mMatch = /^(\d{4})-(\d{2})$/.exec((targetMonthKey ?? '').trim());
  if (!mMatch) return isoDate || '';
  const year = Number(mMatch[1]);
  const month = Number(mMatch[2]);
  const rawDay =
    isoDate && /^\d{4}-\d{2}-\d{2}/.test(isoDate)
      ? Number(isoDate.slice(8, 10))
      : fallbackDay;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(1, Number.isFinite(rawDay) ? rawDay : fallbackDay), maxDay);
  return `${mMatch[1]}-${mMatch[2]}-${String(clampedDay).padStart(2, '0')}`;
}

const SHORT_MONTHS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const FULL_MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatMonthShortID(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((monthKey ?? '').trim());
  if (!m) return monthKey;
  const idx = Number(m[2]) - 1;
  return `${SHORT_MONTHS_ID[idx] ?? m[2]} ${m[1]}`;
}

export function formatMonthFullID(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((monthKey ?? '').trim());
  if (!m) return monthKey;
  const idx = Number(m[2]) - 1;
  return `${FULL_MONTHS_ID[idx] ?? m[2]} ${m[1]}`;
}

export function addMonthKeys(monthKey: string, offset: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec((monthKey ?? '').trim());
  if (!m) return monthKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + offset, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

export function buildDestinationMonthOptions(
  originMonthKey: string,
  monthsAhead = 18
): Array<{ monthKey: string; shortLabel: string; fullLabel: string }> {
  const base = /^\d{4}-\d{2}$/.test(originMonthKey)
    ? originMonthKey
    : new Date().toISOString().slice(0, 7);
  const options: Array<{ monthKey: string; shortLabel: string; fullLabel: string }> = [];
  for (let i = -3; i <= monthsAhead; i += 1) {
    if (i === 0) continue;
    const mk = addMonthKeys(base, i);
    options.push({
      monthKey: mk,
      shortLabel: formatMonthShortID(mk),
      fullLabel: formatMonthFullID(mk),
    });
  }
  return options;
}
