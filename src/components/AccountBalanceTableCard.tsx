import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { BankAccountRow } from '../types/bossReport';
import { AccountProjectionRow } from '../utils/bossReportCalc';
import { formatDocumentDate, formatIDR } from '../utils/format';
import { RupiahInput } from './RupiahInput';

function formatSignedCurrency(amount: number): string {
  const abs = formatIDR(Math.abs(amount));
  return amount < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

interface InlineSaldoAwalCellProps {
  value: number;
  disabled: boolean;
  accountName: string;
  onCommit: (nextValue: number) => void;
}

const InlineSaldoAwalCell: React.FC<InlineSaldoAwalCellProps> = ({
  value,
  disabled,
  accountName,
  onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(String(value));
    }
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (disabled) {
    return (
      <span className="font-mono text-xs sm:text-sm font-semibold tabular-nums text-slate-900">
        {formatSignedCurrency(value)}
      </span>
    );
  }

  if (editing) {
    const commit = () => {
      const trimmed = draft.trim();
      const parsed = trimmed === '' || trimmed === '-' ? 0 : Number(trimmed);
      const safe = Number.isFinite(parsed) ? Math.round(parsed) : value;
      setEditing(false);
      if (safe !== value) {
        onCommit(safe);
      }
    };

    return (
      <div className="relative inline-flex items-center justify-end">
        <span className="text-xs font-mono text-slate-500 absolute left-2.5 pointer-events-none">
          Rp
        </span>
        <RupiahInput
          ref={inputRef}
          allowNegative
          aria-label={`Saldo Awal ${accountName}`}
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
          className="w-40 sm:w-44 pl-8 pr-2.5 py-1 text-right text-xs sm:text-sm font-mono font-semibold tabular-nums bg-white border border-slate-900 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
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
      title="Klik untuk edit Saldo Awal (simpan otomatis)"
      aria-label={`Edit Saldo Awal ${accountName}: ${formatSignedCurrency(value)}`}
      className="inline-flex items-center justify-end min-w-[144px] sm:min-w-[168px] px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50 transition-colors cursor-text font-mono text-xs sm:text-sm font-semibold tabular-nums text-slate-900"
    >
      {formatSignedCurrency(value)}
    </button>
  );
};

interface AccountBalanceTableCardProps {
  asOfDate: string;
  accounts: AccountProjectionRow[];
  totalOpeningBalance: number;
  totalEndingBalance: number;
  isBossMode?: boolean;
  onUpdateAsOfDate: (nextDate: string) => void;
  onUpdateAccount: (
    accId: string,
    patch: Partial<Pick<BankAccountRow, 'name' | 'balance'>>
  ) => void;
  onAddAccount: (name: string, balance: number) => void;
  onDeleteAccount: (accId: string) => void;
  onBackToProjection?: () => void;
  onGoToBalance?: () => void;
}

export const AccountBalanceTableCard: React.FC<AccountBalanceTableCardProps> = ({
  asOfDate,
  accounts,
  totalOpeningBalance,
  totalEndingBalance,
  isBossMode = false,
  onUpdateAsOfDate,
  onUpdateAccount,
  onAddAccount,
  onDeleteAccount,
  onBackToProjection,
  onGoToBalance,
}) => {
  const [editingDate, setEditingDate] = useState(false);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccBalance, setNewAccBalance] = useState('0');

  useEffect(() => {
    if (editingNameId) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingNameId]);

  const startEditingName = (acc: AccountProjectionRow) => {
    if (isBossMode) return;
    setEditingNameId(acc.id);
    setNameDraft(acc.name);
  };

  const commitNameEdit = (acc: AccountProjectionRow) => {
    const clean = nameDraft.trim();
    setEditingNameId(null);
    if (clean && clean !== acc.name) {
      onUpdateAccount(acc.id, { name: clean });
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newAccName.trim();
    if (!cleanName) return;
    const parsed = Number(newAccBalance || 0);
    const safeBal = Number.isFinite(parsed) ? Math.round(parsed) : 0;
    onAddAccount(cleanName, safeBal);
    setNewAccName('');
    setNewAccBalance('0');
    setAddingAccount(false);
  };

  const isMinusTotal = totalEndingBalance < 0;

  return (
    <section className="bg-white border border-slate-300 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Detail Saldo Rekening &amp; Ending Balance Per {formatDocumentDate(asOfDate)}
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Input Saldo Awal per rekening, Saldo Akhir terhitung otomatis dari Realisasi.
            </p>
          </div>

          {!isBossMode && (
            <>
              {editingDate ? (
                <div className="inline-flex items-center gap-1.5 bg-white rounded-md px-2 py-1 text-slate-900">
                  <input
                    type="date"
                    aria-label="Tanggal saldo rekening"
                    value={asOfDate}
                    onChange={(e) => {
                      if (e.target.value) {
                        onUpdateAsOfDate(e.target.value);
                        setEditingDate(false);
                      }
                    }}
                    className="text-xs font-medium bg-transparent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingDate(false)}
                    className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Selesai
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingDate(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-md transition-colors cursor-pointer"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Ganti Tanggal
                </button>
              )}
            </>
          )}
        </div>

        {!isBossMode && (
          <button
            type="button"
            onClick={() => {
              setAddingAccount(true);
              setNewAccName('');
              setNewAccBalance('0');
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Rekening
          </button>
        )}
      </div>

      {/* 3-Column Table (No per-account Saldo Akhir, no horizontal scroll) */}
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-100 border-b border-slate-300 text-xs font-bold text-slate-700">
            <th className="py-2.5 px-4">Rekening</th>
            <th className="py-2.5 px-4 text-right whitespace-nowrap">Saldo Awal</th>
            {!isBossMode && (
              <th className="py-2.5 px-3 w-20 text-right whitespace-nowrap">Aksi</th>
            )}
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc) => (
            <tr
              key={acc.id}
              className={`border-b border-slate-200 transition-colors ${
                acc.isPrimary
                  ? 'bg-slate-50/70 hover:bg-slate-100/70'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              {/* Kolom 1: Rekening */}
              <td className="py-2 px-4 align-middle">
                {editingNameId === acc.id && !isBossMode ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={nameInputRef}
                      type="text"
                      aria-label={`Edit nama rekening ${acc.name}`}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => commitNameEdit(acc)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitNameEdit(acc);
                        } else if (e.key === 'Escape') {
                          setEditingNameId(null);
                          setNameDraft(acc.name);
                        }
                      }}
                      className="w-full max-w-md px-2.5 py-1 text-xs sm:text-sm font-medium bg-white border border-slate-900 rounded-md text-slate-900 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-sm font-medium text-slate-900">
                      {acc.name}
                    </span>
                    {acc.isPrimary && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 bg-slate-200 rounded">
                        Utama
                      </span>
                    )}
                  </div>
                )}
              </td>

              {/* Kolom 2: Saldo Awal (Inline Edit, Auto-Save) */}
              <td className="py-2 px-4 text-right align-middle whitespace-nowrap">
                <InlineSaldoAwalCell
                  value={acc.openingBalance}
                  disabled={isBossMode}
                  accountName={acc.name}
                  onCommit={(nextBal) => onUpdateAccount(acc.id, { balance: nextBal })}
                />
              </td>

              {/* Kolom 3: Aksi (Edit Nama & Hapus Rekening) */}
              {!isBossMode && (
                <td className="py-2 px-3 text-right align-middle whitespace-nowrap">
                  <div className="inline-flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => startEditingName(acc)}
                      title="Edit Nama Rekening"
                      aria-label={`Edit nama rekening ${acc.name}`}
                      className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteAccount(acc.id)}
                      title="Hapus Rekening"
                      aria-label={`Hapus rekening ${acc.name}`}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}

          {!isBossMode && addingAccount && (
            <tr className="bg-slate-50 border-b border-slate-300">
              <td className="py-2.5 px-4" colSpan={3}>
                <form
                  onSubmit={handleAddSubmit}
                  className="flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newAccName}
                    onChange={(e) => setNewAccName(e.target.value)}
                    placeholder="Nama Rekening Baru (contoh: BCA Operasional)"
                    className="flex-1 px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <div className="relative sm:w-48">
                    <span className="text-xs font-mono text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                      Rp
                    </span>
                    <RupiahInput
                      allowNegative
                      value={newAccBalance}
                      onValueChange={setNewAccBalance}
                      className="w-full pl-8 pr-2.5 py-1.5 text-right text-xs sm:text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
                    >
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingAccount(false)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 border-t-2 border-slate-300">
            <td className="py-2.5 px-4 text-xs sm:text-sm font-bold text-slate-900">
              Total Saldo Awal
            </td>
            <td className="py-2.5 px-4 text-right font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums whitespace-nowrap">
              {formatSignedCurrency(totalOpeningBalance)}
            </td>
            {!isBossMode && <td className="py-2.5 px-3" />}
          </tr>
          <tr
            className={`border-t ${
              isMinusTotal
                ? 'bg-red-50/80 border-red-200'
                : 'bg-emerald-50/80 border-emerald-200'
            }`}
          >
            <td className="py-3 px-4">
              <div className="text-xs sm:text-sm font-extrabold text-slate-900">
                Saldo Akhir Total (Semua Rekening)
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                SAMA PERSIS dengan Saldo Tersedia di halaman Realisasi untuk periode yang sama
              </div>
            </td>
            <td
              className={`py-3 px-4 text-right font-mono text-sm sm:text-base font-extrabold tabular-nums whitespace-nowrap align-middle ${
                isMinusTotal ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {formatSignedCurrency(totalEndingBalance)}
            </td>
            {!isBossMode && <td className="py-3 px-3" />}
          </tr>
        </tfoot>
      </table>

      {/* Keterangan & Tombol Navigasi Bawah */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-[11px] text-slate-600">
          Saldo Akhir hanya dihitung total, tidak per rekening. Semua transaksi masuk / keluar lewat Rekening Utama.
        </p>

        {(onBackToProjection || onGoToBalance) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onBackToProjection && (
              <button
                type="button"
                onClick={onBackToProjection}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Kembali ke Projection
              </button>
            )}
            {onGoToBalance && (
              <button
                type="button"
                onClick={onGoToBalance}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Lihat Realisasi
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
