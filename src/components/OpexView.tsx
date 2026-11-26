import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  getOpexColorForMonth,
  getOpexStatusForMonth,
  isOpexActiveInMonth,
} from '../services/opexService';
import {
  BankAccountRow,
  BossReportColorStatus,
  BossReportMonthData,
  BossReportRescheduledItem,
  OPERASIONAL_TEMPLATE_ITEMS,
} from '../types/bossReport';
import {
  mapOpexStatusToDbFields,
  OPEX_CATEGORIES,
  OpexCategory,
  OpexInput,
  OpexItem,
  OpexPaymentStatus,
  OpexStatusWarna,
} from '../types/opex';
import { formatMonthFullID } from '../types/statusWarna';
import {
  addMonthsToKey,
  formatBossMonthFullLabel,
  getMonthSelectorOptions,
} from '../utils/bossReportCalc';
import { computeDueTunggakanStatus, formatIDR, getTodayISODate } from '../utils/format';
import { RescheduleMonthModal } from './RescheduleMonthModal';
import { RupiahInput } from './RupiahInput';
import { StatusWarnaDropdown } from './StatusWarnaDropdown';

interface OpexViewProps {
  opexItems: OpexItem[];
  bossReportMonths?: Record<string, BossReportMonthData>;
  bankAccounts: BankAccountRow[];
  isLoading: boolean;
  canEdit?: boolean;
  onCreateOpex: (input: OpexInput) => Promise<string>;
  onUpdateOpex: (id: string, input: OpexInput) => Promise<void>;
  onSetMonthStatus: (
    id: string,
    monthKey: string,
    status: OpexPaymentStatus,
    statusWarna?: OpexStatusWarna,
    targetMonthKey?: string
  ) => Promise<void>;
  onRescheduledCopyAction?: (
    monthKey: string,
    rescheduledItemId: string,
    nextColor: BossReportColorStatus,
    targetMonthKey?: string
  ) => Promise<void>;
  onDeleteOpex: (id: string) => Promise<void>;
}

export const OpexView: React.FC<OpexViewProps> = ({
  opexItems,
  bossReportMonths = {},
  bankAccounts,
  isLoading,
  canEdit = true,
  onCreateOpex,
  onUpdateOpex,
  onSetMonthStatus,
  onRescheduledCopyAction,
  onDeleteOpex,
}) => {
  const defaultMonthKey = useMemo(() => getTodayISODate().slice(0, 7), []);
  const [selectedMonthKey, setSelectedMonthKey] = useState(defaultMonthKey);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Not Paid' | 'Paid' | 'Reschedule'>('All');
  const [recurringFilter, setRecurringFilter] = useState<'All' | 'Recurring' | 'OneTime'>('All');

  const defaultAccount = useMemo(
    () => bankAccounts.find((a) => a.isPrimary) ?? bankAccounts[0] ?? null,
    [bankAccounts]
  );

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<OpexItem | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<OpexCategory>('Utilitas & Kantor');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [sourceAccountId, setSourceAccountId] = useState(defaultAccount?.id ?? '');
  const [isRecurring, setIsRecurring] = useState(true);
  const [monthKey, setMonthKey] = useState(defaultMonthKey);
  const [endMonthKey, setEndMonthKey] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<OpexItem | null>(null);
  const [rescheduleCopyTarget, setRescheduleCopyTarget] =
    useState<BossReportRescheduledItem | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const monthOptions = useMemo(
    () => getMonthSelectorOptions(defaultMonthKey),
    [defaultMonthKey]
  );

  const formMonthOptions = useMemo(() => {
    const base = [...monthOptions];
    if (monthKey && !base.some((o) => o.monthKey === monthKey)) {
      base.push({
        monthKey,
        shortLabel: formatBossMonthFullLabel(monthKey),
        fullLabel: formatBossMonthFullLabel(monthKey),
      });
      base.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    }
    return base;
  }, [monthOptions, monthKey]);

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of bankAccounts) {
      map.set(acc.id, acc.name);
    }
    return map;
  }, [bankAccounts]);

  const activeInMonth = useMemo(() => {
    const monthOverrides = bossReportMonths[selectedMonthKey]?.autoOverrides ?? [];
    const overrideMap = new Map(monthOverrides.map((o) => [o.sourceId, o]));
    return opexItems
      .filter((item) => isOpexActiveInMonth(item, selectedMonthKey))
      .map((item) => {
        const ov = overrideMap.get(`opex_${item.id}`);
        let monthStatus = getOpexStatusForMonth(item, selectedMonthKey);
        let monthColor = getOpexColorForMonth(item, selectedMonthKey);
        if (ov?.hasCustomColor) {
          monthColor = ov.color;
          monthStatus =
            ov.color === 'red' ? 'Reschedule' : ov.color === 'green' ? 'Paid' : 'Not Paid';
        }
        const pendingToMonth =
          monthColor === 'red'
            ? item.rescheduledMonths?.[selectedMonthKey] ||
              ov?.rescheduledToMonth ||
              (item.rescheduledFromMonth === selectedMonthKey ? item.rescheduledToMonth : undefined) ||
              addMonthsToKey(selectedMonthKey, 1)
            : undefined;
        return {
          item,
          monthStatus,
          monthColor,
          pendingToMonth,
        };
      });
  }, [opexItems, bossReportMonths, selectedMonthKey]);

  const rescheduledCopiesInMonth = useMemo(() => {
    const raw = bossReportMonths[selectedMonthKey]?.rescheduledIn ?? [];
    const seen = new Set<string>();
    const out: Array<{
      copy: BossReportRescheduledItem;
      linkedOpex: OpexItem | undefined;
    }> = [];
    for (const rs of raw) {
      if (rs.section !== 'operasional' || rs.sourceCategory !== 'opex') continue;
      const dedupKey = `${rs.id}::${rs.originMonthKey}::${rs.fromMonthKey}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const opexId = rs.sourceId.replace(/^opex_/, '');
      const linkedOpex = opexItems.find((o) => o.id === opexId);
      out.push({ copy: rs, linkedOpex });
    }
    return out;
  }, [bossReportMonths, selectedMonthKey, opexItems]);

  const summary = useMemo(() => {
    let total = 0;
    let paid = 0;
    let unpaid = 0;
    let recurringCount = 0;
    let activeCount = 0;
    for (const { item, monthStatus, monthColor } of activeInMonth) {
      if (item.isRecurring) recurringCount += 1;
      if (monthColor === 'red' || monthStatus === 'Reschedule') {
        // Pending tidak dihitung di bulan ini, hanya tampil sebagai histori redup
        continue;
      }
      activeCount += 1;
      total += item.amount;
      if (monthStatus === 'Paid') paid += item.amount;
      else unpaid += item.amount;
    }
    for (const { copy } of rescheduledCopiesInMonth) {
      if (copy.color === 'red') continue;
      activeCount += 1;
      total += copy.amount;
      if (copy.color === 'green') paid += copy.amount;
      else unpaid += copy.amount;
    }
    return {
      count: activeCount,
      total,
      paid,
      unpaid,
      recurringCount,
    };
  }, [activeInMonth, rescheduledCopiesInMonth]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeInMonth.filter(({ item, monthStatus }) => {
      if (statusFilter !== 'All' && monthStatus !== statusFilter) return false;
      if (recurringFilter === 'Recurring' && !item.isRecurring) return false;
      if (recurringFilter === 'OneTime' && item.isRecurring) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.sourceAccountName ?? '').toLowerCase().includes(q) ||
        (item.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [activeInMonth, searchQuery, statusFilter, recurringFilter]);

  const filteredCopies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rescheduledCopiesInMonth.filter(({ copy, linkedOpex }) => {
      const copyStatus: OpexPaymentStatus =
        copy.color === 'green'
          ? 'Paid'
          : copy.color === 'red'
          ? 'Reschedule'
          : 'Not Paid';
      if (statusFilter !== 'All' && copyStatus !== statusFilter) return false;
      if (recurringFilter === 'Recurring' && linkedOpex && !linkedOpex.isRecurring) return false;
      if (recurringFilter === 'OneTime' && linkedOpex?.isRecurring) return false;
      if (!q) return true;
      return (
        copy.name.toLowerCase().includes(q) ||
        (linkedOpex?.category ?? '').toLowerCase().includes(q) ||
        (linkedOpex?.sourceAccountName ?? '').toLowerCase().includes(q)
      );
    });
  }, [rescheduledCopiesInMonth, searchQuery, statusFilter, recurringFilter]);

  const openNewForm = () => {
    if (!canEdit) return;
    setEditingItem(null);
    setName('');
    setCategory('Utilitas & Kantor');
    setAmount('');
    setDueDay('');
    setSourceAccountId(defaultAccount?.id ?? '');
    setIsRecurring(true);
    setMonthKey(selectedMonthKey);
    setEndMonthKey('');
    setNotes('');
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (item: OpexItem) => {
    if (!canEdit) return;
    setEditingItem(item);
    setName(item.name);
    setCategory(item.category);
    setAmount(String(item.amount));
    setDueDay(item.dueDay ? String(item.dueDay) : '');
    const matchedAcc =
      (item.sourceAccountId && accountNameById.has(item.sourceAccountId)
        ? item.sourceAccountId
        : bankAccounts.find(
            (a) =>
              a.name.trim().toLowerCase() ===
              (item.sourceAccountName ?? '').trim().toLowerCase()
          )?.id) ??
      defaultAccount?.id ??
      '';
    setSourceAccountId(matchedAcc);
    setIsRecurring(item.isRecurring);
    setMonthKey(item.monthKey);
    setEndMonthKey(item.endMonthKey ?? '');
    setNotes(item.notes ?? '');
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const selectedAcc = bankAccounts.find((a) => a.id === sourceAccountId);
      const existingDbFields = editingItem
        ? mapOpexStatusToDbFields(editingItem.status, editingItem.statusWarna)
        : { dbStatus: 'Not Paid' as const, dbWarna: 'PUTIH' as const };

      const payload: OpexInput = {
        name: name.trim(),
        category,
        amount: Number(amount) || 0,
        monthKey: monthKey || selectedMonthKey,
        endMonthKey: isRecurring && endMonthKey ? endMonthKey : undefined,
        dueDay: dueDay ? Number(dueDay) : undefined,
        sourceAccountId: selectedAcc?.id || undefined,
        sourceAccountName: selectedAcc?.name || undefined,
        isRecurring,
        status: existingDbFields.dbStatus,
        statusWarna: existingDbFields.dbWarna,
        ...(editingItem?.rescheduledFromMonth
          ? { rescheduledFromMonth: editingItem.rescheduledFromMonth }
          : {}),
        ...(editingItem?.rescheduledToMonth
          ? { rescheduledToMonth: editingItem.rescheduledToMonth }
          : {}),
        ...(editingItem?.rescheduledMonths
          ? { rescheduledMonths: editingItem.rescheduledMonths }
          : {}),
        monthStatuses: editingItem?.monthStatuses ?? {},
        paidDates: editingItem?.paidDates ?? {},
        notes: notes.trim(),
      };

      if (editingItem) {
        await onUpdateOpex(editingItem.id, payload);
        showToast('success', `Biaya Opex "${payload.name}" berhasil diperbarui.`);
      } else {
        await onCreateOpex(payload);
        showToast(
          'success',
          `Biaya Opex "${payload.name}" (${formatBossMonthFullLabel(payload.monthKey)}) berhasil disimpan.`
        );
      }
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg);
      showToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRow = async (item: OpexItem) => {
    if (!canEdit || busyId) return;
    setActionError(null);
    setBusyId(item.id);
    try {
      await onDeleteOpex(item.id);
      showToast('success', `Biaya Opex "${item.name}" berhasil dihapus.`);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Gagal menghapus data Opex (${item.id}).`;
      setActionError(msg);
      showToast('error', msg);
    } finally {
      setBusyId(null);
    }
  };

  const handleInsertRutinTemplate = async () => {
    if (!canEdit) return;
    const existingNames = new Set(opexItems.map((it) => it.name.toLowerCase()));
    const toAdd = OPERASIONAL_TEMPLATE_ITEMS.filter(
      (tpl) => !existingNames.has(tpl.toLowerCase())
    );
    const opAcc =
      bankAccounts.find((a) => a.name.toLowerCase().includes('operasional')) ??
      defaultAccount;
    for (const tpl of toAdd) {
      const cat: OpexCategory =
        tpl.toLowerCase().includes('gaji')
          ? 'Gaji & SDM'
          : tpl.toLowerCase().includes('ppn') || tpl.toLowerCase().includes('iuran')
          ? 'Pajak & Iuran'
          : tpl.toLowerCase().includes('konsultan')
          ? 'Konsultan & Jasa'
          : 'Utilitas & Kantor';
      await onCreateOpex({
        name: tpl,
        category: cat,
        amount: 0,
        monthKey: selectedMonthKey,
        sourceAccountId: opAcc?.id,
        sourceAccountName: opAcc?.name,
        isRecurring: true,
        status: 'Not Paid',
        statusWarna: 'PUTIH',
        monthStatuses: {},
        paidDates: {},
      });
    }
  };

  const handleSelectRowStatus = async (item: OpexItem, nextColor: 'green' | 'red') => {
    if (!canEdit) return;
    if (nextColor === 'red') {
      setRescheduleTarget(item);
      return;
    }
    setActionError(null);
    setBusyId(item.id);
    try {
      await onSetMonthStatus(item.id, selectedMonthKey, 'Paid', 'HIJAU');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal memperbarui status Opex.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelPending = async (item: OpexItem) => {
    if (!canEdit) return;
    setActionError(null);
    setBusyId(item.id);
    try {
      await onSetMonthStatus(item.id, selectedMonthKey, 'Not Paid', 'PUTIH');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal membatalkan Pending Opex.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSelectCopyStatus = async (
    copy: BossReportRescheduledItem,
    nextColor: BossReportColorStatus,
    targetMonthKey?: string
  ) => {
    if (!canEdit || !onRescheduledCopyAction) return;
    if (nextColor === 'red' && !targetMonthKey) {
      setRescheduleCopyTarget(copy);
      return;
    }
    setActionError(null);
    setBusyId(copy.id);
    try {
      await onRescheduledCopyAction(selectedMonthKey, copy.id, nextColor, targetMonthKey);
      if (targetMonthKey) {
        setRescheduleCopyTarget(null);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal memperbarui status tunggakan Opex.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmReschedule = async (targetMonthKey: string) => {
    if (rescheduleCopyTarget) {
      await handleSelectCopyStatus(rescheduleCopyTarget, 'red', targetMonthKey);
      return;
    }
    if (!rescheduleTarget) return;
    setActionError(null);
    setBusyId(rescheduleTarget.id);
    try {
      await onSetMonthStatus(
        rescheduleTarget.id,
        selectedMonthKey,
        'Reschedule',
        'MERAH',
        targetMonthKey
      );
      setRescheduleTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal memindahkan biaya Opex.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Month Selector & Primary Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-slate-600">Periode Opex:</span>
          <div className="inline-flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setSelectedMonthKey(addMonthsToKey(selectedMonthKey, -1))}
              className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 border-r border-slate-200 cursor-pointer"
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={selectedMonthKey}
              onChange={(e) => setSelectedMonthKey(e.target.value)}
              aria-label="Pilih bulan Opex"
              className="px-3 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white focus:outline-none cursor-pointer"
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
              className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 border-l border-slate-200 cursor-pointer"
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <span className="text-xs text-slate-500">
            Otomatis masuk ke Projection · Cash Out Operasional per rekening sumber
          </span>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleInsertRutinTemplate()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Repeat className="w-3.5 h-3.5" />
              Isi Template Rutin KKB
            </button>
            <button
              type="button"
              onClick={openNewForm}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Biaya Opex
            </button>
          </div>
        )}
      </div>

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

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">
            Total Opex {formatBossMonthFullLabel(selectedMonthKey)}
          </p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            Rp {formatIDR(summary.total)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{summary.count} item operasional</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Paid</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            Rp {formatIDR(summary.paid)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Realisasi terbayar bulan ini</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Projection / Sisa Kewajiban</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1.5">
            Rp {formatIDR(summary.unpaid)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Kewajiban operasional tersisa</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Biaya Recurring</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {summary.recurringCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">Otomatis berulang tiap bulan</p>
        </div>
      </div>

      {/* Add / Edit Form Panel */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-300 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              {editingItem ? 'Edit Biaya Operasional' : 'Tambah Biaya Operasional Baru'}
            </h2>
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Biaya *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Gaji Tim, Listrik IDPEL, Internet"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Kategori
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as OpexCategory)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {OPEX_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nominal (Rp) *
              </label>
              <div className="relative">
                <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  required
                  value={amount}
                  onValueChange={setAmount}
                  placeholder="0"
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tanggal Jatuh Tempo (Tgl 1–31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                placeholder="Contoh: 25"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Rekening Sumber
              </label>
              <select
                value={sourceAccountId}
                onChange={(e) => setSourceAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Status Awal
              </span>
              <div className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-700">
                {editingItem
                  ? `Status mengikuti Status baris (${formatBossMonthFullLabel(selectedMonthKey)})`
                  : 'Default: Projection'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Recurring (Berulang Tiap Bulan)
              </label>
              <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 w-full">
                <button
                  type="button"
                  onClick={() => setIsRecurring(true)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    isRecurring
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ya
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecurring(false)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    !isRecurring
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tidak
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isRecurring ? 'Periode Opex (Mulai Bulan)' : 'Periode Opex *'}
              </label>
              <select
                value={monthKey}
                onChange={(e) => setMonthKey(e.target.value)}
                aria-label="Dropdown Periode Opex"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {formMonthOptions.map((opt) => (
                  <option key={opt.monthKey} value={opt.monthKey}>
                    {opt.fullLabel}
                  </option>
                ))}
              </select>
            </div>

            {isRecurring ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sampai Bulan (Opsional)
                </label>
                <select
                  value={endMonthKey}
                  onChange={(e) => setEndMonthKey(e.target.value)}
                  aria-label="Sampai bulan"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">Berlanjut (Tanpa Batas)</option>
                  {formMonthOptions.map((opt) => (
                    <option key={opt.monthKey} value={opt.monthKey}>
                      {opt.fullLabel}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Keterangan tambahan (opsional)"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            )}
          </div>

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
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              {saving ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Simpan Biaya Opex'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Toolbar & Opex Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama biaya, kategori, atau rekening sumber..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['All', 'Not Paid', 'Paid', 'Reschedule'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === tab
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'All'
                    ? 'Semua Status'
                    : tab === 'Not Paid'
                    ? 'Projection'
                    : tab === 'Reschedule'
                    ? 'Pending'
                    : tab}
                </button>
              ))}
            </div>

            <select
              value={recurringFilter}
              onChange={(e) =>
                setRecurringFilter(e.target.value as 'All' | 'Recurring' | 'OneTime')
              }
              aria-label="Filter recurring"
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="All">Semua Tipe</option>
              <option value="Recurring">Recurring: Ya</option>
              <option value="OneTime">Recurring: Tidak</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredRows.length === 0 && filteredCopies.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900">
              Belum ada biaya operasional di {formatBossMonthFullLabel(selectedMonthKey)}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Tambahkan biaya operasional bulanan atau isi daftar rutin KKB. Semua item aktif otomatis terhubung ke Cash Out Operasional sesuai rekening sumbernya.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={openNewForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah Biaya Opex
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Nama Biaya</th>
                  <th className="py-3 px-4 whitespace-nowrap">Kategori</th>
                  <th className="py-3 px-4 whitespace-nowrap">Rekening Sumber</th>
                  <th className="py-3 px-4 whitespace-nowrap">Jatuh Tempo</th>
                  <th className="py-3 px-4 whitespace-nowrap">Recurring</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Nominal</th>
                  <th className="py-3 px-4 whitespace-nowrap">Status Warna</th>
                  {canEdit && (
                    <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredRows.map(({ item, monthStatus, monthColor, pendingToMonth }) => {
                  const paidDate = item.paidDates?.[selectedMonthKey];
                  const isBusy = busyId === item.id;
                  const isPending = monthColor === 'red' || monthStatus === 'Reschedule';
                  const accountDisplay =
                    (item.sourceAccountId && accountNameById.get(item.sourceAccountId)) ||
                    item.sourceAccountName ||
                    defaultAccount?.name ||
                    'Rekening Utama';
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isPending
                          ? 'bg-slate-100/80 text-slate-400 opacity-80'
                          : monthColor === 'green'
                          ? 'bg-emerald-50/60 hover:bg-emerald-50'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className={`font-medium ${isPending ? 'text-slate-500' : 'text-slate-900'}`}>
                          {item.name}
                        </div>
                        {isPending && pendingToMonth && (
                          <span className="inline-flex items-center mt-1 px-2 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-700 border border-slate-300 rounded">
                            DIPENDING KE {formatBossMonthFullLabel(pendingToMonth)}
                          </span>
                        )}
                        {item.notes && (
                          <div className="text-xs text-slate-500 mt-0.5">{item.notes}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 max-w-[200px] truncate">
                        {accountDisplay}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {item.dueDay ? `Setiap tgl ${item.dueDay}` : 'Bulanan'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded ${
                            item.isRecurring
                              ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {item.isRecurring ? 'Ya' : 'Tidak'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs sm:text-sm font-semibold tabular-nums whitespace-nowrap">
                        {isPending ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="inline-flex items-center gap-1.5">
                              <span className="line-through text-slate-400">
                                Rp {formatIDR(item.amount)}
                              </span>
                              <span className="text-slate-500">Rp 0</span>
                            </div>
                            <span className="font-sans text-[10px] font-medium text-slate-500">
                              Tidak dihitung di bulan ini
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-900">Rp {formatIDR(item.amount)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusWarnaDropdown
                            value={monthColor}
                            disabled={isBusy || !canEdit}
                            ariaLabel={`Status warna ${item.name}`}
                            onSelect={(nextColor) => void handleSelectRowStatus(item, nextColor)}
                          />
                          {isPending && canEdit && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleCancelPending(item)}
                              title="Batalkan Pending dan kembalikan item ke periode ini"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3 shrink-0" />
                              Batalkan Pending / Kembalikan
                            </button>
                          )}
                          {paidDate && monthStatus === 'Paid' && (
                            <span className="text-[11px] text-slate-500 tabular-nums">
                              {paidDate}
                            </span>
                          )}
                        </div>
                      </td>
                      {canEdit && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => openEditForm(item)}
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer disabled:opacity-50"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDeleteRow(item)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer disabled:opacity-50"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredCopies.map(({ copy, linkedOpex }) => {
                  const isBusy = busyId === copy.id;
                  const isPending = copy.color === 'red';
                  const copyPendingTo =
                    copy.rescheduledToMonth || addMonthsToKey(selectedMonthKey, 1);
                  const copyDueStatus = computeDueTunggakanStatus({
                    dueISO: copy.dueISO,
                    originMonthKey: copy.originMonthKey,
                    isPaid: copy.color === 'green',
                  });
                  const accountDisplay =
                    (copy.accountId && accountNameById.get(copy.accountId)) ||
                    (linkedOpex?.sourceAccountId &&
                      accountNameById.get(linkedOpex.sourceAccountId)) ||
                    linkedOpex?.sourceAccountName ||
                    defaultAccount?.name ||
                    'Rekening Utama';
                  return (
                    <tr
                      key={`copy-${copy.id}`}
                      className={`transition-colors ${
                        isPending
                          ? 'bg-slate-100/80 text-slate-400 opacity-80'
                          : copy.color === 'green'
                          ? 'bg-emerald-50/60 hover:bg-emerald-50'
                          : 'bg-amber-50/30 hover:bg-amber-50/60'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className={`font-medium ${isPending ? 'text-slate-500' : 'text-slate-900'}`}>
                          {copy.name}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {copyDueStatus.isTunggakan ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                              {copyDueStatus.statusText}
                            </span>
                          ) : copy.color !== 'green' ? (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 rounded">
                              {copyDueStatus.statusText}
                            </span>
                          ) : null}
                          {isPending && (
                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold bg-slate-200 text-slate-700 border border-slate-300 rounded">
                              DIPENDING KE {formatBossMonthFullLabel(copyPendingTo)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {linkedOpex?.category ?? 'Operasional'}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 max-w-[200px] truncate">
                        {accountDisplay}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {copyDueStatus.isTunggakan ? 'Tunggakan' : 'Belum Jatuh Tempo'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded bg-amber-50 text-amber-800 border-amber-200">
                          Salinan Pending
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs sm:text-sm font-semibold tabular-nums whitespace-nowrap">
                        {isPending ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="inline-flex items-center gap-1.5">
                              <span className="line-through text-slate-400">
                                Rp {formatIDR(copy.amount)}
                              </span>
                              <span className="text-slate-500">Rp 0</span>
                            </div>
                            <span className="font-sans text-[10px] font-medium text-slate-500">
                              Tidak dihitung di bulan ini
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-900">Rp {formatIDR(copy.amount)}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusWarnaDropdown
                            value={copy.color}
                            disabled={isBusy || !canEdit || !onRescheduledCopyAction}
                            ariaLabel={`Status warna tunggakan ${copy.name}`}
                            onSelect={(nextColor) => void handleSelectCopyStatus(copy, nextColor)}
                          />
                          {isPending && canEdit && onRescheduledCopyAction && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleSelectCopyStatus(copy, 'white')}
                              title="Batalkan Pending tunggakan ini"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3 shrink-0" />
                              Batalkan Pending / Kembalikan
                            </button>
                          )}
                        </div>
                      </td>
                      {canEdit && (
                        <td className="py-3 px-4 text-right whitespace-nowrap text-[11px] text-slate-400">
                          -
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RescheduleMonthModal
        isOpen={Boolean(rescheduleTarget || rescheduleCopyTarget)}
        itemName={rescheduleCopyTarget?.name ?? rescheduleTarget?.name ?? ''}
        amount={rescheduleCopyTarget?.amount ?? rescheduleTarget?.amount ?? 0}
        originMonthKey={selectedMonthKey}
        initialTargetMonthKey={
          rescheduleCopyTarget?.rescheduledToMonth ?? rescheduleTarget?.rescheduledToMonth
        }
        isSaving={Boolean(
          (rescheduleTarget && busyId === rescheduleTarget.id) ||
            (rescheduleCopyTarget && busyId === rescheduleCopyTarget.id)
        )}
        onCancel={() => {
          setRescheduleTarget(null);
          setRescheduleCopyTarget(null);
        }}
        onConfirm={handleConfirmReschedule}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center justify-between gap-3 ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-300 text-red-900'
              : 'bg-slate-900 border-slate-800 text-white'
          }`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-75 hover:opacity-100 cursor-pointer shrink-0"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
