import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Copy,
  ExternalLink,
  Eye,
  FilePlus2,
  FileText,
  History,
  Paperclip,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { AuditActor, PermissionsMap } from '../types/auth';
import {
  BossReportColorStatus,
  BossReportMonthData,
  BossReportRescheduledItem,
} from '../types/bossReport';
import {
  PaymentTermsMode,
  PO_STATUS_META,
  POStatus,
  PurchaseOrder,
  VendorPphStatus,
  VendorPphType,
} from '../types/po';
import { formatMonthShortID, normalizeStatusToColor } from '../types/statusWarna';
import { formatBossMonthFullLabel } from '../utils/bossReportCalc';
import {
  computeDueTunggakanStatus,
  formatIDR,
  formatPaymentTermsLabel,
  formatShortDateID,
  getEffectiveDueDate,
  getTodayISODate,
  getVendorPOEffectiveCostAmount,
  hasVendorInvoice,
  isDueWithinWeek,
  isEffectiveOverdue,
  isVendorPODitagih,
  isVendorPOLunas,
  resolveVendorPOTaxDetails,
} from '../utils/format';
import {
  CancelVendorInvoiceModal,
  CancelVendorPOTargetStatus,
} from './CancelVendorInvoiceModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { DueCountdownCell } from './DueCountdownCell';
import { InvoiceSubmissionPayload, MarkInvoicedModal } from './MarkInvoicedModal';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { ReviseDocumentModal, ReviseSubmitPayload } from './ReviseDocumentModal';
import { StatusBadge } from './StatusBadge';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';
import { SubmitPphModal } from './SubmitPphModal';

interface POListViewProps {
  orders: PurchaseOrder[];
  bossReportMonths?: Record<string, BossReportMonthData>;
  isLoading: boolean;
  permissions: PermissionsMap;
  currentActor: AuditActor;
  onCreateNew: () => void;
  onPreview: (po: PurchaseOrder) => void;
  onPrint: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onDuplicate: (po: PurchaseOrder) => void;
  onStatusChange: (
    poId: string,
    status: POStatus,
    invoiceMeta?: {
      invoiceDate?: string;
      invoiceNumber?: string;
      invoiceFileUrl?: string;
      invoiceFileName?: string;
      localAttachmentDataUrl?: string;
      paymentTermsMode?: PaymentTermsMode;
      paymentTermsDays?: number;
      manualDueDateNote?: string;
      dueDate?: string;
      dppAmount?: number;
      ppnRate?: number;
      ppnAmount?: number;
      grossAmount?: number;
      pphType?: VendorPphType;
      pphRate?: number;
      pphAmount?: number;
      pphStatus?: VendorPphStatus;
      pphDate?: string;
      netAkhir?: number;
    }
  ) => Promise<void>;
  onSubmitPph?: (
    poId: string,
    params: { pphType: VendorPphType; pphRate: number; pphDate: string }
  ) => Promise<void>;
  onCancelInvoice?: (
    poId: string,
    params: { targetStatus: 'Draft' | 'Sent'; reason: string }
  ) => Promise<void>;
  onCancelPaid?: (
    poId: string,
    params: { targetStatus: CancelVendorPOTargetStatus; reason: string }
  ) => Promise<void>;
  onChangeStatusWarna?: (
    poId: string,
    color: 'white' | 'green' | 'red',
    targetMonthKey?: string,
    originMonthKey?: string
  ) => Promise<void>;
  onRescheduledCopyAction?: (
    monthKey: string,
    rescheduledItemId: string,
    nextColor: BossReportColorStatus,
    targetMonthKey?: string
  ) => Promise<void>;
  onDelete: (poId: string, reason?: string) => Promise<void>;
  onRestore?: (poId: string) => Promise<void>;
  onPermanentDelete?: (poId: string) => Promise<void>;
  onRevisePO: (po: PurchaseOrder, payload: ReviseSubmitPayload) => Promise<void>;
}

type StatusFilterOption = 'All' | POStatus | 'Overdue';
type DueFilterOption = 'All' | 'DueThisWeek' | 'Overdue';
type DateFieldOption = 'poDate' | 'invoiceDate';

const STATUS_FILTER_OPTIONS: Array<{ id: StatusFilterOption; label: string }> = [
  { id: 'All', label: 'Semua' },
  { id: 'Draft', label: 'DRAFT' },
  { id: 'Sent', label: 'SENT' },
  { id: 'Invoiced', label: 'INVOICED' },
  { id: 'Overdue', label: 'OVERDUE' },
  { id: 'Reschedule', label: 'PENDING' },
  { id: 'Paid', label: 'PAID' },
];

const DUE_FILTER_OPTIONS: Array<{ id: DueFilterOption; label: string }> = [
  { id: 'All', label: 'Semua' },
  { id: 'DueThisWeek', label: 'Jatuh Tempo Minggu Ini' },
  { id: 'Overdue', label: 'Overdue' },
];

export const POListView: React.FC<POListViewProps> = ({
  orders,
  bossReportMonths = {},
  isLoading,
  permissions,
  currentActor,
  onCreateNew,
  onPreview,
  onPrint,
  onEdit,
  onDuplicate,
  onStatusChange,
  onSubmitPph,
  onCancelInvoice,
  onCancelPaid,
  onChangeStatusWarna,
  onRescheduledCopyAction,
  onDelete,
  onRestore,
  onPermanentDelete,
  onRevisePO,
}) => {
  const [listViewTab, setListViewTab] = useState<'active' | 'trash'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('All');
  const [dueFilter, setDueFilter] = useState<DueFilterOption>('All');
  const [dateField, setDateField] = useState<DateFieldOption>('poDate');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [confirmDeletePO, setConfirmDeletePO] = useState<PurchaseOrder | null>(null);
  const [confirmPermanentDeletePO, setConfirmPermanentDeletePO] = useState<PurchaseOrder | null>(
    null
  );
  const [markingInvoicedPO, setMarkingInvoicedPO] = useState<PurchaseOrder | null>(null);
  const [submittingPphPO, setSubmittingPphPO] = useState<PurchaseOrder | null>(null);
  const [cancellingPOState, setCancellingPOState] = useState<{
    po: PurchaseOrder;
    mode: 'tagihan' | 'lunas';
  } | null>(null);
  const [reschedulePO, setReschedulePO] = useState<PurchaseOrder | null>(null);
  const [rescheduleCopyTarget, setRescheduleCopyTarget] = useState<{
    monthKey: string;
    item: BossReportRescheduledItem;
  } | null>(null);
  const [revisingPO, setRevisingPO] = useState<PurchaseOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeOrders = useMemo(() => orders.filter((po) => !po.isDeleted), [orders]);
  const deletedOrders = useMemo(() => orders.filter((po) => po.isDeleted), [orders]);

  const hasActiveFilter =
    searchQuery.trim() !== '' ||
    statusFilter !== 'All' ||
    dueFilter !== 'All' ||
    dateFrom !== '' ||
    dateTo !== '';

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('All');
    setDueFilter('All');
    setDateFrom('');
    setDateTo('');
  };

  const filteredAndSortedOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = activeOrders.filter((po) => {
      if (statusFilter === 'Overdue') {
        if (!isEffectiveOverdue(po)) return false;
      } else if (statusFilter !== 'All') {
        if (po.status !== statusFilter) return false;
      }

      if (dueFilter === 'DueThisWeek' && !isDueWithinWeek(po)) return false;
      if (dueFilter === 'Overdue' && !isEffectiveOverdue(po)) return false;

      if (dateFrom || dateTo) {
        const targetDate = dateField === 'invoiceDate' ? po.invoiceDate || '' : po.poDate || '';
        if (!targetDate) return false;
        if (dateFrom && targetDate < dateFrom) return false;
        if (dateTo && targetDate > dateTo) return false;
      }

      if (!q) return true;
      return (
        po.poNumber.toLowerCase().includes(q) ||
        po.vendorName.toLowerCase().includes(q) ||
        po.projectName.toLowerCase().includes(q) ||
        po.projectNumber.toLowerCase().includes(q) ||
        (po.invoiceNumber ?? '').toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      const cmp = (a.poDate || '').localeCompare(b.poDate || '');
      if (cmp !== 0) {
        return sortOrder === 'desc' ? -cmp : cmp;
      }
      return sortOrder === 'desc'
        ? b.poNumber.localeCompare(a.poNumber)
        : a.poNumber.localeCompare(b.poNumber);
    });
  }, [activeOrders, searchQuery, statusFilter, dueFilter, dateField, dateFrom, dateTo, sortOrder]);

  const filteredRescheduledCopies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const seen = new Set<string>();
    const results: Array<{ monthKey: string; item: BossReportRescheduledItem }> = [];
    for (const [mk, mData] of Object.entries(bossReportMonths)) {
      for (const item of mData.rescheduledIn ?? []) {
        if (item.section !== 'projectCost' || item.sourceCategory !== 'vendorPO') continue;
        const dedupKey = `${mk}:${item.id}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        if (statusFilter === 'Reschedule' && item.color !== 'red') continue;
        if (statusFilter === 'Paid' && item.color !== 'green') continue;
        if (
          (statusFilter === 'Invoiced' ||
            statusFilter === 'Not Paid' ||
            statusFilter === 'Sent' ||
            statusFilter === 'Draft' ||
            statusFilter === 'Overdue') &&
          item.color !== 'white'
        ) {
          continue;
        }
        if (dueFilter !== 'All') continue;
        if (q && !item.name.toLowerCase().includes(q)) continue;
        results.push({ monthKey: mk, item });
      }
    }
    return results.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [bossReportMonths, searchQuery, statusFilter, dueFilter]);

  const filteredTotals = useMemo(() => {
    let totalFiltered = 0;
    let totalUnbilled = 0;
    let totalBilledUnpaid = 0;
    let totalPaid = 0;

    let countUnbilled = 0;
    let countBilledUnpaid = 0;
    let countPaid = 0;

    for (const po of filteredAndSortedOrders) {
      if (po.status === 'Reschedule') {
        continue;
      }
      const amt = getVendorPOEffectiveCostAmount(po);
      totalFiltered += amt;

      if (po.status === 'Draft' || po.status === 'Sent' || (po.status === 'Not Paid' && !hasVendorInvoice(po))) {
        totalUnbilled += amt;
        countUnbilled += 1;
      } else if (isVendorPOLunas(po)) {
        totalPaid += amt;
        countPaid += 1;
      } else {
        totalBilledUnpaid += amt;
        countBilledUnpaid += 1;
      }
    }

    for (const { item } of filteredRescheduledCopies) {
      if (item.color === 'red') continue;
      const amt = Number(item.amount) || 0;
      totalFiltered += amt;
      if (item.color === 'green') {
        totalPaid += amt;
        countPaid += 1;
      } else {
        totalBilledUnpaid += amt;
        countBilledUnpaid += 1;
      }
    }

    return {
      totalCount:
        filteredAndSortedOrders.length +
        filteredRescheduledCopies.filter((c) => c.item.color !== 'red').length,
      totalFiltered,
      totalUnbilled,
      countUnbilled,
      totalBilledUnpaid,
      countBilledUnpaid,
      totalPaid,
      countPaid,
    };
  }, [filteredAndSortedOrders, filteredRescheduledCopies]);

  const handleConfirmDelete = async (reason?: string) => {
    if (!confirmDeletePO) return;
    setBusyId(confirmDeletePO.id);
    try {
      await onDelete(confirmDeletePO.id, reason);
      setConfirmDeletePO(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!confirmPermanentDeletePO || !onPermanentDelete) return;
    setBusyId(confirmPermanentDeletePO.id);
    try {
      await onPermanentDelete(confirmPermanentDeletePO.id);
      setConfirmPermanentDeletePO(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmMarkInvoiced = async (payload: InvoiceSubmissionPayload) => {
    if (!markingInvoicedPO) return;
    setBusyId(markingInvoicedPO.id);
    try {
      await onStatusChange(markingInvoicedPO.id, 'Invoiced', payload);
      setMarkingInvoicedPO(null);
    } finally {
      setBusyId(null);
    }
  };

  const getPOOriginMonth = (po: PurchaseOrder): string => {
    const raw = getEffectiveDueDate(po) || po.invoiceDate || po.poDate || getTodayISODate();
    return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : getTodayISODate().slice(0, 7);
  };

  const handleSelectPOStatusWarna = async (po: PurchaseOrder, nextColor: 'green' | 'red') => {
    if (nextColor === 'red') {
      setReschedulePO(po);
      return;
    }
    setBusyId(po.id);
    try {
      if (onChangeStatusWarna) {
        await onChangeStatusWarna(po.id, 'green', undefined, getPOOriginMonth(po));
      } else {
        await onStatusChange(po.id, 'Paid');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmPOReschedule = async (targetMonthKey: string) => {
    if (rescheduleCopyTarget && onRescheduledCopyAction) {
      const { monthKey, item } = rescheduleCopyTarget;
      const copyBusyKey = `copy:${monthKey}:${item.id}`;
      setBusyId(copyBusyKey);
      try {
        await onRescheduledCopyAction(monthKey, item.id, 'red', targetMonthKey);
        setRescheduleCopyTarget(null);
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (!reschedulePO || !onChangeStatusWarna) return;
    setBusyId(reschedulePO.id);
    try {
      await onChangeStatusWarna(
        reschedulePO.id,
        'red',
        targetMonthKey,
        getPOOriginMonth(reschedulePO)
      );
      setReschedulePO(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelPOPending = async (po: PurchaseOrder) => {
    if (!onChangeStatusWarna) return;
    setBusyId(po.id);
    try {
      await onChangeStatusWarna(po.id, 'white', undefined, getPOOriginMonth(po));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation: Daftar PO Aktif vs Riwayat Hapus */}
      {(deletedOrders.length > 0 ||
        permissions.soft_delete_po ||
        permissions.permanent_delete_po) && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setListViewTab('active')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              listViewTab === 'active'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Daftar PO Aktif ({activeOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setListViewTab('trash')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              listViewTab === 'trash'
                ? 'bg-red-700 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Riwayat Hapus ({deletedOrders.length})
          </button>
        </div>
      )}

      {listViewTab === 'trash' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {deletedOrders.length === 0 ? (
            <div className="py-14 px-6 text-center text-xs text-slate-500">
              Belum ada Purchase Order di Riwayat Hapus.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap">No. PO</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Vendor &amp; Project</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Total Amount</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Dihapus Oleh</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Waktu Hapus</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Alasan</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {deletedOrders.map((po) => {
                    const isBusy = busyId === po.id;
                    return (
                      <tr key={po.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {po.poNumber}
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-medium text-slate-900">{po.vendorName}</div>
                          <div className="text-[11px] text-slate-500">{po.projectName}</div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                          Rp {formatIDR(getVendorPOEffectiveCostAmount(po))}
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-semibold text-slate-900">
                            {po.deletedByName || '-'}
                          </div>
                          {po.deletedByEmail && (
                            <div className="text-[11px] text-slate-500 font-mono">
                              {po.deletedByEmail}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-600 whitespace-nowrap">
                          {po.deletedAt || '-'}
                        </td>
                        <td className="py-3 px-3.5 text-slate-600 max-w-[220px]">
                          {po.deleteReason || '-'}
                        </td>
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {permissions.soft_delete_po && onRestore && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={async () => {
                                  setBusyId(po.id);
                                  try {
                                    await onRestore(po.id);
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Pulihkan
                              </button>
                            )}
                            {permissions.permanent_delete_po && onPermanentDelete && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmPermanentDeletePO(po)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Hapus Permanen
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
      {/* Dynamic Summary Cards reflecting active filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Total Nilai PO yang Difilter
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5 truncate">
            Rp {formatIDR(filteredTotals.totalFiltered)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {filteredTotals.totalCount} PO ditampilkan
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Total BELUM DITAGIH
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5 truncate">
            Rp {formatIDR(filteredTotals.totalUnbilled)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {filteredTotals.countUnbilled} PO (Draft + Sent)
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Total SUDAH DITAGIH BELUM LUNAS
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5 truncate">
            Rp {formatIDR(filteredTotals.totalBilledUnpaid)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {filteredTotals.countBilledUnpaid} PO (Invoiced / Overdue)
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Total SUDAH LUNAS
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5 truncate">
            Rp {formatIDR(filteredTotals.totalPaid)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {filteredTotals.countPaid} PO (Paid / Lunas)
          </p>
        </div>
      </div>

      {/* Search, Status, Due Date & Date Range Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari Vendor, No. PO, No. Invoice, atau Project..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Tanggal PO: {sortOrder === 'desc' ? 'Terbaru' : 'Terlama'}
            </button>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Filter
              </button>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 xl:grid-cols-12 gap-3 items-end">
          {/* Status Filter */}
          <div className="xl:col-span-5">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              Filter Status
            </span>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {STATUS_FILTER_OPTIONS.map((tab) => {
                const active = statusFilter === tab.id;
                const label =
                  tab.id === 'Draft' ||
                  tab.id === 'Sent' ||
                  tab.id === 'Invoiced' ||
                  tab.id === 'Paid'
                    ? tab.id === 'Sent'
                      ? 'SENT'
                      : tab.id === 'Paid'
                      ? 'PAID'
                      : PO_STATUS_META[tab.id].label === 'SUDAH DITAGIH'
                      ? 'INVOICED'
                      : PO_STATUS_META[tab.id].label
                    : tab.label;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Due Date Filter */}
          <div className="xl:col-span-3">
            <label
              htmlFor="filter-due-select"
              className="block text-[11px] font-semibold text-slate-500 mb-1.5"
            >
              Filter Jatuh Tempo
            </label>
            <select
              id="filter-due-select"
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value as DueFilterOption)}
              className="w-full px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {DUE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div className="xl:col-span-4">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              Filter Tanggal ({dateField === 'poDate' ? 'Tanggal PO' : 'Tanggal Invoice'})
            </span>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
              <select
                aria-label="Basis tanggal filter"
                value={dateField}
                onChange={(e) => setDateField(e.target.value as DateFieldOption)}
                className="px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="poDate">Tgl PO</option>
                <option value="invoiceDate">Tgl Inv</option>
              </select>
              <input
                type="date"
                aria-label="Dari Tanggal"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full min-w-0 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <span className="text-xs text-slate-400 shrink-0">-</span>
              <input
                type="date"
                aria-label="Sampai Tanggal"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full min-w-0 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>
        </div>
      </div>

      {/* PO Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="h-11 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredAndSortedOrders.length === 0 && filteredRescheduledCopies.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              {activeOrders.length === 0
                ? 'Belum ada Purchase Order'
                : 'Tidak ada Purchase Order yang cocok'}
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              {activeOrders.length === 0
                ? 'Buat Purchase Order pertama Anda untuk PT. Kreatif Kebanggaan Bangsa.'
                : 'Ubah kata kunci pencarian, rentang tanggal, atau filter status lainnya.'}
            </p>
            {activeOrders.length === 0 ? (
              permissions.create_po && (
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  <FilePlus2 className="w-4 h-4" />
                  Buat PO Baru
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Semua Filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-3.5 whitespace-nowrap">No. PO</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Tanggal PO</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Vendor</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Project Name</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Payment Terms</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Tanggal Invoice</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Jatuh Tempo</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Sisa Hari</th>
                  <th className="py-3 px-3.5 text-right whitespace-nowrap">Total Amount</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Status Warna</th>
                  <th className="py-3 px-3.5 text-right whitespace-nowrap">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredAndSortedOrders.map((po) => {
                  const isPaid = po.status === 'Paid';
                  const isPending = po.status === 'Reschedule';
                  const canInputInvoice = po.status === 'Draft' || po.status === 'Sent';
                  const isBusy = busyId === po.id;
                  const invoiced = hasVendorInvoice(po);
                  const overdue = !isPending && isEffectiveOverdue(po);
                  const effectiveDueDate = getEffectiveDueDate(po);
                  const tax = resolveVendorPOTaxDetails(po);

                  return (
                    <tr
                      key={po.id}
                      className={`transition-colors ${
                        isPending
                          ? 'bg-slate-100/80 text-slate-400 opacity-80'
                          : overdue
                          ? 'bg-red-50/80 hover:bg-red-100/70'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 px-3.5 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onPreview(po)}
                          className="hover:underline text-left cursor-pointer"
                        >
                          {po.poNumber}
                        </button>
                      </td>
                      <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {formatShortDateID(po.poDate)}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-900 max-w-[160px] truncate">
                          {po.vendorName}
                        </div>
                        <div className="text-xs text-slate-500 max-w-[160px] truncate">
                          {po.vendorAddress}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-900 max-w-[180px] truncate">
                          {po.projectName}
                        </div>
                        <div className="text-xs font-mono text-slate-500">
                          {po.projectNumber}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                        {invoiced
                          ? formatPaymentTermsLabel(po.paymentTermsDays, po.paymentTermsMode)
                          : '-'}
                      </td>
                      <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {invoiced && po.invoiceDate ? (
                          <div>
                            <div>{formatShortDateID(po.invoiceDate)}</div>
                            {(po.invoiceNumber || po.invoiceFileUrl || po.invoiceFileName) && (
                              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                                {po.invoiceNumber && (
                                  <span className="font-mono">{po.invoiceNumber}</span>
                                )}
                                {po.invoiceFileUrl && (
                                  <a
                                    href={po.invoiceFileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Buka link file invoice"
                                    className="inline-flex items-center gap-0.5 text-blue-700 hover:underline"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                                {!po.invoiceFileUrl && po.invoiceFileName && (
                                  <span
                                    title={po.invoiceFileName}
                                    className="inline-flex items-center gap-0.5 text-slate-500"
                                  >
                                    <Paperclip className="w-3 h-3" />
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-xs font-medium text-slate-800 whitespace-nowrap tabular-nums">
                        {invoiced && effectiveDueDate ? (
                          <div>
                            <div>{formatShortDateID(effectiveDueDate)}</div>
                            {po.paymentTermsMode === 'MANUAL' && po.manualDueDateNote && (
                              <div className="text-[11px] font-normal text-slate-500 whitespace-normal max-w-[170px] mt-0.5">
                                ({po.manualDueDateNote})
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <DueCountdownCell po={po} />
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono text-xs font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                        {isPending ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="line-through text-slate-400 font-normal">
                              Rp {formatIDR(tax.effectiveAmount)}
                            </span>
                            <span className="text-slate-600">Rp 0</span>
                            <span className="text-[10px] font-sans font-normal text-slate-500">
                              Tidak dihitung di bulan ini
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-end gap-0.5">
                            <span>Rp {formatIDR(tax.effectiveAmount)}</span>
                            {tax.isBilled && (
                              <>
                                {tax.isTaxIncomplete ? (
                                  <span className="font-sans text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded whitespace-normal max-w-[200px] text-right">
                                    Data pajak belum lengkap, mohon edit &amp; simpan ulang
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-normal text-slate-500">
                                    DPP {formatIDR(tax.dppAmount)} · PPN {formatIDR(tax.ppnAmount)} · PPh{' '}
                                    {formatIDR(tax.pphAmount)}
                                  </span>
                                )}
                                {tax.hasPph && (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold border ${
                                      tax.isPphSubmitted
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        : 'bg-amber-50 text-amber-800 border-amber-300'
                                    }`}
                                  >
                                    {tax.isPphSubmitted
                                      ? `PPh Sudah Disubmit - Rp ${formatIDR(tax.pphAmount)}`
                                      : 'PPh Belum Disubmit'}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          {isPending ? (
                            <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold rounded border bg-slate-200 text-slate-700 border-slate-300">
                              {po.rescheduledToMonth
                                ? `DIPENDING KE ${formatBossMonthFullLabel(po.rescheduledToMonth)}`
                                : 'DIPENDING'}
                            </span>
                          ) : (
                            <StatusBadge
                              status={po.status}
                              revisionSubStatus={po.revisionSubStatus}
                            />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusWarnaDropdown
                            value={normalizeStatusToColor(po.status, po.statusWarna)}
                            disabled={isBusy || (!permissions.mark_paid && !permissions.send_invoice)}
                            compact
                            ariaLabel={`Status warna ${po.poNumber}`}
                            onSelect={(nextColor) => void handleSelectPOStatusWarna(po, nextColor)}
                          />
                          {isPending &&
                            onChangeStatusWarna &&
                            (permissions.mark_paid || permissions.send_invoice) && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleCancelPOPending(po)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Batalkan Pending / Kembalikan
                              </button>
                            )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {canInputInvoice && permissions.send_invoice && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setMarkingInvoicedPO(po)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors mr-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              Input Invoice / Sudah Ditagih
                            </button>
                          )}
                          {tax.isBilled &&
                            tax.hasPph &&
                            !tax.isPphSubmitted &&
                            onSubmitPph &&
                            (permissions.send_invoice || permissions.mark_paid) && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setSubmittingPphPO(po)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-100 border border-amber-300 hover:bg-amber-200 rounded-md transition-colors mr-1 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                                Submit PPh
                              </button>
                            )}
                          {(() => {
                            const isLunasRow = isVendorPOLunas(po);
                            const isDitagihRow = isVendorPODitagih(po);
                            const canAdminOrEdit =
                              currentActor.roleId === 'super_admin' ||
                              currentActor.roleId === 'admin' ||
                              permissions.send_invoice ||
                              permissions.revise_invoiced ||
                              permissions.revise_paid ||
                              permissions.mark_paid;
                            if (!canAdminOrEdit) return null;
                            if (isLunasRow && onCancelPaid) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setCancellingPOState({ po, mode: 'lunas' })}
                                  title="Batalkan status Lunas dan kembalikan PO"
                                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Undo2 className="w-3.5 h-3.5" />
                                  Batalkan Lunas
                                </button>
                              );
                            }
                            if (isDitagihRow && onCancelInvoice) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => setCancellingPOState({ po, mode: 'tagihan' })}
                                  title="Batalkan tagihan invoice dan kembalikan status PO ke Draft / Sent"
                                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Undo2 className="w-3.5 h-3.5" />
                                  Batalkan Tagihan
                                </button>
                              );
                            }
                            return null;
                          })()}
                          {((po.status === 'Invoiced' && permissions.revise_invoiced) ||
                            (isPaid && permissions.revise_paid)) && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setRevisingPO(po)}
                              title="Revisi PO & Buat Invoice Pengganti"
                              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <History className="w-3.5 h-3.5" />
                              Revisi
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onPreview(po)}
                            title="Lihat lembar PO"
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Lihat
                          </button>
                          {(permissions.edit_po_draft || permissions.create_po) && (
                            <button
                              type="button"
                              onClick={() => onPrint(po)}
                              title="Print / Simpan PDF PO"
                              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              Print
                            </button>
                          )}
                          {!isPaid &&
                            (po.status === 'Invoiced'
                              ? permissions.send_invoice
                              : permissions.edit_po_draft) && (
                              <button
                                type="button"
                                onClick={() => onEdit(po)}
                                title="Edit PO"
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          {permissions.create_po && (
                            <button
                              type="button"
                              onClick={() => onDuplicate(po)}
                              title="Duplikat PO"
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {permissions.soft_delete_po && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePO(po)}
                              title="Hapus PO (Pindah ke Riwayat Hapus)"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRescheduledCopies.map(({ monthKey: copyMonthKey, item: copy }) => {
                  const isCopyPending = copy.color === 'red';
                  const copyBusyKey = `copy:${copyMonthKey}:${copy.id}`;
                  const isCopyBusy = busyId === copyBusyKey;
                  const canAct = permissions.mark_paid || permissions.send_invoice;
                  const copyDueStatus = computeDueTunggakanStatus({
                    dueISO: copy.dueISO,
                    originMonthKey: copy.originMonthKey,
                    isPaid: copy.color === 'green',
                  });
                  return (
                    <tr
                      key={`po-copy-${copyMonthKey}-${copy.id}`}
                      className={
                        isCopyPending
                          ? 'bg-slate-100/80 text-slate-400 opacity-80'
                          : copy.color === 'green'
                          ? 'bg-emerald-50/40 hover:bg-emerald-50/70'
                          : 'bg-amber-50/40 hover:bg-amber-50/70'
                      }
                    >
                      <td className="py-3 px-3.5 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <div>Salinan Pending</div>
                        {copyDueStatus.isTunggakan ? (
                          <span className="inline-flex mt-0.5 px-1.5 py-0.5 text-[10px] font-sans font-semibold rounded bg-amber-50 text-amber-800 border border-amber-300">
                            {copyDueStatus.statusText}
                          </span>
                        ) : copy.color !== 'green' ? (
                          <span className="inline-flex mt-0.5 px-1.5 py-0.5 text-[10px] font-sans font-semibold rounded bg-slate-100 text-slate-700 border border-slate-300">
                            {copyDueStatus.statusText}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 px-3.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                        {formatBossMonthFullLabel(copyMonthKey)}
                      </td>
                      <td colSpan={4} className="py-3 px-3.5 text-xs font-medium text-slate-900">
                        {copy.name}
                      </td>
                      <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {copy.dueISO ? formatShortDateID(copy.dueISO) : '-'}
                      </td>
                      <td className="py-3 px-3.5 text-xs text-slate-400 whitespace-nowrap">-</td>
                      <td className="py-3 px-3.5 text-right font-mono text-xs font-semibold text-slate-900 whitespace-nowrap tabular-nums">
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
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        {isCopyPending ? (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold rounded border bg-slate-200 text-slate-700 border-slate-300">
                            {copy.rescheduledToMonth
                              ? `DIPENDING KE ${formatBossMonthFullLabel(copy.rescheduledToMonth)}`
                              : 'DIPENDING'}
                          </span>
                        ) : copy.color === 'green' ? (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            PAID
                          </span>
                        ) : copyDueStatus.isTunggakan ? (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold rounded bg-amber-100 text-amber-800 border border-amber-200">
                            {copyDueStatus.lateBadgeText
                              ? `TUNGGAKAN (${copyDueStatus.lateBadgeText})`
                              : 'TUNGGAKAN AKTIF'}
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold rounded bg-slate-100 text-slate-700 border border-slate-300">
                            BELUM JATUH TEMPO
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        {onRescheduledCopyAction && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusWarnaDropdown
                              value={copy.color}
                              disabled={isCopyBusy || !canAct}
                              compact
                              ariaLabel={`Status warna salinan ${copy.name}`}
                              onSelect={async (nextColor) => {
                                if (nextColor === 'red') {
                                  setRescheduleCopyTarget({ monthKey: copyMonthKey, item: copy });
                                  return;
                                }
                                setBusyId(copyBusyKey);
                                try {
                                  await onRescheduledCopyAction(
                                    copyMonthKey,
                                    copy.id,
                                    nextColor
                                  );
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            />
                            {canAct && (
                              <button
                                type="button"
                                disabled={isCopyBusy}
                                onClick={async () => {
                                  setBusyId(copyBusyKey);
                                  try {
                                    await onRescheduledCopyAction(copyMonthKey, copy.id, 'white');
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Batalkan Pending / Kembalikan
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right text-xs text-slate-400 whitespace-nowrap">
                        Salinan {formatMonthShortID(copyMonthKey)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}

      {markingInvoicedPO && (
        <MarkInvoicedModal
          po={markingInvoicedPO}
          existingPOs={activeOrders}
          mode="mark-invoiced"
          isSubmitting={busyId === markingInvoicedPO.id}
          onCancel={() => setMarkingInvoicedPO(null)}
          onConfirm={handleConfirmMarkInvoiced}
        />
      )}

      {revisingPO && (
        <ReviseDocumentModal
          docType="po"
          po={revisingPO}
          currentActor={currentActor}
          isSubmitting={busyId === revisingPO.id}
          onCancel={() => setRevisingPO(null)}
          onConfirm={async (payload) => {
            setBusyId(revisingPO.id);
            try {
              await onRevisePO(revisingPO, payload);
              setRevisingPO(null);
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}

      {confirmDeletePO && (
        <DeleteConfirmModal
          po={confirmDeletePO}
          mode="soft"
          isBusy={busyId === confirmDeletePO.id}
          onCancel={() => setConfirmDeletePO(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {confirmPermanentDeletePO && (
        <DeleteConfirmModal
          po={confirmPermanentDeletePO}
          mode="permanent"
          isBusy={busyId === confirmPermanentDeletePO.id}
          onCancel={() => setConfirmPermanentDeletePO(null)}
          onConfirm={handleConfirmPermanentDelete}
        />
      )}

      {submittingPphPO && onSubmitPph && (
        <SubmitPphModal
          po={submittingPphPO}
          isSubmitting={busyId === submittingPphPO.id}
          onCancel={() => setSubmittingPphPO(null)}
          onConfirm={async (params) => {
            setBusyId(submittingPphPO.id);
            try {
              await onSubmitPph(submittingPphPO.id, params);
              setSubmittingPphPO(null);
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}

      {cancellingPOState && (
        <CancelVendorInvoiceModal
          po={cancellingPOState.po}
          mode={cancellingPOState.mode}
          isSubmitting={busyId === cancellingPOState.po.id}
          onCancel={() => setCancellingPOState(null)}
          onConfirm={async (params) => {
            setBusyId(cancellingPOState.po.id);
            try {
              if (cancellingPOState.mode === 'lunas' && onCancelPaid) {
                await onCancelPaid(cancellingPOState.po.id, params);
              } else if (onCancelInvoice) {
                await onCancelInvoice(cancellingPOState.po.id, {
                  targetStatus: params.targetStatus === 'Sent' ? 'Sent' : 'Draft',
                  reason: params.reason,
                });
              }
              setCancellingPOState(null);
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}

      <RescheduleMonthModal
        isOpen={Boolean(reschedulePO || rescheduleCopyTarget)}
        itemName={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.item.name
            : reschedulePO
            ? `${reschedulePO.poNumber} — ${reschedulePO.vendorName}`
            : ''
        }
        amount={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.item.amount
            : reschedulePO
            ? getVendorPOEffectiveCostAmount(reschedulePO)
            : 0
        }
        originMonthKey={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.monthKey
            : reschedulePO
            ? getPOOriginMonth(reschedulePO)
            : getTodayISODate().slice(0, 7)
        }
        initialTargetMonthKey={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.item.rescheduledToMonth
            : reschedulePO?.rescheduledToMonth
        }
        isSaving={Boolean(
          (rescheduleCopyTarget &&
            busyId === `copy:${rescheduleCopyTarget.monthKey}:${rescheduleCopyTarget.item.id}`) ||
            (reschedulePO && busyId === reschedulePO.id)
        )}
        onCancel={() => {
          setReschedulePO(null);
          setRescheduleCopyTarget(null);
        }}
        onConfirm={handleConfirmPOReschedule}
      />
    </div>
  );
};
