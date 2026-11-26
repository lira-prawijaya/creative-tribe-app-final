import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BossReportMonthData } from '../types/bossReport';
import { PurchaseOrder } from '../types/po';
import { formatIDR, getVendorPOEffectiveCostAmount, isVendorPOLunas } from '../utils/format';

interface ProjectVendorSummaryProps {
  orders: PurchaseOrder[];
  bossReportMonths?: Record<string, BossReportMonthData>;
}

interface VendorProjectSummaryRow {
  key: string;
  vendorName: string;
  projectName: string;
  projectNumber: string;
  poCount: number;
  pendingCount: number;
  nilaiKontrak: number;
  sudahDibayar: number;
  sisaHutang: number;
  status: 'Lunas' | 'Belum Lunas';
}

export const ProjectVendorSummary: React.FC<ProjectVendorSummaryProps> = ({
  orders,
  bossReportMonths: _bossReportMonths,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const summaryRows = useMemo<VendorProjectSummaryRow[]>(() => {
    const map = new Map<string, VendorProjectSummaryRow>();
    for (const po of orders) {
      if (po.isDeleted) continue;
      const vKey = po.vendorName.trim().toLowerCase();
      const pKey = (po.projectNumber || po.projectName).trim().toLowerCase();
      const key = `${vKey}__${pKey}`;

      const existing = map.get(key) ?? {
        key,
        vendorName: po.vendorName,
        projectName: po.projectName,
        projectNumber: po.projectNumber || '-',
        poCount: 0,
        pendingCount: 0,
        nilaiKontrak: 0,
        sudahDibayar: 0,
        sisaHutang: 0,
        status: 'Belum Lunas' as const,
      };
      const amt = getVendorPOEffectiveCostAmount(po);
      existing.poCount += 1;
      if (po.status === 'Reschedule') {
        existing.pendingCount += 1;
      }
      existing.nilaiKontrak += amt;
      if (isVendorPOLunas(po)) {
        existing.sudahDibayar += amt;
      }
      existing.sisaHutang = Math.max(0, existing.nilaiKontrak - existing.sudahDibayar);
      existing.status = existing.sisaHutang === 0 ? 'Lunas' : 'Belum Lunas';
      map.set(key, existing);
    }

    return Array.from(map.values()).sort((a, b) =>
      b.sisaHutang !== a.sisaHutang
        ? b.sisaHutang - a.sisaHutang
        : a.vendorName.localeCompare(b.vendorName, 'id')
    );
  }, [orders]);

  if (summaryRows.length === 0) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
        <button
          type="button"
          onClick={() => setCollapsed((p) => !p)}
          className="inline-flex items-center gap-2 text-left cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-slate-600" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-600" />
          )}
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Ringkasan Vendor per Project ({summaryRows.length})
            </h2>
            <p className="text-xs text-slate-500">
              Total nilai kontrak PO Vendor, total terbayar, dan sisa hutang vendor per project
            </p>
          </div>
        </button>
      </div>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">Nama Vendor</th>
                <th className="py-2.5 px-4">Project</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Nilai Kontrak</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Sudah Dibayar</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">Sisa Hutang</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
              {summaryRows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    {row.vendorName}
                    <span className="ml-1.5 text-[11px] font-mono text-slate-400">
                      ({row.poCount} PO)
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {row.projectName}{' '}
                    <span className="font-mono text-xs text-slate-400">
                      #{row.projectNumber}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                    Rp {formatIDR(row.nilaiKontrak)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                    Rp {formatIDR(row.sudahDibayar)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-semibold text-amber-700 tabular-nums whitespace-nowrap">
                    Rp {formatIDR(row.sisaHutang)}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex px-2 py-0.5 text-[11px] font-semibold border rounded ${
                          row.status === 'Lunas'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {row.status}
                      </span>
                      {row.pendingCount > 0 && (
                        <span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold border rounded bg-slate-200 text-slate-700 border-slate-300">
                          {row.pendingCount} PO Pending
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
