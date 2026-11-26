import {
  DEFAULT_INVESTMENT_CUTOFF_DATE,
  InterestInputType,
  INVESTMENT_SCHEMA_LIMITS,
  InvestmentAsset,
  InvestmentPaymentMethod,
  isInvestmentComponentPaidInSet,
} from '../types/investment';
import { getTodayISODate, normalizeToIsoDate } from './format';

export interface InvestmentInstallmentRow {
  installmentNumber: number; // 1..tenorMonths (0 if maturity-only or bonus-only row outside 1..tenorMonths)
  monthKey: string; // YYYY-MM
  dueISO: string; // YYYY-MM-DD
  remainingPrincipalBefore: number;
  principalPaid: number;
  interestPaid: number; // Bunga bulan itu (otomatis Rp 0 jika isLate = true)
  regularInterest?: number; // Bunga reguler 1 bulan sebelum pemotongan status terlambat
  bonusPaid: number; // Bonus dicairkan di bulan ini (0 di bulan lain)
  isBonusMonth: boolean;
  isBonusOnlyRow?: boolean;
  isMaturityRow?: boolean; // Khusus BALLOON jika Tanggal Akhir Pinjaman jatuh setelah cicilan #tenorMonths
  monthsLate: number; // Jumlah bulan keterlambatan jika belum bayar & lewat jatuh tempo
  isLate: boolean; // true jika tanggal jatuh tempo lewat & status belum bayar -> Denda menggantikan Bunga
  isPrincipalOverdue: boolean; // true jika pokok > 0, dueISO <= todayISO, dan belum bayar
  monthlyLateFee: number; // Nominal denda per bulan (Rp)
  lateFeeType: InterestInputType;
  lateFeeRate: number;
  lateFeeAmount: number; // Denda Total = monthlyLateFee * monthsLate
  lateChargeTotal: number; // Sama dengan lateFeeAmount (TIDAK menjumlahkan Bunga + Denda)
  totalInstallment: number; // Belum telat: Pokok + Bunga (+ Bonus); Telat: Pokok (+ Bonus)
  totalInstallmentWithLateFee: number; // Belum telat: Pokok + Bunga (+ Bonus); Telat: Pokok + Denda (+ Bonus)
  remainingPrincipalAfter: number;
  isPaid: boolean;
  isPrincipalPaid: boolean;
  isInterestPaid: boolean;
  isBonusPaid: boolean;
  addendumSequence?: number; // undefined = Kontrak Awal, 1..N = Adendum N
  addendumNumber?: string;
}

export interface InvestmentPortfolioTotals {
  paidPrincipal: number;
  paidInterest: number; // Hanya bulan tidak kena denda yang sudah lunas
  paidBonus: number;
  paidTotal: number;
  remainingPrincipal: number;
  remainingInterest: number; // Hanya bulan tidak kena denda yang belum bayar
  remainingBonus: number;
  totalBonusPayable: number;
  totalInterestFullTenor: number;
  totalPayableFullTenor: number;
  totalLateFeesAccrued: number; // Hanya bulan kena denda (monthsLate > 0)
  lateMonthsCount: number;
  overdueUnpaidPrincipal: number; // Total Pokok Jatuh Tempo Belum Dibayar
}

export function addMonthsToInvestmentKey(monthKey: string, offset: number): string {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

export function addMonthsKeepingDay(isoDate: string, monthsToAdd: number): string {
  const normalized = normalizeToIsoDate(isoDate) ?? isoDate;
  const [yStr, mStr, dStr] = (normalized || '').split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) {
    return isoDate;
  }
  const targetFirst = new Date(Date.UTC(y, m - 1 + monthsToAdd, 1));
  const ty = targetFirst.getUTCFullYear();
  const tm = targetFirst.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(1, d), maxDay);
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(
    clampedDay
  ).padStart(2, '0')}`;
}

export function computeLoanEndDate(startDate: string, tenorMonths: number): string {
  const normalized = normalizeToIsoDate(startDate);
  if (!normalized) return '';
  return addMonthsKeepingDay(normalized, Math.max(1, Math.round(tenorMonths || 1)));
}

/**
 * Hitung jumlah bulan keterlambatan penuh tanpa pro-rata harian.
 * Jika sudah lewat jatuh tempo (todayISO > dueISO): minimal 1 bulan (1x denda),
 * dan bertambah 1 untuk setiap selisih bulan kalender berikutnya.
 */
export function diffCalendarMonthsOverdue(dueISO: string, todayISO: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dueISO || '') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(todayISO || '')
  ) {
    return 0;
  }
  if (todayISO <= dueISO) return 0;
  const [dy, dm] = dueISO.split('-').map(Number);
  const [ty, tm] = todayISO.split('-').map(Number);
  const monthDiff = (ty - dy) * 12 + (tm - dm);
  return Math.max(1, monthDiff);
}

export function roundInterestRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(100, Math.round(rate * 10000) / 10000);
}

export function computeMonthlyInterestForBalance(params: {
  remainingPrincipal: number;
  interestInputType: InterestInputType;
  monthlyInterestAmount: number;
  monthlyInterestRate: number;
  paymentMethod?: InvestmentPaymentMethod;
  initialPrincipalBasis?: number;
}): number {
  const {
    remainingPrincipal,
    interestInputType,
    monthlyInterestAmount,
    monthlyInterestRate,
  } = params;
  if (interestInputType === 'PERCENT') {
    const rate = Math.max(0, Number(monthlyInterestRate) || 0) / 100;
    return Math.round(Math.max(0, remainingPrincipal) * rate);
  }
  return Math.max(0, Math.round(Number(monthlyInterestAmount) || 0));
}

export function computeMonthlyLateFeeForBalance(params: {
  remainingPrincipal: number;
  lateFeeInputType?: InterestInputType;
  lateFeePerMonthAmount?: number;
  lateFeePerMonthRate?: number;
}): number {
  const type: InterestInputType = params.lateFeeInputType === 'PERCENT' ? 'PERCENT' : 'RP';
  if (type === 'RP') {
    return Math.max(0, Math.round(Number(params.lateFeePerMonthAmount) || 0));
  }
  const rate = Math.max(0, Number(params.lateFeePerMonthRate) || 0) / 100;
  return Math.round(Math.max(0, params.remainingPrincipal) * rate);
}

export function computeBonusForAmount(params: {
  principalBasis: number;
  bonusInputType?: InterestInputType;
  bonusAmount?: number;
  bonusRate?: number;
}): number {
  const type: InterestInputType = params.bonusInputType === 'PERCENT' ? 'PERCENT' : 'RP';
  if (type === 'RP') {
    return Math.max(0, Math.round(Number(params.bonusAmount) || 0));
  }
  const rate = Math.max(0, Number(params.bonusRate) || 0) / 100;
  return Math.round(Math.max(0, params.principalBasis) * rate);
}

const MONTH_SHORT_ID = [
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

export function getInstallmentDueISODate(monthKey: string, dueDay = 1): string {
  const [yStr, mStr] = monthKey.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return `${monthKey}-01`;
  }
  const maxDay = new Date(y, m, 0).getDate();
  const safeDay = Math.min(Math.max(1, Math.round(dueDay || 1)), maxDay);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(safeDay).padStart(
    2,
    '0'
  )}`;
}

export function formatMonthYearShortID(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const m = Number(mStr);
  if (!Number.isFinite(m) || m < 1 || m > 12) return monthKey;
  return `${MONTH_SHORT_ID[m - 1]} ${yStr}`;
}

export function formatDDMMMYYYY(isoDate: string): string {
  const [yStr, mStr, dStr] = (isoDate || '').split('-');
  const m = Number(mStr);
  if (!Number.isFinite(m) || m < 1 || m > 12 || !dStr) return isoDate;
  return `${dStr.padStart(2, '0')} ${MONTH_SHORT_ID[m - 1]} ${yStr}`;
}

export function formatDDMMMYYYYDash(isoDate: string): string {
  const [yStr, mStr, dStr] = (isoDate || '').split('-');
  const m = Number(mStr);
  if (!Number.isFinite(m) || m < 1 || m > 12 || !dStr) return '-';
  return `${dStr.padStart(2, '0')}-${MONTH_SHORT_ID[m - 1]}-${yStr}`;
}

export function getFirstInstallmentMonthKey(
  asset: Pick<InvestmentAsset, 'startDate' | 'startMonthKey'>
): string {
  const isoStart = normalizeToIsoDate(asset.startDate);
  if (isoStart) {
    return addMonthsToInvestmentKey(isoStart.slice(0, 7), 1);
  }
  return asset.startMonthKey;
}

export function getEffectiveAssetStartDate(
  asset: Pick<InvestmentAsset, 'startDate' | 'startMonthKey' | 'dueDay'>
): string {
  const isoStart = normalizeToIsoDate(asset.startDate);
  if (isoStart) {
    return isoStart;
  }
  return getInstallmentDueISODate(asset.startMonthKey, asset.dueDay ?? 1);
}

export function getEffectiveAssetEndDate(
  asset: Pick<
    InvestmentAsset,
    'endDate' | 'startDate' | 'startMonthKey' | 'dueDay' | 'tenorMonths' | 'addendums'
  >
): string {
  if (Array.isArray(asset.addendums) && asset.addendums.length > 0) {
    const sorted = [...asset.addendums].sort((a, b) => b.sequenceNumber - a.sequenceNumber);
    for (const ad of sorted) {
      const adEnd = normalizeToIsoDate(ad.newEndDate);
      if (adEnd) {
        return adEnd;
      }
    }
  }
  const isoEnd = normalizeToIsoDate(asset.endDate);
  if (isoEnd) {
    return isoEnd;
  }
  return computeLoanEndDate(getEffectiveAssetStartDate(asset), asset.tenorMonths);
}

export function getEffectiveAssetCutoffDate(
  asset: Partial<Pick<InvestmentAsset, 'cutoffDate'>>
): string {
  return normalizeToIsoDate(asset.cutoffDate) ?? DEFAULT_INVESTMENT_CUTOFF_DATE;
}

export function getEffectiveAssetCutoffMonthKey(
  asset: Partial<Pick<InvestmentAsset, 'cutoffDate'>>
): string {
  return getEffectiveAssetCutoffDate(asset).slice(0, 7);
}

export function diffMonthKeysNonNegative(fromMonthKey: string, toMonthKey: string): number {
  if (
    !INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(fromMonthKey || '') ||
    !INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(toMonthKey || '')
  ) {
    return 0;
  }
  const [fy, fm] = fromMonthKey.split('-').map(Number);
  const [ty, tm] = toMonthKey.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/**
 * Rumus Projection Denda (dengan Cutoff Global Bunga):
 * Projection Denda = MAX(0, Bulan Periode Projection - MAX(Bulan Awal Kontrak, Bulan Cutoff Global)) x Bunga per bulan
 * Bunga / denda sebelum Bulan Cutoff Global dianggap sudah dibayar dan tidak muncul di Projection (0).
 */
export function computeCutoffProjectionLateFee(params: {
  currentMonthKey: string;
  contractStartMonthKey: string;
  cutoffMonthKey: string;
  monthlyInterestAmount: number;
}): {
  anchorMonthKey: string;
  monthsCount: number;
  monthlyInterest: number;
  totalLateFee: number;
  isBeforeCutoff: boolean;
} {
  const {
    currentMonthKey,
    contractStartMonthKey,
    cutoffMonthKey,
    monthlyInterestAmount,
  } = params;
  const cleanCutoffMonth = INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(cutoffMonthKey)
    ? cutoffMonthKey
    : DEFAULT_INVESTMENT_CUTOFF_DATE.slice(0, 7);
  const cleanStartMonth = INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(contractStartMonthKey)
    ? contractStartMonthKey
    : cleanCutoffMonth;
  const anchorMonthKey =
    cleanStartMonth > cleanCutoffMonth ? cleanStartMonth : cleanCutoffMonth;
  const isBeforeCutoff =
    INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(currentMonthKey) &&
    currentMonthKey < cleanCutoffMonth;

  const monthlyInterest = Math.max(0, Math.round(Number(monthlyInterestAmount) || 0));

  if (isBeforeCutoff) {
    return {
      anchorMonthKey,
      monthsCount: 0,
      monthlyInterest,
      totalLateFee: 0,
      isBeforeCutoff: true,
    };
  }

  const monthsCount = diffMonthKeysNonNegative(anchorMonthKey, currentMonthKey);
  const totalLateFee = monthsCount * monthlyInterest;

  return {
    anchorMonthKey,
    monthsCount,
    monthlyInterest,
    totalLateFee,
    isBeforeCutoff: false,
  };
}

export function getEffectiveAssetBonusDate(
  asset: Pick<
    InvestmentAsset,
    'bonusDate' | 'endDate' | 'startDate' | 'startMonthKey' | 'dueDay' | 'tenorMonths' | 'addendums'
  >
): string {
  if (Array.isArray(asset.addendums) && asset.addendums.length > 0) {
    const sorted = [...asset.addendums].sort((a, b) => b.sequenceNumber - a.sequenceNumber);
    for (const ad of sorted) {
      const adBonus = normalizeToIsoDate(ad.newBonusDate);
      if (adBonus) {
        return adBonus;
      }
    }
  }
  const isoBonus = normalizeToIsoDate(asset.bonusDate);
  if (isoBonus) {
    return isoBonus;
  }
  return getEffectiveAssetEndDate(asset);
}

export function getEffectiveAssetBonusAmount(
  asset: Pick<
    InvestmentAsset,
    'principalAmount' | 'bonusInputType' | 'bonusAmount' | 'bonusRate'
  >
): number {
  return computeBonusForAmount({
    principalBasis: Math.max(0, Math.round(Number(asset.principalAmount) || 0)),
    bonusInputType: asset.bonusInputType,
    bonusAmount: asset.bonusAmount,
    bonusRate: asset.bonusRate,
  });
}

export function buildInvestmentSchedule(
  asset: Pick<
    InvestmentAsset,
    | 'principalAmount'
    | 'paymentMethod'
    | 'fixedPrincipalPerMonth'
    | 'interestInputType'
    | 'monthlyInterestAmount'
    | 'monthlyInterestRate'
    | 'lateFeeInputType'
    | 'lateFeePerMonthAmount'
    | 'lateFeePerMonthRate'
    | 'bonusInputType'
    | 'bonusAmount'
    | 'bonusRate'
    | 'bonusDate'
    | 'monthlyInstallment'
    | 'tenorMonths'
    | 'startMonthKey'
    | 'startDate'
    | 'endDate'
    | 'dueDay'
    | 'paidMonths'
    | 'originalContract'
    | 'addendums'
  > &
    Partial<Pick<InvestmentAsset, 'cutoffDate' | 'legacyLateFeeBeforeCutoff'>> & {
      status?: InvestmentAsset['status'];
    },
  options?: { todayISO?: string; ignoreLateFees?: boolean; cutoffDateOverride?: string }
): InvestmentInstallmentRow[] {
  const todayISO = options?.todayISO ?? getTodayISODate();
  const ignoreLateFees = Boolean(options?.ignoreLateFees);
  const baseContract = asset.originalContract;
  const PBase = Math.max(
    0,
    Math.round(Number(baseContract ? baseContract.principalAmount : asset.principalAmount) || 0)
  );
  const PTotal = Math.max(0, Math.round(Number(asset.principalAmount) || 0));
  const nTotal = Math.max(1, Math.round(Number(asset.tenorMonths) || 1));
  const method: InvestmentPaymentMethod =
    asset.paymentMethod === 'BALLOON' ? 'BALLOON' : 'ANUITAS';
  const baseInterestType: InterestInputType =
    (baseContract ? baseContract.interestInputType : asset.interestInputType) === 'RP'
      ? 'RP'
      : 'PERCENT';
  const baseInterestAmt =
    Number(baseContract ? baseContract.monthlyInterestAmount : asset.monthlyInterestAmount) || 0;
  const baseInterestRate =
    Number(baseContract ? baseContract.monthlyInterestRate : asset.monthlyInterestRate) || 0;
  const baseLateFeeType: InterestInputType =
    (baseContract ? baseContract.lateFeeInputType : asset.lateFeeInputType) === 'PERCENT'
      ? 'PERCENT'
      : 'RP';
  const baseLateFeeAmt =
    Number(baseContract ? baseContract.lateFeePerMonthAmount : asset.lateFeePerMonthAmount) || 0;
  const baseLateFeeRate =
    Number(baseContract ? baseContract.lateFeePerMonthRate : asset.lateFeePerMonthRate) || 0;

  const sortedAddendums = Array.isArray(asset.addendums)
    ? [...asset.addendums].sort((a, b) => a.effectiveFromInstallment - b.effectiveFromInstallment)
    : [];

  const paidSet = new Set(Array.isArray(asset.paidMonths) ? asset.paidMonths : []);
  const assetStatus = asset.status ?? 'Aktif';
  const cutoffDateISO =
    normalizeToIsoDate(options?.cutoffDateOverride) ?? DEFAULT_INVESTMENT_CUTOFF_DATE;
  const cutoffMonthKey = cutoffDateISO.slice(0, 7);

  const effectiveEndDateISO = getEffectiveAssetEndDate(asset);
  const effectiveEndMonthKey = /^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDateISO)
    ? effectiveEndDateISO.slice(0, 7)
    : '';

  const bonusDateISO = getEffectiveAssetBonusDate(asset);
  const bonusMonthKey = /^\d{4}-\d{2}-\d{2}$/.test(bonusDateISO)
    ? bonusDateISO.slice(0, 7)
    : '';
  const totalBonusRp = computeBonusForAmount({
    principalBasis: PTotal > 0 ? PTotal : PBase,
    bonusInputType: asset.bonusInputType,
    bonusAmount: asset.bonusAmount,
    bonusRate: asset.bonusRate,
  });

  // Cicilan / bunga pertama dimulai 1 bulan setelah Tgl Kontrak.
  // Jika ada Adendum perpanjangan periode, cicilan perpanjangan dimulai minimal 1 bulan setelah Tgl Adendum
  // (tanpa duplikat bulan dengan cicilan sebelumnya / di bulan Adendum).
  const firstInstallmentMonthKey = getFirstInstallmentMonthKey(asset);
  const addendumByStart = new Map<number, (typeof sortedAddendums)[number]>();
  for (const ad of sortedAddendums) {
    addendumByStart.set(ad.effectiveFromInstallment, ad);
  }

  const installmentMonthKeys: string[] = [];
  for (let k = 1; k <= nTotal; k += 1) {
    if (k === 1) {
      installmentMonthKeys.push(firstInstallmentMonthKey);
      continue;
    }
    const candidate = addMonthsToInvestmentKey(installmentMonthKeys[k - 2], 1);
    const enteredAddendum = addendumByStart.get(k);
    if (
      enteredAddendum?.addendumDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(enteredAddendum.addendumDate)
    ) {
      const adMinMonth = addMonthsToInvestmentKey(
        enteredAddendum.addendumDate.slice(0, 7),
        1
      );
      installmentMonthKeys.push(adMinMonth > candidate ? adMinMonth : candidate);
    } else {
      installmentMonthKeys.push(candidate);
    }
  }
  const endMonthIsInsideTenor = Boolean(
    effectiveEndMonthKey && installmentMonthKeys.includes(effectiveEndMonthKey)
  );
  const lastInstallmentMonthKey = installmentMonthKeys[installmentMonthKeys.length - 1] ?? '';
  const needsSeparateBalloonMaturityRow = Boolean(
    method === 'BALLOON' &&
      effectiveEndMonthKey &&
      !endMonthIsInsideTenor &&
      effectiveEndMonthKey >= lastInstallmentMonthKey
  );

  const rows: InvestmentInstallmentRow[] = [];

  const startDateISO = getEffectiveAssetStartDate(asset);
  const effectiveScheduleDueDay =
    asset.dueDay ?? (Number(startDateISO.slice(8, 10)) || 1);

  // Backward compatibility if principalAmount == 0 but legacy monthlyInstallment > 0 and no addendums
  if (PBase === 0 && sortedAddendums.length === 0 && (asset.monthlyInstallment || 0) > 0) {
    const fixedAmt = Math.max(0, Math.round(asset.monthlyInstallment));
    for (let k = 1; k <= nTotal; k += 1) {
      const monthKey = installmentMonthKeys[k - 1];
      const dueISO = getInstallmentDueISODate(monthKey, effectiveScheduleDueDay);
      const isPrincipalPaid =
        assetStatus === 'Lunas' || isInvestmentComponentPaidInSet(paidSet, monthKey, 'principal');
      const isInterestPaid =
        assetStatus === 'Lunas' ||
        isInvestmentComponentPaidInSet(paidSet, monthKey, 'interest') ||
        isInvestmentComponentPaidInSet(paidSet, monthKey, 'lateFee');
      const isBonusPaid =
        assetStatus === 'Lunas' || isInvestmentComponentPaidInSet(paidSet, monthKey, 'bonus');
      const isBalloonMaturityHere =
        method === 'BALLOON' &&
        (endMonthIsInsideTenor ? monthKey === effectiveEndMonthKey : k === nTotal);
      const principalPaid =
        method === 'BALLOON' ? (isBalloonMaturityHere ? fixedAmt : 0) : fixedAmt;
      const isBonusMonth = Boolean(totalBonusRp > 0 && bonusMonthKey === monthKey);
      const bonusPaid = isBonusMonth ? totalBonusRp : 0;
      const isPaid =
        principalPaid > 0
          ? isPrincipalPaid && (!isBonusMonth || isBonusPaid)
          : isBonusMonth
          ? isBonusPaid
          : isPrincipalPaid || isInterestPaid;
      const isMonthBeforeCutoff = monthKey < cutoffMonthKey;
      const effectiveLateDueISO = cutoffDateISO > dueISO ? cutoffDateISO : dueISO;
      const monthsLate =
        !ignoreLateFees &&
        !isMonthBeforeCutoff &&
        assetStatus !== 'Ditunda' &&
        !(principalPaid > 0 ? isPrincipalPaid && isInterestPaid : isInterestPaid)
          ? diffCalendarMonthsOverdue(effectiveLateDueISO, todayISO)
          : 0;
      const potentialMonthlyLateFee =
        monthsLate > 0
          ? computeMonthlyLateFeeForBalance({
              remainingPrincipal: 0,
              lateFeeInputType: baseLateFeeType,
              lateFeePerMonthAmount: baseLateFeeAmt,
              lateFeePerMonthRate: baseLateFeeRate,
            })
          : 0;
      const isLate = monthsLate > 0 && potentialMonthlyLateFee > 0;
      const monthlyLateFee = isLate ? potentialMonthlyLateFee : 0;
      const lateFeeAmount = monthlyLateFee * monthsLate;
      const isPrincipalOverdue = Boolean(
        principalPaid > 0 && !isPrincipalPaid && assetStatus !== 'Ditunda' && dueISO <= todayISO
      );

      rows.push({
        installmentNumber: k,
        monthKey,
        dueISO,
        remainingPrincipalBefore: 0,
        principalPaid,
        interestPaid: 0,
        bonusPaid,
        isBonusMonth,
        monthsLate,
        isLate,
        isPrincipalOverdue,
        monthlyLateFee,
        lateFeeType: baseLateFeeType,
        lateFeeRate: baseLateFeeRate,
        lateFeeAmount,
        lateChargeTotal: lateFeeAmount,
        totalInstallment: principalPaid + bonusPaid,
        totalInstallmentWithLateFee: principalPaid + bonusPaid + lateFeeAmount,
        remainingPrincipalAfter: 0,
        isPaid,
        isPrincipalPaid,
        isInterestPaid,
        isBonusPaid,
      });
    }
  } else {
    let remaining = PBase;
    const baseTenor = baseContract ? Math.max(1, baseContract.tenorMonths) : nTotal;
    const baseFixedPrincipalRaw = baseContract
      ? baseContract.fixedPrincipalPerMonth
      : asset.fixedPrincipalPerMonth;
    const baseFixedPrincipal =
      method === 'ANUITAS' && PBase > 0
        ? Number(baseFixedPrincipalRaw) > 0 &&
          Number(baseFixedPrincipalRaw) < Math.round(PBase / baseTenor)
          ? Math.round(baseFixedPrincipalRaw)
          : Math.round(PBase / baseTenor)
        : Number(baseFixedPrincipalRaw) > 0
        ? Math.round(baseFixedPrincipalRaw)
        : Math.round(PBase / baseTenor);

    let activeInterestType: InterestInputType = baseInterestType;
    let activeInterestAmt = baseInterestAmt;
    let activeInterestRate = baseInterestRate;
    let activeInterestBasisPrincipal = PBase;
    let activeLateFeeType: InterestInputType = baseLateFeeType;
    let activeLateFeeAmt = baseLateFeeAmt;
    let activeLateFeeRate = baseLateFeeRate;
    let activeFixedPrincipal = baseFixedPrincipal;
    let activeAddendumSeq: number | undefined;
    let activeAddendumNum: string | undefined;

    for (let k = 1; k <= nTotal; k += 1) {
      const enteredAddendum = addendumByStart.get(k);
      if (enteredAddendum) {
        remaining += Math.max(0, Math.round(enteredAddendum.additionalPrincipal || 0));
        activeInterestBasisPrincipal = remaining;
        activeInterestType =
          enteredAddendum.newInterestInputType === 'RP' ? 'RP' : 'PERCENT';
        activeInterestAmt = Number(enteredAddendum.newMonthlyInterestAmount || 0);
        activeInterestRate = Number(enteredAddendum.newMonthlyInterestRate || 0);
        activeLateFeeType =
          enteredAddendum.newLateFeeInputType === 'PERCENT' ? 'PERCENT' : 'RP';
        activeLateFeeAmt = Number(enteredAddendum.newLateFeePerMonthAmount || 0);
        activeLateFeeRate = Number(enteredAddendum.newLateFeePerMonthRate || 0);
        const remainingMonths = Math.max(1, nTotal - k + 1);
        activeFixedPrincipal =
          remaining > 0 ? Math.round(remaining / remainingMonths) : 0;
        activeAddendumSeq = enteredAddendum.sequenceNumber;
        activeAddendumNum = enteredAddendum.addendumNumber;
      }

      const monthKey = installmentMonthKeys[k - 1];
      const dueISO = getInstallmentDueISODate(monthKey, effectiveScheduleDueDay);
      const remainingBefore = remaining;
      const isPrincipalPaid =
        assetStatus === 'Lunas' || isInvestmentComponentPaidInSet(paidSet, monthKey, 'principal');
      const isInterestPaid =
        assetStatus === 'Lunas' ||
        isInvestmentComponentPaidInSet(paidSet, monthKey, 'interest') ||
        isInvestmentComponentPaidInSet(paidSet, monthKey, 'lateFee');
      const isBonusPaid =
        assetStatus === 'Lunas' || isInvestmentComponentPaidInSet(paidSet, monthKey, 'bonus');
      const isLast = k === nTotal;

      const regularInterest = computeMonthlyInterestForBalance({
        remainingPrincipal: remainingBefore,
        interestInputType: activeInterestType,
        monthlyInterestAmount: activeInterestAmt,
        monthlyInterestRate: activeInterestRate,
        paymentMethod: method,
        initialPrincipalBasis: activeInterestBasisPrincipal,
      });

      let principalPaid = 0;
      if (method === 'BALLOON') {
        if (endMonthIsInsideTenor) {
          principalPaid = monthKey === effectiveEndMonthKey ? remainingBefore : 0;
        } else if (
          effectiveEndMonthKey &&
          installmentMonthKeys[0] &&
          effectiveEndMonthKey < installmentMonthKeys[0]
        ) {
          principalPaid = k === 1 ? remainingBefore : 0;
        } else if (!needsSeparateBalloonMaturityRow) {
          principalPaid = isLast ? remainingBefore : 0;
        } else {
          // Pokok di Akhir dibayar di baris Tanggal Akhir Pinjaman (di bulan endMonthKey)
          principalPaid = 0;
        }
      } else {
        principalPaid = Math.min(remainingBefore, activeFixedPrincipal);
        const isLastOfBaseWithoutAddendum = k === baseTenor && sortedAddendums.length === 0;
        if (
          (isLast || isLastOfBaseWithoutAddendum) &&
          remainingBefore > 0 &&
          Math.abs(remainingBefore - activeFixedPrincipal) <= Math.max(1000, nTotal)
        ) {
          principalPaid = remainingBefore;
        }
        if (
          isLast &&
          remainingBefore > 0 &&
          sortedAddendums.length > 0 &&
          remainingBefore - principalPaid <= Math.max(1000, nTotal)
        ) {
          principalPaid = remainingBefore;
        }
      }

      const remainingAfter = Math.max(0, remainingBefore - principalPaid);
      // Untuk Pokok di Akhir (BALLOON), jika pokok BELUM dibayar (independen dari Bunga),
      // Sisa Pokok untuk perhitungan bunga/denda bulan-bulan setelahnya tetap utuh (tidak jadi 0).
      remaining =
        method === 'BALLOON' && principalPaid > 0 && !isPrincipalPaid
          ? remainingBefore
          : remainingAfter;

      const isMonthBeforeCutoff = monthKey < cutoffMonthKey || dueISO < cutoffDateISO;
      const effectiveLateDueISO = cutoffDateISO > dueISO ? cutoffDateISO : dueISO;
      const interestOrInstallmentSettled =
        method === 'ANUITAS' ? isPrincipalPaid : isInterestPaid;
      const monthsLate =
        !ignoreLateFees &&
        !isMonthBeforeCutoff &&
        assetStatus !== 'Ditunda' &&
        !interestOrInstallmentSettled
          ? diffCalendarMonthsOverdue(effectiveLateDueISO, todayISO)
          : 0;
      const potentialMonthlyLateFee =
        monthsLate > 0
          ? computeMonthlyLateFeeForBalance({
              remainingPrincipal: remainingBefore,
              lateFeeInputType: activeLateFeeType,
              lateFeePerMonthAmount: activeLateFeeAmt,
              lateFeePerMonthRate: activeLateFeeRate,
            })
          : 0;
      const isLate = monthsLate > 0 && potentialMonthlyLateFee > 0;
      const interestPaid = isLate ? 0 : regularInterest;
      const monthlyLateFee = isLate ? potentialMonthlyLateFee : 0;
      const lateFeeAmount = monthlyLateFee * monthsLate;
      const lateChargeTotal = lateFeeAmount; // Tidak menjumlahkan Bunga + Denda

      const isBonusMonth = Boolean(totalBonusRp > 0 && bonusMonthKey === monthKey);
      const bonusPaid = isBonusMonth ? totalBonusRp : 0;
      const isPrincipalOverdue = Boolean(
        principalPaid > 0 && !isPrincipalPaid && assetStatus !== 'Ditunda' && dueISO <= todayISO
      );

      const isPaid =
        method === 'ANUITAS'
          ? isPrincipalPaid && (!isBonusMonth || isBonusPaid)
          : principalPaid > 0
          ? isPrincipalPaid && isInterestPaid && (!isBonusMonth || isBonusPaid)
          : isInterestPaid && (!isBonusMonth || isBonusPaid);

      const totalInstallment = principalPaid + interestPaid + bonusPaid;
      const totalInstallmentWithLateFee = isLate
        ? principalPaid + lateFeeAmount + bonusPaid
        : totalInstallment;

      rows.push({
        installmentNumber: k,
        monthKey,
        dueISO,
        remainingPrincipalBefore: remainingBefore,
        principalPaid,
        interestPaid,
        regularInterest,
        bonusPaid,
        isBonusMonth,
        monthsLate,
        isLate,
        isPrincipalOverdue,
        monthlyLateFee,
        lateFeeType: activeLateFeeType,
        lateFeeRate: activeLateFeeRate,
        lateFeeAmount,
        lateChargeTotal,
        totalInstallment,
        totalInstallmentWithLateFee,
        remainingPrincipalAfter: remainingAfter,
        isPaid,
        isPrincipalPaid,
        isInterestPaid: method === 'ANUITAS' ? isPrincipalPaid : isInterestPaid,
        isBonusPaid,
        addendumSequence: activeAddendumSeq,
        addendumNumber: activeAddendumNum,
      });
    }

    // Jika metode BALLOON dan Tanggal Akhir Pinjaman jatuh di bulan setelah cicilan #nTotal
    // (contoh: Mulai Feb 2026 + 12 bln => Akhir Pinjaman Feb 2027), tempatkan pelunasan Pokok di bulan Tanggal Akhir tersebut.
    if (needsSeparateBalloonMaturityRow && remaining > 0) {
      const dueISO = effectiveEndDateISO;
      const isPrincipalPaid =
        assetStatus === 'Lunas' ||
        isInvestmentComponentPaidInSet(paidSet, effectiveEndMonthKey, 'principal');
      const isInterestPaid =
        assetStatus === 'Lunas' ||
        isInvestmentComponentPaidInSet(paidSet, effectiveEndMonthKey, 'interest') ||
        isInvestmentComponentPaidInSet(paidSet, effectiveEndMonthKey, 'lateFee');
      const isBonusPaid =
        assetStatus === 'Lunas' ||
        isInvestmentComponentPaidInSet(paidSet, effectiveEndMonthKey, 'bonus');
      const isBonusMonth = Boolean(totalBonusRp > 0 && bonusMonthKey === effectiveEndMonthKey);
      const isPaid = isPrincipalPaid && (!isBonusMonth || isBonusPaid);
      const isMaturityBeforeCutoff = effectiveEndMonthKey < cutoffMonthKey || dueISO < cutoffDateISO;
      const effectiveMaturityLateDueISO = cutoffDateISO > dueISO ? cutoffDateISO : dueISO;
      const monthsLate =
        !ignoreLateFees && !isMaturityBeforeCutoff && assetStatus !== 'Ditunda' && !isPrincipalPaid
          ? diffCalendarMonthsOverdue(effectiveMaturityLateDueISO, todayISO)
          : 0;
      const potentialMonthlyLateFee =
        monthsLate > 0
          ? computeMonthlyLateFeeForBalance({
              remainingPrincipal: remaining,
              lateFeeInputType: activeLateFeeType,
              lateFeePerMonthAmount: activeLateFeeAmt,
              lateFeePerMonthRate: activeLateFeeRate,
            })
          : 0;
      const isLate = monthsLate > 0 && potentialMonthlyLateFee > 0;
      const monthlyLateFee = isLate ? potentialMonthlyLateFee : 0;
      const lateFeeAmount = monthlyLateFee * monthsLate;
      const bonusPaid = isBonusMonth ? totalBonusRp : 0;
      const isPrincipalOverdue = Boolean(
        remaining > 0 && !isPrincipalPaid && assetStatus !== 'Ditunda' && dueISO <= todayISO
      );

      rows.push({
        installmentNumber: 0,
        monthKey: effectiveEndMonthKey,
        dueISO,
        remainingPrincipalBefore: remaining,
        principalPaid: remaining,
        interestPaid: 0,
        bonusPaid,
        isBonusMonth,
        isMaturityRow: true,
        monthsLate,
        isLate,
        isPrincipalOverdue,
        monthlyLateFee,
        lateFeeType: activeLateFeeType,
        lateFeeRate: activeLateFeeRate,
        lateFeeAmount,
        lateChargeTotal: lateFeeAmount,
        totalInstallment: remaining + bonusPaid,
        totalInstallmentWithLateFee: isLate
          ? remaining + lateFeeAmount + bonusPaid
          : remaining + bonusPaid,
        remainingPrincipalAfter: 0,
        isPaid,
        isPrincipalPaid,
        isInterestPaid,
        isBonusPaid,
        addendumSequence: activeAddendumSeq,
        addendumNumber: activeAddendumNum,
      });
    }
  }

  // Jika tanggal pencairan bonus jatuh di bulan di luar baris yang sudah ada,
  // tambahkan baris khusus pencairan Bonus di bulan tersebut.
  if (
    totalBonusRp > 0 &&
    bonusMonthKey &&
    !rows.some((r) => r.monthKey === bonusMonthKey)
  ) {
    const isBonusPaid =
      assetStatus === 'Lunas' || isInvestmentComponentPaidInSet(paidSet, bonusMonthKey, 'bonus');
    rows.push({
      installmentNumber: 0,
      monthKey: bonusMonthKey,
      dueISO: bonusDateISO,
      remainingPrincipalBefore: 0,
      principalPaid: 0,
      interestPaid: 0,
      bonusPaid: totalBonusRp,
      isBonusMonth: true,
      isBonusOnlyRow: true,
      monthsLate: 0,
      isLate: false,
      isPrincipalOverdue: false,
      monthlyLateFee: 0,
      lateFeeType: baseLateFeeType,
      lateFeeRate: 0,
      lateFeeAmount: 0,
      lateChargeTotal: 0,
      totalInstallment: totalBonusRp,
      totalInstallmentWithLateFee: totalBonusRp,
      remainingPrincipalAfter: 0,
      isPaid: isBonusPaid,
      isPrincipalPaid: false,
      isInterestPaid: false,
      isBonusPaid,
    });
  }

  rows.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  return rows;
}

export function getInvestmentInstallmentForMonth(
  asset: InvestmentAsset,
  monthKey: string,
  options?: { todayISO?: string; cutoffDateOverride?: string }
): InvestmentInstallmentRow | null {
  if (asset.status === 'Ditunda' || asset.status === 'Lunas') return null;
  const schedule = buildInvestmentSchedule(asset, options);
  return schedule.find((row) => row.monthKey === monthKey) ?? null;
}

export function computeInvestmentPortfolioTotals(
  asset: InvestmentAsset,
  options?: { todayISO?: string; cutoffDateOverride?: string }
): InvestmentPortfolioTotals {
  const todayISO = options?.todayISO ?? getTodayISODate();
  const schedule = buildInvestmentSchedule(asset, {
    todayISO,
    cutoffDateOverride: options?.cutoffDateOverride,
  });
  let paidPrincipal = 0;
  let paidInterest = 0;
  let paidBonus = 0;
  let remainingPrincipal = 0;
  let remainingInterest = 0;
  let remainingBonus = 0;
  let totalBonusPayable = 0;
  let totalInterestFullTenor = 0;
  let totalPayableFullTenor = 0;
  let totalLateFeesAccrued = 0;
  let lateMonthsCount = 0;
  let overdueUnpaidPrincipal = 0;

  for (const row of schedule) {
    totalInterestFullTenor += row.interestPaid;
    totalBonusPayable += row.bonusPaid;
    totalPayableFullTenor += row.totalInstallmentWithLateFee;

    const isPrincipalSettled = row.isPrincipalPaid || asset.status === 'Lunas';
    const isInterestSettled = row.isInterestPaid || asset.status === 'Lunas';
    const isBonusSettled = row.isBonusPaid || asset.status === 'Lunas';

    if (isPrincipalSettled) {
      paidPrincipal += row.principalPaid;
    } else if (asset.status !== 'Ditunda') {
      remainingPrincipal += row.principalPaid;
      if (row.isPrincipalOverdue) {
        overdueUnpaidPrincipal += row.principalPaid;
      }
    }

    if (isInterestSettled) {
      if (!row.isLate) {
        paidInterest += row.interestPaid;
      }
    } else if (asset.status !== 'Ditunda') {
      if (!row.isLate) {
        remainingInterest += row.interestPaid;
      } else {
        totalLateFeesAccrued += row.lateFeeAmount;
        lateMonthsCount += 1;
      }
    }

    if (isBonusSettled) {
      paidBonus += row.bonusPaid;
    } else if (asset.status !== 'Ditunda') {
      remainingBonus += row.bonusPaid;
    }
  }

  return {
    paidPrincipal,
    paidInterest,
    paidBonus,
    paidTotal: paidPrincipal + paidInterest + paidBonus,
    remainingPrincipal,
    remainingInterest,
    remainingBonus,
    totalBonusPayable,
    totalInterestFullTenor,
    totalPayableFullTenor,
    totalLateFeesAccrued,
    lateMonthsCount,
    overdueUnpaidPrincipal,
  };
}
