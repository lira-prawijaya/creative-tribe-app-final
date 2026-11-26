import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  History,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { AuditEntityType, AuditLogEntry } from '../types/auth';
import { ClientInvoice } from '../types/clientInvoice';
import { ClientPurchaseOrder } from '../types/clientPO';
import { InvestmentAsset } from '../types/investment';
import { OpexItem } from '../types/opex';
import { PurchaseOrder } from '../types/po';
import { resolveClientInvoiceNominal } from '../utils/clientInvoiceFormat';
import { formatIDR, getVendorPOEffectiveCostAmount } from '../utils/format';

interface ActivityLogViewProps {
  logs: AuditLogEntry[];
  orders?: PurchaseOrder[];
  clientInvoices?: ClientInvoice[];
  clientPOs?: ClientPurchaseOrder[];
  opexItems?: OpexItem[];
  investments?: InvestmentAsset[];
  isSuperAdmin?: boolean;
  onDeleteSelectedLogs?: (ids: string[]) => Promise<void>;
  onDeleteAllLogs?: (reason: string) => Promise<void>;
}

const ENTITY_BADGE_MAP: Record<
  AuditEntityType,
  { label: string; badgeClass: string }
> = {
  PO: { label: 'PO Vendor', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  CLIENT_INVOICE: {
    label: 'Invoice Client',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  CLIENT_PO: {
    label: 'PO Client',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  OPEX: {
    label: 'Opex',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
  },
  INVESTMENT: {
    label: 'Investment',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  USER: { label: 'User', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200' },
  ROLE: { label: 'Role', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  REPORT: { label: 'Laporan', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' },
  AUTH: { label: 'Login', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const ACTION_LABEL_MAP: Record<string, string> = {
  CREATE_PO: 'Membuat PO Vendor',
  EDIT_PO: 'Mengedit PO Vendor',
  MARK_INVOICED: 'Input Invoice Vendor',
  SUBMIT_PPH_PO: 'Submit PPh Invoice Vendor',
  MARK_PAID_PO: 'Pelunasan PO Vendor',
  CANCEL_PO_INVOICE: 'Batalkan Tagihan PO Vendor',
  CANCEL_PO_PAID: 'Batalkan Lunas PO Vendor',
  UPDATE_PO_STATUS: 'Ubah Status PO Vendor',
  REVISE_PO: 'Revisi PO Vendor',
  SOFT_DELETE_PO: 'Hapus PO Vendor',
  RESTORE_PO: 'Pulihkan PO Vendor',
  PERMANENT_DELETE_PO: 'Hapus Permanen PO Vendor',
  CREATE_CLIENT_INV: 'Membuat Invoice Client',
  EDIT_CLIENT_INV: 'Mengedit Invoice Client',
  SEND_CLIENT_INV: 'Kirim Invoice Client',
  MARK_PAID_CLIENT_INV: 'Pelunasan Invoice Client',
  UPDATE_CLIENT_INV_STATUS: 'Ubah Status Invoice Client',
  REVISE_CLIENT_INV: 'Revisi Invoice Client',
  SOFT_DELETE_CLIENT_INV: 'Hapus Invoice Client',
  RESTORE_CLIENT_INV: 'Pulihkan Invoice Client',
  PERMANENT_DELETE_CLIENT_INV: 'Hapus Permanen Invoice Client',
  CREATE_CLIENT_PO: 'Membuat PO Client',
  EDIT_CLIENT_PO: 'Mengedit PO Client',
  DELETE_CLIENT_PO: 'Hapus PO Client',
  CREATE_OPEX: 'Menambah Opex',
  EDIT_OPEX: 'Mengedit Opex',
  UPDATE_OPEX_STATUS: 'Ubah Status Opex',
  DELETE_OPEX: 'Hapus Opex',
  CREATE_INVESTMENT: 'Menambah Investment',
  EDIT_INVESTMENT: 'Mengedit Investment',
  UPDATE_INVESTMENT: 'Ubah Investment',
  TOGGLE_INVESTMENT_PAID: 'Ubah Status Cicilan Investment',
  ADDENDUM_INVESTMENT: 'Adendum Investment',
  IMPORT_INVESTMENT_CSV: 'Import CSV Investment',
  DELETE_INVESTMENT: 'Hapus Investment',
  UPDATE_BOSS_REPORT: 'Update Projection',
  DELETE_AUDIT_LOGS: 'Hapus Log Aktivitas',
  CLEAR_AUDIT_LOGS: 'Hapus Semua Log Aktivitas',
  CREATE_USER: 'Menambah User',
  UPDATE_USER_PERMISSIONS: 'Ubah Role & Hak Akses User',
  ACTIVATE_USER: 'Mengaktifkan User',
  DEACTIVATE_USER: 'Menonaktifkan User',
  RESET_PASSWORD_USER: 'Reset Password User',
  DELETE_USER: 'Hapus User',
  LOGIN: 'Login Sistem',
  LOGOUT: 'Logout Sistem',
};

export interface EnrichedActivityLogRow {
  raw: AuditLogEntry;
  actorKey: string;
  actorDisplay: string;
  actorRoleDisplay: string;
  actionLabel: string;
  docNumber: string;
  amount: number;
  description: string;
  timestampDisplay: string;
  effectiveDateISO: string;
  badge: { label: string; badgeClass: string };
}

function extractAmountFromText(text: string): number {
  const match = /Rp\s*([0-9][0-9.,]*)/i.exec(text);
  if (!match) return 0;
  const digits = match[1].replace(/[.,]/g, '');
  const val = Number(digits);
  return Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
}

function parseEffectiveDateISO(log: AuditLogEntry): string {
  if (log.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(log.dateISO)) {
    return log.dateISO;
  }
  if (log.createdAt) {
    const ms =
      typeof log.createdAt === 'number'
        ? log.createdAt
        : Date.parse(String(log.createdAt));
    if (Number.isFinite(ms)) {
      const dt = new Date(ms);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}

export function buildEnrichedActivityLogs(params: {
  logs: AuditLogEntry[];
  orders?: PurchaseOrder[];
  clientInvoices?: ClientInvoice[];
  clientPOs?: ClientPurchaseOrder[];
  opexItems?: OpexItem[];
  investments?: InvestmentAsset[];
}): EnrichedActivityLogRow[] {
  const poById = new Map<string, PurchaseOrder>();
  const poByNumber = new Map<string, PurchaseOrder>();
  for (const po of params.orders ?? []) {
    poById.set(po.id, po);
    if (po.poNumber) poByNumber.set(po.poNumber.trim().toLowerCase(), po);
  }

  const invById = new Map<string, ClientInvoice>();
  const invByNumber = new Map<string, ClientInvoice>();
  for (const inv of params.clientInvoices ?? []) {
    invById.set(inv.id, inv);
    if (inv.invoiceNumber) invByNumber.set(inv.invoiceNumber.trim().toLowerCase(), inv);
  }

  const cpoById = new Map<string, ClientPurchaseOrder>();
  const cpoByNumber = new Map<string, ClientPurchaseOrder>();
  for (const cpo of params.clientPOs ?? []) {
    cpoById.set(cpo.id, cpo);
    if (cpo.clientPoNumber) cpoByNumber.set(cpo.clientPoNumber.trim().toLowerCase(), cpo);
  }

  const opexById = new Map<string, OpexItem>();
  for (const op of params.opexItems ?? []) {
    opexById.set(op.id, op);
  }

  const investById = new Map<string, InvestmentAsset>();
  for (const asset of params.investments ?? []) {
    investById.set(asset.id, asset);
  }

  return params.logs.map((log) => {
    const badge = ENTITY_BADGE_MAP[log.entityType] ?? ENTITY_BADGE_MAP.PO;
    const rawLabel = (log.entityLabel ?? '').trim();
    const rawId = (log.entityId ?? '').trim();
    const rawSummary = (log.summary ?? '').trim();
    const cleanSummary = rawSummary === '()' ? '' : rawSummary;

    const matchedPO =
      log.entityType === 'PO'
        ? poById.get(rawId) ?? (rawLabel ? poByNumber.get(rawLabel.toLowerCase()) : undefined)
        : undefined;
    const matchedInv =
      log.entityType === 'CLIENT_INVOICE'
        ? invById.get(rawId) ?? (rawLabel ? invByNumber.get(rawLabel.toLowerCase()) : undefined)
        : undefined;
    const matchedCpo =
      log.entityType === 'CLIENT_PO'
        ? cpoById.get(rawId) ?? (rawLabel ? cpoByNumber.get(rawLabel.toLowerCase()) : undefined)
        : undefined;
    const matchedOpex = log.entityType === 'OPEX' ? opexById.get(rawId) : undefined;
    const matchedInvest = log.entityType === 'INVESTMENT' ? investById.get(rawId) : undefined;

    const rawActorEmail = (log.actorEmail ?? '').trim();
    const rawActorUid = (log.actorUid ?? '').trim();
    const rawActorName = (log.actorName ?? '').trim();
    const rawActorRoleName = (log.actorRoleName ?? '').trim();
    const emailName = rawActorEmail ? rawActorEmail.split('@')[0] : '';
    const actorDisplay =
      rawActorName ||
      emailName ||
      matchedPO?.deletedByName?.trim() ||
      'Sistem';
    const actorRoleDisplay = rawActorRoleName;
    const actorKey = (
      rawActorEmail ||
      rawActorUid ||
      actorDisplay
    ).toLowerCase();

    const docNumber =
      rawLabel ||
      matchedPO?.poNumber ||
      matchedInv?.invoiceNumber ||
      matchedCpo?.clientPoNumber ||
      matchedOpex?.name ||
      matchedInvest?.contractNumber ||
      matchedInvest?.name ||
      '';

    const matchedAmount = matchedPO
      ? getVendorPOEffectiveCostAmount(matchedPO)
      : matchedInv
      ? resolveClientInvoiceNominal(matchedInv)
      : matchedCpo
      ? matchedCpo.amount
      : matchedOpex
      ? matchedOpex.amount
      : matchedInvest
      ? matchedInvest.principalAmount || matchedInvest.monthlyInstallment
      : 0;

    const amount =
      typeof log.amount === 'number' && Number.isFinite(log.amount) && log.amount > 0
        ? Math.round(log.amount)
        : extractAmountFromText(cleanSummary) || matchedAmount || 0;

    const actionLabel =
      ACTION_LABEL_MAP[log.action] ||
      (log.action ? log.action.replace(/_/g, ' ') : `Aktivitas ${badge.label}`);

    let description = cleanSummary;
    if (!description) {
      if (matchedPO) {
        description = `PO Vendor untuk ${matchedPO.vendorName}${
          matchedPO.projectName ? ` (${matchedPO.projectName})` : ''
        }${amount > 0 ? ` sebesar Rp ${formatIDR(amount)}` : ''}`;
      } else if (matchedInv) {
        description = `Invoice Client untuk ${matchedInv.clientName}${
          matchedInv.projectName ? ` (${matchedInv.projectName})` : ''
        }${amount > 0 ? ` sebesar Rp ${formatIDR(amount)}` : ''}`;
      } else if (matchedCpo) {
        description = `PO Client untuk ${matchedCpo.clientName}${
          amount > 0 ? ` sebesar Rp ${formatIDR(amount)}` : ''
        }`;
      } else if (matchedOpex) {
        description = `Opex ${matchedOpex.name}${
          amount > 0 ? ` sebesar Rp ${formatIDR(amount)}` : ''
        }`;
      } else if (matchedInvest) {
        description = `Investment ${matchedInvest.name}${
          amount > 0 ? ` sebesar Rp ${formatIDR(amount)}` : ''
        }`;
      } else if (docNumber) {
        description = `${actionLabel} ${docNumber}${
          amount > 0 ? ` sebesar Rp ${formatIDR(amount)}` : ''
        }`;
      } else {
        description = 'Log lama - detail tidak tersedia';
      }
    }

    return {
      raw: log,
      actorKey,
      actorDisplay,
      actorRoleDisplay,
      actionLabel,
      docNumber,
      amount,
      description,
      timestampDisplay: log.timestampDisplay || log.dateISO || '-',
      effectiveDateISO: parseEffectiveDateISO(log),
      badge,
    };
  });
}

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({
  logs,
  orders,
  clientInvoices,
  clientPOs,
  opexItems,
  investments,
  isSuperAdmin = false,
  onDeleteSelectedLogs,
  onDeleteAllLogs,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserKey, setSelectedUserKey] = useState('ALL');
  const [selectedType, setSelectedType] = useState<'ALL' | AuditEntityType>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const [clearReason, setClearReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const enrichedLogs = useMemo(
    () =>
      buildEnrichedActivityLogs({
        logs,
        orders,
        clientInvoices,
        clientPOs,
        opexItems,
        investments,
      }),
    [logs, orders, clientInvoices, clientPOs, opexItems, investments]
  );

  const actorOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const row of enrichedLogs) {
      if (!map.has(row.actorKey)) {
        const roleSuffix = row.actorRoleDisplay ? ` (${row.actorRoleDisplay})` : '';
        map.set(row.actorKey, {
          key: row.actorKey,
          label: `${row.actorDisplay}${roleSuffix}`,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [enrichedLogs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedLogs.filter((row) => {
      if (selectedUserKey !== 'ALL' && row.actorKey !== selectedUserKey) return false;
      if (selectedType !== 'ALL' && row.raw.entityType !== selectedType) return false;
      if (dateFrom && (!row.effectiveDateISO || row.effectiveDateISO < dateFrom)) return false;
      if (dateTo && (!row.effectiveDateISO || row.effectiveDateISO > dateTo)) return false;
      if (!q) return true;
      return (
        row.actorDisplay.toLowerCase().includes(q) ||
        (row.raw.actorEmail ?? '').toLowerCase().includes(q) ||
        row.actorRoleDisplay.toLowerCase().includes(q) ||
        row.actionLabel.toLowerCase().includes(q) ||
        (row.raw.action ?? '').toLowerCase().includes(q) ||
        row.badge.label.toLowerCase().includes(q) ||
        row.docNumber.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        (row.amount > 0 &&
          (String(row.amount).includes(q) ||
            formatIDR(row.amount).toLowerCase().includes(q)))
      );
    });
  }, [enrichedLogs, searchQuery, selectedUserKey, selectedType, dateFrom, dateTo]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleSelectedCount = useMemo(
    () => filteredLogs.filter((row) => selectedIdSet.has(row.raw.id)).length,
    [filteredLogs, selectedIdSet]
  );
  const allVisibleSelected =
    filteredLogs.length > 0 && visibleSelectedCount === filteredLogs.length;

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredLogs.map((row) => row.raw.id);
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      setSelectedIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleConfirmDeleteSelected = async () => {
    if (!onDeleteSelectedLogs || selectedIds.length === 0) return;
    setIsDeleting(true);
    try {
      await onDeleteSelectedLogs(selectedIds);
      setSelectedIds([]);
      setShowDeleteSelectedModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onDeleteAllLogs) return;
    if (confirmKeyword.trim() !== 'HAPUS' || clearReason.trim().length < 5) return;
    setIsDeleting(true);
    try {
      await onDeleteAllLogs(clearReason.trim());
      setSelectedIds([]);
      setConfirmKeyword('');
      setClearReason('');
      setShowDeleteAllModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedUserKey('ALL');
    setSelectedType('ALL');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Log Aktivitas Sistem</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Rekam jejak permanen setiap pembuatan PO, kirim invoice, pelunasan, revisi, hapus, dan perubahan user/role.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && onDeleteSelectedLogs && (
            <button
              type="button"
              disabled={selectedIds.length === 0 || isDeleting}
              onClick={() => setShowDeleteSelectedModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus yang Dipilih{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </button>
          )}
          {isSuperAdmin && onDeleteAllLogs && (
            <button
              type="button"
              disabled={logs.length === 0 || isDeleting}
              onClick={() => {
                setConfirmKeyword('');
                setClearReason('');
                setShowDeleteAllModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus Semua Log
            </button>
          )}
          <div className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 whitespace-nowrap">
            Menampilkan <span className="font-mono text-slate-900">{filteredLogs.length}</span> dari{' '}
            <span className="font-mono text-slate-900">{logs.length}</span> aktivitas
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
        <div className="lg:col-span-4">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Cari Aktivitas / Nominal / No. Dokumen
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama user, nomor PO/INV, keterangan..."
              className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
            />
          </div>
        </div>

        <div className="lg:col-span-3">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Filter User
          </label>
          <div className="relative">
            <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              value={selectedUserKey}
              onChange={(e) => setSelectedUserKey(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-slate-900"
            >
              <option value="ALL">Semua User</option>
              {actorOptions.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="lg:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Kategori
          </label>
          <select
            value={selectedType}
            onChange={(e) =>
              setSelectedType(e.target.value as 'ALL' | AuditEntityType)
            }
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-slate-900"
          >
            <option value="ALL">Semua</option>
            <option value="PO">PO Vendor</option>
            <option value="CLIENT_INVOICE">Invoice Client</option>
            <option value="CLIENT_PO">PO Client</option>
            <option value="OPEX">Opex</option>
            <option value="INVESTMENT">Investment</option>
            <option value="REPORT">Laporan / Projection</option>
            <option value="USER">User</option>
            <option value="ROLE">Role</option>
            <option value="AUTH">Login</option>
          </select>
        </div>

        <div className="lg:col-span-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Dari — Sampai
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-2 py-2 text-[11px] border border-slate-300 rounded-lg"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-2 py-2 text-[11px] border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          {(searchQuery || selectedUserKey !== 'ALL' || selectedType !== 'ALL' || dateFrom || dateTo) && (
            <button
              type="button"
              onClick={resetFilters}
              title="Reset Filter"
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="py-12 px-6 text-center text-slate-400 text-xs">
            <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            Belum ada log aktivitas yang tercatat sesuai filter ini.
          </div>
        ) : (
          <div>
            {isSuperAdmin && (
              <div className="px-4 sm:px-5 py-2.5 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                  />
                  <span>
                    Pilih semua yang ditampilkan ({filteredLogs.length})
                  </span>
                </label>
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
                  >
                    Batal pilih ({selectedIds.length})
                  </button>
                )}
              </div>
            )}
            <div className="divide-y divide-slate-100">
              {filteredLogs.map((row) => {
                const docAlreadyInDesc =
                  row.docNumber &&
                  row.description.toLowerCase().includes(row.docNumber.toLowerCase());
                const amountFormatted = row.amount > 0 ? formatIDR(row.amount) : '';
                const amountAlreadyInDesc =
                  amountFormatted && row.description.includes(amountFormatted);
                const isChecked = selectedIdSet.has(row.raw.id);

                return (
                  <div
                    key={row.raw.id}
                    className={`px-4 sm:px-5 py-3.5 transition flex items-start gap-3 ${
                      isChecked ? 'bg-red-50/40' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    {isSuperAdmin && (
                      <div className="pt-0.5 shrink-0">
                        <input
                          type="checkbox"
                          aria-label={`Pilih log ${row.docNumber || row.actionLabel}`}
                          checked={isChecked}
                          onChange={() => toggleSelectRow(row.raw.id)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                        />
                      </div>
                    )}
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold ${row.badge.badgeClass}`}
                        >
                          {row.badge.label}
                        </span>
                        <span className="font-bold text-slate-900">
                          {row.actorDisplay}
                          {row.actorRoleDisplay ? ` (${row.actorRoleDisplay})` : ''}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="font-semibold text-slate-700">{row.actionLabel}</span>
                        {row.docNumber && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="font-mono text-[11px] font-semibold text-slate-800">
                              {row.docNumber}
                            </span>
                          </>
                        )}
                        {row.amount > 0 && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="font-mono text-[11px] font-semibold text-emerald-700 tabular-nums">
                              Rp {amountFormatted}
                            </span>
                          </>
                        )}
                        <span className="text-slate-300">•</span>
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
                          <Calendar className="w-3 h-3" />
                          {row.timestampDisplay}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {row.actorDisplay} • {row.actionLabel} •{' '}
                        {row.docNumber && !docAlreadyInDesc ? `${row.docNumber} - ` : ''}
                        {row.description}
                        {row.amount > 0 && !amountAlreadyInDesc ? ` (Rp ${amountFormatted})` : ''} •{' '}
                        {row.timestampDisplay}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal Hapus Log Terpilih */}
      {isSuperAdmin && showDeleteSelectedModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-red-50/70">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Hapus Log yang Dipilih ({selectedIds.length})
                </h3>
              </div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteSelectedModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-700 leading-relaxed">
                Anda akan menghapus permanen{' '}
                <span className="font-mono font-bold text-slate-900">{selectedIds.length}</span>{' '}
                baris log aktivitas terpilih. Tindakan ini tidak dapat dibatalkan.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteSelectedModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void handleConfirmDeleteSelected()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeleting ? 'Menghapus...' : 'Ya, Hapus Log Terpilih'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Hapus Semua Log */}
      {isSuperAdmin && showDeleteAllModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-red-50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-bold text-red-900">Hapus Semua Log Aktivitas</h3>
              </div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteAllModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmDeleteAll} className="p-5 space-y-4">
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-900 leading-relaxed">
                Seluruh <span className="font-mono font-bold">{logs.length}</span> log aktivitas
                akan dihapus permanen, dan hanya menyisakan 1 log baru:{' '}
                <span className="font-semibold">&ldquo;Log dihapus oleh [user]&rdquo;</span>.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Ketik <span className="font-mono text-red-700">HAPUS</span> untuk konfirmasi{' '}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={confirmKeyword}
                  onChange={(e) => setConfirmKeyword(e.target.value)}
                  placeholder="Ketik HAPUS"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Alasan Penghapusan <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={3}
                  value={clearReason}
                  onChange={(e) => setClearReason(e.target.value)}
                  placeholder="Minimal 5 karakter (contoh: Bersihkan log lama sebelum go-live)"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Wajib diisi (minimal 5 karakter)</span>
                  <span
                    className={`font-mono ${
                      clearReason.trim().length >= 5 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {clearReason.trim().length}/5
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteAllModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={
                    confirmKeyword.trim() !== 'HAPUS' ||
                    clearReason.trim().length < 5 ||
                    isDeleting
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isDeleting ? 'Menghapus...' : 'Ya, Hapus Semua Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
