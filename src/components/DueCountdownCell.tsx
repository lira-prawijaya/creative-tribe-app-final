import React from 'react';
import { PurchaseOrder } from '../types/po';
import { getEffectiveDueDate, getRemainingDays, hasVendorInvoice } from '../utils/format';

interface DueCountdownCellProps {
  po: PurchaseOrder;
}

export const DueCountdownCell: React.FC<DueCountdownCellProps> = ({ po }) => {
  if (po.status === 'Paid') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-emerald-50 text-emerald-800 border-emerald-200 whitespace-nowrap">
        LUNAS
      </span>
    );
  }

  if (!hasVendorInvoice(po)) {
    return <span className="text-xs text-slate-400">-</span>;
  }

  const effectiveDueDate = getEffectiveDueDate(po);
  const remainingDays = getRemainingDays(effectiveDueDate);

  if (remainingDays === null) {
    return <span className="text-xs text-slate-400">-</span>;
  }

  if (remainingDays < 0) {
    const overdueDays = Math.abs(remainingDays);
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-red-100 text-red-800 border-red-300 whitespace-nowrap tabular-nums">
        OVERDUE / TELAT {overdueDays} Hari
      </span>
    );
  }

  if (remainingDays <= 7) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-amber-50 text-amber-800 border-amber-300 whitespace-nowrap tabular-nums">
        Jatuh Tempo Sebentar Lagi ({remainingDays === 0 ? 'Hari Ini' : `${remainingDays} hr`})
      </span>
    );
  }

  return (
    <span className="text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">
      {remainingDays} hari lagi
    </span>
  );
};
