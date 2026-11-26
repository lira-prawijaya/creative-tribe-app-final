import { createDefaultBossReportMonth } from '../services/bossReportService';
import {
  BossReportAutoOverride,
  BossReportColorStatus,
  BossReportManualItem,
  BossReportMonthData,
  BossReportRescheduledItem,
  BossReportSectionKey,
  InvestmentComponentKind,
} from '../types/bossReport';
import { InvestmentAsset } from '../types/investment';
import { OpexItem } from '../types/opex';
import {
  addMonthsToKey,
  BossReportComputedRow,
  BossReportViewModel,
} from './bossReportCalc';
import { getInstallmentDueISODate } from './investmentCalc';

export type ProjectionSourceSyncAction =
  | {
      type: 'clientInvoice';
      invoiceId: string;
      paid: boolean;
      color?: BossReportColorStatus;
      targetMonthKey?: string;
      originMonthKey?: string;
    }
  | {
      type: 'opex';
      opexId: string;
      monthKey: string;
      paid: boolean;
      color?: BossReportColorStatus;
      targetMonthKey?: string;
    }
  | {
      type: 'vendorPO';
      poId: string;
      paid: boolean;
      color?: BossReportColorStatus;
      targetMonthKey?: string;
      originMonthKey?: string;
    }
  | {
      type: 'investment';
      assetId: string;
      monthKey: string;
      component?: InvestmentComponentKind;
      paid: boolean;
      color?: BossReportColorStatus;
      targetMonthKey?: string;
    }
  | {
      type: 'investmentDisbursement';
      assetId: string;
      color: BossReportColorStatus;
      originMonthKey?: string;
      rescheduledToMonth?: string;
    }
  | {
      type: 'investmentRescheduleDates';
      assetId: string;
      newEndDate?: string;
      newBonusDate?: string;
    };

export interface ProjectionColorChangePlan {
  monthsToSave: BossReportMonthData[];
  sourceSyncAction: ProjectionSourceSyncAction | null;
  sourceSyncActions: ProjectionSourceSyncAction[];
}

function getManualArrayKey(
  section: BossReportSectionKey
): 'cashInManual' | 'operasional' | 'investment' | 'projectCostManual' {
  if (section === 'cashIn') return 'cashInManual';
  if (section === 'operasional') return 'operasional';
  if (section === 'investment') return 'investment';
  return 'projectCostManual';
}

function cloneMonth(
  bossReportMonths: Record<string, BossReportMonthData>,
  monthKey: string
): BossReportMonthData {
  const existing = bossReportMonths[monthKey] ?? createDefaultBossReportMonth(monthKey);
  return {
    ...existing,
    accounts: existing.accounts.map((a) => ({ ...a })),
    cashInManual: existing.cashInManual.map((i) => ({ ...i })),
    operasional: existing.operasional.map((i) => ({ ...i })),
    investment: existing.investment.map((i) => ({ ...i })),
    projectCostManual: existing.projectCostManual.map((i) => ({ ...i })),
    autoOverrides: existing.autoOverrides.map((o) => ({ ...o })),
    rescheduledIn: (existing.rescheduledIn ?? []).map((r) => ({
      ...r,
      historyMonths: [...r.historyMonths],
    })),
  };
}

function updateAutoOverrideColor(
  overrides: BossReportAutoOverride[],
  sourceId: string,
  color: BossReportColorStatus,
  options?: {
    rescheduledToMonth?: string;
    fallbackName?: string;
    fallbackAmount?: number;
    explicitWhiteOverride?: boolean;
  }
): BossReportAutoOverride[] {
  const existing = overrides.find((o) => o.sourceId === sourceId);
  const rest = overrides.filter((o) => o.sourceId !== sourceId);
  const rescheduledToMonth = options?.rescheduledToMonth;

  if (color === 'white' && !rescheduledToMonth && !options?.explicitWhiteOverride) {
    if (!existing) return overrides;
    if (!existing.hasCustomName && !existing.hasCustomAmount) {
      return rest;
    }
    const {
      rescheduledToMonth: _removed,
      hasCustomRealisasi: _hcr,
      realisasiAmount: _ra,
      actual_amount: _aa,
      ...cleanExisting
    } = existing;
    void _removed;
    void _hcr;
    void _ra;
    void _aa;
    return [
      ...rest,
      {
        ...cleanExisting,
        hasCustomColor: false,
        color: 'white',
      },
    ];
  }

  const base: BossReportAutoOverride = existing ?? {
    sourceId,
    hasCustomName: false,
    name: options?.fallbackName ?? '',
    hasCustomAmount: false,
    amount: options?.fallbackAmount ?? 0,
    hasCustomColor: true,
    color,
  };
  const {
    rescheduledToMonth: _prevTarget,
    hasCustomRealisasi: _prevHcr,
    realisasiAmount: _prevRa,
    actual_amount: _prevAa,
    ...cleanBase
  } = base;
  void _prevTarget;
  void _prevHcr;
  void _prevRa;
  void _prevAa;

  return [
    ...rest,
    {
      ...cleanBase,
      name: cleanBase.hasCustomName ? cleanBase.name : options?.fallbackName ?? cleanBase.name,
      amount: cleanBase.hasCustomAmount
        ? cleanBase.amount
        : options?.fallbackAmount ?? cleanBase.amount,
      ...(color === 'green' && existing?.hasCustomRealisasi && existing.realisasiAmount !== undefined
        ? {
            hasCustomRealisasi: true,
            realisasiAmount: existing.realisasiAmount,
            actual_amount: existing.realisasiAmount,
          }
        : {}),
      hasCustomColor: true,
      color,
      ...(color === 'red' && rescheduledToMonth ? { rescheduledToMonth } : {}),
    },
  ];
}

function updateManualItemColor(
  items: BossReportManualItem[],
  itemId: string,
  color: BossReportColorStatus,
  rescheduledToMonth?: string
): BossReportManualItem[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    const resolvedActual = item.actualAmount ?? item.actual_amount;
    const { actualAmount: _aa, actual_amount: _aa2, ...restItem } = item;
    void _aa;
    void _aa2;
    const next: BossReportManualItem = {
      ...restItem,
      color,
      ...(color === 'green' && resolvedActual !== undefined
        ? { actualAmount: resolvedActual, actual_amount: resolvedActual }
        : {}),
    };
    if (color === 'red' && rescheduledToMonth) {
      next.rescheduledToMonth = rescheduledToMonth;
    } else {
      delete next.rescheduledToMonth;
    }
    return next;
  });
}

export function buildProjectionColorChangePlan(params: {
  row: BossReportComputedRow;
  nextColor: BossReportColorStatus;
  currentMonthKey: string;
  targetMonthKey?: string;
  viewModel: BossReportViewModel;
  bossReportMonths: Record<string, BossReportMonthData>;
  investments?: InvestmentAsset[];
  opexItems?: OpexItem[];
}): ProjectionColorChangePlan {
  const {
    row,
    nextColor,
    currentMonthKey,
    targetMonthKey,
    viewModel,
    bossReportMonths,
    investments = [],
    opexItems = [],
  } = params;
  const workingMonths = new Map<string, BossReportMonthData>();
  const sourceSyncActions: ProjectionSourceSyncAction[] = [];

  const getWorkingMonth = (mk: string): BossReportMonthData => {
    let found = workingMonths.get(mk);
    if (!found) {
      found = cloneMonth(bossReportMonths, mk);
      workingMonths.set(mk, found);
    }
    return found;
  };

  const cleanupRescheduledChain = (
    startTargetMonthKey: string,
    rsId: string,
    sourceId?: string,
    fromMonthKey?: string,
    investmentComponent?: InvestmentComponentKind
  ) => {
    const cleanupQueue: Array<{
      monthKey: string;
      rsId: string;
      sourceId?: string;
      fromMonthKey?: string;
      investmentComponent?: InvestmentComponentKind;
    }> = [{ monthKey: startTargetMonthKey, rsId, sourceId, fromMonthKey, investmentComponent }];
    const visitedCleanup = new Set<string>();
    while (cleanupQueue.length > 0) {
      const task = cleanupQueue.shift();
      if (!task) continue;
      const visitKey = `${task.monthKey}::${task.rsId}::${task.sourceId ?? ''}::${task.fromMonthKey ?? ''}::${task.investmentComponent ?? ''}`;
      if (visitedCleanup.has(visitKey)) continue;
      visitedCleanup.add(visitKey);

      if (!bossReportMonths[task.monthKey] && !workingMonths.has(task.monthKey)) {
        continue;
      }

      const targetMonth = getWorkingMonth(task.monthKey);
      const list = targetMonth.rescheduledIn ?? [];
      const matchesTask = (item: BossReportRescheduledItem) => {
        if (
          task.investmentComponent &&
          item.investmentComponent &&
          item.investmentComponent !== task.investmentComponent
        ) {
          return false;
        }
        return (
          item.id === task.rsId ||
          Boolean(
            task.sourceId &&
              item.sourceId === task.sourceId &&
              (!task.fromMonthKey || item.fromMonthKey === task.fromMonthKey)
          )
        );
      };
      const removed = list.filter(matchesTask);
      if (removed.length > 0) {
        targetMonth.rescheduledIn = list.filter((item) => !matchesTask(item));
        for (const rem of removed) {
          const nextTarget =
            rem.color === 'red' && rem.rescheduledToMonth && rem.rescheduledToMonth !== task.monthKey
              ? rem.rescheduledToMonth
              : undefined;
          if (nextTarget) {
            cleanupQueue.push({
              monthKey: nextTarget,
              rsId: rem.id,
              sourceId: rem.sourceId,
              fromMonthKey: task.monthKey,
              investmentComponent: rem.investmentComponent ?? task.investmentComponent,
            });
          }
        }
      }
    }
  };

  // Reschedule per komponen: hanya baris yang dipilih yang bergerak.
  // Tanggal Akhir Pinjaman & Tanggal Bonus pada form Investment TIDAK dioverride/diubah
  // agar sumber kebenaran jadwal kontrak (dan Adendum) tetap utuh.
  const asset =
    row.sourceCategory === 'investment' && row.investmentAssetId
      ? investments.find((a) => a.id === row.investmentAssetId)
      : undefined;

  const targetGroup: BossReportComputedRow[] = [row];

  if (nextColor === 'red') {
    const resolvedTargetMonthKey =
      targetMonthKey && /^\d{4}-\d{2}$/.test(targetMonthKey) && targetMonthKey !== currentMonthKey
        ? targetMonthKey
        : addMonthsToKey(currentMonthKey, 1);
    const currentMonth = getWorkingMonth(currentMonthKey);
    const nextMonth = getWorkingMonth(resolvedTargetMonthKey);

    for (const r of targetGroup) {
      const rsId =
        r.rescheduledItemId || `rs_${r.originMonthKey}_${r.sourceId || r.rowKey}`;
      const rSourceId = r.sourceId || r.rowKey;

      // Jika baris ini sebelumnya sudah MERAH ke bulan tujuan lain (misal Des -> ganti ke Jan),
      // hapus salinan dari bulan tujuan lama terlebih dahulu agar tidak menumpuk di 2 bulan.
      if (r.color === 'red' && r.rescheduledToMonth && r.rescheduledToMonth !== resolvedTargetMonthKey) {
        cleanupRescheduledChain(
          r.rescheduledToMonth,
          rsId,
          rSourceId,
          currentMonthKey,
          r.investmentComponent
        );
      }

      // LOGIKA UNIFIED PENDING:
      // 1. Item TETAP ADA di periode asal (tidak dihapus), status menjadi 'red' (Pending) + rescheduledToMonth.
      if (r.isRescheduledIn && r.rescheduledItemId) {
        currentMonth.rescheduledIn = (currentMonth.rescheduledIn ?? []).map((rs) => {
          if (rs.id !== r.rescheduledItemId) return rs;
          const {
            hasCustomRealisasi: _hcr,
            realisasiAmount: _ra,
            actual_amount: _aa,
            ...restRs
          } = rs;
          void _hcr;
          void _ra;
          void _aa;
          return {
            ...restRs,
            color: 'red' as const,
            rescheduledToMonth: resolvedTargetMonthKey,
          };
        });
      } else if (r.isAuto && r.sourceId) {
        currentMonth.autoOverrides = updateAutoOverrideColor(
          currentMonth.autoOverrides,
          r.sourceId,
          'red',
          {
            rescheduledToMonth: resolvedTargetMonthKey,
            fallbackName: r.name,
            fallbackAmount: r.amount,
          }
        );
      } else if (r.sourceId) {
        const key = getManualArrayKey(r.section);
        currentMonth[key] = updateManualItemColor(
          currentMonth[key],
          r.sourceId,
          'red',
          resolvedTargetMonthKey
        );
      }

      const historyMonths =
        r.color === 'red' && r.historyMonths && r.historyMonths.length >= 2
          ? [...r.historyMonths.slice(0, -1), resolvedTargetMonthKey]
          : r.historyMonths && r.historyMonths.length >= 2
          ? r.historyMonths[r.historyMonths.length - 1] === resolvedTargetMonthKey
            ? [...r.historyMonths]
            : [...r.historyMonths, resolvedTargetMonthKey]
          : [currentMonthKey, resolvedTargetMonthKey];

      const preservedDueISO =
        r.dueISO && /^\d{4}-\d{2}-\d{2}$/.test(r.dueISO)
          ? r.dueISO
          : r.sourceCategory === 'investment'
          ? getInstallmentDueISODate(currentMonthKey, asset?.dueDay ?? 1)
          : undefined;

      // 2. Buat salinan di bulan tujuan dengan status belum lunas ('white') + anti-duplikat (idAsal + periodeAsal)
      const entry: BossReportRescheduledItem = {
        id: rsId,
        section: r.section,
        sourceCategory: r.sourceCategory,
        sourceId: rSourceId,
        originMonthKey: r.originMonthKey,
        fromMonthKey: currentMonthKey,
        rescheduledFromMonth: currentMonthKey,
        historyMonths,
        name: r.name,
        amount: r.amount,
        color: 'white',
        ...(r.accountId ? { accountId: r.accountId } : {}),
        ...(preservedDueISO ? { dueISO: preservedDueISO } : {}),
        ...(r.investmentAssetId ? { investmentAssetId: r.investmentAssetId } : {}),
        ...(r.investmentComponent ? { investmentComponent: r.investmentComponent } : {}),
        ...(typeof r.investmentInstallmentNumber === 'number'
          ? { investmentInstallmentNumber: r.investmentInstallmentNumber }
          : {}),
        ...(r.investmentInstallmentMonthKey
          ? { investmentInstallmentMonthKey: r.investmentInstallmentMonthKey }
          : {}),
        ...(r.hasCustomOverride ? { hasCustomOverride: true } : {}),
      };

      const existingNext = nextMonth.rescheduledIn ?? [];
      nextMonth.rescheduledIn = [
        ...existingNext.filter(
          (item) =>
            item.id !== rsId &&
            !(
              item.sourceId === entry.sourceId &&
              item.originMonthKey === entry.originMonthKey &&
              item.fromMonthKey === entry.fromMonthKey
            )
        ),
        entry,
      ];
    }

    // 3. Sinkronisasi status Pending ke tabel sumber HANYA jika ini item asal (!row.isRescheduledIn)
    if (!row.isRescheduledIn) {
      if (row.sourceCategory === 'clientInvoice') {
        const invoiceId =
          row.clientInvoiceId ?? (row.sourceId ? row.sourceId.replace(/^ci_/, '') : '');
        if (invoiceId) {
          sourceSyncActions.push({
            type: 'clientInvoice',
            invoiceId,
            paid: false,
            color: 'red',
            targetMonthKey: resolvedTargetMonthKey,
            originMonthKey: currentMonthKey,
          });
        }
      } else if (row.sourceCategory === 'vendorPO') {
        const poId = row.poId ?? (row.sourceId ? row.sourceId.replace(/^po_/, '') : '');
        if (poId) {
          sourceSyncActions.push({
            type: 'vendorPO',
            poId,
            paid: false,
            color: 'red',
            targetMonthKey: resolvedTargetMonthKey,
            originMonthKey: currentMonthKey,
          });
        }
      } else if (row.sourceCategory === 'opex') {
        const opexId = row.opexId ?? (row.sourceId ? row.sourceId.replace(/^opex_/, '') : '');
        if (opexId) {
          sourceSyncActions.push({
            type: 'opex',
            opexId,
            monthKey: currentMonthKey,
            paid: false,
            color: 'red',
            targetMonthKey: resolvedTargetMonthKey,
          });
        }
      } else if (
        row.section === 'cashIn' &&
        (row.cashInSource === 'investmentDisbursement' ||
          (row.sourceId && row.sourceId.startsWith('inv_disb_')))
      ) {
        const disbAssetId =
          row.investmentAssetId ??
          (row.sourceId ? row.sourceId.replace(/^inv_disb_/, '') : '');
        if (disbAssetId) {
          sourceSyncActions.push({
            type: 'investmentDisbursement',
            assetId: disbAssetId,
            color: 'red',
            originMonthKey: currentMonthKey,
            rescheduledToMonth: resolvedTargetMonthKey,
          });
        }
      } else if (asset && row.section === 'investment' && row.sourceCategory === 'investment') {
        const instMonthKey = row.investmentInstallmentMonthKey || currentMonthKey;
        sourceSyncActions.push({
          type: 'investment',
          assetId: asset.id,
          monthKey: instMonthKey,
          component: row.investmentComponent ?? 'principal',
          paid: false,
          color: 'red',
          targetMonthKey: resolvedTargetMonthKey,
        });
      }
    }

    return {
      monthsToSave: Array.from(workingMonths.values()),
      sourceSyncAction: sourceSyncActions[0] ?? null,
      sourceSyncActions,
    };
  }

  // Transition to 'white' (PUTIH - Batalkan Pending / Kembalikan ke Projection) or 'green' (HIJAU - Paid)
  // 1. Jika item sebelumnya MERAH - Pending, hapus salinan di bulan tujuan secara otomatis (termasuk multi-hop)
  if (row.color === 'red') {
    const cleanupTarget = row.rescheduledToMonth || addMonthsToKey(currentMonthKey, 1);
    if (cleanupTarget && cleanupTarget !== currentMonthKey) {
      const rsId =
        row.rescheduledItemId || `rs_${row.originMonthKey}_${row.sourceId || row.rowKey}`;
      cleanupRescheduledChain(
        cleanupTarget,
        rsId,
        row.sourceId || row.rowKey,
        currentMonthKey,
        row.investmentComponent
      );
    }
  }

  // 2. Update status bulan berjalan untuk targetGroup
  const currentMonth = getWorkingMonth(currentMonthKey);
  for (const r of targetGroup) {
    if (r.isRescheduledIn && r.rescheduledItemId) {
      currentMonth.rescheduledIn = (currentMonth.rescheduledIn ?? []).map((rs) => {
        if (rs.id !== r.rescheduledItemId) return rs;
        const {
          rescheduledToMonth: _rt,
          hasCustomRealisasi: _hcr,
          realisasiAmount: _ra,
          actual_amount: _aa,
          ...restRs
        } = rs;
        void _rt;
        void _hcr;
        void _ra;
        void _aa;
        return {
          ...restRs,
          color: nextColor,
        };
      });
    } else if (r.isAuto && r.sourceId) {
      currentMonth.autoOverrides = updateAutoOverrideColor(
        currentMonth.autoOverrides,
        r.sourceId,
        nextColor,
        {
          fallbackName: r.name,
          fallbackAmount: r.amount,
          explicitWhiteOverride: false,
        }
      );
    } else if (r.sourceId) {
      const key = getManualArrayKey(r.section);
      currentMonth[key] = updateManualItemColor(
        currentMonth[key],
        r.sourceId,
        nextColor
      );
    }
  }

  // 3. Sinkronisasi status ke menu sumber
  const isInvestmentDisbursementRow =
    row.section === 'cashIn' &&
    (row.cashInSource === 'investmentDisbursement' ||
      (row.sourceId && row.sourceId.startsWith('inv_disb_')));

  if (row.isRescheduledIn) {
    // Salinan tunggakan di bulan tujuan:
    // - Jika dibatalkan dari Pending ke Projection ('white'), JANGAN ubah record sumber di bulan asal.
    // - Jika ditandai Paid ('green') atau Batal Paid ('green' -> 'white') untuk dokumen tunggal (Client Invoice, Vendor PO, Disbursement),
    //   sinkronkan status lunasnya (tetap mempertahankan history Pending bulan asal di autoOverrides bulan asal).
    const shouldSyncCopySingleDoc =
      nextColor === 'green' || (nextColor === 'white' && row.color === 'green');
    if (shouldSyncCopySingleDoc) {
      const targetColorForSingleDoc: BossReportColorStatus =
        nextColor === 'green' ? 'green' : 'red';
      if (isInvestmentDisbursementRow) {
        const disbAssetId =
          row.investmentAssetId ??
          (row.sourceId ? row.sourceId.replace(/^inv_disb_/, '') : '');
        if (disbAssetId) {
          sourceSyncActions.push({
            type: 'investmentDisbursement',
            assetId: disbAssetId,
            color: targetColorForSingleDoc,
            ...(targetColorForSingleDoc === 'red'
              ? { originMonthKey: row.originMonthKey, rescheduledToMonth: currentMonthKey }
              : {}),
          });
        }
      } else if (row.sourceCategory === 'clientInvoice') {
        const invoiceId =
          row.clientInvoiceId ?? (row.sourceId ? row.sourceId.replace(/^ci_/, '') : '');
        if (invoiceId) {
          sourceSyncActions.push({
            type: 'clientInvoice',
            invoiceId,
            paid: nextColor === 'green',
            color: targetColorForSingleDoc,
            ...(targetColorForSingleDoc === 'red'
              ? { originMonthKey: row.originMonthKey, targetMonthKey: currentMonthKey }
              : {}),
          });
        }
      } else if (row.sourceCategory === 'vendorPO') {
        const poId = row.poId ?? (row.sourceId ? row.sourceId.replace(/^po_/, '') : '');
        if (poId) {
          sourceSyncActions.push({
            type: 'vendorPO',
            poId,
            paid: nextColor === 'green',
            color: targetColorForSingleDoc,
            ...(targetColorForSingleDoc === 'red'
              ? { originMonthKey: row.originMonthKey, targetMonthKey: currentMonthKey }
              : {}),
          });
        }
      }
    }
  } else {
    if (isInvestmentDisbursementRow && row.isAuto) {
      const disbAssetId =
        row.investmentAssetId ??
        (row.sourceId ? row.sourceId.replace(/^inv_disb_/, '') : '');
      if (disbAssetId) {
        sourceSyncActions.push({
          type: 'investmentDisbursement',
          assetId: disbAssetId,
          color: nextColor,
        });
      }
    }

    const shouldSyncPaid =
      nextColor === 'green' || (nextColor === 'white' && row.color === 'green');

    const shouldSyncOpexColor =
      row.sourceCategory === 'opex' &&
      row.isAuto &&
      (nextColor === 'green' || nextColor === 'white');

    const shouldSyncInvoiceOrPOColor =
      (row.sourceCategory === 'clientInvoice' || row.sourceCategory === 'vendorPO') &&
      row.isAuto &&
      (nextColor === 'green' || nextColor === 'white');

    const shouldSyncCancelInvestmentPending =
      row.section === 'investment' &&
      row.sourceCategory === 'investment' &&
      row.color === 'red' &&
      nextColor === 'white';

    if (
      (shouldSyncPaid ||
        shouldSyncOpexColor ||
        shouldSyncInvoiceOrPOColor ||
        shouldSyncCancelInvestmentPending) &&
      row.isAuto
    ) {
      const paid = nextColor === 'green';
      if (row.sourceCategory === 'clientInvoice') {
        const invoiceId =
          row.clientInvoiceId ?? (row.sourceId ? row.sourceId.replace(/^ci_/, '') : '');
        if (invoiceId) {
          sourceSyncActions.push({
            type: 'clientInvoice',
            invoiceId,
            paid,
            color: nextColor,
          });
        }
      } else if (row.sourceCategory === 'opex') {
        const opexId = row.opexId ?? (row.sourceId ? row.sourceId.replace(/^opex_/, '') : '');
        if (opexId) {
          sourceSyncActions.push({
            type: 'opex',
            opexId,
            monthKey: currentMonthKey,
            paid,
            color: nextColor,
          });
        }
      } else if (row.sourceCategory === 'vendorPO') {
        const poId = row.poId ?? (row.sourceId ? row.sourceId.replace(/^po_/, '') : '');
        if (poId) {
          sourceSyncActions.push({
            type: 'vendorPO',
            poId,
            paid,
            color: nextColor,
          });
        }
      } else if (row.section === 'investment' && row.sourceCategory === 'investment' && row.investmentAssetId) {
        const instMonthKey = row.investmentInstallmentMonthKey || currentMonthKey;
        sourceSyncActions.push({
          type: 'investment',
          assetId: row.investmentAssetId,
          monthKey: instMonthKey,
          component: row.investmentComponent ?? 'principal',
          paid,
          color: nextColor,
        });
      }
    }
  }

  return {
    monthsToSave: Array.from(workingMonths.values()),
    sourceSyncAction: sourceSyncActions[0] ?? null,
    sourceSyncActions,
  };
}
