import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Eye,
  History,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  CLIENT_INVOICE_SCHEMA_LIMITS,
  ClientInvoice,
  ClientInvoiceInput,
  ClientInvoiceStatus,
} from '../types/clientInvoice';
import { ClientPurchaseOrder } from '../types/clientPO';
import { AuditActor, PermissionsMap } from '../types/auth';
import { PaymentTermsMode, POLineItem, PurchaseOrder } from '../types/po';
import {
  calculateClientInvoiceBreakdown,
  generateNextClientInvoiceNumber,
  isFFIClientOrBrand,
  sanitizePpnPercent,
  validateClientInvoiceInput,
} from '../utils/clientInvoiceFormat';
import { downloadClientInvoicePDF } from '../utils/clientInvoicePdf';
import { calculateDueDate, formatIDR, getTodayISODate } from '../utils/format';
import { ClientInvoicePreviewModal } from './ClientInvoicePreviewModal';
import { ReviseDocumentModal, ReviseSubmitPayload } from './ReviseDocumentModal';
import { RevisionHistoryTable } from './RevisionHistoryTable';
import { SendClientInvoiceModal } from './SendClientInvoiceModal';

interface ClientInvoiceFormViewProps {
  existingInvoices: ClientInvoice[];
  existingPOs: PurchaseOrder[];
  editingId?: string | null;
  editingInvoice?: ClientInvoice | null;
  duplicateFrom?: ClientInvoice | null;
  prefillFromClientPO?: ClientPurchaseOrder | null;
  mode?: 'view' | 'edit';
  onCancel: () => void;
  onSave: (
    input: ClientInvoiceInput,
    openPreviewAfter: boolean,
    existingId?: string
  ) => Promise<void>;
  onSendInvoice?: (
    invoiceId: string,
    params: {
      sentDate: string;
      dueDate: string;
      paymentTermsMode: PaymentTermsMode;
      paymentTermsDays?: number;
      manualDueDateNote?: string;
    }
  ) => Promise<void>;
  onUpdatePrintOptions?: (
    invoiceId: string,
    options: { showGRN: boolean; showSystemGeneratedNote: boolean }
  ) => Promise<void>;
  onReviseInvoice?: (
    invoice: ClientInvoice,
    payload: ReviseSubmitPayload
  ) => Promise<void>;
  permissions?: PermissionsMap;
  currentActor?: AuditActor;
}

function isUuidLikeText(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    val.trim()
  );
}

function readSeedStr(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'string' && val.trim() !== '') return val.trim();
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  }
  return '';
}

function readSeedNum(raw: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const cleaned = Number(val.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(cleaned) && cleaned > 0) return cleaned;
    }
  }
  return 0;
}

function readSeedBool(raw: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const val = raw[key];
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === 1 || val === '1') return true;
    if (val === 'false' || val === 0 || val === '0') return false;
  }
  return undefined;
}

function normalizeSeedStatus(rawStatus: string): ClientInvoiceStatus {
  const upper = rawStatus.trim().toUpperCase();
  if (upper === 'PAID' || upper === 'LUNAS') return 'Paid';
  if (upper === 'SENT' || upper === 'UNPAID' || upper === 'DIKIRIM' || upper === 'BELUM LUNAS') {
    return 'Unpaid';
  }
  return 'Draft';
}

function parseSeedItems(
  raw: Record<string, unknown>,
  fallbackProjectName: string,
  fallbackTotal: number,
  includePPN: boolean,
  ppnPercent = 11
): POLineItem[] {
  let rawItems: unknown = raw.items;
  if (typeof rawItems === 'string') {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      rawItems = [];
    }
  } else if (rawItems && typeof rawItems === 'object' && !Array.isArray(rawItems)) {
    const nested = (rawItems as Record<string, unknown>).items;
    if (Array.isArray(nested)) rawItems = nested;
  }

  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const mapped = rawItems.map((entry) => {
      const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const qty = Math.max(1, Math.round(readSeedNum(item, 'quantity', 'qty') || 1));
      const unitPrice = Math.round(readSeedNum(item, 'unitPrice', 'unit_price', 'price', 'rate'));
      const amount =
        Math.round(readSeedNum(item, 'amount', 'total', 'total_amount', 'subtotal')) ||
        Math.round(qty * unitPrice);
      const resolvedUnitPrice =
        unitPrice > 0 ? unitPrice : qty > 0 ? Math.round(amount / qty) : amount;
      return {
        description: readSeedStr(item, 'description', 'name', 'title', 'item_name'),
        quantity: qty,
        unitPrice: resolvedUnitPrice,
        amount,
      };
    });
    if (mapped.some((it) => it.description.trim() !== '' || it.amount > 0)) {
      return mapped;
    }
  }

  const explicitSubtotal = Math.round(readSeedNum(raw, 'subtotalAmount', 'subtotal_amount'));
  if (explicitSubtotal > 0) {
    return [
      {
        description: fallbackProjectName || 'Tagihan Project',
        quantity: 1,
        unitPrice: explicitSubtotal,
        amount: explicitSubtotal,
      },
    ];
  }

  if (fallbackTotal > 0) {
    const safePct = includePPN ? sanitizePpnPercent(ppnPercent, true) : 0;
    const preTax =
      includePPN && safePct > 0
        ? Math.round(fallbackTotal / (1 + safePct / 100))
        : Math.round(fallbackTotal);
    return [
      {
        description: fallbackProjectName || 'Tagihan Project',
        quantity: 1,
        unitPrice: preTax,
        amount: preTax,
      },
    ];
  }

  return [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }];
}

function extractClientInvoiceSeed(source: ClientInvoice | null | undefined, today: string) {
  if (!source) return null;
  const raw = source as unknown as Record<string, unknown>;

  const rawClientId = readSeedStr(raw, 'client_id', 'clientId');
  const clientName =
    readSeedStr(raw, 'clientName', 'client_name', 'client') ||
    (rawClientId && !isUuidLikeText(rawClientId) ? rawClientId : '');

  const rawProjectId = readSeedStr(raw, 'project_id', 'projectId');
  const projectName =
    readSeedStr(raw, 'projectName', 'project_name', 'project') ||
    (rawProjectId && !isUuidLikeText(rawProjectId) ? rawProjectId : '');

  const brandName = readSeedStr(raw, 'brandName', 'brand_name');
  const totalAmount = readSeedNum(
    raw,
    'amount',
    'total',
    'grand_total',
    'total_amount',
    'totalAmount'
  );
  const rawStatus = readSeedStr(raw, 'status');
  const status = normalizeSeedStatus(rawStatus || 'Draft');
  const sentDate =
    readSeedStr(raw, 'sentDate', 'sent_date') || (status !== 'Draft' ? today : '');
  const showGRNRaw = readSeedBool(raw, 'showGRN', 'show_grn');
  const showSystemNoteRaw = readSeedBool(
    raw,
    'showSystemGeneratedNote',
    'show_system_generated_note'
  );
  const includePPN = Boolean(readSeedBool(raw, 'includePPN', 'include_ppn'));
  const rawPpnPct = readSeedNum(raw, 'ppnPercent', 'ppn_percent');
  const ppnPercent = includePPN ? sanitizePpnPercent(rawPpnPct, true) : rawPpnPct > 0 ? Math.round(rawPpnPct) : 11;
  const includePPh = Boolean(
    readSeedBool(raw, 'includePPh', 'include_pph') ||
      readSeedNum(raw, 'pphAmount', 'pph_amount') > 0
  );
  const includeCitibank = Boolean(
    readSeedBool(raw, 'includeCitibank', 'include_citibank') ||
      readSeedNum(raw, 'citibankFeeAmount', 'citibank_fee_amount') > 0
  );
  const termsModeRaw = readSeedStr(raw, 'paymentTermsMode', 'payment_terms_mode');
  const termsDaysRaw = readSeedNum(raw, 'paymentTermsDays', 'payment_terms_days');

  return {
    id: readSeedStr(raw, 'id', '_id'),
    invoiceNumber: readSeedStr(raw, 'invoiceNumber', 'invoice_number'),
    invoiceDate: readSeedStr(raw, 'invoiceDate', 'invoice_date') || today,
    clientName,
    brandName,
    billingAddress: readSeedStr(raw, 'billingAddress', 'billing_address'),
    poNumber: readSeedStr(raw, 'poNumber', 'po_number'),
    grnNumber: readSeedStr(raw, 'grnNumber', 'grn_number'),
    showGRN:
      typeof showGRNRaw === 'boolean'
        ? showGRNRaw
        : isFFIClientOrBrand(brandName, clientName),
    hasExplicitShowGRN: typeof showGRNRaw === 'boolean',
    projectName,
    projectNumber: readSeedStr(raw, 'projectNumber', 'project_number'),
    items: parseSeedItems(raw, projectName, totalAmount, includePPN, ppnPercent),
    includePPN,
    ppnPercent,
    includePPh,
    includeCitibank,
    status,
    sentDate,
    dueDate: readSeedStr(raw, 'dueDate', 'due_date'),
    paymentTermsMode:
      termsModeRaw === 'NET' || termsModeRaw === 'MANUAL'
        ? (termsModeRaw as PaymentTermsMode)
        : undefined,
    paymentTermsDays: termsDaysRaw > 0 ? termsDaysRaw : undefined,
    manualDueDateNote: readSeedStr(raw, 'manualDueDateNote', 'manual_due_date_note'),
    paidDate: status === 'Paid' ? readSeedStr(raw, 'paidDate', 'paid_date') || today : today,
    note: readSeedStr(raw, 'note', 'notes'),
    showSystemGeneratedNote:
      typeof showSystemNoteRaw === 'boolean' ? showSystemNoteRaw : true,
  };
}

export const ClientInvoiceFormView: React.FC<ClientInvoiceFormViewProps> = ({
  existingInvoices,
  existingPOs,
  editingId = null,
  editingInvoice = null,
  duplicateFrom = null,
  prefillFromClientPO = null,
  mode = 'edit',
  onCancel,
  onSave,
  onSendInvoice,
  onUpdatePrintOptions,
  onReviseInvoice,
  permissions,
  currentActor,
}) => {
  const activeEditingId = editingId ?? editingInvoice?.id ?? null;
  const isEditing = Boolean(activeEditingId || editingInvoice);
  const [viewMode, setViewMode] = useState<'view' | 'edit'>(mode);
  useEffect(() => {
    setViewMode(mode);
  }, [mode, activeEditingId]);
  const isVoided = Boolean(editingInvoice?.isVoided);
  const isLockedPaid = editingInvoice?.status === 'Paid';
  const canEditDraft = permissions ? permissions.edit_po_draft : true;
  const canSendInv = permissions ? permissions.send_invoice : true;
  const canReviseInv = editingInvoice
    ? editingInvoice.status === 'Paid'
      ? (permissions ? permissions.revise_paid : true)
      : (permissions ? permissions.revise_invoiced : true)
    : false;
  const isReadOnlyForm = Boolean(
    editingInvoice && (viewMode === 'view' || isLockedPaid || isVoided || !canEditDraft)
  );
  const today = getTodayISODate();
  const seedSource = editingInvoice ?? duplicateFrom;
  const initialSeed = useMemo(
    () => extractClientInvoiceSeed(seedSource, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const uniqueProjectsFromPO = useMemo(() => {
    const map = new Map<string, { projectName: string; projectNumber: string }>();
    for (const po of existingPOs) {
      const pName = po.projectName.trim();
      const pNum = po.projectNumber.trim();
      if (!pName) continue;
      const key = `${pName}::${pNum}`;
      if (!map.has(key)) {
        map.set(key, { projectName: pName, projectNumber: pNum });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.projectName.localeCompare(b.projectName, 'id')
    );
  }, [existingPOs]);

  const knownClients = useMemo(() => {
    const set = new Set<string>();
    for (const inv of existingInvoices) {
      if (inv.clientName.trim()) set.add(inv.clientName.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [existingInvoices]);

  const initialInvoiceNumber = useMemo(() => {
    if (editingInvoice && initialSeed?.invoiceNumber) return initialSeed.invoiceNumber;
    return generateNextClientInvoiceNumber(existingInvoices);
  }, [editingInvoice, initialSeed, existingInvoices]);

  const initialItems: POLineItem[] = initialSeed?.items?.length
    ? initialSeed.items.map((item) => ({ ...item }))
    : prefillFromClientPO
    ? [
        {
          description: prefillFromClientPO.projectName || 'Jasa Project',
          quantity: 1,
          unitPrice: Math.round(prefillFromClientPO.amount || 0),
          amount: Math.round(prefillFromClientPO.amount || 0),
        },
      ]
    : [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }];

  const initialIncludePPN = Boolean(initialSeed?.includePPN);

  const [invoiceNumber, setInvoiceNumber] = useState<string>(initialInvoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState<string>(
    editingInvoice ? initialSeed?.invoiceDate || today : today
  );
  const [brandName, setBrandName] = useState<string>(
    initialSeed?.brandName ?? prefillFromClientPO?.brandName ?? ''
  );
  const [clientName, setClientName] = useState<string>(
    initialSeed?.clientName ?? prefillFromClientPO?.clientName ?? ''
  );
  const [clientSelectMode, setClientSelectMode] = useState<'existing' | 'new'>(() => {
    const resolvedClient = initialSeed?.clientName ?? prefillFromClientPO?.clientName;
    if (resolvedClient && knownClients.includes(resolvedClient.trim())) {
      return 'existing';
    }
    if (resolvedClient?.trim()) return 'new';
    return knownClients.length > 0 ? 'existing' : 'new';
  });
  const [billingAddress, setBillingAddress] = useState<string>(
    initialSeed?.billingAddress ?? ''
  );
  const [poNumber, setPoNumber] = useState<string>(
    initialSeed?.poNumber ?? prefillFromClientPO?.clientPoNumber ?? ''
  );
  const [grnNumber, setGrnNumber] = useState<string>(initialSeed?.grnNumber ?? '');
  const [showGRN, setShowGRN] = useState<boolean>(() => {
    if (initialSeed) return initialSeed.showGRN;
    return isFFIClientOrBrand(prefillFromClientPO?.brandName, prefillFromClientPO?.clientName);
  });
  const hasManualGRNToggleRef = useRef<boolean>(
    Boolean(editingInvoice && initialSeed?.hasExplicitShowGRN)
  );

  const [projectName, setProjectName] = useState<string>(
    initialSeed?.projectName ?? prefillFromClientPO?.projectName ?? ''
  );
  const [projectNumber, setProjectNumber] = useState<string>(
    initialSeed?.projectNumber ?? prefillFromClientPO?.projectNumber ?? ''
  );
  const [items, setItems] = useState<POLineItem[]>(initialItems);
  const [includePPN, setIncludePPN] = useState<boolean>(initialIncludePPN);
  const [ppnPercent, setPpnPercent] = useState<number>(initialSeed?.ppnPercent ?? 11);
  const [includePPh, setIncludePPh] = useState<boolean>(Boolean(initialSeed?.includePPh));
  const [includeCitibank, setIncludeCitibank] = useState<boolean>(
    Boolean(initialSeed?.includeCitibank)
  );
  const [status, setStatus] = useState<ClientInvoiceStatus>(
    editingInvoice && initialSeed ? initialSeed.status : 'Draft'
  );
  const [sentDate, setSentDate] = useState<string>(
    editingInvoice && initialSeed ? initialSeed.sentDate : ''
  );
  const [dueDate, setDueDate] = useState<string>(
    editingInvoice && initialSeed ? initialSeed.dueDate : ''
  );
  const [paymentTermsMode, setPaymentTermsMode] = useState<PaymentTermsMode | undefined>(
    editingInvoice && initialSeed ? initialSeed.paymentTermsMode : undefined
  );
  const [paymentTermsDays, setPaymentTermsDays] = useState<number | undefined>(
    editingInvoice && initialSeed ? initialSeed.paymentTermsDays : undefined
  );
  const [manualDueDateNote, setManualDueDateNote] = useState<string>(
    editingInvoice && initialSeed ? initialSeed.manualDueDateNote : ''
  );
  const [paidDate, setPaidDate] = useState<string>(
    editingInvoice && initialSeed ? initialSeed.paidDate : today
  );
  const [note, setNote] = useState<string>(initialSeed?.note ?? '');
  const [showSystemGeneratedNote, setShowSystemGeneratedNote] = useState<boolean>(
    initialSeed?.showSystemGeneratedNote ?? true
  );

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewModalInvoice, setPreviewModalInvoice] = useState<ClientInvoice | null>(
    null
  );
  const [showSendModal, setShowSendModal] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [showReviseModal, setShowReviseModal] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Sync seluruh field form setiap kali mode/invoice yang diedit berubah (memastikan klik Edit mengisi form lama)
  const lastSyncedSignatureRef = useRef<string>('');
  useEffect(() => {
    const edRaw = (editingInvoice ?? {}) as unknown as Record<string, unknown>;
    const syncSignature = `${activeEditingId ?? 'create'}|${editingInvoice?.id ?? 'none'}|${String(
      editingInvoice?.updatedAt ?? ''
    )}|${String(edRaw.invoiceNumber ?? edRaw.invoice_number ?? '')}|${String(
      edRaw.clientName ?? edRaw.client_name ?? ''
    )}|${String(edRaw.amount ?? edRaw.total ?? edRaw.totalAmount ?? '')}|${
      duplicateFrom?.id ?? ''
    }|${prefillFromClientPO?.id ?? ''}`;
    if (lastSyncedSignatureRef.current === syncSignature) return;
    lastSyncedSignatureRef.current = syncSignature;

    const currentToday = getTodayISODate();
    if (editingInvoice) {
      console.log('handleEdit -> isi form dari invoice:', editingInvoice);
      const seed = extractClientInvoiceSeed(editingInvoice, currentToday)!;
      setInvoiceNumber(seed.invoiceNumber || generateNextClientInvoiceNumber(existingInvoices));
      setInvoiceDate(seed.invoiceDate || currentToday);
      setBrandName(seed.brandName);
      setClientName(seed.clientName);
      setClientSelectMode(
        seed.clientName && knownClients.includes(seed.clientName.trim()) ? 'existing' : 'new'
      );
      setBillingAddress(seed.billingAddress);
      setPoNumber(seed.poNumber);
      setGrnNumber(seed.grnNumber);
      hasManualGRNToggleRef.current = seed.hasExplicitShowGRN;
      setShowGRN(seed.showGRN);
      setProjectName(seed.projectName);
      setProjectNumber(seed.projectNumber);
      setItems(seed.items.map((item) => ({ ...item })));
      setIncludePPN(seed.includePPN);
      setPpnPercent(seed.ppnPercent);
      setIncludePPh(seed.includePPh);
      setIncludeCitibank(seed.includeCitibank);
      setStatus(seed.status);
      setSentDate(seed.sentDate);
      setDueDate(seed.dueDate);
      setPaymentTermsMode(seed.paymentTermsMode);
      setPaymentTermsDays(seed.paymentTermsDays);
      setManualDueDateNote(seed.manualDueDateNote);
      setPaidDate(seed.paidDate);
      setNote(seed.note);
      setShowSystemGeneratedNote(seed.showSystemGeneratedNote);
      setErrorMsg(null);
      return;
    }

    if (duplicateFrom) {
      setInvoiceNumber(generateNextClientInvoiceNumber(existingInvoices));
      setInvoiceDate(currentToday);
      setBrandName(duplicateFrom.brandName ?? '');
      const cName = duplicateFrom.clientName ?? '';
      setClientName(cName);
      setClientSelectMode(
        cName && knownClients.includes(cName.trim()) ? 'existing' : 'new'
      );
      setBillingAddress(duplicateFrom.billingAddress ?? '');
      setPoNumber(duplicateFrom.poNumber ?? '');
      setGrnNumber(duplicateFrom.grnNumber ?? '');
      hasManualGRNToggleRef.current = false;
      setShowGRN(
        typeof duplicateFrom.showGRN === 'boolean'
          ? duplicateFrom.showGRN
          : isFFIClientOrBrand(duplicateFrom.brandName, cName)
      );
      setProjectName(duplicateFrom.projectName ?? '');
      setProjectNumber(duplicateFrom.projectNumber ?? '');
      setItems(
        duplicateFrom.items?.length
          ? duplicateFrom.items.map((item) => ({ ...item }))
          : [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }]
      );
      setIncludePPN(Boolean(duplicateFrom.includePPN));
      setPpnPercent(
        duplicateFrom.ppnPercent && duplicateFrom.ppnPercent > 0
          ? Math.round(duplicateFrom.ppnPercent)
          : 11
      );
      setIncludePPh(Boolean(duplicateFrom.includePPh));
      setIncludeCitibank(Boolean(duplicateFrom.includeCitibank));
      setStatus('Draft');
      setSentDate('');
      setDueDate('');
      setPaymentTermsMode(undefined);
      setPaymentTermsDays(undefined);
      setManualDueDateNote('');
      setPaidDate(currentToday);
      setNote(duplicateFrom.note ?? '');
      setShowSystemGeneratedNote(duplicateFrom.showSystemGeneratedNote ?? true);
      setErrorMsg(null);
      return;
    }

    if (prefillFromClientPO) {
      setInvoiceNumber(generateNextClientInvoiceNumber(existingInvoices));
      setInvoiceDate(currentToday);
      setBrandName(prefillFromClientPO.brandName ?? '');
      const cName = prefillFromClientPO.clientName ?? '';
      setClientName(cName);
      setClientSelectMode(
        cName && knownClients.includes(cName.trim()) ? 'existing' : 'new'
      );
      setBillingAddress('');
      setPoNumber(prefillFromClientPO.clientPoNumber ?? '');
      setGrnNumber('');
      hasManualGRNToggleRef.current = false;
      setShowGRN(isFFIClientOrBrand(prefillFromClientPO.brandName, cName));
      setProjectName(prefillFromClientPO.projectName ?? '');
      setProjectNumber(prefillFromClientPO.projectNumber ?? '');
      const roundedPrefillAmt = Math.round(prefillFromClientPO.amount || 0);
      setItems([
        {
          description: prefillFromClientPO.projectName || 'Jasa Project',
          quantity: 1,
          unitPrice: roundedPrefillAmt,
          amount: roundedPrefillAmt,
        },
      ]);
      setIncludePPN(false);
      setPpnPercent(11);
      setIncludePPh(false);
      setIncludeCitibank(false);
      setStatus('Draft');
      setSentDate('');
      setDueDate('');
      setPaymentTermsMode(undefined);
      setPaymentTermsDays(undefined);
      setManualDueDateNote('');
      setPaidDate(currentToday);
      setNote('');
      setShowSystemGeneratedNote(true);
      setErrorMsg(null);
    }
  }, [
    activeEditingId,
    editingInvoice,
    duplicateFrom,
    prefillFromClientPO,
    existingInvoices,
    knownClients,
  ]);

  // Auto-update showGRN default when Brand Name or Billed to changes, unless user manually toggled it
  useEffect(() => {
    if (hasManualGRNToggleRef.current) return;
    setShowGRN(isFFIClientOrBrand(brandName, clientName));
  }, [brandName, clientName]);

  const subtotalAmount = useMemo(
    () => items.reduce((sum, item) => sum + Math.round(item.amount || 0), 0),
    [items]
  );

  const breakdown = useMemo(
    () =>
      calculateClientInvoiceBreakdown({
        dpp: subtotalAmount,
        includePPN,
        ppnPercent,
        includePPh,
        includeCitibank,
      }),
    [subtotalAmount, includePPN, ppnPercent, includePPh, includeCitibank]
  );

  const ppnAmount = breakdown.ppnAmount;
  const totalAmount = breakdown.netReceivable;

  const handleItemChange = (
    index: number,
    field: 'description' | 'quantity' | 'unitPrice',
    rawValue: string
  ) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        if (field === 'description') {
          return { ...item, description: rawValue };
        }
        const numeric = Number(rawValue);
        const safeNum = Number.isFinite(numeric) ? numeric : 0;
        const nextQty = field === 'quantity' ? Math.max(0, Math.round(safeNum)) : item.quantity;
        const nextPrice = field === 'unitPrice' ? Math.max(0, Math.round(safeNum)) : item.unitPrice;
        return {
          ...item,
          quantity: nextQty,
          unitPrice: nextPrice,
          amount: Math.round(nextQty * nextPrice),
        };
      })
    );
  };

  const handleAddRow = () => {
    if (items.length >= CLIENT_INVOICE_SCHEMA_LIMITS.maxItems) return;
    setItems((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const handleRemoveRow = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handlePickPOProject = (rawVal: string) => {
    if (!rawVal) return;
    const match = uniqueProjectsFromPO.find(
      (p) => `${p.projectName}::${p.projectNumber}` === rawVal
    );
    if (match) {
      setProjectName(match.projectName);
      setProjectNumber(match.projectNumber);
    }
  };

  const handleClientDropdownChange = (val: string) => {
    if (val === '__NEW__') {
      setClientSelectMode('new');
      setClientName('');
      return;
    }
    setClientSelectMode('existing');
    setClientName(val);
  };

  const handleStatusSelectChange = (nextStatus: ClientInvoiceStatus) => {
    setStatus(nextStatus);
    if (nextStatus !== 'Draft') {
      const nextSent = sentDate || getTodayISODate();
      if (!sentDate) {
        setSentDate(nextSent);
      }
      if (!dueDate) {
        const defaultDays = paymentTermsDays ?? 30;
        setPaymentTermsMode(paymentTermsMode ?? 'NET');
        setPaymentTermsDays(defaultDays);
        setDueDate(calculateDueDate(nextSent, defaultDays));
      }
    }
  };

  const submitForm = async (openPreviewAfter: boolean) => {
    const resolvedSentDate = status === 'Draft' ? sentDate : sentDate || today;
    const resolvedTermsMode =
      status !== 'Draft' ? paymentTermsMode ?? (dueDate ? 'MANUAL' : 'NET') : undefined;
    const resolvedTermsDays =
      status !== 'Draft' && resolvedTermsMode === 'NET' ? paymentTermsDays ?? 30 : undefined;
    const resolvedDueDate =
      status !== 'Draft'
        ? dueDate ||
          (resolvedSentDate && resolvedTermsMode === 'NET'
            ? calculateDueDate(resolvedSentDate, resolvedTermsDays ?? 30)
            : '')
        : '';

    const payload: ClientInvoiceInput = {
      invoiceNumber,
      invoiceDate,
      clientName,
      brandName,
      billingAddress,
      poNumber,
      grnNumber,
      showGRN,
      includePPN,
      ppnPercent: breakdown.ppnPercent,
      subtotalAmount: breakdown.dpp,
      ppnAmount,
      grossAmount: breakdown.grossAmount,
      includePPh,
      pphAmount: breakdown.pphAmount,
      netAfterPph: breakdown.netAfterPph,
      includeCitibank,
      citibankFeeAmount: breakdown.citibankFeeAmount,
      netReceivable: breakdown.netReceivable,
      showSystemGeneratedNote,
      projectName,
      projectNumber,
      items,
      totalAmount,
      sentDate: resolvedSentDate,
      paymentTermsMode: resolvedTermsMode,
      paymentTermsDays: resolvedTermsDays,
      manualDueDateNote: status !== 'Draft' ? manualDueDateNote : '',
      dueDate: resolvedDueDate,
      status,
      paidDate: status === 'Paid' ? paidDate : '',
      note,
      isVoided: editingInvoice?.isVoided,
      voidStatusLabel: editingInvoice?.voidStatusLabel,
      replacedByInvoiceId: editingInvoice?.replacedByInvoiceId,
      replacedByInvoiceNumber: editingInvoice?.replacedByInvoiceNumber,
      revisionSubStatus: status === 'Paid' ? '' : editingInvoice?.revisionSubStatus,
      previousPaidAmount: editingInvoice?.previousPaidAmount,
      revisions: editingInvoice?.revisions,
    };

    const validationError = validateClientInvoiceInput(payload);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await onSave(payload, openPreviewAfter, activeEditingId ?? undefined);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyimpan Invoice Client.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildLiveInvoiceForPrint = (): ClientInvoice => ({
    id: activeEditingId ?? '',
    invoiceNumber: invoiceNumber || 'INV-CLI-001',
    invoiceDate: invoiceDate || today,
    clientName: clientName || '-',
    brandName,
    billingAddress,
    poNumber,
    grnNumber,
    showGRN,
    includePPN,
    ppnPercent: breakdown.ppnPercent,
    subtotalAmount: breakdown.dpp,
    ppnAmount,
    grossAmount: breakdown.grossAmount,
    includePPh,
    pphAmount: breakdown.pphAmount,
    netAfterPph: breakdown.netAfterPph,
    includeCitibank,
    citibankFeeAmount: breakdown.citibankFeeAmount,
    netReceivable: breakdown.netReceivable,
    showSystemGeneratedNote,
    projectName: projectName || '-',
    projectNumber: projectNumber || '-',
    items,
    totalAmount,
    sentDate: status !== 'Draft' ? sentDate || today : sentDate,
    paymentTermsMode: status !== 'Draft' ? paymentTermsMode : undefined,
    paymentTermsDays: status !== 'Draft' ? paymentTermsDays : undefined,
    manualDueDateNote: status !== 'Draft' ? manualDueDateNote : '',
    dueDate: status !== 'Draft' ? dueDate : '',
    status,
    paidDate: status === 'Paid' ? paidDate : '',
    note,
    isVoided: editingInvoice?.isVoided,
    voidStatusLabel: editingInvoice?.voidStatusLabel,
    replacedByInvoiceId: editingInvoice?.replacedByInvoiceId,
    replacedByInvoiceNumber: editingInvoice?.replacedByInvoiceNumber,
    revisionSubStatus: editingInvoice?.revisionSubStatus,
    previousPaidAmount: editingInvoice?.previousPaidAmount,
    revisions: editingInvoice?.revisions,
  });

  const handleOpenTopPrintModal = () => {
    const live = buildLiveInvoiceForPrint();
    if (!live.invoiceNumber.trim()) {
      setErrorMsg('Preview Invoice gagal dimuat');
      return;
    }
    setErrorMsg(null);
    setPreviewModalInvoice(live);
  };

  const handleTopDownloadPDF = async () => {
    setErrorMsg(null);
    setIsDownloadingPdf(true);
    try {
      await downloadClientInvoicePDF(buildLiveInvoiceForPrint(), {
        showGRN,
        showSystemGeneratedNote,
      });
    } catch {
      setErrorMsg('Gagal mengunduh file PDF Invoice.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyForm) return;
    await submitForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 truncate">
              {isEditing
                ? `${viewMode === 'view' ? 'Detail' : 'Edit'} Invoice Client — ${editingInvoice?.invoiceNumber}`
                : duplicateFrom
                ? 'Duplikat Invoice Client'
                : 'Buat Invoice Client (Cash In)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Catat penagihan ke Client agar otomatis masuk ke proyeksi Cash In &amp; siap cetak PDF
            </p>
          </div>
        </div>

        {/* Top Action Bar for Detail / Edit Cash In: Kirim Invoice (Draft), Revisi, Print Invoice & Download PDF */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isEditing && !isVoided && editingInvoice?.status === 'Draft' && onSendInvoice && canSendInv && (
            <button
              type="button"
              onClick={() => setShowSendModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              Kirim Invoice
            </button>
          )}

          {isEditing &&
            !isVoided &&
            editingInvoice &&
            editingInvoice.status !== 'Draft' &&
            onReviseInvoice &&
            canReviseInv && (
              <button
                type="button"
                onClick={() => setShowReviseModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <History className="w-4 h-4" />
                Revisi
              </button>
            )}

          {isEditing && viewMode === 'view' && !isLockedPaid && !isVoided && canEditDraft && (
            <button
              type="button"
              onClick={() => setViewMode('edit')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pencil className="w-4 h-4" />
              Edit Data
            </button>
          )}

          {(canEditDraft || Boolean(permissions?.create_po)) && (
            <>
              <button
                type="button"
                onClick={handleOpenTopPrintModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Print Invoice
              </button>

              <button
                type="button"
                disabled={isDownloadingPdf}
                onClick={() => void handleTopDownloadPDF()}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {isDownloadingPdf ? 'Membuat PDF...' : 'Download PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      {isVoided && editingInvoice && (
        <div className="max-w-4xl p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-950 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              {editingInvoice.voidStatusLabel ||
                `VOID / DIREVISI - Diganti oleh ${editingInvoice.replacedByInvoiceNumber || '-'}`}
            </p>
            <p className="mt-0.5 leading-relaxed">
              Invoice lama ini tidak dihapus dan tetap dapat dibuka atau di-print sebagai arsip
              bukti audit. Gunakan invoice pengganti untuk penagihan aktif.
            </p>
          </div>
        </div>
      )}

      {!isVoided && isLockedPaid && (
        <div className="max-w-4xl p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          Invoice ini berstatus <strong>PAID</strong>. Jika ada perubahan nominal/item setelah
          lunas, gunakan tombol <strong>Revisi</strong> di kanan atas agar arsip lama tetap
          tersimpan sebagai VOID &amp; tercetak invoice pengganti.
        </div>
      )}

      {!isVoided &&
        editingInvoice?.revisionSubStatus &&
        typeof editingInvoice.previousPaidAmount === 'number' && (() => {
          const diff = (editingInvoice.totalAmount || 0) - editingInvoice.previousPaidAmount;
          if (diff === 0) return null;
          return (
            <div
              className={`max-w-4xl p-3.5 rounded-xl border text-xs font-medium ${
                diff < 0
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              {diff < 0 ? (
                <span>
                  <strong>{editingInvoice.revisionSubStatus}:</strong> Kelebihan bayar Rp{' '}
                  {formatIDR(Math.abs(diff))} (dari pembayaran sebelumnya Rp{' '}
                  {formatIDR(editingInvoice.previousPaidAmount)}), perlu refund / jadi kredit client.
                </span>
              ) : (
                <span>
                  <strong>{editingInvoice.revisionSubStatus}:</strong> Kurang bayar Rp{' '}
                  {formatIDR(diff)} (dari pembayaran sebelumnya Rp{' '}
                  {formatIDR(editingInvoice.previousPaidAmount)}), perlu tagih susulan.
                </span>
              )}
            </div>
          );
        })()}

      <form
        onSubmit={handleSubmit}
        className="max-w-4xl bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
          >
            {errorMsg}
          </div>
        )}

        <fieldset disabled={isReadOnlyForm} className="space-y-6">
        {/* Section 1: Invoice, Client & GRN Info */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Informasi Invoice Client</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="cli-invoice-number"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                No. Invoice Client
              </label>
              <div className="flex gap-2">
                <input
                  id="cli-invoice-number"
                  type="text"
                  required
                  maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.invoiceNumberMax}
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="INV-CLI-001"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  type="button"
                  onClick={() =>
                    setInvoiceNumber(generateNextClientInvoiceNumber(existingInvoices))
                  }
                  title="Generate nomor invoice otomatis"
                  className="px-2.5 py-2 border border-slate-300 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="cli-invoice-date"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Tanggal Invoice
              </label>
              <input
                id="cli-invoice-date"
                type="date"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="cli-brand-name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Brand Name (Opsional)
              </label>
              <input
                id="cli-brand-name"
                type="text"
                maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.brandNameMax}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Contoh: FFI, Gojek, Wardah"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="cli-po-number"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                PO Number Client (Opsional)
              </label>
              <input
                id="cli-po-number"
                type="text"
                maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.poNumberMax}
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="Contoh: PO-4500123456"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label
                htmlFor="cli-client-select"
                className="block text-xs font-medium text-slate-700"
              >
                Billed To / Nama Client
              </label>
              {knownClients.length > 0 && (
                <select
                  id="cli-client-select"
                  value={
                    clientSelectMode === 'new' ||
                    (clientName.trim() !== '' && !knownClients.includes(clientName.trim()))
                      ? '__NEW__'
                      : clientName.trim()
                  }
                  onChange={(e) => handleClientDropdownChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">-- Pilih Client --</option>
                  {knownClients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="__NEW__">+ Tambah Client Baru</option>
                </select>
              )}

              {(knownClients.length === 0 ||
                clientSelectMode === 'new' ||
                (clientName.trim() !== '' && !knownClients.includes(clientName.trim()))) && (
                <input
                  id="cli-client-name-input"
                  type="text"
                  required
                  maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.clientNameMax}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Contoh: PT Frisian Flag Indonesia atau Gojek"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="cli-billing-address"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Billing Address (Opsional)
              </label>
              <textarea
                id="cli-billing-address"
                rows={2}
                maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.billingAddressMax}
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
                placeholder="Alamat penagihan client untuk dicetak di invoice..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            {/* GRN Input + Explicit Checkbox */}
            <div className="sm:col-span-2 p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label
                    htmlFor="cli-grn-number"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    GRN (Tanggal / Nomor GRN)
                  </label>
                  <input
                    id="cli-grn-number"
                    type="text"
                    maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.grnNumberMax}
                    value={grnNumber}
                    onChange={(e) => setGrnNumber(e.target.value)}
                    placeholder="Contoh: 04.11.2026"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div className="pb-1">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer select-none">
                    <input
                      id="cli-show-grn"
                      type="checkbox"
                      checked={showGRN}
                      onChange={(e) => {
                        hasManualGRNToggleRef.current = true;
                        setShowGRN(e.target.checked);
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                    />
                    <span>Tampilkan GRN di Invoice</span>
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default aktif untuk client/brand FFI; centang atau hilangkan centang kapan saja.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Project Info (Pick from PO or Manual) */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Project</h3>
            {uniqueProjectsFromPO.length > 0 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="cli-pick-po-project"
                  className="text-xs text-slate-500 shrink-0"
                >
                  Ambil dari PO:
                </label>
                <select
                  id="cli-pick-po-project"
                  defaultValue=""
                  onChange={(e) => handlePickPOProject(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 max-w-[240px]"
                >
                  <option value="">-- Pilih Project dari Data PO --</option>
                  {uniqueProjectsFromPO.map((p) => (
                    <option
                      key={`${p.projectName}::${p.projectNumber}`}
                      value={`${p.projectName}::${p.projectNumber}`}
                    >
                      {p.projectName} ({p.projectNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="cli-project-name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Project Name
              </label>
              <input
                id="cli-project-name"
                type="text"
                required
                maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.projectNameMax}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Contoh: Gojek Ramadhan Campaign"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="cli-project-number"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Project Number
              </label>
              <input
                id="cli-project-number"
                type="text"
                required
                maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.projectNumberMax}
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                placeholder="Contoh: 2601001"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Line Items & PPN 11% */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Item Penagihan</h3>
            <button
              type="button"
              onClick={handleAddRow}
              disabled={items.length >= CLIENT_INVOICE_SCHEMA_LIMITS.maxItems}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Item
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="p-4 border border-slate-200 rounded-lg bg-slate-50/50 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor={`cli-item-desc-${idx}`}
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Deskripsi #{idx + 1}
                    </label>
                    <input
                      id={`cli-item-desc-${idx}`}
                      type="text"
                      required
                      maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.descriptionMax}
                      value={item.description}
                      onChange={(e) =>
                        handleItemChange(idx, 'description', e.target.value)
                      }
                      placeholder="Contoh: Agency Retainer / Campaign Production"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      title="Hapus item"
                      className="mt-6 p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor={`cli-item-qty-${idx}`}
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Qty
                    </label>
                    <input
                      id={`cli-item-qty-${idx}`}
                      type="number"
                      required
                      min={1}
                      step="1"
                      value={item.quantity || ''}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`cli-item-price-${idx}`}
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Harga (IDR)
                    </label>
                    <input
                      id={`cli-item-price-${idx}`}
                      type="number"
                      required
                      min={0}
                      step="1"
                      value={item.unitPrice || ''}
                      onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                      placeholder="100000000"
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-slate-700 mb-1">
                      Amount (Auto)
                    </span>
                    <div className="px-3 py-2 text-sm font-mono font-semibold tabular-nums bg-slate-100 border border-slate-200 rounded-lg text-slate-900 text-right">
                      {formatIDR(item.amount)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>DPP (Subtotal)</span>
              <span className="font-mono font-medium tabular-nums">
                Rp {formatIDR(breakdown.dpp)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-slate-700">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    id="cli-include-ppn"
                    type="checkbox"
                    checked={includePPN}
                    onChange={(e) => setIncludePPN(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                  />
                  <span className="font-medium">Tambahkan PPN</span>
                </label>
                {includePPN && (
                  <div className="inline-flex items-center gap-1">
                    <input
                      id="cli-ppn-percent"
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      value={ppnPercent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isFinite(val)) {
                          setPpnPercent(0);
                          return;
                        }
                        setPpnPercent(Math.min(100, Math.max(0, Math.round(val))));
                      }}
                      className="w-14 px-2 py-0.5 text-xs font-mono text-right bg-white border border-slate-300 rounded text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                )}
                {!includePPN && <span className="text-slate-400">(0%)</span>}
              </div>
              <span className="font-mono font-medium tabular-nums">
                Rp {formatIDR(breakdown.ppnAmount)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs font-semibold text-slate-800 pt-1.5 border-t border-slate-100">
              <span>Gross (DPP + PPN)</span>
              <span className="font-mono tabular-nums">
                Rp {formatIDR(breakdown.grossAmount)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-slate-700">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  id="cli-include-pph"
                  type="checkbox"
                  checked={includePPh}
                  onChange={(e) => setIncludePPh(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                />
                <span className="font-medium">(-) PPh 23 (2% × DPP)</span>
              </label>
              <span className="font-mono font-medium tabular-nums text-rose-700">
                {breakdown.pphAmount > 0 ? `- Rp ${formatIDR(breakdown.pphAmount)}` : 'Rp 0'}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-700 pt-1 border-t border-dashed border-slate-200">
              <span>(=) Net Setelah PPh</span>
              <span className="font-mono font-semibold tabular-nums">
                Rp {formatIDR(breakdown.netAfterPph)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-slate-700">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  id="cli-include-citibank"
                  type="checkbox"
                  checked={includeCitibank}
                  onChange={(e) => setIncludeCitibank(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                />
                <span className="font-medium">(-) Biaya Citibank (2% × Net Setelah PPh)</span>
              </label>
              <span className="font-mono font-medium tabular-nums text-rose-700">
                {breakdown.citibankFeeAmount > 0
                  ? `- Rp ${formatIDR(breakdown.citibankFeeAmount)}`
                  : 'Rp 0'}
              </span>
            </div>

            <div className="flex items-center justify-between pt-2.5 border-t border-slate-200">
              <div>
                <span className="block text-sm font-semibold text-slate-800">
                  (=) Net Akhir / Net Receivable (IDR)
                </span>
                <span className="block text-[11px] text-slate-500">
                  Angka bulat tanpa desimal yang masuk ke Projection Cash In (cetak PDF tetap menampilkan Gross)
                </span>
              </div>
              <span className="text-lg font-bold font-mono tabular-nums text-emerald-700">
                Rp {formatIDR(breakdown.netReceivable)}
              </span>
            </div>
          </div>
        </div>

        {/* Section 4: Status Pembayaran & Catatan */}
        <div className="space-y-4 pt-2 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            Status Pembayaran &amp; Catatan
          </h3>

          {/* Status, Tanggal Kirim (Manual/Otomatis), Jatuh Tempo & Paid Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="cli-status"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Status Pembayaran
              </label>
              <select
                id="cli-status"
                value={status}
                onChange={(e) =>
                  handleStatusSelectChange(e.target.value as ClientInvoiceStatus)
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="Draft">
                  DRAFT (Belum dikirim ke Client)
                </option>
                <option value="Unpaid">
                  SENT / UNPAID (Sudah dikirim, menunggu pembayaran)
                </option>
                <option value="Paid">PAID (Sudah Dibayar Client)</option>
              </select>
              {status === 'Draft' && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Ubah ke <strong>SENT / UNPAID</strong> atau klik{' '}
                  <strong>Kirim Invoice</strong> agar Tanggal Kirim terisi otomatis hari ini.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="cli-sent-date"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Tanggal Kirim Invoice{' '}
                {status !== 'Draft' ? (
                  <span className="text-red-600">*</span>
                ) : (
                  <span className="text-slate-400">(Opsional)</span>
                )}
              </label>
              <input
                id="cli-sent-date"
                type="date"
                required={status !== 'Draft'}
                value={sentDate}
                onChange={(e) => {
                  const nextSent = e.target.value;
                  setSentDate(nextSent);
                  if (
                    status !== 'Draft' &&
                    paymentTermsMode === 'NET' &&
                    nextSent
                  ) {
                    setDueDate(calculateDueDate(nextSent, paymentTermsDays ?? 30));
                  }
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                {status === 'Draft'
                  ? 'Otomatis terisi tanggal hari ini saat status diubah ke SENT / UNPAID.'
                  : 'Terisi otomatis hari ini saat SENT; bisa diubah manual.'}
              </p>
            </div>

            {status !== 'Draft' && (
              <div>
                <label
                  htmlFor="cli-due-date"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Jatuh Tempo / Estimasi Pembayaran
                </label>
                <input
                  id="cli-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setPaymentTermsMode('MANUAL');
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            )}

            {status === 'Paid' && (
              <div>
                <label
                  htmlFor="cli-paid-date"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Tanggal Dibayar <span className="text-red-600">*</span>
                </label>
                <input
                  id="cli-paid-date"
                  type="date"
                  required
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="cli-note"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Catatan (Opsional)
            </label>
            <textarea
              id="cli-note"
              rows={2}
              maxLength={CLIENT_INVOICE_SCHEMA_LIMITS.noteMax}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan penagihan client..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>

        {/* Section 5: Pengaturan Tanda Tangan & Cetak Invoice */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Tanda Tangan (TTD) Invoice</h3>
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer select-none">
              <input
                id="cli-show-system-note"
                type="checkbox"
                checked={showSystemGeneratedNote}
                onChange={(e) => setShowSystemGeneratedNote(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
              />
              <span>Tampilkan note &quot;Generated by System&quot; di bawah TTD</span>
            </label>
            <p className="text-[11px] text-slate-500 pl-6">
              {showSystemGeneratedNote
                ? 'Menampilkan catatan "* This invoice is generated by system, no signature required" di atas nama Adhitya Adji Dharma.'
                : 'Catatan disembunyikan & menyisakan ruang kosong di atas nama Adhitya Adji Dharma untuk tanda tangan basah.'}
            </p>
          </div>
        </div>
        </fieldset>

        <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isReadOnlyForm ? 'Tutup' : 'Batal'}
          </button>
          {!isReadOnlyForm && (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void submitForm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                Simpan &amp; Preview Invoice
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {isSubmitting ? 'Menyimpan...' : 'Simpan Invoice Client'}
              </button>
            </>
          )}
        </div>
      </form>

      {editingInvoice?.revisions && editingInvoice.revisions.length > 0 && (
        <div className="max-w-4xl">
          <RevisionHistoryTable
            revisions={editingInvoice.revisions}
            title="Riwayat Revisi Invoice (Audit Log Permanen)"
          />
        </div>
      )}

      {previewModalInvoice && (
        <ClientInvoicePreviewModal
          invoice={previewModalInvoice}
          canDownload={canEditDraft || Boolean(permissions?.create_po)}
          onClose={() => setPreviewModalInvoice(null)}
          onUpdatePrintOptions={
            canEditDraft || canSendInv || Boolean(permissions?.create_po)
              ? async (invoiceId, opts) => {
                  setShowGRN(opts.showGRN);
                  setShowSystemGeneratedNote(opts.showSystemGeneratedNote);
                  if (onUpdatePrintOptions && invoiceId) {
                    await onUpdatePrintOptions(invoiceId, opts);
                  }
                }
              : undefined
          }
        />
      )}

      {showSendModal && editingInvoice && onSendInvoice && (
        <SendClientInvoiceModal
          invoice={editingInvoice}
          isSubmitting={isSendingInvoice}
          onCancel={() => setShowSendModal(false)}
          onConfirm={async (params) => {
            setIsSendingInvoice(true);
            try {
              await onSendInvoice(editingInvoice.id, params);
              setStatus('Unpaid');
              setSentDate(params.sentDate);
              setDueDate(params.dueDate);
              setPaymentTermsMode(params.paymentTermsMode);
              setPaymentTermsDays(params.paymentTermsDays);
              setManualDueDateNote(params.manualDueDateNote ?? '');
              setShowSendModal(false);
            } finally {
              setIsSendingInvoice(false);
            }
          }}
        />
      )}

      {showReviseModal && editingInvoice && onReviseInvoice && (
        <ReviseDocumentModal
          docType="client-invoice"
          invoice={editingInvoice}
          currentActor={currentActor}
          isSubmitting={isRevising}
          onCancel={() => setShowReviseModal(false)}
          onConfirm={async (payload) => {
            setIsRevising(true);
            try {
              await onReviseInvoice(editingInvoice, payload);
              setShowReviseModal(false);
            } finally {
              setIsRevising(false);
            }
          }}
        />
      )}
    </div>
  );
};
