import React from 'react';
import { PO_STATUS_META, POStatus, RevisionSubStatus } from '../types/po';

interface StatusBadgeProps {
  status: POStatus;
  revisionSubStatus?: RevisionSubStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  revisionSubStatus,
}) => {
  const meta = PO_STATUS_META[status] ?? PO_STATUS_META.Draft;

  if (status === 'Invoiced' && revisionSubStatus) {
    const label =
      revisionSubStatus === 'Menunggu Konfirmasi'
        ? 'MENUNGGU KONFIRMASI'
        : revisionSubStatus === 'Menunggu Pembayaran Ulang'
        ? 'MENUNGGU PEMBAYARAN ULANG'
        : 'SUDAH DITAGIH - Revisi';

    const badgeClass =
      revisionSubStatus === 'Menunggu Konfirmasi'
        ? 'bg-amber-50 text-amber-800 border-amber-300'
        : revisionSubStatus === 'Menunggu Pembayaran Ulang'
        ? 'bg-rose-50 text-rose-800 border-rose-300'
        : 'bg-indigo-50 text-indigo-800 border-indigo-200';

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold tracking-wide rounded-md border whitespace-nowrap ${badgeClass}`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold tracking-wide rounded-md border whitespace-nowrap ${meta.badgeClass}`}
    >
      {meta.label}
    </span>
  );
};
