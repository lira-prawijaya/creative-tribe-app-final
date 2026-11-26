export type ClientPOStatus =
  | 'Draft PO'
  | 'PO Terkirim'
  | 'Sudah Ditagih'
  | 'Sudah Cair';

export interface ClientPurchaseOrder {
  id: string;
  clientPoNumber: string;
  poDate: string; // YYYY-MM-DD
  clientName: string;
  brandName?: string;
  projectName: string;
  projectNumber: string;
  amount: number;
  targetBillingDate?: string; // YYYY-MM-DD
  status: ClientPOStatus;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClientPurchaseOrderInput {
  clientPoNumber: string;
  poDate: string;
  clientName: string;
  brandName?: string;
  projectName: string;
  projectNumber: string;
  amount: number;
  targetBillingDate?: string;
  status: ClientPOStatus;
  notes?: string;
}

export function normalizeClientPOStatus(raw: unknown): ClientPOStatus {
  const s = String(raw ?? 'Draft PO');
  if (s === 'PO Terkirim') return 'PO Terkirim';
  if (s === 'Sudah Ditagih' || s === 'Sebagian Ditagih') return 'Sudah Ditagih';
  if (s === 'Sudah Cair' || s === 'Selesai') return 'Sudah Cair';
  return 'Draft PO';
}

export const CLIENT_PO_STATUS_ORDER: ClientPOStatus[] = [
  'Draft PO',
  'PO Terkirim',
  'Sudah Ditagih',
  'Sudah Cair',
];

export const CLIENT_PO_STATUS_META: Record<
  ClientPOStatus,
  { label: string; badgeClass: string }
> = {
  'Draft PO': {
    label: 'Draft PO',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  'PO Terkirim': {
    label: 'PO Terkirim',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  'Sudah Ditagih': {
    label: 'Sudah Ditagih',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  'Sudah Cair': {
    label: 'Sudah Cair',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};
