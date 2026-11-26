import {
  generateUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
} from '../lib/supabaseClient';
import {
  packNotesWithMeta,
  recordObservedTableColumns,
  runWhitelistedSupabaseMutation,
  sanitizePayloadByWhitelist,
  unpackNotesWithMeta,
} from '../lib/supabaseWhitelist';
import {
  AuditActor,
  AuditEntityType,
  AuditLogEntry,
  DEFAULT_SYSTEM_ACTOR,
} from '../types/auth';
import { formatIDR, getTodayISODate } from '../utils/format';

const TABLE_NAME = 'audit_logs';
const MAX_LOGS = 500;

type AuditListener = (logs: AuditLogEntry[]) => void;
const listeners = new Set<AuditListener>();
let latestLogs: AuditLogEntry[] = [];
let channelSeq = 0;

const AUDIT_LOG_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'id',
  'actor_uid',
  'actor_name',
  'actor_email',
  'actor_role_id',
  'actor_role_name',
  'action',
  'entity_type',
  'entity_id',
  'entity_label',
  'amount',
  'summary',
  'timestamp_display',
  'date_iso',
  'created_at',
]);

const AUDIT_LOG_COLUMN_ALIASES: Record<string, string[]> = {
  actor_name: ['user_name', 'username', 'nama'],
  actor_email: ['user_email', 'email'],
  entity_type: ['category', 'kategori'],
  entity_label: ['doc_number', 'document_number', 'no_dokumen'],
  amount: ['nominal', 'total_amount', 'nilai'],
  summary: ['description', 'notes', 'note', 'keterangan'],
};

const AUDIT_LOG_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'created_at',
]);

const MONTH_ABBR_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

export function formatAuditTimestamp(date: Date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_ABBR_ID[date.getMonth()] || 'Jan';
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

function parseDateFromRaw(val: unknown): Date | null {
  if (val instanceof Date && Number.isFinite(val.getTime())) return val;
  if (typeof val === 'string' && val.trim()) {
    const ms = Date.parse(val.trim());
    if (Number.isFinite(ms)) return new Date(ms);
  }
  if (typeof val === 'number' && Number.isFinite(val)) {
    return new Date(val);
  }
  return null;
}

function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeAuditLog(raw: Record<string, unknown>, fallbackId: string): AuditLogEntry {
  const rawTextCol =
    raw.summary ?? raw.description ?? raw.notes ?? raw.note ?? raw.keterangan ?? '';
  const { notes: unpackedSummary, meta } = unpackNotesWithMeta(rawTextCol);

  const validTypes: AuditEntityType[] = [
    'PO',
    'CLIENT_INVOICE',
    'CLIENT_PO',
    'OPEX',
    'INVESTMENT',
    'USER',
    'ROLE',
    'REPORT',
    'AUTH',
  ];
  const rawType = String(
    raw.entity_type ??
      raw.entityType ??
      raw.category ??
      raw.kategori ??
      meta.entity_type ??
      meta.entityType ??
      'PO'
  ).trim() as AuditEntityType;

  const createdDate = parseDateFromRaw(raw.created_at ?? raw.createdAt);
  const rawDateISO = String(
    raw.date_iso ?? raw.dateISO ?? meta.date_iso ?? meta.dateISO ?? ''
  ).trim();
  const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(rawDateISO)
    ? rawDateISO
    : createdDate
    ? toLocalISODate(createdDate)
    : '';

  const rawTsDisplay = String(
    raw.timestamp_display ??
      raw.timestampDisplay ??
      meta.timestamp_display ??
      meta.timestampDisplay ??
      ''
  ).trim();
  const timestampDisplay =
    rawTsDisplay || (createdDate ? formatAuditTimestamp(createdDate) : dateISO || '-');

  const rawAmount =
    raw.amount ?? raw.nominal ?? raw.total_amount ?? raw.nilai ?? meta.amount;
  const parsedAmount =
    rawAmount !== undefined && rawAmount !== null && rawAmount !== ''
      ? Math.max(0, Math.round(Number(rawAmount) || 0))
      : undefined;

  const rawSummaryText = unpackedSummary.trim() || String(meta.summary ?? '').trim();
  const cleanSummary = rawSummaryText === '()' ? '' : rawSummaryText;

  return {
    id: String(raw.id ?? fallbackId),
    actorUid: String(
      raw.actor_uid ?? raw.actorUid ?? meta.actor_uid ?? meta.actorUid ?? ''
    ).trim(),
    actorName: String(
      raw.actor_name ??
        raw.actorName ??
        raw.user_name ??
        raw.username ??
        raw.nama ??
        meta.actor_name ??
        meta.actorName ??
        ''
    ).trim(),
    actorEmail: String(
      raw.actor_email ??
        raw.actorEmail ??
        raw.user_email ??
        raw.email ??
        meta.actor_email ??
        meta.actorEmail ??
        ''
    ).trim(),
    actorRoleId: String(
      raw.actor_role_id ??
        raw.actorRoleId ??
        meta.actor_role_id ??
        meta.actorRoleId ??
        ''
    ).trim(),
    actorRoleName: String(
      raw.actor_role_name ??
        raw.actorRoleName ??
        meta.actor_role_name ??
        meta.actorRoleName ??
        ''
    ).trim(),
    action: String(raw.action ?? meta.action ?? '').trim(),
    entityType: validTypes.includes(rawType) ? rawType : 'PO',
    entityId: String(
      raw.entity_id ?? raw.entityId ?? meta.entity_id ?? meta.entityId ?? ''
    ).trim(),
    entityLabel: String(
      raw.entity_label ??
        raw.entityLabel ??
        raw.doc_number ??
        raw.document_number ??
        raw.no_dokumen ??
        meta.entity_label ??
        meta.entityLabel ??
        ''
    ).trim(),
    ...(parsedAmount !== undefined && parsedAmount > 0 ? { amount: parsedAmount } : {}),
    summary: cleanSummary,
    timestampDisplay,
    dateISO,
    createdAt: raw.created_at ?? raw.createdAt,
  };
}

function notifyListeners(logs: AuditLogEntry[]): void {
  latestLogs = logs;
  for (const listener of listeners) {
    listener(logs);
  }
}

export async function getAuditLogs(maxItems = MAX_LOGS): Promise<AuditLogEntry[]> {
  const client = requireSupabaseClient();
  let res = await client
    .from(TABLE_NAME)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(maxItems);

  if (res.error && String(res.error.message ?? '').toLowerCase().includes('created_at')) {
    res = await client.from(TABLE_NAME).select('*').limit(maxItems);
  }

  if (res.error) {
    throw reportSupabaseError('Gagal mengambil audit_logs dari Supabase', res.error, {
      showAlert: false,
    });
  }

  recordObservedTableColumns(TABLE_NAME, res.data);

  return (res.data ?? []).map((row, idx) =>
    normalizeAuditLog(
      row as Record<string, unknown>,
      String((row as { id?: unknown }).id ?? `log_${idx}`)
    )
  );
}

export function subscribeAuditLogs(
  onData: (logs: AuditLogEntry[]) => void,
  onError?: (err: Error) => void,
  maxItems = MAX_LOGS
): () => void {
  listeners.add(onData);

  if (!supabase) {
    onData([]);
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const fetchAuditLogs = async () => {
    if (cancelled) return;
    try {
      const list = await getAuditLogs(maxItems);
      if (cancelled) return;
      notifyListeners(list);
    } catch (err) {
      if (onError && err instanceof Error) onError(err);
      if (!cancelled) onData(latestLogs);
    }
  };

  void fetchAuditLogs();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchAuditLogs();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function logAuditActivity(
  actor: AuditActor | null | undefined,
  params: {
    action: string;
    entityType: AuditEntityType;
    entityId?: string;
    entityLabel?: string;
    amount?: number;
    summary: string;
    dateISO?: string;
  }
): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const resolvedActor: AuditActor =
    actor && (actor.uid || actor.email || actor.name)
      ? {
          uid: actor.uid || actor.email || DEFAULT_SYSTEM_ACTOR.uid,
          name:
            (actor.name || '').trim() ||
            (actor.email ? actor.email.split('@')[0] : '') ||
            DEFAULT_SYSTEM_ACTOR.name,
          email: (actor.email || '').trim() || DEFAULT_SYSTEM_ACTOR.email,
          roleId: (actor.roleId || '').trim() || DEFAULT_SYSTEM_ACTOR.roleId,
          roleName: (actor.roleName || '').trim() || DEFAULT_SYSTEM_ACTOR.roleName,
        }
      : DEFAULT_SYSTEM_ACTOR;

  const id = generateUuid();
  const timestampDisplay = formatAuditTimestamp();
  const dateISO =
    params.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(params.dateISO)
      ? params.dateISO
      : getTodayISODate();
  const nowIso = new Date().toISOString();

  const cleanAmount =
    typeof params.amount === 'number' && Number.isFinite(params.amount) && params.amount > 0
      ? Math.round(params.amount)
      : 0;
  const cleanLabel = (params.entityLabel ?? '').trim().slice(0, 160);
  const rawSummary = (params.summary ?? '').trim();
  const fallbackParts = [
    resolvedActor.name,
    params.action.trim(),
    cleanLabel,
    cleanAmount > 0 ? `sebesar Rp ${formatIDR(cleanAmount)}` : '',
  ].filter(Boolean);
  const finalSummary = (
    rawSummary && rawSummary !== '()' ? rawSummary : fallbackParts.join(' ')
  ).slice(0, 600);

  if (!finalSummary || finalSummary === '()') return;

  const rawPayload: Record<string, unknown> = {
    id,
    actor_uid: resolvedActor.uid.slice(0, 128),
    actor_name: resolvedActor.name.slice(0, 120),
    actor_email: resolvedActor.email.slice(0, 180),
    actor_role_id: resolvedActor.roleId.slice(0, 64),
    actor_role_name: resolvedActor.roleName.slice(0, 80),
    action: params.action.trim().slice(0, 64),
    entity_type: params.entityType,
    entity_id: params.entityId ? params.entityId.slice(0, 128) : '',
    entity_label: cleanLabel,
    amount: cleanAmount,
    summary: finalSummary,
    timestamp_display: timestampDisplay,
    date_iso: dateISO,
    created_at: nowIso,
  };

  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'insert',
    buildPayload: (schema, excluded) => {
      const { payload, dropped } = sanitizePayloadByWhitelist({
        rawPayload,
        fallbackColumns: AUDIT_LOG_FALLBACK_WHITELIST,
        schema,
        aliases: AUDIT_LOG_COLUMN_ALIASES,
        excludeFromDropped: AUDIT_LOG_EXCLUDE_FROM_DROPPED,
        excludedColumns: excluded,
      });

      if (Object.keys(dropped).length > 0) {
        const textCol = (['summary', 'description', 'notes', 'note', 'keterangan'] as const).find(
          (c) => c in payload
        );
        if (textCol) {
          payload[textCol] = packNotesWithMeta(String(payload[textCol] ?? finalSummary), dropped, 3500);
        }
      }

      return payload;
    },
    execute: (payload) => client.from(TABLE_NAME).insert([payload]).select(),
  });

  if (error) {
    console.error('Gagal menyimpan audit_logs ke Supabase:', error);
    return;
  }

  void getAuditLogs(MAX_LOGS)
    .then((list) => notifyListeners(list))
    .catch(() => {});
}

export async function deleteSelectedAuditLogs(ids: string[]): Promise<number> {
  const uniqueIds = Array.from(
    new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) return 0;

  const client = requireSupabaseClient();
  const chunkSize = 100;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const { error } = await client.from(TABLE_NAME).delete().in('id', chunk);
    if (error) {
      throw reportSupabaseError('Gagal menghapus log aktivitas terpilih di Supabase', error);
    }
  }

  const list = await getAuditLogs(MAX_LOGS);
  notifyListeners(list);
  return uniqueIds.length;
}

export async function deleteAllAuditLogs(
  actor: AuditActor | null | undefined,
  reason: string
): Promise<void> {
  const cleanReason = String(reason ?? '').trim();
  if (cleanReason.length < 5) {
    throw new Error('Alasan penghapusan log wajib diisi minimal 5 karakter.');
  }

  const client = requireSupabaseClient();

  const { error: deleteAllErr } = await client
    .from(TABLE_NAME)
    .delete()
    .not('id', 'is', null);

  if (deleteAllErr) {
    // Fallback batch delete by id if .not('id', 'is', null) is rejected
    const { data: rows, error: fetchErr } = await client
      .from(TABLE_NAME)
      .select('id')
      .limit(5000);
    if (fetchErr) {
      throw reportSupabaseError('Gagal menghapus semua log aktivitas di Supabase', deleteAllErr);
    }
    const ids = (rows ?? [])
      .map((r) => String((r as { id?: unknown }).id ?? '').trim())
      .filter(Boolean);
    for (let i = 0; i < ids.length; i += 100) {
      const { error: chunkErr } = await client
        .from(TABLE_NAME)
        .delete()
        .in('id', ids.slice(i, i + 100));
      if (chunkErr) {
        throw reportSupabaseError('Gagal menghapus semua log aktivitas di Supabase', chunkErr);
      }
    }
  }

  const actorName =
    (actor?.name ?? '').trim() ||
    (actor?.email ? actor.email.split('@')[0] : '') ||
    DEFAULT_SYSTEM_ACTOR.name;

  await logAuditActivity(actor, {
    action: 'CLEAR_AUDIT_LOGS',
    entityType: 'REPORT',
    entityLabel: 'LOG-AKTIVITAS',
    summary: `Log dihapus oleh ${actorName} - Alasan: ${cleanReason}`,
  });

  const list = await getAuditLogs(MAX_LOGS);
  notifyListeners(list);
}

