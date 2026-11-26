import { createClient, SupabaseClient } from '@supabase/supabase-js';
export type { SupabaseClient };

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase belum dikonfigurasi: VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY wajib diisi di environment variables.'
  );
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

export function createEphemeralSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase belum dikonfigurasi. Pastikan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY sudah diatur.'
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function requireSupabaseClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Pastikan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY sudah diatur.'
    );
  }
  return supabase;
}

export interface SupabaseColumnSchema {
  type?: string;
  format?: string;
}

export interface SupabaseTableSchema {
  columns: Map<string, SupabaseColumnSchema>;
  required: Set<string>;
}

const tableSchemaCache = new Map<string, Promise<SupabaseTableSchema | null>>();

export function invalidateSupabaseTableSchema(tableName: string): void {
  tableSchemaCache.delete(tableName);
}

export async function fetchSupabaseTableSchema(
  tableName: string
): Promise<SupabaseTableSchema | null> {
  if (!isSupabaseConfigured || typeof fetch !== 'function') return null;

  const existing = tableSchemaCache.get(tableName);
  if (existing) return existing;

  const loader = (async (): Promise<SupabaseTableSchema | null> => {
    try {
      const base = supabaseUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/rest/v1/`, {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          Accept: 'application/openapi+json',
        },
      });
      if (!res.ok) {
        tableSchemaCache.delete(tableName);
        return null;
      }
      const spec = (await res.json()) as {
        definitions?: Record<
          string,
          {
            properties?: Record<string, { type?: string; format?: string }>;
            required?: string[];
          }
        >;
        components?: {
          schemas?: Record<
            string,
            {
              properties?: Record<string, { type?: string; format?: string }>;
              required?: string[];
            }
          >;
        };
      };
      const def =
        spec?.definitions?.[tableName] ?? spec?.components?.schemas?.[tableName];
      if (!def?.properties || typeof def.properties !== 'object') {
        tableSchemaCache.delete(tableName);
        return null;
      }

      const columns = new Map<string, SupabaseColumnSchema>();
      for (const [colName, colMeta] of Object.entries(def.properties)) {
        columns.set(colName, {
          type: colMeta?.type,
          format: colMeta?.format,
        });
      }
      const required = new Set<string>(
        Array.isArray(def.required) ? def.required : []
      );
      return { columns, required };
    } catch {
      tableSchemaCache.delete(tableName);
      return null;
    }
  })();

  tableSchemaCache.set(tableName, loader);
  return loader;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export function generateUuid(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function deterministicUuid(seed: string): string {
  if (isUuid(seed)) return seed.trim().toLowerCase();
  // Generate 128 bits deterministically using 4 independent FNV-1a 32-bit hashes
  const h = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let pass = 0; pass < 4; pass += 1) {
    let hash = h[pass] >>> 0;
    const input = `${pass}:${seed}`;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    h[pass] = hash >>> 0;
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 4; i += 1) {
    bytes[i * 4] = (h[i] >>> 24) & 0xff;
    bytes[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    bytes[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    bytes[i * 4 + 3] = h[i] & 0xff;
  }
  // Set RFC-4122 version 4 and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20, 32)}`;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

type ErrorBannerListener = (message: string | null) => void;
const errorBannerListeners = new Set<ErrorBannerListener>();

export function subscribeDatabaseErrors(listener: ErrorBannerListener): () => void {
  errorBannerListeners.add(listener);
  return () => {
    errorBannerListeners.delete(listener);
  };
}

export function clearDatabaseErrorBanner(): void {
  for (const listener of errorBannerListeners) {
    listener(null);
  }
}

export function extractSupabaseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const rec = error as Record<string, unknown>;
    const parts: string[] = [];
    if (rec.code) parts.push(`[${String(rec.code)}]`);
    if (rec.message) parts.push(String(rec.message));
    if (rec.details) parts.push(`Details: ${String(rec.details)}`);
    if (rec.hint) parts.push(`Hint: ${String(rec.hint)}`);
    if (parts.length > 0) return parts.join(' ');
  }
  return String(error);
}

export function reportSupabaseError(
  context: string,
  error: unknown,
  options?: { showAlert?: boolean }
): Error {
  const detail = extractSupabaseErrorMessage(error);
  const fullMessage = `${context}: ${detail}`;
  console.error(fullMessage, error);
  if (options?.showAlert !== false) {
    for (const listener of errorBannerListeners) {
      listener(fullMessage);
    }
  }
  return new Error(fullMessage);
}

export function handleSupabaseError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  options?: { showAlert?: boolean }
): never {
  const context = `Supabase ${operationType.toUpperCase()} error${path ? ` (${path})` : ''}`;
  throw reportSupabaseError(context, error, options);
}
