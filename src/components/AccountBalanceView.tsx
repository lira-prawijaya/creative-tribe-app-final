import React, { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  createDefaultBossReportMonth,
  generateBossRowId,
} from '../services/bossReportService';
import { BankAccountRow, BossReportMonthData } from '../types/bossReport';
import { ClientInvoice } from '../types/clientInvoice';
import { InvestmentAsset } from '../types/investment';
import { OpexItem } from '../types/opex';
import { PurchaseOrder } from '../types/po';
import {
  addMonthsToKey,
  computeBalanceAccountDetails,
  computeBossReportViewModel,
  formatBossMonthFullLabel,
  normalizeMonthKeyYYYYMM,
} from '../utils/bossReportCalc';
import { formatIDR, getTodayISODate } from '../utils/format';
import { AccountBalanceTableCard } from './AccountBalanceTableCard';
import { PeriodeSelector } from './PeriodeSelector';

interface AccountBalanceViewProps {
  orders: PurchaseOrder[];
  clientInvoices: ClientInvoice[];
  opexItems?: OpexItem[];
  investments?: InvestmentAsset[];
  bossReportMonths: Record<string, BossReportMonthData>;
  selectedMonthKey?: string;
  cutoffPeriod?: string;
  onChangeMonthKey?: (monthKey: string) => void;
  onSaveBossReportMonth?: (monthData: BossReportMonthData) => Promise<void>;
  onBackToProjection: () => void;
  onGoToBalance: () => void;
  isLoading: boolean;
  canEdit?: boolean;
}

function formatSignedCurrency(amount: number): string {
  const abs = formatIDR(Math.abs(amount));
  return amount < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

export const AccountBalanceView: React.FC<AccountBalanceViewProps> = ({
  orders,
  clientInvoices,
  opexItems = [],
  investments = [],
  bossReportMonths,
  selectedMonthKey: controlledMonthKey,
  cutoffPeriod: controlledCutoffPeriod,
  onChangeMonthKey,
  onSaveBossReportMonth,
  onBackToProjection,
  onGoToBalance,
  isLoading,
  canEdit = true,
}) => {
  const defaultMonthKey = useMemo(() => getTodayISODate().slice(0, 7), []);
  const cutoffPeriod = useMemo(
    () => normalizeMonthKeyYYYYMM(controlledCutoffPeriod ?? defaultMonthKey),
    [controlledCutoffPeriod, defaultMonthKey]
  );
  const [localMonthKey, setLocalMonthKey] = useState<string>(
    controlledMonthKey ?? defaultMonthKey
  );
  const selectedMonthKey = controlledMonthKey ?? localMonthKey;
  const setSelectedMonthKey = (nextMonthKey: string) => {
    setLocalMonthKey(nextMonthKey);
    onChangeMonthKey?.(nextMonthKey);
  };

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeMonthData: BossReportMonthData = useMemo(
    () => bossReportMonths[selectedMonthKey] ?? createDefaultBossReportMonth(selectedMonthKey),
    [bossReportMonths, selectedMonthKey]
  );

  const viewModel = useMemo(
    () =>
      computeBossReportViewModel(
        selectedMonthKey,
        activeMonthData,
        orders,
        clientInvoices,
        opexItems,
        investments,
        bossReportMonths,
        { cutoffPeriod }
      ),
    [
      selectedMonthKey,
      activeMonthData,
      orders,
      clientInvoices,
      opexItems,
      investments,
      bossReportMonths,
      cutoffPeriod,
    ]
  );

  const balanceAccounts = useMemo(
    () => computeBalanceAccountDetails(viewModel),
    [viewModel]
  );

  const persistMonth = (updater: (prev: BossReportMonthData) => BossReportMonthData) => {
    if (!onSaveBossReportMonth) return;
    const rawSum = activeMonthData.accounts.reduce(
      (sum, acc) => sum + (Number.isFinite(acc.balance) ? acc.balance : 0),
      0
    );
    const baseData: BossReportMonthData =
      activeMonthData.manualOpeningBalance === undefined &&
      rawSum === 0 &&
      viewModel.hasPreviousMonthData
        ? {
            ...activeMonthData,
            accounts: balanceAccounts.map((acc) => ({
              id: acc.id,
              name: acc.name,
              balance: acc.openingBalance,
              ...(acc.isPrimary ? { isPrimary: true } : {}),
            })),
          }
        : activeMonthData;

    const next = updater(baseData);
    void onSaveBossReportMonth(next).catch((err) => {
      setErrorMsg(
        err instanceof Error
          ? `Gagal menyimpan perubahan saldo rekening: ${err.message}`
          : 'Gagal menyimpan perubahan saldo rekening ke database.'
      );
    });
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
        balanceAccounts.find((a) => a.id === accId)?.openingBalance ?? 0;
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

  const handleAddAccount = (name: string, balance: number) => {
    persistMonth((prev) => {
      const nextAccounts: BankAccountRow[] = [
        ...prev.accounts,
        {
          id: generateBossRowId('acc'),
          name,
          balance,
          ...(prev.accounts.length === 0 ? { isPrimary: true } : {}),
        },
      ];
      if (prev.manualOpeningBalance !== undefined) {
        return {
          ...prev,
          accounts: nextAccounts,
          manualOpeningBalance: Math.round(prev.manualOpeningBalance + balance),
        };
      }
      return {
        ...prev,
        accounts: nextAccounts,
      };
    });
  };

  const handleDeleteAccount = (accId: string) => {
    persistMonth((prev) => {
      const targetAcc = balanceAccounts.find((a) => a.id === accId);
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
    const prevEndingAccounts = computeBalanceAccountDetails(prevVm);
    const prevEndingRealisasi = prevVm.endingBalanceRealisasi;

    if (!prevMonth && prevEndingRealisasi === 0) {
      setFeedback(`Belum ada data saldo rekening di ${prevLabel} untuk disalin.`);
      window.setTimeout(() => setFeedback(null), 4000);
      return;
    }

    const copiedAccounts: BankAccountRow[] = prevEndingAccounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
      balance: acc.endingBalance,
      ...(acc.isPrimary ? { isPrimary: true } : {}),
    }));

    persistMonth((prev) => ({
      ...prev,
      manualOpeningBalance: prevEndingRealisasi,
      accounts: copiedAccounts,
    }));

    setFeedback(
      `Saldo Akhir ${prevLabel} (${formatSignedCurrency(
        prevEndingRealisasi
      )}) disalin menjadi Saldo Awal ${viewModel.monthFullLabel} per rekening.`
    );
    window.setTimeout(() => setFeedback(null), 4500);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-14 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact Period Bar (No Download / Bagikan buttons) */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <PeriodeSelector
          monthKey={selectedMonthKey}
          onChangeMonthKey={setSelectedMonthKey}
          ariaLabelPrefix="saldo rekening"
        />

        {canEdit && (
          <button
            type="button"
            onClick={handleCopyPreviousMonth}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Salin Saldo Akhir bulan lalu menjadi Saldo Awal bulan ini per rekening"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Bulan Lalu
          </button>
        )}
      </div>

      {feedback && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-900 flex items-center justify-between gap-2">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700 flex items-center justify-between gap-2"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      <AccountBalanceTableCard
        asOfDate={viewModel.asOfDate}
        accounts={balanceAccounts}
        totalOpeningBalance={viewModel.saldoAwal}
        totalEndingBalance={viewModel.endingBalanceRealisasi}
        isBossMode={!canEdit}
        onUpdateAsOfDate={handleUpdateAsOfDate}
        onUpdateAccount={handleUpdateAccount}
        onAddAccount={handleAddAccount}
        onDeleteAccount={handleDeleteAccount}
        onBackToProjection={onBackToProjection}
        onGoToBalance={onGoToBalance}
      />
    </div>
  );
};
