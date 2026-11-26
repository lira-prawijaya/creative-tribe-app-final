import { StatusWarna } from './statusWarna';

export type POStatus = 'Draft' | 'Sent' | 'Invoiced' | 'Paid' | 'Reschedule' | 'Not Paid';

export interface POLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export type PaymentTermsMode = 'NET' | 'MANUAL';

export type VendorPphType = 'NONE' | 'PPH21' | 'PPH23';

export type VendorPphStatus = 'Belum Disubmit' | 'Sudah Disubmit';

export type RevisionSubStatus =
  | ''
  | 'Revisi'
  | 'Menunggu Pembayaran Ulang'
  | 'Menunggu Konfirmasi';

export interface DocumentRevisionEntry {
  id: string;
  revisedAt: string;
  revisedBy: string;
  reason: string;
  oldAmount: number;
  newAmount: number;
  diffAmount: number;
  oldInvoiceNumber: string;
  newInvoiceNumber: string;
  previousStatus: string;
  resolutionNote: string;
}

export interface VoidedInvoiceRecord {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
  items: POLineItem[];
  statusLabel: string;
  replacedByInvoiceNumber: string;
  voidedAt: string;
  reason: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  vendorName: string;
  vendorAddress: string;
  projectName: string;
  projectNumber: string;
  deliveryDate: string;
  items: POLineItem[];
  totalAmount: number;
  actualAmount?: number;
  realisasiAmount?: number;
  status: POStatus;
  statusWarna?: StatusWarna;
  rescheduledFromMonth?: string;
  rescheduledToMonth?: string;
  invoiceDate?: string;
  invoiceNumber?: string;
  invoiceFileUrl?: string;
  invoiceFileName?: string;
  paymentTermsMode?: PaymentTermsMode;
  paymentTermsDays?: number;
  manualDueDateNote?: string;
  dueDate?: string;
  dppAmount?: number;
  ppnRate?: number;
  ppnAmount?: number;
  grossAmount?: number;
  pphType?: VendorPphType;
  pphRate?: number;
  pphAmount?: number;
  pphStatus?: VendorPphStatus;
  pphDate?: string;
  netAkhir?: number;
  note?: string;
  revisionSubStatus?: RevisionSubStatus;
  previousPaidAmount?: number;
  revisions?: DocumentRevisionEntry[];
  voidedInvoices?: VoidedInvoiceRecord[];
  isDeleted?: boolean;
  deletedAt?: string;
  deletedByName?: string;
  deletedByEmail?: string;
  deleteReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PurchaseOrderInput {
  poNumber: string;
  poDate: string;
  vendorName: string;
  vendorAddress: string;
  projectName: string;
  projectNumber: string;
  deliveryDate: string;
  items: POLineItem[];
  totalAmount: number;
  actualAmount?: number;
  realisasiAmount?: number;
  status: POStatus;
  statusWarna?: StatusWarna;
  rescheduledFromMonth?: string;
  rescheduledToMonth?: string;
  invoiceDate?: string;
  invoiceNumber?: string;
  invoiceFileUrl?: string;
  invoiceFileName?: string;
  paymentTermsMode?: PaymentTermsMode;
  paymentTermsDays?: number;
  manualDueDateNote?: string;
  dueDate?: string;
  dppAmount?: number;
  ppnRate?: number;
  ppnAmount?: number;
  grossAmount?: number;
  pphType?: VendorPphType;
  pphRate?: number;
  pphAmount?: number;
  pphStatus?: VendorPphStatus;
  pphDate?: string;
  netAkhir?: number;
  note?: string;
  revisionSubStatus?: RevisionSubStatus;
  previousPaidAmount?: number;
  revisions?: DocumentRevisionEntry[];
  voidedInvoices?: VoidedInvoiceRecord[];
  isDeleted?: boolean;
  deletedAt?: string;
  deletedByName?: string;
  deletedByEmail?: string;
  deleteReason?: string;
}

export const PAYMENT_TERM_OPTIONS = [30, 45, 60, 90] as const;

export type PaymentTermDays = (typeof PAYMENT_TERM_OPTIONS)[number];

export const PAYMENT_TERM_RULES: Record<
  PaymentTermDays,
  {
    days: PaymentTermDays;
    optionLabel: string;
    shortRangeLabel: string;
  }
> = {
  30: {
    days: 30,
    optionLabel: 'NET 30 (30 hari) - Invoice di bawah Rp 10.000.000',
    shortRangeLabel: 'NET 30 (< 10jt)',
  },
  45: {
    days: 45,
    optionLabel: 'NET 45 (45 hari) - Invoice Rp 10.000.000 s/d Rp 50.000.000',
    shortRangeLabel: 'NET 45 (10jt - 50jt)',
  },
  60: {
    days: 60,
    optionLabel: 'NET 60 (60 hari) - Invoice Rp 50.000.000 s/d Rp 100.000.000',
    shortRangeLabel: 'NET 60 (50jt - 100jt)',
  },
  90: {
    days: 90,
    optionLabel: 'NET 90 (90 hari) - Invoice di atas Rp 100.000.000',
    shortRangeLabel: 'NET 90 (> 100jt)',
  },
};

export const PO_STATUS_META: Record<
  POStatus,
  { label: string; shortLabel: string; badgeClass: string }
> = {
  Draft: {
    label: 'DRAFT',
    shortLabel: 'DRAFT',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  Sent: {
    label: 'TERKIRIM',
    shortLabel: 'SENT / TERKIRIM',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  Invoiced: {
    label: 'SUDAH DITAGIH',
    shortLabel: 'INVOICED',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  Paid: {
    label: 'LUNAS',
    shortLabel: 'PAID / LUNAS',
    badgeClass: 'bg-green-800 text-white border-green-900',
  },
  Reschedule: {
    label: 'PENDING',
    shortLabel: 'PENDING',
    badgeClass: 'bg-red-50 text-red-800 border-red-300',
  },
  'Not Paid': {
    label: 'PROJECTION',
    shortLabel: 'PROJECTION',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
  },
};

export const COMPANY_INFO = {
  name: 'PT. Kreatif Kebanggaan Bangsa',
  nameUpper: 'PT. KREATIF KEBANGGAAN BANGSA',
  addressLines: [
    'Kantor Taman A9 Unit A2 Lt.5 Kawasan Mega Kuningan',
    'Jl. DR. Ide Anak Agung Lot.9 RT. 8 RW. 3, Kuningan Timur, Setiabudi',
    'Jakarta Selatan',
  ],
  address:
    'Kantor Taman A9 Unit A2 Lt.5 Kawasan Mega Kuningan, Jl. DR. Ide Anak Agung Lot.9 RT. 8 RW. 3, Kuningan Timur, Setiabudi, Jakarta Selatan',
  signatoryName: 'Adhitya Adi Dharma',
  signatoryTitle: 'Direktur Utama',
} as const;

export const PO_SCHEMA_LIMITS = {
  poNumberMax: 64,
  vendorNameMax: 200,
  vendorAddressMax: 500,
  projectNameMax: 200,
  projectNumberMax: 64,
  descriptionMax: 500,
  invoiceNumberMax: 64,
  invoiceFileUrlMax: 1000,
  invoiceFileNameMax: 200,
  manualDueDateNoteMax: 200,
  noteMax: 1000,
  revisedByMax: 160,
  revisionReasonMax: 500,
  resolutionNoteMax: 300,
  voidStatusLabelMax: 160,
  maxItems: 20,
  maxRevisions: 50,
  maxVoidedInvoices: 50,
  paymentTermsMaxDays: 365,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
  defaultRevisionUser: 'prawijayalira@gmail.com',
} as const;

export const PO_NOTE_ITEMS = [
  'Payment is made every Thursday',
  'Invoices with a nominal value above 5 million IDR are required to use a stamp duty according to the applicable government regulations as a sign of document validity',
  'Invoices must be accompanied by a Purchase Order (PO) from the employer',
  'The invoice amount must match the attached PO',
  'The value stated in the PO does not include applicable VAT, but already includes applicable Income Tax',
] as const;

export const PO_PAYMENT_TERMS_LEFT = [
  'Invoice value less than 10 million IDR : Payment is made within 30 days after the invoice is received',
  'Invoice value 10 million IDR - 50 million IDR : Payment is made within 45 days after the invoice is received',
] as const;

export const PO_PAYMENT_TERMS_RIGHT = [
  'Invoice value 50 million IDR - 100 million IDR : Payment is made within 60 days after the invoice is received',
  'Invoice value more than 100 million IDR : Payment is made within 90 days after the invoice is received',
] as const;
