import {
  fetchSupabaseTableSchema,
  generateUuid,
  invalidateSupabaseTableSchema,
  requireSupabaseClient,
  SupabaseColumnSchema,
  SupabaseTableSchema,
} from './supabaseClient';
import { normalizeToIsoDate } from '../utils/format';

const observedColumnsCache = new Map<string, Set<string>>();

export function recordObservedTableColumns(
  tableName: string,
  rows: unknown[] | null | undefined
): void {
  if (!Array.isArray(rows) || rows.length === 0) return;
  let colSet = observedColumnsCache.get(tableName);
  if (!colSet) {
    colSet = new Set<string>();
    observedColumnsCache.set(tableName, colSet);
  }
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        colSet.add(key);
      }
    }
  }
}

export function getObservedTableColumns(tableName: string): Set<string> | null {
  const existing = observedColumnsCache.get(tableName);
  return existing && existing.size > 0 ? existing : null;
}

export function removeObservedTableColumn(tableName: string, column: string): void {
  observedColumnsCache.get(tableName)?.delete(column);
}

/**
 * Mengambil skema kolom aktual dari OpenAPI Supabase (/rest/v1/),
 * atau dari kolom row yang pernah terbaca jika OpenAPI tidak tersedia.
 */
export async function resolveTableWhitelistSchema(
  tableName: string
): Promise<SupabaseTableSchema | null> {
  const openApiSchema = await fetchSupabaseTableSchema(tableName);
  if (openApiSchema && openApiSchema.columns.size > 0) {
    return openApiSchema;
  }

  let observed = getObservedTableColumns(tableName);
  if (!observed) {
    try {
      const client = requireSupabaseClient();
      const { data } = await client.from(tableName).select('*').limit(1);
      if (Array.isArray(data) && data.length > 0) {
        recordObservedTableColumns(tableName, data);
        observed = getObservedTableColumns(tableName);
      }
    } catch {
      // Fallback ke conservative whitelist milik service
    }
  }

  if (observed && observed.size > 0) {
    const columns = new Map<string, SupabaseColumnSchema>();
    for (const col of observed) {
      columns.set(col, {});
    }
    return { columns, required: new Set<string>() };
  }

  return null;
}

export function isDateColumnSchema(meta?: SupabaseColumnSchema): boolean {
  if (!meta) return false;
  return (meta.format ?? '').toLowerCase() === 'date';
}

export function isTimestampColumnSchema(meta?: SupabaseColumnSchema): boolean {
  if (!meta) return false;
  const fmt = (meta.format ?? '').toLowerCase();
  return (
    fmt === 'timestamp with time zone' ||
    fmt === 'timestamptz' ||
    fmt === 'timestamp without time zone' ||
    fmt === 'date-time'
  );
}

export function isNumericColumnSchema(meta?: SupabaseColumnSchema): boolean {
  if (!meta) return false;
  const fmt = (meta.format ?? '').toLowerCase();
  const typ = (meta.type ?? '').toLowerCase();
  return (
    typ === 'integer' ||
    typ === 'number' ||
    fmt === 'integer' ||
    fmt === 'int2' ||
    fmt === 'int4' ||
    fmt === 'int8' ||
    fmt === 'smallint' ||
    fmt === 'bigint' ||
    fmt === 'numeric' ||
    fmt === 'double precision' ||
    fmt === 'real'
  );
}

export function coerceValueForSchemaColumn(
  value: unknown,
  meta?: SupabaseColumnSchema
): unknown {
  if (value === undefined) return undefined;
  if (!meta) return value;

  if (isDateColumnSchema(meta)) {
    if (value === null || value === '') return null;
    return normalizeToIsoDate(value) ?? null;
  }
  if (isTimestampColumnSchema(meta)) {
    if (value === null || value === '') return null;
    return value;
  }
  if (isNumericColumnSchema(meta)) {
    if (value === null || value === '') return null;
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return value;
  }
  if ((meta.format ?? '').toLowerCase() === 'uuid') {
    if (value === null || value === '') return null;
    return value;
  }
  return value;
}

export function isEmptyMetadataValue(val: unknown): boolean {
  if (val === undefined || val === null || val === '' || val === false) return true;
  if (Array.isArray(val) && val.length === 0) return true;
  if (
    typeof val === 'object' &&
    !Array.isArray(val) &&
    Object.keys(val as Record<string, unknown>).length === 0
  ) {
    return true;
  }
  return false;
}

export interface SanitizeDbPayloadOptions {
  rawPayload: Record<string, unknown>;
  fallbackColumns: ReadonlySet<string>;
  schema: SupabaseTableSchema | null;
  aliases?: Record<string, string[]>;
  excludeFromDropped?: ReadonlySet<string>;
  excludedColumns?: ReadonlySet<string>;
}

/**
 * Memfilter payload agar HANYA mengirim kolom yang ada di skema tabel Supabase.
 * Field yang tidak ada di whitelist kolom dikumpulkan di `dropped` untuk disimpan ke JSONB / notes.
 */
export function sanitizePayloadByWhitelist(options: SanitizeDbPayloadOptions): {
  payload: Record<string, unknown>;
  dropped: Record<string, unknown>;
} {
  const {
    rawPayload,
    fallbackColumns,
    schema,
    aliases,
    excludeFromDropped,
    excludedColumns,
  } = options;
  const rawAllowed =
    schema && schema.columns.size > 0
      ? schema.columns.keys()
      : fallbackColumns;
  const allowedSet = new Set<string>();
  for (const col of rawAllowed) {
    if (!excludedColumns?.has(col)) {
      allowedSet.add(col);
    }
  }

  const payload: Record<string, unknown> = {};
  const dropped: Record<string, unknown> = {};

  for (const [key, rawVal] of Object.entries(rawPayload)) {
    if (rawVal === undefined) continue;

    if (allowedSet.has(key)) {
      payload[key] = coerceValueForSchemaColumn(rawVal, schema?.columns.get(key));
      continue;
    }

    const aliasCandidates = aliases?.[key];
    const matchedAlias = aliasCandidates?.find(
      (alias) => allowedSet.has(alias) && !(alias in rawPayload) && !(alias in payload)
    );
    if (matchedAlias) {
      payload[matchedAlias] = coerceValueForSchemaColumn(
        rawVal,
        schema?.columns.get(matchedAlias)
      );
      continue;
    }

    if (!excludeFromDropped?.has(key) && !isEmptyMetadataValue(rawVal)) {
      dropped[key] = rawVal;
    }
  }

  return { payload, dropped };
}

interface JsonbMetaEnvelope {
  __meta?: boolean;
  __poMeta?: boolean;
  [key: string]: unknown;
}

export function packObjectWithMeta(
  obj: Record<string, unknown>,
  meta: Record<string, unknown>
): Record<string, unknown> {
  const cleanObj: Record<string, unknown> = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (k !== '__meta') cleanObj[k] = v;
    }
  }
  const nonEmptyMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!isEmptyMetadataValue(v)) {
      nonEmptyMeta[k] = v;
    }
  }
  if (Object.keys(nonEmptyMeta).length === 0) {
    return cleanObj;
  }
  return { ...cleanObj, __meta: nonEmptyMeta };
}

export function unpackObjectWithMeta(raw: unknown): {
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: {}, meta: {} };
  }
  const rec = raw as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  let meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === '__meta' && v && typeof v === 'object' && !Array.isArray(v)) {
      meta = { ...(v as Record<string, unknown>) };
    } else {
      data[k] = v;
    }
  }
  return { data, meta };
}

export function packArrayWithMeta<T>(
  items: T[],
  meta: Record<string, unknown>
): unknown[] {
  const cleanItems = Array.isArray(items)
    ? items.filter((it) => {
        if (!it || typeof it !== 'object') return true;
        const rec = it as JsonbMetaEnvelope;
        return rec.__meta !== true && rec.__poMeta !== true;
      })
    : [];

  const nonEmptyMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!isEmptyMetadataValue(v)) {
      nonEmptyMeta[k] = v;
    }
  }

  if (Object.keys(nonEmptyMeta).length === 0) {
    return cleanItems;
  }

  return [...cleanItems, { __meta: true, ...nonEmptyMeta }];
}

export function unpackArrayWithMeta<T>(raw: unknown): {
  items: T[];
  meta: Record<string, unknown>;
} {
  let parsedRaw: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        parsedRaw = JSON.parse(trimmed);
      } catch {
        parsedRaw = raw;
      }
    }
  }
  const meta: Record<string, unknown> = {};
  if (Array.isArray(parsedRaw)) {
    const items: T[] = [];
    for (const entry of parsedRaw) {
      if (
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        ((entry as JsonbMetaEnvelope).__meta === true ||
          (entry as JsonbMetaEnvelope).__poMeta === true)
      ) {
        const rec = entry as JsonbMetaEnvelope;
        for (const [k, v] of Object.entries(rec)) {
          if (k !== '__meta' && k !== '__poMeta') {
            meta[k] = v;
          }
        }
      } else {
        items.push(entry as T);
      }
    }
    return { items, meta };
  }

  if (parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)) {
    const rec = parsedRaw as Record<string, unknown>;
    const rawList = Array.isArray(rec.lineItems)
      ? (rec.lineItems as T[])
      : Array.isArray(rec.items)
      ? (rec.items as T[])
      : [];
    const rawMeta =
      (rec._meta as Record<string, unknown> | undefined) ??
      (rec.meta as Record<string, unknown> | undefined);
    if (rawMeta && typeof rawMeta === 'object') {
      Object.assign(meta, rawMeta);
    }
    return { items: rawList, meta };
  }

  return { items: [], meta };
}

const NOTES_META_RE = /\n*<!--META:(\{[\s\S]*?\})-->\s*$/;

export function packNotesWithMeta(
  notes: string,
  meta: Record<string, unknown>,
  maxTotalLength = 2000
): string {
  const cleanNotes = unpackNotesWithMeta(notes).notes;
  const nonEmptyMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!isEmptyMetadataValue(v)) {
      nonEmptyMeta[k] = v;
    }
  }
  if (Object.keys(nonEmptyMeta).length === 0) {
    return cleanNotes;
  }
  const suffix = `<!--META:${JSON.stringify(nonEmptyMeta)}-->`;
  const sep = cleanNotes ? '\n' : '';
  const candidate = `${cleanNotes}${sep}${suffix}`;
  if (candidate.length <= maxTotalLength) {
    return candidate;
  }
  const allowedNoteLen = Math.max(0, maxTotalLength - suffix.length - sep.length);
  return `${cleanNotes.slice(0, allowedNoteLen)}${cleanNotes.slice(0, allowedNoteLen) ? '\n' : ''}${suffix}`;
}

export function unpackNotesWithMeta(rawNotes: unknown): {
  notes: string;
  meta: Record<string, unknown>;
} {
  if (typeof rawNotes !== 'string' || !rawNotes) {
    return { notes: '', meta: {} };
  }
  const match = NOTES_META_RE.exec(rawNotes);
  if (!match) {
    return { notes: rawNotes, meta: {} };
  }
  const cleanNotes = rawNotes.slice(0, match.index).trimEnd();
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { notes: cleanNotes, meta: parsed as Record<string, unknown> };
    }
  } catch {
    // Abaikan JSON rusak
  }
  return { notes: cleanNotes, meta: {} };
}

export function isMissingColumnSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message).toLowerCase() : '';
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('does not exist')
  );
}

export function extractMissingColumnFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const message =
    'message' in error ? String((error as { message?: unknown }).message) : '';
  const m1 = /Could not find the '([^']+)' column/i.exec(message);
  if (m1?.[1]) return m1[1];
  const m2 = /column "([^"]+)" of relation/i.exec(message);
  if (m2?.[1]) return m2[1];
  const m3 = /column "([^"]+)" does not exist/i.exec(message);
  if (m3?.[1]) return m3[1];
  const m4 = /column (?:[a-zA-Z_][a-zA-Z0-9_]*\.)?([a-zA-Z_][a-zA-Z0-9_]*) does not exist/i.exec(
    message
  );
  if (m4?.[1]) return m4[1];
  return null;
}

export function extractNotNullColumnFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code !== '23502') return null;
  const message =
    'message' in error ? String((error as { message?: unknown }).message) : '';
  const m = /null value in column "([^"]+)"/i.exec(message);
  return m?.[1] ?? null;
}

export function isDateSyntaxSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message).toLowerCase() : '';
  return (
    code === '22008' ||
    code === '22007' ||
    message.includes('date/time field value out of range') ||
    message.includes('invalid input syntax for type date') ||
    message.includes('invalid input syntax for type timestamp')
  );
}

function filterSchemaExcluding(
  schema: SupabaseTableSchema | null,
  excluded: ReadonlySet<string>
): SupabaseTableSchema | null {
  if (!schema || excluded.size === 0) return schema;
  const columns = new Map<string, SupabaseColumnSchema>();
  for (const [k, v] of schema.columns.entries()) {
    if (!excluded.has(k)) columns.set(k, v);
  }
  const required = new Set<string>();
  for (const k of schema.required) {
    if (!excluded.has(k)) required.add(k);
  }
  return { columns, required };
}

/**
 * Menjalankan mutasi Supabase dengan:
 * 1) Whitelist kolom berdasarkan skema tabel aktual + metadata packing ke JSONB/notes
 * 2) Console log payload sebelum eksekusi untuk kemudahan debug
 * 3) Auto-recovery jika terjadi error PGRST204 / 23502 / 22007 / 22008
 */
export async function runWhitelistedSupabaseMutation<T>(params: {
  tableName: string;
  operation: 'insert' | 'update' | 'upsert';
  buildPayload: (
    schema: SupabaseTableSchema | null,
    excludedColumns: ReadonlySet<string>
  ) => Record<string, unknown>;
  execute: (
    payload: Record<string, unknown>
  ) => PromiseLike<{ data: T; error: unknown }>;
}): Promise<{ data: T; error: unknown }> {
  const { tableName, operation, buildPayload, execute } = params;
  const excluded = new Set<string>();
  const schema = await resolveTableWhitelistSchema(tableName);
  let payload = buildPayload(filterSchemaExcluding(schema, excluded), excluded);

  console.log(`[Supabase][${tableName}] ${operation} payload:`, payload);

  let result = await execute(payload);
  if (!result.error) {
    return result;
  }

  for (let attempt = 0; attempt < 25 && result.error; attempt += 1) {
    if (isMissingColumnSupabaseError(result.error)) {
      invalidateSupabaseTableSchema(tableName);
      const missingCol = extractMissingColumnFromError(result.error);
      if (missingCol && !excluded.has(missingCol)) {
        excluded.add(missingCol);
        removeObservedTableColumn(tableName, missingCol);
        payload = buildPayload(filterSchemaExcluding(schema, excluded), excluded);
        delete payload[missingCol];
        console.log(
          `[Supabase][${tableName}] ${operation} retry payload (removed "${missingCol}"):`,
          payload
        );
        result = await execute(payload);
        continue;
      }
    }

    const notNullCol = extractNotNullColumnFromError(result.error);
    if (notNullCol && (payload[notNullCol] === null || payload[notNullCol] === undefined)) {
      const nextPayload = {
        ...payload,
        [notNullCol]: notNullCol === 'id' ? generateUuid() : '',
      };
      payload = nextPayload;
      console.log(
        `[Supabase][${tableName}] ${operation} retry payload (not-null "${notNullCol}"):`,
        payload
      );
      result = await execute(payload);
      continue;
    }

    // Jika kolom id bertipe bigint/integer/identity dan gagal menerima UUID pada insert, biarkan DB auto-generate id
    if (operation === 'insert' && 'id' in payload && !excluded.has('id')) {
      const errObj = result.error as { code?: unknown; message?: unknown };
      const errCode = String(errObj?.code ?? '');
      const errMsg = String(errObj?.message ?? '').toLowerCase();
      if (
        errCode === '428C9' ||
        (errCode === '22P02' &&
          (errMsg.includes('bigint') ||
            errMsg.includes('integer') ||
            errMsg.includes('smallint')))
      ) {
        excluded.add('id');
        payload = buildPayload(filterSchemaExcluding(schema, excluded), excluded);
        delete payload.id;
        console.log(
          `[Supabase][${tableName}] ${operation} retry payload (auto-generated id):`,
          payload
        );
        result = await execute(payload);
        continue;
      }
    }

    if (isDateSyntaxSupabaseError(result.error)) {
      invalidateSupabaseTableSchema(tableName);
      const nextPayload = { ...payload };
      let changed = false;
      for (const [k, v] of Object.entries(nextPayload)) {
        if (k.endsWith('_date') || k === 'due_date' || k === 'deleted_at' || k === 'date_iso') {
          if (v === '') {
            nextPayload[k] = null;
            changed = true;
          } else if (k === 'deleted_at' && typeof v === 'string') {
            const parsed = Date.parse(v);
            if (Number.isFinite(parsed)) {
              const isoTs = new Date(parsed).toISOString();
              if (isoTs !== v) {
                nextPayload[k] = isoTs;
                changed = true;
              }
            } else {
              nextPayload[k] = new Date().toISOString();
              changed = true;
            }
          } else if (typeof v === 'string') {
            const iso = normalizeToIsoDate(v);
            if (iso && iso !== v) {
              nextPayload[k] = iso;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        payload = nextPayload;
        console.log(
          `[Supabase][${tableName}] ${operation} retry payload (normalized dates):`,
          payload
        );
        result = await execute(payload);
        continue;
      }
    }

    break;
  }

  return result;
}
