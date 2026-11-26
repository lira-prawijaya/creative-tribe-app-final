import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpDown,
  CheckCircle2,
  Copy,
  Eye,
  FilePlus2,
  History,
  Pencil,
  Printer,
  RotateCcw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { AuditActor, PermissionsMap } from '../types/auth';
import {
  BossReportColorStatus,
  BossReportMonthData,
  BossReportRescheduledItem,
} from '../types/bossReport';
import {
  ClientInvoice,
  ClientInvoiceEffectiveStatus,
} from '../types/clientInvoice';
import { PaymentTermsMode } from '../types/po';
import { formatMonthShortID, normalizeStatusToColor } from '../types/statusWarna';
import { formatBossMonthFullLabel } from '../utils/bossReportCalc';
import {
  getClientInvoiceEffectiveStatus,
  isClientInvoiceOverdue,
  resolveClientInvoiceGrossNominal,
  resolveClientInvoiceNominal,
} from '../utils/clientInvoiceFormat';
import {
  computeDueTunggakanStatus,
  formatIDR,
  formatShortDateID,
  getRemainingDays,
  getTodayISODate,
} from '../utils/format';
import { ClientInvoicePreviewModal } from './ClientInvoicePreviewModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { MarkClientInvoicePaidModal } from './MarkClientInvoicePaidModal';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { ReviseDocumentModal, ReviseSubmitPayload } from './ReviseDocumentModal';
import { SendClientInvoiceModal } from './SendClientInvoiceModal';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';

interface ClientInvoiceListViewProps {
  invoices: ClientInvoice[];
  bossReportMonths?: Record<string, BossReportMonthData>;
  isLoading: boolean;
  permissions: PermissionsMap;
  currentActor: AuditActor;
  onCreateNew: () => void;
  onView: (invoice: ClientInvoice) => void;
  onEdit: (invoice: ClientInvoice) => void;
  onDuplicate: (invoice: ClientInvoice) => void;
  onSendInvoice: (
    invoiceId: string,
    params: {
      sentDate: string;
      dueDate: string;
      paymentTermsMode: PaymentTermsMode;
      paymentTermsDays?: number;
      manualDueDateNote?: string;
    }
  ) => Promise<void>;
  onMarkPaid: (invoiceId: string, paidDate: string) => Promise<void>;
  onChangeStatusWarna?: (
    invoiceId: string,
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
  onReviseInvoice: (invoice: ClientInvoice, payload: ReviseSubmitPayload) => Promise<void>;
  onDelete: (invoiceId: string, reason?: string) => Promise<void>;
  onRestore?: (invoiceId: string) => Promise<void>;
  onPermanentDelete?: (invoiceId: string) => Promise<void>;
  onUpdatePrintOptions?: (
    invoiceId: string,
    options: { showGRN: boolean; showSystemGeneratedNote: boolean }
  ) => Promise<void>;
}

function formatClientTermsBadge(inv: ClientInvoice): string {
  if (inv.status === 'Draft') return '-';
  if (inv.paymentTermsMode === 'MANUAL') return 'Custom';
  if (typeof inv.paymentTermsDays === 'number' && Number.isFinite(inv.paymentTermsDays)) {
    return `NET ${inv.paymentTermsDays}`;
  }
  return '-';
}

type StatusFilter = 'All' | ClientInvoiceEffectiveStatus;
type DateFieldFilter = 'invoiceDate' | 'dueDate';

export const ClientInvoiceListView: React.FC<ClientInvoiceListViewProps> = ({
  invoices,
  bossReportMonths = {},
  isLoading,
  permissions,
  currentActor,
  onCreateNew,
  onView,
  onEdit,
  onDuplicate,
  onSendInvoice,
  onMarkPaid,
  onChangeStatusWarna,
  onRescheduledCopyAction,
  onReviseInvoice,
  onDelete,
  onRestore,
  onPermanentDelete,
  onUpdatePrintOptions,
}) => {
  const [listTab, setListTab] = useState<'active' | 'trash'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [dateField, setDateField] = useState<DateFieldFilter>('dueDate');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [sendingInvoice, setSendingInvoice] = useState<ClientInvoice | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<ClientInvoice | null>(null);
  const [rescheduleInvoice, setRescheduleInvoice] = useState<ClientInvoice | null>(null);
  const [rescheduleCopyTarget, setRescheduleCopyTarget] = useState<{
    monthKey: string;
    item: BossReportRescheduledItem;
  } | null>(null);
  const [revisingInvoice, setRevisingInvoice] = useState<ClientInvoice | null>(null);
  const [confirmDeleteInv, setConfirmDeleteInv] = useState<ClientInvoice | null>(null);
  const [confirmPermanentDeleteInv, setConfirmPermanentDeleteInv] =
    useState<ClientInvoice | null>(null);
  const [previewModalInvoice, setPreviewModalInvoice] = useState<ClientInvoice | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeInvoices = useMemo(
    () => invoices.filter((inv) => !inv.isDeleted),
    [invoices]
  );
  const deletedInvoices = useMemo(
    () => invoices.filter((inv) => inv.isDeleted),
    [invoices]
  );

  const handleOpenPrintModal = (inv: ClientInvoice) => {
    if (!inv || !inv.id || !inv.invoiceNumber) {
      setPreviewError('Preview Invoice gagal dimuat');
      return;
    }
    setPreviewError(null);
    setPreviewModalInvoice(inv);
  };

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of activeInvoices) {
      if (inv.clientName.trim()) set.add(inv.clientName.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [activeInvoices]);

  const allRescheduledCopies = useMemo(() => {
    const seen = new Set<string>();
    const results: Array<{ monthKey: string; item: BossReportRescheduledItem }> = [];
    for (const [mk, mData] of Object.entries(bossReportMonths)) {
      for (const item of mData.rescheduledIn ?? []) {
        if (item.section !== 'cashIn' || item.sourceCategory !== 'clientInvoice') continue;
        const dedupKey = `${mk}:${item.id}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        results.push({ monthKey: mk, item });
      }
    }
    return results.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [bossReportMonths]);

  const filteredRescheduledCopies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allRescheduledCopies.filter(({ item }) => {
      if (statusFilter === 'Reschedule' && item.color !== 'red') return false;
      if (statusFilter === 'Paid' && item.color !== 'green') return false;
      if ((statusFilter === 'Unpaid' || statusFilter === 'Overdue') && item.color !== 'white') {
        return false;
      }
      if (statusFilter === 'Draft' || statusFilter === 'Void') return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRescheduledCopies, searchQuery, statusFilter]);

  const summaryTotals = useMemo(() => {
    let unpaidAmount = 0;
    let unpaidCount = 0;
    let draftCount = 0;
    let paidAmount = 0;
    let paidCount = 0;
    let overdueAmount = 0;
    let overdueCount = 0;

    for (const inv of activeInvoices) {
      const amt = resolveClientInvoiceNominal(inv);
      const eff = getClientInvoiceEffectiveStatus(inv);
      if (eff === 'Void' || eff === 'Reschedule') {
        continue;
      }
      if (eff === 'Paid') {
        paidAmount += amt;
        paidCount += 1;
      } else if (eff === 'Draft') {
        draftCount += 1;
      } else {
        unpaidAmount += amt;
        unpaidCount += 1;
        if (eff === 'Overdue') {
          overdueAmount += amt;
          overdueCount += 1;
        }
      }
    }

    for (const { item } of allRescheduledCopies) {
      if (item.color === 'red') continue;
      const amt = Number(item.amount) || 0;
      if (item.color === 'green') {
        paidAmount += amt;
        paidCount += 1;
      } else {
        unpaidAmount += amt;
        unpaidCount += 1;
      }
    }

    return {
      unpaidAmount,
      unpaidCount,
      draftCount,
      paidAmount,
      paidCount,
      overdueAmount,
      overdueCount,
    };
  }, [activeInvoices, allRescheduledCopies]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = activeInvoices.filter((inv) => {
      const eff = getClientInvoiceEffectiveStatus(inv);
      if (statusFilter !== 'All' && eff !== statusFilter) return false;
      if (clientFilter !== 'ALL' && inv.clientName.trim() !== clientFilter) return false;

      if (dateFrom || dateTo) {
        const targetDate =
          dateField === 'dueDate' ? inv.dueDate || '' : inv.invoiceDate || '';
        if (!targetDate) return false;
        if (dateFrom && targetDate < dateFrom) return false;
        if (dateTo && targetDate > dateTo) return false;
      }

      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.projectName.toLowerCase().includes(q) ||
        inv.projectNumber.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      const valA = dateField === 'dueDate' ? a.dueDate || '' : a.invoiceDate || '';
      const valB = dateField === 'dueDate' ? b.dueDate || '' : b.invoiceDate || '';
      const cmp = valA.localeCompare(valB);
      if (cmp !== 0) return sortOrder === 'asc' ? cmp : -cmp;
      return sortOrder === 'asc'
        ? a.invoiceNumber.localeCompare(b.invoiceNumber)
        : b.invoiceNumber.localeCompare(a.invoiceNumber);
    });
  }, [
    activeInvoices,
    searchQuery,
    clientFilter,
    statusFilter,
    dateField,
    dateFrom,
    dateTo,
    sortOrder,
  ]);

  const hasActiveFilter =
    searchQuery.trim() !== '' ||
    clientFilter !== 'ALL' ||
    statusFilter !== 'All' ||
    dateFrom !== '' ||
    dateTo !== '';

  const handleResetFilters = () => {
    setSearchQuery('');
    setClientFilter('ALL');
    setStatusFilter('All');
    setDateFrom('');
    setDateTo('');
  };

  const handleConfirmSend = async (params: {
    sentDate: string;
    dueDate: string;
    paymentTermsMode: PaymentTermsMode;
    paymentTermsDays?: number;
    manualDueDateNote?: string;
  }) => {
    if (!sendingInvoice) return;
    setActionError(null);
    setBusyId(sendingInvoice.id);
    try {
      await onSendInvoice(sendingInvoice.id, params);
      setSendingInvoice(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal mengirim Invoice Client.';
      setActionError(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmPaid = async (paidDate: string) => {
    if (!payingInvoice) return;
    setActionError(null);
    setBusyId(payingInvoice.id);
    try {
      await onMarkPaid(payingInvoice.id, paidDate);
      setPayingInvoice(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal menandai Invoice Paid.';
      setActionError(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const getInvoiceOriginMonth = (inv: ClientInvoice): string => {
    const raw = inv.dueDate || inv.invoiceDate || getTodayISODate();
    return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : getTodayISODate().slice(0, 7);
  };

  const handleConfirmReschedule = async (targetMonthKey: string) => {
    if (rescheduleCopyTarget && onRescheduledCopyAction) {
      const { monthKey, item } = rescheduleCopyTarget;
      const copyBusyKey = `copy:${monthKey}:${item.id}`;
      setActionError(null);
      setBusyId(copyBusyKey);
      try {
        await onRescheduledCopyAction(monthKey, item.id, 'red', targetMonthKey);
        setRescheduleCopyTarget(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Gagal memindahkan Salinan Pending ke bulan tujuan.';
        setActionError(msg);
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (!rescheduleInvoice || !onChangeStatusWarna) return;
    setActionError(null);
    setBusyId(rescheduleInvoice.id);
    try {
      await onChangeStatusWarna(
        rescheduleInvoice.id,
        'red',
        targetMonthKey,
        getInvoiceOriginMonth(rescheduleInvoice)
      );
      setRescheduleInvoice(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal memindahkan Invoice Client ke bulan tujuan.';
      setActionError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelInvoicePending = async (inv: ClientInvoice) => {
    if (!onChangeStatusWarna) return;
    setActionError(null);
    setBusyId(inv.id);
    try {
      await onChangeStatusWarna(inv.id, 'white', undefined, getInvoiceOriginMonth(inv));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal membatalkan status Pending.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (reason?: string) => {
    if (!confirmDeleteInv) return;
    setActionError(null);
    setBusyId(confirmDeleteInv.id);
    try {
      await onDelete(confirmDeleteInv.id, reason);
      setConfirmDeleteInv(null);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal menghapus Invoice Client ke Riwayat Hapus.';
      setActionError(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!confirmPermanentDeleteInv || !onPermanentDelete) return;
    setActionError(null);
    setBusyId(confirmPermanentDeleteInv.id);
    try {
      await onPermanentDelete(confirmPermanentDeleteInv.id);
      setConfirmPermanentDeleteInv(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal menghapus permanen Invoice Client.';
      setActionError(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmRevise = async (payload: ReviseSubmitPayload) => {
    if (!revisingInvoice) return;
    setActionError(null);
    setBusyId(revisingInvoice.id);
    try {
      await onReviseInvoice(revisingInvoice, payload);
      setRevisingInvoice(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal merevisi Invoice Client.';
      setActionError(msg);
      throw err;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {actionError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3"
        >
          <span className="inline-flex items-center gap-2 font-medium break-words">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            {actionError}
          </span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold text-red-800 hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}
      {/* Sub-navigation: Daftar Invoice Aktif vs Riwayat Hapus */}
      {(deletedInvoices.length > 0 ||
        permissions.soft_delete_po ||
        permissions.permanent_delete_po) && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setListTab('active')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              listTab === 'active'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Daftar Invoice Aktif ({activeInvoices.length})
          </button>
          <button
            type="button"
            onClick={() => setListTab('trash')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              listTab === 'trash'
                ? 'bg-red-700 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Riwayat Hapus ({deletedInvoices.length})
          </button>
        </div>
      )}

      {listTab === 'trash' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {deletedInvoices.length === 0 ? (
            <div className="py-14 px-6 text-center text-xs text-slate-500">
              Belum ada Invoice Client di Riwayat Hapus.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap">No. Invoice</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Client &amp; Project</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Total</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Dihapus Oleh</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Waktu Hapus</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Alasan</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {deletedInvoices.map((inv) => {
                    const isBusy = busyId === inv.id;
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-medium text-slate-900">{inv.clientName}</div>
                          <div className="text-[11px] text-slate-500">{inv.projectName}</div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                          Rp {formatIDR(resolveClientInvoiceNominal(inv))}
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-semibold text-slate-900">
                            {inv.deletedByName || '-'}
                          </div>
                          {inv.deletedByEmail && (
                            <div className="text-[11px] text-slate-500 font-mono">
                              {inv.deletedByEmail}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-600 whitespace-nowrap">
                          {inv.deletedAt || '-'}
                        </td>
                        <td className="py-3 px-3.5 text-slate-600 max-w-[220px]">
                          {inv.deleteReason || '-'}
                        </td>
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {permissions.soft_delete_po && onRestore && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={async () => {
                                  setActionError(null);
                                  setBusyId(inv.id);
                                  try {
                                    await onRestore(inv.id);
                                  } catch (err) {
                                    setActionError(
                                      err instanceof Error
                                        ? err.message
                                        : 'Gagal memulihkan Invoice Client.'
                                    );
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
                                onClick={() => setConfirmPermanentDeleteInv(inv)}
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
      {/* Top 3 Totals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-blue-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Total Belum Dibayar Client
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5 truncate">
            Rp {formatIDR(summaryTotals.unpaidAmount)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {summaryTotals.unpaidCount} Invoice Sent/Unpaid
            {summaryTotals.draftCount > 0 ? ` · ${summaryTotals.draftCount} Draft` : ''}
          </p>
        </div>

        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Total Sudah Dibayar
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5 truncate">
            Rp {formatIDR(summaryTotals.paidAmount)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {summaryTotals.paidCount} Invoice (Paid)
          </p>
        </div>

        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
            Total Overdue
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-red-700 mt-1.5 truncate">
            Rp {formatIDR(summaryTotals.overdueAmount)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {summaryTotals.overdueCount} Invoice lewat jatuh tempo
          </p>
        </div>
      </div>

      {previewError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            {previewError}
          </span>
          <button
            type="button"
            onClick={() => setPreviewError(null)}
            className="font-semibold text-red-800 hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari No. Invoice, Client, atau Project..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Urutan: {sortOrder === 'asc' ? 'Terdekat' : 'Terjauh'}
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

            {permissions.create_po && (
              <button
                type="button"
                onClick={onCreateNew}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Buat Invoice Client
              </button>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 xl:grid-cols-12 gap-3 items-end">
          {/* Status Filter */}
          <div className="xl:col-span-4">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              Filter Status
            </span>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'All', label: 'Semua' },
                  { id: 'Draft', label: 'DRAFT' },
                  { id: 'Unpaid', label: 'SENT / UNPAID' },
                  { id: 'Overdue', label: 'OVERDUE' },
                  { id: 'Reschedule', label: 'PENDING' },
                  { id: 'Paid', label: 'PAID' },
                  { id: 'Void', label: 'VOID / DIREVISI' },
                ] as const
              ).map((tab) => {
                const active = statusFilter === tab.id;
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
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Client Filter */}
          <div className="xl:col-span-3">
            <label
              htmlFor="cli-filter-client"
              className="block text-[11px] font-semibold text-slate-500 mb-1.5"
            >
              Filter Client
            </label>
            <select
              id="cli-filter-client"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">Semua Client</option>
              {clientOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div className="xl:col-span-5">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
              Filter Tanggal ({dateField === 'dueDate' ? 'Jatuh Tempo' : 'Tanggal Invoice'})
            </span>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
              <select
                aria-label="Basis tanggal filter client invoice"
                value={dateField}
                onChange={(e) => setDateField(e.target.value as DateFieldFilter)}
                className="px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="dueDate">Jatuh Tempo</option>
                <option value="invoiceDate">Tgl Invoice</option>
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

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-11 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredAndSorted.length === 0 && filteredRescheduledCopies.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              {activeInvoices.length === 0
                ? 'Belum ada Invoice Client (Cash In)'
                : 'Tidak ada Invoice Client yang cocok'}
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              {activeInvoices.length === 0
                ? 'Buat invoice tagihan ke Client agar proyeksi Cash In di halaman Projection terisi otomatis.'
                : 'Ubah kata kunci pencarian atau filter lainnya.'}
            </p>
            {activeInvoices.length === 0 ? (
              permissions.create_po && (
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
                >
                  <FilePlus2 className="w-4 h-4" />
                  Buat Invoice Client Pertama
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
          <>
            {/* Mobile Card Layout (< md): ensures Lihat, Edit, and Print Invoice are never cut off on phone screens */}
            <div className="md:hidden divide-y divide-slate-200">
              {filteredAndSorted.map((inv) => {
                const eff = getClientInvoiceEffectiveStatus(inv);
                const isVoided = eff === 'Void';
                const isDraft = eff === 'Draft';
                const isPaid = eff === 'Paid';
                const isPending = eff === 'Reschedule';
                const overdue = !isVoided && !isPending && isClientInvoiceOverdue(inv);
                const remDays = inv.dueDate ? getRemainingDays(inv.dueDate) : null;
                const isBusy = busyId === inv.id;

                return (
                  <div
                    key={inv.id}
                    className={`p-4 space-y-3 ${
                      isVoided
                        ? 'bg-slate-50/80 opacity-85'
                        : isPending
                        ? 'bg-slate-100/80 text-slate-400 opacity-80'
                        : overdue
                        ? 'bg-red-50/70'
                        : 'bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-slate-900">
                          <span className={isVoided ? 'line-through text-slate-500' : ''}>
                            {inv.invoiceNumber}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
                          {inv.clientName}
                        </div>
                        <div className="text-xs text-slate-600 truncate">
                          {inv.projectName}{' '}
                          {inv.projectNumber ? `(${inv.projectNumber})` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {isPending ? (
                          <div className="inline-flex flex-col items-end font-mono text-xs">
                            <span className="line-through text-slate-400">
                              Rp {formatIDR(resolveClientInvoiceNominal(inv))}
                            </span>
                            <span className="font-bold text-slate-600">Rp 0</span>
                            <span className="text-[10px] font-sans text-slate-500">
                              Tidak dihitung di bulan ini
                            </span>
                          </div>
                        ) : (
                          <div>
                            <div className="font-mono text-sm font-bold text-emerald-700 tabular-nums">
                              Rp {formatIDR(resolveClientInvoiceNominal(inv))}
                            </div>
                            {resolveClientInvoiceGrossNominal(inv) >
                              resolveClientInvoiceNominal(inv) && (
                              <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                                Gross: Rp {formatIDR(resolveClientInvoiceGrossNominal(inv))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-1 flex flex-col items-end gap-1">
                          {isVoided ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-rose-100 text-rose-800 border border-rose-200">
                              VOID / DIREVISI
                            </span>
                          ) : isPaid ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-emerald-700 text-white">
                              PAID
                            </span>
                          ) : isPending ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-200 text-slate-700 border border-slate-300">
                              {inv.rescheduledToMonth
                                ? `DIPENDING KE ${formatBossMonthFullLabel(inv.rescheduledToMonth)}`
                                : 'DIPENDING'}
                            </span>
                          ) : isDraft ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                              DRAFT
                            </span>
                          ) : overdue ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-red-600 text-white">
                              OVERDUE
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                              SENT / UNPAID
                            </span>
                          )}
                          {!isVoided && !isDraft && (
                            <StatusWarnaDropdown
                              value={normalizeStatusToColor(inv.status, inv.statusWarna)}
                              disabled={isBusy || !permissions.mark_paid}
                              compact
                              ariaLabel={`Status warna ${inv.invoiceNumber}`}
                              onSelect={(nextColor) => {
                                if (nextColor === 'green') {
                                  setPayingInvoice(inv);
                                } else if (onChangeStatusWarna) {
                                  setRescheduleInvoice(inv);
                                }
                              }}
                            />
                          )}
                          {isPending && onChangeStatusWarna && permissions.mark_paid && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleCancelInvoicePending(inv)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Batalkan Pending / Kembalikan
                            </button>
                          )}
                          {isVoided && inv.replacedByInvoiceNumber && (
                            <span className="text-[10px] font-mono text-rose-700">
                              Diganti: {inv.replacedByInvoiceNumber}
                            </span>
                          )}
                          {!isVoided && inv.revisionSubStatus && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase rounded border ${
                                inv.revisionSubStatus === 'Menunggu Konfirmasi'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : inv.revisionSubStatus === 'Menunggu Pembayaran Ulang'
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                              }`}
                            >
                              {inv.revisionSubStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600 bg-slate-50/80 p-2.5 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-slate-400 block">Tgl Invoice</span>
                        <span className="font-medium text-slate-800">
                          {formatShortDateID(inv.invoiceDate)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Tgl Kirim</span>
                        <span className="font-medium text-slate-800">
                          {(() => {
                            const displaySentDate =
                              inv.sentDate ||
                              (inv.status !== 'Draft' ? getTodayISODate() : '');
                            return displaySentDate
                              ? formatShortDateID(displaySentDate)
                              : 'Belum dikirim';
                          })()}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Jatuh Tempo</span>
                        <span className="font-medium text-slate-800">
                          {inv.dueDate ? formatShortDateID(inv.dueDate) : '-'}
                          {!isVoided && !isPaid && !isDraft && !isPending && remDays !== null && remDays < 0
                            ? ` (Telat ${Math.abs(remDays)}h)`
                            : ''}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {!isVoided && isDraft && permissions.send_invoice && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setSendingInvoice(inv)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Kirim Invoice
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onView(inv)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Lihat
                      </button>

                      {!isVoided && !isPaid && permissions.edit_po_draft && (
                        <button
                          type="button"
                          onClick={() => onEdit(inv)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )}

                      {(permissions.edit_po_draft || permissions.create_po) && (
                        <button
                          type="button"
                          onClick={() => handleOpenPrintModal(inv)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print Invoice
                        </button>
                      )}

                      {!isVoided &&
                        !isDraft &&
                        ((isPaid && permissions.revise_paid) ||
                          (!isPaid && permissions.revise_invoiced)) && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setRevisingInvoice(inv)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                            Revisi
                          </button>
                        )}

                      {!isVoided && !isPaid && !isDraft && !isPending && permissions.mark_paid && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setPayingInvoice(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Tandai Sudah Dibayar
                        </button>
                      )}

                      {permissions.create_po && (
                        <button
                          type="button"
                          onClick={() => onDuplicate(inv)}
                          title="Duplikat Invoice Client"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isVoided && permissions.soft_delete_po && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteInv(inv)}
                          title="Hapus Invoice Client (Pindah ke Riwayat Hapus)"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredRescheduledCopies.map(({ monthKey: copyMonthKey, item: copy }) => {
                const isCopyPending = copy.color === 'red';
                const copyBusyKey = `copy:${copyMonthKey}:${copy.id}`;
                const isCopyBusy = busyId === copyBusyKey;
                const copyDueStatus = computeDueTunggakanStatus({
                  dueISO: copy.dueISO,
                  originMonthKey: copy.originMonthKey,
                  isPaid: copy.color === 'green',
                });
                return (
                  <div
                    key={`m-copy-${copyMonthKey}-${copy.id}`}
                    className={`p-4 space-y-2 ${
                      isCopyPending
                        ? 'bg-slate-100/80 text-slate-400 opacity-80'
                        : copy.color === 'green'
                        ? 'bg-emerald-50/40'
                        : 'bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {copyDueStatus.isTunggakan ? (
                          <span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-50 text-amber-800 border border-amber-300">
                            {copyDueStatus.statusText}
                          </span>
                        ) : copy.color !== 'green' ? (
                          <span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-700 border border-slate-300">
                            {copyDueStatus.statusText}
                          </span>
                        ) : null}
                        <div className="text-xs font-semibold text-slate-900 mt-1">{copy.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Periode Target: {formatBossMonthFullLabel(copyMonthKey)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {isCopyPending ? (
                          <div className="inline-flex flex-col items-end font-mono text-xs">
                            <span className="line-through text-slate-400">
                              Rp {formatIDR(copy.amount)}
                            </span>
                            <span className="font-bold text-slate-600">Rp 0</span>
                            <span className="text-[10px] font-sans text-slate-500">
                              Tidak dihitung di bulan ini
                            </span>
                          </div>
                        ) : (
                          <div className="font-mono text-sm font-bold text-emerald-700 tabular-nums">
                            Rp {formatIDR(copy.amount)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isCopyPending && (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded border bg-slate-200 text-slate-700 border-slate-300">
                          {copy.rescheduledToMonth
                            ? `DIPENDING KE ${formatBossMonthFullLabel(copy.rescheduledToMonth)}`
                            : 'DIPENDING'}
                        </span>
                      )}
                      {onRescheduledCopyAction && (
                        <>
                          <StatusWarnaDropdown
                            value={copy.color}
                            disabled={isCopyBusy || !permissions.mark_paid}
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
                          {permissions.mark_paid && (
                            <button
                              type="button"
                              disabled={isCopyBusy}
                              onClick={async () => {
                                setBusyId(copyBusyKey);
                                try {
                                  await onRescheduledCopyAction(
                                    copyMonthKey,
                                    copy.id,
                                    'white'
                                  );
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Batalkan Pending / Kembalikan
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table Layout (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap">No. Invoice</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Client</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Project</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Tgl Invoice</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Tgl Kirim</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Terms</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Jatuh Tempo</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Total</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Sisa Hari</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Status Warna</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredAndSorted.map((inv) => {
                    const eff = getClientInvoiceEffectiveStatus(inv);
                    const isVoided = eff === 'Void';
                    const isDraft = eff === 'Draft';
                    const isPaid = eff === 'Paid';
                    const isPending = eff === 'Reschedule';
                    const overdue = !isVoided && !isPending && isClientInvoiceOverdue(inv);
                    const remDays = inv.dueDate ? getRemainingDays(inv.dueDate) : null;
                    const isBusy = busyId === inv.id;

                    return (
                      <tr
                        key={inv.id}
                        className={`transition-colors ${
                          isVoided
                            ? 'bg-slate-50/70 opacity-85 hover:bg-slate-100/70'
                            : isPending
                            ? 'bg-slate-100/80 text-slate-400 opacity-80'
                            : overdue
                            ? 'bg-red-50/80 hover:bg-red-100/70'
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-3.5 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onView(inv)}
                            className={`hover:underline text-left cursor-pointer ${
                              isVoided ? 'line-through text-slate-500' : ''
                            }`}
                          >
                            {inv.invoiceNumber}
                          </button>
                        </td>
                        <td className="py-3 px-3.5 font-medium text-slate-900 max-w-[160px] truncate">
                          {inv.clientName}
                        </td>
                        <td className="py-3 px-3.5">
                          <div className="font-medium text-slate-900 max-w-[180px] truncate">
                            {inv.projectName}
                          </div>
                          <div className="text-xs font-mono text-slate-500">
                            {inv.projectNumber}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                          {formatShortDateID(inv.invoiceDate)}
                        </td>
                        <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                          {(() => {
                            const displaySentDate =
                              inv.sentDate ||
                              (inv.status !== 'Draft' ? getTodayISODate() : '');
                            return displaySentDate ? (
                              formatShortDateID(displaySentDate)
                            ) : (
                              <span className="text-slate-400 italic">Belum dikirim</span>
                            );
                          })()}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                          {formatClientTermsBadge(inv)}
                        </td>
                        <td className="py-3 px-3.5 text-xs font-medium text-slate-800 whitespace-nowrap tabular-nums">
                          <div>{inv.dueDate ? formatShortDateID(inv.dueDate) : '-'}</div>
                          {inv.paymentTermsMode === 'MANUAL' && inv.manualDueDateNote && (
                            <div className="text-[11px] font-normal text-slate-500 whitespace-normal max-w-[170px] mt-0.5">
                              ({inv.manualDueDateNote})
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono text-xs font-semibold text-emerald-700 whitespace-nowrap tabular-nums">
                          {isPending ? (
                            <div className="inline-flex flex-col items-end">
                              <span className="line-through text-slate-400 font-normal">
                                Rp {formatIDR(resolveClientInvoiceNominal(inv))}
                              </span>
                              <span className="text-slate-600">Rp 0</span>
                              <span className="text-[10px] font-sans font-normal text-slate-500">
                                Tidak dihitung di bulan ini
                              </span>
                            </div>
                          ) : (
                            <div className="inline-flex flex-col items-end">
                              <span>Rp {formatIDR(resolveClientInvoiceNominal(inv))}</span>
                              {resolveClientInvoiceGrossNominal(inv) >
                                resolveClientInvoiceNominal(inv) && (
                                <span className="text-[10px] font-normal text-slate-500">
                                  Gross: Rp {formatIDR(resolveClientInvoiceGrossNominal(inv))}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          {isVoided ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                              VOID / DIREVISI
                            </span>
                          ) : isPaid ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              LUNAS {inv.paidDate ? `(${formatShortDateID(inv.paidDate)})` : ''}
                            </span>
                          ) : isPending ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : isDraft ? (
                            <span className="text-xs text-slate-400">Belum dikirim</span>
                          ) : remDays === null ? (
                            <span className="text-xs text-slate-400">-</span>
                          ) : remDays < 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200 tabular-nums">
                              OVERDUE / TELAT {Math.abs(remDays)} Hari
                            </span>
                          ) : remDays <= 7 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 tabular-nums">
                              {remDays === 0 ? 'Jatuh Tempo Hari Ini' : `Sisa ${remDays} hari`}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-slate-700 tabular-nums">
                              {remDays} hari lagi
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            {isVoided ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-rose-100 text-rose-800 border border-rose-200">
                                VOID / DIREVISI
                              </span>
                            ) : isPaid ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-emerald-700 text-white">
                                PAID
                              </span>
                            ) : isPending ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-slate-200 text-slate-700 border border-slate-300">
                                {inv.rescheduledToMonth
                                  ? `DIPENDING KE ${formatBossMonthFullLabel(inv.rescheduledToMonth)}`
                                  : 'DIPENDING'}
                              </span>
                            ) : isDraft ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                DRAFT
                              </span>
                            ) : overdue ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-red-600 text-white">
                                OVERDUE
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                                SENT / UNPAID
                              </span>
                            )}
                            {isVoided && inv.replacedByInvoiceNumber && (
                              <span className="text-[10px] font-mono text-rose-700">
                                Diganti: {inv.replacedByInvoiceNumber}
                              </span>
                            )}
                            {!isVoided && inv.revisionSubStatus && (
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                                  inv.revisionSubStatus === 'Menunggu Konfirmasi'
                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                    : inv.revisionSubStatus === 'Menunggu Pembayaran Ulang'
                                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                                    : 'bg-slate-100 text-slate-700 border-slate-300'
                                }`}
                              >
                                {inv.revisionSubStatus}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          {!isVoided && !isDraft ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <StatusWarnaDropdown
                                value={normalizeStatusToColor(inv.status, inv.statusWarna)}
                                disabled={isBusy || !permissions.mark_paid}
                                compact
                                ariaLabel={`Status warna ${inv.invoiceNumber}`}
                                onSelect={(nextColor) => {
                                  if (nextColor === 'green') {
                                    setPayingInvoice(inv);
                                  } else if (onChangeStatusWarna) {
                                    setRescheduleInvoice(inv);
                                  }
                                }}
                              />
                              {isPending && onChangeStatusWarna && permissions.mark_paid && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleCancelInvoicePending(inv)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Batalkan Pending / Kembalikan
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {!isVoided && isDraft && permissions.send_invoice && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setSendingInvoice(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5" />
                                Kirim Invoice
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onView(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Lihat
                            </button>
                            {!isVoided && !isPaid && permissions.edit_po_draft && (
                              <button
                                type="button"
                                onClick={() => onEdit(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit
                              </button>
                            )}
                            {(permissions.edit_po_draft || permissions.create_po) && (
                              <button
                                type="button"
                                onClick={() => handleOpenPrintModal(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                Print Invoice
                              </button>
                            )}
                            {!isVoided &&
                              !isDraft &&
                              ((isPaid && permissions.revise_paid) ||
                                (!isPaid && permissions.revise_invoiced)) && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setRevisingInvoice(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <History className="w-3.5 h-3.5" />
                                  Revisi
                                </button>
                              )}
                            {!isVoided && !isPaid && !isDraft && !isPending && permissions.mark_paid && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setPayingInvoice(inv)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Tandai Sudah Dibayar
                              </button>
                            )}
                            {permissions.create_po && (
                              <button
                                type="button"
                                onClick={() => onDuplicate(inv)}
                                title="Duplikat Invoice Client"
                                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isVoided && permissions.soft_delete_po && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteInv(inv)}
                                title="Hapus Invoice Client (Pindah ke Riwayat Hapus)"
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
                    const copyDueStatus = computeDueTunggakanStatus({
                      dueISO: copy.dueISO,
                      originMonthKey: copy.originMonthKey,
                      isPaid: copy.color === 'green',
                    });
                    return (
                      <tr
                        key={`d-copy-${copyMonthKey}-${copy.id}`}
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
                        <td colSpan={3} className="py-3 px-3.5 text-xs font-medium text-slate-900">
                          {copy.name}
                        </td>
                        <td className="py-3 px-3.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                          {formatBossMonthFullLabel(copyMonthKey)}
                        </td>
                        <td className="py-3 px-3.5 text-xs text-slate-400">-</td>
                        <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap">
                          {copy.dueISO ? formatShortDateID(copy.dueISO) : '-'}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono text-xs font-semibold text-emerald-700 whitespace-nowrap tabular-nums">
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
                        <td className="py-3 px-3.5 text-xs text-slate-400 whitespace-nowrap">-</td>
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
                                disabled={isCopyBusy || !permissions.mark_paid}
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
                              {permissions.mark_paid && (
                                <button
                                  type="button"
                                  disabled={isCopyBusy}
                                  onClick={async () => {
                                    setBusyId(copyBusyKey);
                                    try {
                                      await onRescheduledCopyAction(
                                        copyMonthKey,
                                        copy.id,
                                        'white'
                                      );
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
          </>
        )}
      </div>
        </>
      )}

      {previewModalInvoice && (
        <ClientInvoicePreviewModal
          invoice={previewModalInvoice}
          canDownload={permissions.edit_po_draft || permissions.create_po}
          onClose={() => setPreviewModalInvoice(null)}
          onUpdatePrintOptions={
            permissions.edit_po_draft || permissions.send_invoice || permissions.create_po
              ? onUpdatePrintOptions
              : undefined
          }
        />
      )}

      {sendingInvoice && (
        <SendClientInvoiceModal
          invoice={sendingInvoice}
          isSubmitting={busyId === sendingInvoice.id}
          onCancel={() => setSendingInvoice(null)}
          onConfirm={handleConfirmSend}
        />
      )}

      {payingInvoice && (
        <MarkClientInvoicePaidModal
          invoice={payingInvoice}
          isSubmitting={busyId === payingInvoice.id}
          onCancel={() => setPayingInvoice(null)}
          onConfirm={handleConfirmPaid}
        />
      )}

      {revisingInvoice && (
        <ReviseDocumentModal
          docType="client-invoice"
          invoice={revisingInvoice}
          currentActor={currentActor}
          isSubmitting={busyId === revisingInvoice.id}
          onCancel={() => setRevisingInvoice(null)}
          onConfirm={handleConfirmRevise}
        />
      )}

      {confirmDeleteInv && (
        <DeleteConfirmModal
          docTitle="Hapus Invoice Client?"
          docNumber={confirmDeleteInv.invoiceNumber}
          docSubtitle={`${confirmDeleteInv.clientName} · Rp ${formatIDR(
            resolveClientInvoiceNominal(confirmDeleteInv)
          )}`}
          mode="soft"
          isBusy={busyId === confirmDeleteInv.id}
          onCancel={() => setConfirmDeleteInv(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {confirmPermanentDeleteInv && (
        <DeleteConfirmModal
          docTitle="Hapus Permanen Invoice Client?"
          docNumber={confirmPermanentDeleteInv.invoiceNumber}
          docSubtitle={`${confirmPermanentDeleteInv.clientName} · Rp ${formatIDR(
            resolveClientInvoiceNominal(confirmPermanentDeleteInv)
          )}`}
          mode="permanent"
          isBusy={busyId === confirmPermanentDeleteInv.id}
          onCancel={() => setConfirmPermanentDeleteInv(null)}
          onConfirm={handleConfirmPermanentDelete}
        />
      )}

      <RescheduleMonthModal
        isOpen={Boolean(rescheduleInvoice || rescheduleCopyTarget)}
        itemName={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.item.name
            : rescheduleInvoice
            ? `${rescheduleInvoice.invoiceNumber} — ${rescheduleInvoice.clientName}`
            : ''
        }
        amount={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.item.amount
            : rescheduleInvoice
            ? resolveClientInvoiceNominal(rescheduleInvoice)
            : 0
        }
        originMonthKey={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.monthKey
            : rescheduleInvoice
            ? getInvoiceOriginMonth(rescheduleInvoice)
            : getTodayISODate().slice(0, 7)
        }
        initialTargetMonthKey={
          rescheduleCopyTarget
            ? rescheduleCopyTarget.item.rescheduledToMonth
            : rescheduleInvoice?.rescheduledToMonth
        }
        isSaving={Boolean(
          (rescheduleCopyTarget &&
            busyId === `copy:${rescheduleCopyTarget.monthKey}:${rescheduleCopyTarget.item.id}`) ||
            (rescheduleInvoice && busyId === rescheduleInvoice.id)
        )}
        onCancel={() => {
          setRescheduleInvoice(null);
          setRescheduleCopyTarget(null);
        }}
        onConfirm={handleConfirmReschedule}
      />
    </div>
  );
};
