import React, { useEffect, useMemo, useState } from 'react';
import { CalendarArrowUp, X } from 'lucide-react';
import {
  addMonthKeys,
  buildDestinationMonthOptions,
  formatMonthFullID,
  formatMonthShortID,
} from '../types/statusWarna';
import { formatIDR } from '../utils/format';

interface RescheduleMonthModalProps {
  isOpen: boolean;
  itemName: string;
  amount: number;
  originMonthKey: string;
  initialTargetMonthKey?: string;
  autoRolloverConfirmOnly?: boolean;
  isSaving?: boolean;
  onCancel: () => void;
  onConfirm: (targetMonthKey: string) => void | Promise<void>;
}

export const RescheduleMonthModal: React.FC<RescheduleMonthModalProps> = ({
  isOpen,
  itemName,
  amount,
  originMonthKey,
  initialTargetMonthKey,
  autoRolloverConfirmOnly = false,
  isSaving = false,
  onCancel,
  onConfirm,
}) => {
  const safeOrigin = /^\d{4}-\d{2}$/.test(originMonthKey)
    ? originMonthKey
    : new Date().toISOString().slice(0, 7);

  const monthOptions = useMemo(
    () => buildDestinationMonthOptions(safeOrigin, 18),
    [safeOrigin]
  );

  const defaultTarget = useMemo(() => {
    if (autoRolloverConfirmOnly) {
      return addMonthKeys(safeOrigin, 1);
    }
    if (
      initialTargetMonthKey &&
      /^\d{4}-\d{2}$/.test(initialTargetMonthKey) &&
      initialTargetMonthKey !== safeOrigin
    ) {
      return initialTargetMonthKey;
    }
    return addMonthKeys(safeOrigin, 1);
  }, [autoRolloverConfirmOnly, initialTargetMonthKey, safeOrigin]);

  const [targetMonthKey, setTargetMonthKey] = useState<string>(defaultTarget);

  useEffect(() => {
    if (isOpen) {
      setTargetMonthKey(defaultTarget);
    }
  }, [isOpen, defaultTarget]);

  if (!isOpen) return null;

  const effectiveTarget = autoRolloverConfirmOnly ? defaultTarget : targetMonthKey;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveTarget || effectiveTarget === safeOrigin || isSaving) return;
    void onConfirm(effectiveTarget);
  };

  const targetFullLabel = formatMonthFullID(effectiveTarget);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-reschedule-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className={`w-full ${
          autoRolloverConfirmOnly ? 'max-w-sm' : 'max-w-md'
        } bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden`}
      >
        <div className="px-5 py-4 bg-red-50 border-b border-red-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CalendarArrowUp className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div>
              <h3
                id="global-reschedule-modal-title"
                className="text-sm font-bold text-red-950"
              >
                {autoRolloverConfirmOnly
                  ? `Pending ke ${targetFullLabel}?`
                  : 'Pending ke bulan berapa?'}
              </h3>
              <p className="text-[11px] text-red-800 mt-0.5">
                {autoRolloverConfirmOnly
                  ? `Tagihan tetap tercatat di periode asal (tidak dihitung) dan salinannya dibuat di ${targetFullLabel}`
                  : 'Pending · Item tetap tampil redup di bulan ini (Rp 0) dan salinan aktif dibuat di bulan tujuan'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="p-1 text-red-700 hover:text-red-950 rounded cursor-pointer disabled:opacity-50"
            aria-label="Tutup dialog reschedule"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-700">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs space-y-1">
            <p className="font-semibold text-slate-900">{itemName}</p>
            <p className="font-mono tabular-nums text-slate-700">
              Nominal:{' '}
              <strong className="text-slate-950">Rp {formatIDR(Math.round(amount || 0))}</strong>
            </p>
            <p className="text-[11px] text-slate-500">
              Item akan tetap ada sebagai histori redup (Rp 0 / tidak dihitung) di{' '}
              <strong className="text-slate-700">{formatMonthFullID(safeOrigin)}</strong>, dan
              salinan tagihan &ldquo;Tunggakan dari {formatMonthFullID(safeOrigin)}&rdquo; dibuat
              di <strong className="text-red-700">{targetFullLabel}</strong>.
            </p>
          </div>

          {!autoRolloverConfirmOnly && (
            <div>
              <label
                htmlFor="global-reschedule-target-month"
                className="block text-xs font-semibold text-slate-800 mb-1.5"
              >
                Pindah ke bulan berapa? <span className="text-red-600">*</span>
              </label>
              <select
                id="global-reschedule-target-month"
                value={targetMonthKey}
                disabled={isSaving}
                onChange={(e) => setTargetMonthKey(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                {!monthOptions.some((o) => o.monthKey === targetMonthKey) && (
                  <option value={targetMonthKey}>
                    {formatMonthShortID(targetMonthKey)} ({formatMonthFullID(targetMonthKey)})
                  </option>
                )}
                {monthOptions.map((opt) => (
                  <option key={opt.monthKey} value={opt.monthKey}>
                    {opt.shortLabel} ({opt.fullLabel})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isSaving || !effectiveTarget || effectiveTarget === safeOrigin}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {isSaving
              ? 'Memindahkan...'
              : autoRolloverConfirmOnly
              ? `Ya, Pindah ke ${targetFullLabel}`
              : 'Pindahkan & Simpan'}
          </button>
        </div>
      </form>
    </div>
  );
};
