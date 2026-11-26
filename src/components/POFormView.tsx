import React, { useMemo, useState } from 'react';
import { ArrowLeft, Eye, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  COMPANY_INFO,
  PO_SCHEMA_LIMITS,
  POLineItem,
  PurchaseOrder,
  PurchaseOrderInput,
  VoidedInvoiceRecord,
} from '../types/po';
import {
  formatDocumentDate,
  formatIDR,
  generateNextPONumber,
  getTodayISODate,
  validatePOInput,
} from '../utils/format';
import { RevisionHistoryTable } from './RevisionHistoryTable';
import { VoidedInvoiceProofModal } from './VoidedInvoiceProofModal';

interface POFormViewProps {
  existingPOs: PurchaseOrder[];
  editingPO?: PurchaseOrder | null;
  duplicateFrom?: PurchaseOrder | null;
  onCancel: () => void;
  onSave: (
    input: PurchaseOrderInput,
    openPreviewAfter: boolean,
    existingId?: string
  ) => Promise<void>;
}

export const POFormView: React.FC<POFormViewProps> = ({
  existingPOs,
  editingPO = null,
  duplicateFrom = null,
  onCancel,
  onSave,
}) => {
  const isEditing = Boolean(editingPO);
  const today = getTodayISODate();

  const initialPoNumber = useMemo(() => {
    if (editingPO) return editingPO.poNumber;
    return generateNextPONumber(existingPOs);
  }, [editingPO, existingPOs]);

  const seedSource = editingPO ?? duplicateFrom;

  const [poNumber, setPoNumber] = useState<string>(initialPoNumber);
  const [poDate, setPoDate] = useState<string>(editingPO ? editingPO.poDate : today);
  const [vendorName, setVendorName] = useState<string>(seedSource?.vendorName ?? '');
  const [vendorAddress, setVendorAddress] = useState<string>(seedSource?.vendorAddress ?? '');
  const [projectName, setProjectName] = useState<string>(seedSource?.projectName ?? '');
  const [projectNumber, setProjectNumber] = useState<string>(seedSource?.projectNumber ?? '');
  const [deliveryDate, setDeliveryDate] = useState<string>(
    editingPO ? editingPO.deliveryDate : today
  );
  const [note, setNote] = useState<string>(seedSource?.note ?? '');
  const [items, setItems] = useState<POLineItem[]>(
    seedSource?.items?.length
      ? seedSource.items.map((item) => ({ ...item }))
      : [{ description: '', quantity: 1, unitPrice: 0, amount: 0 }]
  );

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeVoidRecord, setActiveVoidRecord] = useState<VoidedInvoiceRecord | null>(null);

  const totalAmount = useMemo(
    () => items.reduce((sum, item) => sum + item.amount, 0),
    [items]
  );

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
        const nextQty = field === 'quantity' ? Math.max(0, safeNum) : item.quantity;
        const nextPrice = field === 'unitPrice' ? Math.max(0, safeNum) : item.unitPrice;
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
    if (items.length >= PO_SCHEMA_LIMITS.maxItems) return;
    setItems((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const handleRemoveRow = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleResetAutoNumber = () => {
    setPoNumber(generateNextPONumber(existingPOs));
  };

  const submitForm = async (openPreviewAfter: boolean) => {
    const payload: PurchaseOrderInput = {
      poNumber,
      poDate,
      vendorName,
      vendorAddress,
      projectName,
      projectNumber,
      deliveryDate,
      items,
      totalAmount,
      status: editingPO ? editingPO.status : 'Draft',
      invoiceDate: editingPO?.invoiceDate ?? '',
      invoiceNumber: editingPO?.invoiceNumber ?? '',
      invoiceFileUrl: editingPO?.invoiceFileUrl ?? '',
      invoiceFileName: editingPO?.invoiceFileName ?? '',
      paymentTermsMode: editingPO?.paymentTermsMode,
      paymentTermsDays:
        editingPO?.paymentTermsMode === 'MANUAL'
          ? undefined
          : editingPO?.invoiceDate
          ? editingPO.paymentTermsDays
          : undefined,
      manualDueDateNote: editingPO?.manualDueDateNote ?? '',
      dueDate:
        editingPO?.invoiceDate || editingPO?.paymentTermsMode === 'MANUAL'
          ? editingPO?.dueDate ?? ''
          : '',
      note,
      revisionSubStatus: editingPO?.revisionSubStatus,
      previousPaidAmount: editingPO?.previousPaidAmount,
      revisions: editingPO?.revisions,
      voidedInvoices: editingPO?.voidedInvoices,
    };

    const validationError = validatePOInput(payload);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      await onSave(payload, openPreviewAfter, editingPO?.id);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyimpan Purchase Order.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </button>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {isEditing
                ? `Edit Purchase Order — ${editingPO?.poNumber}`
                : duplicateFrom
                ? 'Duplikat Purchase Order'
                : 'Buat PO Baru'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Setelah disimpan, PO masuk ke List PO. Input invoice &amp; jatuh tempo dilakukan saat tagihan vendor diterima.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Form Inputs */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitForm(false);
          }}
          className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6"
        >
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
            >
              {errorMsg}
            </div>
          )}

          {/* Company Header Info */}
          <div className="pb-4 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-900">{COMPANY_INFO.name}</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{COMPANY_INFO.address}</p>
          </div>

          {/* Section 1: PO Metadata */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Informasi Purchase Order</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="po-number" className="block text-xs font-medium text-slate-700 mb-1.5">
                  No. PO (Auto)
                </label>
                <div className="flex gap-2">
                  <input
                    id="po-number"
                    type="text"
                    required
                    maxLength={PO_SCHEMA_LIMITS.poNumberMax}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="002/PO-KKB/2026"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleResetAutoNumber}
                    title="Generate nomor PO berikutnya otomatis"
                    className="px-2.5 py-2 border border-slate-300 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="po-date" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Tanggal PO
                </label>
                <input
                  id="po-date"
                  type="date"
                  required
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label htmlFor="delivery-date" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Delivery Date
                </label>
                <input
                  id="delivery-date"
                  type="date"
                  required
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Vendor & Project */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Vendor &amp; Project</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="vendor-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Vendor
                </label>
                <input
                  id="vendor-name"
                  type="text"
                  required
                  maxLength={PO_SCHEMA_LIMITS.vendorNameMax}
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Contoh: Adrianus"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="vendor-address" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Alamat Vendor
                </label>
                <textarea
                  id="vendor-address"
                  required
                  rows={2}
                  maxLength={PO_SCHEMA_LIMITS.vendorAddressMax}
                  value={vendorAddress}
                  onChange={(e) => setVendorAddress(e.target.value)}
                  placeholder="Contoh: Jakarta"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label htmlFor="project-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Project Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  required
                  maxLength={PO_SCHEMA_LIMITS.projectNameMax}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Contoh: Gojek Ramadhan Campaign"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label htmlFor="project-number" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Project Number
                </label>
                <input
                  id="project-number"
                  type="text"
                  required
                  maxLength={PO_SCHEMA_LIMITS.projectNumberMax}
                  value={projectNumber}
                  onChange={(e) => setProjectNumber(e.target.value)}
                  placeholder="Contoh: 2601001"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Line Items */}
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Item</h3>
              <button
                type="button"
                onClick={handleAddRow}
                disabled={items.length >= PO_SCHEMA_LIMITS.maxItems}
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
                        htmlFor={`item-desc-${idx}`}
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Product Description #{idx + 1}
                      </label>
                      <input
                        id={`item-desc-${idx}`}
                        type="text"
                        required
                        maxLength={PO_SCHEMA_LIMITS.descriptionMax}
                        value={item.description}
                        onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                        placeholder="Contoh: Strategic Planner"
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
                        htmlFor={`item-qty-${idx}`}
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Qty
                      </label>
                      <input
                        id={`item-qty-${idx}`}
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
                        htmlFor={`item-price-${idx}`}
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Unit Price (IDR)
                      </label>
                      <input
                        id={`item-price-${idx}`}
                        type="number"
                        required
                        min={0}
                        step="1"
                        value={item.unitPrice || ''}
                        onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                        placeholder="50000000"
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

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <span className="text-sm font-semibold text-slate-700">Total Amount (IDR)</span>
              <span className="text-lg font-bold font-mono tabular-nums text-slate-900">
                Rp {formatIDR(totalAmount)}
              </span>
            </div>
          </div>

          {/* Section 4: Note */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label htmlFor="po-note" className="block text-xs font-medium text-slate-700">
              Note (Opsional)
            </label>
            <textarea
              id="po-note"
              rows={2}
              maxLength={PO_SCHEMA_LIMITS.noteMax}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan internal atau keterangan tambahan PO..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          {/* Form Submit Actions */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => submitForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-4 h-4" />
              Simpan &amp; Lihat PO
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {isSubmitting ? 'Menyimpan...' : 'Simpan PO'}
            </button>
          </div>
        </form>

        {/* Right: Live Mini Document Preview */}
        <aside className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Preview Dokumen PO
            </h3>
            <span className="text-xs font-mono text-slate-500">{poNumber || '-'}</span>
          </div>

          <div className="border border-slate-300 bg-white p-4 font-[Arial,Helvetica,sans-serif] text-[9.5px] text-black space-y-3">
            <table className="w-full border-collapse border-0">
              <tbody>
                <tr>
                  <td className="w-[55%] align-top text-left border-0 p-0">
                    <img
                      src="/assets/aistudio/ctribe_logo_trimmed.png"
                      alt="C.TRIBE"
                      className="w-[76px] h-auto block !m-0 !p-0 !mb-[2px]"
                    />
                    <div className="!m-0 !p-0 !mt-0 text-[7.5px] !leading-[1.3] text-black">
                      <span className="font-bold">{COMPANY_INFO.name}</span>
                      <br />
                      {COMPANY_INFO.addressLines[0]}
                      <br />
                      {COMPANY_INFO.addressLines[1]}
                      <br />
                      {COMPANY_INFO.addressLines[2]}
                    </div>
                  </td>
                  <td className="w-[45%] align-top text-right border-0 p-0">
                    <div className="text-[11pt] font-extrabold m-0 p-0 leading-none text-black uppercase">
                      PURCHASE ORDER
                    </div>
                    <table className="w-full border-[1.5px] border-black border-collapse mt-[4px] text-[7.5px]">
                      <tbody>
                        <tr>
                          <td className="bg-[#8FE388] font-bold text-center border border-black px-1.5 py-1 text-black w-1/2">
                            P.O. NUMBER
                          </td>
                          <td className="bg-[#8FE388] font-bold text-center border border-black px-1.5 py-1 text-black w-1/2">
                            DATE
                          </td>
                        </tr>
                        <tr>
                          <td className="bg-white text-center border border-black px-1.5 py-1 text-black">
                            {poNumber || '-'}
                          </td>
                          <td className="bg-white text-center border border-black px-1.5 py-1 text-black">
                            {formatDocumentDate(poDate)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="border border-black text-[9px]">
              <div className="bg-[#8ED973] border-b border-black px-2 py-1 font-bold uppercase">
                VENDOR
              </div>
              <div className="bg-[#DCE6F1] px-2 py-1.5 space-y-0.5">
                <p>
                  <span className="font-bold">NAME</span> : {vendorName || '-'}
                </p>
                <p>
                  <span className="font-bold">ADDRESS</span> : {vendorAddress || '-'}
                </p>
              </div>
            </div>

            <div className="space-y-0.5 text-[9px]">
              <p>
                <span className="font-bold">PROJECT NAME</span> : {projectName || '-'}
              </p>
              <p>
                <span className="font-bold">PROJECT NUMBER</span> : {projectNumber || '-'}
              </p>
              <p>
                <span className="font-bold">DELIVERY DATE</span> : {formatDocumentDate(deliveryDate)}
              </p>
            </div>

            <div>
              <table className="w-full border-collapse border border-black text-[8.5px]">
                <thead>
                  <tr className="bg-[#8ED973]">
                    <th className="border border-black px-1.5 py-1 text-left font-bold">
                      PRODUCT DESCRIPTION
                    </th>
                    <th className="border border-black px-1.5 py-1 text-center font-bold">
                      Quantity
                    </th>
                    <th className="border border-black px-1.5 py-1 text-center font-bold">
                      Unit Price
                    </th>
                    <th className="border border-black px-1.5 py-1 text-center font-bold">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="border border-black px-1.5 py-1">
                        {item.description || '—'}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-center tabular-nums">
                        {formatIDR(item.quantity)}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-center tabular-nums">
                        {formatIDR(item.unitPrice)}
                      </td>
                      <td className="border border-black px-1.5 py-1 text-center tabular-nums">
                        {formatIDR(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end mt-1.5">
                <div className="text-[9px] font-bold tabular-nums">
                  Total Amount (IDR) : {formatIDR(totalAmount)}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {editingPO &&
        ((editingPO.revisions && editingPO.revisions.length > 0) ||
          (editingPO.voidedInvoices && editingPO.voidedInvoices.length > 0)) && (
          <RevisionHistoryTable
            revisions={editingPO.revisions}
            voidedInvoices={editingPO.voidedInvoices}
            onOpenVoidedInvoice={(rec) => setActiveVoidRecord(rec)}
          />
        )}

      {editingPO && activeVoidRecord && (
        <VoidedInvoiceProofModal
          po={editingPO}
          record={activeVoidRecord}
          onClose={() => setActiveVoidRecord(null)}
        />
      )}
    </div>
  );
};
