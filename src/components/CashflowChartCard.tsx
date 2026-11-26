import React, { useMemo, useState } from 'react';
import { MultiMonthCashflowPoint } from '../utils/bossReportCalc';
import { formatIDR } from '../utils/format';

interface CashflowChartCardProps {
  series: MultiMonthCashflowPoint[];
  selectedMonthKey: string;
  selectedEndMonthKey?: string;
  isRange?: boolean;
  onSelectMonth?: (monthKey: string) => void;
  totalOperasional: number;
  totalInvestment: number;
  totalProjectCost: number;
  totalCost: number;
  totalCashIn: number;
  title?: string;
  subtitle?: string;
  cashInLabel?: string;
  cashOutLabel?: string;
  trendLabel?: string;
  endingTooltipLabel?: string;
  emptyCompositionLabel?: string;
  ariaLabel?: string;
}

function formatCompactIDR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}jt`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}rb`;
  }
  return `${sign}${abs}`;
}

export const CashflowChartCard: React.FC<CashflowChartCardProps> = ({
  series,
  selectedMonthKey,
  selectedEndMonthKey,
  isRange = false,
  onSelectMonth,
  totalOperasional,
  totalInvestment,
  totalProjectCost,
  totalCost,
  totalCashIn,
  title = 'Grafik Cash In vs Cash Out & Trend Ending Balance (6 Bulan)',
  subtitle = 'Perbandingan arus kas bulanan dan tren saldo akhir proyeksi · klik bulan pada grafik untuk berpindah periode',
  cashInLabel = 'Cash In',
  cashOutLabel = 'Cash Out',
  trendLabel = 'Trend Ending Balance',
  endingTooltipLabel = 'Ending Balance',
  emptyCompositionLabel,
  ariaLabel = 'Grafik perbandingan Cash In vs Cash Out dan Trend Ending Balance 6 bulan',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const chartMetrics = useMemo(() => {
    const rawMax = Math.max(
      1,
      ...series.map((pt) =>
        Math.max(pt.totalCashIn, pt.totalCashOut, pt.endingBalance)
      )
    );
    const rawMin = Math.min(0, ...series.map((pt) => pt.endingBalance));
    const maxVal = Math.ceil(rawMax * 1.12);
    const minVal = rawMin < 0 ? Math.floor(rawMin * 1.12) : 0;
    const span = Math.max(1, maxVal - minVal);
    return { maxVal, minVal, span };
  }, [series]);

  const activePoint =
    hoveredIdx !== null
      ? series[hoveredIdx]
      : series.find((p) => p.monthKey === selectedMonthKey) ?? series[0];

  const netSelected = totalCashIn - totalCost;

  const opPct = totalCost > 0 ? Math.round((totalOperasional / totalCost) * 100) : 0;
  const invPct = totalCost > 0 ? Math.round((totalInvestment / totalCost) * 100) : 0;
  const projPct = totalCost > 0 ? Math.max(0, 100 - opPct - invPct) : 0;

  // SVG coordinate system (scales horizontally for > 6 months in range mode)
  const svgW = Math.max(720, series.length * 76);
  const svgH = 232;
  const padL = 58;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const groupW = plotW / Math.max(1, series.length);
  const barW = Math.min(24, Math.max(12, groupW * 0.24));

  const mapY = (val: number) =>
    padT + ((chartMetrics.maxVal - val) / chartMetrics.span) * plotH;
  const zeroY = mapY(0);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const val = Math.round(chartMetrics.minVal + chartMetrics.span * ratio);
    return { ratio, val, y: mapY(val) };
  });

  const endingLinePoints = series
    .map((pt, idx) => {
      const cx = padL + groupW * idx + groupW / 2;
      const cy = mapY(pt.endingBalance);
      return `${cx},${cy}`;
    })
    .join(' ');

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-emerald-600 inline-block" />
            {cashInLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-slate-800 inline-block" />
            {cashOutLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-sky-600 inline-block relative">
              <span className="w-2 h-2 rounded-full bg-sky-600 absolute -top-[3px] left-1" />
            </span>
            {trendLabel}
          </span>
          <span className="font-mono tabular-nums font-semibold text-slate-900">
            {isRange ? 'Net Periode Ini:' : 'Net Bulan Ini:'}{' '}
            <span className={netSelected >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {netSelected > 0 ? '+' : netSelected < 0 ? '-' : ''}Rp{' '}
              {formatIDR(Math.abs(netSelected))}
            </span>
          </span>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Left 2 cols: Multi-Month Bar Chart + Ending Balance Line */}
        <div className="xl:col-span-2 min-w-0">
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-56 select-none"
              style={{
                minWidth: series.length > 6 ? `${Math.max(720, series.length * 72)}px` : '480px',
              }}
              role="img"
              aria-label={ariaLabel}
            >
              {/* Grid lines & Y-axis labels */}
              {yTicks.map((tick) => (
                <g key={tick.ratio}>
                  <line
                    x1={padL}
                    y1={tick.y}
                    x2={svgW - padR}
                    y2={tick.y}
                    stroke="#f1f5f9"
                    strokeWidth={1}
                  />
                  <text
                    x={padL - 8}
                    y={tick.y + 3.5}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {formatCompactIDR(tick.val)}
                  </text>
                </g>
              ))}

              {/* Zero baseline */}
              <line
                x1={padL}
                y1={zeroY}
                x2={svgW - padR}
                y2={zeroY}
                stroke="#cbd5e1"
                strokeWidth={1.2}
              />

              {/* Grouped Bars */}
              {series.map((pt, idx) => {
                const centerX = padL + groupW * idx + groupW / 2;
                const rangeEnd = selectedEndMonthKey ?? selectedMonthKey;
                const isSelected = isRange
                  ? pt.monthKey >= selectedMonthKey && pt.monthKey <= rangeEnd
                  : pt.monthKey === selectedMonthKey;
                const isHovered = hoveredIdx === idx;
                const inY = mapY(pt.totalCashIn);
                const outY = mapY(pt.totalCashOut);
                const inH = Math.max(2, zeroY - inY);
                const outH = Math.max(2, zeroY - outY);

                return (
                  <g
                    key={pt.monthKey}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onClick={() => onSelectMonth?.(pt.monthKey)}
                  >
                    {(isSelected || isHovered) && (
                      <rect
                        x={padL + groupW * idx + 4}
                        y={padT - 4}
                        width={groupW - 8}
                        height={plotH + 8}
                        rx={6}
                        fill={isSelected ? '#f1f5f9' : '#f8fafc'}
                      />
                    )}

                    {/* Cash In Bar */}
                    <rect
                      x={centerX - barW - 2}
                      y={inY}
                      width={barW}
                      height={inH}
                      rx={3}
                      fill={isSelected || isHovered ? '#059669' : '#10b981'}
                    />

                    {/* Cash Out Bar */}
                    <rect
                      x={centerX + 2}
                      y={outY}
                      width={barW}
                      height={outH}
                      rx={3}
                      fill={isSelected || isHovered ? '#0f172a' : '#475569'}
                    />

                    {/* X-axis Month Label */}
                    <text
                      x={centerX}
                      y={svgH - 12}
                      textAnchor="middle"
                      className={`text-[11px] font-semibold ${
                        isSelected ? 'fill-slate-900' : 'fill-slate-500'
                      }`}
                    >
                      {pt.shortLabel}
                    </text>
                  </g>
                );
              })}

              {/* Trend Ending Balance Polyline Overlay */}
              {series.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={endingLinePoints}
                  className="pointer-events-none"
                />
              )}

              {/* Ending Balance Point Nodes */}
              {series.map((pt, idx) => {
                const centerX = padL + groupW * idx + groupW / 2;
                const cy = mapY(pt.endingBalance);
                const rangeEnd = selectedEndMonthKey ?? selectedMonthKey;
                const isSelected = isRange
                  ? pt.monthKey >= selectedMonthKey && pt.monthKey <= rangeEnd
                  : pt.monthKey === selectedMonthKey;
                const isHovered = hoveredIdx === idx;
                const isNeg = pt.endingBalance < 0;
                return (
                  <g key={`eb_${pt.monthKey}`} className="pointer-events-none">
                    <circle
                      cx={centerX}
                      cy={cy}
                      r={isSelected || isHovered ? 5 : 3.8}
                      fill={isNeg ? '#dc2626' : '#0284c7'}
                      stroke="#ffffff"
                      strokeWidth={1.8}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Interactive Detail Strip under chart */}
          {activePoint && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-900">{activePoint.fullLabel}</span>
              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                <span className="text-blue-700">
                  Saldo Awal: {activePoint.saldoAwal < 0 ? '-' : ''}Rp{' '}
                  {formatIDR(Math.abs(activePoint.saldoAwal))}
                </span>
                <span className="text-emerald-700">
                  {cashInLabel}: Rp {formatIDR(activePoint.totalCashIn)}
                </span>
                <span className="text-slate-800">
                  {cashOutLabel}: Rp {formatIDR(activePoint.totalCashOut)}
                </span>
                <span
                  className={
                    activePoint.endingBalance >= 0
                      ? 'text-sky-700 font-semibold'
                      : 'text-red-700 font-semibold'
                  }
                >
                  {endingTooltipLabel}: {activePoint.endingBalance < 0 ? '-' : ''}Rp{' '}
                  {formatIDR(Math.abs(activePoint.endingBalance))}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Cash Out Composition Breakdown */}
        <div className="border-t xl:border-t-0 xl:border-l border-slate-200 pt-5 xl:pt-0 xl:pl-6 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              {isRange ? 'Komposisi Cash Out Periode Ini' : 'Komposisi Cash Out Bulan Ini'}
            </h3>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
              Rp {formatIDR(totalCost)}
              {totalCost === 0 && emptyCompositionLabel ? (
                <span className="block text-xs font-sans font-medium text-slate-500 mt-0.5">
                  {emptyCompositionLabel}
                </span>
              ) : null}
            </p>
          </div>

          {/* Proportion Stacked Bar */}
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
            {totalCost > 0 && (
              <>
                <div
                  style={{ width: `${opPct}%` }}
                  className="bg-amber-500 h-full"
                  title={`Operasional: ${opPct}%`}
                />
                <div
                  style={{ width: `${invPct}%` }}
                  className="bg-sky-600 h-full"
                  title={`Investment: ${invPct}%`}
                />
                <div
                  style={{ width: `${projPct}%` }}
                  className="bg-slate-900 h-full"
                  title={`Project Cost: ${projPct}%`}
                />
              </>
            )}
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-slate-700">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" />
                Operasional (Opex)
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                Rp {formatIDR(totalOperasional)} ({opPct}%)
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-slate-700">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-600 shrink-0" />
                Investment &amp; Cicilan
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                Rp {formatIDR(totalInvestment)} ({invPct}%)
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-slate-700">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 shrink-0" />
                Project Cost (Vendor)
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                Rp {formatIDR(totalProjectCost)} ({projPct}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
