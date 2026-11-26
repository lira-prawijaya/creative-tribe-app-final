import {
  generateUuid,
  reportSupabaseError,
  requireSupabaseClient,
  supabase,
  SupabaseTableSchema,
} from '../lib/supabaseClient';
import {
  packNotesWithMeta,
  recordObservedTableColumns,
  runWhitelistedSupabaseMutation,
  sanitizePayloadByWhitelist,
  unpackNotesWithMeta,
} from '../lib/supabaseWhitelist';
import {
  ClientPurchaseOrder,
  ClientPurchaseOrderInput,
  normalizeClientPOStatus,
} from '../types/clientPO';
import { getTodayISODate } from '../utils/format';

const TABLE_NAME = 'client_pos';

type ClientPOListener = (items: ClientPurchaseOrder[]) => void;
const listeners = new Set<ClientPOListener>();
let latestClientPOs: ClientPurchaseOrder[] = [];
let channelSeq = 0;

function generateClientPOId(): string {
  return generateUuid();
}

const CLIENT_PO_FALLBACK_WHITELIST: ReadonlySet<string> = new Set([
  'id',
  'client_po_number',
  'po_date',
  'client_name',
  'project_name',
  'project_number',
  'amount',
  'status',
  'notes',
  'created_at',
  'updated_at',
]);

const CLIENT_PO_COLUMN_ALIASES: Record<string, string[]> = {
  notes: ['note'],
  note: ['notes'],
};

const CLIENT_PO_EXCLUDE_FROM_DROPPED: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
]);

export function sanitizeClientPOInput(
  input: ClientPurchaseOrderInput
): ClientPurchaseOrderInput {
  const today = getTodayISODate();
  const rawAmt = Number(input.amount ?? 0);
  const amount = Number.isFinite(rawAmt)
    ? Math.max(0, Math.min(100_000_000_000_000, Math.round(rawAmt)))
    : 0;
  const status = normalizeClientPOStatus(input.status);

  return {
    clientPoNumber: String(input.clientPoNumber ?? '').trim().slice(0, 64) || '-',
    poDate: /^\d{4}-\d{2}-\d{2}$/.test(String(input.poDate ?? ''))
      ? String(input.poDate)
      : today,
    clientName: String(input.clientName ?? '').trim().slice(0, 200) || '-',
    brandName: String(input.brandName ?? '').trim().slice(0, 200),
    projectName: String(input.projectName ?? '').trim().slice(0, 200) || '-',
    projectNumber: String(input.projectNumber ?? '').trim().slice(0, 64) || '-',
    amount,
    targetBillingDate:
      input.targetBillingDate && /^\d{4}-\d{2}-\d{2}$/.test(input.targetBillingDate)
        ? input.targetBillingDate
        : '',
    status,
    notes: String(input.notes ?? '').trim().slice(0, 500),
  };
}

function normalizeClientPO(
  raw: Record<string, unknown>,
  fallbackId: string
): ClientPurchaseOrder {
  const { notes: unpackedNotes, meta } = unpackNotesWithMeta(raw.notes ?? raw.note);

  const clean = sanitizeClientPOInput({
    clientPoNumber: String(raw.client_po_number ?? raw.clientPoNumber ?? meta.client_po_number ?? ''),
    poDate: String(raw.po_date ?? raw.poDate ?? meta.po_date ?? getTodayISODate()),
    clientName: String(raw.client_name ?? raw.clientName ?? meta.client_name ?? ''),
    brandName: String(raw.brand_name ?? raw.brandName ?? meta.brand_name ?? meta.brandName ?? ''),
    projectName: String(raw.project_name ?? raw.projectName ?? meta.project_name ?? ''),
    projectNumber: String(raw.project_number ?? raw.projectNumber ?? meta.project_number ?? ''),
    amount: Number(raw.amount ?? meta.amount ?? 0),
    targetBillingDate: String(
      raw.target_billing_date ??
        raw.targetBillingDate ??
        meta.target_billing_date ??
        meta.targetBillingDate ??
        ''
    ),
    status: normalizeClientPOStatus(raw.status ?? meta.status),
    notes: unpackedNotes || String(meta.notes ?? ''),
  });
  return {
    id: String(raw.id ?? fallbackId),
    ...clean,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  };
}

function toRawClientPODbRecord(
  clean: ClientPurchaseOrderInput,
  options?: { id?: string; createdAt?: string; updatedAt?: string }
): Record<string, unknown> {
  return {
    ...(options?.id ? { id: options.id } : {}),
    client_po_number: clean.clientPoNumber,
    po_date: clean.poDate,
    client_name: clean.clientName,
    brand_name: clean.brandName ?? '',
    project_name: clean.projectName,
    project_number: clean.projectNumber,
    amount: clean.amount,
    target_billing_date: clean.targetBillingDate ?? '',
    status: clean.status,
    notes: clean.notes ?? '',
    ...(options?.createdAt ? { created_at: options.createdAt } : {}),
    updated_at: options?.updatedAt ?? new Date().toISOString(),
  };
}

export function sanitizeClientPODbPayload(
  clean: ClientPurchaseOrderInput,
  schema: SupabaseTableSchema | null,
  options?: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    excludedColumns?: ReadonlySet<string>;
  }
): Record<string, unknown> {
  const rawRecord = toRawClientPODbRecord(clean, options);
  const { payload, dropped } = sanitizePayloadByWhitelist({
    rawPayload: rawRecord,
    fallbackColumns: CLIENT_PO_FALLBACK_WHITELIST,
    schema,
    aliases: CLIENT_PO_COLUMN_ALIASES,
    excludeFromDropped: CLIENT_PO_EXCLUDE_FROM_DROPPED,
    excludedColumns: options?.excludedColumns,
  });

  if (Object.keys(dropped).length > 0) {
    if ('notes' in payload) {
      payload.notes = packNotesWithMeta(String(payload.notes ?? ''), dropped, 2000);
    } else if ('note' in payload) {
      payload.note = packNotesWithMeta(String(payload.note ?? ''), dropped, 2000);
    }
  }

  return payload;
}

function sortClientPOs(list: ClientPurchaseOrder[]): ClientPurchaseOrder[] {
  return [...list].sort((a, b) => (b.poDate || '').localeCompare(a.poDate || ''));
}

function notifyListeners(items: ClientPurchaseOrder[]): void {
  const sorted = sortClientPOs(items);
  latestClientPOs = sorted;
  for (const listener of listeners) {
    listener(sorted);
  }
}

export async function getClientPOs(): Promise<ClientPurchaseOrder[]> {
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
    throw reportSupabaseError('Gagal mengambil data PO Client dari Supabase', error, {
      showAlert: false,
    });
  }

  recordObservedTableColumns(TABLE_NAME, data);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return sortClientPOs(
    rows.map((row, idx) => normalizeClientPO(row, String(row.id ?? `cpo_${idx}`)))
  );
}

async function refreshClientPOsFromSupabase(): Promise<ClientPurchaseOrder[]> {
  const list = await getClientPOs();
  notifyListeners(list);
  return list;
}

export function subscribeClientPOs(
  onData: (items: ClientPurchaseOrder[]) => void,
  _options?: { readOnly?: boolean }
): () => void {
  listeners.add(onData);

  if (!supabase) {
    onData([]);
    return () => {
      listeners.delete(onData);
    };
  }

  let cancelled = false;

  const fetchClientPOs = async () => {
    if (cancelled) return;
    try {
      const list = await getClientPOs();
      if (cancelled) return;
      notifyListeners(list);
    } catch {
      if (!cancelled) {
        onData(latestClientPOs);
      }
    }
  };

  void fetchClientPOs();

  const channel = supabase
    .channel(`${TABLE_NAME}_realtime_${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_NAME },
      () => {
        void fetchClientPOs();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    listeners.delete(onData);
    void supabase?.removeChannel(channel);
  };
}

export async function createClientPO(input: ClientPurchaseOrderInput): Promise<string> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menyimpan data PO Client ke Supabase', configError);
  }

  const id = generateClientPOId();
  const clean = sanitizeClientPOInput(input);
  const nowIso = new Date().toISOString();

  const { data, error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'insert',
    buildPayload: (schema, excluded) =>
      sanitizeClientPODbPayload(clean, schema, {
        id,
        createdAt: nowIso,
        updatedAt: nowIso,
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).insert([payload]).select().single(),
  });

  if (error) {
    throw reportSupabaseError('Gagal menyimpan data PO Client ke Supabase', error);
  }

  const saved = normalizeClientPO((data ?? {}) as Record<string, unknown>, id);
  await refreshClientPOsFromSupabase().catch(() => {
    notifyListeners([saved, ...latestClientPOs.filter((x) => x.id !== saved.id)]);
  });
  return saved.id;
}

export async function updateClientPO(
  id: string,
  input: ClientPurchaseOrderInput
): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal memperbarui data PO Client di Supabase', configError);
  }

  const clean = sanitizeClientPOInput(input);
  const { error } = await runWhitelistedSupabaseMutation({
    tableName: TABLE_NAME,
    operation: 'update',
    buildPayload: (schema, excluded) =>
      sanitizeClientPODbPayload(clean, schema, {
        updatedAt: new Date().toISOString(),
        excludedColumns: excluded,
      }),
    execute: (payload) =>
      client.from(TABLE_NAME).update(payload).eq('id', id).select().single(),
  });

  if (error) {
    throw reportSupabaseError(`Gagal memperbarui PO Client (${id}) di Supabase`, error);
  }

  await refreshClientPOsFromSupabase();
}

export async function deleteClientPO(id: string): Promise<void> {
  let client;
  try {
    client = requireSupabaseClient();
  } catch (configError) {
    throw reportSupabaseError('Gagal menghapus data PO Client di Supabase', configError);
  }

  const { error } = await client.from(TABLE_NAME).delete().eq('id', id);
  if (error) {
    throw reportSupabaseError(`Gagal menghapus PO Client (${id}) di Supabase`, error);
  }

  await refreshClientPOsFromSupabase().catch(() => {
    notifyListeners(latestClientPOs.filter((it) => it.id !== id));
  });
}
