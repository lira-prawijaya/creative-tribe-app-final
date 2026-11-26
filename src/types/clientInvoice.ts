import {
  DocumentRevisionEntry,
  PaymentTermsMode,
  POLineItem,
  RevisionSubStatus,
} from './po';

import { StatusWarna } from './statusWarna';

export type ClientInvoiceStatus = 'Draft' | 'Unpaid' | 'Paid' | 'Reschedule' | 'Not Paid';

export type ClientInvoiceEffectiveStatus =
  | 'Draft'
  | 'Unpaid'
  | 'Overdue'
  | 'Paid'
  | 'Reschedule'
  | 'Void';

export interface ClientInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  clientName: string; // Billed to
  brandName?: string;
  billingAddress?: string;
  poNumber?: string;
  grnNumber?: string;
  showGRN?: boolean;
  includePPN?: boolean;
  ppnPercent?: number;
  subtotalAmount?: number;
  ppnAmount?: number;
  grossAmount?: number;
  includePPh?: boolean;
  pphAmount?: number;
  netAfterPph?: number;
  includeCitibank?: boolean;
  citibankFeeAmount?: number;
  netReceivable?: number;
  showSystemGeneratedNote?: boolean;
  projectName: string;
  projectNumber: string;
  items: POLineItem[];
  totalAmount: number;
  total?: number;
  grand_total?: number;
  amount?: number;
  total_amount?: number;
  actualAmount?: number;
  realisasiAmount?: number;
  sentDate?: string;
  paymentTermsMode?: PaymentTermsMode;
  paymentTermsDays?: number;
  manualDueDateNote?: string;
  dueDate?: string;
  status: ClientInvoiceStatus;
  statusWarna?: StatusWarna;
  rescheduledFromMonth?: string;
  rescheduledToMonth?: string;
  paidDate?: string;
  note?: string;
  isVoided?: boolean;
  voidStatusLabel?: string;
  replacedByInvoiceId?: string;
  replacedByInvoiceNumber?: string;
  revisionSubStatus?: RevisionSubStatus;
  previousPaidAmount?: number;
  revisions?: DocumentRevisionEntry[];
  isDeleted?: boolean;
  deletedAt?: string;
  deletedByName?: string;
  deletedByEmail?: string;
  deleteReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClientInvoiceInput {
  invoiceNumber: string;
  invoiceDate: string;
  clientName: string;
  brandName?: string;
  billingAddress?: string;
  poNumber?: string;
  grnNumber?: string;
  showGRN?: boolean;
  includePPN?: boolean;
  ppnPercent?: number;
  subtotalAmount?: number;
  ppnAmount?: number;
  grossAmount?: number;
  includePPh?: boolean;
  pphAmount?: number;
  netAfterPph?: number;
  includeCitibank?: boolean;
  citibankFeeAmount?: number;
  netReceivable?: number;
  showSystemGeneratedNote?: boolean;
  projectName: string;
  projectNumber: string;
  items: POLineItem[];
  totalAmount: number;
  total?: number;
  grand_total?: number;
  amount?: number;
  total_amount?: number;
  actualAmount?: number;
  realisasiAmount?: number;
  subtotal_amount?: number;
  ppn_amount?: number;
  ppn_percent?: number;
  gross_amount?: number;
  include_pph?: boolean;
  pph_amount?: number;
  net_after_pph?: number;
  include_citibank?: boolean;
  citibank_fee_amount?: number;
  net_receivable?: number;
  sentDate?: string;
  paymentTermsMode?: PaymentTermsMode;
  paymentTermsDays?: number;
  manualDueDateNote?: string;
  dueDate?: string;
  status: ClientInvoiceStatus;
  statusWarna?: StatusWarna;
  rescheduledFromMonth?: string;
  rescheduledToMonth?: string;
  paidDate?: string;
  note?: string;
  isVoided?: boolean;
  voidStatusLabel?: string;
  replacedByInvoiceId?: string;
  replacedByInvoiceNumber?: string;
  revisionSubStatus?: RevisionSubStatus;
  previousPaidAmount?: number;
  revisions?: DocumentRevisionEntry[];
  isDeleted?: boolean;
  deletedAt?: string;
  deletedByName?: string;
  deletedByEmail?: string;
  deleteReason?: string;
}

export const CLIENT_INVOICE_SCHEMA_LIMITS = {
  invoiceNumberMax: 64,
  clientNameMax: 200,
  brandNameMax: 200,
  billingAddressMax: 500,
  poNumberMax: 64,
  grnNumberMax: 64,
  projectNameMax: 200,
  projectNumberMax: 64,
  descriptionMax: 500,
  manualDueDateNoteMax: 200,
  noteMax: 1000,
  maxItems: 20,
  paymentTermsMaxDays: 365,
  maxBankBalance: 100_000_000_000_000,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
} as const;
