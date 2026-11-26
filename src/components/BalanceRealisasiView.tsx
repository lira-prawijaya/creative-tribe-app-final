import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDown,
  FileSpreadsheet,
  Pencil,
  RotateCcw,
  Share2,
  X,
} from 'lucide-react';
import {
  createDefaultBossReportMonth,
  generateBossRowId,
  saveBossReportMonth,
} from '../services/bossReportService';
import { updateClientInvoiceRealisasi } from '../services/clientInvoiceService';
import { updateInvestmentRealisasi } from '../services/investmentService';
import { updateOpexRealisasi } from '../services/opexService';
import { updatePurchaseOrderRealisasi } from '../services/poService';
import { AuditActor, AuditEntityType, AuditLogEntry } from '../types/auth';
import {
  BankAccountRow,
  BOSS_REPORT_COLOR_META,
  BossReportAutoOverride,
  BossReportColorStatus,
  BossReportMonthData,
} from '../types/bossReport';
import { ClientInvoice } from '../types/clientInvoice';
import { InvestmentAsset } from '../types/investment';
import { OpexItem } from '../types/opex';
import { PurchaseOrder } from '../types/po';
import {
  addMonthsToKey,
  BossReportComputedRow,
  CashInSourceKind,
  computeBalanceAccountDetails,
  computeBossReportRangeViewModel,
  computeBossReportViewModel,
  computeMultiMonthRealisasiSeries,
  diffBossMonthKeys,
  formatBossMonthFullLabel,
  formatBossMonthShortLabel,
  formatMonthKeyParts,
  normalizeMonthKeyYYYYMM,
} from '../utils/bossReportCalc';
import { formatIDR, getTodayISODate } from '../utils/format';
import {
  exportBalanceReportToExcel,
  exportBalanceReportToPDF,
} from '../utils/projectionExport';
import {
  appendProjectionRevisionRecord,
  buildProjectionAuditSummary,
  formatSlashDateDDMMYYYY,
  getRowComponentLabel,
  getRowRevisionStats,
  loadProjectionRevisions,
  PROJECTION_CANCEL_PAID_ACTION,
  PROJECTION_MARK_PAID_ACTION,
  ProjectionRevisionRecord,
} from '../utils/projectionRevisionLog';
import {
  buildProjectionColorChangePlan,
  ProjectionSourceSyncAction,
} from '../utils/projectionStatusActions';
import {
  buildDestinationMonthOptions,
  formatMonthFullID,
  formatMonthShortID,
} from '../types/statusWarna';
import { AccountBalanceTableCard } from './AccountBalanceTableCard';
import { CashflowChartCard } from './CashflowChartCard';
import { PeriodeSelector } from './PeriodeSelector';
import { ProjectionAuditLogInput } from './ProjectionReportView';
import { RupiahInput } from './RupiahInput';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';

interface BalanceRealisasiViewProps {
  orders: PurchaseOrder[];
  clientInvoices: ClientInvoice[];
  opexItems?: OpexItem[];
  investments?: InvestmentAsset[];
  bossReportMonths: Record<string, BossReportMonthData>;
  auditLogs?: AuditLogEntry[];
  currentActor?: AuditActor;
  selectedMonthKey?: string;
  cutoffPeriod?: string;
  onChangeMonthKey?: (monthKey: string) => void;
  startMonth?: string;
  startYear?: string;
  endMonth?: string;
  endYear?: string;
  onChangeStartPeriod?: (nextMonth: string, nextYear: string) => void;
  onChangeEndPeriod?: (nextMonth: string, nextYear: string) => void;
  startMonthKey?: string;
  endMonthKey?: string;
  onChangeRange?: (nextStartMonthKey: string, nextEndMonthKey: string) => void;
  onSwitchToProjection?: () => void;
  onSaveBossReportMonth?: (monthData: BossReportMonthData) => Promise<void>;
  onSaveBossReportMonthsBatch?: (months: BossReportMonthData[]) => Promise<void>;
  onSyncProjectionSource?: (action: ProjectionSourceSyncAction) => Promise<void>;
  onLogProjectionStatusRevision?: (entry: ProjectionAuditLogInput) => void;
  onNavigateOpex?: () => void;
  onNavigateInvestment?: () => void;
  onLoadOpexMonth?: (monthKey: string) => Promise<void>;
  onLoadRangeData?: (startMonthKey: string, endMonthKey: string) => Promise<void>;
  isLoading: boolean;
  isBossMode?: boolean;
  canEdit?: boolean;
}

type CashOutGroupKey = 'operasional' | 'investment' | 'projectCost';

function formatSignedCurrency(amount: number): string {
  const abs = formatIDR(Math.abs(amount));
  return amount < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

function getRowStyling(color: BossReportColorStatus) {
  return (
    BOSS_REPORT_COLOR_META.find((c) => c.value === color) ?? BOSS_REPORT_COLOR_META[0]
  );
}

function getCashInSourceLabel(source?: CashInSourceKind): string {
  if (source === 'investmentDisbursement') return 'Pencairan Pinjaman Investment';
  if (source === 'manual') return 'Manual';
  return 'Invoice';
}

interface InlineMoneyCellProps {
  value: number;
  disabled: boolean;
  onCommit: (nextValue: number) => void;
  allowNegative?: boolean;
  textClassName?: string;
}

const InlineMoneyCell: React.FC<InlineMoneyCellProps> = ({
  value,
  disabled,
  onCommit,
  allowNegative = false,
  textClassName = 'text-slate-900',
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (disabled) {
    return (
      <span className={`font-mono text-xs sm:text-sm font-semibold tabular-nums ${textClassName}`}>
        {formatSignedCurrency(value)}
      </span>
    );
  }

  if (editing) {
    const commit = () => {
      const parsed = Number(draft);
      const safe = Number.isFinite(parsed)
        ? allowNegative
          ? Math.round(parsed)
          : Math.max(0, Math.round(parsed))
        : value;
      setEditing(false);
      if (safe !== value) {
        onCommit(safe);
      }
    };

    return (
      <RupiahInput
        ref={inputRef}
        allowNegative={allowNegative}
        value={draft}
        onValueChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(String(value));
            setEditing(false);
          }
        }}
        className="w-36 sm:w-44 px-2.5 py-1 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-slate-900 rounded-md text-slate-900 focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      title="Klik untuk edit nominal"
      className={`group inline-flex items-center justify-end gap-1.5 px-2 py-1 -mr-2 rounded-md hover:bg-slate-900/5 transition-colors cursor-pointer font-mono text-xs sm:text-sm font-semibold tabular-nums ${textClassName}`}
    >
      <span>{formatSignedCurrency(value)}</span>
      <Pencil className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
};

interface InlineRealisasiCellProps {
  value: number;
  disabled: boolean;
  onCommit: (nextValue: number) => Promise<boolean | void> | boolean | void;
}

const InlineRealisasiCell: React.FC<InlineRealisasiCellProps> = ({
  value,
  disabled,
  onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing && !saving) {
      setDraft(String(value));
    }
  }, [value, editing, saving]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (disabled) {
    return (
      <span className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-emerald-800">
        {formatSignedCurrency(value)}
      </span>
    );
  }

  if (editing) {
    const commit = async () => {
      if (saving) return;
      const parsed = Number(draft);
      const safe = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : value;
      if (safe === value) {
        setEditing(false);
        return;
      }
      setSaving(true);
      try {
        const result = await onCommit(safe);
        if (result !== false) {
          setEditing(false);
        }
      } finally {
        setSaving(false);
      }
    };

    const cancel = () => {
      if (saving) return;
      setDraft(String(value));
      setEditing(false);
    };

    return (
      <div className="inline-flex items-center justify-end gap-1">
        <RupiahInput
          ref={inputRef}
          value={draft}
          disabled={saving}
          onValueChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label="Edit nominal realisasi"
          className="w-32 sm:w-36 px-2 py-1 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-emerald-700 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void commit()}
          className="px-2 py-1 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
        >
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={cancel}
          className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
        >
          Batal
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      title="Klik untuk ubah nominal realisasi"
      className="group inline-flex items-center justify-end gap-1.5 px-2 py-1 -mr-2 rounded-md hover:bg-emerald-900/10 transition-colors cursor-pointer font-mono text-xs sm:text-sm font-semibold tabular-nums text-emerald-800"
    >
      <span>{formatSignedCurrency(value)}</span>
      <Pencil className="w-3.5 h-3.5 text-emerald-600/80 group-hover:text-emerald-800 transition-colors shrink-0" />
    </button>
  );
};

interface InlineTextCellProps {
  value: string;
  subtitle?: string;
  disabled: boolean;
  onCommit: (nextValue: string) => void;
}

const InlineTextCell: React.FC<InlineTextCellProps> = ({
  value,
  subtitle,
  disabled,
  onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (disabled) {
    return (
      <div>
        <div className="text-xs sm:text-sm font-medium text-slate-900">{value}</div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
    );
  }

  if (editing) {
    const commit = () => {
      const clean = draft.trim();
      setEditing(false);
      if (clean && clean !== value) {
        onCommit(clean);
      } else {
        setDraft(value);
      }
    };

    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full px-2.5 py-1 text-xs sm:text-sm font-medium bg-white border border-slate-900 rounded-md text-slate-900 focus:outline-none"
      />
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Klik untuk edit nama"
        className="group inline-flex items-center gap-1.5 text-left hover:underline decoration-slate-400 underline-offset-2 cursor-pointer"
      >
        <span className="text-xs sm:text-sm font-medium text-slate-900">{value}</span>
        <Pencil className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
    </div>
  );
};

export const BalanceRealisasiView: React.FC<BalanceRealisasiViewProps> = ({
  orders,
  clientInvoices,
  opexItems = [],
  investments = [],
  bossReportMonths,
  auditLogs = [],
  currentActor,
  selectedMonthKey: controlledMonthKey,
  cutoffPeriod: controlledCutoffPeriod,
  onChangeMonthKey,
  startMonth: controlledStartMonth,
  startYear: controlledStartYear,
  endMonth: controlledEndMonth,
  endYear: controlledEndYear,
  onChangeStartPeriod,
  onChangeEndPeriod,
  startMonthKey: controlledStartMonthKey,
  endMonthKey: controlledEndMonthKey,
  onChangeRange,
  onSwitchToProjection,
  onSaveBossReportMonth,
  onSaveBossReportMonthsBatch,
  onSyncProjectionSource,
  onLogProjectionStatusRevision,
  onNavigateOpex,
  onNavigateInvestment,
  onLoadOpexMonth: _onLoadOpexMonth,
  onLoadRangeData,
  isLoading,
  isBossMode: rawIsBossMode = false,
  canEdit = true,
}) => {
  const isBossMode = rawIsBossMode || !canEdit;
  void _onLoadOpexMonth;
  const defaultMonthKey = useMemo(() => getTodayISODate().slice(0, 7), []);
  const cutoffPeriod = useMemo(
    () => normalizeMonthKeyYYYYMM(controlledCutoffPeriod ?? defaultMonthKey),
    [controlledCutoffPeriod, defaultMonthKey]
  );
  const [localStartMonth, setLocalStartMonth] = useState<string>(() =>
    normalizeMonthKeyYYYYMM(controlledStartMonthKey ?? controlledMonthKey ?? defaultMonthKey).slice(5, 7)
  );
  const [localStartYear, setLocalStartYear] = useState<string>(() =>
    normalizeMonthKeyYYYYMM(controlledStartMonthKey ?? controlledMonthKey ?? defaultMonthKey).slice(0, 4)
  );
  const [localEndMonth, setLocalEndMonth] = useState<string>(() =>
    normalizeMonthKeyYYYYMM(controlledEndMonthKey ?? controlledMonthKey ?? defaultMonthKey).slice(5, 7)
  );
  const [localEndYear, setLocalEndYear] = useState<string>(() =>
    normalizeMonthKeyYYYYMM(controlledEndMonthKey ?? controlledMonthKey ?? defaultMonthKey).slice(0, 4)
  );

  const activeStartMonth = String(
    controlledStartMonth ?? (controlledStartMonthKey ? controlledStartMonthKey.slice(5, 7) : localStartMonth)
  ).padStart(2, '0');
  const activeStartYear =
    controlledStartYear ?? (controlledStartMonthKey ? controlledStartMonthKey.slice(0, 4) : localStartYear);
  const activeEndMonth = String(
    controlledEndMonth ?? (controlledEndMonthKey ? controlledEndMonthKey.slice(5, 7) : localEndMonth)
  ).padStart(2, '0');
  const activeEndYear =
    controlledEndYear ?? (controlledEndMonthKey ? controlledEndMonthKey.slice(0, 4) : localEndYear);

  const rawStartKey = formatMonthKeyParts(activeStartYear, activeStartMonth);
  const rawEndKey = formatMonthKeyParts(activeEndYear, activeEndMonth);
  const isInvalidPeriodRange = rawEndKey < rawStartKey;
  const periodSpanMonths = isInvalidPeriodRange
    ? 1
    : diffBossMonthKeys(rawStartKey, rawEndKey) + 1;
  const isExceedingMaxRange = !isInvalidPeriodRange && periodSpanMonths > 12;
  const activeStartMonthKey = rawStartKey;
  const activeEndMonthKey = isInvalidPeriodRange
    ? rawStartKey
    : isExceedingMaxRange
    ? addMonthsToKey(rawStartKey, 11)
    : rawEndKey;
  const isRange = activeStartMonthKey !== activeEndMonthKey;
  const selectedMonthKey = activeStartMonthKey;

  const handleStartPeriodChange = (nextMonth: string, nextYear: string) => {
    const cleanMonth = String(nextMonth).padStart(2, '0');
    const nextStart = formatMonthKeyParts(nextYear, cleanMonth);
    const shouldSyncEnd = nextStart > rawEndKey;
    setLocalStartMonth(cleanMonth);
    setLocalStartYear(nextYear);
    if (shouldSyncEnd) {
      setLocalEndMonth(cleanMonth);
      setLocalEndYear(nextYear);
    }
    if (onChangeStartPeriod) {
      onChangeStartPeriod(cleanMonth, nextYear);
    } else if (onChangeRange) {
      onChangeRange(nextStart, shouldSyncEnd ? nextStart : rawEndKey);
    }
  };

  const handleEndPeriodChange = (nextMonth: string, nextYear: string) => {
    const cleanMonth = String(nextMonth).padStart(2, '0');
    const nextEnd = formatMonthKeyParts(nextYear, cleanMonth);
    const shouldSyncStart = nextEnd < rawStartKey;
    setLocalEndMonth(cleanMonth);
    setLocalEndYear(nextYear);
    if (shouldSyncStart) {
      setLocalStartMonth(cleanMonth);
      setLocalStartYear(nextYear);
    }
    if (onChangeEndPeriod) {
      onChangeEndPeriod(cleanMonth, nextYear);
    } else if (onChangeRange) {
      onChangeRange(shouldSyncStart ? nextEnd : rawStartKey, nextEnd);
    }
  };

  const setSelectedMonthKey = (nextMonthKey: string) => {
    const norm = normalizeMonthKeyYYYYMM(nextMonthKey);
    const yr = norm.slice(0, 4);
    const mo = norm.slice(5, 7);
    setLocalStartMonth(mo);
    setLocalStartYear(yr);
    setLocalEndMonth(mo);
    setLocalEndYear(yr);
    if (onChangeStartPeriod && onChangeEndPeriod) {
      onChangeStartPeriod(mo, yr);
      onChangeEndPeriod(mo, yr);
    } else if (onChangeRange) {
      onChangeRange(norm, norm);
    } else {
      onChangeMonthKey?.(norm);
    }
  };

  useEffect(() => {
    if (!onLoadRangeData) return;
    if (isInvalidPeriodRange || isExceedingMaxRange) return;

    const timer = window.setTimeout(() => {
      void onLoadRangeData(activeStartMonthKey, activeEndMonthKey);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeStartMonthKey,
    activeEndMonthKey,
    isInvalidPeriodRange,
    isExceedingMaxRange,
    onLoadRangeData,
  ]);

  // Collapse state per Cash Out group
  const [collapsedGroups, setCollapsedGroups] = useState<Record<CashOutGroupKey, boolean>>({
    operasional: false,
    investment: false,
    projectCost: false,
  });

  // Feedback states
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'fallback'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [cashInStatusError, setCashInStatusError] = useState<string | null>(null);
  const [savingRowKeys, setSavingRowKeys] = useState<Record<string, boolean>>({});

  // Manual Saldo Awal draft input (shared seamlessly with Projection)
  const [openingBalanceDraft, setOpeningBalanceDraft] = useState<string>('');

  // Filter Cash In per Sumber
  const [cashInSourceFilter, setCashInSourceFilter] = useState<'all' | CashInSourceKind>('all');

  // Revision / Cancel Paid state (identical 2-step confirmation & immutable log)
  const [localRevisions, setLocalRevisions] = useState<ProjectionRevisionRecord[]>(() =>
    loadProjectionRevisions()
  );
  const [cancelPaidModal, setCancelPaidModal] = useState<{
    row: BossReportComputedRow;
    targetColor: 'white' | 'red';
    targetMonthKey: string;
    reason: string;
    revisionDateISO: string;
  } | null>(null);

  const rescheduleMonthOptions = useMemo(
    () => buildDestinationMonthOptions(selectedMonthKey, 18),
    [selectedMonthKey]
  );

  const activeMonthData: BossReportMonthData = useMemo(() => {
    return (
      bossReportMonths[selectedMonthKey] ?? createDefaultBossReportMonth(selectedMonthKey)
    );
  }, [bossReportMonths, selectedMonthKey]);

  useEffect(() => {
    setOpeningBalanceDraft(
      typeof activeMonthData.manualOpeningBalance === 'number' &&
        Number.isFinite(activeMonthData.manualOpeningBalance)
        ? String(activeMonthData.manualOpeningBalance)
        : ''
    );
  }, [selectedMonthKey, activeMonthData.manualOpeningBalance]);

  const effectiveMonthData: BossReportMonthData = useMemo(() => {
    const trimmed = openingBalanceDraft.trim();
    if (trimmed && trimmed !== '-') {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return {
          ...activeMonthData,
          manualOpeningBalance: Math.round(parsed),
        };
      }
    }
    return activeMonthData;
  }, [activeMonthData, openingBalanceDraft]);

  const autoPreviewMonthsMap = useMemo(() => {
    if (effectiveMonthData === activeMonthData) return bossReportMonths;
    return {
      ...bossReportMonths,
      [selectedMonthKey]: effectiveMonthData,
    };
  }, [bossReportMonths, selectedMonthKey, effectiveMonthData, activeMonthData]);

  const viewModel = useMemo(
    () =>
      computeBossReportRangeViewModel(
        activeStartMonthKey,
        activeEndMonthKey,
        autoPreviewMonthsMap,
        orders,
        clientInvoices,
        opexItems,
        investments,
        { cutoffPeriod }
      ),
    [
      activeStartMonthKey,
      activeEndMonthKey,
      autoPreviewMonthsMap,
      orders,
      clientInvoices,
      opexItems,
      investments,
      cutoffPeriod,
    ]
  );

  // Filter strictly to HIJAU - Paid rows ONLY
  const paidCashInRows = useMemo(
    () => viewModel.cashInRows.filter((row) => row.color === 'green'),
    [viewModel.cashInRows]
  );
  const paidOperasionalRows = useMemo(
    () => viewModel.operasionalRows.filter((row) => row.color === 'green'),
    [viewModel.operasionalRows]
  );
  const paidInvestmentRows = useMemo(
    () => viewModel.investmentRows.filter((row) => row.color === 'green'),
    [viewModel.investmentRows]
  );
  const paidProjectCostRows = useMemo(
    () => viewModel.projectCostRows.filter((row) => row.color === 'green'),
    [viewModel.projectCostRows]
  );

  const totalCashOutPaidCount =
    paidOperasionalRows.length + paidInvestmentRows.length + paidProjectCostRows.length;

  const paidCashInProjectedTotal = useMemo(
    () => paidCashInRows.reduce((sum, row) => sum + row.projectedAmount, 0),
    [paidCashInRows]
  );
  const paidOperasionalProjectedTotal = useMemo(
    () => paidOperasionalRows.reduce((sum, row) => sum + row.projectedAmount, 0),
    [paidOperasionalRows]
  );
  const paidInvestmentProjectedTotal = useMemo(
    () => paidInvestmentRows.reduce((sum, row) => sum + row.projectedAmount, 0),
    [paidInvestmentRows]
  );
  const paidProjectCostProjectedTotal = useMemo(
    () => paidProjectCostRows.reduce((sum, row) => sum + row.projectedAmount, 0),
    [paidProjectCostRows]
  );
  const totalCashOutPaidProjectedTotal =
    paidOperasionalProjectedTotal +
    paidInvestmentProjectedTotal +
    paidProjectCostProjectedTotal;

  const balanceAccountDetails = useMemo(
    () => computeBalanceAccountDetails(viewModel),
    [viewModel]
  );

  const isMinusReal = viewModel.endingBalanceRealisasi < 0;
  const accountBalanceRealisasi = viewModel.saldoAwal + viewModel.totalCashInRealisasi;

  const cashInSourceStats = useMemo(() => {
    let invoiceCount = 0;
    let disbursementCount = 0;
    let manualCount = 0;
    for (const row of paidCashInRows) {
      if (row.cashInSource === 'investmentDisbursement') {
        disbursementCount += 1;
      } else if (row.cashInSource === 'manual') {
        manualCount += 1;
      } else {
        invoiceCount += 1;
      }
    }
    return {
      all: paidCashInRows.length,
      invoice: invoiceCount,
      investmentDisbursement: disbursementCount,
      manual: manualCount,
    };
  }, [paidCashInRows]);

  const filteredPaidCashInRows = useMemo(() => {
    if (cashInSourceFilter === 'all') return paidCashInRows;
    return paidCashInRows.filter(
      (row) => (row.cashInSource ?? 'invoice') === cashInSourceFilter
    );
  }, [paidCashInRows, cashInSourceFilter]);

  const filteredCashInRealisasiTotal = useMemo(
    () =>
      filteredPaidCashInRows.reduce((sum, row) => sum + row.realisasiAmount, 0),
    [filteredPaidCashInRows]
  );

  const filteredCashInProjectedTotal = useMemo(
    () =>
      filteredPaidCashInRows.reduce((sum, row) => sum + row.projectedAmount, 0),
    [filteredPaidCashInRows]
  );

  const realisasiChartSeries = useMemo(
    () =>
      computeMultiMonthRealisasiSeries(
        activeStartMonthKey,
        autoPreviewMonthsMap,
        orders,
        clientInvoices,
        opexItems,
        investments,
        activeEndMonthKey,
        { cutoffPeriod }
      ),
    [
      activeStartMonthKey,
      activeEndMonthKey,
      autoPreviewMonthsMap,
      orders,
      clientInvoices,
      opexItems,
      investments,
      cutoffPeriod,
    ]
  );

  const autoFallbackOpeningBalance = useMemo(() => {
    const { manualOpeningBalance: _ignored, ...withoutManual } = activeMonthData;
    void _ignored;
    return computeBossReportViewModel(
      selectedMonthKey,
      withoutManual,
      orders,
      clientInvoices,
      opexItems,
      investments,
      bossReportMonths,
      { cutoffPeriod }
    ).saldoAwal;
  }, [selectedMonthKey, activeMonthData, orders, clientInvoices, opexItems, investments, bossReportMonths, cutoffPeriod]);

  const persistMonthFor = async (
    targetMonthKey: string,
    updater: (prev: BossReportMonthData) => BossReportMonthData
  ): Promise<boolean> => {
    if (isBossMode) return false;
    const saveFn =
      onSaveBossReportMonth ??
      (onSaveBossReportMonthsBatch
        ? (month: BossReportMonthData) => onSaveBossReportMonthsBatch([month])
        : saveBossReportMonth);

    const rawTarget =
      bossReportMonths[targetMonthKey] ?? createDefaultBossReportMonth(targetMonthKey);
    const rawSum = rawTarget.accounts.reduce(
      (sum, acc) => sum + (Number.isFinite(acc.balance) ? acc.balance : 0),
      0
    );
    const baseData: BossReportMonthData =
      targetMonthKey === selectedMonthKey &&
      rawTarget.manualOpeningBalance === undefined &&
      rawSum === 0 &&
      viewModel.hasPreviousMonthData
        ? {
            ...rawTarget,
            accounts: balanceAccountDetails.map((acc) => ({
              id: acc.id,
              name: acc.name,
              balance: acc.openingBalance,
              ...(acc.isPrimary ? { isPrimary: true } : {}),
            })),
          }
        : rawTarget;
    const next = updater(baseData);
    try {
      await saveFn({
        ...next,
        monthKey: targetMonthKey,
      });
      return true;
    } catch (err) {
      setExportError(
        err instanceof Error
          ? `Gagal menyimpan perubahan Realisasi: ${err.message}`
          : 'Gagal menyimpan perubahan Realisasi ke database.'
      );
      return false;
    }
  };

  const persistMonth = (updater: (prev: BossReportMonthData) => BossReportMonthData) =>
    persistMonthFor(selectedMonthKey, updater);

  // --- Saldo Awal & Account handlers (shared state with Projection) ---
  const handleSaveOpeningBalance = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBossMode) return;
    const trimmed = openingBalanceDraft.trim();
    if (!trimmed || trimmed === '-') {
      persistMonth((prev) => {
        const { manualOpeningBalance: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
      setOpeningBalanceDraft('');
      setCopyFeedback(
        `Saldo Awal ${viewModel.monthFullLabel} dikembalikan ke otomatis (sisa bulan lalu ${viewModel.previousMonthLabel}).`
      );
      window.setTimeout(() => setCopyFeedback(null), 4000);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const safeOpening = Math.round(parsed);

    persistMonth((prev) => ({
      ...prev,
      manualOpeningBalance: safeOpening,
    }));
    setCopyFeedback(
      `Saldo Awal ${viewModel.monthFullLabel} disimpan: ${formatSignedCurrency(safeOpening)}.`
    );
    window.setTimeout(() => setCopyFeedback(null), 4000);
  };

  const handleResetOpeningBalanceAuto = () => {
    if (isBossMode) return;
    persistMonth((prev) => {
      const { manualOpeningBalance: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
    setOpeningBalanceDraft('');
    setCopyFeedback(
      `Saldo Awal ${viewModel.monthFullLabel} menggunakan otomatis sisa bulan lalu (${viewModel.previousMonthLabel}).`
    );
    window.setTimeout(() => setCopyFeedback(null), 4000);
  };

  const handleUpdateAsOfDate = (nextDate: string) => {
    if (!nextDate) return;
    persistMonth((prev) => ({ ...prev, asOfDate: nextDate }));
  };

  const handleUpdateAccount = (
    accId: string,
    patch: Partial<Pick<BankAccountRow, 'name' | 'balance'>>
  ) => {
    persistMonth((prev) => {
      const prevDisplayed =
        balanceAccountDetails.find((a) => a.id === accId)?.openingBalance ?? 0;
      const nextAccounts = prev.accounts.map((acc) =>
        acc.id === accId ? { ...acc, ...patch } : acc
      );
      if (patch.balance !== undefined) {
        if (prev.manualOpeningBalance !== undefined) {
          const delta = patch.balance - prevDisplayed;
          return {
            ...prev,
            accounts: nextAccounts,
            manualOpeningBalance: Math.round(prev.manualOpeningBalance + delta),
          };
        }
        const nextSum = nextAccounts.reduce(
          (sum, acc) => sum + (Number.isFinite(acc.balance) ? acc.balance : 0),
          0
        );
        if (nextSum === 0 && viewModel.hasPreviousMonthData) {
          return {
            ...prev,
            accounts: nextAccounts,
            manualOpeningBalance: 0,
          };
        }
      }
      return {
        ...prev,
        accounts: nextAccounts,
      };
    });
  };

  const handleDeleteAccount = (accId: string) => {
    persistMonth((prev) => {
      const targetAcc = balanceAccountDetails.find((a) => a.id === accId);
      const removedBal = targetAcc?.openingBalance ?? 0;
      const filtered = prev.accounts.filter((acc) => acc.id !== accId);
      const hasPrimary = filtered.some((acc) => acc.isPrimary);
      const nextAccounts =
        !hasPrimary && filtered.length > 0
          ? filtered.map((acc, idx) => (idx === 0 ? { ...acc, isPrimary: true } : acc))
          : filtered;

      if (prev.manualOpeningBalance !== undefined) {
        return {
          ...prev,
          accounts: nextAccounts,
          manualOpeningBalance: Math.round(prev.manualOpeningBalance - removedBal),
        };
      }
      const nextSum = nextAccounts.reduce(
        (sum, acc) => sum + (Number.isFinite(acc.balance) ? acc.balance : 0),
        0
      );
      if (nextSum === 0 && viewModel.hasPreviousMonthData) {
        return {
          ...prev,
          accounts: nextAccounts,
          manualOpeningBalance: 0,
        };
      }
      return {
        ...prev,
        accounts: nextAccounts,
      };
    });
  };

  const handleAddAccount = (cleanName: string, safeBal: number) => {
    persistMonth((prev) => {
      const nextAccounts: BankAccountRow[] = [
        ...prev.accounts,
        {
          id: generateBossRowId('acc'),
          name: cleanName,
          balance: safeBal,
          ...(prev.accounts.length === 0 ? { isPrimary: true } : {}),
        },
      ];
      if (prev.manualOpeningBalance !== undefined) {
        return {
          ...prev,
          accounts: nextAccounts,
          manualOpeningBalance: Math.round(prev.manualOpeningBalance + safeBal),
        };
      }
      return {
        ...prev,
        accounts: nextAccounts,
      };
    });
  };

  // --- Copy Bulan Lalu ---
  const handleCopyPreviousMonth = () => {
    const prevKey = addMonthsToKey(selectedMonthKey, -1);
    const prevMonth = bossReportMonths[prevKey];
    const prevLabel = formatBossMonthFullLabel(prevKey);

    const prevVm = computeBossReportViewModel(
      prevKey,
      prevMonth ?? createDefaultBossReportMonth(prevKey),
      orders,
      clientInvoices,
      opexItems,
      investments,
      bossReportMonths
    );
    const prevEndingRealisasi = prevVm.endingBalanceRealisasi;
    const prevEndingAccounts = computeBalanceAccountDetails(prevVm);

    const prevHasAccounts = Boolean(
      prevEndingAccounts.some((acc) => acc.endingBalance !== 0)
    );
    const currAllZeroAccounts = activeMonthData.accounts.every((acc) => acc.balance === 0);

    if (!prevMonth && prevEndingRealisasi === 0) {
      setCopyFeedback(
        `Belum ada data Saldo Awal atau Saldo Rekening di ${prevLabel} untuk disalin.`
      );
      window.setTimeout(() => setCopyFeedback(null), 4000);
      return;
    }

    const shouldCopyAccounts = Boolean(currAllZeroAccounts && prevHasAccounts);
    const copiedAccounts: BankAccountRow[] = prevEndingAccounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
      balance: acc.endingBalance,
      ...(acc.isPrimary ? { isPrimary: true } : {}),
    }));

    persistMonth((prev) => ({
      ...prev,
      manualOpeningBalance: prevEndingRealisasi,
      ...(shouldCopyAccounts ? { accounts: copiedAccounts } : {}),
    }));
    setOpeningBalanceDraft(String(prevEndingRealisasi));

    setCopyFeedback(
      `Berhasil copy Saldo Awal (${formatSignedCurrency(prevEndingRealisasi)})${
        shouldCopyAccounts ? ' & Saldo Rekening' : ''
      } dari ${prevLabel}.`
    );
    window.setTimeout(() => setCopyFeedback(null), 4500);
  };

  // --- Row edit & Realisasi & Paid revision handlers (shared with Projection) ---
  const handleUpdateManualItem = (
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    itemId: string,
    patch: Partial<{ name: string; amount: number }>,
    targetMonthKey: string = selectedMonthKey
  ) => {
    persistMonthFor(targetMonthKey, (prev) => ({
      ...prev,
      [section]: prev[section].map((item) =>
        item.id === itemId ? { ...item, ...patch } : item
      ),
    }));
  };

  const handleUpdateRescheduledItem = (
    rescheduledItemId: string,
    patch: { name?: string; amount?: number },
    targetMonthKey: string = selectedMonthKey
  ) => {
    persistMonthFor(targetMonthKey, (prev) => ({
      ...prev,
      rescheduledIn: (prev.rescheduledIn ?? []).map((rs) =>
        rs.id === rescheduledItemId
          ? { ...rs, ...patch, hasCustomOverride: true }
          : rs
      ),
    }));
  };

  const handleUpdateAutoOverride = (
    row: BossReportComputedRow,
    patch: { name?: string; amount?: number },
    targetMonthKey: string = selectedMonthKey
  ) => {
    if (!row.sourceId) return;
    const sourceId = row.sourceId;
    persistMonthFor(targetMonthKey, (prev) => {
      const existing = prev.autoOverrides.find((o) => o.sourceId === sourceId);
      const base: BossReportAutoOverride = existing ?? {
        sourceId,
        hasCustomName: false,
        name: '',
        hasCustomAmount: false,
        amount: 0,
        hasCustomColor: false,
        color: 'white',
      };
      const updated: BossReportAutoOverride = {
        ...base,
        ...(patch.name !== undefined ? { hasCustomName: true, name: patch.name } : {}),
        ...(patch.amount !== undefined
          ? { hasCustomAmount: true, amount: patch.amount }
          : {}),
      };
      const rest = prev.autoOverrides.filter((o) => o.sourceId !== sourceId);
      return {
        ...prev,
        autoOverrides: [...rest, updated],
      };
    });
  };

  // Dedicated Realisasi edit handlers — save ONLY realisasi_amount/actual_amount/month_realisasi (NEVER Projection amount)
  const syncDirectSourceRealisasi = async (
    row: BossReportComputedRow,
    nextActualAmount: number,
    targetMonthKey: string
  ): Promise<void> => {
    if (
      row.sourceCategory === 'clientInvoice' ||
      row.clientInvoiceId ||
      row.sourceId?.startsWith('ci_')
    ) {
      const invoiceId = row.clientInvoiceId ?? row.sourceId?.replace(/^ci_/, '');
      if (invoiceId) {
        await updateClientInvoiceRealisasi(invoiceId, nextActualAmount);
        return;
      }
    }

    if (
      row.cashInSource === 'investmentDisbursement' ||
      row.sourceId?.startsWith('inv_disb_')
    ) {
      const assetId = row.investmentAssetId ?? row.sourceId?.replace(/^inv_disb_/, '');
      if (assetId) {
        await updateInvestmentRealisasi(assetId, {
          kind: 'disbursement',
          realisasiAmount: nextActualAmount,
        });
        return;
      }
    }

    if (
      row.sourceCategory === 'opex' ||
      row.opexId ||
      row.sourceId?.startsWith('opex_')
    ) {
      const opexId = row.opexId ?? row.sourceId?.replace(/^opex_/, '');
      if (opexId) {
        await updateOpexRealisasi(opexId, targetMonthKey, nextActualAmount);
        return;
      }
    }

    if (
      row.sourceCategory === 'investment' &&
      row.section === 'investment' &&
      row.investmentAssetId
    ) {
      await updateInvestmentRealisasi(row.investmentAssetId, {
        kind: 'component',
        monthKey: targetMonthKey,
        component: row.investmentComponent ?? 'principal',
        realisasiAmount: nextActualAmount,
      });
      return;
    }

    if (
      row.sourceCategory === 'vendorPO' ||
      row.poId ||
      row.sourceId?.startsWith('po_')
    ) {
      const poId = row.poId ?? row.sourceId?.replace(/^po_/, '');
      if (poId) {
        await updatePurchaseOrderRealisasi(poId, nextActualAmount);
      }
    }
  };

  const handleUpdateManualRealisasi = async (
    row: BossReportComputedRow,
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    itemId: string,
    nextActualAmount: number,
    targetMonthKey: string = selectedMonthKey
  ): Promise<boolean> => {
    if (isBossMode) return false;
    setExportError(null);
    if (row.section === 'cashIn') {
      setCashInStatusError(null);
    }
    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      const ok = await persistMonthFor(targetMonthKey, (prev) => ({
        ...prev,
        [section]: prev[section].map((item) =>
          item.id === itemId
            ? {
                ...item,
                actualAmount: nextActualAmount,
                realisasiAmount: nextActualAmount,
                actual_amount: nextActualAmount,
              }
            : item
        ),
      }));
      if (ok) {
        setCopyFeedback(
          `Realisasi "${row.name}" disimpan: ${formatSignedCurrency(nextActualAmount)} (Projected tetap ${formatSignedCurrency(row.projectedAmount)}).`
        );
        window.setTimeout(() => setCopyFeedback(null), 4000);
      }
      return ok;
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }
  };

  const handleUpdateRescheduledRealisasi = async (
    row: BossReportComputedRow,
    rescheduledItemId: string,
    nextActualAmount: number,
    targetMonthKey: string = selectedMonthKey
  ): Promise<boolean> => {
    if (isBossMode) return false;
    setExportError(null);
    if (row.section === 'cashIn') {
      setCashInStatusError(null);
    }
    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      if (row.sourceCategory !== 'manual') {
        await syncDirectSourceRealisasi(row, nextActualAmount, targetMonthKey);
      }
      const ok = await persistMonthFor(targetMonthKey, (prev) => ({
        ...prev,
        rescheduledIn: (prev.rescheduledIn ?? []).map((rs) =>
          rs.id === rescheduledItemId
            ? {
                ...rs,
                hasCustomRealisasi: true,
                realisasiAmount: nextActualAmount,
                actual_amount: nextActualAmount,
              }
            : rs
        ),
      }));
      if (ok) {
        setCopyFeedback(
          `Realisasi "${row.name}" disimpan: ${formatSignedCurrency(nextActualAmount)} (Projected tetap ${formatSignedCurrency(row.projectedAmount)}).`
        );
        window.setTimeout(() => setCopyFeedback(null), 4000);
      }
      return ok;
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? `Gagal menyimpan Realisasi "${row.name}" ke Supabase: ${err.message}`
          : `Gagal menyimpan Realisasi "${row.name}" ke Supabase.`;
      setExportError(errMsg);
      if (row.section === 'cashIn') {
        setCashInStatusError(errMsg);
      }
      return false;
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }
  };

  const handleUpdateAutoRealisasi = async (
    row: BossReportComputedRow,
    nextActualAmount: number,
    targetMonthKey: string = selectedMonthKey
  ): Promise<boolean> => {
    if (isBossMode || !row.sourceId) return false;
    const sourceId = row.sourceId;
    setExportError(null);
    if (row.section === 'cashIn') {
      setCashInStatusError(null);
    }
    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      await syncDirectSourceRealisasi(row, nextActualAmount, targetMonthKey);
      const ok = await persistMonthFor(targetMonthKey, (prev) => {
        const existing = prev.autoOverrides.find((o) => o.sourceId === sourceId);
        const base: BossReportAutoOverride = existing ?? {
          sourceId,
          hasCustomName: false,
          name: '',
          hasCustomAmount: false,
          amount: 0,
          hasCustomColor: false,
          color: 'white',
        };
        const updated: BossReportAutoOverride = {
          ...base,
          hasCustomRealisasi: true,
          realisasiAmount: nextActualAmount,
          actual_amount: nextActualAmount,
        };
        const rest = prev.autoOverrides.filter((o) => o.sourceId !== sourceId);
        return {
          ...prev,
          autoOverrides: [...rest, updated],
        };
      });
      if (ok) {
        setCopyFeedback(
          `Realisasi "${row.name}" disimpan: ${formatSignedCurrency(nextActualAmount)} (Projected tetap ${formatSignedCurrency(row.projectedAmount)}).`
        );
        window.setTimeout(() => setCopyFeedback(null), 4000);
      }
      return ok;
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? `Gagal menyimpan Realisasi "${row.name}" ke Supabase: ${err.message}`
          : `Gagal menyimpan Realisasi "${row.name}" ke Supabase.`;
      setExportError(errMsg);
      if (row.section === 'cashIn') {
        setCashInStatusError(errMsg);
      }
      return false;
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }
  };

  const actorDisplayName = currentActor?.name || 'Admin KKB';

  const executeRowStatusChange = async (
    row: BossReportComputedRow,
    nextColor: BossReportColorStatus,
    revisionDetails?: { reason: string; revisionDateISO: string },
    targetMonthKey?: string
  ) => {
    if (isBossMode) return;
    if (nextColor === row.color && nextColor !== 'red') return;

    const rowMonthKey = row.sourceMonthKey ?? selectedMonthKey;
    const baseRowKey = row.rowKey.replace(/__\d{4}-\d{2}$/, '');
    const normalizedRow: BossReportComputedRow =
      baseRowKey !== row.rowKey ? { ...row, rowKey: baseRowKey } : row;
    const planViewModel = isRange
      ? computeBossReportViewModel(
          rowMonthKey,
          autoPreviewMonthsMap[rowMonthKey] ?? createDefaultBossReportMonth(rowMonthKey),
          orders,
          clientInvoices,
          opexItems,
          investments,
          autoPreviewMonthsMap,
          { cutoffPeriod }
        )
      : viewModel;

    const prevColor = row.color;
    const resolvedTargetMonthKey =
      nextColor === 'red'
        ? targetMonthKey || addMonthsToKey(rowMonthKey, 1)
        : undefined;
    const plan = buildProjectionColorChangePlan({
      row: normalizedRow,
      nextColor,
      currentMonthKey: rowMonthKey,
      viewModel: planViewModel,
      bossReportMonths,
      investments,
      opexItems,
      targetMonthKey: resolvedTargetMonthKey,
    });

    setExportError(null);
    if (row.section === 'cashIn') {
      setCashInStatusError(null);
    }
    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));

    try {
      if (onSyncProjectionSource) {
        const actions =
          plan.sourceSyncActions.length > 0
            ? plan.sourceSyncActions
            : plan.sourceSyncAction
              ? [plan.sourceSyncAction]
              : [];
        for (const syncAct of actions) {
          await onSyncProjectionSource(syncAct);
        }
      }

      if (onSaveBossReportMonthsBatch) {
        await onSaveBossReportMonthsBatch(plan.monthsToSave);
      } else if (onSaveBossReportMonth) {
        for (const monthToSave of plan.monthsToSave) {
          await onSaveBossReportMonth(monthToSave);
        }
      }
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? `Gagal menyinkronkan status "${row.name}" ke Supabase: ${err.message}`
          : `Gagal menyinkronkan status "${row.name}" ke database Supabase.`;
      setExportError(errMsg);
      if (row.section === 'cashIn') {
        setCashInStatusError(errMsg);
      }
      return;
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }

    const todayISO = getTodayISODate();
    const revDateISO = revisionDetails?.revisionDateISO || todayISO;
    const isCancelPaid = prevColor === 'green' && (nextColor === 'white' || nextColor === 'red');
    const isMarkPaid = nextColor === 'green';

    if (isCancelPaid || isMarkPaid) {
      const actionType = isCancelPaid ? 'CANCEL_PAID' : 'MARK_PAID';
      const componentLabel = getRowComponentLabel(row);
      const reasonText = isCancelPaid
        ? (revisionDetails?.reason ?? '').trim() || 'Revisi status Paid'
        : 'Pelunasan';

      const createdRecord = appendProjectionRevisionRecord({
        monthKey: rowMonthKey,
        rowKey: baseRowKey,
        sourceId: row.sourceId || baseRowKey,
        rowName: row.name,
        amount: row.amount,
        ...(row.investmentAssetId ? { investmentAssetId: row.investmentAssetId } : {}),
        ...(row.investmentComponent ? { investmentComponent: row.investmentComponent } : {}),
        componentLabel,
        fromColor: prevColor,
        toColor: nextColor,
        actionType,
        reason: reasonText,
        revisionDateISO: revDateISO,
        actorName: actorDisplayName,
      });
      setLocalRevisions((prev) => [createdRecord, ...prev]);

      if (onLogProjectionStatusRevision) {
        const entityType: AuditEntityType =
          row.sourceCategory === 'investment' && row.investmentAssetId
            ? 'INVESTMENT'
            : 'REPORT';
        const entityId =
          row.sourceCategory === 'investment' && row.investmentAssetId
            ? row.investmentAssetId
            : row.clientInvoiceId || row.poId || row.opexId || row.sourceId || baseRowKey;
        const auditAction = isCancelPaid
          ? PROJECTION_CANCEL_PAID_ACTION
          : PROJECTION_MARK_PAID_ACTION;
        const summary = buildProjectionAuditSummary({
          revisionDateISO: revDateISO,
          componentLabel,
          monthKey: rowMonthKey,
          rowName: row.name,
          amount: row.amount,
          fromColor: prevColor,
          toColor: nextColor,
          actionType,
          actorName: actorDisplayName,
          reason: reasonText,
        });
        onLogProjectionStatusRevision({
          action: auditAction,
          entityType,
          entityId,
          entityLabel: `${row.name} · ${rowMonthKey}`.slice(0, 160),
          summary,
          dateISO: revDateISO,
        });
      }
    }

    if (isCancelPaid) {
      const destMonthKey =
        resolvedTargetMonthKey ?? addMonthsToKey(rowMonthKey, 1);
      const targetMsg =
        nextColor === 'red'
          ? `Pending (dipindah ke ${formatBossMonthFullLabel(
              destMonthKey
            )})`
          : 'Projection';
      const isInvPrincipal =
        row.sourceCategory === 'investment' && row.investmentComponent === 'principal';
      setCopyFeedback(
        `Pelunasan "${row.name}" dibatalkan (${targetMsg}) dan dipindahkan kembali ke Projection. ${
          isInvPrincipal
            ? `Sisa Pokok kembali menjadi Rp ${formatIDR(
                row.amount
              )} dan Bunga berjalan kembali bulan berikutnya. `
            : ''
        }Alasan: "${revisionDetails?.reason ?? '-'}".`
      );
      window.setTimeout(() => setCopyFeedback(null), 6000);
    }
  };

  const openCancelPaidModal = (row: BossReportComputedRow, targetColor: 'white' | 'red') => {
    if (isBossMode) return;
    const rowMonthKey = row.sourceMonthKey ?? selectedMonthKey;
    setCancelPaidModal({
      row,
      targetColor,
      targetMonthKey: addMonthsToKey(rowMonthKey, 1),
      reason: '',
      revisionDateISO: getTodayISODate(),
    });
  };

  // --- Share Boss Mode ---
  const handleShareToBoss = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'bos');
    url.searchParams.set('tab', 'balance');
    url.searchParams.set('from', activeStartMonthKey);
    url.searchParams.set('to', activeEndMonthKey);
    const bossUrl = url.toString();
    setShareUrl(bossUrl);

    try {
      await navigator.clipboard.writeText(bossUrl);
      setShareStatus('copied');
      window.setTimeout(() => setShareStatus('idle'), 4500);
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = bossUrl;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setShareStatus('copied');
        window.setTimeout(() => setShareStatus('idle'), 4500);
      } catch {
        setShareStatus('fallback');
      }
    }
  };

  // --- Export ---
  const handleDownloadExcel = () => {
    setExportError(null);
    try {
      exportBalanceReportToExcel(viewModel);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Gagal membuat file Excel Realisasi.'
      );
    }
  };

  const handleDownloadPDF = () => {
    setExportError(null);
    try {
      exportBalanceReportToPDF(viewModel);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Gagal membuat file PDF Realisasi.'
      );
    }
  };

  const renderPaidRows = (
    rows: BossReportComputedRow[],
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    includeSaldoColumn = false,
    includeSourceColumn = false
  ) => {
    return rows.map((row) => {
      const style = getRowStyling(row.color);
      const rowMonthKey = row.sourceMonthKey ?? selectedMonthKey;
      const baseRowKey = row.rowKey.replace(/__\d{4}-\d{2}$/, '');
      const normalizedRowForRev =
        baseRowKey !== row.rowKey ? { ...row, rowKey: baseRowKey } : row;
      const revStats = getRowRevisionStats(
        normalizedRowForRev,
        rowMonthKey,
        localRevisions,
        auditLogs
      );
      const hasBadges = Boolean(
        row.dueBadgeLabel ||
          row.rescheduleLabel ||
          revStats.revisionCount > 0 ||
          isRange
      );

      return (
        <tr key={row.rowKey} className={`${style.rowClass} border-b border-slate-200 transition-colors`}>
          <td className="py-2.5 px-4 align-middle">
            <InlineTextCell
              value={row.name}
              subtitle={row.subtitle}
              disabled={isBossMode}
              onCommit={(nextName) => {
                if (row.isRescheduledIn && row.rescheduledItemId) {
                  handleUpdateRescheduledItem(
                    row.rescheduledItemId,
                    { name: nextName },
                    rowMonthKey
                  );
                } else if (row.isAuto) {
                  handleUpdateAutoOverride(row, { name: nextName }, rowMonthKey);
                } else if (row.sourceId) {
                  handleUpdateManualItem(
                    manualSection,
                    row.sourceId,
                    { name: nextName },
                    rowMonthKey
                  );
                }
              }}
            />
            {hasBadges && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {isRange && row.sourceMonthKey && (
                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300 rounded">
                    {formatBossMonthShortLabel(row.sourceMonthKey)}
                  </span>
                )}
                {row.dueBadgeLabel && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold border rounded ${
                      row.dueBadgeTone === 'amber'
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-red-600 text-white border-red-700'
                    }`}
                  >
                    {row.dueBadgeLabel}
                  </span>
                )}
                {row.rescheduleLabel && (
                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                    {row.rescheduleLabel}
                  </span>
                )}
                {revStats.revisionCount > 0 && (
                  <span
                    title={`Alasan revisi terakhir (${formatSlashDateDDMMYYYY(
                      revStats.lastDateISO
                    )}): "${revStats.lastReason}"`}
                    className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 rounded cursor-help"
                  >
                    Pernah Direvisi {revStats.revisionCount}x
                  </span>
                )}
              </div>
            )}
          </td>

          {includeSourceColumn && (
            <td className="py-2.5 px-4 align-middle text-xs font-medium text-slate-700 whitespace-nowrap">
              {getCashInSourceLabel(row.cashInSource)}
            </td>
          )}

          {/* Nominal (Projection) asli — tidak berubah ketika Realisasi diedit */}
          <td className="py-2.5 px-4 text-right align-middle whitespace-nowrap">
            <span
              className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-slate-700"
              title="Nominal Projection asli (tidak berubah saat Realisasi diedit)"
            >
              {formatSignedCurrency(row.projectedAmount)}
            </span>
          </td>

          {/* Realisasi (Paid) — bisa diedit manual tanpa mengubah nominal Projection */}
          <td className="py-2.5 px-4 text-right align-middle whitespace-nowrap">
            <InlineRealisasiCell
              value={row.realisasiAmount}
              disabled={isBossMode}
              onCommit={(nextAmount) => {
                if (row.isRescheduledIn && row.rescheduledItemId) {
                  return handleUpdateRescheduledRealisasi(
                    row,
                    row.rescheduledItemId,
                    nextAmount,
                    rowMonthKey
                  );
                } else if (row.isAuto) {
                  return handleUpdateAutoRealisasi(row, nextAmount, rowMonthKey);
                } else if (row.sourceId) {
                  return handleUpdateManualRealisasi(
                    row,
                    manualSection,
                    row.sourceId,
                    nextAmount,
                    rowMonthKey
                  );
                }
                return false;
              }}
            />
          </td>

          {includeSaldoColumn && (
            <td className="py-2.5 px-4 text-right align-middle font-mono text-xs sm:text-sm tabular-nums text-slate-400 whitespace-nowrap">
              -
            </td>
          )}

          {/* Status Warna + tombol Batalkan Paid / Revisi */}
          <td className="py-2.5 px-4 align-middle whitespace-nowrap">
            {isBossMode ? (
              <span
                className={`inline-block px-2 py-0.5 text-[11px] font-semibold border rounded ${style.badgeClass}`}
              >
                {style.label}
              </span>
            ) : (
              <div className="flex items-center gap-1.5">
                <StatusWarnaDropdown
                  value={row.color}
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  ariaLabel={`Status warna untuk ${row.name}`}
                  onSelect={(nextColor) => {
                    if (nextColor === 'red') {
                      openCancelPaidModal(row, 'red');
                    }
                  }}
                />
                {savingRowKeys[row.rowKey] && (
                  <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                    Menyimpan...
                  </span>
                )}
                <button
                  type="button"
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  onClick={() => openCancelPaidModal(row, 'white')}
                  title="Batalkan status Paid / Revisi ke Projection"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3 shrink-0" />
                  Batalkan Paid / Revisi
                </button>
              </div>
            )}
          </td>
        </tr>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-14 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode Switch Toggle: Projection | Realisasi */}
      {onSwitchToProjection && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-1 inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onSwitchToProjection}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Projection
            </button>
            <button
              type="button"
              aria-current="page"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white transition-colors whitespace-nowrap shrink-0 cursor-default"
            >
              Realisasi
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Menampilkan item berstatus <strong className="text-emerald-700">Paid</strong> saja (real-time dari Projection)
          </p>
        </div>
      )}

      {/* Top Toolbar: Month Selector, Input Saldo Awal, Copy Bulan Lalu, Excel, PDF, Bagikan ke Bos */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <PeriodeSelector
            monthKey={activeStartMonthKey}
            startMonth={activeStartMonth}
            startYear={activeStartYear}
            endMonth={activeEndMonth}
            endYear={activeEndYear}
            onChangeStart={handleStartPeriodChange}
            onChangeEnd={handleEndPeriodChange}
            onSelectSingleMonth={(nextMo, nextYr) =>
              setSelectedMonthKey(formatMonthKeyParts(nextYr, nextMo))
            }
            onChangeRange={onChangeRange}
            ariaLabelPrefix="realisasi"
          />

          {!isBossMode && (
            <form
              onSubmit={handleSaveOpeningBalance}
              className="flex flex-wrap items-center gap-2 xl:border-l xl:border-slate-200 xl:pl-3"
            >
              <label
                htmlFor="balance-saldo-awal-input"
                className="text-xs font-semibold text-slate-700 whitespace-nowrap"
              >
                {isRange
                  ? `Saldo Awal (${formatBossMonthShortLabel(activeStartMonthKey)}):`
                  : 'Saldo Awal Bulan Ini:'}
              </label>
              <div className="relative w-44 sm:w-48">
                <span className="text-xs font-mono text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  id="balance-saldo-awal-input"
                  allowNegative
                  value={openingBalanceDraft}
                  onValueChange={setOpeningBalanceDraft}
                  placeholder={
                    autoFallbackOpeningBalance !== 0
                      ? formatIDR(autoFallbackOpeningBalance)
                      : 'Otomatis bulan lalu'
                  }
                  className="w-full h-9 pl-8 pr-2.5 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Simpan Saldo Awal
              </button>
              {activeMonthData.manualOpeningBalance !== undefined && (
                <button
                  type="button"
                  onClick={handleResetOpeningBalanceAuto}
                  title="Kosongkan input manual dan pakai Ending Balance Realisasi bulan lalu otomatis"
                  className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Otomatis
                </button>
              )}
            </form>
          )}

          {!isBossMode && (
            <button
              type="button"
              onClick={handleCopyPreviousMonth}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Salin Saldo Awal & Saldo Rekening dari bulan lalu ke bulan ini"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Bulan Lalu
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={handleDownloadExcel}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Download Excel
              </button>

              <button
                type="button"
                onClick={handleDownloadPDF}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download PDF
              </button>
            </>
          )}

          {!isBossMode && (
            <button
              type="button"
              onClick={handleShareToBoss}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {shareStatus === 'copied' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Link Mode Bos Disalin
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  Bagikan ke Bos
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Feedback banners */}
      {copyFeedback && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-900 flex items-center justify-between gap-2">
          <span>{copyFeedback}</span>
          <button
            type="button"
            onClick={() => setCopyFeedback(null)}
            className="font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {!isBossMode && (shareStatus === 'copied' || shareStatus === 'fallback') && shareUrl && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-900">
          <div className="min-w-0">
            <p className="font-semibold">
              {shareStatus === 'copied'
                ? 'Link Mode Bos Realisasi (Read-Only) berhasil disalin:'
                : 'Salin link Mode Bos Realisasi berikut secara manual:'}
            </p>
            <p className="font-mono text-[11px] text-emerald-800 break-all mt-0.5">
              {shareUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(shareUrl).catch(() => {})}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-emerald-300 text-emerald-800 rounded-md font-medium shrink-0 self-start sm:self-center cursor-pointer"
          >
            <Copy className="w-3 h-3" />
            Salin Ulang
          </button>
        </div>
      )}

      {exportError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 flex items-center justify-between gap-3"
        >
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* 6 KPI Cards — Exact Same Grid, Position & Colors as Projection */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3.5">
        {/* Card 1 - SALDO AWAL */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
            Saldo Awal
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-blue-950 mt-1.5">
            {formatSignedCurrency(viewModel.saldoAwal)}
          </p>
          <p className="text-[11px] text-blue-700 mt-1 tabular-nums">
            Sisa bulan lalu - {viewModel.previousMonthLabel}
            {viewModel.saldoAwalSource === 'manual' ? ' · Manual' : ''}
          </p>
        </div>

        {/* Card 2 - CASH IN (REALISASI) */}
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
            Cash In (Realisasi)
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            {formatSignedCurrency(viewModel.totalCashInRealisasi)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidCashInRows.length} item Paid
          </p>
        </div>

        {/* Card 3 - CASH OUT OPEX (REALISASI) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Cash Out Opex (Realisasi)
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatSignedCurrency(viewModel.totalOperasionalRealisasi)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidOperasionalRows.length} item Paid
          </p>
        </div>

        {/* Card 4 - CASH OUT INVESTMENT (REALISASI) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Cash Out Investment (Realisasi)
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatSignedCurrency(viewModel.totalInvestmentRealisasi)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidInvestmentRows.length} item Paid
          </p>
        </div>

        {/* Card 5 - CASH OUT PROJECT COST (REALISASI) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Cash Out Project Cost (Realisasi)
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatSignedCurrency(viewModel.totalProjectRealisasi)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidProjectCostRows.length} item Paid
          </p>
        </div>

        {/* Card 6 - SALDO TERSEDIA (REAL) */}
        <div
          className={`border rounded-xl p-4 ${
            isMinusReal
              ? 'bg-red-50 border-red-300 text-red-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Saldo Tersedia (Real)
          </p>
          <p
            className={`text-lg sm:text-xl font-extrabold font-mono tabular-nums mt-1.5 ${
              isMinusReal ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {formatSignedCurrency(viewModel.endingBalanceRealisasi)}
          </p>
          <p className="text-[11px] font-bold mt-1 tabular-nums">
            {isMinusReal ? 'MINUS — BUTUH DANA' : 'POSITIF / AMAN'} · Projected:{' '}
            {formatSignedCurrency(viewModel.endingBalance)}
          </p>
        </div>
      </section>

      {/* Grafik + Komposisi Cash Out Bulan Ini (Realisasi Paid Only) */}
      <CashflowChartCard
        series={realisasiChartSeries}
        selectedMonthKey={activeStartMonthKey}
        selectedEndMonthKey={activeEndMonthKey}
        isRange={isRange}
        onSelectMonth={(mk) => setSelectedMonthKey(mk)}
        totalOperasional={viewModel.totalOperasionalRealisasi}
        totalInvestment={viewModel.totalInvestmentRealisasi}
        totalProjectCost={viewModel.totalProjectRealisasi}
        totalCost={viewModel.totalCostRealisasi}
        totalCashIn={viewModel.totalCashInRealisasi}
        title={
          isRange
            ? `Grafik Cash In vs Cash Out & Trend Saldo Tersedia (${realisasiChartSeries.length} Bulan)`
            : 'Grafik Cash In vs Cash Out & Trend Saldo Tersedia (6 Bulan)'
        }
        subtitle="Perbandingan realisasi arus kas bulanan (Paid) dan tren saldo tersedia · klik bulan pada grafik untuk berpindah periode"
        cashInLabel="Cash In Paid"
        cashOutLabel="Cash Out Paid"
        trendLabel="Trend Saldo Tersedia (Real)"
        endingTooltipLabel="Saldo Tersedia"
        emptyCompositionLabel="Belum ada realisasi"
        ariaLabel={`Grafik perbandingan Cash In Paid vs Cash Out Paid dan Trend Saldo Tersedia ${realisasiChartSeries.length} bulan`}
      />

      {/* ================================================================= */}
      {/* 1. DETAIL SALDO REKENING & ENDING BALANCE (4 KOLOM SEDERHANA)     */}
      {/* ================================================================= */}
      <AccountBalanceTableCard
        asOfDate={viewModel.asOfDate}
        accounts={balanceAccountDetails}
        totalOpeningBalance={viewModel.saldoAwal}
        totalEndingBalance={viewModel.endingBalanceRealisasi}
        isBossMode={isBossMode}
        onUpdateAsOfDate={handleUpdateAsOfDate}
        onUpdateAccount={handleUpdateAccount}
        onAddAccount={handleAddAccount}
        onDeleteAccount={handleDeleteAccount}
        onBackToProjection={onSwitchToProjection}
      />

      {/* ================================================================= */}
      {/* 2. SALDO AWAL & CASH IN REALISASI [NAMA BULAN]                    */}
      {/* ================================================================= */}
      <section className="bg-white border border-slate-300 rounded-xl overflow-hidden">
        <div className="bg-emerald-800 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Cash In Realisasi {viewModel.monthNameOnly}
            </h2>
            <p className="text-[11px] text-emerald-100 mt-0.5">
              Saldo Awal terpisah di atas · Hanya menampilkan item Cash In berstatus Paid ({paidCashInRows.length} item)
            </p>
          </div>
          {onSwitchToProjection && (
            <button
              type="button"
              onClick={onSwitchToProjection}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white text-emerald-900 hover:bg-emerald-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Kelola di Projection
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Cash In per Sumber */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600 mr-1">Filter Sumber:</span>
            {(
              [
                { value: 'all', label: 'Semua', count: cashInSourceStats.all },
                { value: 'invoice', label: 'Invoice', count: cashInSourceStats.invoice },
                {
                  value: 'investmentDisbursement',
                  label: 'Pencairan Pinjaman Investment',
                  count: cashInSourceStats.investmentDisbursement,
                },
                { value: 'manual', label: 'Manual', count: cashInSourceStats.manual },
              ] as const
            ).map((tab) => {
              const active = cashInSourceFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setCashInSourceFilter(tab.value)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-emerald-800 text-white border-emerald-800'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>
          {cashInSourceFilter !== 'all' && (
            <span className="text-[11px] font-mono tabular-nums text-slate-600">
              Subtotal filter: {formatSignedCurrency(filteredCashInRealisasiTotal)}
            </span>
          )}
        </div>

        {cashInStatusError && (
          <div
            role="alert"
            className="mx-4 mt-3 bg-red-50 border border-red-300 rounded-lg px-3.5 py-2.5 text-xs text-red-800 flex items-center justify-between gap-3"
          >
            <span>{cashInStatusError}</span>
            <button
              type="button"
              onClick={() => setCashInStatusError(null)}
              className="font-semibold hover:underline shrink-0 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-xs font-bold text-slate-700">
                <th className="py-2.5 px-4">Nama Item</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Sumber</th>
                <th className="py-2.5 px-4 text-right w-44 whitespace-nowrap">
                  Projected
                </th>
                <th className="py-2.5 px-4 text-right w-40 whitespace-nowrap">
                  Realisasi (Paid)
                </th>
                <th className="py-2.5 px-4 text-right w-44 whitespace-nowrap">
                  Saldo
                </th>
                <th className="py-2.5 px-4 w-56">Status Warna</th>
              </tr>
            </thead>
            <tbody>
              {/* Separate First Row: SALDO AWAL */}
              <tr className="bg-blue-50/80 border-b-2 border-blue-200">
                <td className="py-3 px-4 align-middle">
                  <div className="text-xs sm:text-sm font-bold text-blue-950 tracking-wide">
                    SALDO AWAL
                  </div>
                  <div className="text-[11px] text-blue-700 mt-0.5">
                    Sisa bulan lalu - {viewModel.previousMonthLabel}
                    {viewModel.saldoAwalSource === 'manual' ? ' · Input manual' : ''}
                  </div>
                </td>
                <td className="py-3 px-4 align-middle text-xs text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-3 px-4 text-right align-middle font-mono text-xs sm:text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-3 px-4 text-right align-middle font-mono text-xs sm:text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-3 px-4 text-right align-middle font-mono text-xs sm:text-sm font-bold text-blue-900 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(viewModel.saldoAwal)}
                </td>
                <td className="py-3 px-4 align-middle whitespace-nowrap">
                  <span className="text-xs font-semibold text-blue-800">Saldo Awal</span>
                </td>
              </tr>

              {filteredPaidCashInRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                  >
                    {cashInSourceFilter !== 'all'
                      ? `Belum ada realisasi Cash In untuk sumber "${getCashInSourceLabel(cashInSourceFilter)}" di ${viewModel.monthFullLabel}.`
                      : `Belum ada realisasi di ${isRange ? 'periode' : 'bulan'} ini. Semua masih Projection / Pending.`}
                  </td>
                </tr>
              ) : (
                renderPaidRows(filteredPaidCashInRows, 'cashInManual', true, true)
              )}
            </tbody>
            <tfoot>
              {cashInSourceFilter !== 'all' && (
                <tr className="bg-slate-50 border-t border-slate-200">
                  <td className="py-2 px-4 text-xs font-semibold text-slate-700" colSpan={2}>
                    Subtotal Filter ({getCashInSourceLabel(cashInSourceFilter)})
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-xs font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                    {formatSignedCurrency(filteredCashInProjectedTotal)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-xs font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                    {formatSignedCurrency(filteredCashInRealisasiTotal)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-xs text-slate-400 whitespace-nowrap">
                    -
                  </td>
                  <td className="py-2 px-4" />
                </tr>
              )}
              <tr className="bg-emerald-50 border-t-2 border-emerald-200">
                <td className="py-2.5 px-4 text-sm font-bold text-emerald-950" colSpan={2}>
                  TOTAL CASH IN REALISASI ({paidCashInRows.length} ITEM PAID)
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-sm font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(paidCashInProjectedTotal)}
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-sm font-bold text-emerald-800 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(viewModel.totalCashInRealisasi)}
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-2.5 px-4" />
              </tr>
              <tr className="bg-emerald-100/90 border-t border-emerald-300">
                <td className="py-3.5 px-4 text-base sm:text-lg font-extrabold text-emerald-950" colSpan={2}>
                  Account Balance Realisasi
                  <span className="block text-[11px] font-medium text-emerald-800">
                    Saldo Awal + TOTAL CASH IN REALISASI (Paid)
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-base sm:text-lg font-extrabold text-emerald-950 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(accountBalanceRealisasi)}
                </td>
                <td className="py-3.5 px-4" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 3. CASH OUT REALISASI (A. OPERASIONAL, B. INVESTMENT, C. PROJECT) */}
      {/* ================================================================= */}
      <section className="bg-white border border-slate-300 rounded-xl overflow-hidden">
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Cash Out Realisasi {viewModel.monthNameOnly}
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Hanya menampilkan item berstatus Paid · Item Projection &amp; Pending tidak termasuk di sini
            </p>
          </div>
          <div className="text-xs font-mono font-bold tabular-nums text-emerald-300 flex flex-wrap items-center gap-3">
            <span>
              TOTAL ({totalCashOutPaidCount} ITEM PAID): {formatSignedCurrency(viewModel.totalCostRealisasi)}
            </span>
          </div>
        </div>

        {/* GROUP A: OPERASIONAL */}
        <div className="border-b border-slate-300">
          <div className="bg-slate-200/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-300">
            <button
              type="button"
              onClick={() =>
                setCollapsedGroups((p) => ({ ...p, operasional: !p.operasional }))
              }
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-900 cursor-pointer"
            >
              {collapsedGroups.operasional ? (
                <ChevronRight className="w-4 h-4 text-slate-700" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-700" />
              )}
              <span>A. OPERASIONAL</span>
              <span className="text-xs font-normal text-slate-600 tabular-nums">
                ({paidOperasionalRows.length} item Paid · Realisasi:{' '}
                <strong className="font-mono text-emerald-800">
                  {formatSignedCurrency(viewModel.totalOperasionalRealisasi)}
                </strong>
                )
              </span>
            </button>

            {!isBossMode && onNavigateOpex && (
              <button
                type="button"
                onClick={onNavigateOpex}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
              >
                Kelola di Opex
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>

          {!collapsedGroups.operasional && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-2 px-4">Nama Item</th>
                    <th className="py-2 px-4 text-right w-44 whitespace-nowrap">
                      Projected
                    </th>
                    <th className="py-2 px-4 text-right w-40 whitespace-nowrap">
                      Realisasi (Paid)
                    </th>
                    <th className="py-2 px-4 w-56">Status Warna</th>
                  </tr>
                </thead>
                <tbody>
                  {paidOperasionalRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-5 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                      >
                        {`Belum ada realisasi di ${isRange ? 'periode' : 'bulan'} ini. Semua masih Projection / Pending.`}
                      </td>
                    </tr>
                  ) : (
                    renderPaidRows(paidOperasionalRows, 'operasional')
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-300">
                    <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
                      Total Operasional Realisasi ({paidOperasionalRows.length} item Paid)
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(paidOperasionalProjectedTotal)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-emerald-800 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(viewModel.totalOperasionalRealisasi)}
                    </td>
                    <td className="py-2.5 px-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* GROUP B: INVESTMENT */}
        <div className="border-b border-slate-300">
          <div className="bg-slate-200/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-300">
            <button
              type="button"
              onClick={() =>
                setCollapsedGroups((p) => ({ ...p, investment: !p.investment }))
              }
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-900 cursor-pointer"
            >
              {collapsedGroups.investment ? (
                <ChevronRight className="w-4 h-4 text-slate-700" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-700" />
              )}
              <span>B. INVESTMENT</span>
              <span className="text-xs font-normal text-slate-600 tabular-nums">
                ({paidInvestmentRows.length} item Paid · Realisasi:{' '}
                <strong className="font-mono text-emerald-800">
                  {formatSignedCurrency(viewModel.totalInvestmentRealisasi)}
                </strong>
                )
              </span>
            </button>

            {!isBossMode && onNavigateInvestment && (
              <button
                type="button"
                onClick={onNavigateInvestment}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
              >
                Kelola di Investment
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>

          {!collapsedGroups.investment && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-2 px-4">Nama Item</th>
                    <th className="py-2 px-4 text-right w-44 whitespace-nowrap">
                      Projected
                    </th>
                    <th className="py-2 px-4 text-right w-40 whitespace-nowrap">
                      Realisasi (Paid)
                    </th>
                    <th className="py-2 px-4 w-56">Status Warna</th>
                  </tr>
                </thead>
                <tbody>
                  {paidInvestmentRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-5 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                      >
                        {`Belum ada realisasi di ${isRange ? 'periode' : 'bulan'} ini. Semua masih Projection / Pending.`}
                      </td>
                    </tr>
                  ) : (
                    renderPaidRows(paidInvestmentRows, 'investment')
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-300">
                    <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
                      Total Investment Realisasi ({paidInvestmentRows.length} item Paid)
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(paidInvestmentProjectedTotal)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-emerald-800 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(viewModel.totalInvestmentRealisasi)}
                    </td>
                    <td className="py-2.5 px-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* GROUP C: PROJECT COST */}
        <div>
          <div className="bg-slate-200/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-300">
            <button
              type="button"
              onClick={() =>
                setCollapsedGroups((p) => ({ ...p, projectCost: !p.projectCost }))
              }
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-900 cursor-pointer"
            >
              {collapsedGroups.projectCost ? (
                <ChevronRight className="w-4 h-4 text-slate-700" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-700" />
              )}
              <span>C. PROJECT COST (PO Vendor Paid + Manual Paid)</span>
              <span className="text-xs font-normal text-slate-600 tabular-nums">
                ({paidProjectCostRows.length} item Paid · Realisasi:{' '}
                <strong className="font-mono text-emerald-800">
                  {formatSignedCurrency(viewModel.totalProjectRealisasi)}
                </strong>
                )
              </span>
            </button>
          </div>

          {!collapsedGroups.projectCost && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-2 px-4">Nama Item</th>
                    <th className="py-2 px-4 text-right w-44 whitespace-nowrap">
                      Projected
                    </th>
                    <th className="py-2 px-4 text-right w-40 whitespace-nowrap">
                      Realisasi (Paid)
                    </th>
                    <th className="py-2 px-4 w-56">Status Warna</th>
                  </tr>
                </thead>
                <tbody>
                  {paidProjectCostRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-5 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                      >
                        {`Belum ada realisasi di ${isRange ? 'periode' : 'bulan'} ini. Semua masih Projection / Pending.`}
                      </td>
                    </tr>
                  ) : (
                    renderPaidRows(paidProjectCostRows, 'projectCostManual')
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-300">
                    <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
                      Total Project Cost Realisasi ({paidProjectCostRows.length} item Paid)
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(paidProjectCostProjectedTotal)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-emerald-800 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(viewModel.totalProjectRealisasi)}
                    </td>
                    <td className="py-2.5 px-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* OVERALL TOTAL COST REALISASI */}
        <div className="bg-slate-200 border-t-2 border-slate-400 px-4 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm sm:text-base font-extrabold text-slate-900">
              TOTAL ({totalCashOutPaidCount} ITEM PAID) — Total Cost Realisasi
            </p>
            <p className="text-[11px] text-slate-600">
              Opex Paid + Investment Paid + Project Cost Paid · Projected:{' '}
              <span className="font-mono font-semibold text-slate-800">
                {formatSignedCurrency(totalCashOutPaidProjectedTotal)}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              Total Realisasi (Paid)
            </p>
            <p className="font-mono text-base sm:text-lg font-extrabold text-emerald-800 tabular-nums whitespace-nowrap">
              {formatSignedCurrency(viewModel.totalCostRealisasi)}
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 4. FOOTER - SALDO TERSEDIA (REAL)                                  */}
      {/* ================================================================= */}
      <section
        className={`border-2 rounded-xl px-5 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isMinusReal
            ? 'bg-red-50 border-red-400 text-red-900'
            : 'bg-emerald-50 border-emerald-400 text-emerald-900'
        }`}
      >
        <div>
          <p className="text-base sm:text-xl font-extrabold tracking-tight">
            Saldo Tersedia (Real) Per {viewModel.monthFullLabel}
          </p>
          <p className="text-xs font-medium mt-0.5 opacity-85 tabular-nums">
            Saldo Awal ({formatSignedCurrency(viewModel.saldoAwal)}) + Cash In Paid (
            {formatSignedCurrency(viewModel.totalCashInRealisasi)}) − Total Cost Paid (
            {formatSignedCurrency(viewModel.totalCostRealisasi)})
          </p>
          <p className="text-xs font-semibold mt-0.5 opacity-80 tabular-nums">
            Ending Balance Projected (Referensi): {formatSignedCurrency(viewModel.endingBalance)}
          </p>
        </div>

        <div className="text-left sm:text-right">
          <p
            className={`font-mono text-2xl sm:text-3xl font-black tabular-nums ${
              isMinusReal ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {formatSignedCurrency(viewModel.endingBalanceRealisasi)}
          </p>
          <p
            className={`text-xs sm:text-sm font-extrabold uppercase tracking-wide mt-1 ${
              isMinusReal ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {isMinusReal ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN'}
          </p>
        </div>
      </section>

      {/* Modal: Konfirmasi 2 Langkah Batalkan Paid / Revisi (HIJAU -> PUTIH / MERAH) */}
      {cancelPaidModal && (() => {
        const { row, targetColor, targetMonthKey, reason, revisionDateISO } = cancelPaidModal;
        const isInvPrincipal =
          row.sourceCategory === 'investment' && row.investmentComponent === 'principal';
        const formattedNominal = `Rp ${formatIDR(row.amount)}`;
        const targetStatusLabel =
          targetColor === 'red' ? 'Pending' : 'Projection';
        const isReasonValid = reason.trim().length > 0;
        const quickReasons = ['Salah klik', 'Salah bulan', 'Transfer gagal', 'Revisi nominal'];

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="balance-cancel-paid-dialog-title"
            className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isReasonValid) return;
                const payload = cancelPaidModal;
                setCancelPaidModal(null);
                void executeRowStatusChange(
                  payload.row,
                  payload.targetColor,
                  {
                    reason: payload.reason.trim(),
                    revisionDateISO: payload.revisionDateISO || getTodayISODate(),
                  },
                  payload.targetColor === 'red' ? payload.targetMonthKey : undefined
                );
              }}
              className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <h3
                      id="balance-cancel-paid-dialog-title"
                      className="text-sm font-bold text-amber-950"
                    >
                      Batalkan Pelunasan / Revisi Status Paid
                    </h3>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      Paid → {targetStatusLabel} · Tercatat di Audit Log permanen
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCancelPaidModal(null)}
                  className="p-1 text-amber-800 hover:text-amber-950 rounded cursor-pointer"
                  aria-label="Tutup dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-700">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs leading-relaxed text-slate-800">
                  {isInvPrincipal ? (
                    <p>
                      Anda yakin membatalkan Pelunasan{' '}
                      <strong className="text-slate-950">
                        {row.name} - {formattedNominal}
                      </strong>
                      ? Sisa Pokok akan kembali menjadi{' '}
                      <strong className="font-mono text-slate-950">{formattedNominal}</strong> dan{' '}
                      <strong>Bunga akan jalan lagi bulan berikutnya</strong>.
                    </p>
                  ) : (
                    <p>
                      Anda yakin membatalkan Pelunasan{' '}
                      <strong className="text-slate-950">
                        {row.name} - {formattedNominal}
                      </strong>
                      ? Status akan dikembalikan ke <strong>{targetStatusLabel}</strong>, item ini
                      akan hilang dari Realisasi dan kembali masuk ke Projection.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="balance-cancel-paid-reason-input"
                    className="block text-xs font-semibold text-slate-800 mb-1.5"
                  >
                    Alasan Revisi <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="balance-cancel-paid-reason-input"
                    type="text"
                    required
                    autoFocus
                    value={reason}
                    onChange={(e) =>
                      setCancelPaidModal((prev) =>
                        prev ? { ...prev, reason: e.target.value } : null
                      )
                    }
                    placeholder='Contoh: "Salah klik" / "Salah bulan" / "Transfer gagal"'
                    className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Pilihan cepat:</span>
                    {quickReasons.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setCancelPaidModal((prev) =>
                            prev ? { ...prev, reason: preset } : null
                          )
                        }
                        className="px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="balance-cancel-paid-date-input"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Tanggal Revisi
                    </label>
                    <input
                      id="balance-cancel-paid-date-input"
                      type="date"
                      value={revisionDateISO}
                      onChange={(e) =>
                        setCancelPaidModal((prev) =>
                          prev
                            ? { ...prev, revisionDateISO: e.target.value || getTodayISODate() }
                            : null
                        )
                      }
                      className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 mb-1">
                      Target Status Baru
                    </label>
                    <select
                      value={targetColor}
                      onChange={(e) =>
                        setCancelPaidModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                targetColor: e.target.value === 'red' ? 'red' : 'white',
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                    >
                      <option value="white">Batalkan Pelunasan (Kembali ke Projection)</option>
                      <option value="red">Pending</option>
                    </select>
                  </div>
                </div>

                {targetColor === 'red' && (
                  <div>
                    <label
                      htmlFor="balance-cancel-paid-reschedule-month"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Pindah ke bulan berapa?
                    </label>
                    <select
                      id="balance-cancel-paid-reschedule-month"
                      value={targetMonthKey}
                      onChange={(e) =>
                        setCancelPaidModal((prev) =>
                          prev ? { ...prev, targetMonthKey: e.target.value } : null
                        )
                      }
                      className="w-full px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                    >
                      {!rescheduleMonthOptions.some((o) => o.monthKey === targetMonthKey) && (
                        <option value={targetMonthKey}>
                          {formatMonthShortID(targetMonthKey)} ({formatMonthFullID(targetMonthKey)})
                        </option>
                      )}
                      {rescheduleMonthOptions.map((opt) => (
                        <option key={opt.monthKey} value={opt.monthKey}>
                          {opt.shortLabel} ({opt.fullLabel})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCancelPaidModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Tidak, Tetap Paid
                </button>
                <button
                  type="submit"
                  disabled={!isReasonValid}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-45 disabled:cursor-not-allowed rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Ya, Batalkan Paid
                </button>
              </div>
            </form>
          </div>
        );
      })()}
    </div>
  );
};
