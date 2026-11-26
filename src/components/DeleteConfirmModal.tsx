import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { PurchaseOrder } from '../types/po';

interface DeleteConfirmModalProps {
  po?: PurchaseOrder;
  docTitle?: string;
  docNumber?: string;
  docSubtitle?: string;
  mode?: 'soft' | 'permanent';
  isBusy?: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  po,
  docTitle,
  docNumber,
  docSubtitle,
  mode = 'soft',
  isBusy = false,
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resolvedTitle =
    docTitle ??
    (mode === 'permanent' ? 'Hapus Permanen Purchase Order?' : 'Hapus Purchase Order?');
  const resolvedNumber = docNumber ?? po?.poNumber ?? '-';
  const resolvedSubtitle = docSubtitle ?? po?.projectName ?? '';
  const isPermanent = mode === 'permanent';

  const handleConfirmClick = async () => {
    setErrorMsg(null);
    try {
      await onConfirm(reason.trim() || undefined);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal menghapus data di database Supabase.'
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">{resolvedTitle}</h3>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 break-words"
          >
            <strong>Gagal menghapus:</strong> {errorMsg}
          </div>
        )}

        <p className="text-sm text-slate-600 leading-relaxed">
          {isPermanent ? (
            <>
              Anda yakin ingin menghapus permanen{' '}
              <span className="font-mono font-semibold text-slate-900">{resolvedNumber}</span>
              {resolvedSubtitle ? ` (${resolvedSubtitle})` : ''}? Data akan dihapus selamanya dari
              database.
            </>
          ) : (
            <>
              Dokumen{' '}
              <span className="font-mono font-semibold text-slate-900">{resolvedNumber}</span>
              {resolvedSubtitle ? ` (${resolvedSubtitle})` : ''} akan dipindahkan ke{' '}
              <strong>Riwayat Hapus</strong> dan aktivitas Anda tetap tercatat di Audit Log.
            </>
          )}
        </p>

        {!isPermanent && (
          <div>
            <label
              htmlFor="delete-reason-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Alasan Hapus (Opsional)
            </label>
            <input
              id="delete-reason-input"
              type="text"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: PO dibatalkan / duplikat input..."
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void handleConfirmClick()}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
          >
            {isBusy
              ? 'Memproses...'
              : isPermanent
              ? 'Ya, Hapus Permanen'
              : 'Ya, Pindahkan ke Riwayat Hapus'}
          </button>
        </div>
      </div>
    </div>
  );
};
