import {
  deterministicUuid,
  generateUuid,
  invalidateSupabaseTableSchema,
  isUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseColumnSchema,
  SupabaseTableSchema,
} from '../lib/supabaseClient';
import {
  extractMissingColumnFromError,
  extractNotNullColumnFromError,
  getObservedTableColumns,
  isDateSyntaxSupabaseError,
  isMissingColumnSupabaseError,
  packArrayWithMeta,
  packNotesWithMeta,
  recordObservedTableColumns,
  removeObservedTableColumn,
  resolveTableWhitelistSchema,
  sanitizePayloadByWhitelist,
  unpackArrayWithMeta,
  unpackNotesWithMeta,
} from '../lib/supabaseWhitelist';
import {
  buildInvestmentComponentPeriodKey,
  DEFAULT_INVESTMENT_CUTOFF_DATE,
  InterestInputType,
  INVESTMENT_CATEGORIES,
  INVESTMENT_COMPONENT_KEYS,
  INVESTMENT_SCHEMA_LIMITS,
  InvestmentAddendum,
  InvestmentAddendumFormSubmission,
  InvestmentAsset,
  InvestmentCategory,
  InvestmentComponentKey,
  InvestmentInput,
  InvestmentOriginalContract,
  InvestmentPaymentMethod,
  InvestmentStatus,
  isInvestmentComponentPaidInSet,
} from '../types/investment';
import {
  colorToDbStatusFields,
  normalizeStatusToColor,
  StatusColorKey,
  StatusWarna,
} from '../types/statusWarna';
import { getTodayISODate, normalizeToIsoDate } from '../utils/format';
import { normalizeMonthKeyYYYYMM } from '../utils/bossReportCalc';
import { getEndOfMonthISODate } from './opexService';
import {
  addMonthsToInvestmentKey,
  buildInvestmentSchedule,
  computeLoanEndDate,
  computeMonthlyInterestForBalance,
  getEffectiveAssetBonusDate,
  getEffectiveAssetEndDate,
  getEffectiveAssetStartDate,
  getFirstInstallmentMonthKey,
  roundInterestRate,
} from '../utils/investmentCalc';

const TABLE_NAME = 'investments';

type InvestmentListener = (items: InvestmentAsset[]) => void;
const listeners = new Set<InvestmentListener>();
let latestInvestments: InvestmentAsset[] = [];
let channelSeq = 0;

const VALID_CATEGORIES = new Set<InvestmentCategory>(INVESTMENT_CATEGORIES);
const VALID_STATUSES = new Set<InvestmentStatus>(['Aktif', 'Lunas', 'Ditunda']);
const VALID_METHODS = new Set<InvestmentPaymentMethod>(['ANUITAS', 'BALLOON']);
const VALID_INPUT_TYPES = new Set<InterestInputType>(['RP', 'PERCENT']);

function generateInvestmentId(): string {
  return generateUuid();
}

function generateAddendumId(): string {
  return `add_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getMonthIndexOffset(startMonthKey: string, targetMonthKey: string): number {
  if (
    !INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(startMonthKey) ||
    !INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(targetMonthKey)
  ) {
    return -1;
  }
  const [sy, sm] = startMonthKey.split('-').map(Number);
  const [ty, tm] = targetMonthKey.split('-').map(Number);
  return (ty - sy) * 12 + (tm - sm);
}

export function isInvestmentActiveInMonth(
  asset: InvestmentAsset,
  monthKey: string
): { active: boolean; installmentNumber: number } {
  if (asset.status === 'Ditunda') {
    return { active: false, installmentNumber: 0 };
  }
  const firstInstallmentMonthKey = getFirstInstallmentMonthKey(asset);
  const offset = getMonthIndexOffset(firstInstallmentMonthKey, monthKey);
  if (offset >= 0 && offset < asset.tenorMonths) {
    return { active: true, installmentNumber: offset + 1 };
  }
  if (asset.paymentMethod === 'BALLOON') {
    const endMonth = getEffectiveAssetEndDate(asset).slice(0, 7);
    if (endMonth === monthKey) {
      return { active: true, installmentNumber: 0 };
    }
  }
  const bonusMonth = getEffectiveAssetBonusDate(asset).slice(0, 7);
  const hasBonus =
    (Number(asset.bonusAmount) || 0) > 0 || (Number(asset.bonusRate) || 0) > 0;
  if (hasBonus && bonusMonth === monthKey) {
    return { active: true, installmentNumber: 0 };
  }
  if (offset >= asset.tenorMonths && asset.status === 'Aktif') {
    return { active: true, installmentNumber: 0 };
  }
  return { active: false, installmentNumber: 0 };
}

function sanitizeAmount(val: unknown): number {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(INVESTMENT_SCHEMA_LIMITS.maxAmount, Math.round(num)));
}

function sanitizeMonthRealisasiMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.trim() || v === undefined || v === null || v === '') continue;
    const num = Number(v);
    if (Number.isFinite(num)) {
      result[k.trim().slice(0, 64)] = sanitizeAmount(num);
    }
  }
  return result;
}

function sanitizeOptionalRealisasiValue(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const num = Number(val);
  if (!Number.isFinite(num)) return undefined;
  return sanitizeAmount(num);
}

function parseDueDay(val: unknown): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return undefined;
    const rounded = Math.round(val);
    return rounded >= 1 && rounded <= 31 ? rounded : undefined;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    if (/^\d{1,2}$/.test(trimmed)) {
      const num = Number(trimmed);
      return num >= 1 && num <= 31 ? num : undefined;
    }
    const iso = normalizeToIsoDate(trimmed);
    if (iso) {
      const day = Number(iso.slice(8, 10));
      return Number.isFinite(day) && day >= 1 && day <= 31 ? day : undefined;
    }
  }
  return undefined;
}

function buildDueDayIsoDate(
  dueDay: number,
  startDateIso?: string,
  startMonthKey?: string
): string {
  const safeDay = Math.min(31, Math.max(1, Math.round(dueDay)));
  const normalizedStart = normalizeToIsoDate(startDateIso);
  const candidateMonth =
    startMonthKey && INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(startMonthKey)
      ? startMonthKey
      : normalizedStart
      ? addMonthsToInvestmentKey(normalizedStart.slice(0, 7), 1)
      : getTodayISODate().slice(0, 7);

  const [yStr, mStr] = candidateMonth.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || 1;
  const maxDayInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Jika tanggal bayar bunga lebih besar dari jumlah hari bulan tersebut (mis. tgl 31 di Feb),
  // gunakan bulan Januari (31 hari) agar angka hari 1..31 tidak berubah saat dibaca kembali.
  const targetMonth = safeDay <= maxDayInMonth ? month : 1;
  return `${String(year).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(
    safeDay
  ).padStart(2, '0')}`;
}

function sanitizeOriginalContract(
  raw: (Partial<InvestmentOriginalContract> & {
    lateFeePerDayAmount?: number;
    lateFeePerDayRate?: number;
  }) | undefined
): InvestmentOriginalContract | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const defaultMonth = getTodayISODate().slice(0, 7);
  const startMonthKey = INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(raw.startMonthKey || '')
    ? String(raw.startMonthKey)
    : defaultMonth;
  const rawTenor = Number(raw.tenorMonths ?? 1);
  const tenorMonths = Number.isFinite(rawTenor)
    ? Math.max(1, Math.min(INVESTMENT_SCHEMA_LIMITS.maxTenor, Math.round(rawTenor)))
    : 1;
  const dueDay = parseDueDay(raw.dueDay);
  const startDate =
    normalizeToIsoDate(raw.startDate) ??
    `${startMonthKey}-${String(dueDay ?? 1).padStart(2, '0')}`;
  const endDate =
    normalizeToIsoDate(raw.endDate) ?? computeLoanEndDate(startDate, tenorMonths);
  const bonusDate = normalizeToIsoDate(raw.bonusDate) ?? endDate;

  return {
    ...(raw.contractNumber
      ? {
          contractNumber: String(raw.contractNumber)
            .trim()
            .slice(0, INVESTMENT_SCHEMA_LIMITS.addendumNumberMax),
        }
      : {}),
    principalAmount: sanitizeAmount(raw.principalAmount),
    paymentMethod: VALID_METHODS.has(raw.paymentMethod as InvestmentPaymentMethod)
      ? (raw.paymentMethod as InvestmentPaymentMethod)
      : 'ANUITAS',
    fixedPrincipalPerMonth: sanitizeAmount(raw.fixedPrincipalPerMonth),
    interestInputType: VALID_INPUT_TYPES.has(raw.interestInputType as InterestInputType)
      ? (raw.interestInputType as InterestInputType)
      : 'PERCENT',
    monthlyInterestAmount: sanitizeAmount(raw.monthlyInterestAmount),
    monthlyInterestRate: roundInterestRate(Number(raw.monthlyInterestRate ?? 0)),
    lateFeeInputType: VALID_INPUT_TYPES.has(raw.lateFeeInputType as InterestInputType)
      ? (raw.lateFeeInputType as InterestInputType)
      : 'RP',
    lateFeePerMonthAmount: sanitizeAmount(raw.lateFeePerMonthAmount ?? raw.lateFeePerDayAmount),
    lateFeePerMonthRate: roundInterestRate(
      Number(raw.lateFeePerMonthRate ?? raw.lateFeePerDayRate ?? 0)
    ),
    bonusInputType: VALID_INPUT_TYPES.has(raw.bonusInputType as InterestInputType)
      ? (raw.bonusInputType as InterestInputType)
      : 'RP',
    bonusAmount: sanitizeAmount(raw.bonusAmount),
    bonusRate: roundInterestRate(Number(raw.bonusRate ?? 0)),
    bonusDate,
    tenorMonths,
    startMonthKey,
    startDate,
    endDate,
    ...(dueDay ? { dueDay } : {}),
    notes: String(raw.notes ?? '').trim().slice(0, INVESTMENT_SCHEMA_LIMITS.notesMax),
  };
}

function sanitizeAddendums(rawList: unknown): InvestmentAddendum[] | undefined {
  if (!Array.isArray(rawList) || rawList.length === 0) return undefined;
  const cleaned: InvestmentAddendum[] = [];
  for (let i = 0; i < Math.min(rawList.length, INVESTMENT_SCHEMA_LIMITS.maxAddendums); i += 1) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Partial<InvestmentAddendum> & {
      newLateFeePerDayAmount?: number;
      newLateFeePerDayRate?: number;
    };
    const today = getTodayISODate();
    const addendumDate = normalizeToIsoDate(rec.addendumDate) ?? today;
    const prevEndDate = normalizeToIsoDate(rec.previousEndDate) ?? today;
    const additionalTenorMonths = Math.max(
      1,
      Math.min(
        INVESTMENT_SCHEMA_LIMITS.maxTenor,
        Math.round(Number(rec.additionalTenorMonths ?? 1) || 1)
      )
    );
    const previousTenorMonths = Math.max(
      1,
      Math.min(
        INVESTMENT_SCHEMA_LIMITS.maxTenor,
        Math.round(Number(rec.previousTenorMonths ?? 1) || 1)
      )
    );
    const newTotalTenorMonths = Math.max(
      previousTenorMonths + additionalTenorMonths,
      Math.min(
        INVESTMENT_SCHEMA_LIMITS.maxTenor,
        Math.round(Number(rec.newTotalTenorMonths ?? previousTenorMonths + additionalTenorMonths))
      )
    );
    const newEndDate =
      normalizeToIsoDate(rec.newEndDate) ??
      computeLoanEndDate(prevEndDate, additionalTenorMonths);
    const newBonusDate = normalizeToIsoDate(rec.newBonusDate) ?? newEndDate;

    cleaned.push({
      id: String(rec.id || generateAddendumId()).slice(0, 64),
      sequenceNumber: Math.max(1, Math.round(Number(rec.sequenceNumber ?? i + 1) || i + 1)),
      addendumDate,
      addendumNumber:
        String(rec.addendumNumber ?? '')
          .trim()
          .slice(0, INVESTMENT_SCHEMA_LIMITS.addendumNumberMax) || `ADD-${i + 1}`,
      additionalTenorMonths,
      previousTenorMonths,
      newTotalTenorMonths,
      previousEndDate: prevEndDate,
      newEndDate,
      additionalPrincipal: sanitizeAmount(rec.additionalPrincipal),
      effectiveFromInstallment: Math.max(
        1,
        Math.min(
          INVESTMENT_SCHEMA_LIMITS.maxTenor,
          Math.round(Number(rec.effectiveFromInstallment ?? previousTenorMonths + 1))
        )
      ),
      newInterestInputType: VALID_INPUT_TYPES.has(rec.newInterestInputType as InterestInputType)
        ? (rec.newInterestInputType as InterestInputType)
        : 'RP',
      newMonthlyInterestAmount: sanitizeAmount(rec.newMonthlyInterestAmount),
      newMonthlyInterestRate: roundInterestRate(Number(rec.newMonthlyInterestRate ?? 0)),
      ...(rec.newMonthlyInstallment !== undefined
        ? { newMonthlyInstallment: sanitizeAmount(rec.newMonthlyInstallment) }
        : {}),
      newLateFeeInputType: VALID_INPUT_TYPES.has(rec.newLateFeeInputType as InterestInputType)
        ? (rec.newLateFeeInputType as InterestInputType)
        : 'RP',
      newLateFeePerMonthAmount: sanitizeAmount(
        rec.newLateFeePerMonthAmount ?? rec.newLateFeePerDayAmount
      ),
      newLateFeePerMonthRate: roundInterestRate(
        Number(rec.newLateFeePerMonthRate ?? rec.newLateFeePerDayRate ?? 0)
      ),
      newBonusInputType: VALID_INPUT_TYPES.has(rec.newBonusInputType as InterestInputType)
        ? (rec.newBonusInputType as InterestInputType)
        : 'RP',
      newBonusAmount: sanitizeAmount(rec.newBonusAmount),
      newBonusRate: roundInterestRate(Number(rec.newBonusRate ?? 0)),
      newBonusDate,
      notes: String(rec.notes ?? '').trim().slice(0, INVESTMENT_SCHEMA_LIMITS.notesMax),
      ...(rec.pdfFileName
        ? {
            pdfFileName: String(rec.pdfFileName)
              .trim()
              .slice(0, INVESTMENT_SCHEMA_LIMITS.pdfFileNameMax),
          }
        : {}),
      ...(rec.pdfAttachmentId
        ? { pdfAttachmentId: String(rec.pdfAttachmentId).trim().slice(0, 80) }
        : {}),
      ...(rec.createdAt ? { createdAt: String(rec.createdAt).slice(0, 40) } : {}),
    });
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

export function sanitizeInvestmentInput(input: InvestmentInput): InvestmentInput {
  const defaultMonth = getTodayISODate().slice(0, 7);
  const startDateCandidate = normalizeToIsoDate(input.startDate);
  const startMonthKey = startDateCandidate
    ? addMonthsToInvestmentKey(startDateCandidate.slice(0, 7), 1)
    : INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(input.startMonthKey)
    ? input.startMonthKey
    : addMonthsToInvestmentKey(defaultMonth, 1);

  const principalAmount = sanitizeAmount(input.principalAmount);
  const monthlyInstallment = sanitizeAmount(input.monthlyInstallment);

  const rawTenor = Number(input.tenorMonths ?? 1);
  const tenorMonths = Number.isFinite(rawTenor)
    ? Math.max(1, Math.min(INVESTMENT_SCHEMA_LIMITS.maxTenor, Math.round(rawTenor)))
    : 1;

  const dueDay = parseDueDay(input.dueDay);

  const effectiveStartDate =
    startDateCandidate ?? `${startMonthKey}-${String(dueDay ?? 1).padStart(2, '0')}`;
  const endDateCandidate = normalizeToIsoDate(input.endDate);
  const effectiveEndDate =
    endDateCandidate ?? computeLoanEndDate(effectiveStartDate, tenorMonths);
  const cutoffDate =
    normalizeToIsoDate(input.cutoffDate) ?? DEFAULT_INVESTMENT_CUTOFF_DATE;
  const legacyLateFeeBeforeCutoff = sanitizeAmount(input.legacyLateFeeBeforeCutoff);
  const bonusDateCandidate = normalizeToIsoDate(input.bonusDate);
  const effectiveBonusDate = bonusDateCandidate ?? effectiveEndDate;

  const category = VALID_CATEGORIES.has(input.category)
    ? input.category
    : 'Pinjaman / Kredit';
  const status = VALID_STATUSES.has(input.status) ? input.status : 'Aktif';
  const paymentMethod: InvestmentPaymentMethod = VALID_METHODS.has(input.paymentMethod)
    ? input.paymentMethod
    : 'ANUITAS';
  const interestInputType: InterestInputType = VALID_INPUT_TYPES.has(
    input.interestInputType
  )
    ? input.interestInputType
    : 'PERCENT';
  const fixedPrincipalPerMonth = sanitizeAmount(input.fixedPrincipalPerMonth);
  const monthlyInterestAmount = sanitizeAmount(input.monthlyInterestAmount);
  const monthlyInterestRate = roundInterestRate(Number(input.monthlyInterestRate ?? 0));

  const lateFeeInputType: InterestInputType = VALID_INPUT_TYPES.has(
    input.lateFeeInputType as InterestInputType
  )
    ? (input.lateFeeInputType as InterestInputType)
    : 'RP';
  const lateFeePerMonthAmount = sanitizeAmount(input.lateFeePerMonthAmount);
  const lateFeePerMonthRate = roundInterestRate(Number(input.lateFeePerMonthRate ?? 0));

  const bonusInputType: InterestInputType = VALID_INPUT_TYPES.has(
    input.bonusInputType as InterestInputType
  )
    ? (input.bonusInputType as InterestInputType)
    : 'RP';
  const bonusAmount = sanitizeAmount(input.bonusAmount);
  const bonusRate = roundInterestRate(Number(input.bonusRate ?? 0));

  const paidMonths = Array.isArray(input.paidMonths)
    ? Array.from(
        new Set(
          input.paidMonths.filter((m) => INVESTMENT_SCHEMA_LIMITS.componentMonthKeyPattern.test(m))
        )
      ).sort()
    : [];

  const originalContract = sanitizeOriginalContract(input.originalContract);
  const addendums = sanitizeAddendums(input.addendums);
  const contractNumber = String(input.contractNumber ?? '')
    .trim()
    .slice(0, INVESTMENT_SCHEMA_LIMITS.addendumNumberMax);
  const disbursementStatus: 'white' | 'green' | 'red' | undefined =
    input.disbursementStatus === 'green' ||
    input.disbursementStatus === 'red' ||
    input.disbursementStatus === 'white'
      ? input.disbursementStatus
      : undefined;
  const disbursementPaidDate = normalizeToIsoDate(input.disbursementPaidDate);
  const disbursementRescheduledToMonth =
    typeof input.disbursementRescheduledToMonth === 'string' &&
    INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(input.disbursementRescheduledToMonth.trim())
      ? input.disbursementRescheduledToMonth.trim()
      : undefined;
  const disbursementRescheduledFromMonth =
    typeof input.disbursementRescheduledFromMonth === 'string' &&
    INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(input.disbursementRescheduledFromMonth.trim())
      ? input.disbursementRescheduledFromMonth.trim()
      : undefined;
  const disbursementStatusWarna: StatusWarna | undefined =
    disbursementStatus === 'green'
      ? 'HIJAU'
      : disbursementStatus === 'red'
      ? 'MERAH'
      : disbursementStatus === 'white'
      ? 'PUTIH'
      : undefined;

  const monthStatuses: Record<string, 'Not Paid' | 'Paid' | 'Reschedule'> = {};
  if (input.monthStatuses && typeof input.monthStatuses === 'object') {
    for (const [mk, st] of Object.entries(input.monthStatuses)) {
      if (!INVESTMENT_SCHEMA_LIMITS.componentMonthKeyPattern.test(mk)) continue;
      const col = normalizeStatusToColor(String(st ?? ''), undefined);
      monthStatuses[mk] = colorToDbStatusFields(col).status;
    }
  }
  const monthStatusWarnas: Record<string, 'PUTIH' | 'HIJAU' | 'MERAH'> = {};
  if (input.monthStatusWarnas && typeof input.monthStatusWarnas === 'object') {
    for (const [mk, sw] of Object.entries(input.monthStatusWarnas)) {
      if (!INVESTMENT_SCHEMA_LIMITS.componentMonthKeyPattern.test(mk)) continue;
      const col = normalizeStatusToColor(undefined, String(sw ?? ''));
      monthStatusWarnas[mk] = colorToDbStatusFields(col).statusWarna;
    }
  }
  const rescheduledMonths: Record<string, string> = {};
  if (input.rescheduledMonths && typeof input.rescheduledMonths === 'object') {
    for (const [fromMk, toMk] of Object.entries(input.rescheduledMonths)) {
      if (
        INVESTMENT_SCHEMA_LIMITS.componentMonthKeyPattern.test(fromMk) &&
        INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(String(toMk ?? ''))
      ) {
        rescheduledMonths[fromMk] = String(toMk).trim();
      }
    }
  }

  const monthRealisasi = sanitizeMonthRealisasiMap(input.monthRealisasi);
  const disbursementRealisasiAmount =
    disbursementStatus === 'green' || input.disbursementRealisasiAmount !== undefined
      ? sanitizeOptionalRealisasiValue(input.disbursementRealisasiAmount)
      : undefined;

  return {
    ...(contractNumber ? { contractNumber } : {}),
    name:
      String(input.name ?? '').trim().slice(0, INVESTMENT_SCHEMA_LIMITS.nameMax) ||
      'Aset / Cicilan Investasi',
    institution:
      String(input.institution ?? '')
        .trim()
        .slice(0, INVESTMENT_SCHEMA_LIMITS.institutionMax) || '-',
    category,
    principalAmount,
    paymentMethod,
    fixedPrincipalPerMonth,
    interestInputType,
    monthlyInterestAmount,
    monthlyInterestRate,
    lateFeeInputType,
    lateFeePerMonthAmount,
    lateFeePerMonthRate,
    bonusInputType,
    bonusAmount,
    bonusRate,
    bonusDate: effectiveBonusDate,
    monthlyInstallment,
    tenorMonths,
    startMonthKey,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    cutoffDate,
    legacyLateFeeBeforeCutoff,
    ...(dueDay ? { dueDay } : {}),
    paidMonths,
    ...(Object.keys(monthStatuses).length > 0 ? { monthStatuses } : {}),
    ...(Object.keys(monthStatusWarnas).length > 0 ? { monthStatusWarnas } : {}),
    ...(Object.keys(rescheduledMonths).length > 0 ? { rescheduledMonths } : {}),
    ...(Object.keys(monthRealisasi).length > 0 ? { monthRealisasi } : {}),
    status,
    ...(disbursementStatus ? { disbursementStatus } : {}),
    ...(disbursementStatusWarna ? { disbursementStatusWarna } : {}),
    ...(disbursementPaidDate ? { disbursementPaidDate } : {}),
    ...(disbursementRealisasiAmount !== undefined ? { disbursementRealisasiAmount } : {}),
    ...(disbursementRescheduledFromMonth ? { disbursementRescheduledFromMonth } : {}),
    ...(disbursementRescheduledToMonth ? { disbursementRescheduledToMonth } : {}),
    notes: String(input.notes ?? '').trim().slice(0, INVESTMENT_SCHEMA_LIMITS.notesMax),
    ...(originalContract ? { originalContract } : {}),
    ...(addendums ? { addendums } : {}),
  };
}

const INVESTMENT_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'id',
  'contract_number',
  'contract_date',
  'period_months',
  'due_date',
  'investor_name',
  'loan_amount',
  'monthly_interest',
  'keterangan',
  'status',
  'month_realisasi',
  'disbursement_realisasi_amount',
  'created_at',
  'updated_at',
]);

const INVESTMENT_COLUMN_ALIASES: Record<string, string[]> = {
  keterangan: ['notes'],
  notes: ['keterangan'],
};

const INVESTMENT_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
]);

function normalizeInvestment(raw: Record<string, unknown>, fallbackId: string): InvestmentAsset {
  const { items: unpackedPaidMonths, meta: paidMonthsMeta } = unpackArrayWithMeta<string>(
    raw.paid_months ?? raw.paidMonths
  );
  const { notes: unpackedKeterangan, meta: keteranganMeta } = unpackNotesWithMeta(
    raw.keterangan ?? raw.notes
  );
  const meta: Record<string, unknown> = { ...keteranganMeta, ...paidMonthsMeta };

  const rawContractNumber =
    raw.contract_number ?? raw.contractNumber ?? meta.contract_number ?? meta.contractNumber;
  const rawInvestorName = raw.investor_name ?? raw.name ?? meta.investor_name ?? meta.name ?? '';
  const rawStartDate = normalizeToIsoDate(
    raw.contract_date ?? raw.startDate ?? meta.contract_date ?? meta.startDate
  );
  const rawEndDate = normalizeToIsoDate(
    raw.due_date ?? raw.endDate ?? meta.due_date ?? meta.endDate
  );
  const rawPeriodMonths =
    raw.period_months ?? raw.tenorMonths ?? meta.period_months ?? meta.tenorMonths ?? 1;
  const parsedDueDayFromDb =
    parseDueDay(raw.interest_payment_day) ??
    parseDueDay(raw.payment_day) ??
    parseDueDay(raw.interest_day) ??
    parseDueDay(raw.due_day) ??
    parseDueDay(raw.interest_payment_date) ??
    parseDueDay(raw.dueDay) ??
    parseDueDay(meta.interest_payment_day) ??
    parseDueDay(meta.payment_day) ??
    parseDueDay(meta.interest_day) ??
    parseDueDay(meta.due_day) ??
    parseDueDay(meta.interest_payment_date) ??
    parseDueDay(meta.dueDay);
  const firstPositiveNumeric = (...vals: unknown[]): number => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  const rawLoanAmount = firstPositiveNumeric(
    raw.loan_amount,
    raw.principal_amount,
    raw.principalAmount,
    raw.amount,
    raw.total,
    raw.grand_total,
    raw.total_amount,
    meta.loan_amount,
    meta.principal_amount,
    meta.principalAmount,
    meta.amount,
    meta.total
  );
  const rawMonthlyInterest =
    raw.monthly_interest ??
    raw.monthlyInterestAmount ??
    meta.monthly_interest ??
    meta.monthlyInterestAmount ??
    0;
  const rawKeterangan = unpackedKeterangan || String(meta.keterangan ?? '');

  const rawPaymentMethod =
    raw.payment_method ?? raw.paymentMethod ?? meta.payment_method ?? meta.paymentMethod;
  const keteranganLower = String(rawKeterangan ?? '').toLowerCase();
  const inferredMethod: InvestmentPaymentMethod =
    rawPaymentMethod === 'ANUITAS' || rawPaymentMethod === 'BALLOON'
      ? (rawPaymentMethod as InvestmentPaymentMethod)
      : keteranganLower.includes('pokok + bunga') ||
        keteranganLower.includes('pokok+bunga') ||
        keteranganLower.includes('anuitas')
      ? 'ANUITAS'
      : rawPaymentMethod
      ? 'ANUITAS'
      : 'BALLOON';

  const rawMonthlyInstallment =
    raw.monthly_installment ??
    raw.monthlyInstallment ??
    meta.monthly_installment ??
    meta.monthlyInstallment;
  const rawFixedPrincipal =
    raw.fixed_principal_per_month ??
    raw.fixedPrincipalPerMonth ??
    meta.fixed_principal_per_month ??
    meta.fixedPrincipalPerMonth;

  const loanAmountNum = Number(rawLoanAmount) || 0;
  const periodNum = Math.max(1, Math.round(Number(rawPeriodMonths) || 1));
  const monthlyInterestNum = Number(rawMonthlyInterest) || 0;

  let fixedPrincipalPerMonth = Number(rawFixedPrincipal ?? 0) || 0;
  let monthlyInterestAmount = monthlyInterestNum;
  let monthlyInstallment = Number(rawMonthlyInstallment ?? 0) || 0;

  if (
    inferredMethod === 'ANUITAS' &&
    rawMonthlyInstallment === undefined &&
    rawFixedPrincipal === undefined
  ) {
    const rawFixed = Math.round(loanAmountNum / periodNum);
    fixedPrincipalPerMonth =
      monthlyInterestNum > 0 ? Math.min(rawFixed, monthlyInterestNum) : rawFixed;
    monthlyInterestAmount = Math.max(0, monthlyInterestNum - fixedPrincipalPerMonth);
    monthlyInstallment =
      monthlyInterestNum > 0 ? monthlyInterestNum : fixedPrincipalPerMonth;
  }

  const resolvedPaidMonths =
    unpackedPaidMonths.length > 0
      ? unpackedPaidMonths
      : Array.isArray(meta.paid_months)
      ? (meta.paid_months as string[])
      : Array.isArray(meta.paidMonths)
      ? (meta.paidMonths as string[])
      : [];

  const clean = sanitizeInvestmentInput({
    contractNumber: rawContractNumber ? String(rawContractNumber) : undefined,
    name: String(rawInvestorName),
    institution: String(
      raw.institution ?? meta.institution ?? rawInvestorName ?? '-'
    ),
    category: ((raw.category ?? meta.category) as InvestmentCategory) ?? 'Pinjaman / Kredit',
    principalAmount: loanAmountNum,
    paymentMethod: inferredMethod,
    fixedPrincipalPerMonth,
    interestInputType:
      ((raw.interest_input_type ??
        raw.interestInputType ??
        meta.interest_input_type ??
        meta.interestInputType) as InterestInputType) ?? 'RP',
    monthlyInterestAmount,
    monthlyInterestRate: Number(
      raw.monthly_interest_rate ??
        raw.monthlyInterestRate ??
        meta.monthly_interest_rate ??
        meta.monthlyInterestRate ??
        0
    ),
    lateFeeInputType:
      ((raw.late_fee_input_type ??
        raw.lateFeeInputType ??
        meta.late_fee_input_type ??
        meta.lateFeeInputType) as InterestInputType) ?? 'RP',
    lateFeePerMonthAmount: Number(
      raw.late_fee_per_month_amount ??
        raw.lateFeePerMonthAmount ??
        raw.lateFeePerDayAmount ??
        meta.late_fee_per_month_amount ??
        meta.lateFeePerMonthAmount ??
        0
    ),
    lateFeePerMonthRate: Number(
      raw.late_fee_per_month_rate ??
        raw.lateFeePerMonthRate ??
        raw.lateFeePerDayRate ??
        meta.late_fee_per_month_rate ??
        meta.lateFeePerMonthRate ??
        0
    ),
    bonusInputType:
      ((raw.bonus_input_type ??
        raw.bonusInputType ??
        meta.bonus_input_type ??
        meta.bonusInputType) as InterestInputType) ?? 'RP',
    bonusAmount: Number(
      raw.bonus_amount ?? raw.bonusAmount ?? meta.bonus_amount ?? meta.bonusAmount ?? 0
    ),
    bonusRate: Number(
      raw.bonus_rate ?? raw.bonusRate ?? meta.bonus_rate ?? meta.bonusRate ?? 0
    ),
    bonusDate: normalizeToIsoDate(
      raw.bonus_date ?? raw.bonusDate ?? meta.bonus_date ?? meta.bonusDate
    ),
    monthlyInstallment,
    tenorMonths: periodNum,
    startMonthKey: String(
      raw.start_month_key ??
        raw.startMonthKey ??
        meta.start_month_key ??
        meta.startMonthKey ??
        getTodayISODate().slice(0, 7)
    ),
    startDate: rawStartDate,
    endDate: rawEndDate,
    cutoffDate:
      normalizeToIsoDate(
        raw.cutoff_date ?? raw.cutoffDate ?? meta.cutoff_date ?? meta.cutoffDate
      ) ?? DEFAULT_INVESTMENT_CUTOFF_DATE,
    legacyLateFeeBeforeCutoff: Number(
      raw.legacy_late_fee_before_cutoff ??
        raw.legacyLateFeeBeforeCutoff ??
        meta.legacy_late_fee_before_cutoff ??
        meta.legacyLateFeeBeforeCutoff ??
        0
    ),
    dueDay: parsedDueDayFromDb,
    paidMonths: resolvedPaidMonths,
    monthStatuses: (raw.month_statuses ??
      raw.monthStatuses ??
      meta.month_statuses ??
      meta.monthStatuses) as Record<string, 'Not Paid' | 'Paid' | 'Reschedule'> | undefined,
    monthStatusWarnas: (raw.month_status_warnas ??
      raw.monthStatusWarnas ??
      meta.month_status_warnas ??
      meta.monthStatusWarnas) as Record<string, 'PUTIH' | 'HIJAU' | 'MERAH'> | undefined,
    rescheduledMonths: (raw.rescheduled_months ??
      raw.rescheduledMonths ??
      meta.rescheduled_months ??
      meta.rescheduledMonths) as Record<string, string> | undefined,
    monthRealisasi: (raw.month_realisasi ??
      raw.monthRealisasi ??
      meta.month_realisasi ??
      meta.monthRealisasi) as Record<string, number> | undefined,
    status: ((raw.status ?? meta.status) as InvestmentStatus) ?? 'Aktif',
    disbursementStatus: (() => {
      const rawStatus = String(
        raw.disbursement_status ??
          raw.disbursementStatus ??
          meta.disbursement_status ??
          meta.disbursementStatus ??
          ''
      )
        .trim()
        .toLowerCase();
      const rawWarna = String(
        raw.disbursement_status_warna ??
          raw.disbursementStatusWarna ??
          meta.disbursement_status_warna ??
          meta.disbursementStatusWarna ??
          ''
      )
        .trim()
        .toUpperCase();
      if (rawStatus === 'green' || rawStatus === 'paid' || rawStatus === 'cair' || rawWarna === 'HIJAU') {
        return 'green' as const;
      }
      if (rawStatus === 'red' || rawStatus === 'reschedule' || rawStatus === 'rescheduling' || rawWarna === 'MERAH') {
        return 'red' as const;
      }
      if (rawStatus === 'white' || rawStatus === 'not paid' || rawStatus === 'unpaid' || rawWarna === 'PUTIH') {
        return 'white' as const;
      }
      if (raw.disbursement_paid === true || meta.disbursement_paid === true) {
        return 'green' as const;
      }
      return undefined;
    })(),
    disbursementPaidDate: normalizeToIsoDate(
      raw.disbursement_paid_date ??
        raw.disbursementPaidDate ??
        meta.disbursement_paid_date ??
        meta.disbursementPaidDate
    ),
    disbursementRealisasiAmount: sanitizeOptionalRealisasiValue(
      raw.disbursement_realisasi_amount ??
        raw.disbursementRealisasiAmount ??
        meta.disbursement_realisasi_amount ??
        meta.disbursementRealisasiAmount
    ),
    disbursementRescheduledFromMonth: (() => {
      const val = String(
        raw.disbursement_rescheduled_from_month ??
          raw.disbursementRescheduledFromMonth ??
          meta.disbursement_rescheduled_from_month ??
          meta.disbursementRescheduledFromMonth ??
          ''
      ).trim();
      return INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(val) ? val : undefined;
    })(),
    disbursementRescheduledToMonth: (() => {
      const val = String(
        raw.disbursement_rescheduled_to_month ??
          raw.disbursementRescheduledToMonth ??
          meta.disbursement_rescheduled_to_month ??
          meta.disbursementRescheduledToMonth ??
          ''
      ).trim();
      return INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(val) ? val : undefined;
    })(),
    notes: rawKeterangan,
    originalContract: (raw.original_contract ??
      raw.originalContract ??
      meta.original_contract ??
      meta.originalContract) as InvestmentOriginalContract | undefined,
    addendums: (raw.addendums ?? meta.addendums) as InvestmentAddendum[] | undefined,
  });
  return {
    id: String(raw.id ?? fallbackId),
    ...clean,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

function toCoreDbPayload(
  clean: InvestmentInput,
  options?: { id?: string }
): Record<string, unknown> {
  const coreNotes =
    clean.notes?.trim() || (clean.paymentMethod === 'ANUITAS' ? 'Pokok + Bunga' : '');
  const contractDateIso = normalizeToIsoDate(clean.startDate) ?? null;
  const dueDateIso = normalizeToIsoDate(clean.endDate) ?? null;
  const dueDayInt = parseDueDay(clean.dueDay) ?? null;

  return {
    ...(options?.id ? { id: options.id } : {}),
    contract_number: clean.contractNumber ?? '',
    contract_date: contractDateIso,
    period_months: clean.tenorMonths,
    interest_payment_date: dueDayInt,
    due_date: dueDateIso,
    investor_name: clean.name,
    loan_amount: clean.principalAmount,
    monthly_interest:
      clean.paymentMethod === 'ANUITAS'
        ? clean.monthlyInstallment || clean.monthlyInterestAmount
        : clean.monthlyInterestAmount,
    keterangan: coreNotes,
    status: clean.status,
  };
}

function toFullDbPayload(
  clean: InvestmentInput,
  options?: { id?: string; createdAt?: string; updatedAt?: string }
): Record<string, unknown> {
  const bonusDateIso = normalizeToIsoDate(clean.bonusDate) ?? null;
  return {
    ...toCoreDbPayload(clean, options),
    monthly_interest: clean.monthlyInterestAmount,
    keterangan: clean.notes ?? '',
    institution: clean.institution,
    category: clean.category,
    payment_method: clean.paymentMethod,
    fixed_principal_per_month: clean.fixedPrincipalPerMonth,
    interest_input_type: clean.interestInputType,
    monthly_interest_rate: clean.monthlyInterestRate,
    late_fee_input_type: clean.lateFeeInputType ?? 'RP',
    late_fee_per_month_amount: clean.lateFeePerMonthAmount ?? 0,
    late_fee_per_month_rate: clean.lateFeePerMonthRate ?? 0,
    bonus_input_type: clean.bonusInputType ?? 'RP',
    bonus_amount: clean.bonusAmount ?? 0,
    bonus_rate: clean.bonusRate ?? 0,
    bonus_date: bonusDateIso,
    monthly_installment: clean.monthlyInstallment,
    start_month_key: clean.startMonthKey,
    paid_months: clean.paidMonths,
    month_statuses: clean.monthStatuses ?? null,
    month_status_warnas: clean.monthStatusWarnas ?? null,
    rescheduled_months: clean.rescheduledMonths ?? null,
    month_realisasi: clean.monthRealisasi ?? null,
    disbursement_realisasi_amount: clean.disbursementRealisasiAmount ?? null,
    ...(clean.disbursementStatus
      ? {
          disbursement_status: clean.disbursementStatus,
          disbursement_status_warna:
            clean.disbursementStatusWarna ??
            (clean.disbursementStatus === 'green'
              ? 'HIJAU'
              : clean.disbursementStatus === 'red'
              ? 'MERAH'
              : 'PUTIH'),
          disbursement_paid: clean.disbursementStatus === 'green',
        }
      : {}),
    ...(clean.disbursementPaidDate
      ? { disbursement_paid_date: normalizeToIsoDate(clean.disbursementPaidDate) ?? null }
      : clean.disbursementStatus === 'white' || clean.disbursementStatus === 'red'
      ? { disbursement_paid_date: null }
      : {}),
    ...(clean.disbursementRescheduledFromMonth
      ? { disbursement_rescheduled_from_month: clean.disbursementRescheduledFromMonth }
      : clean.disbursementStatus && clean.disbursementStatus !== 'red'
      ? { disbursement_rescheduled_from_month: null }
      : {}),
    ...(clean.disbursementRescheduledToMonth
      ? { disbursement_rescheduled_to_month: clean.disbursementRescheduledToMonth }
      : clean.disbursementStatus && clean.disbursementStatus !== 'red'
      ? { disbursement_rescheduled_to_month: null }
      : {}),
    original_contract: clean.originalContract ?? null,
    addendums: clean.addendums ?? null,
    cutoff_date: normalizeToIsoDate(clean.cutoffDate) ?? DEFAULT_INVESTMENT_CUTOFF_DATE,
    legacy_late_fee_before_cutoff: clean.legacyLateFeeBeforeCutoff ?? 0,
    ...(options?.createdAt ? { created_at: options.createdAt } : {}),
    updated_at: options?.updatedAt ?? new Date().toISOString(),
  };
}

const INTEGER_DUE_DAY_CANDIDATES = [
  'interest_payment_day',
  'payment_day',
  'interest_day',
  'due_day',
] as const;

function isIntegerColumnMeta(meta?: SupabaseColumnSchema): boolean {
  if (!meta) return false;
  const fmt = (meta.format ?? '').toLowerCase();
  const typ = (meta.type ?? '').toLowerCase();
  return (
    typ === 'integer' ||
    fmt === 'integer' ||
    fmt === 'int2' ||
    fmt === 'int4' ||
    fmt === 'int8' ||
    fmt === 'smallint' ||
    fmt === 'bigint' ||
    fmt === 'numeric'
  );
}

function isDateColumnMeta(meta?: SupabaseColumnSchema): boolean {
  if (!meta) return false;
  return (meta.format ?? '').toLowerCase() === 'date';
}

function adaptPayloadToSchema(
  basePayload: Record<string, unknown>,
  clean: InvestmentInput | null,
  schema: SupabaseTableSchema | null,
  excludedColumns?: ReadonlySet<string>
): Record<string, unknown> {
  const adapted: Record<string, unknown> = { ...basePayload };

  // Normalisasi semua kolom tanggal agar tidak mengirim '' ke kolom DATE PostgreSQL
  for (const dateKey of [
    'contract_date',
    'due_date',
    'bonus_date',
    'disbursement_paid_date',
    'cutoff_date',
  ] as const) {
    if (dateKey in adapted) {
      const val = adapted[dateKey];
      if (val === '' || val === undefined) {
        adapted[dateKey] = null;
      } else if (val !== null) {
        adapted[dateKey] = normalizeToIsoDate(val) ?? null;
      }
    }
  }

  let matchedDueDayColumn = false;
  if (clean) {
    const dueDayVal = parseDueDay(clean.dueDay) ?? null;
    const matchedIntCol = schema
      ? INTEGER_DUE_DAY_CANDIDATES.find((col) => {
          if (excludedColumns?.has(col)) return false;
          if (!schema.columns.has(col)) return false;
          const meta = schema.columns.get(col);
          return !isDateColumnMeta(meta);
        })
      : undefined;

    if (matchedIntCol) {
      adapted[matchedIntCol] = dueDayVal;
      matchedDueDayColumn = true;
      if (
        schema?.columns.has('interest_payment_date') &&
        !excludedColumns?.has('interest_payment_date')
      ) {
        const ipdMeta = schema.columns.get('interest_payment_date');
        if (isDateColumnMeta(ipdMeta)) {
          adapted.interest_payment_date =
            dueDayVal !== null && schema.required.has('interest_payment_date')
              ? buildDueDayIsoDate(dueDayVal, clean.startDate, clean.startMonthKey)
              : null;
        } else if (isIntegerColumnMeta(ipdMeta)) {
          adapted.interest_payment_date = dueDayVal;
        }
      }
    } else if (
      schema?.columns.has('interest_payment_date') &&
      !excludedColumns?.has('interest_payment_date')
    ) {
      const ipdMeta = schema.columns.get('interest_payment_date');
      if (isDateColumnMeta(ipdMeta)) {
        adapted.interest_payment_date =
          dueDayVal !== null
            ? buildDueDayIsoDate(dueDayVal, clean.startDate, clean.startMonthKey)
            : null;
      } else {
        adapted.interest_payment_date = dueDayVal;
      }
      matchedDueDayColumn = true;
    } else {
      // Jika kolom tanggal bayar bunga tidak tersedia di skema, buang dari top-level agar dipack ke meta
      delete adapted.interest_payment_date;
    }
  }

  const filteredSchema: SupabaseTableSchema | null = schema
    ? (() => {
        const columns = new Map<string, SupabaseColumnSchema>();
        for (const [k, v] of schema.columns.entries()) {
          if (!excludedColumns?.has(k)) columns.set(k, v);
        }
        const required = new Set<string>();
        for (const k of schema.required) {
          if (!excludedColumns?.has(k)) required.add(k);
        }
        return { columns, required };
      })()
    : null;

  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: adapted,
    fallbackColumns: INVESTMENT_FALLBACK_WHITELIST,
    schema: filteredSchema,
    aliases: INVESTMENT_COLUMN_ALIASES,
    excludeFromDropped: INVESTMENT_EXCLUDE_FROM_DROPPED,
    excludedColumns,
  });

  if (clean?.dueDay && !matchedDueDayColumn) {
    dropped.due_day = clean.dueDay;
  }

  if (Object.keys(dropped).length > 0) {
    if ('paid_months' in payload) {
      payload.paid_months = packArrayWithMeta(clean?.paidMonths ?? [], dropped);
    } else if ('keterangan' in payload) {
      payload.keterangan = packNotesWithMeta(
        String(payload.keterangan ?? ''),
        dropped,
        4000
      );
    } else if ('notes' in payload) {
      payload.notes = packNotesWithMeta(String(payload.notes ?? ''), dropped, 4000);
    }
  }

  // Jika kolom payment_method tidak tersedia & anuitas memakai monthlyInstallment, pastikan monthly_interest mencerminkan total cicilan
  if (clean && !('payment_method' in payload) && 'monthly_interest' in payload) {
    if (clean.paymentMethod === 'ANUITAS') {
      payload.monthly_interest = clean.monthlyInstallment || clean.monthlyInterestAmount;
    }
  }

  return payload;
}

async function runInvestmentMutationWithFallback<T>(params: {
  operation: 'insert' | 'update' | 'upsert';
  basePayload: Record<string, unknown>;
  clean: InvestmentInput | null;
  execute: (payload: Record<string, unknown>) => PromiseLike<{ data: T; error: unknown }>;
}): Promise<{ data: T; error: unknown }> {
  let schema = await resolveTableWhitelistSchema(TABLE_NAME);
  const excluded = new Set<string>();
  const missingCandidates = new Set<string>();
  let candidateIdx = 0;
  let retriedWithFreshSchema = false;

  let payload = adaptPayloadToSchema(params.basePayload, params.clean, schema, excluded);
  console.log(`[Supabase][${TABLE_NAME}] ${params.operation} payload:`, payload);

  let result = await params.execute(payload);
  if (!result.error) return result;

  for (let attempt = 0; attempt < 35 && result.error; attempt += 1) {
    if (isMissingColumnSupabaseError(result.error)) {
      invalidateSupabaseTableSchema(TABLE_NAME);
      const col = extractMissingColumnFromError(result.error);
      if (col) {
        excluded.add(col);
        missingCandidates.add(col);
        removeObservedTableColumn(TABLE_NAME, col);
        payload = adaptPayloadToSchema(params.basePayload, params.clean, schema, excluded);
        delete payload[col];

        // Jika sebelumnya gagal saat mencoba kandidat kolom integer day tertentu, lanjut ke kandidat berikutnya
        if (
          params.clean &&
          INTEGER_DUE_DAY_CANDIDATES.includes(
            col as (typeof INTEGER_DUE_DAY_CANDIDATES)[number]
          )
        ) {
          const dueDayVal = parseDueDay(params.clean.dueDay) ?? null;
          while (
            candidateIdx < INTEGER_DUE_DAY_CANDIDATES.length &&
            missingCandidates.has(INTEGER_DUE_DAY_CANDIDATES[candidateIdx])
          ) {
            candidateIdx += 1;
          }
          if (candidateIdx < INTEGER_DUE_DAY_CANDIDATES.length) {
            payload[INTEGER_DUE_DAY_CANDIDATES[candidateIdx]] = dueDayVal;
            candidateIdx += 1;
            if ('interest_payment_date' in payload) {
              payload.interest_payment_date = null;
            }
          }
        }

        console.log(
          `[Supabase][${TABLE_NAME}] ${params.operation} retry payload (removed "${col}"):`,
          payload
        );
        result = await params.execute(payload);
        continue;
      }
    }

    const notNullCol = extractNotNullColumnFromError(result.error);
    if (notNullCol && payload[notNullCol] === null) {
      payload = { ...payload, [notNullCol]: '' };
      console.log(
        `[Supabase][${TABLE_NAME}] ${params.operation} retry payload (not-null "${notNullCol}"):`,
        payload
      );
      result = await params.execute(payload);
      continue;
    }

    if (isDateSyntaxSupabaseError(result.error)) {
      if (!retriedWithFreshSchema) {
        retriedWithFreshSchema = true;
        invalidateSupabaseTableSchema(TABLE_NAME);
        schema = await resolveTableWhitelistSchema(TABLE_NAME);
        if (schema) {
          payload = adaptPayloadToSchema(params.basePayload, params.clean, schema, excluded);
          console.log(
            `[Supabase][${TABLE_NAME}] ${params.operation} retry payload (fresh schema):`,
            payload
          );
          result = await params.execute(payload);
          continue;
        }
      }

      const nextPayload: Record<string, unknown> = { ...payload };
      for (const dateKey of ['contract_date', 'due_date', 'bonus_date', 'cutoff_date'] as const) {
        if (dateKey in nextPayload) {
          nextPayload[dateKey] = nextPayload[dateKey]
            ? normalizeToIsoDate(nextPayload[dateKey]) ?? null
            : null;
        }
      }

      if (params.clean) {
        const dueDayVal = parseDueDay(params.clean.dueDay) ?? null;
        while (
          candidateIdx < INTEGER_DUE_DAY_CANDIDATES.length &&
          missingCandidates.has(INTEGER_DUE_DAY_CANDIDATES[candidateIdx])
        ) {
          candidateIdx += 1;
        }

        if (
          typeof nextPayload.interest_payment_date === 'number' &&
          candidateIdx < INTEGER_DUE_DAY_CANDIDATES.length
        ) {
          const candidateCol = INTEGER_DUE_DAY_CANDIDATES[candidateIdx];
          candidateIdx += 1;
          nextPayload[candidateCol] = dueDayVal;
          nextPayload.interest_payment_date = null;
        } else if ('interest_payment_date' in nextPayload) {
          nextPayload.interest_payment_date =
            dueDayVal !== null
              ? buildDueDayIsoDate(
                  dueDayVal,
                  params.clean.startDate,
                  params.clean.startMonthKey
                )
              : null;
        }
      }

      payload = nextPayload;
      console.log(
        `[Supabase][${TABLE_NAME}] ${params.operation} retry payload (normalized dates):`,
        payload
      );
      result = await params.execute(payload);
      continue;
    }

    break;
  }

  return result;
}

function getKkbSequenceOrder(id: string): number | null {
  const m = /^inv_(?:kkb|csv)_(\d+)(?:_|$)/.exec(id);
  if (!m) return null;
  const num = Number(m[1]);
  return Number.isFinite(num) ? num : null;
}

function sortInvestments(items: InvestmentAsset[]): InvestmentAsset[] {
  return [...items].sort((a, b) => {
    const seqA = getKkbSequenceOrder(a.id);
    const seqB = getKkbSequenceOrder(b.id);
    if (seqA !== null && seqB !== null) {
      return seqA - seqB;
    }
    if (seqA !== null) return -1;
    if (seqB !== null) return 1;
    if (a.status !== b.status) {
      if (a.status === 'Aktif') return -1;
      if (b.status === 'Aktif') return 1;
    }
    return a.name.localeCompare(b.name, 'id');
  });
}

function notifyListeners(items: InvestmentAsset[]): void {
  const sorted = sortInvestments(items);
  latestInvestments = sorted;
  for (const listener of listeners) {
    listener(sorted);
  }
}

export async function getInvestments(): Promise<InvestmentAsset[]> {
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
    throw reportSupabaseError('Gagal mengambil data Investment dari Supabase', error, {
      showAlert: false,
    });
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return sortInvestments(
    rows.map((row, idx) => normalizeInvestment(row, String(row.id ?? `inv_${idx}`)))
  );
}

export async function getInvestmentsByRange(
  startMonthKey: string,
  endMonthKey: string
): Promise<InvestmentAsset[]> {
  const client = requireSupabaseClient();
  const safeStart = normalizeMonthKeyYYYYMM(startMonthKey);
  const safeEnd = normalizeMonthKeyYYYYMM(endMonthKey);
  const endDate = getEndOfMonthISODate(safeEnd);
  const observed = getObservedTableColumns(TABLE_NAME);

  let query = client.from(TABLE_NAME).select('*');
  if (observed?.has('month')) {
    query = query.gte('month', safeStart).lte('month', safeEnd);
  } else if (observed?.has('contract_date')) {
    query = query.lte('contract_date', endDate);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Gagal mengambil data Investment (${safeStart} s/d ${safeEnd}): ${error.message}`
    );
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return sortInvestments(
    rows.map((row, idx) => normalizeInvestment(row, String(row.id ?? `inv_${idx}`)))
  );
}

export async function refreshInvestmentsRangeFromSupabase(
  startMonthKey: string,
  endMonthKey: string
): Promise<InvestmentAsset[]> {
  const rangeList = await getInvestmentsByRange(startMonthKey, endMonthKey);
  const byId = new Map<string, InvestmentAsset>();
  for (const item of latestInvestments) {
    byId.set(item.id, item);
  }
  for (const item of rangeList) {
    byId.set(item.id, item);
  }
  const merged = sortInvestments(Array.from(byId.values()));
  notifyListeners(merged);
  return rangeList;
}

async function refreshInvestmentsFromSupabase(): Promise<InvestmentAsset[]> {
  const list = await getInvestments();
  notifyListeners(list);
  return list;
}

async function fetchSingleInvestmentById(id: string): Promise<InvestmentAsset> {
  const client = requireSupabaseClient();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw reportSupabaseError(
      `Gagal mengambil data kontrak Investment (${id}) dari Supabase`,
      error ?? new Error('Data tidak ditemukan')
    );
  }

  return normalizeInvestment(data as Record<string, unknown>, id);
}

async function updateInvestmentFields(
  id: string,
  fullPatch: Record<string, unknown>,
  clean?: InvestmentInput | null
): Promise<InvestmentAsset> {
  const client = requireSupabaseClient();

  const result = await runInvestmentMutationWithFallback({
    operation: 'update',
    basePayload: fullPatch,
    clean: clean ?? null,
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (result.error || !result.data) {
    throw reportSupabaseError(
      `Gagal memperbarui data Investment (${id}) di Supabase`,
      result.error ?? new Error('Data tidak terupdate di Supabase (periksa RLS policy tabel investments).')
    );
  }

  const updated = normalizeInvestment(result.data as Record<string, unknown>, id);
  try {
    await refreshInvestmentsFromSupabase();
  } catch {
    notifyListeners(
      latestInvestments.some((it) => it.id === id)
        ? latestInvestments.map((it) => (it.id === id ? updated : it))
        : [updated, ...latestInvestments]
    );
  }
  return updated;
}

export function subscribeInvestments(
  onData: (items: InvestmentAsset[]) => void,
  options?: { readOnly?: boolean; onError?: (error: unknown) => void }
): () => void {
  listeners.add(onData);

  if (!supabase) {
    const configErr = new Error(
      'VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY belum dikonfigurasi.'
    );
    options?.onError?.(configErr);
    onData([]);
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const loadFromSupabase = async () => {
    if (cancelled) return;
    try {
      const list = await getInvestments();
      if (cancelled) return;
      notifyListeners(list);
    } catch (err) {
      if (!cancelled) {
        options?.onError?.(err);
        onData(latestInvestments);
      }
    }
  };

  void loadFromSupabase();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void loadFromSupabase();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function createInvestment(input: InvestmentInput): Promise<string> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan data Investment ke Supabase', configError);
  }

  const id = generateInvestmentId();
  const clean = sanitizeInvestmentInput(input);
  const nowIso = new Date().toISOString();
  const fullPayload = toFullDbPayload(clean, {
    id,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const insertResult = await runInvestmentMutationWithFallback({
    operation: 'insert',
    basePayload: fullPayload,
    clean,
    execute: (payload) =>
      client.from(TABLE_NAME).insert([payload]).select().single(),
  });

  if (insertResult.error) {
    throw reportSupabaseError(
      'Gagal menyimpan data Investment ke Supabase',
      insertResult.error
    );
  }

  const insertedRow = (insertResult.data ?? fullPayload) as Record<string, unknown>;
  const saved = normalizeInvestment(insertedRow, id);

  await refreshInvestmentsFromSupabase().catch(() => {
    notifyListeners([saved, ...latestInvestments.filter((x) => x.id !== saved.id)]);
  });

  return saved.id;
}

export const createInvestmentAsset = createInvestment;

export async function updateInvestmentAsset(
  id: string,
  input: InvestmentInput
): Promise<void> {
  let existing: InvestmentAsset | undefined;
  try {
    existing = await fetchSingleInvestmentById(id);
  } catch (err) {
    throw err;
  }

  const clean = sanitizeInvestmentInput({
    ...input,
    originalContract: input.originalContract ?? existing?.originalContract,
    addendums: input.addendums ?? existing?.addendums,
  });
  const nowIso = new Date().toISOString();

  await updateInvestmentFields(
    id,
    toFullDbPayload(clean, { updatedAt: nowIso }),
    clean
  );
}

export async function addInvestmentAddendum(
  id: string,
  submission: InvestmentAddendumFormSubmission
): Promise<void> {
  const target = await fetchSingleInvestmentById(id);

  const existingOriginal: InvestmentOriginalContract = target.originalContract ?? {
    ...(target.contractNumber ? { contractNumber: target.contractNumber } : {}),
    principalAmount: target.principalAmount,
    paymentMethod: target.paymentMethod,
    fixedPrincipalPerMonth: target.fixedPrincipalPerMonth,
    interestInputType: target.interestInputType,
    monthlyInterestAmount: target.monthlyInterestAmount,
    monthlyInterestRate: target.monthlyInterestRate,
    lateFeeInputType: target.lateFeeInputType ?? 'RP',
    lateFeePerMonthAmount: target.lateFeePerMonthAmount ?? 0,
    lateFeePerMonthRate: target.lateFeePerMonthRate ?? 0,
    bonusInputType: target.bonusInputType ?? 'RP',
    bonusAmount: target.bonusAmount ?? 0,
    bonusRate: target.bonusRate ?? 0,
    bonusDate: getEffectiveAssetBonusDate(target),
    tenorMonths: target.tenorMonths,
    startMonthKey: target.startMonthKey,
    startDate: getEffectiveAssetStartDate(target),
    endDate: getEffectiveAssetEndDate(target),
    dueDay: target.dueDay,
    notes: target.notes,
  };

  const existingAddendums = target.addendums ?? [];
  const nextSeq = existingAddendums.length + 1;
  const addendumId = generateAddendumId();

  const prevTenor = target.tenorMonths;
  const additionalTenorMonths = Math.max(
    1,
    Math.min(
      INVESTMENT_SCHEMA_LIMITS.maxTenor - prevTenor,
      Math.round(submission.additionalTenorMonths || 1)
    )
  );
  const newTotalTenor = Math.min(
    INVESTMENT_SCHEMA_LIMITS.maxTenor,
    prevTenor + additionalTenorMonths
  );
  const previousEndDate = getEffectiveAssetEndDate(target);
  const normalizedAddendumDate =
    normalizeToIsoDate(submission.addendumDate) ?? getTodayISODate();
  const extensionAnchorDate =
    normalizedAddendumDate > previousEndDate ? normalizedAddendumDate : previousEndDate;
  const newEndDate =
    normalizeToIsoDate(submission.newEndDate) ??
    computeLoanEndDate(extensionAnchorDate, additionalTenorMonths);
  const newBonusDate = normalizeToIsoDate(submission.newBonusDate) ?? newEndDate;

  const additionalPrincipal = sanitizeAmount(submission.additionalPrincipal);
  const newTotalPrincipal = Math.min(
    INVESTMENT_SCHEMA_LIMITS.maxAmount,
    target.principalAmount + additionalPrincipal
  );

  const normalizedAddendumNumber =
    submission.addendumNumber.trim().slice(0, INVESTMENT_SCHEMA_LIMITS.addendumNumberMax) ||
    `ADD-${nextSeq}`;

  const newRatePct = roundInterestRate(submission.newMonthlyInterestRate);
  let resolvedNewInterestAmount =
    submission.newInterestInputType === 'RP'
      ? sanitizeAmount(submission.newMonthlyInterestAmount)
      : 0;
  let resolvedNewMonthlyInstallment = resolvedNewInterestAmount;
  let resolvedNewFixedPrincipal = target.fixedPrincipalPerMonth;

  if (target.paymentMethod === 'ANUITAS') {
    const scheduleBefore = buildInvestmentSchedule(target);
    const paidPrincipalSoFar = scheduleBefore
      .filter((r) => r.isPaid)
      .reduce((s, r) => s + r.principalPaid, 0);
    const remainingPrincipalForNewTerm = Math.max(
      0,
      newTotalPrincipal - paidPrincipalSoFar
    );
    const rawPerMonth = Math.round(
      remainingPrincipalForNewTerm / Math.max(1, additionalTenorMonths)
    );
    if (
      submission.newMonthlyInstallment !== undefined &&
      submission.newMonthlyInstallment > 0 &&
      submission.newInterestInputType === 'RP'
    ) {
      const inputTotalCicilan = sanitizeAmount(submission.newMonthlyInstallment);
      resolvedNewFixedPrincipal = rawPerMonth;
      resolvedNewInterestAmount = Math.max(
        0,
        inputTotalCicilan - resolvedNewFixedPrincipal
      );
      resolvedNewMonthlyInstallment = resolvedNewFixedPrincipal + resolvedNewInterestAmount;
    } else {
      resolvedNewFixedPrincipal = rawPerMonth;
      const firstMonthBunga = computeMonthlyInterestForBalance({
        remainingPrincipal: remainingPrincipalForNewTerm,
        interestInputType: submission.newInterestInputType,
        monthlyInterestAmount: resolvedNewInterestAmount,
        monthlyInterestRate: newRatePct,
        paymentMethod: 'ANUITAS',
        initialPrincipalBasis: newTotalPrincipal,
      });
      resolvedNewMonthlyInstallment = resolvedNewFixedPrincipal + firstMonthBunga;
    }
  } else {
    resolvedNewMonthlyInstallment = computeMonthlyInterestForBalance({
      remainingPrincipal: newTotalPrincipal,
      interestInputType: submission.newInterestInputType,
      monthlyInterestAmount: resolvedNewInterestAmount,
      monthlyInterestRate: newRatePct,
      paymentMethod: target.paymentMethod,
      initialPrincipalBasis: newTotalPrincipal,
    });
  }

  const newEntry: InvestmentAddendum = {
    id: addendumId,
    sequenceNumber: nextSeq,
    addendumDate: submission.addendumDate || getTodayISODate(),
    addendumNumber: normalizedAddendumNumber,
    additionalTenorMonths,
    previousTenorMonths: prevTenor,
    newTotalTenorMonths: newTotalTenor,
    previousEndDate,
    newEndDate,
    additionalPrincipal,
    effectiveFromInstallment: prevTenor + 1,
    newInterestInputType: submission.newInterestInputType,
    newMonthlyInterestAmount: resolvedNewInterestAmount,
    newMonthlyInterestRate: roundInterestRate(submission.newMonthlyInterestRate),
    ...(target.paymentMethod === 'ANUITAS'
      ? { newMonthlyInstallment: resolvedNewMonthlyInstallment }
      : {}),
    newLateFeeInputType: submission.newLateFeeInputType,
    newLateFeePerMonthAmount: sanitizeAmount(submission.newLateFeePerMonthAmount),
    newLateFeePerMonthRate: roundInterestRate(submission.newLateFeePerMonthRate),
    newBonusInputType: submission.newBonusInputType,
    newBonusAmount: sanitizeAmount(submission.newBonusAmount),
    newBonusRate: roundInterestRate(submission.newBonusRate),
    newBonusDate,
    notes: submission.notes.trim().slice(0, INVESTMENT_SCHEMA_LIMITS.notesMax),
    ...(submission.pdfFileName
      ? {
          pdfFileName: submission.pdfFileName
            .trim()
            .slice(0, INVESTMENT_SCHEMA_LIMITS.pdfFileNameMax),
        }
      : {}),
    createdAt: new Date().toISOString().slice(0, 24),
  };

  const nextAddendums = [...existingAddendums, newEntry];
  const nextStatus: InvestmentStatus =
    target.status === 'Lunas' && target.paidMonths.length < newTotalTenor
      ? 'Aktif'
      : target.status;

  const clean = sanitizeInvestmentInput({
    ...target,
    contractNumber: normalizedAddendumNumber,
    principalAmount: newTotalPrincipal,
    fixedPrincipalPerMonth: resolvedNewFixedPrincipal,
    monthlyInstallment: resolvedNewMonthlyInstallment,
    tenorMonths: newTotalTenor,
    endDate: newEndDate,
    interestInputType: submission.newInterestInputType,
    monthlyInterestAmount: resolvedNewInterestAmount,
    monthlyInterestRate: submission.newMonthlyInterestRate,
    lateFeeInputType: submission.newLateFeeInputType,
    lateFeePerMonthAmount: submission.newLateFeePerMonthAmount,
    lateFeePerMonthRate: submission.newLateFeePerMonthRate,
    bonusInputType: submission.newBonusInputType,
    bonusAmount: submission.newBonusAmount,
    bonusRate: submission.newBonusRate,
    bonusDate: newBonusDate,
    status: nextStatus,
    originalContract: existingOriginal,
    addendums: nextAddendums,
  });

  await updateInvestmentFields(
    id,
    toFullDbPayload(clean, { updatedAt: new Date().toISOString() }),
    clean
  );
}

export async function setInvestmentMonthPaid(
  id: string,
  monthKey: string,
  paid: boolean,
  component?: InvestmentComponentKey
): Promise<void> {
  await setInvestmentMonthStatus(id, monthKey, paid ? 'green' : 'white', undefined, component);
}

export async function setInvestmentMonthStatus(
  id: string,
  monthKey: string,
  color: StatusColorKey,
  targetMonthKey?: string,
  component?: InvestmentComponentKey
): Promise<InvestmentAsset> {
  const target = await fetchSingleInvestmentById(id);
  const statusKey = buildInvestmentComponentPeriodKey(monthKey, component);

  let workingPaidMonths = [...target.paidMonths];
  const nextMonthStatuses: Record<string, 'Not Paid' | 'Paid' | 'Reschedule'> = {
    ...(target.monthStatuses ?? {}),
  };
  const nextMonthStatusWarnas: Record<string, 'PUTIH' | 'HIJAU' | 'MERAH'> = {
    ...(target.monthStatusWarnas ?? {}),
  };
  const nextRescheduledMonths: Record<string, string> = {
    ...(target.rescheduledMonths ?? {}),
  };

  // Jika sebelumnya tersimpan di kunci polos (tanpa komponen), isolasikan ke komponen per-item
  // agar perubahan 1 komponen tidak pernah menular ke Pokok / Bunga / Denda / Bonus lain.
  if (component) {
    if (workingPaidMonths.includes(monthKey)) {
      workingPaidMonths = workingPaidMonths.filter((m) => m !== monthKey);
      for (const comp of INVESTMENT_COMPONENT_KEYS) {
        if (comp !== component && comp !== 'lateFee') {
          const siblingKey = buildInvestmentComponentPeriodKey(monthKey, comp);
          if (!workingPaidMonths.includes(siblingKey)) {
            workingPaidMonths.push(siblingKey);
          }
        }
      }
    }
    const bareWasPaid =
      nextMonthStatuses[monthKey] === 'Paid' || nextMonthStatusWarnas[monthKey] === 'HIJAU';
    if (bareWasPaid) {
      for (const comp of INVESTMENT_COMPONENT_KEYS) {
        if (comp !== component && comp !== 'lateFee') {
          const siblingKey = buildInvestmentComponentPeriodKey(monthKey, comp);
          if (!nextMonthStatuses[siblingKey]) {
            nextMonthStatuses[siblingKey] = 'Paid';
            nextMonthStatusWarnas[siblingKey] = 'HIJAU';
          }
        }
      }
    }
    delete nextMonthStatuses[monthKey];
    delete nextMonthStatusWarnas[monthKey];
    delete nextRescheduledMonths[monthKey];
  }

  const nextPaidMonths =
    color === 'green'
      ? Array.from(new Set([...workingPaidMonths, statusKey])).sort()
      : workingPaidMonths.filter((m) => m !== statusKey);

  const { status: stdStatus, statusWarna: stdWarna } = colorToDbStatusFields(color);
  nextMonthStatuses[statusKey] = stdStatus;
  nextMonthStatusWarnas[statusKey] = stdWarna;
  if (
    color === 'red' &&
    targetMonthKey &&
    INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(targetMonthKey)
  ) {
    nextRescheduledMonths[statusKey] = targetMonthKey;
  } else {
    delete nextRescheduledMonths[statusKey];
  }

  const schedule = buildInvestmentSchedule({
    ...target,
    paidMonths: nextPaidMonths,
    status: target.status === 'Lunas' ? 'Aktif' : target.status,
  });
  const allRowsFullyPaid =
    schedule.length > 0 &&
    schedule.every(
      (row) =>
        (row.principalPaid === 0 || row.isPrincipalPaid) &&
        ((row.interestPaid === 0 && !row.isLate) || row.isInterestPaid) &&
        (row.bonusPaid === 0 || row.isBonusPaid)
    );

  const nextStatus: InvestmentStatus = allRowsFullyPaid
    ? 'Lunas'
    : target.status === 'Lunas'
    ? 'Aktif'
    : target.status;

  const nextMonthRealisasi: Record<string, number> = {
    ...(target.monthRealisasi ?? {}),
  };
  if (color !== 'green') {
    for (const key of Object.keys(nextMonthRealisasi)) {
      if (component) {
        if (key === statusKey) {
          delete nextMonthRealisasi[key];
        }
      } else if (key === monthKey || key.startsWith(`${monthKey}__`)) {
        delete nextMonthRealisasi[key];
      }
    }
  }

  const nextClean = sanitizeInvestmentInput({
    ...target,
    paidMonths: nextPaidMonths,
    monthStatuses: nextMonthStatuses,
    monthStatusWarnas: nextMonthStatusWarnas,
    rescheduledMonths: nextRescheduledMonths,
    monthRealisasi: nextMonthRealisasi,
    status: nextStatus,
  });

  return await updateInvestmentFields(
    id,
    toFullDbPayload(nextClean, { updatedAt: new Date().toISOString() }),
    nextClean
  );
}

export async function toggleInvestmentPaidMonth(
  id: string,
  monthKey: string,
  component?: InvestmentComponentKey
): Promise<void> {
  const target = await fetchSingleInvestmentById(id);
  const exists = component
    ? isInvestmentComponentPaidInSet(new Set(target.paidMonths), monthKey, component)
    : target.paidMonths.includes(monthKey);
  await setInvestmentMonthPaid(id, monthKey, !exists, component);
}

export async function updateInvestmentDates(
  id: string,
  patch: { endDate?: string; bonusDate?: string }
): Promise<void> {
  const target = await fetchSingleInvestmentById(id);

  const normalizedEndDate = normalizeToIsoDate(patch.endDate);
  const normalizedBonusDate = normalizeToIsoDate(patch.bonusDate);
  const changedEnd = Boolean(normalizedEndDate && normalizedEndDate !== target.endDate);
  const changedBonus = Boolean(normalizedBonusDate && normalizedBonusDate !== target.bonusDate);
  if (!changedEnd && !changedBonus) return;

  const nextClean = sanitizeInvestmentInput({
    ...target,
    endDate: changedEnd ? normalizedEndDate : target.endDate,
    bonusDate: changedBonus ? normalizedBonusDate : target.bonusDate,
  });

  await updateInvestmentFields(
    id,
    toFullDbPayload(nextClean, { updatedAt: new Date().toISOString() }),
    nextClean
  );
}

export async function setInvestmentDisbursementStatus(
  id: string,
  params: {
    color: 'white' | 'green' | 'red';
    paidDate?: string;
    rescheduledFromMonth?: string;
    rescheduledToMonth?: string;
  }
): Promise<InvestmentAsset> {
  const target = await fetchSingleInvestmentById(id);
  const nextClean = sanitizeInvestmentInput({
    ...target,
    disbursementStatus: params.color,
    disbursementStatusWarna:
      params.color === 'green'
        ? 'HIJAU'
        : params.color === 'red'
        ? 'MERAH'
        : 'PUTIH',
    disbursementPaidDate:
      params.color === 'green'
        ? normalizeToIsoDate(params.paidDate) ?? getTodayISODate()
        : undefined,
    disbursementRealisasiAmount:
      params.color === 'green' ? target.disbursementRealisasiAmount : undefined,
    disbursementRescheduledFromMonth:
      params.color === 'red'
        ? params.rescheduledFromMonth ?? getEffectiveAssetStartDate(target).slice(0, 7)
        : undefined,
    disbursementRescheduledToMonth:
      params.color === 'red' ? params.rescheduledToMonth : undefined,
  });

  return await updateInvestmentFields(
    id,
    toFullDbPayload(nextClean, { updatedAt: new Date().toISOString() }),
    nextClean
  );
}

export async function updateInvestmentRealisasi(
  id: string,
  params: {
    kind: 'disbursement' | 'component';
    monthKey?: string;
    component?: 'principal' | 'interest' | 'lateFee' | 'bonus';
    realisasiAmount: number;
  }
): Promise<InvestmentAsset> {
  if (!id || !id.trim()) {
    throw new Error('ID Investment wajib ada saat update Realisasi.');
  }
  const client = requireSupabaseClient();
  const cleanAmount = sanitizeAmount(params.realisasiAmount);

  const { data: row, error: fetchErr } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !row) {
    throw reportSupabaseError(
      `Gagal mengambil data Investment (${id}) sebelum update Realisasi`,
      fetchErr ?? new Error('Data tidak ditemukan')
    );
  }

  const rawRow = row as Record<string, unknown>;
  const existing = normalizeInvestment(rawRow, id);
  const { meta: paidMonthsMeta } = unpackArrayWithMeta<string>(
    rawRow.paid_months ?? rawRow.paidMonths
  );
  const { meta: keteranganMeta } = unpackNotesWithMeta(rawRow.keterangan ?? rawRow.notes);

  const cleanMonthKey =
    params.monthKey && INVESTMENT_SCHEMA_LIMITS.monthKeyPattern.test(params.monthKey)
      ? params.monthKey
      : getTodayISODate().slice(0, 7);
  const compKey = `${cleanMonthKey}__${params.component ?? 'principal'}`;
  const nextMonthRealisasi: Record<string, number> = {
    ...(existing.monthRealisasi ?? {}),
    ...(params.kind === 'component' ? { [compKey]: cleanAmount } : {}),
  };

  let schema = await resolveTableWhitelistSchema(TABLE_NAME);
  const excluded = new Set<string>();

  const buildPatch = (): Record<string, unknown> => {
    const targetCol =
      params.kind === 'disbursement' ? 'disbursement_realisasi_amount' : 'month_realisasi';
    const canSendCol =
      !excluded.has(targetCol) && (!schema || schema.columns.size === 0 || schema.columns.has(targetCol));

    if (canSendCol) {
      return {
        [targetCol]: params.kind === 'disbursement' ? cleanAmount : nextMonthRealisasi,
        updated_at: new Date().toISOString(),
      };
    }

    // Fallback ke metadata jika kolom realisasi belum ada di skema tabel live Supabase
    const mergedMeta: Record<string, unknown> = {
      ...keteranganMeta,
      ...paidMonthsMeta,
      ...(params.kind === 'disbursement'
        ? { disbursement_realisasi_amount: cleanAmount }
        : { month_realisasi: nextMonthRealisasi }),
    };
    const fallbackPatch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if ((!schema || schema.columns.has('paid_months')) && !excluded.has('paid_months')) {
      fallbackPatch.paid_months = packArrayWithMeta(existing.paidMonths, mergedMeta);
    } else if ((!schema || schema.columns.has('keterangan')) && !excluded.has('keterangan')) {
      fallbackPatch.keterangan = packNotesWithMeta(existing.notes ?? '', mergedMeta, 4000);
    } else if (schema?.columns.has('notes') && !excluded.has('notes')) {
      fallbackPatch.notes = packNotesWithMeta(existing.notes ?? '', mergedMeta, 4000);
    }
    return fallbackPatch;
  };

  let payload = buildPatch();
  let result = await client.from(TABLE_NAME).update(payload).eq('id', id).select().single();

  for (let attempt = 0; attempt < 15 && result.error; attempt += 1) {
    if (isMissingColumnSupabaseError(result.error)) {
      invalidateSupabaseTableSchema(TABLE_NAME);
      const col = extractMissingColumnFromError(result.error);
      if (col && !excluded.has(col)) {
        excluded.add(col);
        removeObservedTableColumn(TABLE_NAME, col);
        schema = await resolveTableWhitelistSchema(TABLE_NAME);
        payload = buildPatch();
        result = await client.from(TABLE_NAME).update(payload).eq('id', id).select().single();
        continue;
      }
    }
    break;
  }

  if (result.error || !result.data) {
    throw reportSupabaseError(
      `Gagal menyimpan Realisasi Investment (${id}) ke Supabase`,
      result.error ?? new Error('0 baris terupdate. Periksa RLS policy tabel investments.')
    );
  }

  const updated = normalizeInvestment(result.data as Record<string, unknown>, id);
  try {
    await refreshInvestmentsFromSupabase();
  } catch {
    notifyListeners(
      latestInvestments.some((it) => it.id === id)
        ? latestInvestments.map((it) => (it.id === id ? updated : it))
        : [updated, ...latestInvestments]
    );
  }
  return updated;
}

export async function deleteInvestmentAsset(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus data Investment di Supabase', configError);
  }

  const { error } = await client.from(TABLE_NAME).delete().eq('id', id);
  if (error) {
    throw reportSupabaseError(
      `Gagal menghapus data Investment (${id}) di Supabase`,
      error
    );
  }

  await refreshInvestmentsFromSupabase().catch(() => {
    notifyListeners(latestInvestments.filter((it) => it.id !== id));
  });
}

function normalizeContractDedupKey(contractNumber: string | undefined): string | null {
  const trimmed = String(contractNumber ?? '').trim().toLowerCase();
  if (!trimmed || trimmed === '-') return null;
  return trimmed;
}

export async function importInvestmentsBatch(
  entries: Array<{ id?: string; input: InvestmentInput }>,
  options?: { replaceExisting?: boolean }
): Promise<{ count: number }> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal import CSV Investment ke Supabase', configError);
  }

  const replaceExisting = options?.replaceExisting !== false;
  const existingCloud = await getInvestments();
  const existingById = new Map(existingCloud.map((it) => [it.id, it]));
  const existingByContract = new Map<string, InvestmentAsset>();
  for (const item of existingCloud) {
    const key = normalizeContractDedupKey(item.contractNumber);
    if (key && !existingByContract.has(key)) {
      existingByContract.set(key, item);
    }
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const dedupedEntries: Array<{ id?: string; input: InvestmentInput; clean: InvestmentInput }> = [];
  const seenContractPos = new Map<string, number>();

  for (let idx = 0; idx < entries.length; idx += 1) {
    const entry = entries[idx];
    const clean = sanitizeInvestmentInput(entry.input);
    const contractKey = normalizeContractDedupKey(clean.contractNumber);
    if (contractKey) {
      const existingPos = seenContractPos.get(contractKey);
      if (existingPos !== undefined) {
        dedupedEntries[existingPos] = { id: entry.id, input: entry.input, clean };
        continue;
      }
      seenContractPos.set(contractKey, dedupedEntries.length);
    }
    dedupedEntries.push({ id: entry.id, input: entry.input, clean });
  }

  const replacedExistingIds = new Set<string>();
  const nextRecords: InvestmentAsset[] = dedupedEntries.map((entry, idx) => {
    const contractKey = normalizeContractDedupKey(entry.clean.contractNumber);
    const matchedByContract =
      !replaceExisting && contractKey ? existingByContract.get(contractKey) : undefined;
    const rawPreferred =
      entry.id && entry.id.trim()
        ? isUuid(entry.id.trim())
          ? entry.id.trim()
          : deterministicUuid(entry.id.trim())
        : undefined;
    const preferredId =
      matchedByContract?.id ??
      rawPreferred ??
      deterministicUuid(contractKey || `inv_csv_${idx + 1}_${now}`);

    if (matchedByContract) {
      replacedExistingIds.add(matchedByContract.id);
    }

    const prev = existingById.get(preferredId) ?? matchedByContract;
    return {
      id: preferredId,
      ...entry.clean,
      createdAt: prev?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
  });

  const nextIdSet = new Set(nextRecords.map((r) => r.id));
  const deleteIds: string[] = [];
  if (replaceExisting) {
    for (const old of existingCloud) {
      if (!nextIdSet.has(old.id)) deleteIds.push(old.id);
    }
  } else {
    for (const oldId of replacedExistingIds) {
      if (!nextIdSet.has(oldId)) deleteIds.push(oldId);
    }
  }

  if (deleteIds.length > 0) {
    const { error: delErr } = await client.from(TABLE_NAME).delete().in('id', deleteIds);
    if (delErr) {
      throw reportSupabaseError('Gagal menghapus data Investment lama saat import CSV', delErr);
    }
  }

  if (nextRecords.length > 0) {
    const schema = await resolveTableWhitelistSchema(TABLE_NAME);
    const excluded = new Set<string>();
    const buildBatch = () =>
      nextRecords.map((rec) => {
        const cleanRec = sanitizeInvestmentInput(rec);
        return adaptPayloadToSchema(
          toFullDbPayload(cleanRec, {
            id: rec.id,
            createdAt: nowIso,
            updatedAt: nowIso,
          }),
          cleanRec,
          schema,
          excluded
        );
      });

    let batchPayloads = buildBatch();
    console.log(`[Supabase][${TABLE_NAME}] upsert payload:`, batchPayloads);

    let upsertRes = await client
      .from(TABLE_NAME)
      .upsert(batchPayloads, { onConflict: 'id' });

    for (let attempt = 0; attempt < 20 && upsertRes.error; attempt += 1) {
      if (isMissingColumnSupabaseError(upsertRes.error)) {
        invalidateSupabaseTableSchema(TABLE_NAME);
        const missingCol = extractMissingColumnFromError(upsertRes.error);
        if (missingCol && !excluded.has(missingCol)) {
          excluded.add(missingCol);
          removeObservedTableColumn(TABLE_NAME, missingCol);
          batchPayloads = buildBatch();
          console.log(
            `[Supabase][${TABLE_NAME}] upsert retry payload (removed "${missingCol}"):`,
            batchPayloads
          );
          upsertRes = await client
            .from(TABLE_NAME)
            .upsert(batchPayloads, { onConflict: 'id' });
          continue;
        }
      }

      if (isDateSyntaxSupabaseError(upsertRes.error)) {
        invalidateSupabaseTableSchema(TABLE_NAME);
        const refreshedSchema = await resolveTableWhitelistSchema(TABLE_NAME);
        batchPayloads = nextRecords.map((rec) => {
          const cleanRec = sanitizeInvestmentInput(rec);
          return adaptPayloadToSchema(
            toFullDbPayload(cleanRec, {
              id: rec.id,
              createdAt: nowIso,
              updatedAt: nowIso,
            }),
            cleanRec,
            refreshedSchema,
            excluded
          );
        });
        console.log(
          `[Supabase][${TABLE_NAME}] upsert retry payload (refreshed dates):`,
          batchPayloads
        );
        upsertRes = await client
          .from(TABLE_NAME)
          .upsert(batchPayloads, { onConflict: 'id' });
        continue;
      }

      break;
    }

    if (upsertRes.error) {
      throw reportSupabaseError('Gagal menyimpan data import CSV ke Supabase', upsertRes.error);
    }
  }

  await refreshInvestmentsFromSupabase();
  return { count: nextRecords.length };
}
