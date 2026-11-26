import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  createDefaultBossReportMonth,
  generateBossRowId,
  refreshBossReportMonthsFromSupabase,
  saveBossReportMonth,
} from '../services/bossReportService';
import {
  createOpexItem,
  deleteOpexItem,
  getEndOfMonthISODate,
  refreshOpexFromSupabase,
  updateOpexItem,
} from '../services/opexService';
import {
  createProjectionManualItem,
  deleteProjectionManualItem,
  updateProjectionManualItem,
  updateProjectionManualItemStatus,
} from '../services/projectionManualService';
import { AuditActor, AuditEntityType, AuditLogEntry } from '../types/auth';
import {
  BankAccountRow,
  BOSS_REPORT_COLOR_META,
  BossReportAutoOverride,
  BossReportColorStatus,
  BossReportManualItem,
  BossReportMonthData,
  INVESTMENT_TEMPLATE_ITEMS,
  OPERASIONAL_TEMPLATE_ITEMS,
} from '../types/bossReport';
import { ClientInvoice } from '../types/clientInvoice';
import { ClientPurchaseOrder } from '../types/clientPO';
import { InvestmentAsset } from '../types/investment';
import {
  mapOpexStatusToDbFields,
  OPEX_CATEGORIES,
  OpexCategory,
  OpexInput,
  OpexItem,
} from '../types/opex';
import { PurchaseOrder } from '../types/po';
import {
  ProjectionManualItem,
  ProjectionManualItemInput,
  ProjectionManualSection,
} from '../types/projectionManualItem';
import { StatusWarna } from '../types/statusWarna';
import {
  addMonthsToKey,
  BossReportComputedRow,
  CashInSourceKind,
  computeBalanceAccountDetails,
  computeBossReportRangeViewModel,
  computeBossReportViewModel,
  computeMultiMonthCashflowSeries,
  diffBossMonthKeys,
  formatBossMonthFullLabel,
  formatBossMonthShortLabel,
  formatMonthKeyParts,
  getMonthSelectorOptions,
  normalizeMonthKeyYYYYMM,
} from '../utils/bossReportCalc';
import { computeDueTunggakanStatus, formatIDR, getTodayISODate } from '../utils/format';
import {
  exportBossReportToExcel,
  exportBossReportToPDF,
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
  PROJECTION_STATUS_CHANGE_ACTION,
  ProjectionRevisionRecord,
} from '../utils/projectionRevisionLog';
import {
  buildProjectionColorChangePlan,
  ProjectionSourceSyncAction,
} from '../utils/projectionStatusActions';
import {
  buildProjectionGroupingLookups,
  groupProjectionRows,
  ProjectionRowGroup,
} from '../utils/projectionGrouping';
import { AccountBalanceTableCard } from './AccountBalanceTableCard';
import { CashflowChartCard } from './CashflowChartCard';
import { PeriodeSelector } from './PeriodeSelector';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { RupiahInput } from './RupiahInput';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';

export interface ProjectionAuditLogInput {
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  summary: string;
  dateISO?: string;
}

interface ProjectionReportViewProps {
  orders: PurchaseOrder[];
  clientInvoices: ClientInvoice[];
  clientPOs?: ClientPurchaseOrder[];
  opexItems?: OpexItem[];
  investments?: InvestmentAsset[];
  projectionManualItems?: ProjectionManualItem[];
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
  onSwitchToBalance?: () => void;
  onSaveBossReportMonth?: (monthData: BossReportMonthData) => Promise<void>;
  onSaveBossReportMonthsBatch?: (months: BossReportMonthData[]) => Promise<void>;
  onSyncProjectionSource?: (action: ProjectionSourceSyncAction) => Promise<void>;
  onLogProjectionStatusRevision?: (entry: ProjectionAuditLogInput) => void;
  onPreviewPO?: (po: PurchaseOrder) => void;
  onPreviewClientInvoice?: (inv: ClientInvoice) => void;
  onNavigateVendor?: () => void;
  onNavigateClient?: () => void;
  onNavigateOpex?: () => void;
  onNavigateInvestment?: () => void;
  onCreateOpex?: (input: OpexInput) => Promise<string>;
  onUpdateOpex?: (id: string, input: OpexInput) => Promise<void>;
  onDeleteOpex?: (id: string) => Promise<void>;
  onCreateProjectionManualItem?: (
    input: ProjectionManualItemInput
  ) => Promise<ProjectionManualItem>;
  onUpdateProjectionManualItem?: (
    id: string,
    input: ProjectionManualItemInput
  ) => Promise<ProjectionManualItem>;
  onDeleteProjectionManualItem?: (id: string) => Promise<void>;
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
  lockedTooltip?: string;
}

const InlineMoneyCell: React.FC<InlineMoneyCellProps> = ({
  value,
  disabled,
  onCommit,
  allowNegative = false,
  textClassName = 'text-slate-900',
  lockedTooltip,
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
      <span
        title={lockedTooltip}
        className={`font-mono text-xs sm:text-sm font-semibold tabular-nums ${textClassName}`}
      >
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

interface InlineTextCellProps {
  value: string;
  subtitle?: string;
  isManualBadge?: boolean;
  disabled: boolean;
  lockedTooltip?: string;
  onCommit: (nextValue: string) => void;
}

const InlineTextCell: React.FC<InlineTextCellProps> = ({
  value,
  subtitle,
  isManualBadge = false,
  disabled,
  lockedTooltip,
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
      <div title={lockedTooltip}>
        <div className="text-xs sm:text-sm font-medium text-slate-900">{value}</div>
        {isManualBadge && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
              Manual - Sekali Pakai · Non Rutin
            </span>
          </div>
        )}
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
      {isManualBadge && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
            Manual - Sekali Pakai · Non Rutin
          </span>
        </div>
      )}
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
    </div>
  );
};

export const ProjectionReportView: React.FC<ProjectionReportViewProps> = ({
  orders,
  clientInvoices,
  clientPOs = [],
  opexItems = [],
  investments = [],
  projectionManualItems = [],
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
  onSwitchToBalance,
  onSaveBossReportMonth,
  onSaveBossReportMonthsBatch,
  onSyncProjectionSource,
  onLogProjectionStatusRevision,
  onNavigateOpex,
  onNavigateInvestment,
  onCreateOpex,
  onUpdateOpex,
  onDeleteOpex,
  onCreateProjectionManualItem,
  onUpdateProjectionManualItem,
  onDeleteProjectionManualItem,
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

  // Add inline forms

  const [addingSection, setAddingSection] = useState<
    'cashInManual' | 'operasional' | 'investment' | 'projectCostManual' | null
  >(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemAmount, setNewItemAmount] = useState('');
  const [newItemColor, setNewItemColor] = useState<BossReportColorStatus>('white');
  const [isSavingNewItem, setIsSavingNewItem] = useState(false);

  // Collapse state per Cash Out group
  const [collapsedGroups, setCollapsedGroups] = useState<Record<CashOutGroupKey, boolean>>({
    operasional: false,
    investment: false,
    projectCost: false,
  });

  // View Mode: Pisah per Periode vs Gabung per Komponen (default: Pisah saat 1 bulan, Gabung saat > 1 bulan)
  const [groupingMode, setGroupingMode] = useState<'split' | 'grouped'>(() =>
    isRange ? 'grouped' : 'split'
  );
  const prevIsRangeRef = useRef(isRange);
  useEffect(() => {
    if (prevIsRangeRef.current !== isRange) {
      prevIsRangeRef.current = isRange;
      setGroupingMode(isRange ? 'grouped' : 'split');
    }
  }, [isRange]);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Record<string, boolean>>({});
  const [groupedAmountEditModal, setGroupedAmountEditModal] = useState<{
    group: ProjectionRowGroup;
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual';
    proposedTotal: number;
    editMode: 'choose' | 'perPeriod';
    perRowDrafts: Record<string, string>;
    isSaving: boolean;
  } | null>(null);

  // Feedback states
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 4200);
  };
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const [opexFormModal, setOpexFormModal] = useState<{
    mode: 'create' | 'edit';
    opexId?: string;
    rowMonthKey?: string;
    name: string;
    category: OpexCategory;
    amount: string;
    monthKey: string;
    endMonthKey: string;
    dueDay: string;
    sourceAccountId: string;
    isRecurring: boolean;
    notes: string;
    existing?: OpexItem;
    isSaving: boolean;
    error: string | null;
  } | null>(null);

  const [groupedDeleteModal, setGroupedDeleteModal] = useState<{
    group: ProjectionRowGroup;
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual';
    isDeleting: boolean;
    deletingRowKey: string | null;
    error: string | null;
  } | null>(null);

  const [projectionManualModal, setProjectionManualModal] = useState<{
    mode: 'create' | 'edit';
    section: ProjectionManualSection;
    itemId?: string;
    namaItem: string;
    nominal: string;
    periode: string;
    keterangan: string;
    projectId: string;
    projectName: string;
    vendor: string;
    statusWarna: StatusWarna;
    isSaving: boolean;
    error: string | null;
  } | null>(null);

  const [projectionManualDeleteModal, setProjectionManualDeleteModal] = useState<{
    item: ProjectionManualItem;
    isDeleting: boolean;
    error: string | null;
  } | null>(null);

  const projectionManualById = useMemo(
    () => new Map(projectionManualItems.map((item) => [item.id, item])),
    [projectionManualItems]
  );

  const projectOptions = useMemo(() => {
    const map = new Map<
      string,
      { id: string; label: string; projectName: string; projectNumber: string }
    >();
    const addProject = (
      id: string,
      projectName: string,
      projectNumber?: string,
      clientName?: string
    ) => {
      const cleanName = (projectName ?? '').trim();
      const cleanNum = (projectNumber ?? '').trim();
      if (!cleanName || cleanName === '-') return;
      const key = `${cleanNum.toLowerCase()}::${cleanName.toLowerCase()}`;
      if (map.has(key)) return;
      const numPrefix = cleanNum && cleanNum !== '-' ? `${cleanNum} — ` : '';
      const clientSuffix =
        clientName && clientName.trim() && clientName.trim() !== '-'
          ? ` (${clientName.trim()})`
          : '';
      map.set(key, {
        id: id || cleanNum || cleanName,
        projectName: cleanName,
        projectNumber: cleanNum,
        label: `${numPrefix}${cleanName}${clientSuffix}`,
      });
    };

    for (const cpo of clientPOs) {
      addProject(cpo.id, cpo.projectName, cpo.projectNumber, cpo.clientName);
    }
    for (const inv of clientInvoices) {
      if (!inv.isDeleted) {
        addProject(inv.projectNumber || inv.id, inv.projectName, inv.projectNumber, inv.clientName);
      }
    }
    for (const po of orders) {
      if (!po.isDeleted) {
        addProject(po.projectNumber || po.id, po.projectName, po.projectNumber);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'id'));
  }, [clientPOs, clientInvoices, orders]);

  const opexFormMonthOptions = useMemo(() => {
    const base = getMonthSelectorOptions(selectedMonthKey).map((o) => ({
      monthKey: o.monthKey,
      label: o.fullLabel,
    }));
    const seen = new Set(base.map((o) => o.monthKey));
    const extras: Array<{ monthKey: string; label: string }> = [];
    const candidates = [
      selectedMonthKey,
      activeStartMonthKey,
      activeEndMonthKey,
      opexFormModal?.monthKey,
      opexFormModal?.endMonthKey,
      projectionManualModal?.periode,
    ];
    for (const mk of candidates) {
      if (mk && /^\d{4}-\d{2}$/.test(mk) && !seen.has(mk)) {
        seen.add(mk);
        extras.push({ monthKey: mk, label: formatBossMonthFullLabel(mk) });
      }
    }
    return [...base, ...extras].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [
    selectedMonthKey,
    activeStartMonthKey,
    activeEndMonthKey,
    opexFormModal?.monthKey,
    opexFormModal?.endMonthKey,
    projectionManualModal?.periode,
  ]);

  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'fallback'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [cashInStatusError, setCashInStatusError] = useState<string | null>(null);
  const [cashOutSectionErrors, setCashOutSectionErrors] = useState<
    Partial<Record<CashOutGroupKey, string | null>>
  >({});
  const [savingRowKeys, setSavingRowKeys] = useState<Record<string, boolean>>({});

  // Manual Saldo Awal draft input
  const [openingBalanceDraft, setOpeningBalanceDraft] = useState<string>('');

  // Filter Cash In per Sumber
  const [cashInSourceFilter, setCashInSourceFilter] = useState<'all' | CashInSourceKind>('all');

  // Paid confirmation & 2-step Cancel Paid / Revisi state + Reschedule Target Month modal + immutable revision history
  const [localRevisions, setLocalRevisions] = useState<ProjectionRevisionRecord[]>(() =>
    loadProjectionRevisions()
  );
  const [markPaidConfirmRow, setMarkPaidConfirmRow] = useState<BossReportComputedRow | null>(null);
  const [cancelPaidModal, setCancelPaidModal] = useState<{
    row: BossReportComputedRow;
    targetColor: 'white' | 'red';
    targetMonthKey: string;
    reason: string;
    revisionDateISO: string;
  } | null>(null);
  const [rescheduleModal, setRescheduleModal] = useState<{
    row: BossReportComputedRow;
    targetMonthKey: string;
  } | null>(null);

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
        { cutoffPeriod, projectionManualItems }
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
      projectionManualItems,
    ]
  );

  const balanceAccountDetails = useMemo(
    () => computeBalanceAccountDetails(viewModel),
    [viewModel]
  );

  const cashInSourceStats = useMemo(() => {
    let invoiceCount = 0;
    let disbursementCount = 0;
    let manualCount = 0;
    for (const row of viewModel.cashInRows) {
      if (row.cashInSource === 'investmentDisbursement') {
        disbursementCount += 1;
      } else if (row.cashInSource === 'manual') {
        manualCount += 1;
      } else {
        invoiceCount += 1;
      }
    }
    return {
      all: viewModel.cashInRows.length,
      invoice: invoiceCount,
      investmentDisbursement: disbursementCount,
      manual: manualCount,
    };
  }, [viewModel.cashInRows]);

  const filteredCashInRows = useMemo(() => {
    if (cashInSourceFilter === 'all') return viewModel.cashInRows;
    return viewModel.cashInRows.filter(
      (row) => (row.cashInSource ?? 'invoice') === cashInSourceFilter
    );
  }, [viewModel.cashInRows, cashInSourceFilter]);

  const filteredCashInTotals = useMemo(
    () =>
      filteredCashInRows.reduce(
        (acc, row) => ({
          projected: acc.projected + row.projectedAmount,
        }),
        { projected: 0 }
      ),
    [filteredCashInRows]
  );

  const paidCounts = useMemo(
    () => ({
      cashIn: viewModel.cashInRows.filter((r) => r.color === 'green').length,
      operasional: viewModel.operasionalRows.filter((r) => r.color === 'green').length,
      investment: viewModel.investmentRows.filter((r) => r.color === 'green').length,
      projectCost: viewModel.projectCostRows.filter((r) => r.color === 'green').length,
    }),
    [viewModel]
  );

  const groupingLookups = useMemo(
    () =>
      buildProjectionGroupingLookups({
        opexItems,
        investments,
        orders,
        clientInvoices,
      }),
    [opexItems, investments, orders, clientInvoices]
  );

  const groupedCashIn = useMemo(
    () => groupProjectionRows(filteredCashInRows, groupingLookups),
    [filteredCashInRows, groupingLookups]
  );
  const groupedOperasional = useMemo(
    () => groupProjectionRows(viewModel.operasionalRows, groupingLookups),
    [viewModel.operasionalRows, groupingLookups]
  );
  const groupedInvestment = useMemo(
    () => groupProjectionRows(viewModel.investmentRows, groupingLookups),
    [viewModel.investmentRows, groupingLookups]
  );
  const groupedProjectCost = useMemo(
    () => groupProjectionRows(viewModel.projectCostRows, groupingLookups),
    [viewModel.projectCostRows, groupingLookups]
  );

  const rescheduleMonthOptions = useMemo(() => {
    const opts: { monthKey: string; label: string }[] = [];
    for (let i = 1; i <= 18; i += 1) {
      const mk = addMonthsToKey(selectedMonthKey, i);
      opts.push({
        monthKey: mk,
        label: formatBossMonthFullLabel(mk),
      });
    }
    return opts;
  }, [selectedMonthKey]);

  const chartSeries = useMemo(
    () =>
      computeMultiMonthCashflowSeries(
        activeStartMonthKey,
        autoPreviewMonthsMap,
        orders,
        clientInvoices,
        opexItems,
        investments,
        activeEndMonthKey,
        { cutoffPeriod, projectionManualItems }
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
      projectionManualItems,
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
  }, [
    selectedMonthKey,
    activeMonthData,
    orders,
    clientInvoices,
    opexItems,
    investments,
    bossReportMonths,
    cutoffPeriod,
  ]);

  const buildPersistBaseDataFor = (targetMonthKey: string): BossReportMonthData => {
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
    return {
      ...baseData,
      monthKey: targetMonthKey,
    };
  };

  const buildPersistBaseData = (): BossReportMonthData =>
    buildPersistBaseDataFor(selectedMonthKey);

  const persistMonthFor = async (
    targetMonthKey: string,
    updater: (prev: BossReportMonthData) => BossReportMonthData,
    sectionTarget?: 'cashIn' | CashOutGroupKey
  ): Promise<boolean> => {
    if (isBossMode) return false;
    const saveSingle =
      onSaveBossReportMonth ??
      (onSaveBossReportMonthsBatch
        ? (month: BossReportMonthData) => onSaveBossReportMonthsBatch([month])
        : saveBossReportMonth);

    const baseData = buildPersistBaseDataFor(targetMonthKey);
    const updated = updater(baseData);
    const next: BossReportMonthData = {
      ...updated,
      monthKey: targetMonthKey,
    };

    try {
      setExportError(null);
      if (sectionTarget === 'cashIn') {
        setCashInStatusError(null);
      } else if (sectionTarget) {
        setCashOutSectionErrors((prev) => ({ ...prev, [sectionTarget]: null }));
      }
      await saveSingle(next);
      return true;
    } catch (err) {
      console.error('[Projection] Gagal menyimpan perubahan Projection ke Supabase:', err);
      const errMsg =
        err instanceof Error
          ? `Gagal menyimpan perubahan Projection: ${err.message}`
          : 'Gagal menyimpan perubahan Projection ke database Supabase.';
      setExportError(errMsg);
      if (sectionTarget === 'cashIn') {
        setCashInStatusError(errMsg);
      } else if (sectionTarget) {
        setCashOutSectionErrors((prev) => ({ ...prev, [sectionTarget]: errMsg }));
      }
      return false;
    }
  };

  const persistMonth = (
    updater: (prev: BossReportMonthData) => BossReportMonthData,
    sectionTarget?: 'cashIn' | CashOutGroupKey
  ): Promise<boolean> => persistMonthFor(selectedMonthKey, updater, sectionTarget);

  // --- Saldo Awal & Account handlers ---
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

  // --- Manual Item & Override handlers ---
  const mapManualSectionToErrorKey = (
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual'
  ): 'cashIn' | CashOutGroupKey =>
    section === 'cashInManual'
      ? 'cashIn'
      : section === 'operasional'
      ? 'operasional'
      : section === 'investment'
      ? 'investment'
      : 'projectCost';

  const resolveRealOpexIdFromRow = (row: BossReportComputedRow): string => {
    const raw =
      row.opexId ??
      (row.sourceId ? row.sourceId.replace(/^opex_/, '') : '');
    const cleaned = raw.trim().replace(/^opex_/, '').replace(/__\d{4}-\d{2}$/, '');
    if (!cleaned || cleaned.startsWith('grp_') || cleaned.includes('|')) {
      return '';
    }
    return cleaned;
  };

  const refreshOpexAndProjectionData = async (usedOwnFallback: boolean) => {
    if (usedOwnFallback) {
      await Promise.all([
        refreshOpexFromSupabase().catch(() => undefined),
        refreshBossReportMonthsFromSupabase().catch(() => undefined),
      ]);
    }
    if (onLoadRangeData && isRange) {
      await onLoadRangeData(activeStartMonthKey, activeEndMonthKey).catch(() => undefined);
    }
  };

  const openCreateOpexModal = (defaultMonthKey: string = selectedMonthKey) => {
    if (isBossMode) return;
    setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }));
    setExportError(null);
    setAddingSection(null);
    setOpexFormModal({
      mode: 'create',
      name: '',
      category: 'OPERASIONAL',
      amount: '',
      monthKey: defaultMonthKey,
      endMonthKey: '',
      dueDay: '25',
      sourceAccountId: activeMonthData.accounts[0]?.id ?? '',
      isRecurring: false,
      notes: '',
      isSaving: false,
      error: null,
    });
  };

  const openEditOpexModal = (row: BossReportComputedRow) => {
    if (isBossMode) return;
    const opexId = resolveRealOpexIdFromRow(row);
    if (!opexId) {
      const errMsg = 'ID baris Opex asli tidak ditemukan. Silakan muat ulang halaman.';
      setCashOutSectionErrors((prev) => ({ ...prev, operasional: errMsg }));
      showToast('error', errMsg);
      return;
    }
    const existing =
      opexItems.find((o) => o.id === opexId) ?? groupingLookups.opexById.get(opexId);
    const rowMonthKey = row.sourceMonthKey ?? existing?.monthKey ?? selectedMonthKey;
    setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }));
    setExportError(null);
    setOpexFormModal({
      mode: 'edit',
      opexId,
      rowMonthKey,
      name: existing?.name ?? row.name,
      category: existing?.category ?? 'OPERASIONAL',
      amount: String(existing?.amount ?? row.amount),
      monthKey: existing?.monthKey ?? rowMonthKey,
      endMonthKey: existing?.endMonthKey ?? '',
      dueDay: existing?.dueDay ? String(existing.dueDay) : '',
      sourceAccountId: existing?.sourceAccountId ?? '',
      isRecurring: Boolean(existing?.isRecurring),
      notes: existing?.notes ?? '',
      existing,
      isSaving: false,
      error: null,
    });
  };

  const handleSubmitOpexFormModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opexFormModal || opexFormModal.isSaving || isBossMode) return;

    const cleanName = opexFormModal.name.trim();
    if (!cleanName) {
      setOpexFormModal((prev) =>
        prev ? { ...prev, error: 'Nama biaya operasional wajib diisi.' } : null
      );
      return;
    }

    const parsedAmount = Number(opexFormModal.amount || 0);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setOpexFormModal((prev) =>
        prev ? { ...prev, error: 'Nominal biaya operasional harus lebih dari Rp 0.' } : null
      );
      return;
    }
    const safeAmount = Math.round(parsedAmount);
    const chosenMonthKey = normalizeMonthKeyYYYYMM(opexFormModal.monthKey || selectedMonthKey);
    const parsedDueDay = opexFormModal.dueDay ? Number(opexFormModal.dueDay) : undefined;
    const validDueDay =
      parsedDueDay !== undefined &&
      Number.isFinite(parsedDueDay) &&
      parsedDueDay >= 1 &&
      parsedDueDay <= 31
        ? Math.round(parsedDueDay)
        : undefined;
    const chosenAccount = activeMonthData.accounts.find(
      (a) => a.id === opexFormModal.sourceAccountId
    );
    const cleanEndMonth =
      opexFormModal.isRecurring &&
      opexFormModal.endMonthKey &&
      opexFormModal.endMonthKey >= chosenMonthKey
        ? opexFormModal.endMonthKey
        : undefined;

    setOpexFormModal((prev) => (prev ? { ...prev, isSaving: true, error: null } : null));
    setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }));
    setExportError(null);

    try {
      if (opexFormModal.mode === 'create') {
        const { dbStatus, dbWarna } = mapOpexStatusToDbFields('Not Paid');
        const input: OpexInput = {
          name: cleanName,
          category: opexFormModal.category || 'OPERASIONAL',
          amount: safeAmount,
          monthKey: chosenMonthKey,
          expenseDate: getEndOfMonthISODate(chosenMonthKey),
          endMonthKey: cleanEndMonth,
          dueDay: validDueDay,
          sourceAccountId: chosenAccount?.id || undefined,
          sourceAccountName: chosenAccount?.name || undefined,
          isRecurring: opexFormModal.isRecurring,
          status: dbStatus,
          statusWarna: dbWarna,
          notes: opexFormModal.notes.trim() || undefined,
        };
        const execCreate = onCreateOpex ?? createOpexItem;
        await execCreate(input);
        await refreshOpexAndProjectionData(!onCreateOpex);
        setOpexFormModal(null);
        const msg = `Biaya Opex "${cleanName}" (${formatSignedCurrency(
          safeAmount
        )}) berhasil disimpan ke ${formatBossMonthFullLabel(chosenMonthKey)}.`;
        setCopyFeedback(msg);
        showToast('success', 'Berhasil disimpan: ' + msg);
        window.setTimeout(() => setCopyFeedback(null), 4000);
      } else {
        const opexId = opexFormModal.opexId;
        if (!opexId || opexId.startsWith('grp_') || opexId.includes('|')) {
          throw new Error('ID baris Opex asli tidak valid.');
        }
        const existing = opexFormModal.existing;
        const input: OpexInput = {
          name: cleanName,
          category: opexFormModal.category || existing?.category || 'OPERASIONAL',
          amount: safeAmount,
          monthKey: chosenMonthKey,
          expenseDate: getEndOfMonthISODate(chosenMonthKey),
          endMonthKey: cleanEndMonth,
          dueDay: validDueDay,
          sourceAccountId: chosenAccount?.id || opexFormModal.sourceAccountId || undefined,
          sourceAccountName:
            chosenAccount?.name ??
            (opexFormModal.sourceAccountId ? existing?.sourceAccountName : undefined),
          isRecurring: opexFormModal.isRecurring,
          status: existing?.status ?? 'Not Paid',
          statusWarna: existing?.statusWarna ?? 'PUTIH',
          monthStatuses: existing?.monthStatuses,
          monthRealisasi: existing?.monthRealisasi,
          realisasiAmount: existing?.realisasiAmount,
          actualAmount: existing?.actualAmount,
          paidDates: existing?.paidDates,
          rescheduledFromMonth: existing?.rescheduledFromMonth,
          rescheduledToMonth: existing?.rescheduledToMonth,
          rescheduledMonths: existing?.rescheduledMonths,
          notes: opexFormModal.notes.trim() || undefined,
        };
        const execUpdate = onUpdateOpex ?? updateOpexItem;
        await execUpdate(opexId, input);
        await refreshOpexAndProjectionData(!onUpdateOpex);
        setOpexFormModal(null);
        const msg = `Biaya Opex "${cleanName}" berhasil diperbarui.`;
        setCopyFeedback(msg);
        showToast('success', 'Berhasil disimpan: ' + msg);
        window.setTimeout(() => setCopyFeedback(null), 4000);
      }
    } catch (err) {
      console.error('[Projection][OpexForm] Gagal menyimpan Opex ke Supabase:', err);
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan biaya Operasional ke Supabase.';
      setOpexFormModal((prev) => (prev ? { ...prev, isSaving: false, error: errMsg } : null));
      showToast('error', errMsg);
    }
  };

  const openCreateProjectionManualModal = (
    section: ProjectionManualSection,
    defaultMonthKey: string = selectedMonthKey
  ) => {
    if (isBossMode) return;
    const errKey: CashOutGroupKey =
      section === 'INVESTMENT' ? 'investment' : 'projectCost';
    setCashOutSectionErrors((prev) => ({ ...prev, [errKey]: null }));
    setExportError(null);
    setAddingSection(null);
    setProjectionManualModal({
      mode: 'create',
      section,
      namaItem: '',
      nominal: '',
      periode: defaultMonthKey,
      keterangan: '',
      projectId: '',
      projectName: '',
      vendor: '',
      statusWarna: 'PUTIH',
      isSaving: false,
      error: null,
    });
  };

  const openEditProjectionManualModal = (row: BossReportComputedRow) => {
    if (isBossMode || !row.projectionManualItemId) return;
    const existing = projectionManualById.get(row.projectionManualItemId);
    const section: ProjectionManualSection =
      existing?.section ??
      (row.section === 'projectCost' ? 'PROJECT_COST' : 'INVESTMENT');
    setProjectionManualModal({
      mode: 'edit',
      section,
      itemId: row.projectionManualItemId,
      namaItem: existing?.namaItem ?? row.name,
      nominal: String(existing?.nominal ?? row.amount),
      periode: existing?.periode ?? row.sourceMonthKey ?? selectedMonthKey,
      keterangan: existing?.keterangan ?? row.manualKeterangan ?? '',
      projectId: existing?.projectId ?? row.manualProjectId ?? '',
      projectName: existing?.projectName ?? row.manualProjectName ?? '',
      vendor: existing?.vendor ?? row.manualVendor ?? '',
      statusWarna:
        existing?.statusWarna ??
        (row.color === 'green' ? 'HIJAU' : row.color === 'red' ? 'MERAH' : 'PUTIH'),
      isSaving: false,
      error: null,
    });
  };

  const handleSubmitProjectionManualModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectionManualModal || projectionManualModal.isSaving || isBossMode) return;

    const cleanName = projectionManualModal.namaItem.trim();
    if (!cleanName) {
      setProjectionManualModal((prev) =>
        prev ? { ...prev, error: 'Nama Item wajib diisi.' } : null
      );
      return;
    }

    const parsedNominal = Number(projectionManualModal.nominal || 0);
    if (!Number.isFinite(parsedNominal) || parsedNominal <= 0) {
      setProjectionManualModal((prev) =>
        prev ? { ...prev, error: 'Nominal wajib diisi lebih dari Rp 0.' } : null
      );
      return;
    }

    const safeNominal = Math.round(parsedNominal);
    const chosenPeriode = normalizeMonthKeyYYYYMM(
      projectionManualModal.periode || selectedMonthKey
    );
    const chosenProject = projectOptions.find(
      (p) => p.id === projectionManualModal.projectId
    );
    const payload: ProjectionManualItemInput = {
      periode: chosenPeriode,
      section: projectionManualModal.section,
      namaItem: cleanName,
      nominal: safeNominal,
      keterangan: projectionManualModal.keterangan.trim(),
      ...(projectionManualModal.section === 'PROJECT_COST'
        ? {
            projectId: projectionManualModal.projectId || undefined,
            projectName:
              chosenProject?.projectName ||
              projectionManualModal.projectName.trim() ||
              undefined,
            vendor: projectionManualModal.vendor.trim() || undefined,
          }
        : {}),
      statusWarna: projectionManualModal.statusWarna,
      createdBy: actorDisplayName,
    };

    setProjectionManualModal((prev) =>
      prev ? { ...prev, isSaving: true, error: null } : null
    );
    const errKey: CashOutGroupKey =
      projectionManualModal.section === 'INVESTMENT' ? 'investment' : 'projectCost';
    setCashOutSectionErrors((prev) => ({ ...prev, [errKey]: null }));

    try {
      if (projectionManualModal.mode === 'create') {
        const execCreate =
          onCreateProjectionManualItem ?? createProjectionManualItem;
        await execCreate(payload);
        setProjectionManualModal(null);
        const msg = `Item manual "${cleanName}" (${formatSignedCurrency(
          safeNominal
        )}) ditambahkan ke Projection ${formatBossMonthFullLabel(chosenPeriode)}.`;
        setCopyFeedback(msg);
        showToast('success', msg);
        window.setTimeout(() => setCopyFeedback(null), 4000);
      } else if (projectionManualModal.itemId) {
        const execUpdate =
          onUpdateProjectionManualItem ?? updateProjectionManualItem;
        await execUpdate(projectionManualModal.itemId, payload);
        setProjectionManualModal(null);
        const msg = `Item manual "${cleanName}" berhasil diperbarui di Projection.`;
        setCopyFeedback(msg);
        showToast('success', msg);
        window.setTimeout(() => setCopyFeedback(null), 4000);
      }
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan item manual Projection ke database.';
      setProjectionManualModal((prev) =>
        prev ? { ...prev, isSaving: false, error: errMsg } : null
      );
      showToast('error', errMsg);
    }
  };

  const handleQuickPatchProjectionManualItem = async (
    row: BossReportComputedRow,
    patch: { namaItem?: string; nominal?: number; color?: BossReportColorStatus }
  ) => {
    if (!row.projectionManualItemId || isBossMode) return;
    const existing = projectionManualById.get(row.projectionManualItemId);
    if (!existing) return;

    const nextColor = patch.color ?? existing.color;
    const nextStatusWarna: StatusWarna =
      nextColor === 'green' ? 'HIJAU' : nextColor === 'red' ? 'MERAH' : 'PUTIH';
    const nextInput: ProjectionManualItemInput = {
      periode: existing.periode,
      section: existing.section,
      namaItem: patch.namaItem ?? existing.namaItem,
      nominal: patch.nominal ?? existing.nominal,
      keterangan: existing.keterangan,
      projectId: existing.projectId,
      projectName: existing.projectName,
      vendor: existing.vendor,
      statusWarna: nextStatusWarna,
      color: nextColor,
      createdBy: existing.createdBy,
    };

    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      const execUpdate =
        onUpdateProjectionManualItem ?? updateProjectionManualItem;
      await execUpdate(existing.id, nextInput);
      showToast('success', `"${nextInput.namaItem}" diperbarui di Projection.`);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Gagal memperbarui item manual Projection.';
      showToast('error', errMsg);
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }
  };

  const handleConfirmDeleteProjectionManual = async () => {
    if (!projectionManualDeleteModal || projectionManualDeleteModal.isDeleting || isBossMode) {
      return;
    }
    const { item } = projectionManualDeleteModal;
    setProjectionManualDeleteModal((prev) =>
      prev ? { ...prev, isDeleting: true, error: null } : null
    );
    try {
      const execDelete =
        onDeleteProjectionManualItem ?? deleteProjectionManualItem;
      await execDelete(item.id);
      setProjectionManualDeleteModal(null);
      const msg = `Item manual "${item.namaItem}" dihapus dari Projection ${formatBossMonthFullLabel(
        item.periode
      )}.`;
      setCopyFeedback(msg);
      showToast('success', msg);
      window.setTimeout(() => setCopyFeedback(null), 4000);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Gagal menghapus item manual dari Projection.';
      setProjectionManualDeleteModal((prev) =>
        prev ? { ...prev, isDeleting: false, error: errMsg } : null
      );
      showToast('error', errMsg);
    }
  };

  const openAddItem = (
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual'
  ) => {
    if (section === 'operasional') {
      openCreateOpexModal(selectedMonthKey);
      return;
    }
    if (section === 'investment') {
      openCreateProjectionManualModal('INVESTMENT', selectedMonthKey);
      return;
    }
    if (section === 'projectCostManual') {
      openCreateProjectionManualModal('PROJECT_COST', selectedMonthKey);
      return;
    }
    const errKey = mapManualSectionToErrorKey(section);
    if (errKey === 'cashIn') {
      setCashInStatusError(null);
    } else {
      setCashOutSectionErrors((prev) => ({ ...prev, [errKey]: null }));
    }
    setAddingSection(section);
    setNewItemName('');
    setNewItemAmount('');
    setNewItemColor('white');
  };

  const handleAddItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingSection || isSavingNewItem || isBossMode) return;
    const cleanName = newItemName.trim();
    if (!cleanName) return;
    const rawNum = Number(newItemAmount || 0);
    const safeAmount = Number.isFinite(rawNum) && rawNum >= 0 ? Math.round(rawNum) : 0;

    const targetSection = addingSection;
    const sectionKey = mapManualSectionToErrorKey(targetSection);
    if (sectionKey === 'cashIn') {
      setCashInStatusError(null);
    } else {
      setCashOutSectionErrors((prev) => ({ ...prev, [sectionKey]: null }));
    }
    setExportError(null);

    const newItem: BossReportManualItem = {
      id: generateBossRowId('itm'),
      name: cleanName,
      amount: safeAmount,
      color: 'white',
    };

    setIsSavingNewItem(true);

    try {
      if (targetSection === 'operasional') {
        const { dbStatus, dbWarna } = mapOpexStatusToDbFields('Not Paid');
        const opexInput: OpexInput = {
          name: cleanName,
          category: 'OPERASIONAL',
          amount: safeAmount,
          monthKey: selectedMonthKey,
          expenseDate: getEndOfMonthISODate(selectedMonthKey),
          isRecurring: false,
          status: dbStatus,
          statusWarna: dbWarna,
        };
        const saveOpex = onCreateOpex ?? createOpexItem;
        await saveOpex(opexInput);
        await refreshOpexAndProjectionData(!onCreateOpex);
      } else {
        const baseData = buildPersistBaseData();
        const updatedCurrMonth: BossReportMonthData = {
          ...baseData,
          monthKey: selectedMonthKey,
          [targetSection]: [...baseData[targetSection], newItem],
        };

        if (onSaveBossReportMonth) {
          await onSaveBossReportMonth(updatedCurrMonth);
        } else if (onSaveBossReportMonthsBatch) {
          await onSaveBossReportMonthsBatch([updatedCurrMonth]);
        } else {
          throw new Error('Handler penyimpanan Projection ke Supabase tidak tersedia.');
        }
      }

      setNewItemName('');
      setNewItemAmount('');
      setNewItemColor('white');
      setAddingSection(null);
      const msg = `Item "${cleanName}" (${formatSignedCurrency(safeAmount)}) berhasil disimpan ke ${viewModel.monthFullLabel}.`;
      setCopyFeedback(msg);
      showToast('success', 'Berhasil disimpan: ' + msg);
      window.setTimeout(() => setCopyFeedback(null), 4000);
    } catch (err) {
      console.error('[Projection][TambahItem] Gagal menyimpan ke Supabase:', err);
      const errMsg =
        err instanceof Error
          ? `Gagal menyimpan item ke Supabase: ${err.message}`
          : 'Gagal menyimpan item ke Supabase.';
      setExportError(errMsg);
      showToast('error', errMsg);
      if (sectionKey === 'cashIn') {
        setCashInStatusError(errMsg);
      } else {
        setCashOutSectionErrors((prev) => ({ ...prev, [sectionKey]: errMsg }));
      }
    } finally {
      setIsSavingNewItem(false);
    }
  };

  const handleUpdateOpexRow = async (
    row: BossReportComputedRow,
    patch: { name?: string; amount?: number }
  ) => {
    const opexId = resolveRealOpexIdFromRow(row);
    if (!opexId) return;
    const existing = opexItems.find((o) => o.id === opexId);
    const nextInput: OpexInput = {
      name: patch.name ?? existing?.name ?? row.name,
      category: existing?.category ?? 'OPERASIONAL',
      amount: patch.amount ?? existing?.amount ?? row.amount,
      monthKey: existing?.monthKey ?? row.sourceMonthKey ?? selectedMonthKey,
      expenseDate:
        existing?.expenseDate ??
        getEndOfMonthISODate(existing?.monthKey ?? row.sourceMonthKey ?? selectedMonthKey),
      endMonthKey: existing?.endMonthKey,
      dueDay: existing?.dueDay,
      sourceAccountId: existing?.sourceAccountId,
      sourceAccountName: existing?.sourceAccountName,
      isRecurring: Boolean(existing?.isRecurring),
      status:
        existing?.status ??
        (row.color === 'green' ? 'Paid' : row.color === 'red' ? 'Reschedule' : 'Not Paid'),
      statusWarna:
        existing?.statusWarna ??
        (row.color === 'green' ? 'HIJAU' : row.color === 'red' ? 'MERAH' : 'PUTIH'),
      monthStatuses: existing?.monthStatuses,
      monthRealisasi: existing?.monthRealisasi,
      realisasiAmount: existing?.realisasiAmount,
      actualAmount: existing?.actualAmount,
      paidDates: existing?.paidDates,
      notes: existing?.notes,
    };
    setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }));
    setExportError(null);
    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      const saveUpdate = onUpdateOpex ?? updateOpexItem;
      await saveUpdate(opexId, nextInput);
      await refreshOpexAndProjectionData(!onUpdateOpex);
      showToast('success', `Berhasil disimpan: "${nextInput.name}" diperbarui.`);
    } catch (err) {
      console.error('[Projection][Opex] Gagal update opex di Supabase:', err);
      const errMsg =
        err instanceof Error
          ? `Gagal memperbarui item Operasional di Supabase: ${err.message}`
          : 'Gagal memperbarui item Operasional di Supabase.';
      setExportError(errMsg);
      setCashOutSectionErrors((prev) => ({ ...prev, operasional: errMsg }));
      showToast('error', errMsg);
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }
  };

  const handleDeleteOpexRow = async (row: BossReportComputedRow): Promise<boolean> => {
    const opexId = resolveRealOpexIdFromRow(row);
    if (!opexId) {
      const errMsg =
        'Gagal menghapus: ID baris Opex asli tidak valid (bukan ID Supabase).';
      setExportError(errMsg);
      setCashOutSectionErrors((prev) => ({ ...prev, operasional: errMsg }));
      showToast('error', errMsg);
      return false;
    }
    setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }));
    setExportError(null);
    setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
    try {
      const execDelete = onDeleteOpex ?? deleteOpexItem;
      await execDelete(opexId);
      await refreshOpexAndProjectionData(!onDeleteOpex);
      const msg = `Item Operasional "${row.name}" berhasil dihapus.`;
      setCopyFeedback(msg);
      showToast('success', 'Berhasil dihapus: ' + msg);
      window.setTimeout(() => setCopyFeedback(null), 3500);
      return true;
    } catch (err) {
      console.error('[Projection][Opex] Gagal menghapus opex di Supabase:', err);
      const errMsg =
        err instanceof Error
          ? `Gagal menghapus item Operasional di Supabase: ${err.message}`
          : 'Gagal menghapus item Operasional di Supabase.';
      setExportError(errMsg);
      setCashOutSectionErrors((prev) => ({ ...prev, operasional: errMsg }));
      showToast('error', errMsg);
      return false;
    } finally {
      setSavingRowKeys((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    }
  };

  const handleUpdateManualItem = (
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    itemId: string,
    patch: Partial<Pick<BossReportManualItem, 'name' | 'amount' | 'color'>>,
    targetMonthKey: string = selectedMonthKey
  ) => {
    void persistMonthFor(
      targetMonthKey,
      (prev) => ({
        ...prev,
        [section]: prev[section].map((item) =>
          item.id === itemId ? { ...item, ...patch } : item
        ),
      }),
      mapManualSectionToErrorKey(section)
    );
  };

  const handleUpdateRescheduledItem = (
    rescheduledItemId: string,
    patch: { name?: string; amount?: number },
    targetMonthKey: string = selectedMonthKey
  ) => {
    void persistMonthFor(targetMonthKey, (prev) => ({
      ...prev,
      rescheduledIn: (prev.rescheduledIn ?? []).map((rs) =>
        rs.id === rescheduledItemId
          ? { ...rs, ...patch, hasCustomOverride: true }
          : rs
      ),
    }));
  };

  const handleDeleteManualItem = async (
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    itemId: string,
    targetMonthKey: string = selectedMonthKey
  ): Promise<boolean> => {
    const ok = await persistMonthFor(
      targetMonthKey,
      (prev) => ({
        ...prev,
        [section]: prev[section].filter((item) => item.id !== itemId),
      }),
      mapManualSectionToErrorKey(section)
    );
    if (ok) {
      showToast('success', 'Berhasil dihapus dari Projection.');
    }
    return ok;
  };

  const handleDeleteGroupedPeriodItem = async (row: BossReportComputedRow) => {
    if (!groupedDeleteModal || groupedDeleteModal.isDeleting || isBossMode) return;
    const { manualSection } = groupedDeleteModal;
    setGroupedDeleteModal((prev) =>
      prev ? { ...prev, isDeleting: true, deletingRowKey: row.rowKey, error: null } : null
    );
    try {
      let ok = false;
      if (row.projectionManualItemId) {
        const execDelete =
          onDeleteProjectionManualItem ?? deleteProjectionManualItem;
        await execDelete(row.projectionManualItemId);
        ok = true;
      } else if (row.sourceCategory === 'opex' && row.isAuto) {
        ok = await handleDeleteOpexRow(row);
      } else if (!row.isAuto && row.sourceId) {
        ok = await handleDeleteManualItem(
          manualSection,
          row.sourceId,
          row.sourceMonthKey ?? selectedMonthKey
        );
      } else {
        throw new Error('Item otomatis non-Opex tidak dapat dihapus dari Projection.');
      }

      if (ok) {
        setGroupedDeleteModal(null);
      } else {
        setGroupedDeleteModal((prev) =>
          prev
            ? {
                ...prev,
                isDeleting: false,
                deletingRowKey: null,
                error: 'Gagal menghapus baris. Periksa pesan error atau coba lagi.',
              }
            : null
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Gagal menghapus baris.';
      setGroupedDeleteModal((prev) =>
        prev
          ? { ...prev, isDeleting: false, deletingRowKey: null, error: errMsg }
          : null
      );
      showToast('error', errMsg);
    }
  };

  const handleDeleteGroupedAllPeriods = async () => {
    if (!groupedDeleteModal || groupedDeleteModal.isDeleting || isBossMode) return;
    const { group, manualSection } = groupedDeleteModal;
    setGroupedDeleteModal((prev) =>
      prev ? { ...prev, isDeleting: true, deletingRowKey: '__ALL__', error: null } : null
    );
    try {
      const seenOpexIds = new Set<string>();
      const seenManualIds = new Set<string>();
      let deletedCount = 0;

      for (const item of group.items) {
        if (item.isRescheduledIn) continue;
        if (item.projectionManualItemId) {
          if (seenManualIds.has(item.projectionManualItemId)) continue;
          seenManualIds.add(item.projectionManualItemId);
          const execDelete =
            onDeleteProjectionManualItem ?? deleteProjectionManualItem;
          await execDelete(item.projectionManualItemId);
          deletedCount += 1;
        } else if (item.sourceCategory === 'opex' && item.isAuto) {
          const opexId = resolveRealOpexIdFromRow(item);
          if (!opexId || seenOpexIds.has(opexId)) continue;
          seenOpexIds.add(opexId);
          const execDelete = onDeleteOpex ?? deleteOpexItem;
          await execDelete(opexId);
          deletedCount += 1;
        } else if (!item.isAuto && item.sourceId) {
          const ok = await persistMonthFor(
            item.sourceMonthKey ?? selectedMonthKey,
            (prev) => ({
              ...prev,
              [manualSection]: prev[manualSection].filter((m) => m.id !== item.sourceId),
            }),
            mapManualSectionToErrorKey(manualSection)
          );
          if (ok) deletedCount += 1;
        }
      }

      if (seenOpexIds.size > 0) {
        await refreshOpexAndProjectionData(!onDeleteOpex);
      }

      if (deletedCount === 0) {
        throw new Error('Tidak ada baris dengan ID asli yang dapat dihapus dalam grup ini.');
      }

      setGroupedDeleteModal(null);
      const msg = `"${group.displayName}" (${deletedCount} data) berhasil dihapus.`;
      setCopyFeedback(msg);
      showToast('success', 'Berhasil dihapus: ' + msg);
      window.setTimeout(() => setCopyFeedback(null), 4000);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Gagal menghapus seluruh periode pada grup ini.';
      setGroupedDeleteModal((prev) =>
        prev
          ? { ...prev, isDeleting: false, deletingRowKey: null, error: errMsg }
          : null
      );
      showToast('error', errMsg);
    }
  };

  const handleUpdateAutoOverride = (
    row: BossReportComputedRow,
    patch: { name?: string; amount?: number; color?: BossReportColorStatus },
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
        ...(patch.color !== undefined ? { hasCustomColor: true, color: patch.color } : {}),
      };
      const rest = prev.autoOverrides.filter((o) => o.sourceId !== sourceId);
      return {
        ...prev,
        autoOverrides: [...rest, updated],
      };
    });
  };

  const actorDisplayName = currentActor?.name || 'Admin KKB';

  const executeRowStatusChange = async (
    row: BossReportComputedRow,
    nextColor: BossReportColorStatus,
    revisionDetails?: { reason: string; revisionDateISO: string },
    targetMonthKey?: string
  ) => {
    if (isBossMode) return;
    if (row.projectionManualItemId) {
      setSavingRowKeys((prev) => ({ ...prev, [row.rowKey]: true }));
      try {
        if (onUpdateProjectionManualItem) {
          const existing = projectionManualById.get(row.projectionManualItemId);
          if (existing) {
            await onUpdateProjectionManualItem(existing.id, {
              periode: existing.periode,
              section: existing.section,
              namaItem: existing.namaItem,
              nominal: existing.nominal,
              keterangan: existing.keterangan,
              projectId: existing.projectId,
              projectName: existing.projectName,
              vendor: existing.vendor,
              statusWarna:
                nextColor === 'green' ? 'HIJAU' : nextColor === 'red' ? 'MERAH' : 'PUTIH',
              color: nextColor,
              createdBy: existing.createdBy,
            });
          }
        } else {
          await updateProjectionManualItemStatus(row.projectionManualItemId, nextColor);
        }
        const statusLabel =
          nextColor === 'green' ? 'Paid' : nextColor === 'red' ? 'Pending' : 'Projection';
        showToast('success', `Status "${row.name}" diubah ke ${statusLabel}.`);
      } catch (err) {
        const errMsg =
          err instanceof Error
            ? err.message
            : 'Gagal mengubah status item manual Projection.';
        showToast('error', errMsg);
      } finally {
        setSavingRowKeys((prev) => {
          const next = { ...prev };
          delete next[row.rowKey];
          return next;
        });
      }
      return;
    }

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

    const resolvedTargetMonthKey =
      nextColor === 'red'
        ? targetMonthKey || addMonthsToKey(rowMonthKey, 1)
        : undefined;
    if (
      nextColor === row.color &&
      (nextColor !== 'red' || resolvedTargetMonthKey === row.rescheduledToMonth)
    ) {
      return;
    }

    const prevColor = row.color;
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

    // Catat log revisi / riwayat pembayaran secara permanen (tidak menghapus log lama)
    const todayISO = getTodayISODate();
    const revDateISO = revisionDetails?.revisionDateISO || todayISO;
    const isCancelPaid = prevColor === 'green' && (nextColor === 'white' || nextColor === 'red');
    const isMarkPaid = nextColor === 'green';
    const shouldRecordHistory =
      isCancelPaid ||
      isMarkPaid ||
      (row.sourceCategory === 'investment' && Boolean(row.investmentAssetId));

    const effectiveTargetMonthKey =
      resolvedTargetMonthKey ?? addMonthsToKey(rowMonthKey, 1);

    if (shouldRecordHistory) {
      const actionType = isCancelPaid
        ? 'CANCEL_PAID'
        : isMarkPaid
        ? 'MARK_PAID'
        : 'STATUS_CHANGE';
      const componentLabel = getRowComponentLabel(row);
      const reasonText = isCancelPaid
        ? (revisionDetails?.reason ?? '').trim() || 'Revisi status Paid'
        : isMarkPaid
        ? 'Pelunasan'
        : nextColor === 'red'
        ? `Pending ke ${formatBossMonthFullLabel(effectiveTargetMonthKey)}`
        : 'Batal Pending';

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
          : isMarkPaid
          ? PROJECTION_MARK_PAID_ACTION
          : PROJECTION_STATUS_CHANGE_ACTION;
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
      const targetMsg =
        nextColor === 'red'
          ? `Pending (pindah ke ${formatBossMonthFullLabel(effectiveTargetMonthKey)})`
          : 'Projection';
      const isInvPrincipal =
        row.sourceCategory === 'investment' && row.investmentComponent === 'principal';
      setCopyFeedback(
        `Pelunasan "${row.name}" dibatalkan (${targetMsg}). ${
          isInvPrincipal
            ? `Sisa Pokok kembali menjadi Rp ${formatIDR(
                row.amount
              )} dan Bunga berjalan kembali bulan berikutnya. `
            : ''
        }Alasan: "${revisionDetails?.reason ?? '-'}".`
      );
      window.setTimeout(() => setCopyFeedback(null), 6000);
    } else if (nextColor === 'red') {
      const targetLabel = formatBossMonthFullLabel(effectiveTargetMonthKey);
      setCopyFeedback(
        `"${row.name}" diubah ke Pending: Pindah ke ${targetLabel} (Nominal Projection bulan ini menjadi Rp 0).`
      );
      window.setTimeout(() => setCopyFeedback(null), 5000);
    } else if (prevColor === 'red' && nextColor === 'white') {
      setCopyFeedback(
        `Pending "${row.name}" dibatalkan dan dikembalikan ke Projection ${formatBossMonthFullLabel(
          rowMonthKey
        )}.`
      );
      window.setTimeout(() => setCopyFeedback(null), 4500);
    } else if (nextColor === 'green') {
      setCopyFeedback(
        `"${row.name}" ditandai Paid (Rp ${formatIDR(row.amount)})${
          row.isAuto ? ' & disinkronkan ke menu asalnya' : ''
        }.`
      );
      window.setTimeout(() => setCopyFeedback(null), 4500);
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

  const handleChangeRowStatus = (
    row: BossReportComputedRow,
    nextColor: BossReportColorStatus
  ) => {
    if (isBossMode) return;
    if (row.projectionManualItemId) {
      if (nextColor === row.color) return;
      void executeRowStatusChange(row, nextColor);
      return;
    }
    if (nextColor === row.color && nextColor !== 'red') return;
    const rowMonthKey = row.sourceMonthKey ?? selectedMonthKey;

    // 1. Jika status saat ini HIJAU - Paid dan diubah ke PUTIH / MERAH -> Konfirmasi 2 langkah + wajib isi Alasan Revisi
    if (row.color === 'green' && (nextColor === 'white' || nextColor === 'red')) {
      openCancelPaidModal(row, nextColor);
      return;
    }

    // 2. Pencegahan salah klik: konfirmasi dulu sebelum menandai HIJAU - Paid
    if (nextColor === 'green') {
      setMarkPaidConfirmRow(row);
      return;
    }

    // 3. Jika dipilih MERAH - Pending -> konfirmasi "Dipindah ke [Bulan + 1]?"
    if (nextColor === 'red') {
      setRescheduleModal({
        row,
        targetMonthKey: addMonthsToKey(rowMonthKey, 1),
      });
      return;
    }

    // 4. Transisi MERAH -> PUTIH (Batal Reschedule) langsung diproses
    void executeRowStatusChange(row, nextColor);
  };

  const handleResetAutoOverride = (
    sourceId?: string,
    targetMonthKey: string = selectedMonthKey
  ) => {
    if (!sourceId) return;
    persistMonthFor(targetMonthKey, (prev) => ({
      ...prev,
      autoOverrides: prev.autoOverrides.filter((o) => o.sourceId !== sourceId),
    }));
  };

  const handleInsertTemplate = async (group: 'operasional' | 'investment') => {
    const names =
      group === 'operasional' ? OPERASIONAL_TEMPLATE_ITEMS : INVESTMENT_TEMPLATE_ITEMS;
    if (group === 'operasional') {
      setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }));
      setExportError(null);
      const saveOpex = onCreateOpex ?? createOpexItem;
      try {
        for (const tplName of names) {
          await saveOpex({
            name: tplName,
            category: 'OPERASIONAL',
            amount: 0,
            monthKey: selectedMonthKey,
            expenseDate: getEndOfMonthISODate(selectedMonthKey),
            isRecurring: false,
            status: 'Not Paid',
            statusWarna: 'PUTIH',
          });
        }
      } catch (err) {
        console.error('[Projection][Opex] Gagal isi daftar rutin Operasional:', err);
        const errMsg =
          err instanceof Error
            ? `Gagal menyimpan daftar rutin Operasional ke Supabase: ${err.message}`
            : 'Gagal menyimpan daftar rutin Operasional ke Supabase.';
        setExportError(errMsg);
        setCashOutSectionErrors((prev) => ({ ...prev, operasional: errMsg }));
      }
      return;
    }

    void persistMonth(
      (prev) => ({
        ...prev,
        [group]: [
          ...prev[group],
          ...names.map((name, idx) => ({
            id: generateBossRowId(`${group}_${idx}`),
            name,
            amount: 0,
            color: 'white' as BossReportColorStatus,
          })),
        ],
      }),
      group
    );
  };

  // --- Copy Bulan Lalu (Saldo Awal dari Ending Balance Realisasi bulan lalu, Saldo Rekening, Operasional & Investment manual) ---
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

    if (
      !prevMonth &&
      prevEndingRealisasi === 0
    ) {
      setCopyFeedback(
        `Belum ada data Saldo Awal, Saldo Rekening, Operasional, atau Investment di ${prevLabel} untuk disalin.`
      );
      window.setTimeout(() => setCopyFeedback(null), 4000);
      return;
    }

    const prevOpList = prevMonth?.operasional ?? [];
    const prevInvList = prevMonth?.investment ?? [];

    if (
      prevOpList.length === 0 &&
      prevInvList.length === 0 &&
      !prevHasAccounts &&
      prevEndingRealisasi === 0
    ) {
      setCopyFeedback(
        `Belum ada data Saldo Awal, Saldo Rekening, Operasional, atau Investment di ${prevLabel} untuk disalin.`
      );
      window.setTimeout(() => setCopyFeedback(null), 4000);
      return;
    }

    const copiedOp = prevOpList.map((item, idx) => {
      const { rescheduledToMonth: _rtm, ...rest } = item;
      void _rtm;
      return {
        ...rest,
        id: generateBossRowId(`op_copy_${idx}`),
        color: 'white' as BossReportColorStatus,
      };
    });
    const copiedInv = prevInvList.map((item, idx) => {
      const { rescheduledToMonth: _rtm, ...rest } = item;
      void _rtm;
      return {
        ...rest,
        id: generateBossRowId(`inv_copy_${idx}`),
        color: 'white' as BossReportColorStatus,
      };
    });
    const shouldCopyAccounts = Boolean(
      currAllZeroAccounts && (prevHasAccounts || prevEndingRealisasi !== 0)
    );
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
      operasional: [...prev.operasional, ...copiedOp],
      investment: [...prev.investment, ...copiedInv],
    }));
    setOpeningBalanceDraft(String(prevEndingRealisasi));

    setCopyFeedback(
      `Berhasil copy Saldo Awal (${formatSignedCurrency(prevEndingRealisasi)}), ${
        shouldCopyAccounts ? 'Saldo Rekening (Saldo Akhir bulan lalu), ' : ''
      }${copiedOp.length} item Operasional & ${copiedInv.length} item Investment dari ${prevLabel}.`
    );
    window.setTimeout(() => setCopyFeedback(null), 4500);
  };

  // --- Share Boss Mode ---
  const handleShareToBoss = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'bos');
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
      exportBossReportToExcel(viewModel);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Gagal membuat file Excel Laporan Bos.'
      );
    }
  };

  const handleDownloadPDF = () => {
    setExportError(null);
    try {
      exportBossReportToPDF(viewModel);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Gagal membuat file PDF Laporan Bos.'
      );
    }
  };

  const toggleExpandGroup = (groupKey: string) => {
    setExpandedGroupKeys((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const openGroupedAmountEditModal = (
    group: ProjectionRowGroup,
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    proposedTotal: number
  ) => {
    const perRowDrafts: Record<string, string> = {};
    for (const item of group.items) {
      if (item.color !== 'red') {
        perRowDrafts[item.rowKey] = String(item.projectedAmount);
      }
    }
    setGroupedAmountEditModal({
      group,
      manualSection,
      proposedTotal: Math.max(0, Math.round(proposedTotal)),
      editMode: 'choose',
      perRowDrafts,
      isSaving: false,
    });
  };

  const applyGroupedAmountUpdates = async (
    updates: Array<{ row: BossReportComputedRow; nextAmount: number }>,
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual'
  ) => {
    if (updates.length === 0 || isBossMode) return;
    const monthsMap = new Map<string, BossReportMonthData>();
    const getWorkingMonth = (mk: string): BossReportMonthData => {
      let existing = monthsMap.get(mk);
      if (!existing) {
        const base = buildPersistBaseDataFor(mk);
        existing = {
          ...base,
          accounts: base.accounts.map((a) => ({ ...a })),
          cashInManual: base.cashInManual.map((i) => ({ ...i })),
          operasional: base.operasional.map((i) => ({ ...i })),
          investment: base.investment.map((i) => ({ ...i })),
          projectCostManual: base.projectCostManual.map((i) => ({ ...i })),
          autoOverrides: base.autoOverrides.map((o) => ({ ...o })),
          rescheduledIn: (base.rescheduledIn ?? []).map((r) => ({
            ...r,
            historyMonths: [...r.historyMonths],
          })),
        };
        monthsMap.set(mk, existing);
      }
      return existing;
    };

    const nonRecurringOpexUpdates: Array<{ row: BossReportComputedRow; nextAmount: number }> = [];

    for (const { row, nextAmount } of updates) {
      const rowMonthKey = row.sourceMonthKey ?? selectedMonthKey;
      const safeAmount = Math.max(0, Math.round(nextAmount));
      if (row.isRescheduledIn && row.rescheduledItemId) {
        const m = getWorkingMonth(rowMonthKey);
        m.rescheduledIn = (m.rescheduledIn ?? []).map((rs) =>
          rs.id === row.rescheduledItemId
            ? { ...rs, amount: safeAmount, hasCustomOverride: true }
            : rs
        );
      } else if (row.sourceCategory === 'opex' && row.isAuto) {
        const opexId = row.opexId ?? (row.sourceId ? row.sourceId.replace(/^opex_/, '') : '');
        const existingOpex = groupingLookups.opexById.get(opexId);
        if (existingOpex?.isRecurring || updates.length > 1) {
          if (row.sourceId) {
            const m = getWorkingMonth(rowMonthKey);
            const existingOv = m.autoOverrides.find((o) => o.sourceId === row.sourceId);
            const baseOv: BossReportAutoOverride = existingOv ?? {
              sourceId: row.sourceId,
              hasCustomName: false,
              name: '',
              hasCustomAmount: false,
              amount: 0,
              hasCustomColor: false,
              color: 'white',
            };
            m.autoOverrides = [
              ...m.autoOverrides.filter((o) => o.sourceId !== row.sourceId),
              { ...baseOv, hasCustomAmount: true, amount: safeAmount },
            ];
          }
        } else {
          nonRecurringOpexUpdates.push({ row, nextAmount: safeAmount });
        }
      } else if (row.isAuto && row.sourceId) {
        const m = getWorkingMonth(rowMonthKey);
        const existingOv = m.autoOverrides.find((o) => o.sourceId === row.sourceId);
        const baseOv: BossReportAutoOverride = existingOv ?? {
          sourceId: row.sourceId,
          hasCustomName: false,
          name: '',
          hasCustomAmount: false,
          amount: 0,
          hasCustomColor: false,
          color: 'white',
        };
        m.autoOverrides = [
          ...m.autoOverrides.filter((o) => o.sourceId !== row.sourceId),
          { ...baseOv, hasCustomAmount: true, amount: safeAmount },
        ];
      } else if (row.projectionManualItemId) {
        await handleQuickPatchProjectionManualItem(row, { nominal: safeAmount });
      } else if (row.sourceId) {
        const m = getWorkingMonth(rowMonthKey);
        m[manualSection] = m[manualSection].map((item) =>
          item.id === row.sourceId ? { ...item, amount: safeAmount } : item
        );
      }
    }

    for (const opUpd of nonRecurringOpexUpdates) {
      await handleUpdateOpexRow(opUpd.row, { amount: opUpd.nextAmount });
    }

    const monthsToSave = Array.from(monthsMap.values());
    if (monthsToSave.length > 0) {
      if (onSaveBossReportMonthsBatch) {
        await onSaveBossReportMonthsBatch(monthsToSave);
      } else if (onSaveBossReportMonth) {
        for (const m of monthsToSave) {
          await onSaveBossReportMonth(m);
        }
      } else {
        for (const m of monthsToSave) {
          await saveBossReportMonth(m);
        }
      }
    }
  };

  const renderSingleLedgerRow = (
    row: BossReportComputedRow,
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    includeSaldoColumn = false,
    includeSourceColumn = false,
    isSubRow = false
  ) => {
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
        row.rescheduledOutLabel ||
        row.rescheduleLabel ||
        revStats.revisionCount > 0 ||
        isRange ||
        isSubRow
    );
    const opexForRow =
      row.sourceCategory === 'opex' && row.opexId
        ? groupingLookups.opexById.get(row.opexId)
        : undefined;
    const shouldOverrideRecurringOpexPerPeriod = Boolean(
      opexForRow?.isRecurring && (isRange || isSubRow)
    );

    const isProjectionManualRow = Boolean(row.projectionManualItemId);
    const isLockedAutoBC = Boolean(
      row.isAuto && (row.section === 'investment' || row.section === 'projectCost')
    );
    const autoLockTooltip = 'Item otomatis, ubah di menu Investment / Project';
    const manualDisplaySubtitle = isProjectionManualRow
      ? [
          row.section === 'projectCost' && row.manualProjectName
            ? `Project: ${row.manualProjectName}`
            : undefined,
          row.section === 'projectCost' && row.manualVendor
            ? `Vendor: ${row.manualVendor}`
            : undefined,
          row.manualKeterangan || undefined,
        ]
          .filter(Boolean)
          .join(' · ')
      : row.subtitle;

    return (
      <tr
        key={row.rowKey}
        title={isLockedAutoBC ? autoLockTooltip : undefined}
        className={`${
          isSubRow && row.color === 'white' ? 'bg-slate-50/75 hover:bg-slate-100/70' : style.rowClass
        } border-b border-slate-200 transition-colors`}
      >
        <td
          className={`py-2.5 align-middle ${
            isSubRow ? 'pl-9 pr-4 border-l-4 border-l-slate-300' : 'px-4'
          }`}
        >
          <InlineTextCell
            value={row.name}
            subtitle={manualDisplaySubtitle}
            isManualBadge={isProjectionManualRow}
            disabled={isBossMode || isLockedAutoBC}
            lockedTooltip={isLockedAutoBC ? autoLockTooltip : undefined}
            onCommit={(nextName) => {
              if (row.isRescheduledIn && row.rescheduledItemId) {
                handleUpdateRescheduledItem(
                  row.rescheduledItemId,
                  { name: nextName },
                  rowMonthKey
                );
              } else if (isProjectionManualRow) {
                void handleQuickPatchProjectionManualItem(row, { namaItem: nextName });
              } else if (row.sourceCategory === 'opex' && row.isAuto) {
                if (shouldOverrideRecurringOpexPerPeriod) {
                  handleUpdateAutoOverride(row, { name: nextName }, rowMonthKey);
                } else {
                  void handleUpdateOpexRow(row, { name: nextName });
                }
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
              {(isRange || isSubRow) && row.sourceMonthKey && (
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
              {row.rescheduledOutLabel && (
                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-slate-200 text-slate-700 border border-slate-300 rounded">
                  {row.rescheduledOutLabel}
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

        {/* Nominal (Projection) — PUTIH & HIJAU masuk Rencana Projection; MERAH (Pending) dicoret & Rp 0 */}
        <td className="py-2.5 px-4 text-right align-middle whitespace-nowrap">
          {row.color === 'red' ? (
            <div
              className="flex flex-col items-end gap-0.5 font-mono text-xs sm:text-sm tabular-nums"
              title={
                row.rescheduledToMonth
                  ? `Pending — dipending ke ${formatBossMonthFullLabel(row.rescheduledToMonth)}`
                  : 'Pending — tidak dihitung di bulan ini (Rp 0)'
              }
            >
              <div className="inline-flex items-center justify-end gap-1.5">
                <span className="line-through text-slate-400">
                  {formatSignedCurrency(row.amount)}
                </span>
                <span className="font-semibold text-slate-500">
                  {formatSignedCurrency(0)}
                </span>
              </div>
              <span className="font-sans text-[10px] font-medium text-slate-500">
                Tidak dihitung di bulan ini
              </span>
            </div>
          ) : (
            <InlineMoneyCell
              value={row.projectedAmount}
              disabled={isBossMode || isLockedAutoBC}
              lockedTooltip={isLockedAutoBC ? autoLockTooltip : undefined}
              onCommit={(nextAmount) => {
                if (row.isRescheduledIn && row.rescheduledItemId) {
                  handleUpdateRescheduledItem(
                    row.rescheduledItemId,
                    { amount: nextAmount },
                    rowMonthKey
                  );
                } else if (isProjectionManualRow) {
                  void handleQuickPatchProjectionManualItem(row, { nominal: nextAmount });
                } else if (row.sourceCategory === 'opex' && row.isAuto) {
                  if (shouldOverrideRecurringOpexPerPeriod) {
                    handleUpdateAutoOverride(row, { amount: nextAmount }, rowMonthKey);
                  } else {
                    void handleUpdateOpexRow(row, { amount: nextAmount });
                  }
                } else if (row.isAuto) {
                  handleUpdateAutoOverride(row, { amount: nextAmount }, rowMonthKey);
                } else if (row.sourceId) {
                  handleUpdateManualItem(
                    manualSection,
                    row.sourceId,
                    { amount: nextAmount },
                    rowMonthKey
                  );
                }
              }}
            />
          )}
        </td>

        {includeSaldoColumn && (
          <td className="py-2.5 px-4 text-right align-middle font-mono text-xs sm:text-sm tabular-nums text-slate-400 whitespace-nowrap">
            -
          </td>
        )}

        {/* Status Warna: default PUTIH - Not Paid; dropdown strictly 2 opsi (HIJAU - Paid & MERAH - Reschedule) */}
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
                onSelect={(nextColor) => handleChangeRowStatus(row, nextColor)}
              />
              {savingRowKeys[row.rowKey] && (
                <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                  Menyimpan...
                </span>
              )}
              {row.color === 'green' && (
                <button
                  type="button"
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  onClick={() =>
                    isProjectionManualRow
                      ? void executeRowStatusChange(row, 'white')
                      : openCancelPaidModal(row, 'white')
                  }
                  title="Batalkan status Paid / Revisi ke Projection"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3 shrink-0" />
                  Batalkan Paid / Revisi
                </button>
              )}
              {row.color === 'red' && (
                <>
                  {!isProjectionManualRow && (
                    <button
                      type="button"
                      disabled={Boolean(savingRowKeys[row.rowKey])}
                      onClick={() =>
                        setRescheduleModal({
                          row,
                          targetMonthKey:
                            row.rescheduledToMonth || addMonthsToKey(rowMonthKey, 1),
                        })
                      }
                      title="Ubah bulan tujuan Pending"
                      className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-300 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      Ubah Bulan
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={Boolean(savingRowKeys[row.rowKey])}
                    onClick={() => void executeRowStatusChange(row, 'white')}
                    title="Batalkan Pending dan kembalikan ke bulan ini"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3 shrink-0" />
                    Batalkan Pending / Kembalikan
                  </button>
                </>
              )}
            </div>
          )}
        </td>

        {!isBossMode && (
          <td
            className="py-2.5 px-3 text-right align-middle whitespace-nowrap w-24"
            title={isLockedAutoBC ? autoLockTooltip : undefined}
          >
            {row.isRescheduledIn ? null : isProjectionManualRow && row.projectionManualItemId ? (
              <div className="inline-flex items-center justify-end gap-1">
                <button
                  type="button"
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  onClick={() => openEditProjectionManualModal(row)}
                  title="Edit item manual Projection"
                  aria-label={`Edit ${row.name}`}
                  className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  onClick={() => {
                    const existing = projectionManualById.get(row.projectionManualItemId!);
                    if (existing) {
                      setProjectionManualDeleteModal({
                        item: existing,
                        isDeleting: false,
                        error: null,
                      });
                    }
                  }}
                  title="Hapus item manual ini dari Projection"
                  aria-label={`Hapus ${row.name}`}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-100/70 rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : row.sourceCategory === 'opex' && row.isAuto ? (
              <div className="inline-flex items-center justify-end gap-1">
                <button
                  type="button"
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  onClick={() => openEditOpexModal(row)}
                  title="Edit data Opex baris ini"
                  className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {row.hasCustomOverride && (
                  <button
                    type="button"
                    disabled={Boolean(savingRowKeys[row.rowKey])}
                    onClick={() => handleResetAutoOverride(row.sourceId, rowMonthKey)}
                    title="Kembalikan nominal/nama bulan ini ke nilai Opex asli"
                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={Boolean(savingRowKeys[row.rowKey])}
                  onClick={() => void handleDeleteOpexRow(row)}
                  title="Hapus baris Operasional dari Supabase"
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-100/70 rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingRowKeys[row.rowKey] ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ) : row.isAuto ? (
              row.hasCustomOverride && !isLockedAutoBC ? (
                <button
                  type="button"
                  onClick={() => handleResetAutoOverride(row.sourceId, rowMonthKey)}
                  title="Kembalikan ke nilai otomatis asli"
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              ) : isLockedAutoBC ? (
                <span
                  title={autoLockTooltip}
                  className="inline-block px-1.5 py-0.5 text-[10px] font-medium text-slate-400 cursor-help select-none"
                >
                  Otomatis
                </span>
              ) : null
            ) : (
              <button
                type="button"
                onClick={() =>
                  row.sourceId &&
                  void handleDeleteManualItem(manualSection, row.sourceId, rowMonthKey)
                }
                title="Hapus baris"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-100/70 rounded transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </td>
        )}
      </tr>
    );
  };

  const renderGroupedLedgerRows = (
    groups: ProjectionRowGroup[],
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    includeSaldoColumn = false,
    includeSourceColumn = false
  ) => {
    return groups.map((group) => {
      if (group.items.length <= 1) {
        return renderSingleLedgerRow(
          group.items[0],
          manualSection,
          includeSaldoColumn,
          includeSourceColumn,
          false
        );
      }

      const isExpanded = Boolean(expandedGroupKeys[group.groupKey]);
      const editableSubRows = group.items.filter((r) => r.color !== 'red');
      const canDeleteGroupPeriods = group.items.some(
        (item) =>
          !item.isRescheduledIn &&
          ((item.sourceCategory === 'opex' && item.isAuto) ||
            (!item.isAuto && Boolean(item.sourceId)))
      );
      const parentRowBg = group.allGreen
        ? 'bg-emerald-50/60 hover:bg-emerald-50'
        : group.allRed
        ? 'bg-slate-100/80 hover:bg-slate-100'
        : 'bg-white hover:bg-slate-50/90';

      return (
        <React.Fragment key={`grp_${group.groupKey}`}>
          <tr className={`${parentRowBg} border-b border-slate-200 transition-colors`}>
            <td className="py-2.5 px-4 align-middle">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => toggleExpandGroup(group.groupKey)}
                  aria-expanded={isExpanded}
                  title={isExpanded ? 'Tutup detail per periode' : 'Lihat detail per periode'}
                  className="mt-0.5 p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 rounded transition-colors cursor-pointer shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpandGroup(group.groupKey)}
                      className="text-left text-xs sm:text-sm font-semibold text-slate-900 hover:underline decoration-slate-400 underline-offset-2 cursor-pointer"
                    >
                      {group.displayName}
                    </button>
                    <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 rounded whitespace-nowrap">
                      {group.periodRangeBadge}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold border rounded whitespace-nowrap ${
                        group.isPrincipalBalance
                          ? 'bg-indigo-50 text-indigo-800 border-indigo-300'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}
                    >
                      {group.aggregationBadgeLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpandGroup(group.groupKey)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded cursor-pointer whitespace-nowrap"
                    >
                      {isExpanded
                        ? 'Tutup Detail'
                        : `Lihat Detail (${group.items.length} periode)`}
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {group.baseDescription}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-1 break-words">
                    {group.breakdownText}
                  </div>
                  {(group.pendingSummaryBadges.length > 0 ||
                    group.paidCount > 0 ||
                    group.hasAnyLateBadge) && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {group.pendingSummaryBadges.map((msg) => (
                        <span
                          key={msg}
                          className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-red-50 text-red-800 border border-red-300 rounded"
                        >
                          {msg}
                        </span>
                      ))}
                      {group.allGreen ? (
                        <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                          Semua ({group.items.length}x) Paid
                        </span>
                      ) : group.paidCount > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                          {group.paidCount} dari {group.items.length} periode Paid
                        </span>
                      ) : null}
                      {group.hasAnyLateBadge && (
                        <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold bg-red-600 text-white border border-red-700 rounded">
                          Ada Jatuh Tempo / Telat
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </td>

            {includeSourceColumn && (
              <td className="py-2.5 px-4 align-middle text-xs font-medium text-slate-700 whitespace-nowrap">
                {getCashInSourceLabel(group.items[0]?.cashInSource)}
              </td>
            )}

            <td className="py-2.5 px-4 text-right align-middle whitespace-nowrap">
              {group.allRed ? (
                <div className="flex flex-col items-end gap-0.5 font-mono text-xs sm:text-sm tabular-nums">
                  <span className="line-through text-slate-400">
                    {formatSignedCurrency(group.totalBaseAmount)}
                  </span>
                  <span className="font-semibold text-slate-500">
                    {formatSignedCurrency(0)}
                  </span>
                  <span className="font-sans text-[10px] font-medium text-slate-500">
                    Semua periode dipending
                  </span>
                </div>
              ) : group.isPrincipalBalance ? (
                <div
                  className="flex flex-col items-end"
                  title="Pokok adalah saldo outstanding (tidak ditotal antar periode). Buka detail sub-baris untuk mengedit atau mengubah status per periode."
                >
                  <span className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-indigo-950">
                    {formatSignedCurrency(group.totalProjectedAmount)}
                  </span>
                  <span className="text-[10px] font-sans text-indigo-700 font-medium mt-0.5">
                    saldo outstanding (tidak ditotal)
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-end">
                  <InlineMoneyCell
                    value={group.totalProjectedAmount}
                    disabled={
                      isBossMode ||
                      editableSubRows.length === 0 ||
                      editableSubRows.every(
                        (r) =>
                          r.isAuto &&
                          (r.section === 'investment' || r.section === 'projectCost')
                      )
                    }
                    lockedTooltip={
                      editableSubRows.some(
                        (r) =>
                          r.isAuto &&
                          (r.section === 'investment' || r.section === 'projectCost')
                      )
                        ? 'Item otomatis, ubah di menu Investment / Project'
                        : undefined
                    }
                    onCommit={(nextTotal) =>
                      openGroupedAmountEditModal(group, manualSection, nextTotal)
                    }
                  />
                  <span className="text-[10px] font-sans text-slate-500 mt-0.5">
                    total {group.items.length} periode
                  </span>
                </div>
              )}
            </td>

            {includeSaldoColumn && (
              <td className="py-2.5 px-4 text-right align-middle font-mono text-xs sm:text-sm tabular-nums text-slate-400 whitespace-nowrap">
                -
              </td>
            )}

            <td className="py-2.5 px-4 align-middle whitespace-nowrap">
              <div className="flex flex-wrap items-center gap-1.5">
                {group.allGreen ? (
                  <span className="inline-block px-2 py-0.5 text-[11px] font-semibold border rounded bg-emerald-50 text-emerald-800 border-emerald-200">
                    Paid ({group.items.length}x)
                  </span>
                ) : group.allRed ? (
                  <span className="inline-block px-2 py-0.5 text-[11px] font-semibold border rounded bg-red-50 text-red-900 border-red-300">
                    Pending ({group.items.length}x)
                  </span>
                ) : group.hasAnyRed || group.hasAnyGreen ? (
                  <span className="inline-block px-2 py-0.5 text-[11px] font-semibold border rounded bg-amber-50 text-amber-800 border-amber-300">
                    Campuran ({group.paidCount} Paid · {group.pendingCount} Pending)
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 text-[11px] font-semibold border rounded bg-white text-slate-700 border-slate-300">
                    Projection ({group.items.length}x)
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleExpandGroup(group.groupKey)}
                  className="px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors cursor-pointer"
                >
                  {isExpanded ? 'Tutup' : 'Detail Status'}
                </button>
              </div>
            </td>

            {!isBossMode && (
              <td className="py-2.5 px-3 text-right align-middle whitespace-nowrap w-24">
                <div className="inline-flex items-center justify-end gap-1">
                  {canDeleteGroupPeriods && (
                    <button
                      type="button"
                      onClick={() =>
                        setGroupedDeleteModal({
                          group,
                          manualSection,
                          isDeleting: false,
                          deletingRowKey: null,
                          error: null,
                        })
                      }
                      title="Pilih periode yang ingin dihapus"
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-100/70 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleExpandGroup(group.groupKey)}
                    title="Buka sub-baris untuk Edit / Hapus per periode"
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </td>
            )}
          </tr>

          {isExpanded &&
            group.items.map((subRow) =>
              renderSingleLedgerRow(
                subRow,
                manualSection,
                includeSaldoColumn,
                includeSourceColumn,
                true
              )
            )}
        </React.Fragment>
      );
    });
  };

  const renderLedgerRows = (
    rows: BossReportComputedRow[],
    groups: ProjectionRowGroup[],
    manualSection: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    includeSaldoColumn = false,
    includeSourceColumn = false
  ) => {
    if (groupingMode === 'grouped') {
      return renderGroupedLedgerRows(
        groups,
        manualSection,
        includeSaldoColumn,
        includeSourceColumn
      );
    }
    return rows.map((row) =>
      renderSingleLedgerRow(
        row,
        manualSection,
        includeSaldoColumn,
        includeSourceColumn,
        false
      )
    );
  };

  const renderInlineAddRow = (
    section: 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual',
    placeholder: string,
    includeSaldoColumn = false,
    includeSourceColumn = false
  ) => {
    if (isBossMode || addingSection !== section) return null;

    const colSpan =
      (isBossMode ? 3 : 4) + (includeSaldoColumn ? 1 : 0) + (includeSourceColumn ? 1 : 0);

    return (
      <tr className="bg-slate-50 border-b border-slate-300">
        <td
          className="py-2.5 px-4"
          colSpan={colSpan}
        >
          <form
            onSubmit={handleAddItemSubmit}
            className="flex flex-col sm:flex-row sm:items-center gap-2"
          >
            <input
              type="text"
              required
              autoFocus
              disabled={isSavingNewItem}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={placeholder}
              className="flex-1 px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
            />
            <div className="relative sm:w-44">
              <span className="text-xs font-mono text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                Rp
              </span>
              <RupiahInput
                disabled={isSavingNewItem}
                value={newItemAmount}
                onValueChange={setNewItemAmount}
                placeholder="0"
                className="w-full pl-8 pr-2.5 py-1.5 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
              />
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-md text-slate-700 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-slate-300 border border-slate-400" />
              Default: Projection
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="submit"
                disabled={isSavingNewItem}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              >
                {isSavingNewItem ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                type="button"
                disabled={isSavingNewItem}
                onClick={() => setAddingSection(null)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer disabled:opacity-60"
              >
                Batal
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
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
      {onSwitchToBalance && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-1 inline-flex items-center gap-1">
            <button
              type="button"
              aria-current="page"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white transition-colors whitespace-nowrap shrink-0 cursor-default"
            >
              Projection
            </button>
            <button
              type="button"
              onClick={onSwitchToBalance}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Realisasi
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Menampilkan seluruh rencana arus kas bulanan (Projection, Paid &amp; Pending)
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
            ariaLabelPrefix="laporan projection"
          />

          {!isBossMode && (
            <form
              onSubmit={handleSaveOpeningBalance}
              className="flex flex-wrap items-center gap-2 xl:border-l xl:border-slate-200 xl:pl-3"
            >
              <label
                htmlFor="saldo-awal-bulan-input"
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
                  id="saldo-awal-bulan-input"
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
              title="Salin Saldo Awal, item Operasional & Investment dari bulan lalu ke bulan ini"
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
                ? 'Link Mode Bos (Read-Only) berhasil disalin ke clipboard:'
                : 'Salin link Mode Bos berikut secara manual:'}
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

      {/* Monthly Projection KPI Overview: 6 Separate Cards (Saldo Awal, Cash In, 3x Cash Out, Ending Balance) */}
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

        {/* Card 2 - CASH IN (PROJECTED) */}
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
            Cash In (Projected)
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            {formatSignedCurrency(viewModel.totalCashIn)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidCounts.cashIn} item lunas · {viewModel.cashInRows.length} rencana
          </p>
        </div>

        {/* Card 3 - CASH OUT OPEX */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Cash Out Opex
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatSignedCurrency(viewModel.totalOperasionalCost)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidCounts.operasional} item lunas · {viewModel.operasionalRows.length} rencana
          </p>
        </div>

        {/* Card 4 - CASH OUT INVESTMENT */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Cash Out Investment
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatSignedCurrency(viewModel.totalInvestmentCost)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidCounts.investment} item lunas · {viewModel.investmentRows.length} rencana
          </p>
        </div>

        {/* Card 5 - CASH OUT PROJECT COST */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Cash Out Project Cost
          </p>
          <p className="text-lg sm:text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {formatSignedCurrency(viewModel.totalProjectCost)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {paidCounts.projectCost} item lunas · {viewModel.projectCostRows.length} rencana
          </p>
        </div>

        {/* Card 6 - ENDING BALANCE PROJECTED */}
        <div
          className={`border rounded-xl p-4 ${
            viewModel.isMinus
              ? 'bg-red-50 border-red-300 text-red-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            Ending Balance Projected
          </p>
          <p
            className={`text-lg sm:text-xl font-extrabold font-mono tabular-nums mt-1.5 ${
              viewModel.isMinus ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {formatSignedCurrency(viewModel.endingBalance)}
          </p>
          <p className="text-[11px] font-bold mt-1 tabular-nums">
            {viewModel.isMinus ? 'MINUS — BUTUH DANA' : 'POSITIF / AMAN'}
          </p>
        </div>
      </section>

      {/* Grafik Cash In vs Cash Out */}
      <CashflowChartCard
        series={chartSeries}
        selectedMonthKey={activeStartMonthKey}
        selectedEndMonthKey={activeEndMonthKey}
        isRange={isRange}
        onSelectMonth={(mk) => setSelectedMonthKey(mk)}
        totalOperasional={viewModel.totalOperasionalCost}
        totalInvestment={viewModel.totalInvestmentCost}
        totalProjectCost={viewModel.totalProjectCost}
        totalCost={viewModel.totalCost}
        totalCashIn={viewModel.totalCashIn}
        title={
          isRange
            ? `Grafik Cash In vs Cash Out & Trend Ending Balance (${chartSeries.length} Bulan)`
            : 'Grafik Cash In vs Cash Out & Trend Ending Balance (6 Bulan)'
        }
        ariaLabel={`Grafik perbandingan Cash In vs Cash Out dan Trend Ending Balance ${chartSeries.length} bulan`}
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
        onGoToBalance={onSwitchToBalance}
      />

      {/* Toggle Tampilan List Projection: [ Pisah per Periode | Gabung per Komponen ] */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-slate-700">
            Tampilan List Projection:
          </span>
          <div
            role="group"
            aria-label="Toggle tampilan list projection"
            className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg"
          >
            <button
              type="button"
              onClick={() => setGroupingMode('split')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                groupingMode === 'split'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pisah per Periode
            </button>
            <button
              type="button"
              onClick={() => setGroupingMode('grouped')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                groupingMode === 'grouped'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Gabung per Komponen
            </button>
          </div>
        </div>
        <span className="text-[11px] text-slate-500">
          {groupingMode === 'grouped'
            ? 'Mode Gabung aktif · Klik baris atau "Lihat Detail" untuk melihat & mengubah status per periode'
            : 'Mode Pisah aktif · Menampilkan item per periode secara terpisah'}
        </span>
      </div>

      {/* ================================================================= */}
      {/* 2. SALDO AWAL & CASH IN [NAMA BULAN] + ACCOUNT BALANCE             */}
      {/* ================================================================= */}
      <section className="bg-white border border-slate-300 rounded-xl overflow-hidden">
        <div className="bg-emerald-800 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Cash In {viewModel.monthNameOnly}
            </h2>
            <p className="text-[11px] text-emerald-100 mt-0.5">
              Saldo Awal ditampilkan terpisah di atas · Total Cash In = Invoice Client + Pencairan Pinjaman Investment + pemasukan manual
            </p>
          </div>

          {!isBossMode && (
            <button
              type="button"
              onClick={() => openAddItem('cashInManual')}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white text-emerald-900 hover:bg-emerald-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Cash In Manual
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
              Subtotal filter: {formatSignedCurrency(filteredCashInTotals.projected)}
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
                  Cash In (Projection)
                </th>
                <th className="py-2.5 px-4 text-right w-44 whitespace-nowrap">
                  Saldo
                </th>
                <th className="py-2.5 px-4 w-56">Status Warna</th>
                {!isBossMode && <th className="py-2.5 px-3 w-12" />}
              </tr>
            </thead>
            <tbody>
              {/* Separate First Row: SALDO AWAL (never merged into Cash In items) */}
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
                <td className="py-3 px-4 text-right align-middle font-mono text-xs sm:text-sm font-bold text-blue-900 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(viewModel.saldoAwal)}
                </td>
                <td className="py-3 px-4 align-middle whitespace-nowrap">
                  <span className="text-xs font-semibold text-blue-800">Saldo Awal</span>
                </td>
                {!isBossMode && <td className="py-3 px-3" />}
              </tr>

              {filteredCashInRows.length === 0 && addingSection !== 'cashInManual' ? (
                <tr>
                  <td
                    colSpan={isBossMode ? 5 : 6}
                    className="py-6 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                  >
                    {cashInSourceFilter !== 'all'
                      ? `Tidak ada item Cash In dengan sumber "${getCashInSourceLabel(cashInSourceFilter)}" di ${viewModel.monthFullLabel}.`
                      : `Belum ada Invoice Client jatuh tempo maupun Pencairan Pinjaman Investment di ${viewModel.monthFullLabel}.`}
                    {cashInSourceFilter === 'all' &&
                      !isBossMode &&
                      ' Klik "+ Tambah Cash In Manual" untuk menambah pemasukan manual.'}
                  </td>
                </tr>
              ) : (
                renderLedgerRows(filteredCashInRows, groupedCashIn, 'cashInManual', true, true)
              )}

              {renderInlineAddRow(
                'cashInManual',
                'Nama Cash In Manual (contoh: Investment Aria, Said)',
                true,
                true
              )}
            </tbody>
            <tfoot>
              {cashInSourceFilter !== 'all' && (
                <tr className="bg-slate-50 border-t border-slate-200">
                  <td className="py-2 px-4 text-xs font-semibold text-slate-700" colSpan={2}>
                    Subtotal Filter ({getCashInSourceLabel(cashInSourceFilter)})
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-xs font-bold text-slate-800 tabular-nums whitespace-nowrap">
                    {formatSignedCurrency(filteredCashInTotals.projected)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-xs text-slate-400 whitespace-nowrap">
                    -
                  </td>
                  <td className="py-2 px-4" colSpan={isBossMode ? 1 : 2} />
                </tr>
              )}
              <tr className="bg-emerald-50 border-t-2 border-emerald-200">
                <td className="py-2.5 px-4 text-sm font-bold text-emerald-950" colSpan={2}>
                  TOTAL CASH IN
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-sm font-bold text-emerald-900 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(viewModel.totalCashIn)}
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-2.5 px-4" colSpan={isBossMode ? 1 : 2} />
              </tr>
              <tr className="bg-emerald-100/90 border-t border-emerald-300">
                <td className="py-3.5 px-4 text-base sm:text-lg font-extrabold text-emerald-950" colSpan={2}>
                  Account Balance
                  <span className="block text-[11px] font-medium text-emerald-800">
                    Saldo Awal + TOTAL CASH IN (Projected)
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-sm text-slate-400 whitespace-nowrap">
                  -
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-base sm:text-lg font-extrabold text-emerald-950 tabular-nums whitespace-nowrap">
                  {formatSignedCurrency(viewModel.accountBalance)}
                </td>
                <td className="py-3.5 px-4" colSpan={isBossMode ? 1 : 2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 3. CASH OUT (A. OPERASIONAL, B. INVESTMENT, C. PROJECT COST)       */}
      {/* ================================================================= */}
      <section className="bg-white border border-slate-300 rounded-xl overflow-hidden">
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Cash Out {viewModel.monthNameOnly}
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Projection &amp; Paid tetap masuk Rencana Projection · Pending geser ke bulan tujuan
            </p>
          </div>
          <div className="text-xs font-mono font-bold tabular-nums text-slate-100">
            Total Cost (Projection): {formatSignedCurrency(viewModel.totalCost)}
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
                ({groupingMode === 'grouped'
                  ? `${groupedOperasional.length} komponen · ${viewModel.operasionalRows.length} periode`
                  : `${viewModel.operasionalRows.length} item`}{' '}
                · Subtotal:{' '}
                <strong className="font-mono text-slate-900">
                  {formatSignedCurrency(viewModel.totalOperasionalCost)}
                </strong>
                )
              </span>
            </button>

            {!isBossMode && (
              <div className="flex items-center gap-2">
                {onNavigateOpex && (
                  <button
                    type="button"
                    onClick={onNavigateOpex}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    Kelola di Opex
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {viewModel.operasionalRows.length === 0 && (
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('operasional')}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    Isi Daftar Rutin
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCollapsedGroups((p) => ({ ...p, operasional: false }));
                    openCreateOpexModal(selectedMonthKey);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Biaya Opex
                </button>
              </div>
            )}
          </div>

          {cashOutSectionErrors.operasional && (
            <div
              role="alert"
              className="mx-4 mt-3 bg-red-50 border border-red-300 rounded-lg px-3.5 py-2.5 text-xs text-red-800 flex items-center justify-between gap-3"
            >
              <span>{cashOutSectionErrors.operasional}</span>
              <button
                type="button"
                onClick={() =>
                  setCashOutSectionErrors((prev) => ({ ...prev, operasional: null }))
                }
                className="font-semibold hover:underline shrink-0 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          )}

          {!collapsedGroups.operasional && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-2 px-4">Nama Item</th>
                    <th className="py-2 px-4 text-right w-44 whitespace-nowrap">
                      Nominal (Projection)
                    </th>
                    <th className="py-2 px-4 w-56">Status Warna</th>
                    {!isBossMode && <th className="py-2 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {viewModel.operasionalRows.length === 0 &&
                  addingSection !== 'operasional' ? (
                    <tr>
                      <td
                        colSpan={isBossMode ? 3 : 4}
                        className="py-5 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                      >
                        Belum ada item Operasional (contoh: Gaji, Listrik IDPEL, Konsultan, Internet, PPN).
                      </td>
                    </tr>
                  ) : (
                    renderLedgerRows(viewModel.operasionalRows, groupedOperasional, 'operasional')
                  )}

                  {renderInlineAddRow(
                    'operasional',
                    'Nama Biaya Operasional (contoh: Gaji, Listrik IDPEL, Internet)'
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-300">
                    <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
                      Total Operasional Cost
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(viewModel.totalOperasionalCost)}
                    </td>
                    <td className="py-2.5 px-4" colSpan={isBossMode ? 1 : 2} />
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
                ({groupingMode === 'grouped'
                  ? `${groupedInvestment.length} komponen · ${viewModel.investmentRows.length} periode`
                  : `${viewModel.investmentRows.length} item`}{' '}
                · Subtotal:{' '}
                <strong className="font-mono text-slate-900">
                  {formatSignedCurrency(viewModel.totalInvestmentCost)}
                </strong>
                )
              </span>
            </button>

            {!isBossMode && (
              <div className="flex items-center gap-2">
                {onNavigateInvestment && (
                  <button
                    type="button"
                    onClick={onNavigateInvestment}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    Kelola di Investment
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {viewModel.investmentRows.length === 0 && (
                  <button
                    type="button"
                    onClick={() => handleInsertTemplate('investment')}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
                  >
                    Isi Daftar Rutin
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCollapsedGroups((p) => ({ ...p, investment: false }));
                    openAddItem('investment');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Item
                </button>
              </div>
            )}
          </div>

          {cashOutSectionErrors.investment && (
            <div
              role="alert"
              className="mx-4 mt-3 bg-red-50 border border-red-300 rounded-lg px-3.5 py-2.5 text-xs text-red-800 flex items-center justify-between gap-3"
            >
              <span>{cashOutSectionErrors.investment}</span>
              <button
                type="button"
                onClick={() =>
                  setCashOutSectionErrors((prev) => ({ ...prev, investment: null }))
                }
                className="font-semibold hover:underline shrink-0 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          )}

          {!collapsedGroups.investment && (
            <>
              <div className="px-4 py-2 bg-blue-50/70 border-b border-blue-200 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-700">
                  Cutoff:{' '}
                  <strong className="text-slate-900">
                    {formatBossMonthFullLabel(cutoffPeriod)}
                  </strong>{' '}
                  - Bunga dihitung untuk periode{' '}
                  <strong className="text-slate-900">
                    {formatBossMonthFullLabel(cutoffPeriod)}
                  </strong>{' '}
                  ke atas. Periode sebelumnya dianggap lunas.
                </p>
                <span className="text-[11px] text-slate-500">
                  Pokok tetap ditagih sampai Lunas.
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-2 px-4">Nama Item</th>
                    <th className="py-2 px-4 text-right w-44 whitespace-nowrap">
                      Nominal (Projection)
                    </th>
                    <th className="py-2 px-4 w-56">Status Warna</th>
                    {!isBossMode && <th className="py-2 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {viewModel.investmentRows.length === 0 &&
                  addingSection !== 'investment' ? (
                    <tr>
                      <td
                        colSpan={isBossMode ? 3 : 4}
                        className="py-5 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                      >
                        Belum ada item Investment di periode ini. Klik &quot;+ Tambah Item&quot; untuk item sekali pakai khusus Projection.
                      </td>
                    </tr>
                  ) : (
                    renderLedgerRows(viewModel.investmentRows, groupedInvestment, 'investment')
                  )}

                  {renderInlineAddRow(
                    'investment',
                    'Nama Item Investment (contoh: Cicilan BRI, Bunga, Pokok)'
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-300">
                    <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
                      Total Investment Cost
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(viewModel.totalInvestmentCost)}
                    </td>
                    <td className="py-2.5 px-4" colSpan={isBossMode ? 1 : 2} />
                  </tr>
                </tfoot>
              </table>
              {isRange &&
                groupedInvestment.some((g) => g.isPrincipalBalance && g.items.length > 1) && (
                  <p className="px-4 py-2 bg-indigo-50/70 border-t border-indigo-200 text-[11px] text-indigo-900">
                    Pokok Investment berlabel <strong>SALDO - Tidak Ditotal</strong>: dihitung 1x sesuai saldo outstanding periode terakhir (tidak dikali jumlah bulan). Hanya Bunga, Denda, Angsuran, dan Bonus yang diakumulasi per periode.
                  </p>
                )}
              {viewModel.hiddenNotDuePrincipalCount > 0 &&
                !viewModel.hasVisiblePrincipalRows && (
                  <p className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
                    Pokok belum jatuh tempo di bulan ini, hanya Bunga yang ditagihkan
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* GROUP C: PROJECT COST (OTOMATIS DARI PO + MANUAL) */}
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
              <span>C. PROJECT COST (OTOMATIS dari PO)</span>
              <span className="text-xs font-normal text-slate-600 tabular-nums">
                ({groupingMode === 'grouped'
                  ? `${groupedProjectCost.length} komponen · ${viewModel.projectCostRows.length} periode`
                  : `${viewModel.projectCostRows.length} item`}{' '}
                · Subtotal:{' '}
                <strong className="font-mono text-slate-900">
                  {formatSignedCurrency(viewModel.totalProjectCost)}
                </strong>
                )
              </span>
            </button>

            {!isBossMode && (
              <button
                type="button"
                onClick={() => {
                  setCollapsedGroups((p) => ({ ...p, projectCost: false }));
                  openAddItem('projectCostManual');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Item
              </button>
            )}
          </div>

          {cashOutSectionErrors.projectCost && (
            <div
              role="alert"
              className="mx-4 mt-3 bg-red-50 border border-red-300 rounded-lg px-3.5 py-2.5 text-xs text-red-800 flex items-center justify-between gap-3"
            >
              <span>{cashOutSectionErrors.projectCost}</span>
              <button
                type="button"
                onClick={() =>
                  setCashOutSectionErrors((prev) => ({ ...prev, projectCost: null }))
                }
                className="font-semibold hover:underline shrink-0 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          )}

          {!collapsedGroups.projectCost && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <th className="py-2 px-4">Nama Item</th>
                    <th className="py-2 px-4 text-right w-44 whitespace-nowrap">
                      Nominal (Projection)
                    </th>
                    <th className="py-2 px-4 w-56">Status Warna</th>
                    {!isBossMode && <th className="py-2 px-3 w-24" />}
                  </tr>
                </thead>
                <tbody>
                  {viewModel.projectCostRows.length === 0 &&
                  addingSection !== 'projectCostManual' ? (
                    <tr>
                      <td
                        colSpan={isBossMode ? 3 : 4}
                        className="py-5 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                      >
                        Belum ada PO / Invoice Vendor yang jatuh tempo di{' '}
                        {viewModel.monthFullLabel}.
                        {!isBossMode &&
                          ' Klik "+ Tambah Item" untuk biaya project sekali pakai di Projection.'}
                      </td>
                    </tr>
                  ) : (
                    renderLedgerRows(
                      viewModel.projectCostRows,
                      groupedProjectCost,
                      'projectCostManual'
                    )
                  )}

                  {renderInlineAddRow(
                    'projectCostManual',
                    'Nama Project Cost Manual (contoh: Ground Zero JBL Speaker, Tripotzar)'
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 border-t border-slate-300">
                    <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
                      Total Project Cost
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatSignedCurrency(viewModel.totalProjectCost)}
                    </td>
                    <td className="py-2.5 px-4" colSpan={isBossMode ? 1 : 2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* OVERALL TOTAL COST */}
        <div className="bg-slate-200 border-t-2 border-slate-400 px-4 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm sm:text-base font-extrabold text-slate-900">
              Total Cost
            </p>
            <p className="text-[11px] text-slate-600">
              Total Operasional Cost + Total Investment Cost + Total Project Cost
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Projection
            </p>
            <p className="font-mono text-base sm:text-lg font-extrabold text-slate-900 tabular-nums whitespace-nowrap">
              {formatSignedCurrency(viewModel.totalCost)}
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 4. FOOTER - ENDING BALANCE                                         */}
      {/* ================================================================= */}
      <section
        className={`border-2 rounded-xl px-5 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          viewModel.isMinus
            ? 'bg-red-50 border-red-400 text-red-900'
            : 'bg-emerald-50 border-emerald-400 text-emerald-900'
        }`}
      >
        <div>
          <p className="text-base sm:text-xl font-extrabold tracking-tight">
            Ending Balance Per {viewModel.monthFullLabel}
          </p>
          <p className="text-xs font-medium mt-0.5 opacity-85 tabular-nums">
            Saldo Awal ({formatSignedCurrency(viewModel.saldoAwal)}) + Cash In (
            {formatSignedCurrency(viewModel.totalCashIn)}) − Total Cost (
            {formatSignedCurrency(viewModel.totalCost)})
          </p>
        </div>

        <div className="text-left sm:text-right">
          <p
            className={`font-mono text-2xl sm:text-3xl font-black tabular-nums ${
              viewModel.isMinus ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {formatSignedCurrency(viewModel.endingBalance)}
          </p>
          <p
            className={`text-xs sm:text-sm font-extrabold uppercase tracking-wide mt-1 ${
              viewModel.isMinus ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {viewModel.isMinus ? 'MINUS - BUTUH DANA' : 'POSITIF / AMAN'}
          </p>
        </div>
      </section>

      {/* Modal 1: Konfirmasi Tandai LUNAS (Pencegahan Salah Klik saat ubah ke HIJAU - Paid) */}
      {markPaidConfirmRow && (() => {
        const isInvPrincipal =
          markPaidConfirmRow.sourceCategory === 'investment' &&
          markPaidConfirmRow.investmentComponent === 'principal';
        const itemSummary = `${markPaidConfirmRow.name} - Rp ${formatIDR(
          markPaidConfirmRow.amount
        )}`;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mark-paid-dialog-title"
            className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-200 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <h3
                      id="mark-paid-dialog-title"
                      className="text-sm font-bold text-emerald-950"
                    >
                      Konfirmasi Tandai LUNAS
                    </h3>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Pencegahan salah klik status Paid
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMarkPaidConfirmRow(null)}
                  className="p-1 text-emerald-700 hover:text-emerald-950 rounded cursor-pointer"
                  aria-label="Tutup dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3 text-xs sm:text-sm text-slate-700">
                <p className="font-semibold text-slate-900">
                  Tandai <span className="text-emerald-800">{itemSummary}</span> sebagai LUNAS?
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {isInvPrincipal
                    ? 'Setelah Paid, Pokok akan dianggap lunas (Sisa Pokok menjadi Rp 0) dan Bunga berhenti pada bulan berikutnya. Bisa dibatalkan kapanpun lewat tombol Batalkan Paid.'
                    : `Item sebesar Rp ${formatIDR(
                        markPaidConfirmRow.amount
                      )} akan ditandai Paid (${
                        viewModel.monthFullLabel
                      }). Status masih bisa dibatalkan kapanpun lewat tombol Batalkan Paid / Revisi.`}
                </p>
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMarkPaidConfirmRow(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetRow = markPaidConfirmRow;
                    setMarkPaidConfirmRow(null);
                    void executeRowStatusChange(targetRow, 'green');
                  }}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Ya, Tandai Lunas
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal 2: Konfirmasi 2 Langkah Batalkan Paid / Revisi (HIJAU -> PUTIH / MERAH) */}
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
            aria-labelledby="cancel-paid-dialog-title"
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
                      id="cancel-paid-dialog-title"
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
                      ? Status akan dikembalikan ke <strong>{targetStatusLabel}</strong>.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="cancel-paid-reason-input"
                    className="block text-xs font-semibold text-slate-800 mb-1.5"
                  >
                    Alasan Revisi <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="cancel-paid-reason-input"
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
                      htmlFor="cancel-paid-date-input"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Tanggal Revisi
                    </label>
                    <input
                      id="cancel-paid-date-input"
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
                      htmlFor="cancel-paid-reschedule-month"
                      className="block text-xs font-semibold text-slate-800 mb-1"
                    >
                      Bulan Tujuan Pending
                    </label>
                    <select
                      id="cancel-paid-reschedule-month"
                      value={targetMonthKey}
                      onChange={(e) =>
                        setCancelPaidModal((prev) =>
                          prev ? { ...prev, targetMonthKey: e.target.value } : null
                        )
                      }
                      className="w-full px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600"
                    >
                      {rescheduleMonthOptions.map((opt) => (
                        <option key={opt.monthKey} value={opt.monthKey}>
                          {opt.label}
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

      {/* Modal 4: Konfirmasi Edit Nominal Gabungan (Bagi rata vs Edit per periode) */}
      {groupedAmountEditModal && (() => {
        const {
          group,
          manualSection,
          proposedTotal,
          editMode,
          perRowDrafts,
          isSaving,
        } = groupedAmountEditModal;
        const activeRows = group.items.filter((r) => r.color !== 'red');
        const activeCount = activeRows.length;
        const baseShare = activeCount > 0 ? Math.floor(proposedTotal / activeCount) : 0;
        const remainder = activeCount > 0 ? proposedTotal - baseShare * activeCount : 0;
        const perPeriodPreview = activeRows.map((item, idx) => ({
          row: item,
          monthLabel: formatBossMonthShortLabel(item.sourceMonthKey ?? item.originMonthKey),
          amount: idx === activeCount - 1 ? baseShare + remainder : baseShare,
        }));
        const perPeriodDraftSum = activeRows.reduce((sum, item) => {
          const parsed = Number(perRowDrafts[item.rowKey] ?? item.projectedAmount);
          return sum + (Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0);
        }, 0);

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="grouped-edit-dialog-title"
            className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="grouped-edit-dialog-title"
                    className="text-sm font-bold text-slate-900"
                  >
                    Edit Nominal Gabungan — {group.displayName}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {formatSignedCurrency(group.totalProjectedAmount)} →{' '}
                    <strong className="text-slate-900">
                      {formatSignedCurrency(proposedTotal)}
                    </strong>{' '}
                    ({activeCount} periode aktif)
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setGroupedAmountEditModal(null)}
                  className="p-1 text-slate-400 hover:text-slate-900 rounded cursor-pointer disabled:opacity-50"
                  aria-label="Tutup dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-700">
                {editMode === 'choose' ? (
                  <>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Nominal ini adalah gabungan dari <strong>{activeCount} periode aktif</strong>.
                      Pilih cara pembaruan yang Anda inginkan:
                    </p>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 text-xs">
                      <p className="font-semibold text-slate-800">
                        Pratinjau jika dibagi rata ({formatSignedCurrency(baseShare)}/periode):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {perPeriodPreview.map((p) => (
                          <span
                            key={p.row.rowKey}
                            className="inline-flex items-center px-2 py-0.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-700"
                          >
                            {p.monthLabel}: {formatSignedCurrency(p.amount)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {activeRows.map((item) => {
                      const mkLabel = formatBossMonthShortLabel(
                        item.sourceMonthKey ?? item.originMonthKey
                      );
                      const showTunggakanTag =
                        item.isRescheduledIn &&
                        computeDueTunggakanStatus({
                          dueISO: item.dueISO,
                          originMonthKey: item.originMonthKey,
                          isPaid: item.color === 'green',
                        }).isTunggakan;
                      return (
                        <div
                          key={item.rowKey}
                          className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900">
                              {mkLabel}
                              {showTunggakanTag ? ' (Tunggakan)' : ''}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              Saat ini: {formatSignedCurrency(item.projectedAmount)}
                            </div>
                          </div>
                          <div className="relative w-40 shrink-0">
                            <span className="text-xs font-mono text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                              Rp
                            </span>
                            <RupiahInput
                              disabled={isSaving}
                              value={perRowDrafts[item.rowKey] ?? String(item.projectedAmount)}
                              onValueChange={(val) =>
                                setGroupedAmountEditModal((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        perRowDrafts: {
                                          ...prev.perRowDrafts,
                                          [item.rowKey]: val,
                                        },
                                      }
                                    : null
                                )
                              }
                              className="w-full pl-8 pr-2.5 py-1.5 text-right text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                      <span className="font-semibold text-slate-700">Total per Periode:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatSignedCurrency(perPeriodDraftSum)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
                {editMode === 'choose' ? (
                  <>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => setGroupedAmountEditModal(null)}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        setGroupedAmountEditModal((prev) =>
                          prev ? { ...prev, editMode: 'perPeriod' } : null
                        )
                      }
                      className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Edit per Periode
                    </button>
                    <button
                      type="button"
                      disabled={isSaving || activeCount === 0}
                      onClick={async () => {
                        setGroupedAmountEditModal((prev) =>
                          prev ? { ...prev, isSaving: true } : null
                        );
                        try {
                          await applyGroupedAmountUpdates(
                            perPeriodPreview.map((p) => ({
                              row: p.row,
                              nextAmount: p.amount,
                            })),
                            manualSection
                          );
                          setGroupedAmountEditModal(null);
                          setCopyFeedback(
                            `Nominal "${group.displayName}" dibagi rata ke ${activeCount} periode (Total ${formatSignedCurrency(
                              proposedTotal
                            )}).`
                          );
                          window.setTimeout(() => setCopyFeedback(null), 4000);
                        } finally {
                          setGroupedAmountEditModal((prev) =>
                            prev ? { ...prev, isSaving: false } : null
                          );
                        }
                      }}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {isSaving ? 'Menyimpan...' : 'Bagi Rata ke Semua Periode'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        setExpandedGroupKeys((prev) => ({
                          ...prev,
                          [group.groupKey]: true,
                        }));
                        setGroupedAmountEditModal(null);
                      }}
                      className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer mr-auto"
                    >
                      Edit Langsung di Sub-Baris
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        setGroupedAmountEditModal((prev) =>
                          prev ? { ...prev, editMode: 'choose' } : null
                        )
                      }
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Kembali
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={async () => {
                        setGroupedAmountEditModal((prev) =>
                          prev ? { ...prev, isSaving: true } : null
                        );
                        try {
                          const updates = activeRows.map((item) => {
                            const parsed = Number(
                              perRowDrafts[item.rowKey] ?? item.projectedAmount
                            );
                            return {
                              row: item,
                              nextAmount: Number.isFinite(parsed)
                                ? Math.max(0, Math.round(parsed))
                                : item.projectedAmount,
                            };
                          });
                          await applyGroupedAmountUpdates(updates, manualSection);
                          setExpandedGroupKeys((prev) => ({
                            ...prev,
                            [group.groupKey]: true,
                          }));
                          setGroupedAmountEditModal(null);
                          setCopyFeedback(
                            `Nominal per periode untuk "${group.displayName}" berhasil diperbarui.`
                          );
                          window.setTimeout(() => setCopyFeedback(null), 4000);
                        } finally {
                          setGroupedAmountEditModal((prev) =>
                            prev ? { ...prev, isSaving: false } : null
                          );
                        }
                      }}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {isSaving ? 'Menyimpan...' : 'Simpan per Periode'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal 3: Konfirmasi Rollover Pending ke Bulan Berikutnya */}
      <RescheduleMonthModal
        isOpen={Boolean(rescheduleModal)}
        itemName={rescheduleModal?.row.name ?? ''}
        amount={rescheduleModal?.row.amount ?? 0}
        originMonthKey={rescheduleModal?.row.sourceMonthKey ?? selectedMonthKey}
        initialTargetMonthKey={rescheduleModal?.targetMonthKey}
        autoRolloverConfirmOnly
        isSaving={
          rescheduleModal ? Boolean(savingRowKeys[rescheduleModal.row.rowKey]) : false
        }
        onCancel={() => setRescheduleModal(null)}
        onConfirm={(targetMk) => {
          if (!rescheduleModal) return;
          const targetRow = rescheduleModal.row;
          setRescheduleModal(null);
          void executeRowStatusChange(targetRow, 'red', undefined, targetMk);
        }}
      />

      {/* Modal 5: Tambah / Edit Biaya Opex (selalu simpan 1 baris by ID asli & dropdown Periode Opex) */}
      {opexFormModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="projection-opex-form-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSubmitOpexFormModal}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h3
                  id="projection-opex-form-title"
                  className="text-sm font-bold text-slate-900"
                >
                  {opexFormModal.mode === 'create'
                    ? 'Tambah Biaya Opex'
                    : 'Edit Biaya Opex'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {opexFormModal.mode === 'create'
                    ? 'Selalu menambahkan 1 baris baru pada Periode Opex yang dipilih.'
                    : 'Memperbarui hanya baris Opex ini di Supabase (berdasarkan ID asli).'}
                </p>
              </div>
              <button
                type="button"
                disabled={opexFormModal.isSaving}
                onClick={() => setOpexFormModal(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded cursor-pointer disabled:opacity-50"
                aria-label="Tutup form Opex"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs sm:text-sm text-slate-700 max-h-[75vh] overflow-y-auto">
              {opexFormModal.error && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-800"
                >
                  {opexFormModal.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Nama Biaya <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  disabled={opexFormModal.isSaving}
                  value={opexFormModal.name}
                  onChange={(e) =>
                    setOpexFormModal((prev) =>
                      prev ? { ...prev, name: e.target.value, error: null } : null
                    )
                  }
                  placeholder="Contoh: Internet, Gaji Karyawan, Listrik IDPEL"
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Kategori
                  </label>
                  <select
                    disabled={opexFormModal.isSaving}
                    value={opexFormModal.category}
                    onChange={(e) =>
                      setOpexFormModal((prev) =>
                        prev ? { ...prev, category: e.target.value as OpexCategory } : null
                      )
                    }
                    className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                  >
                    {OPEX_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Nominal (Rp) <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      Rp
                    </span>
                    <RupiahInput
                      disabled={opexFormModal.isSaving}
                      value={opexFormModal.amount}
                      onValueChange={(val) =>
                        setOpexFormModal((prev) =>
                          prev ? { ...prev, amount: val, error: null } : null
                        )
                      }
                      placeholder="0"
                      className="w-full pl-9 pr-3 py-2 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Periode Opex <span className="text-red-600">*</span>
                  </label>
                  <select
                    disabled={opexFormModal.isSaving}
                    value={opexFormModal.monthKey}
                    onChange={(e) =>
                      setOpexFormModal((prev) =>
                        prev ? { ...prev, monthKey: e.target.value } : null
                      )
                    }
                    className="w-full px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                  >
                    {opexFormMonthOptions.map((opt) => (
                      <option key={opt.monthKey} value={opt.monthKey}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Rekening Sumber
                  </label>
                  <select
                    disabled={opexFormModal.isSaving}
                    value={opexFormModal.sourceAccountId}
                    onChange={(e) =>
                      setOpexFormModal((prev) =>
                        prev ? { ...prev, sourceAccountId: e.target.value } : null
                      )
                    }
                    className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                  >
                    <option value="">Otomatis (Rekening Utama)</option>
                    {activeMonthData.accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Jatuh Tempo (Tgl 1–31)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    disabled={opexFormModal.isSaving}
                    value={opexFormModal.dueDay}
                    onChange={(e) =>
                      setOpexFormModal((prev) =>
                        prev ? { ...prev, dueDay: e.target.value } : null
                      )
                    }
                    placeholder="25"
                    className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Berulang Setiap Bulan?
                  </label>
                  <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg cursor-pointer text-xs font-medium text-slate-800">
                    <input
                      type="checkbox"
                      disabled={opexFormModal.isSaving}
                      checked={opexFormModal.isRecurring}
                      onChange={(e) =>
                        setOpexFormModal((prev) =>
                          prev ? { ...prev, isRecurring: e.target.checked } : null
                        )
                      }
                      className="rounded border-slate-400 text-slate-900 focus:ring-slate-900"
                    />
                    <span>Ya, Recurring tiap bulan</span>
                  </label>
                </div>
              </div>

              {opexFormModal.isRecurring && (
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Sampai Bulan (Opsional)
                  </label>
                  <select
                    disabled={opexFormModal.isSaving}
                    value={opexFormModal.endMonthKey}
                    onChange={(e) =>
                      setOpexFormModal((prev) =>
                        prev ? { ...prev, endMonthKey: e.target.value } : null
                      )
                    }
                    className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                  >
                    <option value="">Terus menerus (tanpa batas akhir)</option>
                    {opexFormMonthOptions
                      .filter((opt) => opt.monthKey >= opexFormModal.monthKey)
                      .map((opt) => (
                        <option key={opt.monthKey} value={opt.monthKey}>
                          {opt.label}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Catatan (Opsional)
                </label>
                <input
                  type="text"
                  disabled={opexFormModal.isSaving}
                  value={opexFormModal.notes}
                  onChange={(e) =>
                    setOpexFormModal((prev) =>
                      prev ? { ...prev, notes: e.target.value } : null
                    )
                  }
                  placeholder="Keterangan tambahan / IDPEL / No rekening"
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={opexFormModal.isSaving}
                onClick={() => setOpexFormModal(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={opexFormModal.isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {opexFormModal.isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {opexFormModal.isSaving
                  ? 'Menyimpan...'
                  : opexFormModal.mode === 'create'
                  ? 'Simpan Biaya Opex'
                  : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 6: Pilih Periode yang Akan Dihapus dari Baris Gabungan */}
      {groupedDeleteModal && (() => {
        const { group, isDeleting, deletingRowKey, error } = groupedDeleteModal;
        const deletableItems = group.items.filter(
          (item) =>
            !item.isRescheduledIn &&
            ((item.sourceCategory === 'opex' && item.isAuto) ||
              (!item.isAuto && Boolean(item.sourceId)))
        );
        const hasRecurringOpex = deletableItems.some((item) => {
          const opexId = resolveRealOpexIdFromRow(item);
          return Boolean(opexId && groupingLookups.opexById.get(opexId)?.isRecurring);
        });

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="grouped-delete-dialog-title"
            className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 bg-red-50/70 border-b border-red-200 flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="grouped-delete-dialog-title"
                    className="text-sm font-bold text-red-950"
                  >
                    Hapus periode mana?
                  </h3>
                  <p className="text-[11px] text-red-800 mt-0.5">
                    {group.displayName} · penghapusan selalu menggunakan ID asli baris di database.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setGroupedDeleteModal(null)}
                  className="p-1 text-red-500 hover:text-red-900 rounded cursor-pointer disabled:opacity-50"
                  aria-label="Tutup dialog hapus"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3 text-xs text-slate-700">
                {error && (
                  <div
                    role="alert"
                    className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-800"
                  >
                    {error}
                  </div>
                )}

                {hasRecurringOpex && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
                    Baris Opex bertipe <strong>Recurring</strong> berbagi 1 ID aturan di Supabase. Menghapus salah satu akan menghapus aturan recurring terkait (untuk menghentikan di bulan tertentu, gunakan tombol <strong>Edit</strong> pada sub-baris dan atur <em>Sampai Bulan</em>).
                  </div>
                )}

                <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                  {deletableItems.map((item) => {
                    const mk = item.sourceMonthKey ?? item.originMonthKey;
                    const monthLabel = formatBossMonthShortLabel(mk);
                    const isBusy = deletingRowKey === item.rowKey;
                    return (
                      <button
                        key={item.rowKey}
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void handleDeleteGroupedPeriodItem(item)}
                        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white hover:bg-red-50 border border-slate-300 hover:border-red-300 rounded-lg text-left transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            Hapus {monthLabel}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {formatSignedCurrency(item.amount)}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded">
                          {isBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                          {isBusy ? 'Menghapus...' : monthLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setGroupedDeleteModal(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isDeleting || deletableItems.length === 0}
                  onClick={() => void handleDeleteGroupedAllPeriods()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {deletingRowKey === '__ALL__' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  {deletingRowKey === '__ALL__' ? 'Menghapus Semua...' : 'Semua Periode'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal 7: Tambah / Edit Item Manual Sekali Pakai (B. INVESTMENT & C. PROJECT COST) */}
      {projectionManualModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="projection-manual-form-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSubmitProjectionManualModal}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <h3
                  id="projection-manual-form-title"
                  className="text-sm font-bold text-slate-900"
                >
                  {projectionManualModal.mode === 'create'
                    ? projectionManualModal.section === 'INVESTMENT'
                      ? 'Tambah Item Investment - Projection (Sekali Pakai)'
                      : 'Tambah Item Project Cost - Projection (Sekali Pakai)'
                    : projectionManualModal.section === 'INVESTMENT'
                    ? 'Edit Item Investment - Projection (Sekali Pakai)'
                    : 'Edit Item Project Cost - Projection (Sekali Pakai)'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Manual - Sekali Pakai · Non Rutin (disimpan terpisah di projection_manual_items)
                </p>
              </div>
              <button
                type="button"
                disabled={projectionManualModal.isSaving}
                onClick={() => setProjectionManualModal(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded cursor-pointer disabled:opacity-50"
                aria-label="Tutup form item manual"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs sm:text-sm text-slate-700 max-h-[75vh] overflow-y-auto">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 text-xs text-amber-900 leading-relaxed">
                {projectionManualModal.section === 'INVESTMENT'
                  ? 'Item ini hanya untuk Projection bulan ini, tidak akan masuk ke data Investment & tidak akan muncul bulan depan kecuali ditambahkan lagi.'
                  : 'Hanya untuk Projection, tidak akan masuk ke data Project / Vendor / PO.'}
              </div>

              {projectionManualModal.error && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-800"
                >
                  {projectionManualModal.error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Nama Item <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  disabled={projectionManualModal.isSaving}
                  value={projectionManualModal.namaItem}
                  onChange={(e) =>
                    setProjectionManualModal((prev) =>
                      prev ? { ...prev, namaItem: e.target.value, error: null } : null
                    )
                  }
                  placeholder={
                    projectionManualModal.section === 'INVESTMENT'
                      ? 'Contoh: Biaya Tak Terduga Investment'
                      : 'Contoh: Biaya Tambahan Project / Kebutuhan Tak Terduga'
                  }
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Nominal (Rp) <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      Rp
                    </span>
                    <RupiahInput
                      disabled={projectionManualModal.isSaving}
                      value={projectionManualModal.nominal}
                      onValueChange={(val) =>
                        setProjectionManualModal((prev) =>
                          prev ? { ...prev, nominal: val, error: null } : null
                        )
                      }
                      placeholder="0"
                      className="w-full pl-9 pr-3 py-2 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Periode <span className="text-red-600">*</span>
                  </label>
                  <select
                    disabled={projectionManualModal.isSaving}
                    value={projectionManualModal.periode}
                    onChange={(e) =>
                      setProjectionManualModal((prev) =>
                        prev ? { ...prev, periode: e.target.value } : null
                      )
                    }
                    className="w-full px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                  >
                    {opexFormMonthOptions.map((opt) => (
                      <option key={opt.monthKey} value={opt.monthKey}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {projectionManualModal.section === 'PROJECT_COST' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 mb-1">
                      Pilih Project (Opsional)
                    </label>
                    <select
                      disabled={projectionManualModal.isSaving}
                      value={projectionManualModal.projectId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        const found = projectOptions.find((p) => p.id === nextId);
                        setProjectionManualModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                projectId: nextId,
                                projectName: found?.projectName ?? '',
                              }
                            : null
                        );
                      }}
                      className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                    >
                      <option value="">-- Tanpa Project / Umum --</option>
                      {projectOptions.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Hanya untuk pengelompokan label di Projection, bukan menambah PO ke Project.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-800 mb-1">
                      Vendor (Opsional)
                    </label>
                    <input
                      type="text"
                      disabled={projectionManualModal.isSaving}
                      value={projectionManualModal.vendor}
                      onChange={(e) =>
                        setProjectionManualModal((prev) =>
                          prev ? { ...prev, vendor: e.target.value } : null
                        )
                      }
                      placeholder="Nama vendor (catatan Projection saja)"
                      className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Status Warna
                </label>
                <select
                  disabled={projectionManualModal.isSaving}
                  value={projectionManualModal.statusWarna}
                  onChange={(e) =>
                    setProjectionManualModal((prev) =>
                      prev
                        ? { ...prev, statusWarna: e.target.value as StatusWarna }
                        : null
                    )
                  }
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                >
                  <option value="PUTIH">Putih — Projection (Rencana)</option>
                  <option value="HIJAU">Hijau — Paid</option>
                  <option value="MERAH">Merah — Pending (Rp 0 bulan ini)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Keterangan (Opsional)
                </label>
                <input
                  type="text"
                  disabled={projectionManualModal.isSaving}
                  value={projectionManualModal.keterangan}
                  onChange={(e) =>
                    setProjectionManualModal((prev) =>
                      prev ? { ...prev, keterangan: e.target.value } : null
                    )
                  }
                  placeholder="Biaya tak terduga, tidak rutin"
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-60"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={projectionManualModal.isSaving}
                onClick={() => setProjectionManualModal(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={projectionManualModal.isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {projectionManualModal.isSaving && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                {projectionManualModal.isSaving
                  ? 'Menyimpan...'
                  : projectionManualModal.mode === 'create'
                  ? 'Simpan ke Projection'
                  : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 8: Konfirmasi Hapus Item Manual dari Projection */}
      {projectionManualDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="projection-manual-delete-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-red-50/70 border-b border-red-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Trash2 className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3
                    id="projection-manual-delete-title"
                    className="text-sm font-bold text-red-950"
                  >
                    Hapus item manual ini dari Projection?
                  </h3>
                  <p className="text-[11px] text-red-800 mt-0.5">
                    Periode {formatBossMonthFullLabel(projectionManualDeleteModal.item.periode)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={projectionManualDeleteModal.isDeleting}
                onClick={() => setProjectionManualDeleteModal(null)}
                className="p-1 text-red-500 hover:text-red-900 rounded cursor-pointer disabled:opacity-50"
                aria-label="Tutup dialog hapus"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs sm:text-sm text-slate-700">
              {projectionManualDeleteModal.error && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-800"
                >
                  {projectionManualDeleteModal.error}
                </div>
              )}
              <p>
                Anda akan menghapus item manual{' '}
                <strong className="text-slate-900">
                  {projectionManualDeleteModal.item.namaItem}
                </strong>{' '}
                senilai{' '}
                <strong className="font-mono text-slate-900">
                  {formatSignedCurrency(projectionManualDeleteModal.item.nominal)}
                </strong>{' '}
                dari Projection bulan{' '}
                <strong>
                  {formatBossMonthFullLabel(projectionManualDeleteModal.item.periode)}
                </strong>
                .
              </p>
              <p className="text-xs text-slate-500">
                Data master Investment / Project / Vendor tidak akan berubah.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={projectionManualDeleteModal.isDeleting}
                onClick={() => setProjectionManualDeleteModal(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={projectionManualDeleteModal.isDeleting}
                onClick={() => void handleConfirmDeleteProjectionManual()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {projectionManualDeleteModal.isDeleting && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                {projectionManualDeleteModal.isDeleting
                  ? 'Menghapus...'
                  : 'Ya, Hapus dari Projection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-[60] max-w-sm shadow-xl rounded-xl border px-4 py-3 flex items-start gap-2.5 text-xs ${
            toast.type === 'success'
              ? 'bg-emerald-950 text-white border-emerald-700'
              : 'bg-red-900 text-white border-red-700'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
          )}
          <span className="flex-1 leading-relaxed">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-white/70 hover:text-white cursor-pointer shrink-0"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
