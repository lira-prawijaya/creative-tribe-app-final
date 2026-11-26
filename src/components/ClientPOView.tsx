import React, { useMemo, useState } from 'react';
import { FilePlus2, Pencil, Plus, Receipt, Search, Trash2, X } from 'lucide-react';
import { ClientInvoice } from '../types/clientInvoice';
import {
  CLIENT_PO_STATUS_META,
  CLIENT_PO_STATUS_ORDER,
  ClientPOStatus,
  ClientPurchaseOrder,
  ClientPurchaseOrderInput,
} from '../types/clientPO';
import { formatDocumentDate, formatIDR, getTodayISODate } from '../utils/format';
import { RupiahInput } from './RupiahInput';

interface ClientPOViewProps {
  clientPOs: ClientPurchaseOrder[];
  clientInvoices: ClientInvoice[];
  isLoading: boolean;
  canEdit?: boolean;
  canCreateInvoice?: boolean;
  onCreateClientPO: (input: ClientPurchaseOrderInput) => Promise<string>;
  onUpdateClientPO: (id: string, input: ClientPurchaseOrderInput) => Promise<void>;
  onDeleteClientPO: (id: string) => Promise<void>;
  onCreateInvoiceFromPO: (clientPO: ClientPurchaseOrder) => void;
}

interface ProjectClientSummaryRow {
  key: string;
  clientName: string;
  brandName?: string;
  projectName: string;
  projectNumber: string;
  nilaiProject: number;
  sudahDitagih: number;
  sudahCair: number;
  sisaPiutang: number;
  status: ClientPOStatus;
}

export const ClientPOView: React.FC<ClientPOViewProps> = ({
  clientPOs,
  clientInvoices,
  isLoading,
  canEdit = true,
  canCreateInvoice = true,
  onCreateClientPO,
  onUpdateClientPO,
  onDeleteClientPO,
  onCreateInvoiceFromPO,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ClientPOStatus>('All');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<ClientPurchaseOrder | null>(null);

  const today = getTodayISODate();
  const [clientPoNumber, setClientPoNumber] = useState('');
  const [poDate, setPoDate] = useState(today);
  const [clientName, setClientName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [targetBillingDate, setTargetBillingDate] = useState('');
  const [status, setStatus] = useState<ClientPOStatus>('Draft PO');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const invoiceStatsByPoNumber = useMemo(() => {
    const map = new Map<string, { billed: number; paid: number }>();
    for (const inv of clientInvoices) {
      if (inv.isDeleted || inv.isVoided || inv.status === 'Draft') continue;
      const key = (inv.poNumber ?? '').trim().toLowerCase();
      if (!key) continue;
      const prev = map.get(key) ?? { billed: 0, paid: 0 };
      const val = inv.totalAmount ?? inv.subtotalAmount ?? 0;
      prev.billed += val;
      if (inv.status === 'Paid') prev.paid += val;
      map.set(key, prev);
    }
    return map;
  }, [clientInvoices]);

  // Grouped Client/Project Summary Table per Part 6a
  const projectSummaryRows = useMemo<ProjectClientSummaryRow[]>(() => {
    const map = new Map<
      string,
      {
        clientName: string;
        brandName?: string;
        projectName: string;
        projectNumber: string;
        nilaiProject: number;
        sudahDitagih: number;
        sudahCair: number;
        statuses: Set<ClientPOStatus>;
      }
    >();

    const getKey = (projNo: string, cName: string, pName: string) => {
      const cleanNo = projNo.trim().toLowerCase();
      return cleanNo ? `p_${cleanNo}` : `${cName.trim().toLowerCase()}__${pName.trim().toLowerCase()}`;
    };

    for (const po of clientPOs) {
      const key = getKey(po.projectNumber, po.clientName, po.projectName);
      const entry = map.get(key) ?? {
        clientName: po.clientName,
        brandName: po.brandName,
        projectName: po.projectName,
        projectNumber: po.projectNumber,
        nilaiProject: 0,
        sudahDitagih: 0,
        sudahCair: 0,
        statuses: new Set<ClientPOStatus>(),
      };
      entry.nilaiProject += po.amount || 0;
      entry.statuses.add(po.status);
      map.set(key, entry);
    }

    for (const inv of clientInvoices) {
      if (inv.isDeleted || inv.isVoided || inv.status === 'Draft') continue;
      const key = getKey(inv.projectNumber || '', inv.clientName, inv.projectName);
      const entry = map.get(key) ?? {
        clientName: inv.clientName,
        projectName: inv.projectName,
        projectNumber: inv.projectNumber || '-',
        nilaiProject: inv.totalAmount || 0,
        sudahDitagih: 0,
        sudahCair: 0,
        statuses: new Set<ClientPOStatus>(),
      };
      const invTotal = inv.totalAmount || 0;
      entry.sudahDitagih += invTotal;
      if (inv.status === 'Paid') {
        entry.sudahCair += invTotal;
      }
      map.set(key, entry);
    }

    const result: ProjectClientSummaryRow[] = [];
    for (const [key, item] of map.entries()) {
      const sisaPiutang = Math.max(0, item.sudahDitagih - item.sudahCair);
      let derivedStatus: ClientPOStatus = 'Draft PO';
      if (item.sudahDitagih > 0 && sisaPiutang === 0 && item.sudahCair >= item.nilaiProject) {
        derivedStatus = 'Sudah Cair';
      } else if (item.sudahDitagih > 0 || item.statuses.has('Sudah Ditagih')) {
        derivedStatus = sisaPiutang === 0 && item.sudahCair > 0 ? 'Sudah Cair' : 'Sudah Ditagih';
      } else if (item.statuses.has('PO Terkirim')) {
        derivedStatus = 'PO Terkirim';
      } else if (item.statuses.has('Sudah Cair')) {
        derivedStatus = 'Sudah Cair';
      }
      result.push({
        key,
        clientName: item.clientName,
        brandName: item.brandName,
        projectName: item.projectName,
        projectNumber: item.projectNumber,
        nilaiProject: item.nilaiProject,
        sudahDitagih: item.sudahDitagih,
        sudahCair: item.sudahCair,
        sisaPiutang,
        status: derivedStatus,
      });
    }
    return result.sort((a, b) => a.clientName.localeCompare(b.clientName, 'id'));
  }, [clientPOs, clientInvoices]);

  const summary = useMemo(() => {
    let totalAmount = 0;
    let totalBilled = 0;
    let unbilledCount = 0;
    for (const po of clientPOs) {
      totalAmount += po.amount;
      const stats = invoiceStatsByPoNumber.get(po.clientPoNumber.trim().toLowerCase());
      totalBilled += stats?.billed ?? 0;
      if (po.status === 'Draft PO' || po.status === 'PO Terkirim') {
        unbilledCount += 1;
      }
    }
    return {
      totalCount: clientPOs.length,
      totalAmount,
      totalBilled,
      unbilledCount,
    };
  }, [clientPOs, invoiceStatsByPoNumber]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return clientPOs.filter((po) => {
      if (statusFilter !== 'All' && po.status !== statusFilter) return false;
      if (!q) return true;
      return (
        po.clientPoNumber.toLowerCase().includes(q) ||
        po.clientName.toLowerCase().includes(q) ||
        (po.brandName ?? '').toLowerCase().includes(q) ||
        po.projectName.toLowerCase().includes(q) ||
        po.projectNumber.toLowerCase().includes(q)
      );
    });
  }, [clientPOs, searchQuery, statusFilter]);

  const openNewForm = () => {
    if (!canEdit) return;
    setEditingItem(null);
    setClientPoNumber('');
    setPoDate(today);
    setClientName('');
    setBrandName('');
    setProjectName('');
    setProjectNumber('');
    setAmount('');
    setTargetBillingDate('');
    setStatus('Draft PO');
    setNotes('');
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (po: ClientPurchaseOrder) => {
    if (!canEdit) return;
    setEditingItem(po);
    setClientPoNumber(po.clientPoNumber);
    setPoDate(po.poDate);
    setClientName(po.clientName);
    setBrandName(po.brandName ?? '');
    setProjectName(po.projectName);
    setProjectNumber(po.projectNumber);
    setAmount(String(po.amount));
    setTargetBillingDate(po.targetBillingDate ?? '');
    setStatus(po.status);
    setNotes(po.notes ?? '');
    setFormError(null);
    setShowForm(true);
  };

  const handleQuickStatusChange = async (
    po: ClientPurchaseOrder,
    nextStatus: ClientPOStatus
  ) => {
    if (!canEdit) return;
    await onUpdateClientPO(po.id, {
      clientPoNumber: po.clientPoNumber,
      poDate: po.poDate,
      clientName: po.clientName,
      brandName: po.brandName,
      projectName: po.projectName,
      projectNumber: po.projectNumber,
      amount: po.amount,
      targetBillingDate: po.targetBillingDate,
      status: nextStatus,
      notes: po.notes,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !clientPoNumber.trim() || !clientName.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload: ClientPurchaseOrderInput = {
        clientPoNumber: clientPoNumber.trim(),
        poDate,
        clientName: clientName.trim(),
        brandName: brandName.trim(),
        projectName: projectName.trim(),
        projectNumber: projectNumber.trim(),
        amount: Number(amount) || 0,
        targetBillingDate: targetBillingDate || '',
        status,
        notes: notes.trim(),
      };
      if (editingItem) {
        await onUpdateClientPO(editingItem.id, payload);
      } else {
        await onCreateClientPO(payload);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Nilai PO Client</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            Rp {formatIDR(summary.totalAmount)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{summary.totalCount} PO Client tercatat</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Sudah Ditagih ke Invoice</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            Rp {formatIDR(summary.totalBilled)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Akumulasi tagihan Client</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">PO Client Belum Ditagih</p>
          <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1.5">
            {summary.unbilledCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">Status Draft PO atau PO Terkirim</p>
        </div>
      </div>

      {/* Ringkasan List Client / Project (Part 6a) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Ringkasan Project Client ({projectSummaryRows.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Akumulasi nilai kontrak PO Client, tagihan terkirim, pencairan (Cash In), dan sisa piutang per project
            </p>
          </div>
        </div>

        {projectSummaryRows.length === 0 ? (
          <div className="py-6 px-5 text-center text-xs text-slate-500">
            Belum ada project client tercatat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Nama Client</th>
                  <th className="py-2.5 px-4">Project</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Nilai Project</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Sudah Ditagih</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Sudah Cair</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Sisa Piutang</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                {projectSummaryRows.map((row) => {
                  const stMeta = CLIENT_PO_STATUS_META[row.status];
                  return (
                    <tr key={row.key} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {row.clientName}
                        {row.brandName ? ` (${row.brandName})` : ''}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {row.projectName}{' '}
                        <span className="font-mono text-xs text-slate-400">
                          #{row.projectNumber}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        Rp {formatIDR(row.nilaiProject)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                        Rp {formatIDR(row.sudahDitagih)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-emerald-700 font-semibold tabular-nums whitespace-nowrap">
                        Rp {formatIDR(row.sudahCair)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-amber-700 font-semibold tabular-nums whitespace-nowrap">
                        Rp {formatIDR(row.sisaPiutang)}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded ${stMeta.badgeClass}`}
                        >
                          {stMeta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add / Edit Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-300 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              {editingItem ? 'Edit PO Client' : 'Catat PO Masuk dari Client'}
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
                Nomor PO Client *
              </label>
              <input
                type="text"
                required
                value={clientPoNumber}
                onChange={(e) => setClientPoNumber(e.target.value)}
                placeholder="Contoh: 3203718075"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tanggal PO *
              </label>
              <input
                type="date"
                required
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Client *
              </label>
              <input
                type="text"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Contoh: PT Frisian Flag Indonesia"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Brand / Divisi
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Contoh: FFI, Gojek"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Project *
              </label>
              <input
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Contoh: Coffee and Tea Campaign"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                No. Project *
              </label>
              <input
                type="text"
                required
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                placeholder="Contoh: 2601002"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nilai Kontrak / PO (Rp, belum PPN) *
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
                Target Tanggal Penagihan
              </label>
              <input
                type="date"
                value={targetBillingDate}
                onChange={(e) => setTargetBillingDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Status Pipeline PO Client
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ClientPOStatus)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {CLIENT_PO_STATUS_ORDER.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
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
              {saving ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Simpan PO Client'}
            </button>
          </div>
        </form>
      )}

      {/* List PO Client */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari No. PO Client, Client, Brand, atau Project..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['All', ...CLIENT_PO_STATUS_ORDER] as const).map((tab) => (
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
                  {tab === 'All' ? 'Semua' : tab}
                </button>
              ))}
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openNewForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Catat PO Client
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900">Belum ada PO Client</p>
            <p className="text-xs text-slate-500">
              Catat PO resmi yang diterima dari Client agar mudah dikonversi ke Invoice Client.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={openNewForm}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Catat PO Client
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">No. PO Client</th>
                  <th className="py-3 px-4 whitespace-nowrap">Tanggal</th>
                  <th className="py-3 px-4">Client &amp; Project</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Nilai PO</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Tertagih</th>
                  <th className="py-3 px-4 whitespace-nowrap">Status</th>
                  {(canEdit || canCreateInvoice) && (
                    <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((po) => {
                  const stats = invoiceStatsByPoNumber.get(
                    po.clientPoNumber.trim().toLowerCase()
                  );
                  const billed = stats?.billed ?? 0;
                  const meta = CLIENT_PO_STATUS_META[po.status];
                  return (
                    <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        {po.clientPoNumber}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {formatDocumentDate(po.poDate)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">
                          {po.clientName}
                          {po.brandName ? ` (${po.brandName})` : ''}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {po.projectName} · #{po.projectNumber}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs sm:text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        Rp {formatIDR(po.amount)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-emerald-700 tabular-nums whitespace-nowrap">
                        Rp {formatIDR(billed)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <select
                          aria-label={`Status PO Client ${po.clientPoNumber}`}
                          value={po.status}
                          disabled={!canEdit}
                          onChange={(e) =>
                            void handleQuickStatusChange(
                              po,
                              e.target.value as ClientPOStatus
                            )
                          }
                          className={`px-2 py-1 text-[11px] font-semibold border rounded ${
                            canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'
                          } ${meta.badgeClass}`}
                        >
                          {CLIENT_PO_STATUS_ORDER.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </td>
                      {(canEdit || canCreateInvoice) && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {canCreateInvoice && (
                              <button
                                type="button"
                                onClick={() => onCreateInvoiceFromPO(po)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors cursor-pointer"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                                Buat Invoice
                              </button>
                            )}
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditForm(po)}
                                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                                  title="Edit"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void onDeleteClientPO(po.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                                  title="Hapus"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
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
    </div>
  );
};
