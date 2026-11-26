import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FilePlus2,
  FileText,
  History,
  ListOrdered,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AuditLogEntry } from '../types/auth';
import {
  BossReportColorStatus,
  BossReportMonthData,
  BossReportRescheduledItem,
} from '../types/bossReport';
import {
  EXPECTED_KKB_TOTAL_MONTHLY_INTEREST,
  EXPECTED_KKB_TOTAL_PRINCIPAL,
  InvestmentCsvImportResult,
  parseAndValidateInvestmentCsv,
} from '../utils/investmentCsvImport';
import {
  buildInvestmentComponentPeriodKey,
  hasInvestmentComponentEntriesForMonth,
  InterestInputType,
  INVESTMENT_PAYMENT_METHODS,
  INVESTMENT_STATUS_META,
  InvestmentAddendumFormSubmission,
  InvestmentAsset,
  InvestmentComponentKey,
  InvestmentInput,
  InvestmentPaymentMethod,
  InvestmentStatus,
  isInvestmentComponentPaidInSet,
} from '../types/investment';
import {
  addMonthsToKey,
  formatBossMonthFullLabel,
  formatBossMonthShortLabel,
  getEffectiveInvestmentRemainingPrincipal,
  getMonthSelectorOptions,
} from '../utils/bossReportCalc';
import {
  computeDueTunggakanStatus,
  formatIDR,
  getTodayISODate,
  normalizeToIsoDate,
} from '../utils/format';
import {
  addMonthsToInvestmentKey,
  buildInvestmentSchedule,
  computeBonusForAmount,
  computeInvestmentPortfolioTotals,
  computeLoanEndDate,
  computeMonthlyInterestForBalance,
  computeMonthlyLateFeeForBalance,
  diffCalendarMonthsOverdue,
  formatDDMMMYYYYDash,
  formatMonthYearShortID,
  getEffectiveAssetBonusAmount,
  getEffectiveAssetBonusDate,
  getEffectiveAssetEndDate,
  getEffectiveAssetStartDate,
  getInvestmentInstallmentForMonth,
  InvestmentInstallmentRow,
  roundInterestRate,
} from '../utils/investmentCalc';
import {
  getInvestmentPaymentHistory,
  loadProjectionRevisions,
} from '../utils/projectionRevisionLog';
import {
  formatMonthShortID,
  normalizeStatusToColor,
} from '../types/statusWarna';
import { InvestmentAddendumModal } from './InvestmentAddendumModal';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { RupiahInput } from './RupiahInput';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';

interface InvestmentViewProps {
  investments: InvestmentAsset[];
  bossReportMonths?: Record<string, BossReportMonthData>;
  selectedMonthKey?: string;
  onChangeMonthKey?: (monthKey: string) => void;
  auditLogs?: AuditLogEntry[];
  isLoading: boolean;
  canEdit?: boolean;
  onCreateInvestment: (input: InvestmentInput) => Promise<string>;
  onUpdateInvestment: (id: string, input: InvestmentInput) => Promise<void>;
  onAddAddendum: (id: string, submission: InvestmentAddendumFormSubmission) => Promise<void>;
  onTogglePaidMonth: (
    id: string,
    monthKey: string,
    component?: InvestmentComponentKey
  ) => Promise<void>;
  onSetMonthStatusWarna?: (
    id: string,
    monthKey: string,
    color: 'white' | 'green' | 'red',
    targetMonthKey?: string,
    component?: InvestmentComponentKey
  ) => Promise<void>;
  onRescheduledCopyAction?: (
    monthKey: string,
    rescheduledItemId: string,
    nextColor: BossReportColorStatus,
    targetMonthKey?: string
  ) => Promise<void>;
  onDeleteInvestment: (id: string) => Promise<void>;
  onImportCsv?: (
    entries: Array<{ id?: string; input: InvestmentInput }>,
    options: { replaceExisting: boolean }
  ) => Promise<{ count: number }>;
}

function formatRateDisplay(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '0';
  return String(Math.round(val * 10000) / 10000);
}

function formatLateBadgeText(row: InvestmentInstallmentRow): string {
  const totalStr = `Rp ${formatIDR(row.lateFeeAmount)}`;
  if (row.lateFeeType === 'PERCENT') {
    return `TERLAMBAT ${row.monthsLate} BULAN - Denda ${totalStr} / ${formatRateDisplay(
      row.lateFeeRate
    )}% / bulan`;
  }
  return row.monthsLate > 1
    ? `TERLAMBAT ${row.monthsLate} BULAN - Denda ${totalStr} (Rp ${formatIDR(
        row.monthlyLateFee
      )} / bulan)`
    : `TERLAMBAT ${row.monthsLate} BULAN - Denda ${totalStr} / bulan`;
}

function getInstallmentDueBadge(params: {
  assetStatus: InvestmentStatus;
  dueISO: string;
  principalPaid: number;
  isPaid: boolean;
  isBonusOnlyRow?: boolean;
  paymentMethod?: InvestmentPaymentMethod;
  endMonthKey?: string;
  todayISO: string;
  monthStatus?: string;
  monthStatusWarna?: string;
  rescheduledToMonth?: string;
}): { label: string; badgeClass: string } {
  const {
    assetStatus,
    dueISO,
    principalPaid,
    isPaid,
    isBonusOnlyRow,
    paymentMethod,
    endMonthKey,
    todayISO,
    monthStatus,
    monthStatusWarna,
    rescheduledToMonth,
  } = params;

  if (assetStatus === 'Lunas' || isPaid) {
    return {
      label: 'Paid',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  if (
    monthStatus === 'Reschedule' ||
    monthStatus === 'Rescheduling' ||
    monthStatusWarna === 'MERAH' ||
    Boolean(rescheduledToMonth)
  ) {
    return {
      label: rescheduledToMonth
        ? `Pending (→ ${formatMonthShortID(rescheduledToMonth)})`
        : 'Pending',
      badgeClass: 'bg-red-50 text-red-900 border-red-300',
    };
  }
  if (assetStatus === 'Ditunda') {
    return {
      label: 'Ditunda',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  if (dueISO < todayISO) {
    const monthsLate = diffCalendarMonthsOverdue(dueISO, todayISO);
    if (isBonusOnlyRow) {
      return {
        label: `BONUS JATUH TEMPO - TERLAMBAT ${monthsLate} BULAN`,
        badgeClass: 'bg-red-600 text-white border-red-700 font-bold',
      };
    }
    if (principalPaid > 0) {
      return {
        label: `JATUH TEMPO - TERLAMBAT ${monthsLate} BULAN (Pokok Rp ${formatIDR(principalPaid)})`,
        badgeClass: 'bg-red-600 text-white border-red-700 font-bold',
      };
    }
    return {
      label: `JATUH TEMPO - TERLAMBAT ${monthsLate} BULAN`,
      badgeClass: 'bg-red-600 text-white border-red-700 font-bold',
    };
  }
  if (dueISO === todayISO) {
    if (isBonusOnlyRow) {
      return {
        label: 'BONUS JATUH TEMPO',
        badgeClass: 'bg-red-50 text-red-700 border-red-300 font-bold',
      };
    }
    if (principalPaid > 0) {
      return {
        label: `POKOK JATUH TEMPO Rp ${formatIDR(principalPaid)}`,
        badgeClass: 'bg-red-50 text-red-700 border-red-300 font-bold',
      };
    }
    return {
      label: 'JATUH TEMPO',
      badgeClass: 'bg-red-50 text-red-700 border-red-300 font-bold',
    };
  }
  if (paymentMethod === 'BALLOON' && principalPaid === 0 && endMonthKey) {
    return {
      label: `Pokok JT ${formatMonthYearShortID(endMonthKey)}`,
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    };
  }
  return {
    label: 'Belum Jatuh Tempo',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
}

function getAssetTableMonthlyBunga(asset: InvestmentAsset): number {
  if (asset.paymentMethod === 'ANUITAS') {
    if (asset.interestInputType === 'RP' && (asset.monthlyInstallment || 0) > 0) {
      return Math.round(asset.monthlyInstallment);
    }
    const fixedPokok =
      asset.principalAmount > 0
        ? Math.round(asset.principalAmount / Math.max(1, asset.tenorMonths || 1))
        : Math.round(asset.fixedPrincipalPerMonth || 0);
    const month1Bunga = computeMonthlyInterestForBalance({
      remainingPrincipal: asset.principalAmount,
      interestInputType: asset.interestInputType,
      monthlyInterestAmount: asset.monthlyInterestAmount,
      monthlyInterestRate: asset.monthlyInterestRate,
      paymentMethod: asset.paymentMethod,
      initialPrincipalBasis: asset.principalAmount,
    });
    if (month1Bunga > 0 || asset.interestInputType === 'PERCENT') {
      return fixedPokok + month1Bunga;
    }
    if ((asset.monthlyInstallment || 0) > 0) {
      return Math.round(asset.monthlyInstallment);
    }
    return fixedPokok;
  }
  return computeMonthlyInterestForBalance({
    remainingPrincipal: asset.principalAmount,
    interestInputType: asset.interestInputType,
    monthlyInterestAmount: asset.monthlyInterestAmount,
    monthlyInterestRate: asset.monthlyInterestRate,
  });
}

function formatInvestmentComponentShortLabel(component?: InvestmentComponentKey): string {
  if (component === 'principal') return 'Pokok';
  if (component === 'interest') return 'Bunga';
  if (component === 'lateFee') return 'Denda';
  if (component === 'bonus') return 'Bonus';
  return 'Cicilan';
}

function getOverrideSourceIdsForComponent(
  assetId: string,
  component: InvestmentComponentKey
): string[] {
  if (component === 'principal') return [`inv_asset_${assetId}`];
  if (component === 'interest') return [`inv_int_${assetId}`];
  if (component === 'lateFee') return [`inv_fee_${assetId}`, `inv_int_${assetId}`];
  return [`inv_bonus_${assetId}`];
}

function resolveAssetComponentUiStatus(params: {
  asset: InvestmentAsset;
  monthKey: string;
  component: InvestmentComponentKey;
  isPaidFromSchedule?: boolean;
  bossReportMonths?: Record<string, BossReportMonthData>;
}): {
  colorKey: 'white' | 'green' | 'red';
  isPending: boolean;
  isPaid: boolean;
  rescheduledToMonth?: string;
} {
  const {
    asset,
    monthKey,
    component,
    isPaidFromSchedule = false,
    bossReportMonths,
  } = params;
  const paidSet = new Set(Array.isArray(asset.paidMonths) ? asset.paidMonths : []);
  const compKey = buildInvestmentComponentPeriodKey(monthKey, component);
  const overrides = bossReportMonths?.[monthKey]?.autoOverrides ?? [];
  const targetSourceIds = getOverrideSourceIdsForComponent(asset.id, component);
  const compOverride = overrides.find(
    (o) => o.hasCustomColor && targetSourceIds.includes(o.sourceId)
  );
  const hasSiblingOverrideInMonth = overrides.some(
    (o) =>
      o.hasCustomColor &&
      !targetSourceIds.includes(o.sourceId) &&
      (o.sourceId === `inv_asset_${asset.id}` ||
        o.sourceId === `inv_int_${asset.id}` ||
        o.sourceId === `inv_fee_${asset.id}` ||
        o.sourceId === `inv_bonus_${asset.id}`)
  );

  const assetPeriodKeys = [
    ...(Array.isArray(asset.paidMonths) ? asset.paidMonths : []),
    ...Object.keys(asset.monthStatuses ?? {}),
    ...Object.keys(asset.monthStatusWarnas ?? {}),
    ...Object.keys(asset.rescheduledMonths ?? {}),
  ];
  const hasAnyComponentKey =
    hasInvestmentComponentEntriesForMonth(assetPeriodKeys, monthKey) ||
    hasSiblingOverrideInMonth;

  const isPaidSource =
    asset.status === 'Lunas' ||
    isPaidFromSchedule ||
    isInvestmentComponentPaidInSet(paidSet, monthKey, component);

  if (compOverride?.hasCustomColor) {
    if (compOverride.color === 'red') {
      return {
        colorKey: 'red',
        isPending: true,
        isPaid: false,
        rescheduledToMonth:
          compOverride.rescheduledToMonth ||
          asset.rescheduledMonths?.[compKey] ||
          (!hasAnyComponentKey ? asset.rescheduledMonths?.[monthKey] : undefined),
      };
    }
    if (compOverride.color === 'green') {
      return { colorKey: 'green', isPending: false, isPaid: true };
    }
    return { colorKey: 'white', isPending: false, isPaid: false };
  }

  if (isPaidSource) {
    return { colorKey: 'green', isPending: false, isPaid: true };
  }

  const rawStatus =
    asset.monthStatuses?.[compKey] ??
    (!hasAnyComponentKey ? asset.monthStatuses?.[monthKey] : undefined);
  const rawWarna =
    asset.monthStatusWarnas?.[compKey] ??
    (!hasAnyComponentKey ? asset.monthStatusWarnas?.[monthKey] : undefined);
  const reschedTarget =
    asset.rescheduledMonths?.[compKey] ??
    (!hasAnyComponentKey ? asset.rescheduledMonths?.[monthKey] : undefined);

  const resolvedColor = normalizeStatusToColor(
    rawStatus ?? (reschedTarget ? 'Reschedule' : 'Not Paid'),
    rawWarna ?? (reschedTarget ? 'MERAH' : 'PUTIH')
  );

  return {
    colorKey: resolvedColor,
    isPending: resolvedColor === 'red',
    isPaid: resolvedColor === 'green',
    rescheduledToMonth: resolvedColor === 'red' ? reschedTarget : undefined,
  };
}

export const InvestmentView: React.FC<InvestmentViewProps> = ({
  investments,
  bossReportMonths,
  selectedMonthKey: controlledMonthKey,
  onChangeMonthKey,
  auditLogs = [],
  isLoading,
  canEdit = true,
  onCreateInvestment,
  onUpdateInvestment,
  onAddAddendum,
  onTogglePaidMonth,
  onSetMonthStatusWarna,
  onRescheduledCopyAction,
  onDeleteInvestment,
  onImportCsv,
}) => {
  const todayISO = useMemo(() => getTodayISODate(), []);
  const defaultMonthKey = useMemo(() => todayISO.slice(0, 7), [todayISO]);
  const [localSelectedMonthKey, setLocalSelectedMonthKey] = useState(defaultMonthKey);
  const selectedMonthKey = controlledMonthKey ?? localSelectedMonthKey;
  const setSelectedMonthKey = (nextMonthKey: string) => {
    if (onChangeMonthKey) {
      onChangeMonthKey(nextMonthKey);
    } else {
      setLocalSelectedMonthKey(nextMonthKey);
    }
  };
  const activeCutoffGlobalDate = `${selectedMonthKey}-01`;

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | InvestmentStatus>('All');

  // Detail & Addendum Modals
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'schedule' | 'addendums' | 'history'>('schedule');
  const [addendumTargetAsset, setAddendumTargetAsset] = useState<InvestmentAsset | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form Modal State
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<InvestmentAsset | null>(null);

  const [contractNumber, setContractNumber] = useState('');
  const [startDate, setStartDate] = useState(todayISO);
  const [tenorMonths, setTenorMonths] = useState('12');
  const [dueDay, setDueDay] = useState('');
  const [endDate, setEndDate] = useState(() => computeLoanEndDate(todayISO, 12));
  const [endDateManuallyEdited, setEndDateManuallyEdited] = useState(false);
  const [name, setName] = useState('');
  const [principalAmount, setPrincipalAmount] = useState('');
  const [interestInputType, setInterestInputType] = useState<InterestInputType>('RP');
  const [monthlyInterestAmountStr, setMonthlyInterestAmountStr] = useState('');
  const [monthlyInterestRateStr, setMonthlyInterestRateStr] = useState('0');

  const [bonusInputType, setBonusInputType] = useState<InterestInputType>('RP');
  const [bonusAmountStr, setBonusAmountStr] = useState('');
  const [bonusRateStr, setBonusRateStr] = useState('0');
  const [bonusDate, setBonusDate] = useState(() => computeLoanEndDate(todayISO, 12));
  const [bonusDateManuallyEdited, setBonusDateManuallyEdited] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<InvestmentPaymentMethod>('BALLOON');

  const [lateFeeInputType, setLateFeeInputType] = useState<InterestInputType>('RP');
  const [lateFeePerMonthAmountStr, setLateFeePerMonthAmountStr] = useState('');
  const [lateFeePerMonthRateStr, setLateFeePerMonthRateStr] = useState('0');

  const [status, setStatus] = useState<InvestmentStatus>('Aktif');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyInstallmentKey, setBusyInstallmentKey] = useState<string | null>(null);
  const [rescheduleModal, setRescheduleModal] = useState<{
    asset: InvestmentAsset;
    monthKey: string;
    component?: InvestmentComponentKey;
    amount: number;
    label: string;
    initialTargetMonthKey?: string;
  } | null>(null);
  const [rescheduleCopyModal, setRescheduleCopyModal] = useState<{
    monthKey: string;
    item: BossReportRescheduledItem;
  } | null>(null);

  // CSV Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvRawText, setCsvRawText] = useState('');
  const [strictKkbTotals, setStrictKkbTotals] = useState(true);
  const [replaceExistingOnImport, setReplaceExistingOnImport] = useState(true);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importSuccessMessage, setImportSuccessMessage] = useState('');
  const [importErrorMessage, setImportErrorMessage] = useState('');

  const csvValidation: InvestmentCsvImportResult | null = useMemo(() => {
    if (!showImportModal || !csvRawText.trim()) return null;
    return parseAndValidateInvestmentCsv(csvRawText, {
      requireExactTotals: strictKkbTotals,
    });
  }, [showImportModal, csvRawText, strictKkbTotals]);

  const monthOptions = useMemo(
    () => getMonthSelectorOptions(defaultMonthKey),
    [defaultMonthKey]
  );

  const detailAsset = useMemo(
    () => (detailAssetId ? investments.find((a) => a.id === detailAssetId) ?? null : null),
    [investments, detailAssetId]
  );

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return investments.filter((asset) => {
      if (statusFilter !== 'All' && asset.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (asset.contractNumber ?? '').toLowerCase().includes(q) ||
        asset.name.toLowerCase().includes(q) ||
        (asset.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [investments, searchQuery, statusFilter]);

  const tableTotals = useMemo(() => {
    let totalNilaiPinjaman = 0;
    let totalBungaPerBulan = 0;
    let totalBonus = 0;
    let totalPokokJatuhTempoBelumDibayar = 0;
    let totalEstimasiSisaPokok = 0;
    let activeCount = 0;
    let paidCount = 0;

    for (const asset of filteredAssets) {
      totalNilaiPinjaman += Number(asset.principalAmount) || 0;
      totalBungaPerBulan += getAssetTableMonthlyBunga(asset);
      totalBonus += getEffectiveAssetBonusAmount(asset);
    }

    for (const asset of investments) {
      if (asset.status === 'Lunas') paidCount += 1;
      else if (asset.status === 'Aktif') activeCount += 1;
      const totals = computeInvestmentPortfolioTotals(asset, {
        todayISO,
        cutoffDateOverride: activeCutoffGlobalDate,
      });
      const effectiveRem = getEffectiveInvestmentRemainingPrincipal(asset, bossReportMonths, {
        todayISO,
      });
      totalPokokJatuhTempoBelumDibayar +=
        effectiveRem > 0 ? Math.min(totals.overdueUnpaidPrincipal, effectiveRem) : 0;
      totalEstimasiSisaPokok += effectiveRem;
    }

    let dueThisMonth = investments.reduce((sum, asset) => {
      const row = getInvestmentInstallmentForMonth(asset, selectedMonthKey, {
        todayISO,
        cutoffDateOverride: activeCutoffGlobalDate,
      });
      if (!row) return sum;
      let rowActiveTotal = 0;
      if (row.principalPaid > 0) {
        const pStatus = resolveAssetComponentUiStatus({
          asset,
          monthKey: selectedMonthKey,
          component: 'principal',
          isPaidFromSchedule: row.isPrincipalPaid,
          bossReportMonths,
        });
        if (!pStatus.isPending) rowActiveTotal += row.principalPaid;
      }
      const interestOrFeeAmt = row.isLate ? row.lateFeeAmount : row.interestPaid;
      if (interestOrFeeAmt > 0) {
        const iStatus = resolveAssetComponentUiStatus({
          asset,
          monthKey: selectedMonthKey,
          component: row.isLate ? 'lateFee' : 'interest',
          isPaidFromSchedule: row.isInterestPaid,
          bossReportMonths,
        });
        if (!iStatus.isPending) rowActiveTotal += interestOrFeeAmt;
      }
      if (row.bonusPaid > 0) {
        const bStatus = resolveAssetComponentUiStatus({
          asset,
          monthKey: selectedMonthKey,
          component: 'bonus',
          isPaidFromSchedule: row.isBonusPaid,
          bossReportMonths,
        });
        if (!bStatus.isPending) rowActiveTotal += row.bonusPaid;
      }
      return sum + rowActiveTotal;
    }, 0);

    const monthRescheduledIn = bossReportMonths?.[selectedMonthKey]?.rescheduledIn ?? [];
    for (const copy of monthRescheduledIn) {
      if (
        copy.section === 'investment' &&
        copy.sourceCategory === 'investment' &&
        copy.color !== 'red'
      ) {
        dueThisMonth += Number(copy.amount) || 0;
      }
    }

    return {
      totalNilaiPinjaman,
      totalBungaPerBulan,
      totalBonus,
      totalPokokJatuhTempoBelumDibayar,
      totalEstimasiSisaPokok,
      dueThisMonth,
      activeCount,
      paidCount,
    };
  }, [filteredAssets, investments, bossReportMonths, selectedMonthKey, todayISO, activeCutoffGlobalDate]);

  const openNewForm = () => {
    if (!canEdit) return;
    const initStartDate = todayISO;
    const initEndDate = computeLoanEndDate(initStartDate, 12);
    setEditingAsset(null);
    setContractNumber('');
    setStartDate(initStartDate);
    setTenorMonths('12');
    setDueDay('');
    setEndDate(initEndDate);
    setEndDateManuallyEdited(false);
    setName('');
    setPrincipalAmount('');
    setInterestInputType('RP');
    setMonthlyInterestAmountStr('');
    setMonthlyInterestRateStr('0');
    setBonusInputType('RP');
    setBonusAmountStr('');
    setBonusRateStr('0');
    setBonusDate(initEndDate);
    setBonusDateManuallyEdited(false);
    setPaymentMethod('BALLOON');
    setLateFeeInputType('RP');
    setLateFeePerMonthAmountStr('');
    setLateFeePerMonthRateStr('0');
    setStatus('Aktif');
    setNotes('');
    setFormError(null);
    setActionError(null);
    setShowForm(true);
  };

  const openEditForm = (asset: InvestmentAsset) => {
    if (!canEdit) return;
    const effStart = getEffectiveAssetStartDate(asset);
    const effEnd = getEffectiveAssetEndDate(asset);
    const autoEnd = computeLoanEndDate(effStart, asset.tenorMonths);
    const effBonusDate = getEffectiveAssetBonusDate(asset);
    const isAnuitas = asset.paymentMethod === 'ANUITAS';
    const initIntType: InterestInputType = isAnuitas
      ? 'RP'
      : asset.interestInputType === 'PERCENT'
      ? 'PERCENT'
      : 'RP';
    const fixedPerMonth =
      asset.principalAmount > 0
        ? Math.round(asset.principalAmount / Math.max(1, asset.tenorMonths || 1))
        : Math.round(asset.fixedPrincipalPerMonth || 0);
    const computedMonth1Bunga =
      asset.interestInputType === 'PERCENT'
        ? computeMonthlyInterestForBalance({
            remainingPrincipal: asset.principalAmount,
            interestInputType: 'PERCENT',
            monthlyInterestAmount: 0,
            monthlyInterestRate: asset.monthlyInterestRate,
          })
        : asset.monthlyInterestAmount;
    const initialBungaRp = isAnuitas
      ? (asset.monthlyInstallment || 0) > 0
        ? Math.round(asset.monthlyInstallment)
        : fixedPerMonth + Math.round(computedMonth1Bunga || 0)
      : computedMonth1Bunga;

    setEditingAsset(asset);
    setContractNumber(asset.contractNumber ?? '');
    setStartDate(effStart);
    setTenorMonths(String(asset.tenorMonths));
    setDueDay(asset.dueDay ? String(asset.dueDay) : '');
    setEndDate(effEnd);
    setEndDateManuallyEdited(effEnd !== autoEnd);
    setName(asset.name);
    setPrincipalAmount(String(asset.principalAmount));
    setInterestInputType(initIntType);
    setMonthlyInterestAmountStr(String(Math.round(initialBungaRp || 0)));
    setMonthlyInterestRateStr(formatRateDisplay(asset.monthlyInterestRate ?? 0));
    setBonusInputType(asset.bonusInputType === 'PERCENT' ? 'PERCENT' : 'RP');
    setBonusAmountStr(String(asset.bonusAmount ?? 0));
    setBonusRateStr(formatRateDisplay(asset.bonusRate ?? 0));
    setBonusDate(effBonusDate);
    setBonusDateManuallyEdited(effBonusDate !== effEnd);
    setPaymentMethod(asset.paymentMethod === 'ANUITAS' ? 'ANUITAS' : 'BALLOON');
    setLateFeeInputType(asset.lateFeeInputType === 'PERCENT' ? 'PERCENT' : 'RP');
    setLateFeePerMonthAmountStr(String(asset.lateFeePerMonthAmount ?? 0));
    setLateFeePerMonthRateStr(formatRateDisplay(asset.lateFeePerMonthRate ?? 0));
    setStatus(asset.status);
    setNotes(asset.notes ?? '');
    setFormError(null);
    setActionError(null);
    setShowForm(true);
  };

  const handleTenorChange = (val: string) => {
    setTenorMonths(val);
    const n = Math.max(1, Math.min(360, Number(val) || 1));
    if (!endDateManuallyEdited && startDate) {
      const nextEnd = computeLoanEndDate(startDate, n);
      setEndDate(nextEnd);
      if (!bonusDateManuallyEdited) {
        setBonusDate(nextEnd);
      }
    }
  };

  const handleStartDateChange = (nextDate: string) => {
    setStartDate(nextDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      if (!endDateManuallyEdited) {
        const n = Math.max(1, Math.min(360, Number(tenorMonths) || 1));
        const nextEnd = computeLoanEndDate(nextDate, n);
        setEndDate(nextEnd);
        if (!bonusDateManuallyEdited) {
          setBonusDate(nextEnd);
        }
      }
    }
  };

  const handleEndDateManualChange = (nextEnd: string) => {
    setEndDateManuallyEdited(true);
    setEndDate(nextEnd);
    if (!bonusDateManuallyEdited) {
      setBonusDate(nextEnd);
    }
  };

  const formLiveCalc = useMemo(() => {
    const P = Math.max(0, Math.round(Number(principalAmount) || 0));
    const n = Math.max(1, Math.min(360, Math.round(Number(tenorMonths) || 1)));
    const enteredRp = Math.max(0, Math.round(Number(monthlyInterestAmountStr) || 0));
    const effectiveIntType: InterestInputType =
      paymentMethod === 'ANUITAS' ? 'RP' : interestInputType;

    const rawFixedPokok = P > 0 ? Math.round(P / n) : 0;
    const fixedPokok =
      paymentMethod === 'ANUITAS'
        ? enteredRp > 0
          ? Math.min(rawFixedPokok, enteredRp)
          : rawFixedPokok
        : 0;

    const rawBungaRp =
      paymentMethod === 'ANUITAS'
        ? enteredRp > 0
          ? Math.max(0, enteredRp - fixedPokok)
          : 0
        : effectiveIntType === 'RP'
        ? enteredRp
        : 0;
    const rawBungaPct =
      paymentMethod === 'ANUITAS'
        ? 0
        : effectiveIntType === 'PERCENT'
        ? roundInterestRate(Number(monthlyInterestRateStr) || 0)
        : 0;

    const firstMonthBungaRp =
      paymentMethod === 'ANUITAS'
        ? rawBungaRp
        : computeMonthlyInterestForBalance({
            remainingPrincipal: P,
            interestInputType: effectiveIntType,
            monthlyInterestAmount: rawBungaRp,
            monthlyInterestRate: rawBungaPct,
            paymentMethod,
            initialPrincipalBasis: P,
          });

    const totalCicilanBulan =
      paymentMethod === 'ANUITAS'
        ? enteredRp > 0
          ? enteredRp
          : fixedPokok
        : firstMonthBungaRp;

    const lateFeeRp =
      lateFeeInputType === 'RP'
        ? Math.max(0, Math.round(Number(lateFeePerMonthAmountStr) || 0))
        : 0;
    const lateFeePct =
      lateFeeInputType === 'PERCENT'
        ? roundInterestRate(Number(lateFeePerMonthRateStr) || 0)
        : 0;

    const bonusRp =
      bonusInputType === 'RP' ? Math.max(0, Math.round(Number(bonusAmountStr) || 0)) : 0;
    const bonusPct =
      bonusInputType === 'PERCENT' ? roundInterestRate(Number(bonusRateStr) || 0) : 0;

    const firstMonthLateFee = computeMonthlyLateFeeForBalance({
      remainingPrincipal: P,
      lateFeeInputType,
      lateFeePerMonthAmount: lateFeeRp,
      lateFeePerMonthRate: lateFeePct,
    });

    const effectiveBonusRp = computeBonusForAmount({
      principalBasis: P,
      bonusInputType,
      bonusAmount: bonusRp,
      bonusRate: bonusPct,
    });

    const contractMonthKey =
      normalizeToIsoDate(startDate)?.slice(0, 7) ?? defaultMonthKey;
    const derivedStartMonthKey = addMonthsToInvestmentKey(contractMonthKey, 1);
    const effectiveEndDate =
      normalizeToIsoDate(endDate) ?? computeLoanEndDate(startDate, n);
    const effectiveBonusDate =
      normalizeToIsoDate(bonusDate) ?? effectiveEndDate;
    const parsedDueDay =
      dueDay.trim() && Number(dueDay) >= 1 && Number(dueDay) <= 31
        ? Math.round(Number(dueDay))
        : undefined;

    const schedule = showForm
      ? buildInvestmentSchedule(
          {
            principalAmount: P,
            paymentMethod,
            fixedPrincipalPerMonth: fixedPokok,
            interestInputType: effectiveIntType,
            monthlyInterestAmount: rawBungaRp,
            monthlyInterestRate: rawBungaPct,
            lateFeeInputType,
            lateFeePerMonthAmount: lateFeeRp,
            lateFeePerMonthRate: lateFeePct,
            bonusInputType,
            bonusAmount: bonusRp,
            bonusRate: bonusPct,
            bonusDate: effectiveBonusDate,
            monthlyInstallment: totalCicilanBulan,
            tenorMonths: n,
            startMonthKey: derivedStartMonthKey,
            startDate,
            endDate: effectiveEndDate,
            dueDay: parsedDueDay,
            paidMonths: [],
          },
          { todayISO, ignoreLateFees: true, cutoffDateOverride: activeCutoffGlobalDate }
        )
      : [];

    return {
      P,
      n,
      fixedPokok,
      rawBungaRp,
      rawBungaPct,
      interestRp: firstMonthBungaRp,
      totalCicilanBulan,
      lateFeeRp,
      lateFeePct,
      firstMonthLateFee,
      bonusRp,
      bonusPct,
      effectiveBonusRp,
      effectiveBonusDate,
      derivedStartMonthKey,
      schedule,
    };
  }, [
    showForm,
    principalAmount,
    tenorMonths,
    paymentMethod,
    interestInputType,
    monthlyInterestAmountStr,
    monthlyInterestRateStr,
    lateFeeInputType,
    lateFeePerMonthAmountStr,
    lateFeePerMonthRateStr,
    bonusInputType,
    bonusAmountStr,
    bonusRateStr,
    bonusDate,
    startDate,
    endDate,
    dueDay,
    defaultMonthKey,
    todayISO,
    activeCutoffGlobalDate,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const normalizedStartDate = normalizeToIsoDate(startDate);
      if (!normalizedStartDate) {
        setFormError(
          'Tgl Kontrak tidak valid. Gunakan format tanggal YYYY-MM-DD atau DD/MM/YYYY.'
        );
        return;
      }
      const rawEndCandidate =
        endDate || computeLoanEndDate(normalizedStartDate, formLiveCalc.n);
      const resolvedEndDate = normalizeToIsoDate(rawEndCandidate);
      if (!resolvedEndDate) {
        setFormError(
          'Tgl Jatuh Tempo tidak valid. Gunakan format tanggal YYYY-MM-DD atau DD/MM/YYYY.'
        );
        return;
      }
      const resolvedBonusDate =
        normalizeToIsoDate(bonusDate) ?? resolvedEndDate;
      const trimmedDueDay = dueDay.trim();
      const numericDueDay = trimmedDueDay ? Number(trimmedDueDay) : NaN;
      const parsedDueDay =
        trimmedDueDay &&
        Number.isFinite(numericDueDay) &&
        numericDueDay >= 1 &&
        numericDueDay <= 31
          ? Math.round(numericDueDay)
          : undefined;

      const payload: InvestmentInput = {
        contractNumber: contractNumber.trim(),
        name: name.trim(),
        institution: editingAsset?.institution && editingAsset.institution !== '-'
          ? editingAsset.institution
          : name.trim(),
        category: editingAsset?.category ?? 'Pinjaman / Kredit',
        principalAmount: formLiveCalc.P,
        paymentMethod,
        fixedPrincipalPerMonth:
          paymentMethod === 'BALLOON' ? 0 : formLiveCalc.fixedPokok,
        interestInputType: paymentMethod === 'ANUITAS' ? 'RP' : interestInputType,
        monthlyInterestAmount: formLiveCalc.rawBungaRp,
        monthlyInterestRate: formLiveCalc.rawBungaPct,
        lateFeeInputType,
        lateFeePerMonthAmount: formLiveCalc.lateFeeRp,
        lateFeePerMonthRate: formLiveCalc.lateFeePct,
        bonusInputType,
        bonusAmount: formLiveCalc.bonusRp,
        bonusRate: formLiveCalc.bonusPct,
        bonusDate: resolvedBonusDate,
        monthlyInstallment: formLiveCalc.totalCicilanBulan,
        tenorMonths: formLiveCalc.n,
        startMonthKey: addMonthsToInvestmentKey(normalizedStartDate.slice(0, 7), 1),
        startDate: normalizedStartDate,
        endDate: resolvedEndDate,
        dueDay: parsedDueDay,
        paidMonths: editingAsset?.paidMonths ?? [],
        status,
        notes: notes.trim(),
      };
      if (editingAsset) {
        await onUpdateInvestment(editingAsset.id, payload);
      } else {
        await onCreateInvestment(payload);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleMarkLunas = async (asset: InvestmentAsset) => {
    setActionError(null);
    const nextStatus: InvestmentStatus = asset.status === 'Lunas' ? 'Aktif' : 'Lunas';
    try {
      await onUpdateInvestment(asset.id, {
        contractNumber: asset.contractNumber,
        name: asset.name,
        institution: asset.institution,
        category: asset.category,
        principalAmount: asset.principalAmount,
        paymentMethod: asset.paymentMethod,
        fixedPrincipalPerMonth: asset.fixedPrincipalPerMonth,
        interestInputType: asset.interestInputType,
        monthlyInterestAmount: asset.monthlyInterestAmount,
        monthlyInterestRate: asset.monthlyInterestRate,
        lateFeeInputType: asset.lateFeeInputType,
        lateFeePerMonthAmount: asset.lateFeePerMonthAmount,
        lateFeePerMonthRate: asset.lateFeePerMonthRate,
        bonusInputType: asset.bonusInputType,
        bonusAmount: asset.bonusAmount,
        bonusRate: asset.bonusRate,
        bonusDate: asset.bonusDate,
        monthlyInstallment: asset.monthlyInstallment,
        tenorMonths: asset.tenorMonths,
        startMonthKey: asset.startMonthKey,
        startDate: asset.startDate,
        endDate: asset.endDate,
        cutoffDate: asset.cutoffDate,
        legacyLateFeeBeforeCutoff: asset.legacyLateFeeBeforeCutoff,
        dueDay: asset.dueDay,
        paidMonths: asset.paidMonths,
        status: nextStatus,
        notes: asset.notes,
        originalContract: asset.originalContract,
        addendums: asset.addendums,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    setActionError(null);
    setConfirmDeleteId(null);
    try {
      await onDeleteInvestment(assetId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleInstallmentPaid = async (
    assetId: string,
    monthKey: string,
    component?: InvestmentComponentKey
  ) => {
    setActionError(null);
    const busyKey = `${assetId}:${monthKey}:${component ?? 'all'}`;
    setBusyInstallmentKey(busyKey);
    try {
      await onTogglePaidMonth(assetId, monthKey, component);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyInstallmentKey((prev) => (prev === busyKey ? null : prev));
    }
  };

  const handleSelectInstallmentStatusColor = async (
    asset: InvestmentAsset,
    monthKey: string,
    color: 'green' | 'red',
    amount: number,
    isCurrentlyPaid: boolean,
    component?: InvestmentComponentKey
  ) => {
    const compText = formatInvestmentComponentShortLabel(component);
    if (color === 'red') {
      const compKey = component
        ? buildInvestmentComponentPeriodKey(monthKey, component)
        : monthKey;
      setRescheduleModal({
        asset,
        monthKey,
        component,
        amount,
        label: `${compText} · ${asset.name} (${formatBossMonthShortLabel(monthKey)})`,
        initialTargetMonthKey:
          asset.rescheduledMonths?.[compKey] ??
          (!hasInvestmentComponentEntriesForMonth(
            [
              ...(Array.isArray(asset.paidMonths) ? asset.paidMonths : []),
              ...Object.keys(asset.monthStatuses ?? {}),
              ...Object.keys(asset.monthStatusWarnas ?? {}),
              ...Object.keys(asset.rescheduledMonths ?? {}),
            ],
            monthKey
          )
            ? asset.rescheduledMonths?.[monthKey]
            : undefined),
      });
      return;
    }
    setActionError(null);
    const busyKey = `${asset.id}:${monthKey}:${component ?? 'all'}`;
    setBusyInstallmentKey(busyKey);
    try {
      if (onSetMonthStatusWarna) {
        await onSetMonthStatusWarna(asset.id, monthKey, 'green', undefined, component);
      } else if (!isCurrentlyPaid) {
        await onTogglePaidMonth(asset.id, monthKey, component);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyInstallmentKey((prev) => (prev === busyKey ? null : prev));
    }
  };

  const handleCancelInstallmentPending = async (
    asset: InvestmentAsset,
    monthKey: string,
    component?: InvestmentComponentKey
  ) => {
    if (!onSetMonthStatusWarna) return;
    setActionError(null);
    const busyKey = `${asset.id}:${monthKey}:${component ?? 'all'}`;
    setBusyInstallmentKey(busyKey);
    try {
      await onSetMonthStatusWarna(asset.id, monthKey, 'white', undefined, component);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyInstallmentKey((prev) => (prev === busyKey ? null : prev));
    }
  };

  const handleConfirmInstallmentReschedule = async (targetMonthKey: string) => {
    if (rescheduleCopyModal && onRescheduledCopyAction) {
      const { monthKey, item } = rescheduleCopyModal;
      const busyKey = `copy:${monthKey}:${item.id}`;
      setActionError(null);
      setBusyInstallmentKey(busyKey);
      try {
        await onRescheduledCopyAction(monthKey, item.id, 'red', targetMonthKey);
        setRescheduleCopyModal(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyInstallmentKey((prev) => (prev === busyKey ? null : prev));
      }
      return;
    }
    if (!rescheduleModal) return;
    const { asset, monthKey, component } = rescheduleModal;
    setActionError(null);
    const busyKey = `${asset.id}:${monthKey}:${component ?? 'all'}`;
    setBusyInstallmentKey(busyKey);
    try {
      if (onSetMonthStatusWarna) {
        await onSetMonthStatusWarna(asset.id, monthKey, 'red', targetMonthKey, component);
      }
      setRescheduleModal(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyInstallmentKey((prev) => (prev === busyKey ? null : prev));
    }
  };

  const openDetailModal = (
    assetId: string,
    tab: 'schedule' | 'addendums' | 'history' = 'schedule'
  ) => {
    setDetailAssetId(assetId);
    setDetailTab(tab);
  };

  const openImportCsvModal = () => {
    setImportSuccessMessage('');
    setImportErrorMessage('');
    setShowImportModal(true);
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportSuccessMessage('');
    setImportErrorMessage('');
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvRawText(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmCsvImport = async () => {
    if (!csvValidation || !csvValidation.valid || !onImportCsv) return;
    setImportingCsv(true);
    setImportErrorMessage('');
    try {
      const res = await onImportCsv(
        csvValidation.rows.map((r) => ({ id: r.deterministicId, input: r.input })),
        { replaceExisting: replaceExistingOnImport }
      );
      setStatusFilter('All');
      setSearchQuery('');
      setImportSuccessMessage(
        `${res.count} kontrak berhasil diimport ke Supabase (Total Pinjaman Rp ${formatIDR(
          csvValidation.totalPrincipal
        )} · Total Bunga/Bln Rp ${formatIDR(csvValidation.totalMonthlyInterest)}).`
      );
      setShowImportModal(false);
    } catch (err) {
      setImportErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900">
            Jadwal Pembayaran Bunga Investor — PT Kreatif Kebanggaan Bangsa
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pencairan pinjaman masuk ke <strong>Cash In</strong> di bulan Tgl Kontrak.{' '}
            <strong>Pokok + Bunga/Denda + Bonus</strong> mulai masuk ke{' '}
            <strong>Projection · Cash Out Investment</strong> 1 bulan setelah Tgl Kontrak dan tetap berjalan selama Pokok belum lunas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setSelectedMonthKey(addMonthsToKey(selectedMonthKey, -1))}
              className="px-2 py-1.5 text-slate-600 hover:bg-slate-100 border-r border-slate-200 cursor-pointer"
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={selectedMonthKey}
              onChange={(e) => setSelectedMonthKey(e.target.value)}
              aria-label="Pilih bulan cicilan investasi"
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-900 bg-white focus:outline-none cursor-pointer"
            >
              {monthOptions.map((opt) => (
                <option key={opt.monthKey} value={opt.monthKey}>
                  {opt.fullLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSelectedMonthKey(addMonthsToKey(selectedMonthKey, 1))}
              className="px-2 py-1.5 text-slate-600 hover:bg-slate-100 border-l border-slate-200 cursor-pointer"
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {canEdit && onImportCsv && (
            <button
              type="button"
              onClick={openImportCsvModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import CSV
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={openNewForm}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Kontrak Investor
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-red-900"
        >
          <span className="font-semibold break-all">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-700 hover:text-red-950 font-semibold shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {importSuccessMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-900">
          <span className="font-semibold">{importSuccessMessage}</span>
          <button
            type="button"
            onClick={() => setImportSuccessMessage('')}
            className="text-emerald-700 hover:text-emerald-950 font-semibold cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Ringkasan KPI Portfolio */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500">Total Nilai Pinjaman</p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            Rp {formatIDR(tableTotals.totalNilaiPinjaman)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {tableTotals.activeCount} Aktif · {tableTotals.paidCount} Lunas · Sisa Pokok Rp{' '}
            {formatIDR(tableTotals.totalEstimasiSisaPokok)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500">Total Bunga Per Bulan</p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-blue-800 mt-1.5">
            Rp {formatIDR(tableTotals.totalBungaPerBulan)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            Tagihan {formatBossMonthShortLabel(selectedMonthKey)}: Rp{' '}
            {formatIDR(tableTotals.dueThisMonth)}
          </p>
        </div>

        <div className="bg-white border border-indigo-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-indigo-800">Total Bonus Kontrak</p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-indigo-700 mt-1.5">
            Rp {formatIDR(tableTotals.totalBonus)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Masuk Cash Out Investment di Tgl Bonus Dicairkan
          </p>
        </div>

        <div
          className={`border rounded-xl p-4 ${
            tableTotals.totalPokokJatuhTempoBelumDibayar > 0
              ? 'bg-red-50 border-red-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <p
            className={`text-xs font-semibold ${
              tableTotals.totalPokokJatuhTempoBelumDibayar > 0
                ? 'text-red-800'
                : 'text-slate-500'
            }`}
          >
            Pokok Jatuh Tempo Belum Dibayar
          </p>
          <p
            className={`text-lg sm:text-xl font-bold font-mono tabular-nums mt-1.5 ${
              tableTotals.totalPokokJatuhTempoBelumDibayar > 0
                ? 'text-red-700'
                : 'text-slate-900'
            }`}
          >
            Rp {formatIDR(tableTotals.totalPokokJatuhTempoBelumDibayar)}
          </p>
          <p
            className={`text-[11px] mt-1 ${
              tableTotals.totalPokokJatuhTempoBelumDibayar > 0
                ? 'text-red-700 font-semibold'
                : 'text-slate-500'
            }`}
          >
            {tableTotals.totalPokokJatuhTempoBelumDibayar > 0
              ? 'Masuk Projection + Bunga terus berjalan'
              : 'Tidak ada tunggakan pokok jatuh tempo'}
          </p>
        </div>
      </div>

      {/* Form Tambah / Edit Kontrak Investor */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-300 rounded-xl p-5 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {editingAsset ? 'Edit Kontrak Investor' : 'Tambah Kontrak Investor Baru'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Lengkapi data sesuai kolom Jadwal Pembayaran Bunga Investor.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1 text-slate-400 hover:text-slate-800 rounded cursor-pointer"
              aria-label="Tutup form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-800 font-medium break-all"
            >
              Gagal menyimpan ke Supabase: {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                No. Kontrak *
              </label>
              <input
                type="text"
                required
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="Contoh: WB-KKB.01.I/2026"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Investor *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Wimboyono"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tgl Kontrak *
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Periode (Bulan) *
              </label>
              <input
                type="number"
                required
                min={1}
                max={360}
                value={tenorMonths}
                onChange={(e) => handleTenorChange(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tgl. Bayar Bunga (1–31, opsional)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                placeholder="Kosongkan jika tidak ada"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Tgl Jatuh Tempo *
                </label>
                {endDateManuallyEdited && (
                  <button
                    type="button"
                    onClick={() => {
                      setEndDateManuallyEdited(false);
                      const nextEnd = computeLoanEndDate(startDate, formLiveCalc.n);
                      setEndDate(nextEnd);
                      if (!bonusDateManuallyEdited) {
                        setBonusDate(nextEnd);
                      }
                    }}
                    className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Auto-hitung
                  </button>
                )}
              </div>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => handleEndDateManualChange(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nilai Pinjaman (Rp) *
              </label>
              <div className="relative">
                <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  required
                  value={principalAmount}
                  onValueChange={setPrincipalAmount}
                  placeholder="Contoh: 250.000.000"
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {paymentMethod === 'ANUITAS'
                    ? 'Angsuran (Rp) *'
                    : interestInputType === 'PERCENT'
                    ? 'Bunga Per Bulan (%) *'
                    : 'Bunga Per Bulan (Rp) *'}
                </label>
                {paymentMethod === 'BALLOON' && (
                  <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => setInterestInputType('RP')}
                      className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                        interestInputType === 'RP'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Rp
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterestInputType('PERCENT')}
                      className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                        interestInputType === 'PERCENT'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      %
                    </button>
                  </div>
                )}
              </div>
              {paymentMethod === 'ANUITAS' || interestInputType === 'RP' ? (
                <div className="relative">
                  <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    Rp
                  </span>
                  <RupiahInput
                    required
                    value={monthlyInterestAmountStr}
                    onValueChange={setMonthlyInterestAmountStr}
                    placeholder={
                      paymentMethod === 'ANUITAS'
                        ? 'Contoh: 62.000.000'
                        : 'Contoh: 3.000.000'
                    }
                    className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="number"
                    required
                    min={0}
                    max={100}
                    step="any"
                    value={monthlyInterestRateStr}
                    onChange={(e) => setMonthlyInterestRateStr(e.target.value)}
                    placeholder="Contoh: 2.5"
                    className="w-full pl-3 pr-20 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                  <span className="text-xs font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    % / bln
                  </span>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                {paymentMethod === 'ANUITAS'
                  ? formLiveCalc.P > 0 || Number(monthlyInterestAmountStr) > 0
                    ? `Total Angsuran/bln (Pokok Rp ${formatIDR(
                        formLiveCalc.fixedPokok
                      )} + Bunga Rp ${formatIDR(formLiveCalc.interestRp)})`
                    : 'Total Angsuran/bln (Pokok Rp 41.666.667 + Bunga Rp 20.333.333)'
                  : interestInputType === 'PERCENT'
                  ? `Bunga per bulan saja, Pokok dibayar di akhir (Rp ${formatIDR(
                      formLiveCalc.interestRp
                    )}/bln)`
                  : 'Bunga per bulan saja, Pokok dibayar di akhir'}
              </p>
            </div>
          </div>

          {/* Keterangan / Metode + Bonus + Tgl Bonus + Denda Keterlambatan */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Keterangan / Metode Pembayaran *
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...INVESTMENT_PAYMENT_METHODS].reverse().map((opt) => {
                  const selected = paymentMethod === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPaymentMethod(opt.value)}
                      className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                        selected
                          ? 'bg-white border-blue-800 ring-1 ring-blue-800 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs sm:text-sm font-bold text-slate-900">
                          {opt.label}
                        </span>
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                            selected
                              ? 'border-blue-800 bg-blue-800'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        {opt.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
              {/* Bonus [Rp | %] */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-semibold text-slate-700">Bonus</label>
                  <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => setBonusInputType('RP')}
                      className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                        bonusInputType === 'RP'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Rp
                    </button>
                    <button
                      type="button"
                      onClick={() => setBonusInputType('PERCENT')}
                      className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                        bonusInputType === 'PERCENT'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      %
                    </button>
                  </div>
                </div>
                {bonusInputType === 'RP' ? (
                  <div className="relative">
                    <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      Rp
                    </span>
                    <RupiahInput
                      value={bonusAmountStr}
                      onValueChange={setBonusAmountStr}
                      placeholder="0"
                      className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={bonusRateStr}
                      onChange={(e) => setBonusRateStr(e.target.value)}
                      placeholder="Contoh: 5"
                      className="w-full pl-3 pr-24 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                    <span className="text-xs font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      % Pokok
                    </span>
                  </div>
                )}
                <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                  Nominal Bonus: Rp {formatIDR(formLiveCalc.effectiveBonusRp)}
                </p>
              </div>

              {/* Tgl Bonus Dicairkan */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Tgl Bonus Dicairkan
                  </label>
                  {bonusDateManuallyEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setBonusDateManuallyEdited(false);
                        setBonusDate(endDate);
                      }}
                      className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      Samakan Tgl JT
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={bonusDate}
                  onChange={(e) => {
                    setBonusDateManuallyEdited(true);
                    setBonusDate(e.target.value);
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Default = Tgl Jatuh Tempo ({formatDDMMMYYYYDash(endDate)})
                </p>
              </div>

              {/* Denda Keterlambatan [Rp | % per Bulan] */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Denda Keterlambatan (per Bulan)
                  </label>
                  <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => setLateFeeInputType('RP')}
                      className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                        lateFeeInputType === 'RP'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Rp
                    </button>
                    <button
                      type="button"
                      onClick={() => setLateFeeInputType('PERCENT')}
                      className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer transition-colors ${
                        lateFeeInputType === 'PERCENT'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      %
                    </button>
                  </div>
                </div>
                {lateFeeInputType === 'RP' ? (
                  <div className="relative">
                    <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      Rp
                    </span>
                    <RupiahInput
                      value={lateFeePerMonthAmountStr}
                      onValueChange={setLateFeePerMonthAmountStr}
                      placeholder="0"
                      className="w-full pl-9 pr-16 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                    <span className="text-[11px] font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      / bulan
                    </span>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={lateFeePerMonthRateStr}
                      onChange={(e) => setLateFeePerMonthRateStr(e.target.value)}
                      placeholder="0"
                      className="w-full pl-3 pr-22 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                    <span className="text-xs font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      % / bulan
                    </span>
                  </div>
                )}
                <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                  {lateFeeInputType === 'RP'
                    ? `Jika telat N bln = Rp ${formatIDR(formLiveCalc.lateFeeRp)} × N`
                    : `Auto: Rp ${formatIDR(formLiveCalc.firstMonthLateFee)} / bulan`}
                </p>
              </div>
            </div>

            {editingAsset && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Status Kontrak
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as InvestmentStatus)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  >
                    <option value="Aktif">Aktif Berjalan</option>
                    <option value="Lunas">Lunas</option>
                    <option value="Ditunda">Ditunda</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Catatan Tambahan
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Keterangan opsional..."
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Simulasi Breakdown Preview */}
          {formLiveCalc.schedule.length > 0 && formLiveCalc.P > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
                <span className="text-xs font-bold text-slate-800">
                  Simulasi Jadwal Cicilan ({formLiveCalc.schedule.length} baris · Mulai 1 bulan setelah Tgl Kontrak)
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-600">
                  Total Pokok: Rp{' '}
                  {formatIDR(formLiveCalc.schedule.reduce((s, r) => s + r.principalPaid, 0))} ·
                  Total Bunga: Rp{' '}
                  {formatIDR(formLiveCalc.schedule.reduce((s, r) => s + r.interestPaid, 0))}
                  {formLiveCalc.effectiveBonusRp > 0 &&
                    ` · Bonus: Rp ${formatIDR(formLiveCalc.effectiveBonusRp)}`}
                </span>
              </div>
              <div className="overflow-x-auto max-h-52 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Bulan</th>
                      <th className="py-2 px-3 font-semibold text-right">Pokok yang Dibayar</th>
                      <th className="py-2 px-3 font-semibold text-right">
                        Bunga / Denda yang Dibayar
                      </th>
                      <th className="py-2 px-3 font-semibold text-center">Bulan Terlambat</th>
                      <th className="py-2 px-3 font-semibold text-right">Bonus</th>
                      <th className="py-2 px-3 font-semibold text-right">Total Cicilan</th>
                      <th className="py-2 px-3 font-semibold text-right">Sisa Pokok</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {formLiveCalc.schedule.map((row) => (
                      <tr
                        key={`${row.installmentNumber}-${row.monthKey}`}
                        className={
                          row.isLate
                            ? 'bg-red-50/40'
                            : row.isBonusMonth
                            ? 'bg-indigo-50/40'
                            : 'hover:bg-slate-50'
                        }
                      >
                        <td className="py-1.5 px-3 font-sans text-slate-800 whitespace-nowrap">
                          {row.isBonusOnlyRow
                            ? 'Bonus'
                            : row.isMaturityRow
                            ? 'Akhir Tenor'
                            : `#${row.installmentNumber}`}{' '}
                          · {formatBossMonthShortLabel(row.monthKey)}
                        </td>
                        <td className="py-1.5 px-3 text-right text-sky-800">
                          Rp {formatIDR(row.principalPaid)}
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          {row.isLate ? (
                            <span className="text-red-700 font-bold">
                              Rp {formatIDR(row.lateFeeAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-900">
                              Rp {formatIDR(row.interestPaid)}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-center font-sans">
                          {row.monthsLate > 0 ? (
                            <span className="font-bold text-red-700">
                              {row.monthsLate} bln
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right text-indigo-700">
                          {row.bonusPaid > 0 ? `Rp ${formatIDR(row.bonusPaid)}` : '-'}
                        </td>
                        <td className="py-1.5 px-3 text-right font-bold text-slate-900">
                          Rp {formatIDR(row.totalInstallmentWithLateFee)}
                        </td>
                        <td className="py-1.5 px-3 text-right text-slate-600">
                          Rp {formatIDR(row.remainingPrincipalAfter)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              {saving
                ? 'Menyimpan...'
                : editingAsset
                ? 'Simpan Perubahan'
                : 'Simpan Kontrak Investor'}
            </button>
          </div>
        </form>
      )}

      {/* Search & Status Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari No. Kontrak atau Nama Investor..."
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-800"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['All', 'Aktif', 'Lunas', 'Ditunda'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'All' ? 'Semua' : tab}
            </button>
          ))}
        </div>
      </div>

      {/* Info Periode Bunga Aktif (menggunakan investmentPeriod khusus menu Investment) */}
      <div className="bg-blue-50/70 border border-blue-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-700">
          Cutoff:{' '}
          <strong className="text-slate-900">
            {formatBossMonthFullLabel(selectedMonthKey)}
          </strong>{' '}
          - Bunga dihitung untuk periode{' '}
          <strong className="text-slate-900">
            {formatBossMonthFullLabel(selectedMonthKey)}
          </strong>{' '}
          ke atas. Periode sebelumnya dianggap lunas.
        </p>
        <span className="text-[11px] text-slate-500">
          Pokok tetap ditagih sampai Lunas.
        </span>
      </div>

      {/* TABEL LIST INVESTMENT (13 Kolom Persis Spreadsheet Jadwal Pembayaran Bunga Investor) */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="h-10 bg-slate-100 rounded animate-pulse" />
          <div className="h-12 bg-slate-50 rounded animate-pulse" />
          <div className="h-12 bg-slate-50 rounded animate-pulse" />
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 px-6 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            {investments.length === 0
              ? 'Belum ada kontrak investor yang tercatat'
              : 'Tidak ada kontrak yang cocok dengan filter pencarian'}
          </p>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            Tambahkan kontrak pembayaran bunga investor (Pokok di Akhir maupun Pokok + Bunga).
            Semua Pokok, Bunga/Denda, dan Bonus otomatis terintegrasi ke Projection · Cash Out Investment.
          </p>
          {canEdit && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onImportCsv && (
                <button
                  type="button"
                  onClick={openImportCsvModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import CSV
                </button>
              )}
              <button
                type="button"
                onClick={openNewForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-900 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Kontrak Investor
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-blue-800 text-white border-b border-blue-900">
                  <th className="py-2.5 px-2.5 font-semibold text-center whitespace-nowrap border-r border-blue-700/60">
                    No
                  </th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap border-r border-blue-700/60">
                    No. Kontrak
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap border-r border-blue-700/60">
                    Tgl Kontrak
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap border-r border-blue-700/60">
                    Periode
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap border-r border-blue-700/60">
                    Tgl. Bayar Bunga
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap border-r border-blue-700/60">
                    Tgl Jatuh Tempo
                  </th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap border-r border-blue-700/60">
                    Nama Investor
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap border-r border-blue-700/60">
                    Nilai Pinjaman
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap border-r border-blue-700/60">
                    Bunga Per Bulan
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap border-r border-blue-700/60">
                    Bonus
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap border-r border-blue-700/60">
                    Tgl Bonus Dicairkan
                  </th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap border-r border-blue-700/60">
                    Keterangan
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredAssets.map((asset, idx) => {
                  const startISO = getEffectiveAssetStartDate(asset);
                  const endISO = getEffectiveAssetEndDate(asset);
                  const bonusRp = getEffectiveAssetBonusAmount(asset);
                  const bonusDateISO = getEffectiveAssetBonusDate(asset);
                  const bungaPerBulanRp = getAssetTableMonthlyBunga(asset);
                  const addendumCount = asset.addendums?.length ?? 0;
                  const effectiveRemainingPrincipal = getEffectiveInvestmentRemainingPrincipal(
                    asset,
                    bossReportMonths,
                    { todayISO }
                  );
                  const isOverdueUnpaid = Boolean(
                    asset.status === 'Aktif' &&
                      endISO < todayISO &&
                      effectiveRemainingPrincipal > 0
                  );
                  const overdueMonths = isOverdueUnpaid
                    ? diffCalendarMonthsOverdue(endISO, todayISO)
                    : 0;
                  const isLunas = asset.status === 'Lunas' || effectiveRemainingPrincipal === 0;
                  const componentStatuses: Array<{
                    component: InvestmentComponentKey;
                    label: string;
                    isPending: boolean;
                    targetMonth?: string;
                  }> = (
                    [
                      { component: 'principal' as const, label: 'Pokok' },
                      { component: 'interest' as const, label: 'Bunga' },
                      { component: 'lateFee' as const, label: 'Denda' },
                      { component: 'bonus' as const, label: 'Bonus' },
                    ] as const
                  ).map((entry) => {
                    const st = resolveAssetComponentUiStatus({
                      asset,
                      monthKey: selectedMonthKey,
                      component: entry.component,
                      bossReportMonths,
                    });
                    return {
                      component: entry.component,
                      label: entry.label,
                      isPending: st.isPending,
                      targetMonth: st.rescheduledToMonth,
                    };
                  });
                  const pendingComponents = componentStatuses.filter((c) => c.isPending);
                  const selectedMonthCopies = (bossReportMonths?.[selectedMonthKey]?.rescheduledIn ?? []).filter(
                    (c) =>
                      c.section === 'investment' &&
                      c.sourceCategory === 'investment' &&
                      c.color !== 'red' &&
                      (c.investmentAssetId === asset.id || c.sourceId.includes(asset.id))
                  );

                  return (
                    <tr
                      key={asset.id}
                      className={
                        isLunas
                          ? 'bg-emerald-50/50 hover:bg-emerald-50'
                          : isOverdueUnpaid
                          ? 'bg-red-50/35 hover:bg-red-50/60'
                          : idx % 2 === 0
                          ? 'bg-white hover:bg-sky-50/70'
                          : 'bg-sky-50/55 hover:bg-sky-100/60'
                      }
                    >
                      <td className="py-2.5 px-2.5 text-center font-mono tabular-nums text-slate-600 border-r border-slate-200/70">
                        {idx + 1}
                      </td>

                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap border-r border-slate-200/70">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{asset.contractNumber?.trim() || '-'}</span>
                          {isLunas && (
                            <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Lunas
                            </span>
                          )}
                          {asset.status === 'Ditunda' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold rounded bg-amber-100 text-amber-800 border border-amber-200">
                              Ditunda
                            </span>
                          )}
                          {pendingComponents.map((pComp) => (
                            <span
                              key={`pend-${asset.id}-${pComp.component}`}
                              className="px-1.5 py-0.5 text-[10px] font-sans font-bold rounded bg-slate-200 text-slate-700 border border-slate-300"
                            >
                              {pComp.label.toUpperCase()}{' '}
                              {pComp.targetMonth
                                ? `DIPENDING KE ${formatBossMonthFullLabel(pComp.targetMonth)}`
                                : 'DIPENDING'}
                            </span>
                          ))}
                          {selectedMonthCopies.map((copy) => {
                            const copyDueStatus = computeDueTunggakanStatus({
                              dueISO: copy.dueISO,
                              originMonthKey: copy.originMonthKey,
                              isPaid: copy.color === 'green',
                            });
                            return (
                              <span
                                key={`copy-badge-${copy.id}`}
                                className={`px-1.5 py-0.5 text-[10px] font-sans font-semibold rounded border ${
                                  copyDueStatus.isTunggakan
                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                    : 'bg-slate-100 text-slate-700 border-slate-300'
                                }`}
                              >
                                {formatInvestmentComponentShortLabel(copy.investmentComponent)}{' '}
                                {copyDueStatus.statusText}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-700 whitespace-nowrap border-r border-slate-200/70">
                        {formatDDMMMYYYYDash(startISO)}
                      </td>

                      <td className="py-2.5 px-3 text-center font-medium text-slate-800 whitespace-nowrap border-r border-slate-200/70">
                        {asset.tenorMonths} Bulan
                      </td>

                      <td className="py-2.5 px-3 text-center text-slate-700 whitespace-nowrap border-r border-slate-200/70">
                        {asset.dueDay ? `Tanggal ${asset.dueDay}` : '-'}
                      </td>

                      <td className="py-2.5 px-3 text-center font-mono tabular-nums whitespace-nowrap border-r border-slate-200/70">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={
                              isOverdueUnpaid
                                ? 'font-bold text-red-700'
                                : 'text-slate-700'
                            }
                          >
                            {formatDDMMMYYYYDash(endISO)}
                          </span>
                          {isOverdueUnpaid && overdueMonths > 0 && (
                            <span className="mt-0.5 px-1.5 py-0.5 text-[9px] font-sans font-bold rounded bg-red-600 text-white">
                              JT · +{overdueMonths} bln
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap border-r border-slate-200/70">
                        {asset.name}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap border-r border-slate-200/70">
                        Rp {formatIDR(asset.principalAmount)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-blue-900 whitespace-nowrap border-r border-slate-200/70">
                        Rp {formatIDR(bungaPerBulanRp)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-indigo-800 whitespace-nowrap border-r border-slate-200/70">
                        {bonusRp > 0 ? `Rp ${formatIDR(bonusRp)}` : '-'}
                      </td>

                      <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-700 whitespace-nowrap border-r border-slate-200/70">
                        {bonusRp > 0 ? formatDDMMMYYYYDash(bonusDateISO) : '-'}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap border-r border-slate-200/70">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-slate-700 font-medium">
                            {asset.paymentMethod === 'ANUITAS' ? 'Pokok + Bunga' : '-'}
                          </span>
                          {addendumCount > 0 && (
                            <button
                              type="button"
                              onClick={() => openDetailModal(asset.id, 'addendums')}
                              className="inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 cursor-pointer"
                              title="Lihat riwayat adendum"
                            >
                              Adendum {addendumCount}x
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-2 px-2.5 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditForm(asset)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded cursor-pointer"
                              title="Edit kontrak"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                          )}

                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setAddendumTargetAsset(asset)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded cursor-pointer"
                              title="Adendum / perpanjangan kontrak"
                            >
                              <FilePlus2 className="w-3 h-3" />
                              Adendum
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openDetailModal(asset.id, 'schedule')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded cursor-pointer"
                            title="Detail jadwal & riwayat adendum"
                          >
                            <Eye className="w-3 h-3" />
                            Detail
                          </button>

                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleMarkLunas(asset)}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold border rounded cursor-pointer ${
                                isLunas
                                  ? 'text-slate-700 bg-slate-100 border-slate-300 hover:bg-slate-200'
                                  : 'text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                              }`}
                              title={
                                isLunas
                                  ? 'Kembalikan ke Aktif'
                                  : 'Tandai Lunas (hentikan bunga bulan berikutnya)'
                              }
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {isLunas ? 'Aktifkan' : 'Tandai Lunas'}
                            </button>
                          )}

                          {canEdit &&
                            (confirmDeleteId === asset.id ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteAsset(asset.id)}
                                onMouseLeave={() => setConfirmDeleteId(null)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              >
                                Yakin Hapus?
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(asset.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded cursor-pointer"
                                title="Hapus kontrak"
                              >
                                <Trash2 className="w-3 h-3" />
                                Hapus
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-blue-900 text-white font-bold border-t-2 border-blue-950">
                  <td
                    colSpan={7}
                    className="py-3 px-3 text-right uppercase tracking-wide text-xs border-r border-blue-800"
                  >
                    TOTAL ({filteredAssets.length} KONTRAK)
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap border-r border-blue-800">
                    Rp {formatIDR(tableTotals.totalNilaiPinjaman)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap border-r border-blue-800">
                    Rp {formatIDR(tableTotals.totalBungaPerBulan)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap border-r border-blue-800">
                    {tableTotals.totalBonus > 0
                      ? `Rp ${formatIDR(tableTotals.totalBonus)}`
                      : '-'}
                  </td>
                  <td colSpan={3} className="py-3 px-3 text-xs font-normal text-blue-100">
                    Semua komponen otomatis masuk ke Projection · Cash Out Investment
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Menampilkan{' '}
              <strong className="text-slate-900 font-semibold">
                {filteredAssets.length === 0 ? '0' : `1-${filteredAssets.length}`}
              </strong>{' '}
              dari <strong className="text-slate-900 font-semibold">{investments.length}</strong>{' '}
              kontrak
            </span>
            {(statusFilter !== 'All' || searchQuery.trim() !== '') && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('All');
                  setSearchQuery('');
                }}
                className="text-blue-700 hover:underline font-semibold cursor-pointer"
              >
                Reset Filter (Tampilkan Semua)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal Detail Kontrak (Tabs: Jadwal Pembayaran & Breakdown | Riwayat Adendum | Riwayat Pembayaran) */}
      {detailAsset && (() => {
        const schedule = buildInvestmentSchedule(detailAsset, {
          todayISO,
          cutoffDateOverride: activeCutoffGlobalDate,
        });
        const portfolioTotals = computeInvestmentPortfolioTotals(detailAsset, {
          todayISO,
          cutoffDateOverride: activeCutoffGlobalDate,
        });
        const effectiveRemainingPrincipal = getEffectiveInvestmentRemainingPrincipal(
          detailAsset,
          bossReportMonths,
          { todayISO }
        );
        const paymentHistory = getInvestmentPaymentHistory(
          detailAsset.id,
          auditLogs,
          loadProjectionRevisions()
        );
        const effectiveStart = getEffectiveAssetStartDate(detailAsset);
        const effectiveEnd = getEffectiveAssetEndDate(detailAsset);
        const effectiveEndMonthKey = effectiveEnd.slice(0, 7);
        const addendumCount = detailAsset.addendums?.length ?? 0;
        const originalSnapshot = detailAsset.originalContract;
        const stMeta = INVESTMENT_STATUS_META[detailAsset.status];
        const isPostMaturityUnpaid = Boolean(
          detailAsset.status === 'Aktif' &&
            effectiveEnd < todayISO &&
            effectiveRemainingPrincipal > 0
        );

        return (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3 sm:p-5"
          >
            <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      {detailAsset.contractNumber?.trim() || detailAsset.name}
                    </h3>
                    <span className="text-sm font-semibold text-slate-600">
                      — {detailAsset.name}
                    </span>
                    <span
                      className={`inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded ${stMeta.badgeClass}`}
                    >
                      {stMeta.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    Nilai Pinjaman: Rp {formatIDR(detailAsset.principalAmount)} · Sisa Pokok: Rp{' '}
                    {formatIDR(effectiveRemainingPrincipal)} · Bunga/Bln: Rp{' '}
                    {formatIDR(getAssetTableMonthlyBunga(detailAsset))} · Tgl Kontrak:{' '}
                    {formatDDMMMYYYYDash(effectiveStart)} · Tgl Jatuh Tempo:{' '}
                    {formatDDMMMYYYYDash(effectiveEnd)} ({detailAsset.tenorMonths} Bulan)
                  </p>
                  <p className="mt-1 text-[11px] text-blue-800 font-semibold">
                    Cutoff: {formatBossMonthFullLabel(selectedMonthKey)} - Bunga dihitung untuk periode{' '}
                    {formatBossMonthFullLabel(selectedMonthKey)} ke atas. Periode sebelumnya dianggap lunas.
                  </p>
                  {isPostMaturityUnpaid && (
                    <p className="mt-1.5 text-[11px] font-semibold text-red-700">
                      Jatuh tempo telah lewat &amp; Pokok belum lunas — POKOK JATUH TEMPO (Rp{' '}
                      {formatIDR(effectiveRemainingPrincipal)}) dan Bunga Per Bulan tetap muncul
                      setiap bulan di Projection sampai dilunasi.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setDetailAssetId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg cursor-pointer"
                  aria-label="Tutup detail"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs Bar */}
              <div className="px-5 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setDetailTab('schedule')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                      detailTab === 'schedule'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    Jadwal Pembayaran &amp; Breakdown ({schedule.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('addendums')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                      detailTab === 'addendums'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    Riwayat Adendum ({addendumCount + 1})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('history')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                      detailTab === 'history'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    Riwayat Pembayaran ({paymentHistory.length})
                  </button>
                </div>

                {canEdit && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAddendumTargetAsset(detailAsset)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FilePlus2 className="w-3.5 h-3.5" />
                      + Adendum Kontrak
                    </button>
                  </div>
                )}
              </div>

              {/* Modal Body */}
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                {detailTab === 'schedule' ? (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-800">
                        Rincian Jadwal ({schedule.length} baris)
                      </span>
                      <span className="font-mono tabular-nums text-slate-600">
                        Terbayar: Pokok Rp {formatIDR(portfolioTotals.paidPrincipal)} · Bunga Rp{' '}
                        {formatIDR(portfolioTotals.paidInterest)}
                        {portfolioTotals.totalLateFeesAccrued > 0 && (
                          <span className="text-red-700 font-semibold ml-1">
                            · Denda Rp {formatIDR(portfolioTotals.totalLateFeesAccrued)}
                          </span>
                        )}
                        {portfolioTotals.totalBonusPayable > 0 && (
                          <span className="text-indigo-700 font-semibold ml-1">
                            · Bonus Rp {formatIDR(portfolioTotals.totalBonusPayable)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">Bulan</th>
                            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                              Pokok yang Dibayar
                            </th>
                            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                              Bunga / Denda yang Dibayar
                            </th>
                            <th className="py-2 px-3 font-semibold text-center whitespace-nowrap">
                              Bulan Terlambat
                            </th>
                            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                              Bonus
                            </th>
                            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                              Total Cicilan
                            </th>
                            <th className="py-2 px-3 font-semibold text-right whitespace-nowrap">
                              Sisa Pokok
                            </th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {schedule.map((row) => {
                            const isRowLate = row.isLate;
                            const interestCompKind: InvestmentComponentKey = isRowLate
                              ? 'lateFee'
                              : 'interest';
                            const interestOrFeeAmount = isRowLate
                              ? row.lateFeeAmount
                              : row.interestPaid;

                            const pokokStatus =
                              row.principalPaid > 0
                                ? resolveAssetComponentUiStatus({
                                    asset: detailAsset,
                                    monthKey: row.monthKey,
                                    component: 'principal',
                                    isPaidFromSchedule: row.isPrincipalPaid,
                                    bossReportMonths,
                                  })
                                : {
                                    colorKey: 'white' as const,
                                    isPending: false,
                                    isPaid: false,
                                    rescheduledToMonth: undefined,
                                  };

                            const interestStatus =
                              interestOrFeeAmount > 0
                                ? resolveAssetComponentUiStatus({
                                    asset: detailAsset,
                                    monthKey: row.monthKey,
                                    component: interestCompKind,
                                    isPaidFromSchedule: row.isInterestPaid,
                                    bossReportMonths,
                                  })
                                : {
                                    colorKey: 'white' as const,
                                    isPending: false,
                                    isPaid: false,
                                    rescheduledToMonth: undefined,
                                  };

                            const bonusStatus =
                              row.bonusPaid > 0
                                ? resolveAssetComponentUiStatus({
                                    asset: detailAsset,
                                    monthKey: row.monthKey,
                                    component: 'bonus',
                                    isPaidFromSchedule: row.isBonusPaid,
                                    bossReportMonths,
                                  })
                                : {
                                    colorKey: 'white' as const,
                                    isPending: false,
                                    isPaid: false,
                                    rescheduledToMonth: undefined,
                                  };

                            const activeRowTotal =
                              (pokokStatus.isPending ? 0 : row.principalPaid) +
                              (interestStatus.isPending ? 0 : interestOrFeeAmount) +
                              (bonusStatus.isPending ? 0 : row.bonusPaid);
                            const hasAnyPendingInRow =
                              pokokStatus.isPending ||
                              interestStatus.isPending ||
                              bonusStatus.isPending;
                            const allActiveComponentsPending =
                              (row.principalPaid === 0 || pokokStatus.isPending) &&
                              (interestOrFeeAmount === 0 || interestStatus.isPending) &&
                              (row.bonusPaid === 0 || bonusStatus.isPending) &&
                              hasAnyPendingInRow;

                            const componentControls: Array<{
                              component: InvestmentComponentKey;
                              label: string;
                              amount: number;
                              status: ReturnType<typeof resolveAssetComponentUiStatus>;
                              dueBadgeLabel?: string;
                              dueBadgeClass?: string;
                            }> = [];

                            if (row.principalPaid > 0) {
                              const pBadge = getInstallmentDueBadge({
                                assetStatus: detailAsset.status,
                                dueISO: row.dueISO,
                                principalPaid: row.principalPaid,
                                isPaid: pokokStatus.isPaid,
                                paymentMethod: detailAsset.paymentMethod,
                                endMonthKey: effectiveEndMonthKey,
                                todayISO,
                                monthStatus: pokokStatus.isPending ? 'Reschedule' : undefined,
                                monthStatusWarna: pokokStatus.isPending ? 'MERAH' : undefined,
                                rescheduledToMonth: pokokStatus.rescheduledToMonth,
                              });
                              componentControls.push({
                                component: 'principal',
                                label: 'Pokok',
                                amount: row.principalPaid,
                                status: pokokStatus,
                                dueBadgeLabel: pBadge.label,
                                dueBadgeClass: pBadge.badgeClass,
                              });
                            }

                            if (interestOrFeeAmount > 0) {
                              const iBadge = getInstallmentDueBadge({
                                assetStatus: detailAsset.status,
                                dueISO: row.dueISO,
                                principalPaid: 0,
                                isPaid: interestStatus.isPaid,
                                paymentMethod: detailAsset.paymentMethod,
                                endMonthKey: effectiveEndMonthKey,
                                todayISO,
                                monthStatus: interestStatus.isPending ? 'Reschedule' : undefined,
                                monthStatusWarna: interestStatus.isPending ? 'MERAH' : undefined,
                                rescheduledToMonth: interestStatus.rescheduledToMonth,
                              });
                              componentControls.push({
                                component: interestCompKind,
                                label: isRowLate ? 'Denda' : 'Bunga',
                                amount: interestOrFeeAmount,
                                status: interestStatus,
                                dueBadgeLabel:
                                  !interestStatus.isPending && isRowLate
                                    ? formatLateBadgeText(row)
                                    : iBadge.label,
                                dueBadgeClass:
                                  !interestStatus.isPending && isRowLate
                                    ? 'bg-red-600 text-white border-red-700 font-bold'
                                    : iBadge.badgeClass,
                              });
                            }

                            if (row.bonusPaid > 0) {
                              const bBadge = getInstallmentDueBadge({
                                assetStatus: detailAsset.status,
                                dueISO: row.dueISO,
                                principalPaid: 0,
                                isPaid: bonusStatus.isPaid,
                                isBonusOnlyRow: true,
                                paymentMethod: detailAsset.paymentMethod,
                                endMonthKey: effectiveEndMonthKey,
                                todayISO,
                                monthStatus: bonusStatus.isPending ? 'Reschedule' : undefined,
                                monthStatusWarna: bonusStatus.isPending ? 'MERAH' : undefined,
                                rescheduledToMonth: bonusStatus.rescheduledToMonth,
                              });
                              componentControls.push({
                                component: 'bonus',
                                label: 'Bonus',
                                amount: row.bonusPaid,
                                status: bonusStatus,
                                dueBadgeLabel: bBadge.label,
                                dueBadgeClass: bBadge.badgeClass,
                              });
                            }

                            return (
                              <tr
                                key={`${row.installmentNumber}-${row.monthKey}`}
                                className={
                                  allActiveComponentsPending
                                    ? 'bg-slate-100/80 text-slate-400 opacity-85'
                                    : isRowLate && !interestStatus.isPending
                                    ? 'bg-red-50/50'
                                    : row.isBonusMonth
                                    ? 'bg-indigo-50/40'
                                    : 'hover:bg-slate-50'
                                }
                              >
                                <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                                  <div>
                                    {row.isBonusOnlyRow
                                      ? 'Pencairan Bonus'
                                      : row.isMaturityRow
                                      ? 'Pelunasan Akhir Tenor'
                                      : `#${row.installmentNumber}`}{' '}
                                    · {formatBossMonthShortLabel(row.monthKey)}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {row.isBonusOnlyRow ? 'Cair ' : 'JT '}
                                    {formatDDMMMYYYYDash(row.dueISO)}
                                    {row.addendumSequence
                                      ? ` · Adendum ${row.addendumSequence}`
                                      : ''}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums text-sky-800 whitespace-nowrap">
                                  {row.principalPaid > 0 && pokokStatus.isPending ? (
                                    <div className="inline-flex flex-col items-end">
                                      <span className="line-through text-slate-400">
                                        Rp {formatIDR(row.principalPaid)}
                                      </span>
                                      <span className="text-[10px] font-sans text-slate-500">
                                        Rp 0 (Pending)
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <span>Rp {formatIDR(row.principalPaid)}</span>
                                      {row.principalPaid > 0 && pokokStatus.isPaid && (
                                        <span className="px-1 py-0.2 text-[9px] font-sans font-bold rounded bg-emerald-100 text-emerald-700">
                                          Paid
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  {interestOrFeeAmount > 0 && interestStatus.isPending ? (
                                    <div className="inline-flex flex-col items-end">
                                      <span className="line-through text-slate-400">
                                        Rp {formatIDR(interestOrFeeAmount)}
                                      </span>
                                      <span className="text-[10px] font-sans text-slate-500">
                                        Rp 0 (Pending)
                                      </span>
                                    </div>
                                  ) : isRowLate ? (
                                    <div className="inline-flex flex-col items-end gap-0.5">
                                      <div className="inline-flex items-center gap-1.5">
                                        <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold rounded bg-red-600 text-white">
                                          TERLAMBAT {row.monthsLate} BULAN
                                        </span>
                                        <span className="text-red-700 font-bold">
                                          Rp {formatIDR(row.lateFeeAmount)}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-red-600 font-sans">
                                        Denda {row.monthsLate} bln × Rp{' '}
                                        {formatIDR(row.monthlyLateFee)} · Bunga Rp 0
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <span className="text-slate-900 font-medium">
                                        Rp {formatIDR(row.interestPaid)}
                                      </span>
                                      {row.interestPaid > 0 && interestStatus.isPaid && (
                                        <span className="px-1 py-0.2 text-[9px] font-sans font-bold rounded bg-emerald-100 text-emerald-700">
                                          Paid
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-center whitespace-nowrap">
                                  {row.monthsLate > 0 ? (
                                    <span className="font-bold text-red-700">
                                      {row.monthsLate} bulan
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  {row.bonusPaid > 0 ? (
                                    bonusStatus.isPending ? (
                                      <div className="inline-flex flex-col items-end">
                                        <span className="line-through text-slate-400">
                                          Rp {formatIDR(row.bonusPaid)}
                                        </span>
                                        <span className="text-[10px] font-sans text-slate-500">
                                          Rp 0 (Pending)
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="inline-flex items-center gap-1">
                                        <span className="font-bold text-indigo-700">
                                          Rp {formatIDR(row.bonusPaid)}
                                        </span>
                                        {bonusStatus.isPaid && (
                                          <span className="px-1 py-0.2 text-[9px] font-sans font-bold rounded bg-emerald-100 text-emerald-700">
                                            Paid
                                          </span>
                                        )}
                                      </div>
                                    )
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                                  {hasAnyPendingInRow ? (
                                    <div className="inline-flex flex-col items-end">
                                      <span className="line-through text-slate-400 font-normal">
                                        Rp {formatIDR(row.totalInstallmentWithLateFee)}
                                      </span>
                                      <span className="text-slate-700">
                                        Rp {formatIDR(activeRowTotal)}
                                      </span>
                                      <span className="text-[10px] font-sans font-normal text-slate-500">
                                        {allActiveComponentsPending
                                          ? 'Tidak dihitung di bulan ini'
                                          : 'Sebagian komponen dipending'}
                                      </span>
                                    </div>
                                  ) : (
                                    `Rp ${formatIDR(row.totalInstallmentWithLateFee)}`
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                  Rp {formatIDR(row.remainingPrincipalAfter)}
                                </td>
                                <td className="py-2 px-3 whitespace-nowrap">
                                  <div className="flex flex-col gap-1.5">
                                    {componentControls.map((ctrl) => {
                                      const busyKey = `${detailAsset.id}:${row.monthKey}:${ctrl.component}`;
                                      return (
                                        <div
                                          key={`${row.monthKey}-${ctrl.component}`}
                                          className="flex flex-wrap items-center gap-1.5"
                                        >
                                          <span className="inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200 min-w-[44px] justify-center">
                                            {ctrl.label}
                                          </span>
                                          {ctrl.status.isPending ? (
                                            <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold border rounded bg-slate-200 text-slate-700 border-slate-300">
                                              {ctrl.status.rescheduledToMonth
                                                ? `DIPENDING KE ${formatBossMonthFullLabel(
                                                    ctrl.status.rescheduledToMonth
                                                  )}`
                                                : 'DIPENDING'}
                                            </span>
                                          ) : ctrl.status.colorKey === 'white' &&
                                            ctrl.dueBadgeLabel ? (
                                            <span
                                              className={`inline-flex px-2 py-0.5 text-[10px] font-semibold border rounded ${
                                                ctrl.dueBadgeClass ??
                                                'bg-slate-100 text-slate-700 border-slate-200'
                                              }`}
                                            >
                                              {ctrl.dueBadgeLabel}
                                            </span>
                                          ) : null}
                                          {detailAsset.status !== 'Ditunda' ? (
                                            <>
                                              <StatusWarnaDropdown
                                                value={ctrl.status.colorKey}
                                                compact
                                                ariaLabel={`Status warna ${ctrl.label} ${detailAsset.name} ${row.monthKey}`}
                                                disabled={
                                                  !canEdit || busyInstallmentKey === busyKey
                                                }
                                                onSelect={(nextColor) => {
                                                  void handleSelectInstallmentStatusColor(
                                                    detailAsset,
                                                    row.monthKey,
                                                    nextColor,
                                                    ctrl.amount,
                                                    ctrl.status.isPaid,
                                                    ctrl.component
                                                  );
                                                }}
                                              />
                                              {ctrl.status.isPending &&
                                                canEdit &&
                                                onSetMonthStatusWarna && (
                                                  <button
                                                    type="button"
                                                    disabled={busyInstallmentKey === busyKey}
                                                    onClick={() =>
                                                      void handleCancelInstallmentPending(
                                                        detailAsset,
                                                        row.monthKey,
                                                        ctrl.component
                                                      )
                                                    }
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                                                  >
                                                    <RotateCcw className="w-3 h-3" />
                                                    Batalkan Pending / Kembalikan
                                                  </button>
                                                )}
                                            </>
                                          ) : (
                                            <span
                                              className={`inline-flex px-2 py-0.5 text-[10px] font-semibold border rounded ${
                                                ctrl.dueBadgeClass ??
                                                'bg-amber-50 text-amber-800 border-amber-200'
                                              }`}
                                            >
                                              {ctrl.dueBadgeLabel ?? 'Ditunda'}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {isPostMaturityUnpaid &&
                            selectedMonthKey > effectiveEndMonthKey &&
                            !schedule.some((s) => s.monthKey === selectedMonthKey) &&
                            (() => {
                              const monthsLateOverdue = diffCalendarMonthsOverdue(
                                effectiveEnd,
                                `${selectedMonthKey}-01`
                              );
                              const carryPokokAmt = effectiveRemainingPrincipal;
                              const carryPokokStatus = resolveAssetComponentUiStatus({
                                asset: detailAsset,
                                monthKey: selectedMonthKey,
                                component: 'principal',
                                bossReportMonths,
                              });
                              const carryDendaAmt = computeMonthlyInterestForBalance({
                                remainingPrincipal: effectiveRemainingPrincipal,
                                interestInputType: detailAsset.interestInputType,
                                monthlyInterestAmount: detailAsset.monthlyInterestAmount,
                                monthlyInterestRate: detailAsset.monthlyInterestRate,
                                paymentMethod: detailAsset.paymentMethod,
                                initialPrincipalBasis: detailAsset.principalAmount,
                              });
                              const carryDendaStatus =
                                carryDendaAmt > 0
                                  ? resolveAssetComponentUiStatus({
                                      asset: detailAsset,
                                      monthKey: selectedMonthKey,
                                      component: 'lateFee',
                                      bossReportMonths,
                                    })
                                  : {
                                      colorKey: 'white' as const,
                                      isPending: false,
                                      isPaid: false,
                                      rescheduledToMonth: undefined,
                                    };
                              const carryTotal =
                                (carryPokokStatus.isPending ? 0 : carryPokokAmt) +
                                (carryDendaStatus.isPending ? 0 : carryDendaAmt);
                              const carryRawTotal = carryPokokAmt + carryDendaAmt;
                              const hasCarryPending =
                                carryPokokStatus.isPending || carryDendaStatus.isPending;

                              return (
                                <tr
                                  key={`overdue-carry-${detailAsset.id}-${selectedMonthKey}`}
                                  className="bg-red-50/45 hover:bg-red-50/70 border-t-2 border-red-200"
                                >
                                  <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                                    <div className="font-bold text-red-800">
                                      Periode Aktif · {formatBossMonthShortLabel(selectedMonthKey)}
                                    </div>
                                    <div className="text-[10px] text-red-600 font-semibold">
                                      Tunggakan JT {formatDDMMMYYYYDash(effectiveEnd)} (
                                      {monthsLateOverdue > 0
                                        ? `Terlambat ${monthsLateOverdue} bln`
                                        : 'Jatuh Tempo'}
                                      )
                                    </div>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums text-sky-800 whitespace-nowrap">
                                    {carryPokokStatus.isPending ? (
                                      <div className="inline-flex flex-col items-end">
                                        <span className="line-through text-slate-400">
                                          Rp {formatIDR(carryPokokAmt)}
                                        </span>
                                        <span className="text-[10px] font-sans text-slate-500">
                                          Rp 0 (Pending)
                                        </span>
                                      </div>
                                    ) : (
                                      `Rp ${formatIDR(carryPokokAmt)}`
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                    {carryDendaAmt > 0 ? (
                                      carryDendaStatus.isPending ? (
                                        <div className="inline-flex flex-col items-end">
                                          <span className="line-through text-slate-400">
                                            Rp {formatIDR(carryDendaAmt)}
                                          </span>
                                          <span className="text-[10px] font-sans text-slate-500">
                                            Rp 0 (Pending)
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-red-700 font-bold">
                                          Rp {formatIDR(carryDendaAmt)}
                                        </span>
                                      )
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-center whitespace-nowrap">
                                    <span className="font-bold text-red-700">
                                      {Math.max(1, monthsLateOverdue)} bulan
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                                    -
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                                    {hasCarryPending ? (
                                      <div className="inline-flex flex-col items-end">
                                        <span className="line-through text-slate-400 font-normal">
                                          Rp {formatIDR(carryRawTotal)}
                                        </span>
                                        <span className="text-slate-700">
                                          Rp {formatIDR(carryTotal)}
                                        </span>
                                      </div>
                                    ) : (
                                      `Rp ${formatIDR(carryTotal)}`
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                    Rp {formatIDR(effectiveRemainingPrincipal)}
                                  </td>
                                  <td className="py-2 px-3 whitespace-nowrap">
                                    <div className="flex flex-col gap-1.5">
                                      {[
                                        {
                                          component: 'principal' as const,
                                          label: 'Pokok',
                                          amount: carryPokokAmt,
                                          status: carryPokokStatus,
                                        },
                                        ...(carryDendaAmt > 0
                                          ? [
                                              {
                                                component: 'lateFee' as const,
                                                label: 'Denda',
                                                amount: carryDendaAmt,
                                                status: carryDendaStatus,
                                              },
                                            ]
                                          : []),
                                      ].map((ctrl) => {
                                        const busyKey = `${detailAsset.id}:${selectedMonthKey}:${ctrl.component}`;
                                        return (
                                          <div
                                            key={`carry-${selectedMonthKey}-${ctrl.component}`}
                                            className="flex flex-wrap items-center gap-1.5"
                                          >
                                            <span className="inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200 min-w-[44px] justify-center">
                                              {ctrl.label}
                                            </span>
                                            {ctrl.status.isPending ? (
                                              <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold border rounded bg-slate-200 text-slate-700 border-slate-300">
                                                {ctrl.status.rescheduledToMonth
                                                  ? `DIPENDING KE ${formatBossMonthFullLabel(
                                                      ctrl.status.rescheduledToMonth
                                                    )}`
                                                  : 'DIPENDING'}
                                              </span>
                                            ) : ctrl.status.colorKey === 'white' ? (
                                              <span className="inline-flex px-2 py-0.5 text-[10px] font-bold border rounded bg-red-600 text-white border-red-700">
                                                JATUH TEMPO - TERLAMBAT {Math.max(1, monthsLateOverdue)} BULAN
                                              </span>
                                            ) : null}
                                            <StatusWarnaDropdown
                                              value={ctrl.status.colorKey}
                                              compact
                                              ariaLabel={`Status warna ${ctrl.label} ${detailAsset.name} ${selectedMonthKey}`}
                                              disabled={
                                                !canEdit || busyInstallmentKey === busyKey
                                              }
                                              onSelect={(nextColor) => {
                                                void handleSelectInstallmentStatusColor(
                                                  detailAsset,
                                                  selectedMonthKey,
                                                  nextColor,
                                                  ctrl.amount,
                                                  ctrl.status.isPaid,
                                                  ctrl.component
                                                );
                                              }}
                                            />
                                            {ctrl.status.isPending &&
                                              canEdit &&
                                              onSetMonthStatusWarna && (
                                                <button
                                                  type="button"
                                                  disabled={busyInstallmentKey === busyKey}
                                                  onClick={() =>
                                                    void handleCancelInstallmentPending(
                                                      detailAsset,
                                                      selectedMonthKey,
                                                      ctrl.component
                                                    )
                                                  }
                                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                                                >
                                                  <RotateCcw className="w-3 h-3" />
                                                  Batalkan Pending / Kembalikan
                                                </button>
                                              )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })()}
                          {Object.entries(bossReportMonths ?? {})
                            .sort(([a], [b]) => a.localeCompare(b))
                            .flatMap(([targetMk, mData]) =>
                              (mData.rescheduledIn ?? [])
                                .filter(
                                  (copy) =>
                                    copy.section === 'investment' &&
                                    copy.sourceCategory === 'investment' &&
                                    (copy.investmentAssetId === detailAsset.id ||
                                      copy.sourceId.includes(detailAsset.id))
                                )
                                .map((copy) => {
                                  const isCopyPending = copy.color === 'red';
                                  const copyBusyKey = `copy:${targetMk}:${copy.id}`;
                                  const copyDueStatus = computeDueTunggakanStatus({
                                    dueISO: copy.dueISO,
                                    originMonthKey: copy.originMonthKey,
                                    isPaid: copy.color === 'green',
                                  });
                                  return (
                                    <tr
                                      key={`copy-${targetMk}-${copy.id}`}
                                      className={
                                        isCopyPending
                                          ? 'bg-slate-100/80 text-slate-400 opacity-80'
                                          : 'bg-amber-50/40 hover:bg-amber-50/70'
                                      }
                                    >
                                      <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                                        <div>
                                          Salinan Pending · {formatBossMonthShortLabel(targetMk)}
                                        </div>
                                        <div
                                          className={`text-[10px] font-semibold ${
                                            copyDueStatus.isTunggakan
                                              ? 'text-amber-800'
                                              : 'text-slate-600'
                                          }`}
                                        >
                                          {copyDueStatus.statusText}
                                        </div>
                                      </td>
                                      <td
                                        colSpan={4}
                                        className="py-2 px-3 text-xs text-slate-600"
                                      >
                                        <span className="inline-flex px-1.5 py-0.5 mr-1.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
                                          {formatInvestmentComponentShortLabel(
                                            copy.investmentComponent
                                          )}
                                        </span>
                                        {copy.name}
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                                        {isCopyPending ? (
                                          <div className="inline-flex flex-col items-end">
                                            <span className="line-through text-slate-400 font-normal">
                                              Rp {formatIDR(copy.amount)}
                                            </span>
                                            <span className="text-slate-600">Rp 0</span>
                                            <span className="text-[10px] font-sans font-normal text-slate-500">
                                              Tidak dihitung di bulan ini
                                            </span>
                                          </div>
                                        ) : (
                                          `Rp ${formatIDR(copy.amount)}`
                                        )}
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono text-slate-400">
                                        -
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          {isCopyPending && (
                                            <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold border rounded bg-slate-200 text-slate-700 border-slate-300">
                                              {copy.rescheduledToMonth
                                                ? `DIPENDING KE ${formatBossMonthFullLabel(
                                                    copy.rescheduledToMonth
                                                  )}`
                                                : 'DIPENDING'}
                                            </span>
                                          )}
                                          {onRescheduledCopyAction && (
                                            <>
                                              <StatusWarnaDropdown
                                                value={copy.color}
                                                compact
                                                disabled={!canEdit || busyInstallmentKey === copyBusyKey}
                                                ariaLabel={`Status warna salinan ${copy.name}`}
                                                onSelect={async (nextColor) => {
                                                  if (nextColor === 'red') {
                                                    setRescheduleCopyModal({
                                                      monthKey: targetMk,
                                                      item: copy,
                                                    });
                                                    return;
                                                  }
                                                  setBusyInstallmentKey(copyBusyKey);
                                                  try {
                                                    await onRescheduledCopyAction(
                                                      targetMk,
                                                      copy.id,
                                                      nextColor
                                                    );
                                                  } finally {
                                                    setBusyInstallmentKey((prev) =>
                                                      prev === copyBusyKey ? null : prev
                                                    );
                                                  }
                                                }}
                                              />
                                              {canEdit && (
                                                <button
                                                  type="button"
                                                  disabled={busyInstallmentKey === copyBusyKey}
                                                  onClick={async () => {
                                                    setBusyInstallmentKey(copyBusyKey);
                                                    try {
                                                      await onRescheduledCopyAction(
                                                        targetMk,
                                                        copy.id,
                                                        'white'
                                                      );
                                                    } finally {
                                                      setBusyInstallmentKey((prev) =>
                                                        prev === copyBusyKey ? null : prev
                                                      );
                                                    }
                                                  }}
                                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                                                >
                                                  <RotateCcw className="w-3 h-3" />
                                                  Batalkan Pending / Kembalikan
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                            )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : detailTab === 'addendums' ? (
                  /* Tab Riwayat Adendum: Kontrak Awal -> Adendum 1 -> Adendum 2 */
                  <div className="space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                          Kontrak Awal
                          {(originalSnapshot?.contractNumber || detailAsset.contractNumber) && (
                            <span className="font-mono text-blue-800">
                              ·{' '}
                              {originalSnapshot?.contractNumber ||
                                detailAsset.contractNumber}
                            </span>
                          )}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-white text-slate-700 border border-slate-200">
                          Cicilan #1–#
                          {originalSnapshot
                            ? originalSnapshot.tenorMonths
                            : detailAsset.tenorMonths}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
                        <div>
                          <span className="text-slate-400 block">Nilai Pinjaman Awal</span>
                          <span className="font-mono font-bold text-slate-900">
                            Rp{' '}
                            {formatIDR(
                              originalSnapshot
                                ? originalSnapshot.principalAmount
                                : detailAsset.principalAmount
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Periode Awal</span>
                          <span className="font-mono font-bold text-slate-900">
                            {originalSnapshot
                              ? originalSnapshot.tenorMonths
                              : detailAsset.tenorMonths}{' '}
                            Bulan
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Tgl Kontrak – Tgl JT Awal</span>
                          <span className="font-medium text-slate-800 tabular-nums">
                            {formatDDMMMYYYYDash(
                              originalSnapshot ? originalSnapshot.startDate : effectiveStart
                            )}{' '}
                            –{' '}
                            {formatDDMMMYYYYDash(
                              originalSnapshot ? originalSnapshot.endDate : effectiveEnd
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Bunga Per Bulan Awal</span>
                          <span className="font-mono font-semibold text-blue-800">
                            {originalSnapshot
                              ? originalSnapshot.interestInputType === 'RP'
                                ? `Rp ${formatIDR(originalSnapshot.monthlyInterestAmount)}/bln`
                                : `${originalSnapshot.monthlyInterestRate}%/bln`
                              : `Rp ${formatIDR(getAssetTableMonthlyBunga(detailAsset))}/bln`}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Denda Awal</span>
                          <span className="font-mono font-semibold text-red-700">
                            {(originalSnapshot
                              ? originalSnapshot.lateFeeInputType
                              : detailAsset.lateFeeInputType ?? 'RP') === 'RP'
                              ? `Rp ${formatIDR(
                                  originalSnapshot
                                    ? originalSnapshot.lateFeePerMonthAmount
                                    : detailAsset.lateFeePerMonthAmount ?? 0
                                )}/bln`
                              : `${
                                  originalSnapshot
                                    ? originalSnapshot.lateFeePerMonthRate
                                    : detailAsset.lateFeePerMonthRate ?? 0
                                }%/bln`}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Bonus Awal</span>
                          <span className="font-mono font-semibold text-indigo-700">
                            {(originalSnapshot
                              ? originalSnapshot.bonusInputType
                              : detailAsset.bonusInputType ?? 'RP') === 'RP'
                              ? `Rp ${formatIDR(
                                  originalSnapshot
                                    ? originalSnapshot.bonusAmount
                                    : detailAsset.bonusAmount ?? 0
                                )}`
                              : `${
                                  originalSnapshot
                                    ? originalSnapshot.bonusRate
                                    : detailAsset.bonusRate ?? 0
                                }%`}{' '}
                            (
                            {formatDDMMMYYYYDash(
                              originalSnapshot
                                ? originalSnapshot.bonusDate
                                : getEffectiveAssetBonusDate(detailAsset)
                            )}
                            )
                          </span>
                        </div>
                      </div>
                    </div>

                    {(detailAsset.addendums ?? []).length === 0 ? (
                      <div className="bg-white border border-dashed border-slate-300 rounded-lg py-6 px-4 text-center space-y-2">
                        <p className="text-xs text-slate-600">
                          Belum ada adendum untuk kontrak ini.
                        </p>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setAddendumTargetAsset(detailAsset)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md cursor-pointer"
                          >
                            <FilePlus2 className="w-3.5 h-3.5" />
                            + Buat Adendum 1
                          </button>
                        )}
                      </div>
                    ) : (
                      (detailAsset.addendums ?? []).map((ad) => (
                          <div
                            key={ad.id}
                            className="bg-white border border-indigo-200 rounded-lg p-4 space-y-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-2">
                              <div>
                                <span className="font-bold text-indigo-900">
                                  Adendum {ad.sequenceNumber} · {ad.addendumNumber}
                                </span>
                                <span className="text-[11px] text-slate-500 ml-2">
                                  Tgl Adendum: {formatDDMMMYYYYDash(ad.addendumDate)}
                                </span>
                              </div>
                              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                Berlaku Cicilan #{ad.effectiveFromInstallment}–#
                                {ad.newTotalTenorMonths}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px]">
                              <div>
                                <span className="text-slate-400 block">Perpanjangan</span>
                                <span className="font-mono font-bold text-slate-900">
                                  +{ad.additionalTenorMonths} Bulan (Total{' '}
                                  {ad.newTotalTenorMonths} Bulan)
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">
                                  Tgl Jatuh Tempo Baru
                                </span>
                                <span className="font-semibold text-slate-800 tabular-nums">
                                  {formatDDMMMYYYYDash(ad.previousEndDate)} →{' '}
                                  {formatDDMMMYYYYDash(ad.newEndDate)}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">Tambahan Pokok</span>
                                <span className="font-mono font-bold text-sky-800">
                                  {ad.additionalPrincipal > 0
                                    ? `+Rp ${formatIDR(ad.additionalPrincipal)}`
                                    : 'Rp 0'}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">Bunga Per Bulan Baru</span>
                                <span className="font-mono font-semibold text-blue-800">
                                  {ad.newMonthlyInstallment && ad.newMonthlyInstallment > 0
                                    ? `Rp ${formatIDR(ad.newMonthlyInstallment)}/bln`
                                    : ad.newInterestInputType === 'RP'
                                    ? `Rp ${formatIDR(ad.newMonthlyInterestAmount)}/bln`
                                    : `${ad.newMonthlyInterestRate}%/bln`}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">Denda Baru</span>
                                <span className="font-mono font-semibold text-red-700">
                                  {ad.newLateFeeInputType === 'RP'
                                    ? `Rp ${formatIDR(ad.newLateFeePerMonthAmount)}/bln`
                                    : `${ad.newLateFeePerMonthRate}%/bln`}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400 block">Bonus Baru</span>
                                <span className="font-mono font-semibold text-indigo-700">
                                  {ad.newBonusInputType === 'RP'
                                    ? `Rp ${formatIDR(ad.newBonusAmount)}`
                                    : `${ad.newBonusRate}%`}{' '}
                                  ({formatDDMMMYYYYDash(ad.newBonusDate)})
                                </span>
                              </div>
                            </div>

                            {ad.notes && (
                              <p className="text-[11px] text-slate-600 bg-slate-50 rounded px-2.5 py-1.5">
                                Catatan: {ad.notes}
                              </p>
                            )}

                            {ad.pdfFileName && (
                              <div className="pt-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-500 truncate">
                                  Lampiran PDF: {ad.pdfFileName}
                                </span>
                              </div>
                            )}
                          </div>
                        ))
                    )}
                  </div>
                ) : (
                  /* Tab Riwayat Pembayaran (Kronologis & Permanen — Audit Log) */
                  <div className="space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800">
                        Jejak Pembayaran &amp; Revisi Status ({paymentHistory.length} entri)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Kronologis permanen — log lama tidak pernah dihapus
                      </span>
                    </div>

                    {paymentHistory.length === 0 ? (
                      <div className="bg-white border border-dashed border-slate-300 rounded-lg py-8 px-4 text-center text-xs text-slate-500">
                        Belum ada riwayat perubahan status pembayaran atau revisi untuk kontrak ini.
                      </div>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                              <tr>
                                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                                  Tanggal
                                </th>
                                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                                  Komponen
                                </th>
                                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                                  Perubahan Status
                                </th>
                                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                                  Oleh
                                </th>
                                <th className="py-2.5 px-3 font-semibold">
                                  Alasan / Catatan Audit
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {paymentHistory.map((item) => {
                                const badgeClass =
                                  item.actionType === 'CANCEL_PAID'
                                    ? 'bg-amber-50 text-amber-900 border-amber-300'
                                    : item.actionType === 'MARK_PAID'
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-slate-100 text-slate-700 border-slate-200';
                                return (
                                  <tr key={item.id} className="hover:bg-slate-50/70">
                                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                      {item.dateDisplay}
                                    </td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                                      {item.componentLabel}
                                    </td>
                                    <td className="py-2.5 px-3 whitespace-nowrap">
                                      <span
                                        className={`inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded ${badgeClass}`}
                                      >
                                        {item.transitionLabel}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                                      {item.actorName}
                                    </td>
                                    <td className="py-2.5 px-3 text-slate-700">
                                      <div className="font-medium text-slate-900">
                                        {item.actionType === 'CANCEL_PAID'
                                          ? `Alasan: "${item.reasonOrNote}"`
                                          : item.reasonOrNote}
                                      </div>
                                      <div className="text-[11px] text-slate-500 mt-0.5">
                                        {item.formattedLine}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Perpanjangan / Adendum Kontrak */}
      {addendumTargetAsset && (
        <InvestmentAddendumModal
          asset={addendumTargetAsset}
          onCancel={() => setAddendumTargetAsset(null)}
          onSubmit={async (submission) => {
            const targetId = addendumTargetAsset.id;
            await onAddAddendum(targetId, submission);
            setAddendumTargetAsset(null);
            openDetailModal(targetId, 'addendums');
          }}
        />
      )}

      {/* Modal Import CSV Kontrak Investor dengan Validasi Total & Baris Salah */}
      {showImportModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3 sm:p-5"
        >
          <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 bg-blue-800 text-white flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold">
                  Import CSV Kontrak Investor
                </h3>
                <p className="text-xs text-blue-100 mt-0.5">
                  Validasi wajib: Total Nilai Pinjaman = Rp{' '}
                  {formatIDR(EXPECTED_KKB_TOTAL_PRINCIPAL)} &amp; Total Bunga Per Bulan = Rp{' '}
                  {formatIDR(EXPECTED_KKB_TOTAL_MONTHLY_INTEREST)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1 text-blue-100 hover:text-white rounded cursor-pointer"
                aria-label="Tutup modal import"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              {importErrorMessage && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-800 font-medium break-all"
                >
                  Gagal mengimport ke Supabase: {importErrorMessage}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-blue-800 hover:bg-blue-900 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Pilih File CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFileUpload}
                      className="hidden"
                    />
                  </label>
                  {csvFileName && (
                    <span className="font-mono text-[11px] text-slate-600 px-2 py-1 bg-white border border-slate-200 rounded">
                      {csvFileName}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={strictKkbTotals}
                      onChange={(e) => setStrictKkbTotals(e.target.checked)}
                      className="rounded border-slate-300 text-blue-800"
                    />
                    Validasi Total KKB (Rp 13.981.672.800 / Rp 438.190.000)
                  </label>
                  <label className="inline-flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={replaceExistingOnImport}
                      onChange={(e) => setReplaceExistingOnImport(e.target.checked)}
                      className="rounded border-slate-300 text-blue-800"
                    />
                    Ganti seluruh data saat ini
                  </label>
                </div>
              </div>

              {csvValidation && (
                <>
                  {/* Status Validasi Ringkasan */}
                  <div
                    className={`rounded-xl border p-4 space-y-3 ${
                      csvValidation.valid
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-red-50 border-red-300'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`text-xs sm:text-sm font-bold ${
                          csvValidation.valid ? 'text-emerald-900' : 'text-red-900'
                        }`}
                      >
                        {csvValidation.valid
                          ? 'Validasi Lolos — Siap Diimport'
                          : 'Import Ditolak — Validasi Gagal'}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-700">
                        {csvValidation.rows.length} baris valid · {csvValidation.errors.length}{' '}
                        error
                      </span>
                    </div>

                    <p
                      className={`text-xs ${
                        csvValidation.valid ? 'text-emerald-800' : 'text-red-800'
                      }`}
                    >
                      {csvValidation.summaryMessage}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div
                        className={`rounded-lg border p-3 bg-white ${
                          csvValidation.principalMismatch
                            ? 'border-red-400'
                            : 'border-emerald-300'
                        }`}
                      >
                        <div className="text-[11px] text-slate-500">Total Nilai Pinjaman</div>
                        <div className="font-mono font-bold text-sm text-slate-900 mt-0.5">
                          Rp {formatIDR(csvValidation.totalPrincipal)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Target: Rp {formatIDR(EXPECTED_KKB_TOTAL_PRINCIPAL)}{' '}
                          {csvValidation.principalMismatch ? '(TIDAK COCOK)' : '(COCOK)'}
                        </div>
                      </div>

                      <div
                        className={`rounded-lg border p-3 bg-white ${
                          csvValidation.interestMismatch
                            ? 'border-red-400'
                            : 'border-emerald-300'
                        }`}
                      >
                        <div className="text-[11px] text-slate-500">Total Bunga Per Bulan</div>
                        <div className="font-mono font-bold text-sm text-slate-900 mt-0.5">
                          Rp {formatIDR(csvValidation.totalMonthlyInterest)}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Target: Rp {formatIDR(EXPECTED_KKB_TOTAL_MONTHLY_INTEREST)}{' '}
                          {csvValidation.interestMismatch ? '(TIDAK COCOK)' : '(COCOK)'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Daftar Baris yang Salah */}
                  {csvValidation.errors.length > 0 && (
                    <div className="border border-red-300 rounded-xl overflow-hidden">
                      <div className="bg-red-700 text-white px-4 py-2 font-bold">
                        Daftar Baris / Validasi yang Salah ({csvValidation.errors.length})
                      </div>
                      <div className="overflow-x-auto max-h-60 overflow-y-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-red-50 text-red-900 border-b border-red-200 sticky top-0">
                            <tr>
                              <th className="py-2 px-3 font-semibold">Baris CSV</th>
                              <th className="py-2 px-3 font-semibold">No. Kontrak</th>
                              <th className="py-2 px-3 font-semibold">Kolom</th>
                              <th className="py-2 px-3 font-semibold">Nilai</th>
                              <th className="py-2 px-3 font-semibold">Keterangan Salah</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-100 bg-white">
                            {csvValidation.errors.map((err, i) => (
                              <tr key={`${err.lineNumber}-${err.field}-${i}`}>
                                <td className="py-2 px-3 font-mono whitespace-nowrap">
                                  {err.lineNumber > 0 ? `Baris ${err.lineNumber}` : err.rowNo}
                                </td>
                                <td className="py-2 px-3 font-mono whitespace-nowrap">
                                  {err.contractNumber}
                                </td>
                                <td className="py-2 px-3 font-semibold text-red-800 whitespace-nowrap">
                                  {err.field}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-700">
                                  {err.rawValue || '-'}
                                </td>
                                <td className="py-2 px-3 text-red-700">{err.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Preview Kontrak Valid */}
                  {csvValidation.rows.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="bg-slate-100 px-4 py-2 font-bold text-slate-800 border-b border-slate-200">
                        Preview Data Terbaca ({csvValidation.rows.length} Kontrak)
                      </div>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="bg-blue-800 text-white sticky top-0">
                            <tr>
                              <th className="py-2 px-2.5">No</th>
                              <th className="py-2 px-2.5">No. Kontrak</th>
                              <th className="py-2 px-2.5">Tgl Kontrak</th>
                              <th className="py-2 px-2.5">Periode</th>
                              <th className="py-2 px-2.5">Tgl Jatuh Tempo</th>
                              <th className="py-2 px-2.5">Nama Investor</th>
                              <th className="py-2 px-2.5 text-right">Nilai Pinjaman</th>
                              <th className="py-2 px-2.5 text-right">Bunga Per Bulan</th>
                              <th className="py-2 px-2.5">Metode</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {csvValidation.rows.map((r) => (
                              <tr key={r.deterministicId} className="odd:bg-white even:bg-sky-50/50">
                                <td className="py-1.5 px-2.5 font-mono">{r.rawNo}</td>
                                <td className="py-1.5 px-2.5 font-mono font-semibold">
                                  {r.input.contractNumber}
                                </td>
                                <td className="py-1.5 px-2.5 font-mono">
                                  {formatDDMMMYYYYDash(r.input.startDate ?? '')}
                                </td>
                                <td className="py-1.5 px-2.5">{r.input.tenorMonths} Bln</td>
                                <td className="py-1.5 px-2.5 font-mono">
                                  {formatDDMMMYYYYDash(r.input.endDate ?? '')}
                                </td>
                                <td className="py-1.5 px-2.5 font-semibold">{r.input.name}</td>
                                <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                                  Rp {formatIDR(r.input.principalAmount)}
                                </td>
                                <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                                  Rp {formatIDR(r.input.monthlyInstallment)}
                                </td>
                                <td className="py-1.5 px-2.5">
                                  {r.input.paymentMethod === 'ANUITAS'
                                    ? 'Pokok + Bunga'
                                    : 'Pokok di Akhir'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={!csvValidation?.valid || importingCsv || !onImportCsv}
                onClick={() => void handleConfirmCsvImport()}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
              >
                {importingCsv
                  ? 'Mengimport...'
                  : csvValidation?.valid
                  ? `Import Sekarang (${csvValidation.rows.length} Kontrak)`
                  : 'Import Ditolak (Perbaiki CSV)'}
              </button>
            </div>
          </div>
        </div>
      )}

      <RescheduleMonthModal
        isOpen={Boolean(rescheduleModal || rescheduleCopyModal)}
        itemName={
          rescheduleCopyModal
            ? rescheduleCopyModal.item.name
            : rescheduleModal?.label ?? ''
        }
        amount={
          rescheduleCopyModal
            ? rescheduleCopyModal.item.amount
            : rescheduleModal?.amount ?? 0
        }
        originMonthKey={
          rescheduleCopyModal
            ? rescheduleCopyModal.monthKey
            : rescheduleModal?.monthKey ?? selectedMonthKey
        }
        initialTargetMonthKey={
          rescheduleCopyModal
            ? rescheduleCopyModal.item.rescheduledToMonth
            : rescheduleModal?.initialTargetMonthKey
        }
        isSaving={
          rescheduleCopyModal
            ? busyInstallmentKey ===
              `copy:${rescheduleCopyModal.monthKey}:${rescheduleCopyModal.item.id}`
            : rescheduleModal
            ? busyInstallmentKey ===
              `${rescheduleModal.asset.id}:${rescheduleModal.monthKey}:${
                rescheduleModal.component ?? 'all'
              }`
            : false
        }
        onCancel={() => {
          setRescheduleModal(null);
          setRescheduleCopyModal(null);
        }}
        onConfirm={handleConfirmInstallmentReschedule}
      />
    </div>
  );
};
