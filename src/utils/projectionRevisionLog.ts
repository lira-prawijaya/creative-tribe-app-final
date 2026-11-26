import { AuditLogEntry } from '../types/auth';
import { BossReportColorStatus } from '../types/bossReport';
import { BossReportComputedRow, formatBossMonthShortLabel } from './bossReportCalc';
import { formatIDR } from './format';

export const PROJECTION_MARK_PAID_ACTION = 'PROJECTION_MARK_PAID';
export const PROJECTION_CANCEL_PAID_ACTION = 'PROJECTION_CANCEL_PAID';
export const PROJECTION_STATUS_CHANGE_ACTION = 'PROJECTION_STATUS_CHANGE';

export type ProjectionRevisionActionType =
  | 'MARK_PAID'
  | 'CANCEL_PAID'
  | 'STATUS_CHANGE';

export interface ProjectionRevisionRecord {
  id: string;
  monthKey: string;
  rowKey: string;
  sourceId: string;
  rowName: string;
  amount: number;
  investmentAssetId?: string;
  investmentComponent?: 'principal' | 'interest' | 'lateFee' | 'bonus';
  componentLabel: string;
  fromColor: BossReportColorStatus;
  toColor: BossReportColorStatus;
  actionType: ProjectionRevisionActionType;
  reason: string;
  revisionDateISO: string;
  actorName: string;
  createdAtMs: number;
}

export interface RowRevisionStats {
  revisionCount: number;
  lastReason: string;
  lastDateISO: string;
}

export interface InvestmentPaymentHistoryItem {
  id: string;
  dateISO: string;
  dateDisplay: string;
  componentLabel: string;
  transitionLabel: string;
  actorName: string;
  reasonOrNote: string;
  actionType: ProjectionRevisionActionType;
  monthLabel?: string;
  formattedLine: string;
  createdAtMs: number;
}

export function formatSlashDateDDMMYYYY(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((isoDate || '').trim());
  if (!m) return isoDate || '-';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatColorTransitionToken(
  color: BossReportColorStatus,
  kind: 'from' | 'to',
  actionType?: ProjectionRevisionActionType
): string {
  if (color === 'green') return 'Paid';
  if (color === 'red') {
    if (kind === 'to' && actionType === 'CANCEL_PAID') {
      return 'Pending (Batal Paid)';
    }
    return 'Pending';
  }
  if (kind === 'to' && actionType === 'CANCEL_PAID') {
    return 'Projection (Batal Paid)';
  }
  return 'Projection';
}

export function getRowComponentLabel(row: BossReportComputedRow): string {
  if (row.cashInSource === 'investmentDisbursement') {
    return 'Pencairan Pinjaman';
  }
  if (row.sourceCategory === 'investment') {
    if (row.name.startsWith('Angsuran - ')) return 'Angsuran';
    if (row.name.startsWith('Denda - ')) return 'Denda';
    if (row.investmentComponent === 'principal') return 'Pokok';
    if (row.investmentComponent === 'interest') return 'Bunga';
    if (row.investmentComponent === 'lateFee') return 'Denda';
    if (row.investmentComponent === 'bonus') return 'Bonus';
  }
  return row.name;
}

export function buildProjectionAuditSummary(params: {
  revisionDateISO: string;
  componentLabel: string;
  monthKey: string;
  rowName: string;
  amount: number;
  fromColor: BossReportColorStatus;
  toColor: BossReportColorStatus;
  actionType: ProjectionRevisionActionType;
  actorName: string;
  reason: string;
}): string {
  const {
    revisionDateISO,
    componentLabel,
    monthKey,
    rowName,
    amount,
    fromColor,
    toColor,
    actionType,
    actorName,
    reason,
  } = params;
  const dateDisplay = formatSlashDateDDMMYYYY(revisionDateISO);
  const monthLabel = formatBossMonthShortLabel(monthKey);
  const fromToken = formatColorTransitionToken(fromColor, 'from', actionType);
  const toToken = formatColorTransitionToken(toColor, 'to', actionType);
  const transition = `${fromToken} -> ${toToken}`;
  const cleanReason = reason.trim() || (actionType === 'MARK_PAID' ? 'Pelunasan' : '-');
  const noteSegment =
    actionType === 'CANCEL_PAID' ? `Alasan: "${cleanReason}"` : `"${cleanReason}"`;
  const scopeLabel =
    componentLabel !== rowName
      ? `${componentLabel} · ${rowName} (${monthLabel} · Rp ${formatIDR(amount)})`
      : `${componentLabel} (${monthLabel} · Rp ${formatIDR(amount)})`;
  return `${dateDisplay} - ${scopeLabel} - ${transition} - Oleh ${actorName} - ${noteSegment}`.slice(
    0,
    580
  );
}

export function loadProjectionRevisions(): ProjectionRevisionRecord[] {
  return [];
}

export function appendProjectionRevisionRecord(
  record: Omit<ProjectionRevisionRecord, 'id' | 'createdAtMs'>
): ProjectionRevisionRecord {
  return {
    ...record,
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAtMs: Date.now(),
  };
}

function getEntryTimestampMillis(entry: AuditLogEntry): number {
  if (typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)) {
    return entry.createdAt;
  }
  if (
    entry.createdAt &&
    typeof entry.createdAt === 'object' &&
    'seconds' in entry.createdAt
  ) {
    const secs = Number((entry.createdAt as { seconds: unknown }).seconds);
    if (Number.isFinite(secs)) return secs * 1000;
  }
  const parsed = Date.parse(entry.dateISO || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseReasonFromAuditSummary(summary: string): string {
  const alasanMatch = /Alasan:\s*"([^"]+)"/.exec(summary);
  if (alasanMatch?.[1]) return alasanMatch[1];
  const quotedMatch = /-\s*"([^"]+)"\s*$/.exec(summary);
  if (quotedMatch?.[1]) return quotedMatch[1];
  return summary;
}

function parseTransitionFromAuditSummary(summary: string): string {
  const match =
    /((?:PUTIH|HIJAU|MERAH|Projection|Paid|Pending)[^-]*->\s*(?:PUTIH|HIJAU|MERAH|Projection|Paid|Pending)[^-]*?)(?:\s+-\s+Oleh|\s*$)/i.exec(
      summary
    );
  return match?.[1]?.trim() ?? '';
}

function parseComponentFromAuditSummary(summary: string): string {
  const match = /^\d{2}\/\d{2}\/\d{4}\s+-\s+([^·-]+?)(?:\s+·|\s+\(|\s+-)/.exec(summary);
  return match?.[1]?.trim() ?? '';
}

function matchesAuditRow(
  log: AuditLogEntry,
  row: BossReportComputedRow,
  monthKey: string
): boolean {
  if (log.action !== PROJECTION_CANCEL_PAID_ACTION) return false;
  const entityLabel = log.entityLabel ?? '';
  const monthLabel = formatBossMonthShortLabel(monthKey);
  const labelMatchesMonth =
    entityLabel.includes(monthKey) ||
    log.summary.includes(`(${monthLabel}`) ||
    log.summary.includes(`${monthLabel} ·`);

  if (row.sourceCategory === 'investment' && row.investmentAssetId) {
    if (log.entityType !== 'INVESTMENT' || log.entityId !== row.investmentAssetId) {
      return false;
    }
    const comp = getRowComponentLabel(row);
    return labelMatchesMonth && (log.summary.includes(`${comp} `) || entityLabel.includes(row.name));
  }

  const refId =
    row.clientInvoiceId ||
    row.poId ||
    row.opexId ||
    row.sourceId ||
    row.rowKey;
  if (log.entityId && refId && log.entityId === refId && labelMatchesMonth) {
    return true;
  }
  return entityLabel === `${row.name} · ${monthKey}`;
}

export function getRowRevisionStats(
  row: BossReportComputedRow,
  monthKey: string,
  localRevisions: ProjectionRevisionRecord[],
  auditLogs: AuditLogEntry[] = []
): RowRevisionStats {
  const targetSourceId = row.sourceId || row.rowKey;
  const targetInstMonth = row.investmentInstallmentMonthKey || row.originMonthKey;

  const matchingLocal = localRevisions.filter((rec) => {
    if (rec.actionType !== 'CANCEL_PAID') return false;
    if (row.sourceCategory === 'investment' && row.investmentAssetId) {
      if (rec.investmentAssetId !== row.investmentAssetId) return false;
      if (
        row.investmentComponent &&
        rec.investmentComponent &&
        rec.investmentComponent !== row.investmentComponent
      ) {
        return false;
      }
      return (
        rec.monthKey === monthKey ||
        rec.monthKey === targetInstMonth ||
        rec.sourceId === targetSourceId
      );
    }
    return (
      (rec.monthKey === monthKey || rec.monthKey === row.originMonthKey) &&
      (rec.sourceId === targetSourceId || rec.rowKey === row.rowKey)
    );
  });

  if (matchingLocal.length > 0) {
    const sorted = [...matchingLocal].sort((a, b) => b.createdAtMs - a.createdAtMs);
    return {
      revisionCount: sorted.length,
      lastReason: sorted[0].reason,
      lastDateISO: sorted[0].revisionDateISO,
    };
  }

  const matchingAudit = auditLogs
    .filter((log) => matchesAuditRow(log, row, monthKey))
    .sort((a, b) => getEntryTimestampMillis(b) - getEntryTimestampMillis(a));

  if (matchingAudit.length === 0) {
    return { revisionCount: 0, lastReason: '', lastDateISO: '' };
  }

  const latest = matchingAudit[0];
  return {
    revisionCount: matchingAudit.length,
    lastReason: parseReasonFromAuditSummary(latest.summary),
    lastDateISO: latest.dateISO,
  };
}

export function getInvestmentPaymentHistory(
  assetId: string,
  auditLogs: AuditLogEntry[],
  localRevisions: ProjectionRevisionRecord[]
): InvestmentPaymentHistoryItem[] {
  const paymentAuditActions = new Set([
    PROJECTION_MARK_PAID_ACTION,
    PROJECTION_CANCEL_PAID_ACTION,
    PROJECTION_STATUS_CHANGE_ACTION,
    'TOGGLE_INVESTMENT_PAID',
  ]);

  const items: InvestmentPaymentHistoryItem[] = [];
  const seenAuditSummaries = new Set<string>();

  for (const log of auditLogs) {
    if (log.entityType !== 'INVESTMENT' || log.entityId !== assetId) continue;
    if (!paymentAuditActions.has(log.action)) continue;
    const dateISO = log.dateISO || '';
    const dateDisplay = formatSlashDateDDMMYYYY(dateISO);
    const actionType: ProjectionRevisionActionType =
      log.action === PROJECTION_CANCEL_PAID_ACTION
        ? 'CANCEL_PAID'
        : log.action === PROJECTION_MARK_PAID_ACTION
        ? 'MARK_PAID'
        : log.summary.includes('Batal Paid') || log.summary.includes('Belum Bayar')
        ? 'CANCEL_PAID'
        : log.summary.includes('(Paid)') ||
          log.summary.includes('-> Paid') ||
          log.summary.includes('Sudah Bayar')
        ? 'MARK_PAID'
        : 'STATUS_CHANGE';

    const componentLabel = parseComponentFromAuditSummary(log.summary) || 'Cicilan';
    const transitionLabel =
      parseTransitionFromAuditSummary(log.summary) ||
      (actionType === 'CANCEL_PAID'
        ? 'Paid -> Projection (Batal Paid)'
        : actionType === 'MARK_PAID'
        ? 'Projection -> Paid'
        : 'Perubahan Status');
    const reasonOrNote = parseReasonFromAuditSummary(log.summary);
    seenAuditSummaries.add(`${dateISO}|${componentLabel}|${transitionLabel}|${reasonOrNote}`);

    items.push({
      id: log.id,
      dateISO,
      dateDisplay,
      componentLabel,
      transitionLabel,
      actorName: log.actorName || 'Admin KKB',
      reasonOrNote,
      actionType,
      formattedLine: log.summary,
      createdAtMs: getEntryTimestampMillis(log),
    });
  }

  for (const rec of localRevisions) {
    if (rec.investmentAssetId !== assetId) continue;
    const dateDisplay = formatSlashDateDDMMYYYY(rec.revisionDateISO);
    const fromTok = formatColorTransitionToken(rec.fromColor, 'from', rec.actionType);
    const toTok = formatColorTransitionToken(rec.toColor, 'to', rec.actionType);
    const transitionLabel = `${fromTok} -> ${toTok}`;
    const reasonOrNote = rec.reason || (rec.actionType === 'MARK_PAID' ? 'Pelunasan' : '-');
    const dedupKey = `${rec.revisionDateISO}|${rec.componentLabel}|${transitionLabel}|${reasonOrNote}`;
    if (seenAuditSummaries.has(dedupKey)) continue;

    const noteSegment =
      rec.actionType === 'CANCEL_PAID' ? `Alasan: "${reasonOrNote}"` : `"${reasonOrNote}"`;
    items.push({
      id: rec.id,
      dateISO: rec.revisionDateISO,
      dateDisplay,
      componentLabel: rec.componentLabel,
      transitionLabel,
      actorName: rec.actorName || 'Admin KKB',
      reasonOrNote,
      actionType: rec.actionType,
      monthLabel: formatBossMonthShortLabel(rec.monthKey),
      formattedLine: `${dateDisplay} - ${rec.componentLabel} (${formatBossMonthShortLabel(
        rec.monthKey
      )}) - ${transitionLabel} - Oleh ${rec.actorName} - ${noteSegment}`,
      createdAtMs: rec.createdAtMs,
    });
  }

  return items.sort((a, b) => b.createdAtMs - a.createdAtMs);
}
