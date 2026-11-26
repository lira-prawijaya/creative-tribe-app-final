import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  CheckCircle2,
  ExternalLink,
  Eye,
  History,
  Paperclip,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Search,
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
  isEffectiveOverdue,
  isVendorPODitagih,
  isVendorPOLunas,
  resolveVendorPOTaxDetails,
} from '../utils/format';
import {
  CancelVendorInvoiceModal,
  CancelVendorPOTargetStatus,
} from './CancelVendorInvoiceModal';
import { DueCountdownCell } from './DueCountdownCell';
import { InvoiceSubmissionPayload, MarkInvoicedModal } from './MarkInvoicedModal';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { ReviseDocumentModal, ReviseSubmitPayload } from './ReviseDocumentModal';
import { StatusBadge } from './StatusBadge';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';
import { SubmitPphModal } from './SubmitPphModal';

interface InvoicedPOViewProps {
  orders: PurchaseOrder[];
  bossReportMonths?: Record<string, BossReportMonthData>;
  isLoading: boolean;
  permissions: PermissionsMap;
  currentActor: AuditActor;
  onGoToList: () => void;
  onPreview: (po: PurchaseOrder) => void;
  onPrint: (po: PurchaseOrder) => void;
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
  onRevisePO: (po: PurchaseOrder, payload: ReviseSubmitPayload) => Promise<void>;
}

export const InvoicedPOView: React.FC<InvoicedPOViewProps> = ({
  orders,
  bossReportMonths = {},
  isLoading,
  permissions,
  currentActor,
  onGoToList,
  onPreview,
  onPrint,
  onStatusChange,
  onSubmitPph,
  onCancelInvoice,
  onCancelPaid,
  onChangeStatusWarna,
  onRescheduledCopyAction,
  onRevisePO,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Invoiced' | 'Overdue' | 'Reschedule' | 'Paid'>('All');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [editingInvoicePO, setEditingInvoicePO] = useState<PurchaseOrder | null>(null);
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

  const invoicedOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = orders.filter((po) => {
      if (po.isDeleted) return false;
      const isLunas = isVendorPOLunas(po);
      const isDitagih = isVendorPODitagih(po);
      if (!isLunas && !isDitagih) return false;
      if (statusFilter === 'Overdue') {
        if (!isEffectiveOverdue(po)) return false;
      } else if (statusFilter === 'Paid') {
        if (!isLunas) return false;
      } else if (statusFilter === 'Invoiced') {
        if (!isDitagih || po.status === 'Reschedule') return false;
      } else if (statusFilter !== 'All' && po.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        po.poNumber.toLowerCase().includes(q) ||
        po.vendorName.toLowerCase().includes(q) ||
        po.projectName.toLowerCase().includes(q) ||
        (po.invoiceNumber ?? '').toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      const dateA = a.invoiceDate || a.poDate || '';
      const dateB = b.invoiceDate || b.poDate || '';
      const cmp = dateA.localeCompare(dateB);
      if (cmp !== 0) {
        return sortOrder === 'desc' ? -cmp : cmp;
      }
      return sortOrder === 'desc'
        ? b.poNumber.localeCompare(a.poNumber)
        : a.poNumber.localeCompare(b.poNumber);
    });
  }, [orders, searchQuery, statusFilter, sortOrder]);

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
        if ((statusFilter === 'Invoiced' || statusFilter === 'Overdue') && item.color !== 'white') {
          continue;
        }
        if (q && !item.name.toLowerCase().includes(q)) continue;
        results.push({ monthKey: mk, item });
      }
    }
    return results.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [bossReportMonths, searchQuery, statusFilter]);

  const handleMarkPaid = async (po: PurchaseOrder) => {
    setBusyId(po.id);
    try {
      await onStatusChange(po.id, 'Paid');
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

  const handleCancelPOPending = async (po: PurchaseOrder) => {
    if (!onChangeStatusWarna) return;
    setBusyId(po.id);
    try {
      await onChangeStatusWarna(po.id, 'white', undefined, getPOOriginMonth(po));
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

  const handleSaveInvoiceMeta = async (payload: InvoiceSubmissionPayload) => {
    if (!editingInvoicePO) return;
    setBusyId(editingInvoicePO.id);
    try {
      await onStatusChange(editingInvoicePO.id, editingInvoicePO.status, payload);
      setEditingInvoicePO(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmRevise = async (payload: ReviseSubmitPayload) => {
    if (!revisingPO) return;
    setBusyId(revisingPO.id);
    try {
      await onRevisePO(revisingPO, payload);
      setRevisingPO(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari No. Invoice, No. PO, Vendor, atau Project..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'All' as const, label: 'Semua Ditagih' },
              { id: 'Invoiced' as const, label: 'SUDAH DITAGIH' },
              { id: 'Overdue' as const, label: 'OVERDUE' },
              { id: 'Reschedule' as const, label: 'PENDING' },
              { id: 'Paid' as const, label: 'LUNAS' },
            ].map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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

          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            Tgl Invoice: {sortOrder === 'desc' ? 'Terbaru' : 'Terlama'}
          </button>
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
        ) : invoicedOrders.length === 0 && filteredRescheduledCopies.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
              <Receipt className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              Tidak ada data PO yang sudah ditagih
            </h2>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Klik tombol &ldquo;Input Invoice / Sudah Ditagih&rdquo; pada menu List PO untuk memindahkan PO ke daftar penagihan ini.
            </p>
            <button
              type="button"
              onClick={onGoToList}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              Buka List PO
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-3.5 whitespace-nowrap">No. PO</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">No. Invoice</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Payment Terms</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Tanggal Invoice</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Jatuh Tempo</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Sisa Hari</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Vendor</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Project Name</th>
                  <th className="py-3 px-3.5 text-right whitespace-nowrap">Total Amount</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Status</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Status Warna</th>
                  <th className="py-3 px-3.5 text-right whitespace-nowrap">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {invoicedOrders.map((po) => {
                  const isInvoiced = po.status === 'Invoiced';
                  const isPending = po.status === 'Reschedule';
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
                      <td className="py-3 px-3.5 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{po.invoiceNumber || '-'}</span>
                          {po.invoiceFileUrl && (
                            <a
                              href={po.invoiceFileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Buka link file invoice"
                              className="text-blue-700 hover:text-blue-900"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {!po.invoiceFileUrl && po.invoiceFileName && (
                            <span
                              title={po.invoiceFileName}
                              className="text-slate-500"
                            >
                              <Paperclip className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                        {invoiced
                          ? formatPaymentTermsLabel(po.paymentTermsDays, po.paymentTermsMode)
                          : '-'}
                      </td>
                      <td className="py-3 px-3.5 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {po.invoiceDate ? formatShortDateID(po.invoiceDate) : '-'}
                      </td>
                      <td className="py-3 px-3.5 text-xs font-medium text-slate-800 whitespace-nowrap tabular-nums">
                        {effectiveDueDate ? (
                          <div>
                            <div>{formatShortDateID(effectiveDueDate)}</div>
                            {po.paymentTermsMode === 'MANUAL' && po.manualDueDateNote && (
                              <div className="text-[11px] font-normal text-slate-500 whitespace-normal max-w-[170px] mt-0.5">
                                ({po.manualDueDateNote})
                              </div>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <DueCountdownCell po={po} />
                      </td>
                      <td className="py-3 px-3.5 text-sm font-medium text-slate-900 max-w-[150px] truncate">
                        {po.vendorName}
                      </td>
                      <td className="py-3 px-3.5 text-sm text-slate-700 max-w-[160px] truncate">
                        {po.projectName}
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
                          {isInvoiced && permissions.mark_paid && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleMarkPaid(po)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-green-800 hover:bg-green-900 rounded-md transition-colors mr-1 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Tandai Lunas
                            </button>
                          )}
                          {tax.hasPph &&
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
                          {((po.status === 'Paid' && permissions.revise_paid) ||
                            (po.status === 'Invoiced' && permissions.revise_invoiced)) && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setRevisingPO(po)}
                              title={
                                po.status === 'Paid'
                                  ? 'Revisi PO / Invoice yang sudah LUNAS'
                                  : 'Revisi PO & Buat Invoice Pengganti'
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-md transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <History className="w-3.5 h-3.5" />
                              Revisi
                            </button>
                          )}
                          {isInvoiced && permissions.send_invoice && (
                            <button
                              type="button"
                              onClick={() => setEditingInvoicePO(po)}
                              title="Ubah Info Invoice Vendor"
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
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
                      key={`inv-po-copy-${copyMonthKey}-${copy.id}`}
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
                      <td colSpan={3} className="py-3 px-3.5 text-xs text-slate-500">
                        {copy.dueISO ? `JT ${formatShortDateID(copy.dueISO)}` : '-'}
                      </td>
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

      {editingInvoicePO && (
        <MarkInvoicedModal
          po={editingInvoicePO}
          existingPOs={orders}
          mode="edit-invoice"
          isSubmitting={busyId === editingInvoicePO.id}
          onCancel={() => setEditingInvoicePO(null)}
          onConfirm={handleSaveInvoiceMeta}
        />
      )}

      {revisingPO && (
        <ReviseDocumentModal
          docType="po"
          po={revisingPO}
          currentActor={currentActor}
          isSubmitting={busyId === revisingPO.id}
          onCancel={() => setRevisingPO(null)}
          onConfirm={handleConfirmRevise}
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
