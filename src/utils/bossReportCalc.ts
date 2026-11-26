import { createDefaultBossReportMonth } from '../services/bossReportService';
import { getOpexStatusForMonth, isOpexActiveInMonth } from '../services/opexService';
import {
  BankAccountRow,
  BossReportAutoOverride,
  BossReportColorStatus,
  BossReportManualItem,
  BossReportMonthData,
  BossReportRescheduledItem,
  BossReportSectionKey,
  BossReportSourceCategory,
  CashOutColorStatus,
  InvestmentComponentKind,
} from '../types/bossReport';
import { ClientInvoice } from '../types/clientInvoice';
import {
  buildInvestmentComponentPeriodKey,
  hasInvestmentComponentEntriesForMonth,
  INVESTMENT_COMPONENT_KEYS,
  InvestmentAsset,
  isInvestmentComponentPaidInSet,
} from '../types/investment';
import { mapOpexDbFieldsToColor, OpexItem, OpexPaymentStatus } from '../types/opex';
import { PurchaseOrder } from '../types/po';
import { ProjectionManualItem } from '../types/projectionManualItem';
import {
  getClientInvoiceEffectiveStatus,
  resolveClientInvoiceBreakdown,
  resolveClientInvoiceNominal,
  toPositiveAmount,
} from './clientInvoiceFormat';
import {
  computeDueTunggakanStatus,
  formatShortDateID,
  getEffectiveDueDate,
  getTodayISODate,
  getVendorPOEffectiveCostAmount,
  isEffectiveOverdue,
} from './format';
import {
  buildInvestmentSchedule,
  computeInvestmentPortfolioTotals,
  computeMonthlyInterestForBalance,
  computeMonthlyLateFeeForBalance,
  diffCalendarMonthsOverdue,
  formatDDMMMYYYY,
  getEffectiveAssetBonusDate,
  getEffectiveAssetEndDate,
  getEffectiveAssetStartDate,
  getFirstInstallmentMonthKey,
  getInstallmentDueISODate,
  InvestmentInstallmentRow,
  roundInterestRate,
} from './investmentCalc';

export type CashInSourceKind = 'invoice' | 'investmentDisbursement' | 'manual';

export interface BossReportComputedRow {
  rowKey: string;
  sourceId?: string;
  isAuto: boolean;
  isRescheduledIn?: boolean;
  rescheduledItemId?: string;
  section: BossReportSectionKey;
  sourceCategory: BossReportSourceCategory;
  cashInSource?: CashInSourceKind;
  originMonthKey: string;
  sourceMonthKey?: string;
  fromMonthKey?: string;
  rescheduledFromMonth?: string;
  historyMonths?: string[];
  rescheduleLabel?: string;
  rescheduledToMonth?: string;
  rescheduledOutLabel?: string;
  dueBadgeLabel?: string;
  dueBadgeTone?: 'red' | 'amber';
  dueISO?: string;
  subtitle?: string;
  name: string;
  amount: number; // Nominal asli / dasar
  projectedAmount: number; // Dihitung di Projection bulan ini (0 jika HIJAU atau MERAH)
  realisasiAmount: number; // Dihitung di Realisasi bulan ini (custom actualAmount atau amount jika HIJAU, else 0)
  color: CashOutColorStatus;
  accountId?: string;
  hasCustomOverride: boolean;
  investmentAssetId?: string;
  investmentComponent?: InvestmentComponentKind;
  investmentInstallmentNumber?: number;
  investmentInstallmentMonthKey?: string;
  clientInvoiceId?: string;
  opexId?: string;
  poId?: string;
  projectionManualItemId?: string;
  manualKeterangan?: string;
  manualProjectId?: string;
  manualProjectName?: string;
  manualVendor?: string;
}

export interface AccountProjectionRow {
  id: string;
  name: string;
  isPrimary: boolean;
  openingBalance: number;
  projectedCashIn: number;
  cashOutOperasional: number;
  cashOutInvestment: number;
  cashOutProjectCost: number;
  projectedCashOut: number;
  endingBalance: number;
}

export interface BossReportViewModel {
  monthKey: string;
  isRange?: boolean;
  startMonthKey?: string;
  endMonthKey?: string;
  monthKeys?: string[];
  previousMonthKey: string;
  previousMonthLabel: string; // e.g., "Okt 2026"
  monthNameOnly: string; // e.g., "November" atau "Jan 2026 – Des 2026"
  monthFullLabel: string; // e.g., "November 2026" atau "Januari 2026 s/d Desember 2026"
  asOfDate: string;
  accounts: BankAccountRow[];
  accountDetails: AccountProjectionRow[];
  primaryAccountId: string | null;
  saldoAwal: number;
  saldoAwalSource: 'manual' | 'accounts' | 'auto';
  hasPreviousMonthData: boolean;
  saldoTersedia: number;
  cashInRows: BossReportComputedRow[];
  totalCashIn: number;
  totalCashInRealisasi: number;
  accountBalance: number;
  operasionalRows: BossReportComputedRow[];
  totalOperasionalCost: number;
  totalOperasionalRealisasi: number;
  investmentRows: BossReportComputedRow[];
  hiddenNotDuePrincipalCount: number;
  hasVisiblePrincipalRows: boolean;
  totalInvestmentCost: number;
  totalInvestmentRealisasi: number;
  projectCostRows: BossReportComputedRow[];
  totalProjectCost: number;
  totalProjectRealisasi: number;
  totalCost: number;
  totalCostRealisasi: number;
  endingBalance: number;
  endingBalanceRealisasi: number;
  isMinus: boolean;
}

export interface MultiMonthCashflowPoint {
  monthKey: string;
  shortLabel: string;
  fullLabel: string;
  saldoAwal: number;
  totalCashIn: number;
  totalCashOut: number;
  totalOperasional: number;
  totalInvestment: number;
  totalProjectCost: number;
  endingBalance: number;
}

const MONTH_NAMES_ID = [
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

export function formatBossMonthNameOnly(monthKey: string): string {
  const [, mStr] = monthKey.split('-');
  const idx = Number(mStr) - 1;
  return MONTH_NAMES_ID[idx] ?? monthKey;
}

export function formatBossMonthFullLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const idx = Number(mStr) - 1;
  return `${MONTH_NAMES_ID[idx] ?? mStr} ${yStr}`;
}

export function formatBossMonthShortLabel(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-');
  const idx = Number(mStr) - 1;
  return `${MONTH_SHORT_ID[idx] ?? mStr} ${yStr}`;
}

export function formatRescheduleHistoryLabel(
  historyMonths?: string[],
  options?: {
    dueISO?: string;
    todayISO?: string;
    isPaid?: boolean;
  }
): string {
  const originMK =
    options?.dueISO && /^\d{4}-\d{2}-\d{2}$/.test(options.dueISO)
      ? options.dueISO.slice(0, 7)
      : Array.isArray(historyMonths) && historyMonths.length > 0
      ? historyMonths[0]
      : '';
  if (!originMK && !options?.dueISO) return '';
  const dueStatus = computeDueTunggakanStatus({
    dueISO: options?.dueISO,
    originMonthKey: originMK,
    todayISO: options?.todayISO,
    isPaid: options?.isPaid,
  });
  if (!dueStatus.isTunggakan) return '';
  return dueStatus.statusText;
}

export function formatMonthKeyParts(
  year: string | number,
  month: string | number
): string {
  const yDigits = String(year).replace(/\D/g, '').slice(0, 4);
  const y = (yDigits || '2026').padStart(4, '0');
  const mNum = Math.min(12, Math.max(1, Number(month) || 1));
  const m = String(mNum).padStart(2, '0');
  return `${y}-${m}`;
}

export function normalizeMonthKeyYYYYMM(monthKey: string): string {
  const match = /^\s*(\d{4})-(\d{1,2})/.exec(String(monthKey ?? ''));
  if (!match) return String(monthKey ?? '').trim();
  return formatMonthKeyParts(match[1], match[2]);
}

export function addMonthsToKey(monthKey: string, offset: number): string {
  const normalized = normalizeMonthKeyYYYYMM(monthKey);
  const [yStr, mStr] = normalized.split('-');
  const d = new Date(Date.UTC(Number(yStr), Number(mStr) - 1 + offset, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

export function getMonthSelectorOptions(centerMonthKey: string): Array<{
  monthKey: string;
  shortLabel: string;
  fullLabel: string;
}> {
  const list: Array<{ monthKey: string; shortLabel: string; fullLabel: string }> = [];
  for (let offset = -6; offset <= 15; offset += 1) {
    const mk = addMonthsToKey(centerMonthKey, offset);
    list.push({
      monthKey: mk,
      shortLabel: formatBossMonthShortLabel(mk),
      fullLabel: formatBossMonthFullLabel(mk),
    });
  }
  return list;
}

export function diffBossMonthKeys(fromMonthKey: string, toMonthKey: string): number {
  const [fy, fm] = normalizeMonthKeyYYYYMM(fromMonthKey).split('-').map(Number);
  const [ty, tm] = normalizeMonthKeyYYYYMM(toMonthKey).split('-').map(Number);
  if (
    !Number.isFinite(fy) ||
    !Number.isFinite(fm) ||
    !Number.isFinite(ty) ||
    !Number.isFinite(tm)
  ) {
    return 0;
  }
  return (ty - fy) * 12 + (tm - fm);
}

export function enumerateMonthKeysInRange(
  startMonthKey: string,
  endMonthKey: string
): string[] {
  const orderedStart = startMonthKey <= endMonthKey ? startMonthKey : endMonthKey;
  const orderedEnd = startMonthKey <= endMonthKey ? endMonthKey : startMonthKey;
  const diff = Math.max(0, Math.min(59, diffBossMonthKeys(orderedStart, orderedEnd)));
  const keys: string[] = [];
  for (let i = 0; i <= diff; i += 1) {
    keys.push(addMonthsToKey(orderedStart, i));
  }
  return keys;
}

function mapOpexStatusToColor(status: OpexPaymentStatus): BossReportColorStatus {
  const s = String(status);
  if (s === 'Sudah Bayar' || s === 'Lunas' || s === 'Paid') return 'green';
  if (s === 'Reschedule' || s === 'Rescheduling') return 'red';
  return 'white';
}

function computeProjectedAndRealisasi(
  amount: number,
  color: BossReportColorStatus,
  _isMovedOut = true,
  customActualAmount?: number
): { projectedAmount: number; realisasiAmount: number } {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  if (color === 'green') {
    const safeActual =
      customActualAmount !== undefined && Number.isFinite(customActualAmount)
        ? Math.max(0, Math.round(customActualAmount))
        : safe;
    return { projectedAmount: safe, realisasiAmount: safeActual };
  }
  if (color === 'red') {
    return { projectedAmount: 0, realisasiAmount: 0 };
  }
  return { projectedAmount: safe, realisasiAmount: 0 };
}

function resolveOverrideColor(
  ov: BossReportAutoOverride | undefined,
  sourceDefaultColor: BossReportColorStatus,
  sourceRescheduledToMonth?: string
): { color: BossReportColorStatus; rescheduledToMonth?: string } {
  if (ov?.hasCustomColor && ov.color === 'red' && ov.rescheduledToMonth) {
    return { color: 'red', rescheduledToMonth: ov.rescheduledToMonth };
  }
  if (ov?.hasCustomColor && ov.color === 'white') {
    return { color: 'white' };
  }
  if (ov?.hasCustomColor && ov.color === 'green') {
    return { color: 'green' };
  }
  if (sourceDefaultColor === 'green') {
    return { color: 'green' };
  }
  if (sourceDefaultColor === 'red') {
    return { color: 'red', rescheduledToMonth: sourceRescheduledToMonth };
  }
  return { color: 'white' };
}

export function resolveClientInvoiceCashInNominal(inv: ClientInvoice): number {
  return resolveClientInvoiceNominal(inv);
}

export function resolveInvestmentDisbursementNominal(asset: InvestmentAsset): number {
  const ext = asset as InvestmentAsset & {
    loan_amount?: unknown;
    principal_amount?: unknown;
    amount?: unknown;
    total?: unknown;
    grand_total?: unknown;
    total_amount?: unknown;
  };
  const direct =
    toPositiveAmount(asset.principalAmount) ||
    toPositiveAmount(asset.originalContract?.principalAmount) ||
    toPositiveAmount(ext.loan_amount) ||
    toPositiveAmount(ext.principal_amount) ||
    toPositiveAmount(ext.amount) ||
    toPositiveAmount(ext.total) ||
    toPositiveAmount(ext.grand_total) ||
    toPositiveAmount(ext.total_amount);
  if (direct > 0) return direct;

  const fixedPrincipal = Number(asset.fixedPrincipalPerMonth) || 0;
  const tenorMonths = Number(asset.tenorMonths) || 0;
  if (fixedPrincipal > 0 && tenorMonths > 0) {
    return Math.round(fixedPrincipal * tenorMonths);
  }
  return 0;
}

export function resolveManualCashInNominal(
  item: Pick<BossReportManualItem, 'amount'> & {
    total?: unknown;
    nominal?: unknown;
    grand_total?: unknown;
    total_amount?: unknown;
    totalAmount?: unknown;
  }
): number {
  const ext = item as {
    amount?: unknown;
    total?: unknown;
    nominal?: unknown;
    grand_total?: unknown;
    total_amount?: unknown;
    totalAmount?: unknown;
  };
  const explicit =
    toPositiveAmount(ext.amount) ||
    toPositiveAmount(ext.total) ||
    toPositiveAmount(ext.nominal) ||
    toPositiveAmount(ext.grand_total) ||
    toPositiveAmount(ext.total_amount) ||
    toPositiveAmount(ext.totalAmount);
  if (explicit > 0) return explicit;
  return Number.isFinite(item.amount) ? Math.round(item.amount) : 0;
}

function mapManualItems(
  items: BossReportManualItem[],
  prefix: string,
  section: BossReportSectionKey,
  monthKey: string
): BossReportComputedRow[] {
  return items.map((item) => {
    const amount =
      section === 'cashIn'
        ? resolveManualCashInNominal(item)
        : Number.isFinite(item.amount)
        ? item.amount
        : 0;
    const isRescheduledOut =
      item.color === 'red' &&
      Boolean(item.rescheduledToMonth) &&
      item.rescheduledToMonth !== monthKey;
    const color: BossReportColorStatus =
      item.color === 'red' ? 'red' : item.color === 'green' ? 'green' : 'white';
    const rescheduledOutLabel =
      color === 'red' && item.rescheduledToMonth
        ? `DIPENDING KE ${formatBossMonthFullLabel(item.rescheduledToMonth)}`
        : undefined;
    const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
      amount,
      color,
      isRescheduledOut,
      color === 'green'
        ? (item.realisasiAmount ?? item.actualAmount ?? item.actual_amount)
        : undefined
    );

    return {
      rowKey: `${prefix}_${item.id}`,
      sourceId: item.id,
      isAuto: false,
      section,
      sourceCategory: 'manual',
      ...(section === 'cashIn' ? { cashInSource: 'manual' as const } : {}),
      originMonthKey: monthKey,
      sourceMonthKey: monthKey,
      rescheduledToMonth: color === 'red' ? item.rescheduledToMonth : undefined,
      rescheduledOutLabel,
      subtitle: rescheduledOutLabel,
      name: item.name,
      amount,
      projectedAmount,
      realisasiAmount,
      color,
      accountId: item.accountId,
      hasCustomOverride: false,
    };
  });
}

function mapProjectionManualItemsToRows(
  items: ProjectionManualItem[] | undefined,
  targetSection: 'INVESTMENT' | 'PROJECT_COST',
  monthKey: string
): BossReportComputedRow[] {
  if (!items || items.length === 0) return [];
  const sectionKey: BossReportSectionKey =
    targetSection === 'INVESTMENT' ? 'investment' : 'projectCost';

  return items
    .filter((item) => item.periode === monthKey && item.section === targetSection)
    .map((item) => {
      const amount = Number.isFinite(item.nominal)
        ? Math.max(0, Math.round(item.nominal))
        : 0;
      const color: BossReportColorStatus =
        item.color === 'green' || item.statusWarna === 'HIJAU'
          ? 'green'
          : item.color === 'red' || item.statusWarna === 'MERAH'
          ? 'red'
          : 'white';
      const projectedAmount = color === 'red' ? 0 : amount;
      const subtitleParts = [
        'Manual - Sekali Pakai · Non Rutin',
        targetSection === 'PROJECT_COST' && item.projectName
          ? `Project: ${item.projectName}`
          : undefined,
        targetSection === 'PROJECT_COST' && item.vendor
          ? `Vendor: ${item.vendor}`
          : undefined,
        item.keterangan?.trim() || undefined,
      ].filter(Boolean);

      return {
        rowKey: item.id,
        sourceId: item.id,
        projectionManualItemId: item.id,
        manualKeterangan: item.keterangan || undefined,
        manualProjectId: item.projectId,
        manualProjectName: item.projectName,
        manualVendor: item.vendor,
        isAuto: false,
        section: sectionKey,
        sourceCategory: 'manual',
        originMonthKey: monthKey,
        sourceMonthKey: monthKey,
        subtitle: subtitleParts.join(' · '),
        name: item.namaItem,
        amount,
        projectedAmount,
        realisasiAmount: 0,
        color,
        hasCustomOverride: false,
      };
    });
}

function formatSimpleIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(
    Math.round(amount || 0)
  );
}

function formatInvestmentProjectionName(
  jenis: string,
  asset: Pick<InvestmentAsset, 'contractNumber' | 'name'>,
  detailSuffix = ''
): string {
  const contractNum = asset.contractNumber?.trim() || '';
  const investorName = asset.name?.trim() || '';
  const baseLabel = contractNum || investorName || '-';
  const detailPart = detailSuffix.trim() ? ` ${detailSuffix.trim()}` : '';
  if (contractNum && investorName && contractNum !== investorName) {
    return `${jenis} - ${baseLabel}${detailPart} - ${investorName}`;
  }
  return `${jenis} - ${baseLabel}${detailPart}`;
}

function formatInvestmentInterestOrDendaName(params: {
  asset: Pick<InvestmentAsset, 'contractNumber' | 'name' | 'status' | 'tenorMonths'>;
  instSuffix: string;
  dueMonthKey: string;
  projectionMonthKey: string;
  dueISO?: string;
  todayISO?: string;
  normalJenis?: string;
}): {
  name: string;
  isDenda: boolean;
  monthsLate: number;
  dueMonthKey: string;
} {
  const {
    asset,
    instSuffix,
    dueMonthKey,
    projectionMonthKey,
    dueISO,
    todayISO,
    normalJenis = 'Bunga',
  } = params;
  const effectiveTodayISO = todayISO ?? getTodayISODate();
  const cleanDueMK =
    dueISO && /^\d{4}-\d{2}-\d{2}$/.test(dueISO)
      ? dueISO.slice(0, 7)
      : /^\d{4}-\d{2}/.test(dueMonthKey)
      ? normalizeMonthKeyYYYYMM(dueMonthKey.slice(0, 7))
      : projectionMonthKey;
  const isDueByCalendarToday =
    dueISO && /^\d{4}-\d{2}-\d{2}$/.test(dueISO)
      ? effectiveTodayISO >= dueISO
      : effectiveTodayISO.slice(0, 7) >= cleanDueMK;
  const isDenda = Boolean(
    isDueByCalendarToday &&
      cleanDueMK < effectiveTodayISO.slice(0, 7) &&
      cleanDueMK < projectionMonthKey &&
      asset.status !== 'Lunas'
  );
  if (isDenda) {
    const monthsLate =
      dueISO && /^\d{4}-\d{2}-\d{2}$/.test(dueISO)
        ? Math.max(1, diffCalendarMonthsOverdue(dueISO, effectiveTodayISO))
        : Math.max(1, diffBossMonthKeys(cleanDueMK, effectiveTodayISO.slice(0, 7)));
    const baseName = formatInvestmentProjectionName('Denda', asset, instSuffix);
    const dueMonthLabel = formatBossMonthShortLabel(cleanDueMK);
    return {
      name: `${baseName} - Jatuh tempo ${dueMonthLabel}, telat ${monthsLate} bulan`,
      isDenda: true,
      monthsLate,
      dueMonthKey: cleanDueMK,
    };
  }
  return {
    name: formatInvestmentProjectionName(normalJenis, asset, instSuffix),
    isDenda: false,
    monthsLate: 0,
    dueMonthKey: cleanDueMK,
  };
}

export function computeBossReportViewModel(
  monthKey: string,
  monthData: BossReportMonthData,
  orders: PurchaseOrder[],
  clientInvoices: ClientInvoice[],
  opexItems: OpexItem[] = [],
  investments: InvestmentAsset[] = [],
  allBossReportMonths?: Record<string, BossReportMonthData>,
  options?: {
    todayISO?: string;
    cutoffPeriod?: string;
    projectionManualItems?: ProjectionManualItem[];
    _cache?: Map<string, BossReportViewModel>;
    _histCache?: Map<string, BossReportViewModel>;
    _visiting?: Set<string>;
  }
): BossReportViewModel {
  const cache = options?._cache ?? new Map<string, BossReportViewModel>();
  const histCache = options?._histCache ?? new Map<string, BossReportViewModel>();
  const visiting = options?._visiting ?? new Set<string>();
  if (cache.has(monthKey) && visiting.size > 0) {
    return cache.get(monthKey)!;
  }
  visiting.add(monthKey);
  const calcTodayISO = options?.todayISO ?? getTodayISODate();

  const overrideMap = new Map<string, BossReportAutoOverride>();
  for (const ov of monthData.autoOverrides) {
    overrideMap.set(ov.sourceId, ov);
  }

  const validAccIds = new Set(monthData.accounts.map((a) => a.id));
  const accIdByLowerName = new Map<string, string>();
  for (const a of monthData.accounts) {
    accIdByLowerName.set(a.name.trim().toLowerCase(), a.id);
  }

  const resolveOpexAccountId = (item: OpexItem): string | undefined => {
    if (item.sourceAccountId && validAccIds.has(item.sourceAccountId)) {
      return item.sourceAccountId;
    }
    if (item.sourceAccountName) {
      const matched = accIdByLowerName.get(item.sourceAccountName.trim().toLowerCase());
      if (matched) return matched;
    }
    return undefined;
  };

  const previousMonthKey = addMonthsToKey(monthKey, -1);
  const previousMonthLabel = formatBossMonthShortLabel(previousMonthKey);
  const rawAccountsSum = monthData.accounts.reduce(
    (sum, acc) => sum + (Number.isFinite(acc.balance) ? acc.balance : 0),
    0
  );

  const hasEarlierSavedMonth = Boolean(
    allBossReportMonths &&
      Object.keys(allBossReportMonths).some((k) => /^\d{4}-\d{2}$/.test(k) && k < monthKey)
  );

  let saldoAwal = 0;
  let saldoAwalSource: 'manual' | 'accounts' | 'auto' = 'auto';
  let hasPreviousMonthData = hasEarlierSavedMonth;
  let effectiveAccounts: BankAccountRow[] = monthData.accounts;
  let effectiveAccountsSum = rawAccountsSum;

  if (
    typeof monthData.manualOpeningBalance === 'number' &&
    Number.isFinite(monthData.manualOpeningBalance)
  ) {
    saldoAwal = Math.round(monthData.manualOpeningBalance);
    saldoAwalSource = 'manual';
  } else if (rawAccountsSum !== 0) {
    saldoAwal = rawAccountsSum;
    saldoAwalSource = 'accounts';
  } else if (
    hasEarlierSavedMonth &&
    visiting.size <= 36 &&
    !visiting.has(previousMonthKey)
  ) {
    const prevMonthData =
      allBossReportMonths?.[previousMonthKey] ?? createDefaultBossReportMonth(previousMonthKey);
    const prevVm = computeBossReportViewModel(
      previousMonthKey,
      prevMonthData,
      orders,
      clientInvoices,
      opexItems,
      investments,
      allBossReportMonths,
      {
        todayISO: options?.todayISO,
        _cache: histCache,
        _histCache: histCache,
        _visiting: visiting,
      }
    );
    saldoAwal = prevVm.endingBalanceRealisasi;
    saldoAwalSource = 'auto';
    hasPreviousMonthData = true;

    const prevRealisasiAccounts = computeBalanceAccountDetails(prevVm);
    if (prevRealisasiAccounts.length > 0) {
      if (!allBossReportMonths?.[monthKey]) {
        effectiveAccounts = prevRealisasiAccounts.map((acc) => ({
          id: acc.id,
          name: acc.name,
          balance: acc.endingBalance,
          ...(acc.isPrimary ? { isPrimary: true } : {}),
        }));
      } else {
        const prevById = new Map(prevRealisasiAccounts.map((a) => [a.id, a]));
        const prevByName = new Map(
          prevRealisasiAccounts.map((a) => [a.name.trim().toLowerCase(), a])
        );
        effectiveAccounts = monthData.accounts.map((acc) => {
          const matched =
            prevById.get(acc.id) ?? prevByName.get(acc.name.trim().toLowerCase());
          return matched ? { ...acc, balance: matched.endingBalance } : acc;
        });
      }
      effectiveAccountsSum = effectiveAccounts.reduce(
        (sum, acc) => sum + (Number.isFinite(acc.balance) ? acc.balance : 0),
        0
      );
    }
  }

  const saldoTersedia = saldoAwal;

  // Quick lookup maps for source entities (used for both native & rescheduledIn live status sync)
  const clientInvoicesById = new Map(clientInvoices.map((inv) => [inv.id, inv]));
  const opexById = new Map(opexItems.map((o) => [o.id, o]));
  const poById = new Map(orders.map((po) => [po.id, po]));
  const investmentsById = new Map(investments.map((inv) => [inv.id, inv]));

  // 1. Auto Cash In from Sent/Paid Client Invoices due in selectedMonthKey (Drafts & Voided excluded)
  const reschedSourceIdsInMonth = new Set(
    (monthData.rescheduledIn ?? []).map((rs) => rs.sourceId).filter(Boolean)
  );
  const autoClientRows: BossReportComputedRow[] = clientInvoices
    .filter((inv) => {
      if (inv.isDeleted || inv.isVoided || inv.status === 'Draft') return false;
      const targetDate = inv.dueDate || inv.invoiceDate || '';
      const ov = overrideMap.get(`ci_${inv.id}`);
      const inThisMonth = targetDate.slice(0, 7) === monthKey;
      const hasPendingOriginHere = Boolean(
        ov?.hasCustomColor && ov.color === 'red' && inv.rescheduledFromMonth === monthKey
      );
      return inThisMonth || hasPendingOriginHere;
    })
    .sort((a, b) => {
      const d = (a.dueDate || '').localeCompare(b.dueDate || '');
      if (d !== 0) return d;
      return a.invoiceNumber.localeCompare(b.invoiceNumber);
    })
    .map((inv): BossReportComputedRow | null => {
      const sourceId = `ci_${inv.id}`;
      const ov = overrideMap.get(sourceId);
      const eff = getClientInvoiceEffectiveStatus(inv);
      const arrivedInThisMonth = Boolean(
        inv.rescheduledFromMonth &&
          inv.rescheduledFromMonth !== monthKey &&
          (!inv.rescheduledToMonth || inv.rescheduledToMonth === monthKey) &&
          !reschedSourceIdsInMonth.has(sourceId)
      );
      const sourceDefault: BossReportColorStatus =
        eff === 'Paid'
          ? 'green'
          : (eff === 'Reschedule' || inv.status === 'Reschedule' || inv.statusWarna === 'MERAH') &&
            !arrivedInThisMonth
          ? 'red'
          : 'white';
      const { color, rescheduledToMonth } = resolveOverrideColor(
        ov,
        sourceDefault,
        arrivedInThisMonth ? undefined : inv.rescheduledToMonth
      );
      const isMovedOut = Boolean(
        color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
      );
      const rescheduledOutLabel =
        isMovedOut && rescheduledToMonth
          ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
          : undefined;
      const arrivedFromReschedule =
        arrivedInThisMonth && (!rescheduledToMonth || rescheduledToMonth === monthKey);
      const rescheduleLabel =
        arrivedFromReschedule && inv.rescheduledFromMonth
          ? formatRescheduleHistoryLabel([inv.rescheduledFromMonth, monthKey], {
              dueISO: inv.dueDate || inv.invoiceDate,
              todayISO: calcTodayISO,
              isPaid: color === 'green',
            })
          : undefined;
      const defaultName = `${inv.projectName} — ${inv.clientName}`;
      const breakdown = resolveClientInvoiceBreakdown(inv);
      const hasDeductions = breakdown.pphAmount > 0 || breakdown.citibankFeeAmount > 0;
      const subtitle = `Otomatis · ${inv.invoiceNumber} · Jatuh tempo ${formatShortDateID(
        inv.dueDate || inv.invoiceDate
      )}${
        hasDeductions
          ? ` · Net Akhir (Gross Rp ${formatSimpleIDR(breakdown.grossAmount)})`
          : ''
      }${
        color === 'green'
          ? ' (PAID)'
          : rescheduledOutLabel
          ? ` · ${rescheduledOutLabel}`
          : eff === 'Overdue'
          ? ' (OVERDUE)'
          : ''
      }${rescheduleLabel ? ` · ${rescheduleLabel}` : ''}`;

      const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
      const amount = ov?.hasCustomAmount
        ? ov.amount
        : resolveClientInvoiceCashInNominal(inv);
      const sourceRealisasi = inv.realisasiAmount ?? inv.actualAmount;
      const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
        amount,
        color,
        isMovedOut,
        ov?.hasCustomRealisasi
          ? (ov.realisasiAmount ?? ov.actual_amount)
          : sourceRealisasi
      );

      return {
        rowKey: sourceId,
        sourceId,
        isAuto: true,
        section: 'cashIn',
        sourceCategory: 'clientInvoice',
        cashInSource: 'invoice' as const,
        originMonthKey: inv.rescheduledFromMonth || monthKey,
        sourceMonthKey: monthKey,
        rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
        rescheduledOutLabel,
        ...(arrivedFromReschedule && inv.rescheduledFromMonth
          ? {
              fromMonthKey: inv.rescheduledFromMonth,
              rescheduledFromMonth: inv.rescheduledFromMonth,
              historyMonths: [inv.rescheduledFromMonth, monthKey],
              rescheduleLabel,
            }
          : {}),
        dueISO: inv.dueDate || inv.invoiceDate || undefined,
        subtitle,
        name,
        amount,
        projectedAmount,
        realisasiAmount,
        color,
        clientInvoiceId: inv.id,
        hasCustomOverride: Boolean(
          ov &&
            (ov.hasCustomName ||
              ov.hasCustomAmount ||
              ov.hasCustomColor ||
              ov.hasCustomRealisasi)
        ),
      };
    })
    .filter((r): r is BossReportComputedRow => r !== null);

  // 1b. Auto Cash In from Investment Loan Disbursements ("Pencairan Pinjaman") in Tgl Kontrak Month
  const autoInvestmentDisbursementRows: BossReportComputedRow[] = investments
    .filter((asset) => {
      if (asset.status === 'Ditunda') return false;
      if (resolveInvestmentDisbursementNominal(asset) <= 0) return false;
      const contractStartISO = getEffectiveAssetStartDate(asset);
      const inContractMonth = contractStartISO.slice(0, 7) === monthKey;
      const arrivedViaReschedule =
        asset.disbursementStatus === 'red' &&
        asset.disbursementRescheduledToMonth === monthKey &&
        !reschedSourceIdsInMonth.has(`inv_disb_${asset.id}`);
      return inContractMonth || arrivedViaReschedule;
    })
    .sort((a, b) => {
      const da = getEffectiveAssetStartDate(a);
      const db = getEffectiveAssetStartDate(b);
      const dCmp = da.localeCompare(db);
      if (dCmp !== 0) return dCmp;
      return (a.contractNumber || a.name).localeCompare(b.contractNumber || b.name);
    })
    .map((asset): BossReportComputedRow | null => {
      const sourceId = `inv_disb_${asset.id}`;
      const ov = overrideMap.get(sourceId);
      const contractStartISO = getEffectiveAssetStartDate(asset);
      const originMk = asset.disbursementRescheduledFromMonth || contractStartISO.slice(0, 7);
      const arrivedInThisMonth = Boolean(
        asset.disbursementRescheduledToMonth === monthKey &&
          originMk !== monthKey &&
          !reschedSourceIdsInMonth.has(sourceId)
      );
      const sourceDefault: BossReportColorStatus =
        asset.disbursementStatus === 'green'
          ? 'green'
          : asset.disbursementStatus === 'red' && !arrivedInThisMonth
          ? 'red'
          : 'white';
      const { color, rescheduledToMonth } = resolveOverrideColor(
        ov,
        sourceDefault,
        arrivedInThisMonth ? undefined : asset.disbursementRescheduledToMonth
      );
      const isMovedOut = Boolean(
        color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
      );
      const rescheduledOutLabel =
        isMovedOut && rescheduledToMonth
          ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
          : undefined;
      const arrivedFromReschedule =
        arrivedInThisMonth && (!rescheduledToMonth || rescheduledToMonth === monthKey);
      const rescheduleLabel = arrivedFromReschedule
        ? formatRescheduleHistoryLabel([originMk, monthKey], {
            dueISO: contractStartISO,
            todayISO: calcTodayISO,
            isPaid: color === 'green',
          })
        : undefined;
      const contractNum = asset.contractNumber?.trim();
      const defaultName = contractNum
        ? `Pencairan Pinjaman - ${contractNum} - ${asset.name}`
        : `Pencairan Pinjaman - ${asset.name}`;
      const subtitle = `Otomatis Pencairan Pinjaman Investment · Tgl Kontrak ${formatDDMMMYYYY(
        contractStartISO
      )}${
        color === 'green'
          ? ' (CAIR)'
          : rescheduledOutLabel
          ? ` · ${rescheduledOutLabel}`
          : ''
      }${rescheduleLabel ? ` · ${rescheduleLabel}` : ''}`;
      const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
      const amount = ov?.hasCustomAmount
        ? ov.amount
        : resolveInvestmentDisbursementNominal(asset);
      const sourceRealisasi = asset.disbursementRealisasiAmount;
      const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
        amount,
        color,
        isMovedOut,
        ov?.hasCustomRealisasi
          ? (ov.realisasiAmount ?? ov.actual_amount)
          : sourceRealisasi
      );

      return {
        rowKey: sourceId,
        sourceId,
        isAuto: true,
        section: 'cashIn',
        sourceCategory: 'investment',
        cashInSource: 'investmentDisbursement' as const,
        investmentAssetId: asset.id,
        originMonthKey: originMk,
        sourceMonthKey: monthKey,
        rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
        rescheduledOutLabel,
        ...(arrivedFromReschedule
          ? {
              fromMonthKey: originMk,
              rescheduledFromMonth: originMk,
              historyMonths: [originMk, monthKey],
              rescheduleLabel,
            }
          : {}),
        dueISO: contractStartISO,
        subtitle,
        name,
        amount,
        projectedAmount,
        realisasiAmount,
        color,
        hasCustomOverride: Boolean(
          ov &&
            (ov.hasCustomName ||
              ov.hasCustomAmount ||
              ov.hasCustomColor ||
              ov.hasCustomRealisasi)
        ),
      };
    })
    .filter((r): r is BossReportComputedRow => r !== null);

  const manualCashInRows = mapManualItems(
    monthData.cashInManual,
    'cim',
    'cashIn',
    monthKey
  );

  // 2. Cash Out Group A: Operasional dari tabel opex (+ Pending origin history)
  const autoOpexRows: BossReportComputedRow[] = opexItems
    .filter((item) => isOpexActiveInMonth(item, monthKey))
    .map((item): BossReportComputedRow | null => {
      const sourceId = `opex_${item.id}`;
      const ov = overrideMap.get(sourceId);
      const monthStatus = getOpexStatusForMonth(item, monthKey);
      const dbColor = item.isRecurring
        ? mapOpexStatusToColor(monthStatus)
        : mapOpexDbFieldsToColor(item.status, item.statusWarna);
      const arrivedInThisMonth = Boolean(
        !item.isRecurring &&
          item.rescheduledFromMonth &&
          item.rescheduledFromMonth !== monthKey &&
          (!item.rescheduledToMonth || item.rescheduledToMonth === monthKey) &&
          !reschedSourceIdsInMonth.has(sourceId)
      );
      const sourceDefault: BossReportColorStatus =
        dbColor === 'green' || mapOpexStatusToColor(monthStatus) === 'green'
          ? 'green'
          : (dbColor === 'red' || mapOpexStatusToColor(monthStatus) === 'red') &&
            !arrivedInThisMonth
          ? 'red'
          : 'white';
      const sourceRescheduledTarget = arrivedInThisMonth
        ? undefined
        : item.rescheduledMonths?.[monthKey] ?? item.rescheduledToMonth;
      const { color, rescheduledToMonth } = resolveOverrideColor(
        ov,
        sourceDefault,
        sourceRescheduledTarget
      );
      const isMovedOut = Boolean(
        color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
      );
      const rescheduledOutLabel =
        isMovedOut && rescheduledToMonth
          ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
          : undefined;
      const arrivedFromReschedule =
        arrivedInThisMonth && (!rescheduledToMonth || rescheduledToMonth === monthKey);
      const rescheduleLabel =
        arrivedFromReschedule && item.rescheduledFromMonth
          ? formatRescheduleHistoryLabel([item.rescheduledFromMonth, monthKey], {
              todayISO: calcTodayISO,
              isPaid: color === 'green',
            })
          : undefined;
      const statusText =
        color === 'green'
          ? 'Paid'
          : rescheduledOutLabel
          ? rescheduledOutLabel
          : color === 'red'
          ? 'Pending'
          : 'Projection';
      const subtitle = `Operasional · ${item.category}${
        item.sourceAccountName ? ` · ${item.sourceAccountName}` : ''
      }${item.isRecurring ? ' · Recurring' : ''}${
        item.dueDay ? ` · Tgl ${item.dueDay}` : ''
      } (${statusText})${rescheduleLabel ? ` · ${rescheduleLabel}` : ''}`;

      const name = ov?.hasCustomName && ov.name ? ov.name : item.name;
      const amount = ov?.hasCustomAmount ? ov.amount : item.amount || 0;
      const sourceRealisasi =
        item.monthRealisasi?.[monthKey] ??
        (!item.isRecurring || monthKey === item.monthKey
          ? (item.realisasiAmount ?? item.actualAmount)
          : undefined);
      const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
        amount,
        color,
        isMovedOut,
        ov?.hasCustomRealisasi
          ? (ov.realisasiAmount ?? ov.actual_amount)
          : sourceRealisasi
      );

      return {
        rowKey: sourceId,
        sourceId,
        isAuto: true,
        section: 'operasional',
        sourceCategory: 'opex',
        originMonthKey: item.rescheduledFromMonth || monthKey,
        sourceMonthKey: monthKey,
        rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
        rescheduledOutLabel,
        ...(arrivedFromReschedule && item.rescheduledFromMonth
          ? {
              fromMonthKey: item.rescheduledFromMonth,
              rescheduledFromMonth: item.rescheduledFromMonth,
              historyMonths: [item.rescheduledFromMonth, monthKey],
              rescheduleLabel,
            }
          : {}),
        subtitle,
        name,
        amount,
        projectedAmount,
        realisasiAmount,
        color,
        opexId: item.id,
        accountId: resolveOpexAccountId(item),
        hasCustomOverride: Boolean(
          ov &&
            (ov.hasCustomName ||
              ov.hasCustomAmount ||
              ov.hasCustomColor ||
              ov.hasCustomRealisasi)
        ),
      };
    })
    .filter((r): r is BossReportComputedRow => r !== null);

  const manualOpexRows = mapManualItems(
    monthData.operasional,
    'op',
    'operasional',
    monthKey
  );

  // 3. Cash Out Group B: Investment — dipecah per komponen per aset (Pokok | Bunga | Bonus)
  // cutoffPeriod adalah BATAS BAWAH (lower bound) untuk perhitungan Bunga:
  // - Jika periode item (monthKey) < effectiveCutoffPeriod -> sudah lewat cutoff (tutup buku / lunas), JANGAN hitung Bunga lagi.
  // - Jika periode item (monthKey) >= effectiveCutoffPeriod -> masih berjalan normal, hitung Bunga dan tagihan sesuai periodenya.
  // Pokok tidak kena cutoff dan tetap memakai Periode Projection (monthKey).
  const todayISO = options?.todayISO ?? getTodayISODate();
  const effectiveCutoffPeriod = options?.cutoffPeriod
    ? normalizeMonthKeyYYYYMM(options.cutoffPeriod)
    : monthKey;
  const cutoffGlobalDateISO = `${effectiveCutoffPeriod}-01`;
  const isPeriodOnOrAfterCutoff = monthKey >= effectiveCutoffPeriod;

  // Track which components already entered this month via rescheduledIn so shifted Pokok/Bonus do not double-count
  const rescheduledInPrincipalAssetIds = new Set<string>();
  const rescheduledInBonusAssetIds = new Set<string>();
  for (const rs of monthData.rescheduledIn ?? []) {
    if (rs.sourceCategory === 'investment' && rs.investmentAssetId) {
      if (rs.investmentComponent === 'principal') {
        rescheduledInPrincipalAssetIds.add(rs.investmentAssetId);
      } else if (rs.investmentComponent === 'bonus') {
        rescheduledInBonusAssetIds.add(rs.investmentAssetId);
      }
    }
  }

  // Track whether post-maturity / maturity principal was already marked HIJAU (Paid) or MERAH (Pending) in an earlier month
  const isPostMaturityPrincipalPaidViaProjection = (
    assetId: string,
    minMonthKey: string,
    beforeMonthKey: string
  ): boolean => {
    if (!allBossReportMonths) return false;
    for (const [mk, mData] of Object.entries(allBossReportMonths)) {
      if (mk < minMonthKey || mk >= beforeMonthKey) continue;
      const ovHit = mData.autoOverrides?.find(
        (ov) => ov.sourceId === `inv_asset_${assetId}` && ov.hasCustomColor && ov.color === 'green'
      );
      if (ovHit) return true;
      const rsHit = (mData.rescheduledIn ?? []).find(
        (rs) =>
          rs.investmentAssetId === assetId &&
          rs.investmentComponent === 'principal' &&
          rs.color === 'green'
      );
      if (rsHit) return true;
    }
    return false;
  };

  // Anti-regeneration guard: jika Pokok sudah di-Pending di bulan sebelumnya menuju monthKey atau bulan > monthKey,
  // jangan generate ulang Pokok polos baru di monthKey saat refresh.
  const isPrincipalPendingForwardFromEarlier = (
    assetId: string,
    beforeMonthKey: string
  ): boolean => {
    const assetObj = investmentsById.get(assetId);
    if (assetObj?.rescheduledMonths) {
      for (const [rawKey, toMk] of Object.entries(assetObj.rescheduledMonths)) {
        if (rawKey.endsWith('__principal')) {
          const origMk = rawKey.slice(0, 7);
          if (origMk < beforeMonthKey && toMk && toMk >= beforeMonthKey) {
            return true;
          }
        }
      }
    }
    if (!allBossReportMonths) return false;
    for (const [mk, mData] of Object.entries(allBossReportMonths)) {
      if (mk >= beforeMonthKey) continue;
      const ovHit = mData.autoOverrides?.find(
        (ov) =>
          ov.sourceId === `inv_asset_${assetId}` &&
          ov.hasCustomColor &&
          ov.color === 'red' &&
          Boolean(ov.rescheduledToMonth) &&
          ov.rescheduledToMonth! >= beforeMonthKey
      );
      if (ovHit) return true;
      const rsHit = (mData.rescheduledIn ?? []).find(
        (rs) =>
          rs.investmentAssetId === assetId &&
          rs.investmentComponent === 'principal' &&
          rs.color === 'red' &&
          Boolean(rs.rescheduledToMonth) &&
          rs.rescheduledToMonth! >= beforeMonthKey
      );
      if (rsHit) return true;
    }
    return false;
  };

  // Status per komponen independen: kunci { assetId + monthKey + component }
  const getAssetComponentMonthState = (
    asset: InvestmentAsset,
    targetMonthKey: string,
    component: InvestmentComponentKind
  ): {
    isPaid: boolean;
    isPending: boolean;
    rescheduledToMonth?: string;
  } => {
    const paidSet = new Set(Array.isArray(asset.paidMonths) ? asset.paidMonths : []);
    const isPaid =
      asset.status === 'Lunas' || isInvestmentComponentPaidInSet(paidSet, targetMonthKey, component);

    const compKey = buildInvestmentComponentPeriodKey(targetMonthKey, component);
    const statuses = asset.monthStatuses ?? {};
    const warnas = asset.monthStatusWarnas ?? {};
    const rescheds = asset.rescheduledMonths ?? {};

    const hasCompStatus =
      Object.prototype.hasOwnProperty.call(statuses, compKey) ||
      Object.prototype.hasOwnProperty.call(warnas, compKey) ||
      Object.prototype.hasOwnProperty.call(rescheds, compKey);

    if (hasCompStatus) {
      const st = statuses[compKey];
      const sw = warnas[compKey];
      const rt = rescheds[compKey];
      const isPending = Boolean(
        (st === 'Reschedule' || sw === 'MERAH' || (rt && rt !== targetMonthKey)) &&
          (!rt || rt !== targetMonthKey)
      );
      return {
        isPaid,
        isPending,
        rescheduledToMonth: isPending ? rt : undefined,
      };
    }

    const anyCompKeysForMonth =
      hasInvestmentComponentEntriesForMonth(Object.keys(statuses), targetMonthKey) ||
      hasInvestmentComponentEntriesForMonth(Object.keys(warnas), targetMonthKey) ||
      hasInvestmentComponentEntriesForMonth(Object.keys(rescheds), targetMonthKey);

    // Jika di bulan berjalan ada autoOverride pada komponen lain dari kontrak ini,
    // jangan pernah wariskan status polos lama agar tidak terjadi cascade antar komponen.
    const sourceIdMap: Record<InvestmentComponentKind, string> = {
      principal: `inv_asset_${asset.id}`,
      interest: `inv_int_${asset.id}`,
      lateFee: `inv_int_${asset.id}`,
      bonus: `inv_bonus_${asset.id}`,
    };
    const mySourceId = sourceIdMap[component];
    const hasSiblingOverrideInMonth =
      targetMonthKey === monthKey &&
      (['inv_asset_', 'inv_int_', 'inv_fee_', 'inv_bonus_'] as const).some((prefix) => {
        const sid = `${prefix}${asset.id}`;
        if (sid === mySourceId) return false;
        const sibOv = overrideMap.get(sid);
        return Boolean(sibOv?.hasCustomColor);
      });

    if (!anyCompKeysForMonth && !hasSiblingOverrideInMonth) {
      const bareSt = statuses[targetMonthKey];
      const bareSw = warnas[targetMonthKey];
      const bareRt = rescheds[targetMonthKey];
      const isPending = Boolean(
        (bareSt === 'Reschedule' || bareSw === 'MERAH' || (bareRt && bareRt !== targetMonthKey)) &&
          bareRt
      );
      return {
        isPaid,
        isPending,
        rescheduledToMonth: isPending ? bareRt : undefined,
      };
    }

    return { isPaid, isPending: false };
  };

  interface ActiveInvestmentEntry {
    asset: InvestmentAsset;
    installment: InvestmentInstallmentRow | null;
    interestInstallment: InvestmentInstallmentRow | null;
    maturityRow: InvestmentInstallmentRow | null;
    effectiveEndDateISO: string;
    effectiveEndMonthKey: string;
    sisaPokok: number;
    effectivePrincipalForMonth: number;
    hasPaidPrincipalOverrideThisMonth: boolean;
    hasPaidAnyOverrideThisMonth: boolean;
    hasPendingAnyOverrideThisMonth: boolean;
    paidBeforeViaProjection: boolean;
    principalCarryOverDue: boolean;
    overdueCarryOver: boolean;
    hasOngoingInterestDue: boolean;
  }

  const activeInvestmentEntries: ActiveInvestmentEntry[] = investments
    .filter((asset) => asset.status !== 'Ditunda')
    .map((asset) => {
      const schedule = buildInvestmentSchedule(asset, {
        todayISO,
        cutoffDateOverride: cutoffGlobalDateISO,
      });
      const portfolioTotals = computeInvestmentPortfolioTotals(asset, {
        todayISO,
        cutoffDateOverride: cutoffGlobalDateISO,
      });
      const sisaPokok = portfolioTotals.remainingPrincipal;
      const effectiveEndDateISO = getEffectiveAssetEndDate(asset);
      const effectiveEndMonthKey = effectiveEndDateISO.slice(0, 7);
      const currentRow = schedule.find((r) => r.monthKey === monthKey) ?? null;
      const interestRow = isPeriodOnOrAfterCutoff ? currentRow : null;
      const maturityRow =
        [...schedule].reverse().find((r) => r.principalPaid > 0) ?? null;
      const lastScheduleMonthKey =
        schedule.length > 0 ? schedule[schedule.length - 1].monthKey : effectiveEndMonthKey;

      const principalOv = overrideMap.get(`inv_asset_${asset.id}`);
      const interestOv = overrideMap.get(`inv_int_${asset.id}`);
      const feeOv = overrideMap.get(`inv_fee_${asset.id}`);
      const bonusOv = overrideMap.get(`inv_bonus_${asset.id}`);
      const hasPaidPrincipalOverrideThisMonth = Boolean(
        principalOv?.hasCustomColor && principalOv.color === 'green'
      );
      const hasPaidAnyOverrideThisMonth = Boolean(
        hasPaidPrincipalOverrideThisMonth ||
          (isPeriodOnOrAfterCutoff &&
            ((interestOv?.hasCustomColor && interestOv.color === 'green') ||
              (feeOv?.hasCustomColor && feeOv.color === 'green'))) ||
          (bonusOv?.hasCustomColor && bonusOv.color === 'green')
      );
      const isAssetMonthRescheduledHere = Boolean(
        asset.monthStatuses?.[monthKey] === 'Reschedule' ||
          (asset.rescheduledMonths?.[monthKey] && asset.rescheduledMonths[monthKey] !== monthKey) ||
          INVESTMENT_COMPONENT_KEYS.some((comp) => {
            const ck = buildInvestmentComponentPeriodKey(monthKey, comp);
            return (
              asset.monthStatuses?.[ck] === 'Reschedule' ||
              (asset.rescheduledMonths?.[ck] && asset.rescheduledMonths[ck] !== monthKey)
            );
          })
      );
      const hasPendingAnyOverrideThisMonth = Boolean(
        isAssetMonthRescheduledHere ||
          (principalOv?.hasCustomColor && principalOv.color === 'red') ||
          (interestOv?.hasCustomColor && interestOv.color === 'red') ||
          (feeOv?.hasCustomColor && feeOv.color === 'red') ||
          (bonusOv?.hasCustomColor && bonusOv.color === 'red')
      );

      // Untuk Pokok di Akhir (BALLOON) maupun Pokok + Bunga (ANUITAS) setelah tenor selesai:
      // Jika bulan ini >= bulan jatuh tempo pokok (atau lewat tenor terakhir untuk ANUITAS),
      // Sisa Pokok dari database > 0, dan belum dibayar / belum Lunas:
      // 1) Pokok JATUH TEMPO terus muncul sebesar Sisa Pokok sampai Paid (HIJAU).
      // 2) Bunga Per Bulan TETAP BERJALAN muncul setiap bulan berikutnya selama Pokok belum lunas!
      const firstInstallmentMonthKey = getFirstInstallmentMonthKey(asset);
      const contractStartMonthKey = getEffectiveAssetStartDate(asset).slice(0, 7);
      const minPaidCheckMonthKey =
        asset.paymentMethod === 'BALLOON'
          ? contractStartMonthKey || firstInstallmentMonthKey || effectiveEndMonthKey
          : lastScheduleMonthKey || effectiveEndMonthKey;

      const paidBeforeViaProjection =
        minPaidCheckMonthKey
          ? isPostMaturityPrincipalPaidViaProjection(
              asset.id,
              minPaidCheckMonthKey,
              monthKey
            )
          : false;

      // Jika Pokok baru ditandai HIJAU - Paid DI BULAN BERJALAN (bukan bulan sebelumnya),
      // pertahankan nominal pokoknya di bulan berjalan agar baris HIJAU - Paid (Realisasi) tetap tampil
      // dan bisa direvisi/dibatalkan kapanpun, serta Bunga bulan berjalan tidak mendadak hilang.
      const fallbackAssetPrincipal =
        maturityRow?.principalPaid || Math.round(asset.principalAmount || 0);
      const effectivePrincipalForMonth =
        sisaPokok > 0
          ? sisaPokok
          : hasPaidPrincipalOverrideThisMonth && !paidBeforeViaProjection
          ? fallbackAssetPrincipal
          : 0;

      const isBalloon = asset.paymentMethod === 'BALLOON';

      // Cutoff untuk metode Pokok + Bunga (ANUITAS):
      // 1 angsuran = 1 paket Pokok Angsuran + Bunga/Denda. Angsuran sebelum Periode Projection dianggap lunas (tidak tampil).
      // Untuk Pokok di Akhir (BALLOON), Pokok tetap ditagih FULL sampai Lunas, dan Bunga/Denda dihitung jika periode >= Cutoff.
      const principalCarryOverDue = Boolean(
        isBalloon &&
          effectivePrincipalForMonth > 0 &&
          (asset.status !== 'Lunas' ||
            (hasPaidPrincipalOverrideThisMonth && !paidBeforeViaProjection)) &&
          !paidBeforeViaProjection &&
          Boolean(effectiveEndMonthKey && monthKey >= effectiveEndMonthKey)
      );

      const overdueCarryOver = Boolean(
        principalCarryOverDue && (!currentRow || currentRow.principalPaid === 0)
      );

      const hasOngoingInterestDue = Boolean(
        isBalloon &&
          isPeriodOnOrAfterCutoff &&
          effectivePrincipalForMonth > 0 &&
          (asset.status !== 'Lunas' ||
            (hasPaidPrincipalOverrideThisMonth && !paidBeforeViaProjection)) &&
          !paidBeforeViaProjection &&
          firstInstallmentMonthKey &&
          monthKey >= firstInstallmentMonthKey &&
          (asset.monthlyInterestAmount > 0 ||
            asset.monthlyInterestRate > 0 ||
            (asset.lateFeePerMonthAmount ?? 0) > 0 ||
            (asset.lateFeePerMonthRate ?? 0) > 0)
      );

      return {
        asset,
        installment: currentRow,
        interestInstallment: interestRow,
        maturityRow,
        effectiveEndDateISO,
        effectiveEndMonthKey,
        sisaPokok,
        effectivePrincipalForMonth,
        hasPaidPrincipalOverrideThisMonth,
        hasPaidAnyOverrideThisMonth,
        hasPendingAnyOverrideThisMonth,
        paidBeforeViaProjection,
        principalCarryOverDue,
        overdueCarryOver,
        hasOngoingInterestDue,
      };
    })
    .filter((entry) =>
      Boolean(
        entry.installment ||
          (entry.asset.paymentMethod === 'BALLOON' && entry.interestInstallment) ||
          entry.principalCarryOverDue ||
          entry.hasOngoingInterestDue ||
          (entry.hasPaidAnyOverrideThisMonth && !entry.paidBeforeViaProjection) ||
          entry.hasPendingAnyOverrideThisMonth
      )
    );

  const autoInvestmentRows: BossReportComputedRow[] = [];
  const emittedInvestmentSourceIds = new Set<string>();
  const emittedInterestOrFeeAssetIds = new Set<string>();
  let hiddenNotDuePrincipalCount = 0;

  for (const {
    asset,
    installment,
    interestInstallment,
    maturityRow,
    effectiveEndDateISO,
    effectiveEndMonthKey,
    sisaPokok,
    effectivePrincipalForMonth,
    hasPaidPrincipalOverrideThisMonth,
    hasPaidAnyOverrideThisMonth,
    paidBeforeViaProjection,
    principalCarryOverDue,
    overdueCarryOver,
    hasOngoingInterestDue,
  } of activeInvestmentEntries) {
    const contractLabel = asset.contractNumber?.trim() || asset.name;
    const investorSubtitleNote =
      asset.contractNumber?.trim() && asset.contractNumber.trim() !== asset.name
        ? asset.name
        : asset.institution && asset.institution !== '-'
        ? asset.institution
        : asset.name;

    const sortedPaidMonths = Array.isArray(asset.paidMonths)
      ? [...asset.paidMonths]
          .filter((m) => /^\d{4}-\d{2}(?:__principal)?$/.test(m))
          .map((m) => m.slice(0, 7))
          .sort()
      : [];
    const lastPaidMonthKey =
      sortedPaidMonths.length > 0 ? sortedPaidMonths[sortedPaidMonths.length - 1] : '';
    const principalCompState = getAssetComponentMonthState(asset, monthKey, 'principal');
    const bonusCompState = getAssetComponentMonthState(asset, monthKey, 'bonus');
    const settledInEarlierMonth = Boolean(
      (asset.paymentMethod === 'BALLOON' && paidBeforeViaProjection) ||
        (asset.status === 'Lunas' &&
          !hasPaidAnyOverrideThisMonth &&
          !principalCompState.isPaid &&
          !overrideMap.get(`inv_asset_${asset.id}`)?.hasCustomColor &&
          !overrideMap.get(`inv_int_${asset.id}`)?.hasCustomColor) ||
        (asset.status === 'Lunas' &&
          !hasPaidAnyOverrideThisMonth &&
          lastPaidMonthKey &&
          monthKey > lastPaidMonthKey &&
          !overrideMap.get(`inv_asset_${asset.id}`)?.hasCustomColor &&
          !overrideMap.get(`inv_int_${asset.id}`)?.hasCustomColor)
    );

    // KHUSUS POKOK + BUNGA (ANUITAS): 1 baris tunggal "Angsuran - [No. Kontrak] ([n]/[Tenor]) - [Nama Investor]"
    if (asset.paymentMethod === 'ANUITAS') {
      if (
        !settledInEarlierMonth &&
        installment &&
        (!installment.isBonusOnlyRow || installment.principalPaid > 0)
      ) {
        const sourceId = `inv_asset_${asset.id}`;
        const ov = overrideMap.get(sourceId) ?? overrideMap.get(`inv_int_${asset.id}`);
        const isPaidSource = Boolean(
          asset.status === 'Lunas' || installment.isPrincipalPaid || principalCompState.isPaid
        );
        const sourceDefault: BossReportColorStatus = isPaidSource
          ? 'green'
          : principalCompState.isPending
          ? 'red'
          : 'white';
        const { color, rescheduledToMonth } = resolveOverrideColor(
          ov,
          sourceDefault,
          principalCompState.isPending ? principalCompState.rescheduledToMonth : undefined
        );

        const activeAd = installment.addendumSequence
          ? asset.addendums?.find((ad) => ad.sequenceNumber === installment.addendumSequence)
          : undefined;
        const scheduleAngsuran = Math.round(
          (installment.principalPaid || 0) +
            (installment.regularInterest ?? installment.interestPaid ?? 0)
        );
        const baseAngsuranAmount =
          activeAd && activeAd.newMonthlyInstallment && activeAd.newMonthlyInstallment > 0
            ? Math.round(activeAd.newMonthlyInstallment)
            : asset.interestInputType === 'RP' &&
              !installment.addendumSequence &&
              (asset.monthlyInstallment || 0) > 0
            ? Math.round(asset.monthlyInstallment)
            : scheduleAngsuran > 0
            ? scheduleAngsuran
            : Math.round(asset.monthlyInstallment || 0);

        if (baseAngsuranAmount > 0 || (ov?.hasCustomAmount && ov.amount > 0)) {
          const rawInstNumber = installment.installmentNumber ?? 0;
          const instNumber = rawInstNumber > 0 ? rawInstNumber : asset.tenorMonths;
          const instSuffix =
            asset.tenorMonths > 1 || rawInstNumber > 0
              ? `(${instNumber}/${asset.tenorMonths})`
              : '';
          const dueISOAngsuran = installment.dueISO || effectiveEndDateISO;
          const instDueMK = (installment.dueISO || installment.monthKey || monthKey).slice(0, 7);
          const labelInfo = formatInvestmentInterestOrDendaName({
            asset,
            instSuffix,
            dueMonthKey: instDueMK,
            projectionMonthKey: monthKey,
            dueISO: dueISOAngsuran,
            todayISO,
            normalJenis: 'Angsuran',
          });
          const isPastDueDate = !isPaidSource && dueISOAngsuran < todayISO;
          const isDueTodayOrBefore = !isPaidSource && dueISOAngsuran <= todayISO;
          const defaultName = labelInfo.name;
          const isMovedOut = Boolean(
            color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
          );
          const rescheduledOutLabel =
            isMovedOut && rescheduledToMonth
              ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
              : undefined;
          const dueBadgeLabel =
            color === 'white' && labelInfo.isDenda
              ? `TELAT ${labelInfo.monthsLate} BULAN`
              : color === 'white' && isPastDueDate
              ? 'JATUH TEMPO'
              : undefined;
          const subtitle = `Otomatis Angsuran Investment · ${investorSubtitleNote} · Pokok + Bunga (Rp ${formatSimpleIDR(
            installment.principalPaid
          )} + Rp ${formatSimpleIDR(
            Math.max(0, baseAngsuranAmount - installment.principalPaid)
          )})${
            labelInfo.isDenda
              ? ` · Jatuh tempo ${formatBossMonthShortLabel(labelInfo.dueMonthKey)}, telat ${labelInfo.monthsLate} bulan`
              : ''
          } · Periode ${formatBossMonthFullLabel(monthKey)} · JT ${formatDDMMMYYYY(dueISOAngsuran)}${
            color === 'green'
              ? ' · Paid'
              : rescheduledOutLabel
              ? ` · ${rescheduledOutLabel}`
              : labelInfo.isDenda || isDueTodayOrBefore
              ? ' · JATUH TEMPO'
              : ' · Projection'
          }`;

          const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
          const amount = ov?.hasCustomAmount ? ov.amount : baseAngsuranAmount;
          const instMKAngsuran = installment.monthKey || monthKey;
          const sourceRealisasiAngsuran =
            asset.monthRealisasi?.[`${monthKey}__principal`] ??
            asset.monthRealisasi?.[`${monthKey}__interest`] ??
            asset.monthRealisasi?.[`${monthKey}__lateFee`] ??
            asset.monthRealisasi?.[`${instMKAngsuran}__principal`] ??
            asset.monthRealisasi?.[`${instMKAngsuran}__interest`];
          const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
            amount,
            color,
            isMovedOut,
            ov?.hasCustomRealisasi
              ? (ov.realisasiAmount ?? ov.actual_amount)
              : sourceRealisasiAngsuran
          );

          emittedInvestmentSourceIds.add(sourceId);
          emittedInvestmentSourceIds.add(`inv_int_${asset.id}`);
          emittedInterestOrFeeAssetIds.add(asset.id);
          autoInvestmentRows.push({
            rowKey: sourceId,
            sourceId,
            isAuto: true,
            section: 'investment',
            sourceCategory: 'investment',
            originMonthKey: monthKey,
            sourceMonthKey: monthKey,
            rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
            rescheduledOutLabel,
            dueBadgeLabel,
            dueBadgeTone: dueBadgeLabel ? 'red' : undefined,
            dueISO: dueISOAngsuran,
            subtitle,
            name,
            amount,
            projectedAmount,
            realisasiAmount,
            color,
            investmentAssetId: asset.id,
            investmentComponent: 'principal',
            investmentInstallmentNumber: instNumber,
            investmentInstallmentMonthKey: instMKAngsuran,
            hasCustomOverride: Boolean(
              ov &&
                (ov.hasCustomName ||
                  ov.hasCustomAmount ||
                  ov.hasCustomColor ||
                  ov.hasCustomRealisasi)
            ),
          });
        }
      }

      // ROW BONUS (jika ada Bonus cair di bulan ini)
      if (
        installment &&
        installment.bonusPaid > 0 &&
        !rescheduledInBonusAssetIds.has(asset.id)
      ) {
        const sourceId = `inv_bonus_${asset.id}`;
        const ov = overrideMap.get(sourceId);
        const isBonusPaidSource = Boolean(
          asset.status === 'Lunas' || installment.isBonusPaid || bonusCompState.isPaid
        );
        const sourceDefault: BossReportColorStatus = isBonusPaidSource
          ? 'green'
          : bonusCompState.isPending
          ? 'red'
          : 'white';
        const { color, rescheduledToMonth } = resolveOverrideColor(
          ov,
          sourceDefault,
          bonusCompState.isPending ? bonusCompState.rescheduledToMonth : undefined
        );
        const bonusDateISO = getEffectiveAssetBonusDate(asset);
        const rateLabel =
          asset.bonusInputType === 'PERCENT' ? `(${asset.bonusRate || 0}%)` : '';
        const defaultName = formatInvestmentProjectionName('Bonus', asset, rateLabel);
        const isMovedOut = Boolean(
          color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
        );
        const rescheduledOutLabel =
          isMovedOut && rescheduledToMonth
            ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
            : undefined;
        const subtitle = `Otomatis Bonus Investment · ${investorSubtitleNote} · Cair ${formatDDMMMYYYY(
          bonusDateISO
        )}${color === 'green' ? ' · Paid' : ''}${
          rescheduledOutLabel ? ` · ${rescheduledOutLabel}` : ''
        }`;

        const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
        const amount = ov?.hasCustomAmount ? ov.amount : installment.bonusPaid;
        const sourceRealisasiBonus =
          asset.monthRealisasi?.[`${monthKey}__bonus`] ??
          asset.monthRealisasi?.[`${installment.monthKey}__bonus`];
        const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
          amount,
          color,
          isMovedOut,
          ov?.hasCustomRealisasi
            ? (ov.realisasiAmount ?? ov.actual_amount)
            : sourceRealisasiBonus
        );

        emittedInvestmentSourceIds.add(sourceId);
        autoInvestmentRows.push({
          rowKey: sourceId,
          sourceId,
          isAuto: true,
          section: 'investment',
          sourceCategory: 'investment',
          originMonthKey: monthKey,
          sourceMonthKey: monthKey,
          rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
          rescheduledOutLabel,
          dueISO: bonusDateISO,
          subtitle,
          name,
          amount,
          projectedAmount,
          realisasiAmount,
          color,
          investmentAssetId: asset.id,
          investmentComponent: 'bonus',
          investmentInstallmentNumber: installment.installmentNumber,
          investmentInstallmentMonthKey: installment.monthKey,
          hasCustomOverride: Boolean(
            ov &&
              (ov.hasCustomName ||
                ov.hasCustomAmount ||
                ov.hasCustomColor ||
                ov.hasCustomRealisasi)
          ),
        });
      }
      continue;
    }

    // ROW 1 (BALLOON): POKOK — [No. Kontrak]
    const principalSource =
      asset.paymentMethod === 'BALLOON'
        ? principalCarryOverDue
          ? maturityRow ?? installment
          : installment && !installment.isBonusOnlyRow
          ? installment
          : null
        : principalCarryOverDue && !installment
        ? maturityRow ?? installment
        : installment && (!installment.isBonusOnlyRow || installment.principalPaid > 0)
        ? installment
        : null;

    if ((principalSource || principalCarryOverDue) && !settledInEarlierMonth) {
      const sourceId = `inv_asset_${asset.id}`;
      const ov = overrideMap.get(sourceId);
      const isDuePrincipalCarry = principalCarryOverDue;
      const isOwnPendingHere = Boolean(
        (ov?.hasCustomColor && ov.color === 'red') || principalCompState.isPending
      );
      const skipDuplicateRescheduledPrincipal =
        isDuePrincipalCarry &&
        !isOwnPendingHere &&
        !ov?.hasCustomColor &&
        (rescheduledInPrincipalAssetIds.has(asset.id) ||
          isPrincipalPendingForwardFromEarlier(asset.id, monthKey));

      if (!skipDuplicateRescheduledPrincipal) {
        const isPaidSource = Boolean(
          asset.status === 'Lunas' ||
            principalCompState.isPaid ||
            (isDuePrincipalCarry
              ? asset.paymentMethod === 'BALLOON' && maturityRow?.isPrincipalPaid
              : principalSource?.isPrincipalPaid)
        );
        const sourceDefault: BossReportColorStatus = isPaidSource
          ? 'green'
          : principalCompState.isPending
          ? 'red'
          : 'white';
        const { color, rescheduledToMonth } = resolveOverrideColor(
          ov,
          sourceDefault,
          principalCompState.isPending ? principalCompState.rescheduledToMonth : undefined
        );

        let baseAmount = 0;
        if (asset.paymentMethod === 'BALLOON') {
          if (isDuePrincipalCarry) {
            baseAmount =
              sisaPokok > 0
                ? sisaPokok
                : hasPaidPrincipalOverrideThisMonth
                ? effectivePrincipalForMonth
                : 0;
          } else {
            baseAmount =
              color === 'red' && ov && ov.amount > 0
                ? ov.amount
                : principalSource?.principalPaid ?? 0;
          }
        } else {
          if (overdueCarryOver) {
            baseAmount =
              sisaPokok > 0
                ? sisaPokok
                : hasPaidPrincipalOverrideThisMonth
                ? effectivePrincipalForMonth
                : 0;
          } else {
            baseAmount =
              color === 'red' && ov && ov.amount > 0 && (principalSource?.principalPaid ?? 0) === 0
                ? ov.amount
                : principalSource?.principalPaid ?? 0;
          }
        }

        const isBalloonBeforeMaturity = Boolean(
          asset.paymentMethod === 'BALLOON' &&
            !isDuePrincipalCarry &&
            (principalSource?.principalPaid ?? 0) === 0 &&
            (!effectiveEndMonthKey || monthKey < effectiveEndMonthKey)
        );
        const hasCustomNonZeroAmount = Boolean(ov?.hasCustomAmount && ov.amount > 0);
        const isActiveRescheduleOut = Boolean(
          color === 'red' && rescheduledToMonth && baseAmount > 0
        );

        if (
          (isBalloonBeforeMaturity || (!isDuePrincipalCarry && baseAmount === 0)) &&
          !hasCustomNonZeroAmount &&
          !isActiveRescheduleOut
        ) {
          if (isBalloonBeforeMaturity && sisaPokok > 0 && asset.status !== 'Lunas') {
            hiddenNotDuePrincipalCount += 1;
          }
        } else {
          const dueISOForPrincipal = isDuePrincipalCarry
            ? effectiveEndDateISO
            : principalSource?.dueISO || effectiveEndDateISO;

          const isPastDueDate = Boolean(
            !isPaidSource && dueISOForPrincipal < todayISO && baseAmount > 0
          );
          const isDueTodayOrOverdue = Boolean(
            !isPaidSource && dueISOForPrincipal <= todayISO && baseAmount > 0
          );
          const principalMonthsLate = isPastDueDate
            ? diffCalendarMonthsOverdue(dueISOForPrincipal, todayISO)
            : 0;
          const isFinalPrincipalDue = Boolean(
            isDuePrincipalCarry && baseAmount > 0 && !isPaidSource
          );

          const rawInstNumber = principalSource?.installmentNumber ?? 0;
          const instNumber = rawInstNumber > 0 ? rawInstNumber : asset.tenorMonths;
          const instSuffix =
            asset.tenorMonths > 1 || rawInstNumber > 0
              ? `(${instNumber}/${asset.tenorMonths})`
              : '';
          const defaultName = formatInvestmentProjectionName(
            'Pokok',
            asset,
            instSuffix
          );

          const isMovedOut = Boolean(
            color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
          );
          const rescheduledOutLabel =
            isMovedOut && rescheduledToMonth
              ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
              : undefined;

          let dueBadgeLabel: string | undefined;
          let dueBadgeTone: 'red' | 'amber' | undefined;
          if (color === 'white' && baseAmount > 0 && !isPaidSource) {
            if (isPastDueDate && principalMonthsLate > 0) {
              dueBadgeLabel = `JATUH TEMPO - TERLAMBAT ${principalMonthsLate} BULAN`;
              dueBadgeTone = 'red';
            } else if (isDueTodayOrOverdue) {
              dueBadgeLabel = 'POKOK JATUH TEMPO';
              dueBadgeTone = 'red';
            }
          }

          const methodLabel =
            asset.paymentMethod === 'BALLOON' ? 'Pokok di Akhir' : 'Pokok + Bunga';
          const statusDetailText =
            color === 'green'
              ? ' · Paid'
              : rescheduledOutLabel
              ? ` · ${rescheduledOutLabel}`
              : isPastDueDate && principalMonthsLate > 0
              ? ` · JATUH TEMPO - TERLAMBAT ${principalMonthsLate} BULAN`
              : isDueTodayOrOverdue
              ? (principalSource?.monthKey || effectiveEndMonthKey) < monthKey
                ? ` · POKOK JATUH TEMPO (Tunggakan dari ${formatBossMonthFullLabel(
                    dueISOForPrincipal.slice(0, 7)
                  )})`
                : ' · POKOK JATUH TEMPO'
              : ' · Projection';

          const subtitle = `Otomatis Pokok Investment · ${investorSubtitleNote} · ${methodLabel} · JT ${formatDDMMMYYYY(
            dueISOForPrincipal
          )}${statusDetailText}`;

          const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
          const amount = ov?.hasCustomAmount ? ov.amount : baseAmount;
          const instMKPrincipal =
            (isDuePrincipalCarry ? maturityRow?.monthKey : principalSource?.monthKey) ||
            effectiveEndMonthKey ||
            monthKey;
          const sourceRealisasiPrincipal =
            asset.monthRealisasi?.[`${monthKey}__principal`] ??
            asset.monthRealisasi?.[`${instMKPrincipal}__principal`];
          const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
            amount,
            color,
            isMovedOut,
            ov?.hasCustomRealisasi
              ? (ov.realisasiAmount ?? ov.actual_amount)
              : sourceRealisasiPrincipal
          );

          emittedInvestmentSourceIds.add(sourceId);
          autoInvestmentRows.push({
            rowKey: sourceId,
            sourceId,
            isAuto: true,
            section: 'investment',
            sourceCategory: 'investment',
            originMonthKey: monthKey,
            sourceMonthKey: monthKey,
            rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
            rescheduledOutLabel,
            dueBadgeLabel,
            dueBadgeTone,
            dueISO: dueISOForPrincipal,
            subtitle,
            name,
            amount,
            projectedAmount,
            realisasiAmount,
            color,
            investmentAssetId: asset.id,
            investmentComponent: 'principal',
            investmentInstallmentNumber: instNumber,
            investmentInstallmentMonthKey: isDuePrincipalCarry
              ? monthKey
              : principalSource?.monthKey || effectiveEndMonthKey || monthKey,
            hasCustomOverride: Boolean(
              ov &&
                (ov.hasCustomName ||
                  ov.hasCustomAmount ||
                  ov.hasCustomColor ||
                  ov.hasCustomRealisasi)
            ),
          });
        }
      }
    }

    // ROW 2: BUNGA atau DENDA — [No. Kontrak] ([n]/[Tenor]) - [Nama Investor]
    // Hanya dihitung untuk periode >= Cutoff (isPeriodOnOrAfterCutoff). Periode < Cutoff dianggap tutup buku / lunas.
    // Aturan Penyebutan Denda vs Bunga (mengikuti Jatuh Tempo Awal Kontrak / Angsuran terhadap Periode item):
    // - Jika Tanggal Jatuh Tempo >= Periode item -> sebut BUNGA
    // - Jika Tanggal Jatuh Tempo < Periode item DAN belum Lunas -> sebut DENDA + keterangan telat
    // - Tidak pernah menampilkan Bunga dan Denda secara bersamaan untuk 1 kontrak di 1 periode yang sama.
    if (isPeriodOnOrAfterCutoff) {
      const feeOverride = overrideMap.get(`inv_fee_${asset.id}`);
      const hasPaidFeeOverride = Boolean(
        feeOverride?.hasCustomColor &&
          feeOverride.color === 'green' &&
          feeOverride.amount > 0
      );

      if (!settledInEarlierMonth && hasPaidFeeOverride) {
        const sourceId = `inv_fee_${asset.id}`;
        const ov = feeOverride!;
        const { color, rescheduledToMonth } = resolveOverrideColor(ov, 'green');
        const effectiveLateFeeAmt = ov.amount;
        const effectiveDueISO =
          interestInstallment &&
          !interestInstallment.isMaturityRow &&
          !interestInstallment.isBonusOnlyRow
            ? interestInstallment.dueISO
            : effectiveEndDateISO;
        const rawInstNum =
          interestInstallment &&
          !interestInstallment.isMaturityRow &&
          !interestInstallment.isBonusOnlyRow
            ? interestInstallment.installmentNumber
            : asset.tenorMonths;
        const instNum = rawInstNum > 0 ? rawInstNum : asset.tenorMonths;
        const feeInstSuffix =
          asset.tenorMonths > 1 || rawInstNum > 0
            ? `(${instNum}/${asset.tenorMonths})`
            : '';
        const feeDueMK =
          effectiveEndMonthKey && effectiveEndMonthKey < monthKey
            ? effectiveEndMonthKey
            : effectiveDueISO.slice(0, 7) || monthKey;
        const dendaLabelInfo = formatInvestmentInterestOrDendaName({
          asset,
          instSuffix: feeInstSuffix,
          dueMonthKey: feeDueMK,
          projectionMonthKey: monthKey,
          dueISO: effectiveDueISO,
          todayISO,
        });
        const defaultName = dendaLabelInfo.isDenda
          ? dendaLabelInfo.name
          : formatInvestmentProjectionName('Denda', asset, feeInstSuffix);
        const isMovedOut = Boolean(
          color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
        );
        const rescheduledOutLabel =
          isMovedOut && rescheduledToMonth
            ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
            : undefined;
        const subtitle = `Realisasi Denda Investment · ${investorSubtitleNote} · Periode ${formatBossMonthFullLabel(
          monthKey
        )}${rescheduledOutLabel ? ` · ${rescheduledOutLabel}` : ''}`;

        const name = ov.hasCustomName && ov.name ? ov.name : defaultName;
        const amount = ov.hasCustomAmount ? ov.amount : effectiveLateFeeAmt;
        const instMKFee =
          interestInstallment?.monthKey || effectiveEndMonthKey || monthKey;
        const sourceRealisasiFee =
          asset.monthRealisasi?.[`${monthKey}__lateFee`] ??
          asset.monthRealisasi?.[`${monthKey}__interest`] ??
          asset.monthRealisasi?.[`${instMKFee}__lateFee`] ??
          asset.monthRealisasi?.[`${instMKFee}__interest`];
        const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
          amount,
          color,
          isMovedOut,
          ov.hasCustomRealisasi
            ? (ov.realisasiAmount ?? ov.actual_amount)
            : sourceRealisasiFee
        );

        emittedInvestmentSourceIds.add(sourceId);
        emittedInterestOrFeeAssetIds.add(asset.id);
        autoInvestmentRows.push({
          rowKey: sourceId,
          sourceId,
          isAuto: true,
          section: 'investment',
          sourceCategory: 'investment',
          originMonthKey: monthKey,
          sourceMonthKey: monthKey,
          rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
          rescheduledOutLabel,
          dueISO: effectiveDueISO,
          subtitle,
          name,
          amount,
          projectedAmount,
          realisasiAmount,
          color,
          investmentAssetId: asset.id,
          investmentComponent: 'lateFee',
          investmentInstallmentNumber: instNum,
          investmentInstallmentMonthKey: instMKFee,
          hasCustomOverride: Boolean(
            ov.hasCustomName ||
              ov.hasCustomAmount ||
              ov.hasCustomColor ||
              ov.hasCustomRealisasi
          ),
        });
      } else if (
        !settledInEarlierMonth &&
        ((interestInstallment &&
          !interestInstallment.isBonusOnlyRow &&
          !interestInstallment.isMaturityRow &&
          (interestInstallment.interestPaid > 0 ||
            asset.monthlyInterestAmount > 0 ||
            asset.monthlyInterestRate > 0 ||
            (asset.lateFeePerMonthAmount ?? 0) > 0 ||
            (asset.lateFeePerMonthRate ?? 0) > 0)) ||
          (hasOngoingInterestDue &&
            (!interestInstallment ||
              interestInstallment.isMaturityRow ||
              interestInstallment.isBonusOnlyRow)))
      ) {
        const sourceId = `inv_int_${asset.id}`;
        const ov = overrideMap.get(sourceId);
        const useRegularInstallment = Boolean(
          interestInstallment &&
            !interestInstallment.isMaturityRow &&
            !interestInstallment.isBonusOnlyRow
        );
        const phasePrincipalBasis =
          asset.originalContract?.principalAmount ?? asset.principalAmount;
        const remPrincipalForCalc = useRegularInstallment
          ? interestInstallment!.remainingPrincipalBefore
          : sisaPokok > 0
          ? sisaPokok
          : effectivePrincipalForMonth;
        const regularFromSchedule = useRegularInstallment
          ? (interestInstallment!.regularInterest ??
            (interestInstallment!.interestPaid > 0 ? interestInstallment!.interestPaid : 0))
          : 0;
        const computedInterestBasis =
          regularFromSchedule > 0
            ? regularFromSchedule
            : computeMonthlyInterestForBalance({
                remainingPrincipal: remPrincipalForCalc,
                interestInputType: asset.interestInputType,
                monthlyInterestAmount: asset.monthlyInterestAmount,
                monthlyInterestRate: asset.monthlyInterestRate,
                paymentMethod: asset.paymentMethod,
                initialPrincipalBasis: phasePrincipalBasis,
              });
        const fallbackLateFeeBasis = computeMonthlyLateFeeForBalance({
          remainingPrincipal: remPrincipalForCalc,
          lateFeeInputType: asset.lateFeeInputType,
          lateFeePerMonthAmount: asset.lateFeePerMonthAmount,
          lateFeePerMonthRate: asset.lateFeePerMonthRate,
        });

        const fallbackDueDay =
          asset.dueDay ??
          (Number(effectiveEndDateISO.slice(8, 10)) ||
            Number(getEffectiveAssetStartDate(asset).slice(8, 10)) ||
            1);

        const instDueMK = useRegularInstallment
          ? (interestInstallment!.dueISO || interestInstallment!.monthKey).slice(0, 7)
          : effectiveEndMonthKey && effectiveEndMonthKey < monthKey
          ? effectiveEndMonthKey
          : monthKey;
        const referenceDueMonthKey =
          effectiveEndMonthKey && effectiveEndMonthKey < instDueMK
            ? effectiveEndMonthKey
            : instDueMK;

        const rawInstNum = useRegularInstallment
          ? interestInstallment!.installmentNumber
          : asset.tenorMonths;
        const instNum = rawInstNum > 0 ? rawInstNum : asset.tenorMonths;
        const intInstSuffix =
          asset.tenorMonths > 1 || (useRegularInstallment && rawInstNum > 0)
            ? `(${instNum}/${asset.tenorMonths})`
            : '';

        const approxIntDueISO = useRegularInstallment
          ? interestInstallment!.dueISO
          : effectiveEndMonthKey && effectiveEndMonthKey < monthKey
          ? effectiveEndDateISO
          : getInstallmentDueISODate(monthKey, fallbackDueDay);

        const labelInfo = formatInvestmentInterestOrDendaName({
          asset,
          instSuffix: intInstSuffix,
          dueMonthKey: referenceDueMonthKey,
          projectionMonthKey: monthKey,
          dueISO: approxIntDueISO,
          todayISO,
        });

        const intComponentKind: 'lateFee' | 'interest' = labelInfo.isDenda
          ? 'lateFee'
          : 'interest';
        const intCompState = getAssetComponentMonthState(asset, monthKey, intComponentKind);
        const isIntPaid = Boolean(
          asset.status === 'Lunas' ||
            intCompState.isPaid ||
            (useRegularInstallment ? interestInstallment!.isInterestPaid : false)
        );
        const sourceDefault: BossReportColorStatus = isIntPaid
          ? 'green'
          : intCompState.isPending
          ? 'red'
          : 'white';
        const { color, rescheduledToMonth } = resolveOverrideColor(
          ov,
          sourceDefault,
          intCompState.isPending ? intCompState.rescheduledToMonth : undefined
        );

        const interestBasis =
          computedInterestBasis > 0
            ? computedInterestBasis
            : labelInfo.isDenda
            ? fallbackLateFeeBasis
            : 0;

        if (interestBasis > 0 || (ov?.hasCustomAmount && ov.amount > 0)) {
          const dueISOInt = labelInfo.isDenda
            ? useRegularInstallment
              ? interestInstallment!.dueISO
              : effectiveEndDateISO
            : useRegularInstallment
            ? interestInstallment!.dueISO
            : getInstallmentDueISODate(monthKey, fallbackDueDay);
          const isDueTodayOrBefore = !isIntPaid && dueISOInt <= todayISO;
          const isPastDueDate = !isIntPaid && dueISOInt < todayISO;
          const defaultName = labelInfo.name;
          const rateBadge =
            asset.interestInputType === 'PERCENT'
              ? `${asset.monthlyInterestRate || 0}%/bln`
              : `Rp ${formatSimpleIDR(asset.monthlyInterestAmount)}/bln`;
          const isMovedOut = Boolean(
            color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
          );
          const rescheduledOutLabel =
            isMovedOut && rescheduledToMonth
              ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
              : undefined;
          const dueBadgeLabel =
            color === 'white' && labelInfo.isDenda
              ? `TELAT ${labelInfo.monthsLate} BULAN`
              : color === 'white' && isPastDueDate
              ? 'JATUH TEMPO'
              : undefined;
          const subtitle = `${
            labelInfo.isDenda ? 'Otomatis Denda Investment' : 'Otomatis Bunga Investment'
          } · ${investorSubtitleNote} (${rateBadge})${
            labelInfo.isDenda
              ? ` · Jatuh tempo ${formatBossMonthShortLabel(labelInfo.dueMonthKey)}, telat ${labelInfo.monthsLate} bulan`
              : ''
          } · Periode ${formatBossMonthFullLabel(monthKey)} · JT ${formatDDMMMYYYY(dueISOInt)}${
            color === 'green'
              ? ' · Paid'
              : rescheduledOutLabel
              ? ` · ${rescheduledOutLabel}`
              : labelInfo.isDenda || isDueTodayOrBefore
              ? ' · JATUH TEMPO'
              : ' · Projection'
          }`;

          const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
          const amount = ov?.hasCustomAmount ? ov.amount : interestBasis;
          const instMKInterest = useRegularInstallment
            ? interestInstallment!.monthKey
            : monthKey;
          const sourceRealisasiInterest = labelInfo.isDenda
            ? asset.monthRealisasi?.[`${monthKey}__lateFee`] ??
              asset.monthRealisasi?.[`${monthKey}__interest`] ??
              asset.monthRealisasi?.[`${instMKInterest}__lateFee`] ??
              asset.monthRealisasi?.[`${instMKInterest}__interest`]
            : asset.monthRealisasi?.[`${monthKey}__interest`] ??
              asset.monthRealisasi?.[`${monthKey}__lateFee`] ??
              asset.monthRealisasi?.[`${instMKInterest}__interest`] ??
              asset.monthRealisasi?.[`${instMKInterest}__lateFee`];
          const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
            amount,
            color,
            isMovedOut,
            ov?.hasCustomRealisasi
              ? (ov.realisasiAmount ?? ov.actual_amount)
              : sourceRealisasiInterest
          );

          emittedInvestmentSourceIds.add(sourceId);
          emittedInterestOrFeeAssetIds.add(asset.id);
          autoInvestmentRows.push({
            rowKey: sourceId,
            sourceId,
            isAuto: true,
            section: 'investment',
            sourceCategory: 'investment',
            originMonthKey: monthKey,
            sourceMonthKey: monthKey,
            rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
            rescheduledOutLabel,
            dueBadgeLabel,
            dueBadgeTone: dueBadgeLabel ? 'red' : undefined,
            dueISO: dueISOInt,
            subtitle,
            name,
            amount,
            projectedAmount,
            realisasiAmount,
            color,
            investmentAssetId: asset.id,
            investmentComponent: labelInfo.isDenda ? 'lateFee' : 'interest',
            investmentInstallmentNumber: instNum,
            investmentInstallmentMonthKey: useRegularInstallment
              ? interestInstallment!.monthKey
              : monthKey,
            hasCustomOverride: Boolean(
              ov &&
                (ov.hasCustomName ||
                  ov.hasCustomAmount ||
                  ov.hasCustomColor ||
                  ov.hasCustomRealisasi)
            ),
          });
        }
      }
    }

    // ROW 3: BONUS — [No. Kontrak] (Hanya muncul di bulan Tanggal Bonus Dicairkan)
    if (
      installment &&
      installment.bonusPaid > 0 &&
      !rescheduledInBonusAssetIds.has(asset.id)
    ) {
      const sourceId = `inv_bonus_${asset.id}`;
      const ov = overrideMap.get(sourceId);
      const isBonusPaidSource = Boolean(
        asset.status === 'Lunas' || installment.isBonusPaid || bonusCompState.isPaid
      );
      const sourceDefault: BossReportColorStatus = isBonusPaidSource
        ? 'green'
        : bonusCompState.isPending
        ? 'red'
        : 'white';
      const { color, rescheduledToMonth } = resolveOverrideColor(
        ov,
        sourceDefault,
        bonusCompState.isPending ? bonusCompState.rescheduledToMonth : undefined
      );
      const bonusDateISO = getEffectiveAssetBonusDate(asset);
      const rateLabel =
        asset.bonusInputType === 'PERCENT' ? `(${asset.bonusRate || 0}%)` : '';
      const defaultName = formatInvestmentProjectionName('Bonus', asset, rateLabel);
      const isMovedOut = Boolean(
        color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
      );
      const rescheduledOutLabel =
        isMovedOut && rescheduledToMonth
          ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
          : undefined;
      const subtitle = `Otomatis Bonus Investment · ${investorSubtitleNote} · Cair ${formatDDMMMYYYY(
        bonusDateISO
      )}${color === 'green' ? ' · Paid' : ''}${
        rescheduledOutLabel ? ` · ${rescheduledOutLabel}` : ''
      }`;

      const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
      const amount = ov?.hasCustomAmount ? ov.amount : installment.bonusPaid;
      const sourceRealisasiBonus =
        asset.monthRealisasi?.[`${monthKey}__bonus`] ??
        asset.monthRealisasi?.[`${installment.monthKey}__bonus`];
      const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
        amount,
        color,
        isMovedOut,
        ov?.hasCustomRealisasi
          ? (ov.realisasiAmount ?? ov.actual_amount)
          : sourceRealisasiBonus
      );

      emittedInvestmentSourceIds.add(sourceId);
      autoInvestmentRows.push({
        rowKey: sourceId,
        sourceId,
        isAuto: true,
        section: 'investment',
        sourceCategory: 'investment',
        originMonthKey: monthKey,
        sourceMonthKey: monthKey,
        rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
        rescheduledOutLabel,
        dueISO: bonusDateISO,
        subtitle,
        name,
        amount,
        projectedAmount,
        realisasiAmount,
        color,
        investmentAssetId: asset.id,
        investmentComponent: 'bonus',
        investmentInstallmentNumber: installment.installmentNumber,
        investmentInstallmentMonthKey: installment.monthKey,
        hasCustomOverride: Boolean(
          ov &&
            (ov.hasCustomName ||
              ov.hasCustomAmount ||
              ov.hasCustomColor ||
              ov.hasCustomRealisasi)
        ),
      });
    }
  }

  const manualInvestmentRows = [
    ...mapManualItems(monthData.investment, 'inv', 'investment', monthKey),
    ...mapProjectionManualItemsToRows(
      options?.projectionManualItems,
      'INVESTMENT',
      monthKey
    ),
  ];

  // 4. Cash Out Group C: Project Cost (Auto from Vendor PO due in selectedMonthKey + Manual)
  const autoPORows: BossReportComputedRow[] = orders
    .filter((po) => !po.isDeleted)
    .map((po) => ({ po, dueDate: getEffectiveDueDate(po) }))
    .filter(({ po, dueDate }) => {
      const ov = overrideMap.get(`po_${po.id}`);
      const inThisMonth = Boolean(dueDate) && dueDate.slice(0, 7) === monthKey;
      const hasPendingOriginHere = Boolean(
        ov?.hasCustomColor && ov.color === 'red' && po.rescheduledFromMonth === monthKey
      );
      return inThisMonth || hasPendingOriginHere;
    })
    .sort((a, b) => {
      const d = a.dueDate.localeCompare(b.dueDate);
      if (d !== 0) return d;
      return a.po.poNumber.localeCompare(b.po.poNumber);
    })
    .map(({ po, dueDate }): BossReportComputedRow | null => {
      const sourceId = `po_${po.id}`;
      const ov = overrideMap.get(sourceId);
      const overdue = isEffectiveOverdue(po);
      const arrivedInThisMonth = Boolean(
        po.rescheduledFromMonth &&
          po.rescheduledFromMonth !== monthKey &&
          (!po.rescheduledToMonth || po.rescheduledToMonth === monthKey) &&
          !reschedSourceIdsInMonth.has(sourceId)
      );
      const sourceDefault: BossReportColorStatus =
        po.status === 'Paid' || po.statusWarna === 'HIJAU'
          ? 'green'
          : (po.status === 'Reschedule' || po.statusWarna === 'MERAH') &&
            !arrivedInThisMonth
          ? 'red'
          : 'white';
      const { color, rescheduledToMonth } = resolveOverrideColor(
        ov,
        sourceDefault,
        arrivedInThisMonth ? undefined : po.rescheduledToMonth
      );
      const isMovedOut = Boolean(
        color === 'red' && rescheduledToMonth && rescheduledToMonth !== monthKey
      );
      const rescheduledOutLabel =
        isMovedOut && rescheduledToMonth
          ? `DIPENDING KE ${formatBossMonthFullLabel(rescheduledToMonth)}`
          : undefined;
      const arrivedFromReschedule =
        arrivedInThisMonth && (!rescheduledToMonth || rescheduledToMonth === monthKey);
      const rescheduleLabel =
        arrivedFromReschedule && po.rescheduledFromMonth
          ? formatRescheduleHistoryLabel([po.rescheduledFromMonth, monthKey], {
              dueISO: dueDate,
              todayISO,
              isPaid: color === 'green',
            })
          : undefined;
      const defaultName = `${po.vendorName} — ${po.projectName}`;
      const subtitle = `Otomatis PO · ${po.poNumber}${
        po.invoiceNumber ? ` · Inv ${po.invoiceNumber}` : ''
      } · Jatuh tempo ${formatShortDateID(dueDate)}${
        color === 'green'
          ? ' (LUNAS)'
          : rescheduledOutLabel
          ? ` · ${rescheduledOutLabel}`
          : overdue
          ? ' (OVERDUE)'
          : ''
      }${rescheduleLabel ? ` · ${rescheduleLabel}` : ''}`;

      const name = ov?.hasCustomName && ov.name ? ov.name : defaultName;
      const amount = ov?.hasCustomAmount ? ov.amount : getVendorPOEffectiveCostAmount(po);
      const sourceRealisasiPO = po.realisasiAmount ?? po.actualAmount;
      const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
        amount,
        color,
        isMovedOut,
        ov?.hasCustomRealisasi
          ? (ov.realisasiAmount ?? ov.actual_amount)
          : sourceRealisasiPO
      );

      return {
        rowKey: sourceId,
        sourceId,
        isAuto: true,
        section: 'projectCost',
        sourceCategory: 'vendorPO',
        originMonthKey: po.rescheduledFromMonth || monthKey,
        sourceMonthKey: monthKey,
        rescheduledToMonth: isMovedOut ? rescheduledToMonth : undefined,
        rescheduledOutLabel,
        ...(arrivedFromReschedule && po.rescheduledFromMonth
          ? {
              fromMonthKey: po.rescheduledFromMonth,
              rescheduledFromMonth: po.rescheduledFromMonth,
              historyMonths: [po.rescheduledFromMonth, monthKey],
              rescheduleLabel,
            }
          : {}),
        dueISO: dueDate || undefined,
        subtitle,
        name,
        amount,
        projectedAmount,
        realisasiAmount,
        color,
        poId: po.id,
        hasCustomOverride: Boolean(
          ov &&
            (ov.hasCustomName ||
              ov.hasCustomAmount ||
              ov.hasCustomColor ||
              ov.hasCustomRealisasi)
        ),
      };
    })
    .filter((r): r is BossReportComputedRow => r !== null);

  const manualProjectRows = [
    ...mapManualItems(monthData.projectCostManual, 'pcm', 'projectCost', monthKey),
    ...mapProjectionManualItemsToRows(
      options?.projectionManualItems,
      'PROJECT_COST',
      monthKey
    ),
  ];

  // Track emitted sourceIds in this month so moved native rows never duplicate rescheduledIn
  const emittedSourceIdsInMonth = new Set<string>();
  for (const r of autoClientRows) if (r.sourceId) emittedSourceIdsInMonth.add(r.sourceId);
  for (const r of autoInvestmentDisbursementRows)
    if (r.sourceId) emittedSourceIdsInMonth.add(r.sourceId);
  for (const r of autoOpexRows) if (r.sourceId) emittedSourceIdsInMonth.add(r.sourceId);
  for (const r of autoPORows) if (r.sourceId) emittedSourceIdsInMonth.add(r.sourceId);
  for (const r of autoInvestmentRows) if (r.sourceId) emittedSourceIdsInMonth.add(r.sourceId);

  // 5. Merge Rescheduled-In Items from previous months into each section
  const reschedCashInRows: BossReportComputedRow[] = [];
  const reschedOperasionalRows: BossReportComputedRow[] = [];
  const reschedInvestmentRows: BossReportComputedRow[] = [];
  const reschedProjectRows: BossReportComputedRow[] = [];

  const seenReschedKeys = new Set<string>();
  for (const rs of monthData.rescheduledIn ?? []) {
    const dedupKey = `${rs.sourceId}::${rs.originMonthKey}::${rs.fromMonthKey || ''}`;
    if (seenReschedKeys.has(dedupKey)) {
      continue;
    }
    seenReschedKeys.add(dedupKey);

    const rsOpex =
      rs.sourceCategory === 'opex'
        ? opexById.get(rs.sourceId.replace(/^opex_/, ''))
        : undefined;
    const rsInvAsset =
      rs.section === 'investment' &&
      rs.sourceCategory === 'investment' &&
      rs.investmentAssetId
        ? investmentsById.get(rs.investmentAssetId)
        : undefined;
    const isRecurringOrPeriodicRollover = Boolean(
      (rs.sourceCategory === 'opex' && rsOpex?.isRecurring) ||
        (rs.section === 'investment' &&
          rs.sourceCategory === 'investment' &&
          (rs.investmentComponent === 'interest' ||
            rs.investmentComponent === 'lateFee' ||
            rsInvAsset?.paymentMethod === 'ANUITAS'))
    );
    if (
      rs.sourceCategory !== 'manual' &&
      rs.sourceId &&
      emittedSourceIdsInMonth.has(rs.sourceId) &&
      (!isRecurringOrPeriodicRollover || rs.originMonthKey === monthKey)
    ) {
      continue;
    }
    if (rs.section === 'cashIn' && rs.sourceId.startsWith('inv_disb_')) {
      const disbAssetId = rs.sourceId.replace(/^inv_disb_/, '');
      const disbAsset = investmentsById.get(disbAssetId);
      if (!disbAsset || disbAsset.status === 'Ditunda') continue;
    }

    const isReschedOutAgain =
      rs.color === 'red' &&
      Boolean(rs.rescheduledToMonth) &&
      rs.rescheduledToMonth !== monthKey;
    let effectiveColor: BossReportColorStatus =
      rs.color === 'green' ? 'green' : rs.color === 'red' ? 'red' : 'white';
    let resolvedName = rs.name;
    let resolvedAmount =
      rs.section === 'cashIn'
        ? resolveManualCashInNominal(rs as unknown as BossReportManualItem)
        : Number.isFinite(rs.amount)
        ? rs.amount
        : 0;
    let resolvedComponent = rs.investmentComponent;
    let reschedSourceRealisasi: number | undefined;

    let dueBadgeLabel: string | undefined;
    let dueBadgeTone: 'red' | 'amber' | undefined;

    // Live sync with source status when NOT rescheduled out further
    if (!isReschedOutAgain) {
      if (rs.sourceCategory === 'clientInvoice') {
        const inv = clientInvoicesById.get(rs.sourceId.replace(/^ci_/, ''));
        if (inv) {
          reschedSourceRealisasi = inv.realisasiAmount ?? inv.actualAmount;
          if (!rs.hasCustomOverride) {
            resolvedAmount = resolveClientInvoiceCashInNominal(inv);
          }
          if (inv.status === 'Paid') effectiveColor = 'green';
        }
      } else if (
        rs.section === 'cashIn' &&
        (rs.sourceId.startsWith('inv_disb_') || rs.sourceCategory === 'investment')
      ) {
        const disbAsset = investmentsById.get(
          rs.investmentAssetId ?? rs.sourceId.replace(/^inv_disb_/, '')
        );
        if (disbAsset) {
          reschedSourceRealisasi = disbAsset.disbursementRealisasiAmount;
          if (!rs.hasCustomOverride && resolvedAmount <= 0) {
            resolvedAmount = resolveInvestmentDisbursementNominal(disbAsset);
          }
          if (disbAsset.disbursementStatus === 'green') {
            effectiveColor = 'green';
          }
        }
      } else if (rs.sourceCategory === 'opex') {
        const opx = rsOpex;
        if (opx) {
          reschedSourceRealisasi = opx.isRecurring
            ? undefined
            : opx.monthRealisasi?.[monthKey] ?? opx.realisasiAmount ?? opx.actualAmount;
          if (!opx.isRecurring) {
            const st = String(opx.status);
            if (st === 'Sudah Bayar' || st === 'Paid' || st === 'Lunas') {
              effectiveColor = 'green';
            }
          }
        }
      } else if (rs.sourceCategory === 'vendorPO') {
        const po = poById.get(rs.sourceId.replace(/^po_/, ''));
        if (po) {
          if (!rs.hasCustomOverride) {
            resolvedAmount = getVendorPOEffectiveCostAmount(po);
          }
          reschedSourceRealisasi = po.realisasiAmount ?? po.actualAmount;
        }
        if (po?.status === 'Paid') effectiveColor = 'green';
      } else if (rs.section === 'investment' && rs.sourceCategory === 'investment' && rs.investmentAssetId) {
        if (
          rs.originMonthKey === monthKey &&
          (rs.investmentComponent === 'interest' || rs.investmentComponent === 'lateFee') &&
          emittedInterestOrFeeAssetIds.has(rs.investmentAssetId)
        ) {
          continue;
        }
        const asset = investmentsById.get(rs.investmentAssetId);
        if (
          !isPeriodOnOrAfterCutoff &&
          asset?.paymentMethod !== 'ANUITAS' &&
          (rs.investmentComponent === 'interest' || rs.investmentComponent === 'lateFee')
        ) {
          continue;
        }
        const instMonth = rs.investmentInstallmentMonthKey || rs.originMonthKey;
        if (asset) {
          const compKind = resolvedComponent ?? 'principal';
          reschedSourceRealisasi =
            compKind === 'interest' || compKind === 'lateFee'
              ? asset.monthRealisasi?.[`${monthKey}__${compKind}`] ??
                asset.monthRealisasi?.[`${monthKey}__lateFee`] ??
                asset.monthRealisasi?.[`${monthKey}__interest`] ??
                asset.monthRealisasi?.[`${instMonth}__${compKind}`]
              : asset.monthRealisasi?.[`${monthKey}__${compKind}`] ??
                asset.monthRealisasi?.[`${instMonth}__${compKind}`];
          if (
            !rs.hasCustomOverride &&
            rs.investmentComponent === 'principal' &&
            asset.paymentMethod === 'BALLOON'
          ) {
            const effEndMK = getEffectiveAssetEndDate(asset).slice(0, 7);
            const totals = computeInvestmentPortfolioTotals(asset, { todayISO });
            if (
              (resolvedAmount === 0 && effEndMK && monthKey < effEndMK) ||
              (totals.remainingPrincipal === 0 && rs.color !== 'green')
            ) {
              continue;
            }
          }
          if (asset.status === 'Lunas') {
            effectiveColor = 'green';
          }
          if (
            asset.paymentMethod === 'ANUITAS' &&
            !rs.hasCustomOverride &&
            (rs.investmentComponent === 'principal' ||
              rs.investmentComponent === 'interest' ||
              rs.investmentComponent === 'lateFee')
          ) {
            const schedule = buildInvestmentSchedule(asset, {
              todayISO,
              cutoffDateOverride: cutoffGlobalDateISO,
            });
            const origScheduleRow = schedule.find((r) => r.monthKey === instMonth);
            const rawInstNum =
              (rs.investmentInstallmentNumber ?? 0) > 0
                ? rs.investmentInstallmentNumber!
                : origScheduleRow?.installmentNumber && origScheduleRow.installmentNumber > 0
                ? origScheduleRow.installmentNumber
                : asset.tenorMonths;
            const instSuffix =
              asset.tenorMonths > 1 || rawInstNum > 0
                ? `(${rawInstNum}/${asset.tenorMonths})`
                : '';
            const schedDueMK = origScheduleRow?.dueISO?.slice(0, 7) || instMonth;
            const labelInfo = formatInvestmentInterestOrDendaName({
              asset,
              instSuffix,
              dueMonthKey: schedDueMK,
              projectionMonthKey: monthKey,
              dueISO: origScheduleRow?.dueISO || rs.dueISO,
              todayISO,
              normalJenis: 'Angsuran',
            });
            const schedTotal = origScheduleRow
              ? Math.round(
                  (origScheduleRow.principalPaid || 0) +
                    (origScheduleRow.regularInterest ?? origScheduleRow.interestPaid ?? 0)
                )
              : 0;
            const resolvedAngsuran =
              asset.interestInputType === 'RP' &&
              !origScheduleRow?.addendumSequence &&
              (asset.monthlyInstallment || 0) > 0
                ? Math.round(asset.monthlyInstallment)
                : schedTotal > 0
                ? schedTotal
                : Math.round(asset.monthlyInstallment || 0);
            resolvedComponent = 'principal';
            resolvedName = labelInfo.name;
            if (resolvedAngsuran > 0) {
              resolvedAmount = resolvedAngsuran;
            }
            if (labelInfo.isDenda && effectiveColor === 'white') {
              dueBadgeLabel = `TELAT ${labelInfo.monthsLate} BULAN`;
              dueBadgeTone = 'red';
            }
            emittedInterestOrFeeAssetIds.add(rs.investmentAssetId);
          } else {
            if (
              !rs.hasCustomOverride &&
              rs.investmentComponent === 'principal'
            ) {
              const instNumber =
                (rs.investmentInstallmentNumber ?? 0) > 0
                  ? rs.investmentInstallmentNumber!
                  : asset.tenorMonths;
              const instSuffix =
                asset.tenorMonths > 1 || (rs.investmentInstallmentNumber ?? 0) > 0
                  ? `(${instNumber}/${asset.tenorMonths})`
                  : '';
              resolvedName = formatInvestmentProjectionName('Pokok', asset, instSuffix);

              if (asset.paymentMethod === 'BALLOON') {
                const totals = computeInvestmentPortfolioTotals(asset, { todayISO });
                if (totals.remainingPrincipal > 0) {
                  resolvedAmount = totals.remainingPrincipal;
                }
                const effEndISO = getEffectiveAssetEndDate(asset);
                if (effectiveColor === 'white' && effEndISO < todayISO) {
                  const mLate = diffCalendarMonthsOverdue(effEndISO, todayISO);
                  dueBadgeLabel = `JATUH TEMPO - TERLAMBAT ${mLate} BULAN`;
                  dueBadgeTone = 'red';
                }
              } else {
                const schedule = buildInvestmentSchedule(asset, {
                  todayISO,
                  cutoffDateOverride: cutoffGlobalDateISO,
                });
                const origScheduleRow = schedule.find((r) => r.monthKey === instMonth);
                if (origScheduleRow && origScheduleRow.principalPaid > 0) {
                  resolvedAmount = origScheduleRow.principalPaid;
                }
              }
            }
            if (
              !rs.hasCustomOverride &&
              (rs.investmentComponent === 'interest' || rs.investmentComponent === 'lateFee')
            ) {
              const schedule = buildInvestmentSchedule(asset, {
                todayISO,
                cutoffDateOverride: cutoffGlobalDateISO,
              });
              const origScheduleRow = schedule.find((r) => r.monthKey === instMonth);
              const remPrincipal = origScheduleRow?.remainingPrincipalBefore ?? asset.principalAmount;
              const regInterest =
                origScheduleRow?.regularInterest && origScheduleRow.regularInterest > 0
                  ? origScheduleRow.regularInterest
                  : computeMonthlyInterestForBalance({
                      remainingPrincipal: remPrincipal,
                      interestInputType: asset.interestInputType,
                      monthlyInterestAmount: asset.monthlyInterestAmount,
                      monthlyInterestRate: asset.monthlyInterestRate,
                      paymentMethod: asset.paymentMethod,
                      initialPrincipalBasis:
                        asset.originalContract?.principalAmount ?? asset.principalAmount,
                    });
              const rawInstNum =
                (rs.investmentInstallmentNumber ?? 0) > 0
                  ? rs.investmentInstallmentNumber!
                  : origScheduleRow?.installmentNumber && origScheduleRow.installmentNumber > 0
                  ? origScheduleRow.installmentNumber
                  : asset.tenorMonths;
              const instSuffix =
                asset.tenorMonths > 1 || rawInstNum > 0
                  ? `(${rawInstNum}/${asset.tenorMonths})`
                  : '';
              const effEndMK = getEffectiveAssetEndDate(asset).slice(0, 7);
              const schedDueMK = origScheduleRow?.dueISO?.slice(0, 7) || instMonth;
              const origDueMK =
                asset.paymentMethod === 'BALLOON' && effEndMK && effEndMK < schedDueMK
                  ? effEndMK
                  : schedDueMK;
              const labelInfo = formatInvestmentInterestOrDendaName({
                asset,
                instSuffix,
                dueMonthKey: origDueMK,
                projectionMonthKey: monthKey,
                dueISO: origScheduleRow?.dueISO || rs.dueISO,
                todayISO,
              });
              resolvedComponent = labelInfo.isDenda ? 'lateFee' : 'interest';
              resolvedName = labelInfo.name;
              if (labelInfo.isDenda && effectiveColor === 'white') {
                dueBadgeLabel = `TELAT ${labelInfo.monthsLate} BULAN`;
                dueBadgeTone = 'red';
              }
              if (regInterest > 0) {
                resolvedAmount = regInterest;
              }
            }
            if (
              resolvedComponent === 'interest' ||
              resolvedComponent === 'lateFee'
            ) {
              emittedInterestOrFeeAssetIds.add(rs.investmentAssetId);
            }
          }
          if (!rs.hasCustomOverride && rs.investmentComponent === 'bonus') {
            const rateLabel =
              asset.bonusInputType === 'PERCENT' ? `(${asset.bonusRate || 0}%)` : '';
            resolvedName = formatInvestmentProjectionName('Bonus', asset, rateLabel);
          }
        }
      }
    }

    const effectiveRsDueISO = (() => {
      if (rs.sourceCategory === 'vendorPO') {
        const po = poById.get(rs.sourceId.replace(/^po_/, ''));
        if (po) {
          const eff = getEffectiveDueDate(po);
          if (eff) return eff;
        }
      } else if (rs.sourceCategory === 'clientInvoice') {
        const inv = clientInvoicesById.get(rs.sourceId.replace(/^ci_/, ''));
        if (inv) {
          const eff = inv.dueDate || inv.invoiceDate;
          if (eff) return eff;
        }
      }
      return rs.dueISO;
    })();

    const rescheduleLabel = formatRescheduleHistoryLabel(rs.historyMonths, {
      dueISO: effectiveRsDueISO,
      todayISO,
      isPaid: effectiveColor === 'green',
    });
    const rescheduledOutLabel =
      isReschedOutAgain && rs.rescheduledToMonth
        ? `DIPENDING KE ${formatBossMonthFullLabel(rs.rescheduledToMonth)}`
        : undefined;
    const duePart = effectiveRsDueISO ? ` · JT ${formatDDMMMYYYY(effectiveRsDueISO)}` : '';
    const statusPart =
      effectiveColor === 'green'
        ? ' · Paid'
        : rescheduledOutLabel
        ? ` · ${rescheduledOutLabel}`
        : effectiveColor === 'red'
        ? ' · Pending'
        : !rescheduleLabel && effectiveRsDueISO && todayISO < effectiveRsDueISO
        ? ' · Projection'
        : '';
    const subtitle = `${rescheduleLabel}${duePart}${statusPart}`.replace(/^ · /, '');
    const { projectedAmount, realisasiAmount } = computeProjectedAndRealisasi(
      resolvedAmount,
      effectiveColor,
      isReschedOutAgain,
      rs.hasCustomRealisasi
        ? (rs.realisasiAmount ?? rs.actual_amount)
        : reschedSourceRealisasi
    );

    const computed: BossReportComputedRow = {
      rowKey: `rs_${monthKey}_${rs.id}`,
      sourceId: rs.sourceId,
      isAuto: rs.sourceCategory !== 'manual',
      isRescheduledIn: true,
      rescheduledItemId: rs.id,
      section: rs.section,
      sourceCategory: rs.sourceCategory,
      ...(rs.section === 'cashIn'
        ? {
            cashInSource:
              rs.sourceCategory === 'clientInvoice'
                ? ('invoice' as const)
                : rs.sourceId.startsWith('inv_disb_') || rs.sourceCategory === 'investment'
                ? ('investmentDisbursement' as const)
                : ('manual' as const),
          }
        : {}),
      originMonthKey: rs.originMonthKey,
      sourceMonthKey: monthKey,
      fromMonthKey: rs.fromMonthKey,
      rescheduledFromMonth: rs.rescheduledFromMonth ?? rs.fromMonthKey,
      rescheduledToMonth: isReschedOutAgain ? rs.rescheduledToMonth : undefined,
      rescheduledOutLabel,
      historyMonths: rs.historyMonths,
      rescheduleLabel,
      dueBadgeLabel,
      dueBadgeTone,
      dueISO: effectiveRsDueISO,
      subtitle,
      name: resolvedName,
      amount: resolvedAmount,
      projectedAmount,
      realisasiAmount,
      color: effectiveColor,
      accountId: rs.accountId,
      hasCustomOverride: Boolean(rs.hasCustomOverride || rs.hasCustomRealisasi),
      investmentAssetId:
        rs.investmentAssetId ??
        (rs.section === 'cashIn' && rs.sourceId.startsWith('inv_disb_')
          ? rs.sourceId.replace(/^inv_disb_/, '')
          : undefined),
      investmentComponent: resolvedComponent,
      investmentInstallmentNumber: rs.investmentInstallmentNumber,
      investmentInstallmentMonthKey: rs.investmentInstallmentMonthKey ?? rs.originMonthKey,
      clientInvoiceId:
        rs.sourceCategory === 'clientInvoice'
          ? rs.sourceId.replace(/^ci_/, '')
          : undefined,
      opexId: rs.sourceCategory === 'opex' ? rs.sourceId.replace(/^opex_/, '') : undefined,
      poId: rs.sourceCategory === 'vendorPO' ? rs.sourceId.replace(/^po_/, '') : undefined,
    };

    if (rs.section === 'cashIn') reschedCashInRows.push(computed);
    else if (rs.section === 'operasional') reschedOperasionalRows.push(computed);
    else if (rs.section === 'investment') reschedInvestmentRows.push(computed);
    else reschedProjectRows.push(computed);
  }

  const cashInRows = [
    ...autoClientRows,
    ...autoInvestmentDisbursementRows,
    ...manualCashInRows,
    ...reschedCashInRows,
  ];
  const totalCashIn = cashInRows.reduce((sum, r) => sum + r.projectedAmount, 0);
  const totalCashInRealisasi = cashInRows.reduce((sum, r) => sum + r.realisasiAmount, 0);
  const accountBalance = saldoAwal + totalCashIn;

  const operasionalRows = [...autoOpexRows, ...manualOpexRows, ...reschedOperasionalRows];
  const totalOperasionalCost = operasionalRows.reduce(
    (sum, r) => sum + r.projectedAmount,
    0
  );
  const totalOperasionalRealisasi = operasionalRows.reduce(
    (sum, r) => sum + r.realisasiAmount,
    0
  );

  const investmentRows = [
    ...autoInvestmentRows,
    ...manualInvestmentRows,
    ...reschedInvestmentRows,
  ];
  const hasVisiblePrincipalRows = investmentRows.some(
    (r) => r.investmentComponent === 'principal'
  );
  const totalInvestmentCost = investmentRows.reduce(
    (sum, r) => sum + r.projectedAmount,
    0
  );
  const totalInvestmentRealisasi = investmentRows.reduce(
    (sum, r) => sum + r.realisasiAmount,
    0
  );

  const projectCostRows = [...autoPORows, ...manualProjectRows, ...reschedProjectRows];
  const totalProjectCost = projectCostRows.reduce((sum, r) => sum + r.projectedAmount, 0);
  const totalProjectRealisasi = projectCostRows.reduce(
    (sum, r) => sum + r.realisasiAmount,
    0
  );

  const totalCost = totalOperasionalCost + totalInvestmentCost + totalProjectCost;
  const totalCostRealisasi =
    totalOperasionalRealisasi + totalInvestmentRealisasi + totalProjectRealisasi;
  const endingBalance = saldoAwal + totalCashIn - totalCost;
  const endingBalanceRealisasi = saldoAwal + totalCashInRealisasi - totalCostRealisasi;

  // 6. Ending Balance per Rekening (menggunakan Projected Amount — item HIJAU & MERAH sudah Rp 0 di Projection)
  const primaryAccount =
    effectiveAccounts.find((a) => a.isPrimary) ?? effectiveAccounts[0] ?? null;
  const primaryAccountId = primaryAccount ? primaryAccount.id : null;

  const cashInByAcc = new Map<string, number>();
  for (const row of cashInRows) {
    const targetAccId =
      row.accountId && validAccIds.has(row.accountId) ? row.accountId : primaryAccountId;
    if (targetAccId) {
      cashInByAcc.set(targetAccId, (cashInByAcc.get(targetAccId) ?? 0) + row.projectedAmount);
    }
  }

  const cashOutOpByAcc = new Map<string, number>();
  for (const row of operasionalRows) {
    const targetAccId =
      row.accountId && validAccIds.has(row.accountId) ? row.accountId : primaryAccountId;
    if (targetAccId) {
      cashOutOpByAcc.set(
        targetAccId,
        (cashOutOpByAcc.get(targetAccId) ?? 0) + row.projectedAmount
      );
    }
  }

  const cashOutInvByAcc = new Map<string, number>();
  for (const row of investmentRows) {
    const targetAccId =
      row.accountId && validAccIds.has(row.accountId) ? row.accountId : primaryAccountId;
    if (targetAccId) {
      cashOutInvByAcc.set(
        targetAccId,
        (cashOutInvByAcc.get(targetAccId) ?? 0) + row.projectedAmount
      );
    }
  }

  const cashOutProjByAcc = new Map<string, number>();
  for (const row of projectCostRows) {
    const targetAccId =
      row.accountId && validAccIds.has(row.accountId) ? row.accountId : primaryAccountId;
    if (targetAccId) {
      cashOutProjByAcc.set(
        targetAccId,
        (cashOutProjByAcc.get(targetAccId) ?? 0) + row.projectedAmount
      );
    }
  }

  const accountOpeningAdjustment = saldoAwal - effectiveAccountsSum;
  const accountDetails: AccountProjectionRow[] = effectiveAccounts.map((acc) => {
    const rawOpening = Number.isFinite(acc.balance) ? acc.balance : 0;
    const openingBalance =
      acc.id === primaryAccountId ? rawOpening + accountOpeningAdjustment : rawOpening;
    const projectedCashIn = cashInByAcc.get(acc.id) ?? 0;
    const cashOutOperasional = cashOutOpByAcc.get(acc.id) ?? 0;
    const cashOutInvestment = cashOutInvByAcc.get(acc.id) ?? 0;
    const cashOutProjectCost = cashOutProjByAcc.get(acc.id) ?? 0;
    const projectedCashOut = cashOutOperasional + cashOutInvestment + cashOutProjectCost;
    return {
      id: acc.id,
      name: acc.name,
      isPrimary: acc.id === primaryAccountId,
      openingBalance,
      projectedCashIn,
      cashOutOperasional,
      cashOutInvestment,
      cashOutProjectCost,
      projectedCashOut,
      endingBalance: openingBalance + projectedCashIn - projectedCashOut,
    };
  });

  const result: BossReportViewModel = {
    monthKey,
    previousMonthKey,
    previousMonthLabel,
    monthNameOnly: formatBossMonthNameOnly(monthKey),
    monthFullLabel: formatBossMonthFullLabel(monthKey),
    asOfDate: monthData.asOfDate,
    accounts: effectiveAccounts,
    accountDetails,
    primaryAccountId,
    saldoAwal,
    saldoAwalSource,
    hasPreviousMonthData,
    saldoTersedia,
    cashInRows,
    totalCashIn,
    totalCashInRealisasi,
    accountBalance,
    operasionalRows,
    totalOperasionalCost,
    totalOperasionalRealisasi,
    investmentRows,
    hiddenNotDuePrincipalCount,
    hasVisiblePrincipalRows,
    totalInvestmentCost,
    totalInvestmentRealisasi,
    projectCostRows,
    totalProjectCost,
    totalProjectRealisasi,
    totalCost,
    totalCostRealisasi,
    endingBalance,
    endingBalanceRealisasi,
    isMinus: endingBalance < 0,
  };

  visiting.delete(monthKey);
  cache.set(monthKey, result);
  return result;
}

function stripPrincipalNameSuffixes(rawName: string): string {
  return rawName
    .replace(/\s*\(\d+\/\d+\)/g, '')
    .replace(/\s*-\s*Jatuh tempo [^,]+,\s*telat \d+ bulan/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isInvestmentPrincipalBalanceRow(
  row: BossReportComputedRow,
  investmentsById?: Map<string, InvestmentAsset>
): boolean {
  if (row.section !== 'investment' || row.sourceCategory !== 'investment') {
    return false;
  }
  if (row.investmentComponent !== 'principal') {
    return false;
  }
  const asset = row.investmentAssetId
    ? investmentsById?.get(row.investmentAssetId)
    : undefined;
  // ANUITAS (Pokok + Bunga) adalah angsuran bulanan per periode (1/12, 2/12, dst), bukan saldo tetap
  if (asset?.paymentMethod === 'ANUITAS') {
    return false;
  }
  if (
    /^Otomatis Angsuran Investment/i.test(row.subtitle ?? '') ||
    /^(Angsuran|Denda Angsuran)\b/i.test(row.name.trim())
  ) {
    return false;
  }
  return true;
}

export function getPrincipalBalanceGroupKey(
  row: BossReportComputedRow,
  investmentsById?: Map<string, InvestmentAsset>
): string {
  const asset = row.investmentAssetId
    ? investmentsById?.get(row.investmentAssetId)
    : undefined;
  const contractNum = (asset?.contractNumber?.trim() || '').toLowerCase().replace(/\s+/g, ' ');
  const contractOrAssetKey = contractNum || row.investmentAssetId || '';
  const cleanName = stripPrincipalNameSuffixes(row.name).toLowerCase().replace(/\s+/g, ' ');
  return `inv|${contractOrAssetKey}|principal|${cleanName}`;
}

export function computePrincipalBalanceGroupTotals(rows: BossReportComputedRow[]): {
  projectedAmount: number;
  baseAmount: number;
  realisasiAmount: number;
  representativeRow: BossReportComputedRow;
} {
  const sorted = [...rows].sort((a, b) => {
    const mkA = a.sourceMonthKey ?? a.originMonthKey;
    const mkB = b.sourceMonthKey ?? b.originMonthKey;
    const cmp = mkA.localeCompare(mkB);
    if (cmp !== 0) return cmp;
    if (Boolean(a.isRescheduledIn) !== Boolean(b.isRescheduledIn)) {
      return a.isRescheduledIn ? -1 : 1;
    }
    return 0;
  });

  const lastItem = sorted[sorted.length - 1];
  const maxProjected = sorted.reduce((mx, r) => Math.max(mx, r.projectedAmount), 0);
  const maxBase = sorted.reduce((mx, r) => Math.max(mx, r.amount), 0);
  const maxRealisasi = sorted.reduce((mx, r) => Math.max(mx, r.realisasiAmount), 0);

  let projectedAmount: number;
  let representativeRow = lastItem;

  if (lastItem.color === 'green') {
    projectedAmount = maxProjected > 0 ? maxProjected : maxBase;
    representativeRow = sorted.reduce(
      (best, cur) => (cur.projectedAmount >= best.projectedAmount ? cur : best),
      lastItem
    );
  } else {
    projectedAmount = lastItem.projectedAmount;
  }

  const baseAmount = lastItem.amount > 0 ? lastItem.amount : maxBase;
  const realisasiAmount =
    lastItem.color === 'green'
      ? lastItem.realisasiAmount > 0
        ? lastItem.realisasiAmount
        : maxRealisasi
      : maxRealisasi;

  return {
    projectedAmount,
    baseAmount,
    realisasiAmount,
    representativeRow,
  };
}

export function computeBossReportRangeViewModel(
  startMonthKey: string,
  endMonthKey: string,
  bossReportMonths: Record<string, BossReportMonthData>,
  orders: PurchaseOrder[],
  clientInvoices: ClientInvoice[],
  opexItems: OpexItem[] = [],
  investments: InvestmentAsset[] = [],
  options?: {
    todayISO?: string;
    cutoffPeriod?: string;
    overrideMonths?: Record<string, BossReportMonthData>;
    projectionManualItems?: ProjectionManualItem[];
  }
): BossReportViewModel {
  const orderedStart = startMonthKey <= endMonthKey ? startMonthKey : endMonthKey;
  const orderedEnd = startMonthKey <= endMonthKey ? endMonthKey : startMonthKey;
  const monthKeys = enumerateMonthKeysInRange(orderedStart, orderedEnd);
  const effectiveMonthsMap = options?.overrideMonths
    ? { ...bossReportMonths, ...options.overrideMonths }
    : bossReportMonths;

  if (monthKeys.length <= 1) {
    const mk = monthKeys[0] ?? orderedStart;
    const monthData = effectiveMonthsMap[mk] ?? createDefaultBossReportMonth(mk);
    const single = computeBossReportViewModel(
      mk,
      monthData,
      orders,
      clientInvoices,
      opexItems,
      investments,
      effectiveMonthsMap,
      {
        todayISO: options?.todayISO,
        cutoffPeriod: options?.cutoffPeriod,
        projectionManualItems: options?.projectionManualItems,
      }
    );
    return {
      ...single,
      isRange: false,
      startMonthKey: mk,
      endMonthKey: mk,
      monthKeys: [mk],
    };
  }

  const sharedCache = new Map<string, BossReportViewModel>();
  const sharedHistCache = new Map<string, BossReportViewModel>();
  const vms = monthKeys.map((mk) => {
    const monthData = effectiveMonthsMap[mk] ?? createDefaultBossReportMonth(mk);
    return computeBossReportViewModel(
      mk,
      monthData,
      orders,
      clientInvoices,
      opexItems,
      investments,
      effectiveMonthsMap,
      {
        todayISO: options?.todayISO,
        cutoffPeriod: options?.cutoffPeriod,
        projectionManualItems: options?.projectionManualItems,
        _cache: sharedCache,
        _histCache: sharedHistCache,
      }
    );
  });

  const firstVm = vms[0];
  const lastVm = vms[vms.length - 1];
  const tagRowsForRange = (
    rows: BossReportComputedRow[],
    mk: string
  ): BossReportComputedRow[] =>
    rows.map((r) => ({
      ...r,
      rowKey: `${r.rowKey}__${mk}`,
      sourceMonthKey: r.sourceMonthKey ?? mk,
    }));

  const cashInRows = vms.flatMap((vm) => tagRowsForRange(vm.cashInRows, vm.monthKey));
  const operasionalRows = vms.flatMap((vm) =>
    tagRowsForRange(vm.operasionalRows, vm.monthKey)
  );
  const investmentRows = vms.flatMap((vm) =>
    tagRowsForRange(vm.investmentRows, vm.monthKey)
  );
  const projectCostRows = vms.flatMap((vm) =>
    tagRowsForRange(vm.projectCostRows, vm.monthKey)
  );

  const totalCashIn = vms.reduce((s, vm) => s + vm.totalCashIn, 0);
  const totalCashInRealisasi = vms.reduce((s, vm) => s + vm.totalCashInRealisasi, 0);
  const totalOperasionalCost = vms.reduce((s, vm) => s + vm.totalOperasionalCost, 0);
  const totalOperasionalRealisasi = vms.reduce(
    (s, vm) => s + vm.totalOperasionalRealisasi,
    0
  );

  // Pokok Investment (BALLOON / Pokok Outstanding) adalah SALDO, bukan biaya bulanan -> JANGAN di-SUM antar periode!
  const investmentsById = new Map(investments.map((a) => [a.id, a]));
  const principalGroupsMap = new Map<string, BossReportComputedRow[]>();
  let nonPrincipalInvestmentCost = 0;
  let nonPrincipalInvestmentRealisasi = 0;

  for (const row of investmentRows) {
    if (isInvestmentPrincipalBalanceRow(row, investmentsById)) {
      const pKey = getPrincipalBalanceGroupKey(row, investmentsById);
      const list = principalGroupsMap.get(pKey) ?? [];
      list.push(row);
      principalGroupsMap.set(pKey, list);
    } else {
      nonPrincipalInvestmentCost += row.projectedAmount;
      nonPrincipalInvestmentRealisasi += row.realisasiAmount;
    }
  }

  let principalInvestmentCost = 0;
  let principalInvestmentRealisasi = 0;
  const principalAccountAllocations: Array<{
    accountId?: string;
    projectedAmount: number;
  }> = [];

  for (const rowsInGroup of principalGroupsMap.values()) {
    const summary = computePrincipalBalanceGroupTotals(rowsInGroup);
    principalInvestmentCost += summary.projectedAmount;
    principalInvestmentRealisasi += summary.realisasiAmount;
    principalAccountAllocations.push({
      accountId: summary.representativeRow.accountId,
      projectedAmount: summary.projectedAmount,
    });
  }

  const totalInvestmentCost = nonPrincipalInvestmentCost + principalInvestmentCost;
  const totalInvestmentRealisasi =
    nonPrincipalInvestmentRealisasi + principalInvestmentRealisasi;
  const totalProjectCost = vms.reduce((s, vm) => s + vm.totalProjectCost, 0);
  const totalProjectRealisasi = vms.reduce(
    (s, vm) => s + vm.totalProjectRealisasi,
    0
  );

  const totalCost = totalOperasionalCost + totalInvestmentCost + totalProjectCost;
  const totalCostRealisasi =
    totalOperasionalRealisasi + totalInvestmentRealisasi + totalProjectRealisasi;

  const saldoAwal = firstVm.saldoAwal;
  const accountBalance = saldoAwal + totalCashIn;
  const endingBalance = saldoAwal + totalCashIn - totalCost;
  const endingBalanceRealisasi = saldoAwal + totalCashInRealisasi - totalCostRealisasi;

  const flowSumsByAccId = new Map<
    string,
    {
      cashIn: number;
      opex: number;
      inv: number;
      proj: number;
    }
  >();
  const validIds = new Set(firstVm.accountDetails.map((a) => a.id));
  const primaryAccountId = firstVm.primaryAccountId;

  for (const vm of vms) {
    for (const acc of vm.accountDetails) {
      const targetId = validIds.has(acc.id)
        ? acc.id
        : primaryAccountId ?? firstVm.accountDetails[0]?.id;
      if (!targetId) continue;
      const cur = flowSumsByAccId.get(targetId) ?? {
        cashIn: 0,
        opex: 0,
        inv: 0,
        proj: 0,
      };
      cur.cashIn += acc.projectedCashIn;
      cur.opex += acc.cashOutOperasional;
      cur.proj += acc.cashOutProjectCost;
      flowSumsByAccId.set(targetId, cur);
    }
  }

  for (const row of investmentRows) {
    if (isInvestmentPrincipalBalanceRow(row, investmentsById)) continue;
    const targetId =
      row.accountId && validIds.has(row.accountId)
        ? row.accountId
        : primaryAccountId ?? firstVm.accountDetails[0]?.id;
    if (!targetId) continue;
    const cur = flowSumsByAccId.get(targetId) ?? {
      cashIn: 0,
      opex: 0,
      inv: 0,
      proj: 0,
    };
    cur.inv += row.projectedAmount;
    flowSumsByAccId.set(targetId, cur);
  }

  for (const alloc of principalAccountAllocations) {
    const targetId =
      alloc.accountId && validIds.has(alloc.accountId)
        ? alloc.accountId
        : primaryAccountId ?? firstVm.accountDetails[0]?.id;
    if (!targetId) continue;
    const cur = flowSumsByAccId.get(targetId) ?? {
      cashIn: 0,
      opex: 0,
      inv: 0,
      proj: 0,
    };
    cur.inv += alloc.projectedAmount;
    flowSumsByAccId.set(targetId, cur);
  }

  const accountDetails: AccountProjectionRow[] = firstVm.accountDetails.map((acc) => {
    const flows = flowSumsByAccId.get(acc.id) ?? {
      cashIn: 0,
      opex: 0,
      inv: 0,
      proj: 0,
    };
    const projectedCashOut = flows.opex + flows.inv + flows.proj;
    return {
      id: acc.id,
      name: acc.name,
      isPrimary: acc.isPrimary,
      openingBalance: acc.openingBalance,
      projectedCashIn: flows.cashIn,
      cashOutOperasional: flows.opex,
      cashOutInvestment: flows.inv,
      cashOutProjectCost: flows.proj,
      projectedCashOut,
      endingBalance: acc.openingBalance + flows.cashIn - projectedCashOut,
    };
  });

  const hiddenNotDuePrincipalCount = vms.reduce(
    (s, vm) => s + vm.hiddenNotDuePrincipalCount,
    0
  );
  const hasVisiblePrincipalRows = investmentRows.some(
    (r) => r.investmentComponent === 'principal'
  );

  return {
    monthKey: orderedStart,
    isRange: true,
    startMonthKey: orderedStart,
    endMonthKey: orderedEnd,
    monthKeys,
    previousMonthKey: firstVm.previousMonthKey,
    previousMonthLabel: firstVm.previousMonthLabel,
    monthNameOnly: `${formatBossMonthShortLabel(orderedStart)} – ${formatBossMonthShortLabel(orderedEnd)}`,
    monthFullLabel: `${formatBossMonthFullLabel(orderedStart)} s/d ${formatBossMonthFullLabel(orderedEnd)}`,
    asOfDate: lastVm.asOfDate,
    accounts: firstVm.accounts,
    accountDetails,
    primaryAccountId,
    saldoAwal,
    saldoAwalSource: firstVm.saldoAwalSource,
    hasPreviousMonthData: firstVm.hasPreviousMonthData,
    saldoTersedia: saldoAwal,
    cashInRows,
    totalCashIn,
    totalCashInRealisasi,
    accountBalance,
    operasionalRows,
    totalOperasionalCost,
    totalOperasionalRealisasi,
    investmentRows,
    hiddenNotDuePrincipalCount,
    hasVisiblePrincipalRows,
    totalInvestmentCost,
    totalInvestmentRealisasi,
    projectCostRows,
    totalProjectCost,
    totalProjectRealisasi,
    totalCost,
    totalCostRealisasi,
    endingBalance,
    endingBalanceRealisasi,
    isMinus: endingBalance < 0,
  };
}

export function computeMultiMonthCashflowSeries(
  centerMonthKey: string,
  bossReportMonths: Record<string, BossReportMonthData>,
  orders: PurchaseOrder[],
  clientInvoices: ClientInvoice[],
  opexItems: OpexItem[] = [],
  investments: InvestmentAsset[] = [],
  endMonthKey?: string,
  options?: {
    todayISO?: string;
    cutoffPeriod?: string;
    projectionManualItems?: ProjectionManualItem[];
  }
): MultiMonthCashflowPoint[] {
  const sharedCache = new Map<string, BossReportViewModel>();
  const sharedHistCache = new Map<string, BossReportViewModel>();
  const targetMonths =
    endMonthKey && endMonthKey > centerMonthKey
      ? enumerateMonthKeysInRange(centerMonthKey, endMonthKey)
      : Array.from({ length: 6 }, (_, idx) => addMonthsToKey(centerMonthKey, idx - 2));

  return targetMonths.map((mk) => {
    const monthData = bossReportMonths[mk] ?? createDefaultBossReportMonth(mk);
    const vm = computeBossReportViewModel(
      mk,
      monthData,
      orders,
      clientInvoices,
      opexItems,
      investments,
      bossReportMonths,
      {
        todayISO: options?.todayISO,
        cutoffPeriod: options?.cutoffPeriod,
        projectionManualItems: options?.projectionManualItems,
        _cache: sharedCache,
        _histCache: sharedHistCache,
      }
    );
    return {
      monthKey: mk,
      shortLabel: formatBossMonthShortLabel(mk),
      fullLabel: vm.monthFullLabel,
      saldoAwal: vm.saldoAwal,
      totalCashIn: vm.totalCashIn,
      totalCashOut: vm.totalCost,
      totalOperasional: vm.totalOperasionalCost,
      totalInvestment: vm.totalInvestmentCost,
      totalProjectCost: vm.totalProjectCost,
      endingBalance: vm.endingBalance,
    };
  });
}

export function computeBalanceAccountDetails(
  vm: BossReportViewModel
): AccountProjectionRow[] {
  return vm.accountDetails.map((acc) => {
    if (acc.isPrimary) {
      return {
        id: acc.id,
        name: acc.name,
        isPrimary: true,
        openingBalance: acc.openingBalance,
        projectedCashIn: vm.totalCashInRealisasi,
        cashOutOperasional: vm.totalOperasionalRealisasi,
        cashOutInvestment: vm.totalInvestmentRealisasi,
        cashOutProjectCost: vm.totalProjectRealisasi,
        projectedCashOut: vm.totalCostRealisasi,
        endingBalance:
          acc.openingBalance + vm.totalCashInRealisasi - vm.totalCostRealisasi,
      };
    }

    return {
      id: acc.id,
      name: acc.name,
      isPrimary: false,
      openingBalance: acc.openingBalance,
      projectedCashIn: 0,
      cashOutOperasional: 0,
      cashOutInvestment: 0,
      cashOutProjectCost: 0,
      projectedCashOut: 0,
      endingBalance: acc.openingBalance,
    };
  });
}

export function computeMultiMonthRealisasiSeries(
  centerMonthKey: string,
  bossReportMonths: Record<string, BossReportMonthData>,
  orders: PurchaseOrder[],
  clientInvoices: ClientInvoice[],
  opexItems: OpexItem[] = [],
  investments: InvestmentAsset[] = [],
  endMonthKey?: string,
  options?: { todayISO?: string; cutoffPeriod?: string }
): MultiMonthCashflowPoint[] {
  const sharedCache = new Map<string, BossReportViewModel>();
  const sharedHistCache = new Map<string, BossReportViewModel>();
  const targetMonths =
    endMonthKey && endMonthKey > centerMonthKey
      ? enumerateMonthKeysInRange(centerMonthKey, endMonthKey)
      : Array.from({ length: 6 }, (_, idx) => addMonthsToKey(centerMonthKey, idx - 2));

  return targetMonths.map((mk) => {
    const monthData = bossReportMonths[mk] ?? createDefaultBossReportMonth(mk);
    const vm = computeBossReportViewModel(
      mk,
      monthData,
      orders,
      clientInvoices,
      opexItems,
      investments,
      bossReportMonths,
      {
        todayISO: options?.todayISO,
        cutoffPeriod: options?.cutoffPeriod,
        _cache: sharedCache,
        _histCache: sharedHistCache,
      }
    );
    return {
      monthKey: mk,
      shortLabel: formatBossMonthShortLabel(mk),
      fullLabel: vm.monthFullLabel,
      saldoAwal: vm.saldoAwal,
      totalCashIn: vm.totalCashInRealisasi,
      totalCashOut: vm.totalCostRealisasi,
      totalOperasional: vm.totalOperasionalRealisasi,
      totalInvestment: vm.totalInvestmentRealisasi,
      totalProjectCost: vm.totalProjectRealisasi,
      endingBalance: vm.endingBalanceRealisasi,
    };
  });
}

export function isInvestmentPrincipalPaidInProjection(
  assetId: string,
  bossReportMonths?: Record<string, BossReportMonthData>
): boolean {
  if (!bossReportMonths) return false;
  const targetSourceId = `inv_asset_${assetId}`;
  for (const monthData of Object.values(bossReportMonths)) {
    const ovHit = monthData.autoOverrides?.find(
      (ov) => ov.sourceId === targetSourceId && ov.hasCustomColor && ov.color === 'green'
    );
    if (ovHit) return true;
    const rsHit = (monthData.rescheduledIn ?? []).find(
      (rs) =>
        rs.investmentAssetId === assetId &&
        rs.investmentComponent === 'principal' &&
        rs.color === 'green'
    );
    if (rsHit) return true;
  }
  return false;
}

export function getEffectiveInvestmentRemainingPrincipal(
  asset: InvestmentAsset,
  bossReportMonths?: Record<string, BossReportMonthData>,
  options?: { todayISO?: string }
): number {
  const totals = computeInvestmentPortfolioTotals(asset, options);
  if (totals.remainingPrincipal <= 0) return 0;
  if (!bossReportMonths) return totals.remainingPrincipal;

  if (asset.paymentMethod === 'BALLOON') {
    return isInvestmentPrincipalPaidInProjection(asset.id, bossReportMonths)
      ? 0
      : totals.remainingPrincipal;
  }

  // Untuk Pokok + Bunga (ANUITAS): kurangi pokok yang sudah ditandai HIJAU - Paid di Projection
  const schedule = buildInvestmentSchedule(asset, options);
  const scheduleByMonth = new Map(schedule.map((r) => [r.monthKey, r]));
  let paidViaProjectionAmount = 0;
  const countedMonths = new Set<string>();

  for (const [mk, monthData] of Object.entries(bossReportMonths)) {
    const ov = monthData.autoOverrides?.find(
      (item) =>
        item.sourceId === `inv_asset_${asset.id}` &&
        item.hasCustomColor &&
        item.color === 'green'
    );
    if (ov && !countedMonths.has(mk)) {
      const schedRow = scheduleByMonth.get(mk);
      if (schedRow && !schedRow.isPaid && schedRow.principalPaid > 0) {
        countedMonths.add(mk);
        paidViaProjectionAmount += schedRow.principalPaid;
      } else if (!schedRow && ov.amount > 0) {
        countedMonths.add(mk);
        paidViaProjectionAmount += ov.amount;
      }
    }
    for (const rs of monthData.rescheduledIn ?? []) {
      if (
        rs.investmentAssetId === asset.id &&
        rs.investmentComponent === 'principal' &&
        rs.color === 'green'
      ) {
        const origMk = rs.investmentInstallmentMonthKey || rs.originMonthKey;
        if (!countedMonths.has(origMk)) {
          const schedRow = scheduleByMonth.get(origMk);
          if (schedRow && !schedRow.isPaid && schedRow.principalPaid > 0) {
            countedMonths.add(origMk);
            paidViaProjectionAmount += schedRow.principalPaid;
          } else if (rs.amount > 0) {
            countedMonths.add(origMk);
            paidViaProjectionAmount += rs.amount;
          }
        }
      }
    }
  }

  return Math.max(0, totals.remainingPrincipal - paidViaProjectionAmount);
}

