import {
  BossReportSectionKey,
  BossReportSourceCategory,
  InvestmentComponentKind,
} from '../types/bossReport';
import { ClientInvoice } from '../types/clientInvoice';
import { InvestmentAsset } from '../types/investment';
import { OpexItem } from '../types/opex';
import { PurchaseOrder } from '../types/po';
import {
  BossReportComputedRow,
  computePrincipalBalanceGroupTotals,
  formatBossMonthShortLabel,
  isInvestmentPrincipalBalanceRow,
} from './bossReportCalc';
import { formatIDR, getTodayISODate } from './format';

export interface ProjectionRowGroup {
  groupKey: string;
  section: BossReportSectionKey;
  sourceCategory: BossReportSourceCategory;
  displayName: string;
  baseDescription: string;
  isPrincipalBalance: boolean;
  aggregationBadgeLabel: 'SALDO - Tidak Ditotal' | 'TOTAL AKUMULASI';
  items: BossReportComputedRow[];
  totalProjectedAmount: number;
  totalBaseAmount: number;
  periodRangeBadge: string;
  breakdownText: string;
  pendingSummaryBadges: string[];
  paidCount: number;
  pendingCount: number;
  allGreen: boolean;
  allRed: boolean;
  hasAnyRed: boolean;
  hasAnyGreen: boolean;
  hasAnyLateBadge: boolean;
}

export interface ProjectionGroupingLookups {
  opexById: Map<string, OpexItem>;
  investmentsById: Map<string, InvestmentAsset>;
  poById: Map<string, PurchaseOrder>;
  clientInvoicesById: Map<string, ClientInvoice>;
}

export function buildProjectionGroupingLookups(params: {
  opexItems?: OpexItem[];
  investments?: InvestmentAsset[];
  orders?: PurchaseOrder[];
  clientInvoices?: ClientInvoice[];
}): ProjectionGroupingLookups {
  return {
    opexById: new Map((params.opexItems ?? []).map((o) => [o.id, o])),
    investmentsById: new Map((params.investments ?? []).map((a) => [a.id, a])),
    poById: new Map((params.orders ?? []).map((po) => [po.id, po])),
    clientInvoicesById: new Map((params.clientInvoices ?? []).map((inv) => [inv.id, inv])),
  };
}

function normText(value?: string): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripInvestmentPeriodSuffixes(rawName: string): string {
  return rawName
    .replace(/\s*\(\d+\/\d+\)/g, '')
    .replace(/\s*-\s*Jatuh tempo [^,]+,\s*telat \d+ bulan/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripManualPeriodNoise(rawSubtitle?: string): string {
  if (!rawSubtitle) return '';
  return rawSubtitle
    .replace(/\s*·?\s*DIPENDING KE .+$/i, '')
    .replace(/\s*·?\s*Dipending dari .+$/i, '')
    .replace(/\s*·?\s*JT \d{1,2} [A-Za-z]+ \d{4}.*$/i, '')
    .trim();
}

function formatInvestmentComponentLabel(component?: InvestmentComponentKind): string {
  if (component === 'principal') return 'Pokok';
  if (component === 'interest') return 'Bunga';
  if (component === 'lateFee') return 'Denda';
  if (component === 'bonus') return 'Bonus';
  return 'Angsuran';
}

function resolveGroupIdentity(
  row: BossReportComputedRow,
  lookups: ProjectionGroupingLookups
): {
  groupKey: string;
  displayName: string;
  baseDescription: string;
} {
  if (row.section === 'investment' && row.sourceCategory === 'investment') {
    const asset = row.investmentAssetId
      ? lookups.investmentsById.get(row.investmentAssetId)
      : undefined;
    const comp = row.investmentComponent ?? 'principal';
    const contractNum = asset?.contractNumber?.trim() || '';
    const investorName = asset?.name?.trim() || '';
    const cleanName = stripInvestmentPeriodSuffixes(row.name);
    const compLabel = formatInvestmentComponentLabel(comp);
    const baseDescParts = [
      `Otomatis ${compLabel} Investment`,
      investorName && investorName !== contractNum ? investorName : undefined,
      contractNum || undefined,
    ].filter(Boolean);
    const contractOrAssetKey = normText(contractNum) || row.investmentAssetId || '';
    return {
      groupKey: `inv|${contractOrAssetKey}|${comp}|${normText(cleanName)}`,
      displayName: cleanName || row.name,
      baseDescription: baseDescParts.join(' · '),
    };
  }

  if (row.sourceCategory === 'opex') {
    const opex = row.opexId ? lookups.opexById.get(row.opexId) : undefined;
    const category = opex?.category?.trim() || 'OPERASIONAL';
    const accountName = opex?.sourceAccountName?.trim() || '';
    const isRecurring = Boolean(opex?.isRecurring);
    const cleanName = row.name.trim();
    const baseDescParts = [
      'Operasional',
      category,
      accountName || undefined,
      isRecurring ? 'Recurring' : undefined,
    ].filter(Boolean);
    return {
      groupKey: `opex|${normText(cleanName)}|${normText(category)}|${normText(accountName)}`,
      displayName: cleanName,
      baseDescription: baseDescParts.join(' · '),
    };
  }

  if (row.sourceCategory === 'vendorPO') {
    const po = row.poId ? lookups.poById.get(row.poId) : undefined;
    const vendorName = po?.vendorName?.trim() || '';
    const projectName = po?.projectName?.trim() || '';
    const cleanName = row.name.trim();
    const baseDescParts = [
      'Project Cost',
      'PO Vendor',
      vendorName || undefined,
      projectName || undefined,
    ].filter(Boolean);
    return {
      groupKey: `po|${normText(cleanName)}|${normText(vendorName)}|${normText(projectName)}`,
      displayName: cleanName,
      baseDescription: baseDescParts.join(' · '),
    };
  }

  if (row.sourceCategory === 'clientInvoice') {
    const inv = row.clientInvoiceId
      ? lookups.clientInvoicesById.get(row.clientInvoiceId)
      : undefined;
    const clientName = inv?.clientName?.trim() || '';
    const projectName = inv?.projectName?.trim() || '';
    const cleanName = row.name.trim();
    const baseDescParts = [
      'Invoice Client',
      clientName || undefined,
      projectName || undefined,
    ].filter(Boolean);
    return {
      groupKey: `ci|${normText(cleanName)}|${normText(clientName)}|${normText(projectName)}`,
      displayName: cleanName,
      baseDescription: baseDescParts.join(' · '),
    };
  }

  if (
    row.section === 'cashIn' &&
    (row.cashInSource === 'investmentDisbursement' ||
      (row.sourceId && row.sourceId.startsWith('inv_disb_')))
  ) {
    const asset = row.investmentAssetId
      ? lookups.investmentsById.get(row.investmentAssetId)
      : undefined;
    const contractNum = asset?.contractNumber?.trim() || '';
    const cleanName = row.name.trim();
    const baseDescParts = [
      'Pencairan Pinjaman Investment',
      contractNum || undefined,
      asset?.name?.trim() || undefined,
    ].filter(Boolean);
    return {
      groupKey: `disb|${normText(cleanName)}|${normText(contractNum)}`,
      displayName: cleanName,
      baseDescription: baseDescParts.join(' · '),
    };
  }

  if (row.projectionManualItemId) {
    const cleanName = row.name.trim();
    const baseSub = stripManualPeriodNoise(row.subtitle);
    return {
      groupKey: `pmi|${row.section}|${row.projectionManualItemId}`,
      displayName: cleanName,
      baseDescription: baseSub || 'Manual - Sekali Pakai · Non Rutin',
    };
  }

  const cleanName = row.name.trim();
  const baseSub = stripManualPeriodNoise(row.subtitle);
  const fallbackSectionLabel =
    row.section === 'operasional'
      ? 'Operasional · Manual'
      : row.section === 'investment'
      ? 'Investment · Manual'
      : row.section === 'projectCost'
      ? 'Project Cost · Manual'
      : 'Cash In · Manual';
  const baseDescription = baseSub || fallbackSectionLabel;
  return {
    groupKey: `manual|${row.section}|${normText(cleanName)}|${normText(baseDescription)}`,
    displayName: cleanName,
    baseDescription,
  };
}

function formatBreakdownSegment(item: BossReportComputedRow): string {
  const mk = item.sourceMonthKey ?? item.originMonthKey;
  const monthLabel = formatBossMonthShortLabel(mk);
  if (item.color === 'red') {
    const target = item.rescheduledToMonth
      ? ` → ${formatBossMonthShortLabel(item.rescheduledToMonth)}`
      : '';
    return `${monthLabel} (Rp 0 · Pending${target})`;
  }
  if (item.isRescheduledIn) {
    const todayISO = getTodayISODate();
    const isActuallyDue = item.dueISO
      ? todayISO >= item.dueISO
      : todayISO.slice(0, 7) >= item.originMonthKey;
    if (item.color === 'green') {
      return `${monthLabel} (Rp ${formatIDR(item.projectedAmount)} · Paid)`;
    }
    if (isActuallyDue) {
      const tunggakanMK = item.dueISO ? item.dueISO.slice(0, 7) : item.originMonthKey;
      return `${monthLabel} (Rp ${formatIDR(item.projectedAmount)} · Tunggakan ${formatBossMonthShortLabel(
        tunggakanMK
      )})`;
    }
    return `${monthLabel} (Rp ${formatIDR(item.projectedAmount)} · Projection)`;
  }
  if (item.color === 'green') {
    return `${monthLabel} (Rp ${formatIDR(item.projectedAmount)} · Paid)`;
  }
  return `${monthLabel} (Rp ${formatIDR(item.projectedAmount)})`;
}

export function groupProjectionRows(
  rows: BossReportComputedRow[],
  lookups: ProjectionGroupingLookups
): ProjectionRowGroup[] {
  const orderedGroups: Array<{
    groupKey: string;
    section: BossReportSectionKey;
    sourceCategory: BossReportSourceCategory;
    displayName: string;
    baseDescription: string;
    items: BossReportComputedRow[];
  }> = [];
  const byKey = new Map<string, (typeof orderedGroups)[number]>();

  for (const row of rows) {
    const id = resolveGroupIdentity(row, lookups);
    let bucket = byKey.get(id.groupKey);
    if (!bucket) {
      bucket = {
        groupKey: id.groupKey,
        section: row.section,
        sourceCategory: row.sourceCategory,
        displayName: id.displayName,
        baseDescription: id.baseDescription,
        items: [],
      };
      byKey.set(id.groupKey, bucket);
      orderedGroups.push(bucket);
    }
    bucket.items.push(row);
  }

  return orderedGroups.map((bucket) => {
    const sortedItems = [...bucket.items].sort((a, b) => {
      const mkA = a.sourceMonthKey ?? a.originMonthKey;
      const mkB = b.sourceMonthKey ?? b.originMonthKey;
      const cmp = mkA.localeCompare(mkB);
      if (cmp !== 0) return cmp;
      if (Boolean(a.isRescheduledIn) !== Boolean(b.isRescheduledIn)) {
        return a.isRescheduledIn ? -1 : 1;
      }
      return 0;
    });

    const isPrincipalBalance = sortedItems.some((r) =>
      isInvestmentPrincipalBalanceRow(r, lookups.investmentsById)
    );
    const aggregationBadgeLabel: 'SALDO - Tidak Ditotal' | 'TOTAL AKUMULASI' =
      isPrincipalBalance ? 'SALDO - Tidak Ditotal' : 'TOTAL AKUMULASI';

    const uniqueMonths = Array.from(
      new Set(sortedItems.map((r) => r.sourceMonthKey ?? r.originMonthKey))
    ).sort();
    const periodRangeBadge =
      uniqueMonths.length <= 1
        ? formatBossMonthShortLabel(uniqueMonths[0] ?? '')
        : `${formatBossMonthShortLabel(uniqueMonths[0])} - ${formatBossMonthShortLabel(
            uniqueMonths[uniqueMonths.length - 1]
          )}`;

    let totalProjectedAmount = 0;
    let totalBaseAmount = 0;
    let breakdownText = '';

    if (isPrincipalBalance) {
      const principalTotals = computePrincipalBalanceGroupTotals(sortedItems);
      totalProjectedAmount = principalTotals.projectedAmount;
      totalBaseAmount = principalTotals.baseAmount;

      if (sortedItems.length > 1) {
        const lastItem = sortedItems[sortedItems.length - 1];
        const lastMonthLabel = formatBossMonthShortLabel(
          lastItem.sourceMonthKey ?? lastItem.originMonthKey
        );
        const monthLabels = uniqueMonths.map((mk) => formatBossMonthShortLabel(mk));
        const displayNominal =
          totalProjectedAmount > 0 ? totalProjectedAmount : totalBaseAmount;
        const distinctBaseAmounts = new Set(sortedItems.map((r) => r.amount));
        if (distinctBaseAmounts.size <= 1) {
          breakdownText = `Pokok Outstanding per ${lastMonthLabel}: Rp ${formatIDR(
            displayNominal
          )} (bukan akumulasi, saldo tetap sama di ${monthLabels.join(', ')})`;
        } else {
          breakdownText = `Pokok Outstanding per ${lastMonthLabel}: Rp ${formatIDR(
            displayNominal
          )} (bukan akumulasi · ${sortedItems.map(formatBreakdownSegment).join(' · ')})`;
        }
      } else {
        breakdownText = formatBreakdownSegment(sortedItems[0]);
      }
    } else {
      totalProjectedAmount = sortedItems.reduce(
        (sum, r) => sum + r.projectedAmount,
        0
      );
      totalBaseAmount = sortedItems.reduce((sum, r) => sum + r.amount, 0);
      breakdownText =
        sortedItems.length > 1
          ? `${sortedItems.map(formatBreakdownSegment).join(' + ')} - Total ${sortedItems.length}x`
          : formatBreakdownSegment(sortedItems[0]);
    }

    const pendingItems = sortedItems.filter((r) => r.color === 'red');
    const pendingByTarget = new Map<string, number>();
    for (const p of pendingItems) {
      const target = p.rescheduledToMonth ?? '';
      pendingByTarget.set(target, (pendingByTarget.get(target) ?? 0) + 1);
    }
    const pendingSummaryBadges = Array.from(pendingByTarget.entries()).map(
      ([targetMk, count]) =>
        `${count} dari ${sortedItems.length} periode Dipending${
          targetMk ? ` ke ${formatBossMonthShortLabel(targetMk)}` : ''
        }`
    );

    const paidCount = sortedItems.filter((r) => r.color === 'green').length;
    const pendingCount = pendingItems.length;

    return {
      groupKey: bucket.groupKey,
      section: bucket.section,
      sourceCategory: bucket.sourceCategory,
      displayName: bucket.displayName,
      baseDescription: bucket.baseDescription,
      isPrincipalBalance,
      aggregationBadgeLabel,
      items: sortedItems,
      totalProjectedAmount,
      totalBaseAmount,
      periodRangeBadge,
      breakdownText,
      pendingSummaryBadges,
      paidCount,
      pendingCount,
      allGreen: paidCount === sortedItems.length,
      allRed: pendingCount === sortedItems.length,
      hasAnyRed: pendingCount > 0,
      hasAnyGreen: paidCount > 0,
      hasAnyLateBadge: sortedItems.some((r) => Boolean(r.dueBadgeLabel)),
    };
  });
}
