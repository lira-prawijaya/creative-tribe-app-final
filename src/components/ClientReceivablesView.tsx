import React, { useMemo, useState } from 'react';
import { AlertTriangle, Eye, RotateCcw, Search } from 'lucide-react';
import {
  BossReportColorStatus,
  BossReportMonthData,
  BossReportRescheduledItem,
} from '../types/bossReport';
import { ClientInvoice } from '../types/clientInvoice';
import { formatMonthShortID, normalizeStatusToColor } from '../types/statusWarna';
import { formatBossMonthFullLabel } from '../utils/bossReportCalc';
import {
  getClientInvoiceEffectiveStatus,
  resolveClientInvoiceNominal,
} from '../utils/clientInvoiceFormat';
import {
  computeDueTunggakanStatus,
  formatIDR,
  formatShortDateID,
  getRemainingDays,
  getTodayISODate,
} from '../utils/format';
import { MarkClientInvoicePaidModal } from './MarkClientInvoicePaidModal';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';

interface ClientReceivablesViewProps {
  invoices: ClientInvoice[];
  bossReportMonths?: Record<string, BossReportMonthData>;
  isLoading: boolean;
  canEdit?: boolean;
  onViewInvoice: (invoice: ClientInvoice) => void;
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
}

export const ClientReceivablesView: React.FC<ClientReceivablesViewProps> = ({
  invoices,
  bossReportMonths = {},
  isLoading,
  canEdit = true,
  onViewInvoice,
  onMarkPaid,
  onChangeStatusWarna,
  onRescheduledCopyAction,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'All' | 'Overdue' | 'DueSoon' | 'Reschedule'>('All');
  const [payingInvoice, setPayingInvoice] = useState<ClientInvoice | null>(null);
  const [rescheduleInvoice, setRescheduleInvoice] = useState<ClientInvoice | null>(null);
  const [rescheduleCopyTarget, setRescheduleCopyTarget] = useState<{
    monthKey: string;
    item: BossReportRescheduledItem;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const receivables = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (inv.isDeleted || inv.isVoided) return false;
        const eff = getClientInvoiceEffectiveStatus(inv);
        return eff === 'Unpaid' || eff === 'Overdue' || eff === 'Reschedule';
      })
      .map((inv) => {
        const eff = getClientInvoiceEffectiveStatus(inv);
        const remainingDays = inv.dueDate ? getRemainingDays(inv.dueDate) : null;
        return { inv, eff, remainingDays };
      })
      .sort((a, b) => (a.inv.dueDate || '9999').localeCompare(b.inv.dueDate || '9999'));
  }, [invoices]);

  const rescheduledCopies = useMemo(() => {
    const seen = new Set<string>();
    const results: Array<{ monthKey: string; item: BossReportRescheduledItem }> = [];
    for (const [mk, mData] of Object.entries(bossReportMonths)) {
      for (const item of mData.rescheduledIn ?? []) {
        if (item.section !== 'cashIn' || item.sourceCategory !== 'clientInvoice') continue;
        if (item.color === 'green') continue;
        const dedupKey = `${mk}:${item.id}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        results.push({ monthKey: mk, item });
      }
    }
    return results.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [bossReportMonths]);

  const summary = useMemo(() => {
    let totalReceivable = 0;
    let totalCount = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    let dueSoonAmount = 0;
    let dueSoonCount = 0;

    for (const { inv, eff, remainingDays } of receivables) {
      if (eff === 'Reschedule') {
        continue;
      }
      const amt = resolveClientInvoiceNominal(inv);
      totalReceivable += amt;
      totalCount += 1;
      if (eff === 'Overdue') {
        overdueAmount += amt;
        overdueCount += 1;
      } else if (remainingDays !== null && remainingDays >= 0 && remainingDays <= 14) {
        dueSoonAmount += amt;
        dueSoonCount += 1;
      }
    }

    for (const { item } of rescheduledCopies) {
      if (item.color === 'red') continue;
      totalReceivable += Number(item.amount) || 0;
      totalCount += 1;
    }

    return {
      totalCount,
      totalReceivable,
      overdueAmount,
      overdueCount,
      dueSoonAmount,
      dueSoonCount,
    };
  }, [receivables, rescheduledCopies]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return receivables.filter(({ inv, eff, remainingDays }) => {
      if (filterMode === 'Overdue' && eff !== 'Overdue') return false;
      if (filterMode === 'Reschedule' && eff !== 'Reschedule') return false;
      if (
        filterMode === 'DueSoon' &&
        (eff === 'Reschedule' || remainingDays === null || remainingDays < 0 || remainingDays > 14)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.clientName.toLowerCase().includes(q) ||
        inv.projectName.toLowerCase().includes(q)
      );
    });
  }, [receivables, searchQuery, filterMode]);

  const filteredCopies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rescheduledCopies.filter(({ item }) => {
      if (filterMode === 'Overdue' || filterMode === 'DueSoon') return false;
      if (filterMode === 'Reschedule' && item.color !== 'red') return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rescheduledCopies, searchQuery, filterMode]);

  const handleConfirmPaid = async (paidDate: string) => {
    if (!payingInvoice) return;
    setActionError(null);
    setBusyId(payingInvoice.id);
    try {
      await onMarkPaid(payingInvoice.id, paidDate);
      setPayingInvoice(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menandai Paid.');
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
        setActionError(err instanceof Error ? err.message : 'Gagal memindahkan Salinan Pending.');
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
      setActionError(err instanceof Error ? err.message : 'Gagal memindahkan Invoice Client.');
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

  return (
    <div className="space-y-5">
      {actionError && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-2"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold hover:underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Piutang Client</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            Rp {formatIDR(summary.totalReceivable)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{summary.totalCount} invoice menunggu bayar</p>
        </div>

        <div className="bg-white border border-red-200 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
              Piutang Overdue
            </p>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-red-700 mt-1.5">
            Rp {formatIDR(summary.overdueAmount)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{summary.overdueCount} invoice melewati jatuh tempo</p>
        </div>

        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
            Jatuh Tempo ≤ 14 Hari
          </p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-amber-800 mt-1.5">
            Rp {formatIDR(summary.dueSoonAmount)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{summary.dueSoonCount} invoice segera jatuh tempo</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari No. Invoice, Client, atau Project..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'All' as const, label: 'Semua Piutang' },
              { id: 'Overdue' as const, label: 'Overdue' },
              { id: 'DueSoon' as const, label: 'Jatuh Tempo ≤ 14 Hari' },
              { id: 'Reschedule' as const, label: 'Pending' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterMode === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 && filteredCopies.length === 0 ? (
          <div className="py-12 px-6 text-center text-xs text-slate-500">
            Tidak ada piutang Client yang belum dibayar pada filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">No. Invoice</th>
                  <th className="py-3 px-4">Client &amp; Project</th>
                  <th className="py-3 px-4 whitespace-nowrap">Jatuh Tempo</th>
                  <th className="py-3 px-4 whitespace-nowrap">Sisa Hari</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Nominal Tagihan</th>
                  <th className="py-3 px-4 whitespace-nowrap">Status</th>
                  <th className="py-3 px-4 whitespace-nowrap">Status Warna</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map(({ inv, eff, remainingDays }) => {
                  const rowColor = normalizeStatusToColor(inv.status, inv.statusWarna);
                  const isPending = eff === 'Reschedule';
                  return (
                    <tr
                      key={inv.id}
                      className={
                        isPending
                          ? 'bg-slate-100/80 text-slate-400 opacity-80 transition-colors'
                          : eff === 'Overdue'
                          ? 'bg-red-50/70 hover:bg-red-100/60 transition-colors'
                          : 'hover:bg-slate-50/80 transition-colors'
                      }
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{inv.clientName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{inv.projectName}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        {inv.dueDate ? formatShortDateID(inv.dueDate) : '-'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums whitespace-nowrap">
                        {isPending || remainingDays === null ? (
                          '-'
                        ) : remainingDays < 0 ? (
                          <span className="font-bold text-red-700">
                            Terlambat {Math.abs(remainingDays)} hari
                          </span>
                        ) : remainingDays === 0 ? (
                          <span className="font-bold text-amber-700">Hari ini</span>
                        ) : (
                          <span className="text-slate-700">{remainingDays} hari lagi</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
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
                          `Rp ${formatIDR(resolveClientInvoiceNominal(inv))}`
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-0.5">
                          <span
                            className={`inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded ${
                              isPending
                                ? 'bg-slate-200 text-slate-700 border-slate-300'
                                : eff === 'Overdue'
                                ? 'bg-red-100 text-red-800 border-red-300'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {isPending
                              ? inv.rescheduledToMonth
                                ? `DIPENDING KE ${formatBossMonthFullLabel(inv.rescheduledToMonth)}`
                                : 'DIPENDING'
                              : eff.toUpperCase()}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusWarnaDropdown
                            value={rowColor}
                            disabled={!canEdit || busyId === inv.id}
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
                          {isPending && onChangeStatusWarna && canEdit && (
                            <button
                              type="button"
                              disabled={busyId === inv.id}
                              onClick={() => void handleCancelInvoicePending(inv)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Batalkan Pending / Kembalikan
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onViewInvoice(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Lihat
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredCopies.map(({ monthKey: copyMonthKey, item: copy }) => {
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
                      key={`rec-copy-${copyMonthKey}-${copy.id}`}
                      className={
                        isCopyPending
                          ? 'bg-slate-100/80 text-slate-400 opacity-80'
                          : 'bg-amber-50/40 hover:bg-amber-50/70'
                      }
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <div>Salinan Pending</div>
                        {copyDueStatus.isTunggakan ? (
                          <span className="inline-flex mt-0.5 px-1.5 py-0.5 text-[10px] font-sans font-semibold rounded bg-amber-50 text-amber-800 border border-amber-300">
                            {copyDueStatus.statusText}
                          </span>
                        ) : (
                          <span className="inline-flex mt-0.5 px-1.5 py-0.5 text-[10px] font-sans font-semibold rounded bg-slate-100 text-slate-700 border border-slate-300">
                            {copyDueStatus.statusText}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{copy.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Target: {formatBossMonthFullLabel(copyMonthKey)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        {copy.dueISO ? formatShortDateID(copy.dueISO) : '-'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">-</td>
                      <td className="py-3 px-4 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
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
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isCopyPending ? (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded bg-slate-200 text-slate-700 border-slate-300">
                            {copy.rescheduledToMonth
                              ? `DIPENDING KE ${formatBossMonthFullLabel(copy.rescheduledToMonth)}`
                              : 'DIPENDING'}
                          </span>
                        ) : copyDueStatus.isTunggakan ? (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded bg-amber-100 text-amber-800 border-amber-200">
                            {copyDueStatus.lateBadgeText
                              ? `TUNGGAKAN (${copyDueStatus.lateBadgeText})`
                              : 'TUNGGAKAN AKTIF'}
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded bg-slate-100 text-slate-700 border-slate-300">
                            BELUM JATUH TEMPO
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {onRescheduledCopyAction && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusWarnaDropdown
                              value={copy.color}
                              disabled={!canEdit || isCopyBusy}
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
                            {canEdit && (
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
                      <td className="py-3 px-4 text-right text-xs text-slate-400 whitespace-nowrap">
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

      {payingInvoice && (
        <MarkClientInvoicePaidModal
          invoice={payingInvoice}
          isSubmitting={busyId === payingInvoice.id}
          onCancel={() => setPayingInvoice(null)}
          onConfirm={handleConfirmPaid}
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
