import {
  deterministicUuid,
  invalidateSupabaseTableSchema,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseTableSchema,
} from '../lib/supabaseClient';
import {
  extractMissingColumnFromError,
  extractNotNullColumnFromError,
  getObservedTableColumns,
  isDateSyntaxSupabaseError,
  isMissingColumnSupabaseError,
  isNumericColumnSchema,
  packArrayWithMeta,
  packObjectWithMeta,
  recordObservedTableColumns,
  removeObservedTableColumn,
  resolveTableWhitelistSchema,
  sanitizePayloadByWhitelist,
  unpackArrayWithMeta,
  unpackObjectWithMeta,
} from '../lib/supabaseWhitelist';
import {
  BankAccountRow,
  BOSS_REPORT_SCHEMA_LIMITS,
  BossReportAutoOverride,
  BossReportColorStatus,
  BossReportManualItem,
  BossReportMonthData,
  BossReportRescheduledItem,
  BossReportSectionKey,
  BossReportSourceCategory,
  DEFAULT_BANK_ACCOUNT_NAMES,
  InvestmentComponentKind,
  RolloverKind,
} from '../types/bossReport';
import { DEFAULT_INVESTMENT_CUTOFF_DATE } from '../types/investment';
import { getTodayISODate, normalizeToIsoDate } from '../utils/format';
import { normalizeMonthKeyYYYYMM } from '../utils/bossReportCalc';

const TABLE_NAME = 'boss_report_months';
const CUTOFF_GLOBAL_STORAGE_KEY = 'kkb_cutoff_global_bunga_by_month_v1';
const BOSS_REPORT_MONTHS_CACHE_KEY = 'kkb_boss_report_months_cache_v1';

function sanitizeRolloverKind(val: unknown): RolloverKind | undefined {
  return val === 'pending' || val === 'auto' ? val : undefined;
}

export function loadCutoffGlobalDateMapLocal(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CUTOFF_GLOBAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(k)) continue;
      const iso = normalizeToIsoDate(v);
      if (iso) out[k] = iso;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCutoffGlobalDateLocal(monthKey: string, cutoffDateISO?: string): void {
  if (typeof window === 'undefined') return;
  if (!BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(monthKey)) return;
  try {
    const map = loadCutoffGlobalDateMapLocal();
    const iso = normalizeToIsoDate(cutoffDateISO);
    if (iso) {
      map[monthKey] = iso;
    } else {
      delete map[monthKey];
    }
    window.localStorage.setItem(CUTOFF_GLOBAL_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Abaikan error quota / private mode
  }
}

export function resolveCutoffGlobalDateForMonth(
  monthKey: string,
  bossReportMonths?: Record<string, BossReportMonthData>,
  monthDataOverride?: Partial<BossReportMonthData>
): string {
  const fromOverride = normalizeToIsoDate(monthDataOverride?.cutoffGlobalDate);
  if (fromOverride) return fromOverride;

  const fromMonth = normalizeToIsoDate(bossReportMonths?.[monthKey]?.cutoffGlobalDate);
  if (fromMonth) return fromMonth;

  const fromLocal = normalizeToIsoDate(loadCutoffGlobalDateMapLocal()[monthKey]);
  if (fromLocal) return fromLocal;

  return DEFAULT_INVESTMENT_CUTOFF_DATE;
}

type BossReportListener = (monthsMap: Record<string, BossReportMonthData>) => void;
const listeners = new Set<BossReportListener>();
let latestMonthsMap: Record<string, BossReportMonthData> = {};
let hasHydratedLocalCache = false;
let channelSeq = 0;

const VALID_SECTIONS = new Set<BossReportSectionKey>([
  'cashIn',
  'operasional',
  'investment',
  'projectCost',
]);
const VALID_CATEGORIES = new Set<BossReportSourceCategory>([
  'clientInvoice',
  'opex',
  'investment',
  'vendorPO',
  'manual',
]);
const VALID_INV_COMPONENTS = new Set<InvestmentComponentKind>([
  'principal',
  'interest',
  'lateFee',
  'bonus',
]);

const BOSS_REPORT_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'month_key',
  'as_of_date',
  'accounts',
  'cash_in_manual',
  'operasional',
  'investment',
  'project_cost_manual',
  'auto_overrides',
  'rescheduled_in',
  'updated_at',
]);

const BOSS_REPORT_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'updated_at',
]);

const CONFLICT_COLUMN_CANDIDATES = [
  'month_key',
  'month',
  'periode',
  'period',
  'month_id',
  'id',
] as const;

const discoveredExcludedBossColumns = new Set<string>();
let cachedBossConflictColumn: string | null = null;
let cachedIdNeedsUuid = false;

function sanitizeColorWithReschedule(
  value: unknown,
  rescheduledToMonth?: string
): { color: BossReportColorStatus; rescheduledToMonth?: string } {
  const s = String(value ?? 'white');
  if (s === 'green') {
    return { color: 'green' };
  }
  if (
    s === 'red' &&
    rescheduledToMonth &&
    BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(rescheduledToMonth)
  ) {
    return { color: 'red', rescheduledToMonth };
  }
  return { color: 'white' };
}

export function createDefaultBankAccounts(): BankAccountRow[] {
  return DEFAULT_BANK_ACCOUNT_NAMES.map((name, idx) => ({
    id: `acc_default_${idx + 1}`,
    name,
    balance: 0,
    isPrimary: idx === 0,
  }));
}

export function createDefaultBossReportMonth(monthKey: string): BossReportMonthData {
  return {
    monthKey,
    asOfDate: getTodayISODate(),
    accounts: createDefaultBankAccounts(),
    cashInManual: [],
    operasional: [],
    investment: [],
    projectCostManual: [],
    autoOverrides: [],
    rescheduledIn: [],
  };
}

function sanitizeAccounts(raw: unknown): BankAccountRow[] {
  if (!Array.isArray(raw)) return createDefaultBankAccounts();
  return raw
    .slice(0, BOSS_REPORT_SCHEMA_LIMITS.maxAccounts)
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row, idx) => {
      const id = String(row.id ?? `acc_${idx + 1}`).trim().slice(0, 64) || `acc_${idx + 1}`;
      const name =
        String(row.name ?? 'Rekening')
          .trim()
          .slice(0, BOSS_REPORT_SCHEMA_LIMITS.accountNameMax) || 'Rekening';
      const rawBal = Number(row.balance ?? 0);
      const balance = Number.isFinite(rawBal)
        ? Math.max(
            -BOSS_REPORT_SCHEMA_LIMITS.maxAmount,
            Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(rawBal))
          )
        : 0;
      return {
        id,
        name,
        balance,
        ...(row.isPrimary === true ? { isPrimary: true } : {}),
      };
    });
}

function parseOptionalActualAmount(row: Record<string, unknown>): number | undefined {
  const raw =
    row.actualAmount ??
    row.actual_amount ??
    row.realisasiAmount ??
    row.realisasi_amount ??
    row.realisasi;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(num)));
}

function sanitizeItems(raw: unknown): BossReportManualItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, BOSS_REPORT_SCHEMA_LIMITS.maxItemsPerGroup)
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row, idx) => {
      const id = String(row.id ?? `item_${idx + 1}`).trim().slice(0, 64) || `item_${idx + 1}`;
      const name =
        String(row.name ?? 'Item')
          .trim()
          .slice(0, BOSS_REPORT_SCHEMA_LIMITS.itemNameMax) || 'Item';
      const rawAmt = Number(row.amount ?? 0);
      const amount = Number.isFinite(rawAmt)
        ? Math.max(0, Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(rawAmt)))
        : 0;
      const rawTarget =
        typeof row.rescheduledToMonth === 'string' ? row.rescheduledToMonth.trim().slice(0, 7) : undefined;
      const { color, rescheduledToMonth } = sanitizeColorWithReschedule(row.color, rawTarget);
      const actualAmount = color === 'green' ? parseOptionalActualAmount(row) : undefined;
      const accountId = row.accountId ? String(row.accountId).trim().slice(0, 64) : undefined;
      const rolloverKind = sanitizeRolloverKind(row.rolloverKind);
      return {
        id,
        name,
        amount,
        ...(actualAmount !== undefined
          ? { actualAmount, realisasiAmount: actualAmount, actual_amount: actualAmount }
          : {}),
        color,
        ...(accountId ? { accountId } : {}),
        ...(rescheduledToMonth ? { rescheduledToMonth } : {}),
        ...(rolloverKind ? { rolloverKind } : {}),
      };
    });
}

function sanitizeOverrides(raw: unknown): BossReportAutoOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, BOSS_REPORT_SCHEMA_LIMITS.maxOverrides)
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row) => {
      const sourceId = String(row.sourceId ?? '').trim().slice(0, 128);
      const hasCustomName = Boolean(row.hasCustomName);
      const name = String(row.name ?? '').trim().slice(0, BOSS_REPORT_SCHEMA_LIMITS.itemNameMax);
      const hasCustomAmount = Boolean(row.hasCustomAmount);
      const rawAmt = Number(row.amount ?? 0);
      const amount = Number.isFinite(rawAmt)
        ? Math.max(0, Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(rawAmt)))
        : 0;
      const hasCustomColor = Boolean(row.hasCustomColor);
      const rawTarget =
        typeof row.rescheduledToMonth === 'string' ? row.rescheduledToMonth.trim().slice(0, 7) : undefined;
      const { color, rescheduledToMonth } = sanitizeColorWithReschedule(row.color, rawTarget);
      const parsedReal = parseOptionalActualAmount(row);
      const hasCustomRealisasi =
        (row.hasCustomRealisasi === true || parsedReal !== undefined) &&
        parsedReal !== undefined;
      const rolloverKind = sanitizeRolloverKind(row.rolloverKind);
      return {
        sourceId,
        hasCustomName,
        name,
        hasCustomAmount,
        amount,
        ...(hasCustomRealisasi && parsedReal !== undefined
          ? {
              hasCustomRealisasi: true,
              realisasiAmount: parsedReal,
              actual_amount: parsedReal,
            }
          : {}),
        hasCustomColor,
        color,
        ...(rescheduledToMonth ? { rescheduledToMonth } : {}),
        ...(rolloverKind ? { rolloverKind } : {}),
      };
    })
    .filter((row) => Boolean(row.sourceId));
}

function sanitizeRescheduledIn(raw: unknown): BossReportRescheduledItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, BOSS_REPORT_SCHEMA_LIMITS.maxRescheduledIn)
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map((row, idx): BossReportRescheduledItem | null => {
      const id = String(row.id ?? `rs_${idx + 1}`).trim().slice(0, 160);
      const sourceId = String(row.sourceId ?? '').trim().slice(0, 160);
      const section = VALID_SECTIONS.has(row.section as BossReportSectionKey)
        ? (row.section as BossReportSectionKey)
        : 'operasional';
      const sourceCategory = VALID_CATEGORIES.has(row.sourceCategory as BossReportSourceCategory)
        ? (row.sourceCategory as BossReportSourceCategory)
        : 'manual';
      const originMonthKey = String(row.originMonthKey ?? '').trim().slice(0, 7);
      const rawFrom = String(row.rescheduledFromMonth ?? row.fromMonthKey ?? '').trim().slice(0, 7);
      const fromMonthKey = rawFrom;
      if (
        !id ||
        !sourceId ||
        !BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(originMonthKey) ||
        !BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(fromMonthKey)
      ) {
        return null;
      }

      const rawHistory = Array.isArray(row.historyMonths)
        ? row.historyMonths
            .map((m) => String(m ?? '').trim().slice(0, 7))
            .filter((m) => BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(m))
            .slice(0, 36)
        : [originMonthKey, fromMonthKey];
      const historyMonths = rawHistory.length >= 2 ? rawHistory : [originMonthKey, fromMonthKey];

      const name =
        String(row.name ?? 'Item Reschedule')
          .trim()
          .slice(0, BOSS_REPORT_SCHEMA_LIMITS.itemNameMax) || 'Item Reschedule';
      const rawAmt = Number(row.amount ?? 0);
      const amount = Number.isFinite(rawAmt)
        ? Math.max(0, Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(rawAmt)))
        : 0;
      const rawTarget =
        typeof row.rescheduledToMonth === 'string'
          ? row.rescheduledToMonth.trim().slice(0, 7)
          : undefined;
      const { color, rescheduledToMonth } = sanitizeColorWithReschedule(row.color, rawTarget);
      const parsedReal = parseOptionalActualAmount(row);
      const hasCustomRealisasi =
        color === 'green' &&
        (row.hasCustomRealisasi === true || parsedReal !== undefined) &&
        parsedReal !== undefined;
      const accountId = row.accountId ? String(row.accountId).trim().slice(0, 64) : undefined;
      const rawDue = typeof row.dueISO === 'string' ? row.dueISO.trim().slice(0, 10) : '';
      const dueISO = BOSS_REPORT_SCHEMA_LIMITS.datePattern.test(rawDue) ? rawDue : undefined;
      const investmentAssetId = row.investmentAssetId
        ? String(row.investmentAssetId).trim().slice(0, 64)
        : undefined;
      const investmentComponent = VALID_INV_COMPONENTS.has(
        row.investmentComponent as InvestmentComponentKind
      )
        ? (row.investmentComponent as InvestmentComponentKind)
        : undefined;
      const rawInstNum = Number(row.investmentInstallmentNumber);
      const investmentInstallmentNumber =
        Number.isFinite(rawInstNum) && rawInstNum >= 0 && rawInstNum <= 600
          ? Math.round(rawInstNum)
          : undefined;
      const rawInstMk =
        typeof row.investmentInstallmentMonthKey === 'string'
          ? row.investmentInstallmentMonthKey.trim().slice(0, 7)
          : '';
      const investmentInstallmentMonthKey = BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(
        rawInstMk
      )
        ? rawInstMk
        : undefined;
      const hasCustomOverride = row.hasCustomOverride === true ? true : undefined;
      const rolloverKind = sanitizeRolloverKind(row.rolloverKind);

      return {
        id,
        section,
        sourceCategory,
        sourceId,
        originMonthKey,
        fromMonthKey,
        rescheduledFromMonth: fromMonthKey,
        historyMonths,
        name,
        amount,
        ...(hasCustomRealisasi && parsedReal !== undefined
          ? {
              hasCustomRealisasi: true,
              realisasiAmount: parsedReal,
              actual_amount: parsedReal,
            }
          : {}),
        color,
        ...(accountId ? { accountId } : {}),
        ...(dueISO ? { dueISO } : {}),
        ...(rescheduledToMonth ? { rescheduledToMonth } : {}),
        ...(rolloverKind ? { rolloverKind } : {}),
        ...(investmentAssetId ? { investmentAssetId } : {}),
        ...(investmentComponent ? { investmentComponent } : {}),
        ...(investmentInstallmentNumber !== undefined ? { investmentInstallmentNumber } : {}),
        ...(investmentInstallmentMonthKey ? { investmentInstallmentMonthKey } : {}),
        ...(hasCustomOverride ? { hasCustomOverride } : {}),
      };
    })
    .filter((row): row is BossReportRescheduledItem => row !== null);
}

export function sanitizeBossReportMonth(
  input: Partial<BossReportMonthData> & { monthKey: string }
): BossReportMonthData {
  const monthKey = BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(input.monthKey)
    ? input.monthKey
    : getTodayISODate().slice(0, 7);
  const rawDate = String(input.asOfDate ?? '').trim().slice(0, 10);
  const asOfDate = BOSS_REPORT_SCHEMA_LIMITS.datePattern.test(rawDate)
    ? rawDate
    : getTodayISODate();
  const cutoffGlobalDate = normalizeToIsoDate(input.cutoffGlobalDate) ?? undefined;

  const rawManualOpening =
    typeof input.manualOpeningBalance === 'number' && Number.isFinite(input.manualOpeningBalance)
      ? Math.max(
          -BOSS_REPORT_SCHEMA_LIMITS.maxAmount,
          Math.min(BOSS_REPORT_SCHEMA_LIMITS.maxAmount, Math.round(input.manualOpeningBalance))
        )
      : undefined;

  return {
    monthKey,
    asOfDate,
    ...(cutoffGlobalDate ? { cutoffGlobalDate } : {}),
    accounts: sanitizeAccounts(input.accounts),
    ...(rawManualOpening !== undefined ? { manualOpeningBalance: rawManualOpening } : {}),
    cashInManual: sanitizeItems(input.cashInManual),
    operasional: sanitizeItems(input.operasional),
    investment: sanitizeItems(input.investment),
    projectCostManual: sanitizeItems(input.projectCostManual),
    autoOverrides: sanitizeOverrides(input.autoOverrides),
    rescheduledIn: sanitizeRescheduledIn(input.rescheduledIn),
    updatedAt: input.updatedAt,
  };
}

export function normalizeBossReportDbRow(
  raw: Record<string, unknown>
): BossReportMonthData | null {
  const { items: unpackedAccounts, meta: accountsMeta } =
    unpackArrayWithMeta<BankAccountRow>(raw.accounts);
  const { items: unpackedCashIn, meta: cashInMeta } =
    unpackArrayWithMeta<BossReportManualItem>(raw.cash_in_manual ?? raw.cashInManual);
  const { items: unpackedOperasional, meta: operasionalMeta } =
    unpackArrayWithMeta<BossReportManualItem>(
      raw.operasional ?? raw.operational ?? raw.operational_items
    );
  const { items: unpackedInvestment, meta: investmentMeta } =
    unpackArrayWithMeta<BossReportManualItem>(raw.investment);
  const { items: unpackedProjectCost, meta: projectCostMeta } =
    unpackArrayWithMeta<BossReportManualItem>(
      raw.project_cost_manual ?? raw.projectCostManual
    );
  const { items: unpackedAutoOverrides, meta: autoOverridesMeta } =
    unpackArrayWithMeta<BossReportAutoOverride>(
      raw.auto_overrides ?? raw.autoOverrides
    );
  const { items: unpackedRescheduledIn, meta: rescheduledInMeta } =
    unpackArrayWithMeta<BossReportRescheduledItem>(
      raw.rescheduled_in ?? raw.rescheduledIn
    );
  const { data: blobData, meta: blobMeta } = unpackObjectWithMeta(
    raw.data ?? raw.payload
  );

  const meta: Record<string, unknown> = {
    ...blobData,
    ...blobMeta,
    ...rescheduledInMeta,
    ...autoOverridesMeta,
    ...projectCostMeta,
    ...investmentMeta,
    ...operasionalMeta,
    ...cashInMeta,
    ...accountsMeta,
  };

  const key = String(
    raw.month_key ??
      raw.monthKey ??
      raw.month ??
      raw.periode ??
      raw.period ??
      raw.month_id ??
      meta.month_key ??
      meta.monthKey ??
      raw.id ??
      ''
  )
    .trim()
    .slice(0, 7);
  if (!BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(key)) return null;

  const rawManual =
    raw.manual_opening_balance ??
    raw.manualOpeningBalance ??
    meta.manual_opening_balance ??
    meta.manualOpeningBalance;
  const manualOpeningBalance =
    rawManual !== undefined && rawManual !== null && Number.isFinite(Number(rawManual))
      ? Number(rawManual)
      : undefined;

  const fallbackCashIn = unpackArrayWithMeta<BossReportManualItem>(
    meta.cash_in_manual ?? meta.cashInManual
  ).items;
  const fallbackOperasional = unpackArrayWithMeta<BossReportManualItem>(
    meta.operasional ?? meta.operational ?? meta.operational_items
  ).items;
  const fallbackInvestment = unpackArrayWithMeta<BossReportManualItem>(
    meta.investment
  ).items;
  const fallbackProjectCost = unpackArrayWithMeta<BossReportManualItem>(
    meta.project_cost_manual ?? meta.projectCostManual
  ).items;
  const fallbackOverrides = unpackArrayWithMeta<BossReportAutoOverride>(
    meta.auto_overrides ?? meta.autoOverrides
  ).items;
  const fallbackRescheduled = unpackArrayWithMeta<BossReportRescheduledItem>(
    meta.rescheduled_in ?? meta.rescheduledIn
  ).items;

  const cutoffGlobalDate =
    normalizeToIsoDate(
      raw.cutoff_global_date ??
        raw.cutoffGlobalDate ??
        meta.cutoff_global_date ??
        meta.cutoffGlobalDate
    ) ?? undefined;
  if (cutoffGlobalDate) {
    saveCutoffGlobalDateLocal(key, cutoffGlobalDate);
  }

  return sanitizeBossReportMonth({
    monthKey: key,
    asOfDate: String(
      raw.as_of_date ?? raw.asOfDate ?? meta.as_of_date ?? getTodayISODate()
    ),
    ...(cutoffGlobalDate ? { cutoffGlobalDate } : {}),
    accounts: unpackedAccounts.length > 0 ? unpackedAccounts : createDefaultBankAccounts(),
    manualOpeningBalance,
    cashInManual: unpackedCashIn.length > 0 ? unpackedCashIn : fallbackCashIn,
    operasional: unpackedOperasional.length > 0 ? unpackedOperasional : fallbackOperasional,
    investment: unpackedInvestment.length > 0 ? unpackedInvestment : fallbackInvestment,
    projectCostManual:
      unpackedProjectCost.length > 0 ? unpackedProjectCost : fallbackProjectCost,
    autoOverrides:
      unpackedAutoOverrides.length > 0 ? unpackedAutoOverrides : fallbackOverrides,
    rescheduledIn:
      unpackedRescheduledIn.length > 0 ? unpackedRescheduledIn : fallbackRescheduled,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  });
}

function normalizeDbRow(raw: Record<string, unknown>): BossReportMonthData | null {
  return normalizeBossReportDbRow(raw);
}

function resolveBossConflictColumn(
  schema: SupabaseTableSchema | null,
  excludedColumns?: ReadonlySet<string>
): string {
  const isAllowed = (col: string) => {
    if (excludedColumns?.has(col)) return false;
    if (schema && schema.columns.size > 0) return schema.columns.has(col);
    return true;
  };

  if (cachedBossConflictColumn && isAllowed(cachedBossConflictColumn)) {
    return cachedBossConflictColumn;
  }

  for (const col of CONFLICT_COLUMN_CANDIDATES) {
    if (isAllowed(col)) return col;
  }
  return 'id';
}

function toRawBossReportDbRecord(
  data: BossReportMonthData,
  options?: { idNeedsUuid?: boolean; conflictColumn?: string }
): Record<string, unknown> {
  const idVal = options?.idNeedsUuid
    ? deterministicUuid(`boss_report:${data.monthKey}`)
    : data.monthKey;

  return {
    id: idVal,
    month_key: data.monthKey,
    month: data.monthKey,
    periode: data.monthKey,
    period: data.monthKey,
    month_id: data.monthKey,
    as_of_date: data.asOfDate,
    cutoff_global_date: normalizeToIsoDate(data.cutoffGlobalDate) ?? null,
    accounts: data.accounts,
    manual_opening_balance:
      typeof data.manualOpeningBalance === 'number' && Number.isFinite(data.manualOpeningBalance)
        ? data.manualOpeningBalance
        : null,
    cash_in_manual: data.cashInManual,
    operasional: data.operasional,
    investment: data.investment,
    project_cost_manual: data.projectCostManual,
    auto_overrides: data.autoOverrides,
    rescheduled_in: data.rescheduledIn ?? [],
    data: {},
    payload: {},
    updated_at: new Date().toISOString(),
  };
}

export function sanitizeBossReportDbPayload(
  data: BossReportMonthData,
  schema: SupabaseTableSchema | null,
  excludedColumns?: ReadonlySet<string>,
  options?: { idNeedsUuid?: boolean; conflictColumn?: string }
): Record<string, unknown> {
  const idColMeta = schema?.columns.get('id');
  const idIsAutoNumeric =
    isNumericColumnSchema(idColMeta) || Boolean(excludedColumns?.has('id'));
  const idNeedsUuid =
    options?.idNeedsUuid ??
    (cachedIdNeedsUuid || (idColMeta?.format ?? '').toLowerCase() === 'uuid');

  const conflictCol =
    options?.conflictColumn ?? resolveBossConflictColumn(schema, excludedColumns);
  const rawRecord = toRawBossReportDbRecord(data, {
    idNeedsUuid,
    conflictColumn: conflictCol,
  });
  if (idIsAutoNumeric) {
    delete rawRecord.id;
  }

  // Bila tabel tidak memiliki month_key maupun schema (kosong), pastikan conflictCol juga diizinkan pada fallback
  const effectiveFallback = new Set<string>(BOSS_REPORT_FALLBACK_WHITELIST);
  if (conflictCol && (conflictCol !== 'id' || !idIsAutoNumeric)) {
    effectiveFallback.add(conflictCol);
  }
  if ((schema?.columns.has('id') || conflictCol === 'id') && !idIsAutoNumeric) {
    effectiveFallback.add('id');
  }

  const effectiveExcludeFromDropped = new Set<string>(BOSS_REPORT_EXCLUDE_FROM_DROPPED);
  // Jangan masukkan alias key lain yang tidak terpakai ke dropped metadata agar rapi, KECUALI month_key
  for (const aliasCol of ['month', 'periode', 'period', 'month_id', 'data', 'payload'] as const) {
    if (aliasCol !== conflictCol && !schema?.columns.has(aliasCol)) {
      effectiveExcludeFromDropped.add(aliasCol);
    }
  }
  if (idIsAutoNumeric || (schema?.columns.has('id') && conflictCol !== 'id')) {
    effectiveExcludeFromDropped.add('id');
  }

  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: rawRecord,
    fallbackColumns: effectiveFallback,
    schema,
    aliases: {
      operasional: ['operational', 'operational_items'],
    },
    excludeFromDropped: effectiveExcludeFromDropped,
    excludedColumns,
  });

  // Pastikan month_key selalu tersimpan di payload atau metadata jika kolom month_key tidak ada
  if (!('month_key' in payload)) {
    dropped.month_key = data.monthKey;
  }

  if (Object.keys(dropped).length > 0) {
    if ('accounts' in payload) {
      payload.accounts = packArrayWithMeta(data.accounts, dropped);
    } else if ('cash_in_manual' in payload) {
      payload.cash_in_manual = packArrayWithMeta(data.cashInManual, dropped);
    } else if ('operasional' in payload) {
      payload.operasional = packArrayWithMeta(data.operasional, dropped);
    } else if ('data' in payload) {
      payload.data = packObjectWithMeta(
        {
          month_key: data.monthKey,
          as_of_date: data.asOfDate,
          accounts: data.accounts,
          cash_in_manual: data.cashInManual,
          operasional: data.operasional,
          investment: data.investment,
          project_cost_manual: data.projectCostManual,
          auto_overrides: data.autoOverrides,
          rescheduled_in: data.rescheduledIn ?? [],
        },
        dropped
      );
    } else if ('payload' in payload) {
      payload.payload = packObjectWithMeta(
        {
          month_key: data.monthKey,
          as_of_date: data.asOfDate,
          accounts: data.accounts,
        },
        dropped
      );
    }
  }

  return payload;
}

function loadBossReportMonthsLocal(): Record<string, BossReportMonthData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BOSS_REPORT_MONTHS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, BossReportMonthData> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!BOSS_REPORT_SCHEMA_LIMITS.monthKeyPattern.test(k)) continue;
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      out[k] = sanitizeBossReportMonth({
        ...(v as Partial<BossReportMonthData>),
        monthKey: k,
      });
    }
    return out;
  } catch {
    return {};
  }
}

function saveBossReportMonthsLocal(monthsMap: Record<string, BossReportMonthData>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOSS_REPORT_MONTHS_CACHE_KEY, JSON.stringify(monthsMap));
  } catch {
    // Abaikan error quota / private mode
  }
}

function ensureLocalCacheHydrated(): void {
  if (hasHydratedLocalCache) return;
  hasHydratedLocalCache = true;
  const cached = loadBossReportMonthsLocal();
  if (Object.keys(cached).length > 0) {
    latestMonthsMap = {
      ...cached,
      ...latestMonthsMap,
    };
  }
}

function notifyListeners(monthsMap: Record<string, BossReportMonthData>): void {
  latestMonthsMap = monthsMap;
  hasHydratedLocalCache = true;
  saveBossReportMonthsLocal(monthsMap);
  for (const listener of listeners) {
    listener(monthsMap);
  }
}

export async function getBossReportMonths(): Promise<Record<string, BossReportMonthData>> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Konfigurasi Supabase belum lengkap', configError, {
      showAlert: false,
    });
  }

  const { data, error } = await client.from(TABLE_NAME).select('*');
  if (error) {
    throw reportSupabaseError('Gagal mengambil boss_report_months dari Supabase', error, {
      showAlert: false,
    });
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const map: Record<string, BossReportMonthData> = {};
  for (const rawRow of data ?? []) {
    const normalized = normalizeDbRow(rawRow as Record<string, unknown>);
    if (normalized) {
      map[normalized.monthKey] = normalized;
    }
  }
  return map;
}

export async function getBossReportMonthsByRange(
  startMonthKey: string,
  endMonthKey: string
): Promise<Record<string, BossReportMonthData>> {
  const client = requireSupabaseClient();
  const safeStart = normalizeMonthKeyYYYYMM(startMonthKey);
  const safeEnd = normalizeMonthKeyYYYYMM(endMonthKey);
  const observed = getObservedTableColumns(TABLE_NAME);

  let query = client.from(TABLE_NAME).select('*');
  const monthCol = ['month_key', 'month', 'periode', 'period', 'month_id'].find(
    (col) => observed?.has(col)
  );
  if (monthCol) {
    query = query.gte(monthCol, safeStart).lte(monthCol, safeEnd);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Gagal mengambil boss_report_months (${safeStart} s/d ${safeEnd}): ${error.message}`
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const map: Record<string, BossReportMonthData> = {};
  for (const rawRow of data ?? []) {
    const normalized = normalizeDbRow(rawRow as Record<string, unknown>);
    if (normalized) {
      map[normalized.monthKey] = normalized;
    }
  }
  return map;
}

export async function refreshBossReportMonthsRangeFromSupabase(
  startMonthKey: string,
  endMonthKey: string
): Promise<Record<string, BossReportMonthData>> {
  const rangeMap = await getBossReportMonthsByRange(startMonthKey, endMonthKey);
  const merged = {
    ...latestMonthsMap,
    ...rangeMap,
  };
  notifyListeners(merged);
  return rangeMap;
}

export async function refreshBossReportMonthsFromSupabase(): Promise<Record<string, BossReportMonthData>> {
  const map = await getBossReportMonths();
  notifyListeners(map);
  return map;
}

export function subscribeBossReportMonths(
  onData: (monthsMap: Record<string, BossReportMonthData>) => void,
  options?: { readOnly?: boolean; onError?: (error: unknown) => void }
): () => void {
  ensureLocalCacheHydrated();
  listeners.add(onData);
  if (Object.keys(latestMonthsMap).length > 0) {
    onData(latestMonthsMap);
  }

  if (!supabase) {
    const configErr = new Error(
      'VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY belum dikonfigurasi.'
    );
    options?.onError?.(configErr);
    if (Object.keys(latestMonthsMap).length === 0) {
      onData({});
    }
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const fetchBossReportMonths = async () => {
    if (cancelled) return;
    try {
      const map = await getBossReportMonths();
      if (cancelled) return;
      notifyListeners(map);
    } catch (err) {
      if (!cancelled) {
        options?.onError?.(err);
        onData(latestMonthsMap);
      }
    }
  };

  void fetchBossReportMonths();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchBossReportMonths();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function saveBossReportMonth(input: BossReportMonthData): Promise<void> {
  await saveBossReportMonthsBatch([input]);
}

function isOnConflictConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message).toLowerCase() : '';
  return (
    code === '42P10' ||
    message.includes('on conflict') ||
    message.includes('no unique or exclusion constraint')
  );
}

function isUuidTypeSyntaxError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message).toLowerCase() : '';
  return code === '22P02' && message.includes('uuid');
}

function isAutoIdIntegerError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message).toLowerCase() : '';
  return (
    code === '428C9' ||
    (code === '22P02' &&
      (message.includes('bigint') ||
        message.includes('integer') ||
        message.includes('smallint')))
  );
}

export async function saveBossReportMonthsBatch(
  inputs: BossReportMonthData[]
): Promise<void> {
  if (inputs.length === 0) return;
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan laporan Projection ke Supabase', configError);
  }

  const sanitizedList = inputs.map((inp) => sanitizeBossReportMonth(inp));
  for (const s of sanitizedList) {
    if (s.cutoffGlobalDate) {
      saveCutoffGlobalDateLocal(s.monthKey, s.cutoffGlobalDate);
    }
  }
  const previousMonthsSnapshot = latestMonthsMap;
  const optimisticMonthsMap: Record<string, BossReportMonthData> = {
    ...latestMonthsMap,
  };
  for (const s of sanitizedList) {
    optimisticMonthsMap[s.monthKey] = s;
  }
  notifyListeners(optimisticMonthsMap);

  const excluded = new Set<string>(discoveredExcludedBossColumns);
  const schema = await resolveTableWhitelistSchema(TABLE_NAME);

  let idNeedsUuid =
    cachedIdNeedsUuid ||
    (schema?.columns.get('id')?.format ?? '').toLowerCase() === 'uuid';
  let conflictColumn = resolveBossConflictColumn(schema, excluded);
  let forceManualUpsertFallback = false;

  const buildPayloads = () =>
    sanitizedList.map((s) =>
      sanitizeBossReportDbPayload(s, schema, excluded, {
        idNeedsUuid,
        conflictColumn,
      })
    );

  const executeManualSync = async (
    rowsToSave: Record<string, unknown>[]
  ): Promise<{ error: unknown }> => {
    const { data: existingRows, error: selErr } = await client.from(TABLE_NAME).select('*');
    if (selErr) {
      return { error: selErr };
    }
    const existingByMonth = new Map<string, { col: string; val: unknown }>();
    const matchCols = Array.from(
      new Set<string>([conflictColumn, ...CONFLICT_COLUMN_CANDIDATES, 'id'])
    );
    for (const r of existingRows ?? []) {
      const rec = r as Record<string, unknown>;
      const norm = normalizeDbRow(rec);
      if (!norm) continue;
      for (const candidateCol of matchCols) {
        if (rec[candidateCol] !== undefined && rec[candidateCol] !== null && rec[candidateCol] !== '') {
          existingByMonth.set(norm.monthKey, { col: candidateCol, val: rec[candidateCol] });
          break;
        }
      }
    }

    for (let idx = 0; idx < sanitizedList.length; idx += 1) {
      const s = sanitizedList[idx];
      const p = { ...rowsToSave[idx] };
      const match = existingByMonth.get(s.monthKey);
      if (match) {
        delete p.id;
        const res = await client
          .from(TABLE_NAME)
          .update(p)
          .eq(match.col, match.val)
          .select();
        if (res.error) {
          return { error: res.error };
        }
        if (Array.isArray(res.data) && res.data.length === 0) {
          return {
            error: new Error(
              `0 baris terupdate pada tabel ${TABLE_NAME} (${match.col}=${String(match.val)}). Periksa RLS policy.`
            ),
          };
        }
      } else {
        const res = await client.from(TABLE_NAME).insert([p]).select();
        if (res.error) {
          return { error: res.error };
        }
        if (Array.isArray(res.data) && res.data.length === 0) {
          return {
            error: new Error(
              `0 baris tersimpan saat insert ke tabel ${TABLE_NAME}. Periksa RLS policy.`
            ),
          };
        }
      }
    }
    return { error: null };
  };

  const executeSave = async (
    rowsToSave: Record<string, unknown>[],
    conflictCol: string
  ): Promise<{ error: unknown }> => {
    if (forceManualUpsertFallback) {
      return executeManualSync(rowsToSave);
    }
    const res = await client
      .from(TABLE_NAME)
      .upsert(rowsToSave, { onConflict: conflictCol })
      .select();
    if (res.error) {
      return { error: res.error };
    }
    if (Array.isArray(res.data) && res.data.length === 0) {
      return {
        error: new Error(
          `0 baris tersimpan pada tabel ${TABLE_NAME}. Periksa RLS policy INSERT/UPDATE di Supabase.`
        ),
      };
    }
    return { error: null };
  };

  let payloads = buildPayloads();
  console.log(
    `[Supabase][${TABLE_NAME}] upsert (onConflict="${conflictColumn}") payload:`,
    payloads
  );

  let { error } = await executeSave(payloads, conflictColumn);

  for (let attempt = 0; attempt < 25 && error; attempt += 1) {
    if (isAutoIdIntegerError(error) && !excluded.has('id')) {
      excluded.add('id');
      discoveredExcludedBossColumns.add('id');
      if (conflictColumn === 'id') {
        conflictColumn = resolveBossConflictColumn(schema, excluded);
        if (conflictColumn === 'id') {
          forceManualUpsertFallback = true;
        }
      }
      payloads = buildPayloads();
      console.log(
        `[Supabase][${TABLE_NAME}] retry payload (auto-generated id):`,
        payloads
      );
      ({ error } = await executeSave(payloads, conflictColumn));
      continue;
    }

    if (isUuidTypeSyntaxError(error) && !idNeedsUuid) {
      idNeedsUuid = true;
      cachedIdNeedsUuid = true;
      payloads = buildPayloads();
      console.log(
        `[Supabase][${TABLE_NAME}] upsert retry payload (UUID id):`,
        payloads
      );
      ({ error } = await executeSave(payloads, conflictColumn));
      continue;
    }

    if (isMissingColumnSupabaseError(error)) {
      invalidateSupabaseTableSchema(TABLE_NAME);
      const missingCol = extractMissingColumnFromError(error);
      if (missingCol && !excluded.has(missingCol)) {
        excluded.add(missingCol);
        discoveredExcludedBossColumns.add(missingCol);
        removeObservedTableColumn(TABLE_NAME, missingCol);
        if (missingCol === conflictColumn) {
          conflictColumn = resolveBossConflictColumn(schema, excluded);
        }
        payloads = buildPayloads();
        console.log(
          `[Supabase][${TABLE_NAME}] upsert retry payload (removed "${missingCol}", onConflict="${conflictColumn}"):`,
          payloads
        );
        ({ error } = await executeSave(payloads, conflictColumn));
        continue;
      }
    }

    if (!forceManualUpsertFallback && isOnConflictConstraintError(error)) {
      // Fallback: jika tabel tidak memiliki unique constraint di conflictColumn,
      // gunakan manual select -> update/insert per bulan tanpa onConflict
      forceManualUpsertFallback = true;
      ({ error } = await executeManualSync(payloads));
      if (!error) break;
      continue;
    }

    const notNullCol = extractNotNullColumnFromError(error);
    if (notNullCol) {
      payloads = payloads.map((p) =>
        p[notNullCol] === null || p[notNullCol] === undefined ? { ...p, [notNullCol]: '' } : p
      );
      ({ error } = await executeSave(payloads, conflictColumn));
      continue;
    }

    if (isDateSyntaxSupabaseError(error)) {
      payloads = payloads.map((p) => ({
        ...p,
        ...(p.as_of_date !== undefined
          ? { as_of_date: normalizeToIsoDate(p.as_of_date) ?? null }
          : {}),
        ...(p.cutoff_global_date !== undefined
          ? { cutoff_global_date: normalizeToIsoDate(p.cutoff_global_date) ?? null }
          : {}),
      }));
      ({ error } = await executeSave(payloads, conflictColumn));
      continue;
    }

    break;
  }

  if (error) {
    notifyListeners(previousMonthsSnapshot);
    throw reportSupabaseError('Gagal menyimpan data Projection ke Supabase', error);
  }

  cachedBossConflictColumn = conflictColumn;
  await refreshBossReportMonthsFromSupabase();
}

export function generateBossRowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
