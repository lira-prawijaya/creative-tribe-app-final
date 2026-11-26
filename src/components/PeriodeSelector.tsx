import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonthsToKey,
  diffBossMonthKeys,
  formatMonthKeyParts,
  normalizeMonthKeyYYYYMM,
} from '../utils/bossReportCalc';

const MONTH_OPTIONS = [
  { value: '01', label: 'Januari' },
  { value: '02', label: 'Februari' },
  { value: '03', label: 'Maret' },
  { value: '04', label: 'April' },
  { value: '05', label: 'Mei' },
  { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' },
  { value: '08', label: 'Agustus' },
  { value: '09', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Desember' },
] as const;

const PRESET_YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030];

interface PeriodeSelectorProps {
  monthKey?: string;
  onChangeMonthKey?: (nextMonthKey: string) => void;
  startMonth?: string;
  startYear?: string;
  endMonth?: string;
  endYear?: string;
  onChangeStart?: (nextMonth: string, nextYear: string) => void;
  onChangeEnd?: (nextMonth: string, nextYear: string) => void;
  onSelectSingleMonth?: (nextMonth: string, nextYear: string) => void;
  startMonthKey?: string;
  endMonthKey?: string;
  onChangeRange?: (nextStartMonthKey: string, nextEndMonthKey: string) => void;
  ariaLabelPrefix?: string;
}

export const PeriodeSelector: React.FC<PeriodeSelectorProps> = ({
  monthKey = '2026-11',
  onChangeMonthKey,
  startMonth: propStartMonth,
  startYear: propStartYear,
  endMonth: propEndMonth,
  endYear: propEndYear,
  onChangeStart,
  onChangeEnd,
  onSelectSingleMonth,
  startMonthKey,
  endMonthKey,
  onChangeRange,
  ariaLabelPrefix = 'periode',
}) => {
  const isRangeControl = Boolean(
    (onChangeStart && onChangeEnd) ||
      (onChangeRange && startMonthKey && endMonthKey)
  );

  const resolvedStartNorm = normalizeMonthKeyYYYYMM(
    propStartYear && propStartMonth
      ? formatMonthKeyParts(propStartYear, propStartMonth)
      : startMonthKey ?? monthKey
  );
  const resolvedEndNorm = normalizeMonthKeyYYYYMM(
    propEndYear && propEndMonth
      ? formatMonthKeyParts(propEndYear, propEndMonth)
      : endMonthKey ?? monthKey
  );

  const resolvedStartYear = resolvedStartNorm.slice(0, 4);
  const resolvedStartMonth = resolvedStartNorm.slice(5, 7);
  const resolvedEndYear = resolvedEndNorm.slice(0, 4);
  const resolvedEndMonth = resolvedEndNorm.slice(5, 7);

  const startKey = formatMonthKeyParts(resolvedStartYear, resolvedStartMonth);
  const endKey = formatMonthKeyParts(resolvedEndYear, resolvedEndMonth);
  const isReversedRange = endKey < startKey;
  const spanMonths = isReversedRange ? 1 : diffBossMonthKeys(startKey, endKey) + 1;
  const isExceedingMaxRange = !isReversedRange && spanMonths > 12;

  const rangeYearOptions = useMemo(() => {
    const yearSet = new Set<number>([2024, 2025, 2026, 2027, 2028, 2029]);
    const parsedStart = Number(resolvedStartYear);
    const parsedEnd = Number(resolvedEndYear);
    if (Number.isInteger(parsedStart) && parsedStart >= 2000 && parsedStart <= 2099) {
      yearSet.add(parsedStart);
    }
    if (Number.isInteger(parsedEnd) && parsedEnd >= 2000 && parsedEnd <= 2099) {
      yearSet.add(parsedEnd);
    }
    return Array.from(yearSet).sort((a, b) => a - b);
  }, [resolvedStartYear, resolvedEndYear]);

  const [rawYear = '2026', rawMonth = '11'] = monthKey.split('-');
  const currentYear = /^\d{4}$/.test(rawYear) ? rawYear : '2026';
  const currentMonth = /^\d{2}$/.test(rawMonth) ? rawMonth : '11';

  const [yearDraft, setYearDraft] = useState(currentYear);
  const [yearMenuOpen, setYearMenuOpen] = useState(false);
  const yearWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setYearDraft(currentYear);
  }, [currentYear]);

  useEffect(() => {
    if (!yearMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        yearWrapperRef.current &&
        !yearWrapperRef.current.contains(e.target as Node)
      ) {
        setYearMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [yearMenuOpen]);

  if (isRangeControl) {
    const now = new Date();
    const currentCalendarMonthKey = formatMonthKeyParts(
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0')
    );
    const isCurrentCalendarSingleMonth =
      startKey === currentCalendarMonthKey && endKey === currentCalendarMonthKey;

    const selectSingleMonth = (nextMonth: string, nextYear: string) => {
      const cleanMonth = String(nextMonth).padStart(2, '0');
      const cleanYear = String(nextYear);
      const singleKey = formatMonthKeyParts(cleanYear, cleanMonth);
      if (onSelectSingleMonth) {
        onSelectSingleMonth(cleanMonth, cleanYear);
      } else if (onChangeRange) {
        onChangeRange(singleKey, singleKey);
      } else if (onChangeStart && onChangeEnd) {
        onChangeStart(cleanMonth, cleanYear);
        onChangeEnd(cleanMonth, cleanYear);
      }
    };

    const updateStartOnly = (nextMonth: string, nextYear: string) => {
      const cleanMonth = String(nextMonth).padStart(2, '0');
      const nextStartKey = formatMonthKeyParts(nextYear, cleanMonth);
      if (nextStartKey > endKey) {
        selectSingleMonth(cleanMonth, nextYear);
        return;
      }
      if (onChangeStart) {
        onChangeStart(cleanMonth, nextYear);
      } else if (onChangeRange) {
        onChangeRange(nextStartKey, endKey);
      }
    };

    const updateEndOnly = (nextMonth: string, nextYear: string) => {
      const cleanMonth = String(nextMonth).padStart(2, '0');
      const nextEndKey = formatMonthKeyParts(nextYear, cleanMonth);
      if (nextEndKey < startKey) {
        selectSingleMonth(cleanMonth, nextYear);
        return;
      }
      if (onChangeEnd) {
        onChangeEnd(cleanMonth, nextYear);
      } else if (onChangeRange) {
        onChangeRange(startKey, nextEndKey);
      }
    };

    const handleShiftStart = () => {
      const prevStart = addMonthsToKey(startKey, -1);
      updateStartOnly(prevStart.slice(5, 7), prevStart.slice(0, 4));
    };

    const handleShiftEnd = () => {
      const nextEnd = addMonthsToKey(endKey, 1);
      updateEndOnly(nextEnd.slice(5, 7), nextEnd.slice(0, 4));
    };

    const handleStepSingleMonth = (delta: number) => {
      const baseKey = delta < 0 ? startKey : endKey;
      const targetKey = addMonthsToKey(baseKey, delta);
      selectSingleMonth(targetKey.slice(5, 7), targetKey.slice(0, 4));
    };

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Periode:</span>

          <div
            className={`inline-flex flex-wrap items-center border rounded-lg bg-white overflow-hidden ${
              isExceedingMaxRange ? 'border-amber-500' : 'border-slate-300'
            }`}
          >
            <button
              type="button"
              onClick={handleShiftStart}
              aria-label={`Mundur 1 bulan Dari ${ariaLabelPrefix}`}
              title="Geser Dari mundur 1 bulan"
              className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-r border-slate-200 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="inline-flex items-center px-2 py-1 gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                Dari:
              </span>
              <select
                aria-label={`Pilih bulan awal ${ariaLabelPrefix}`}
                value={resolvedStartMonth}
                onChange={(e) =>
                  updateStartOnly(
                    String(e.target.value).padStart(2, '0'),
                    resolvedStartYear
                  )
                }
                className="py-1 px-1.5 text-xs sm:text-sm font-semibold text-slate-900 bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={`from_month_${m.value}`} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Pilih tahun awal ${ariaLabelPrefix}`}
                value={resolvedStartYear}
                onChange={(e) => updateStartOnly(resolvedStartMonth, e.target.value)}
                className="py-1 px-1.5 text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-900 bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
              >
                {rangeYearOptions.map((yr) => {
                  const yrStr = String(yr);
                  return (
                    <option key={`from_year_${yrStr}`} value={yrStr}>
                      {yrStr}
                    </option>
                  );
                })}
              </select>
            </div>

            <span className="px-2 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-x border-slate-200 whitespace-nowrap">
              s/d
            </span>

            <div className="inline-flex items-center px-2 py-1 gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                Sampai:
              </span>
              <select
                aria-label={`Pilih bulan akhir ${ariaLabelPrefix}`}
                value={resolvedEndMonth}
                onChange={(e) =>
                  updateEndOnly(
                    String(e.target.value).padStart(2, '0'),
                    resolvedEndYear
                  )
                }
                className={`py-1 px-1.5 text-xs sm:text-sm font-semibold text-slate-900 bg-white border rounded focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer ${
                  isExceedingMaxRange ? 'border-amber-500' : 'border-slate-200'
                }`}
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={`to_month_${m.value}`} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Pilih tahun akhir ${ariaLabelPrefix}`}
                value={resolvedEndYear}
                onChange={(e) => updateEndOnly(resolvedEndMonth, e.target.value)}
                className={`py-1 px-1.5 text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-900 bg-white border rounded focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer ${
                  isExceedingMaxRange ? 'border-amber-500' : 'border-slate-200'
                }`}
              >
                {rangeYearOptions.map((yr) => {
                  const yrStr = String(yr);
                  return (
                    <option key={`to_year_${yrStr}`} value={yrStr}>
                      {yrStr}
                    </option>
                  );
                })}
              </select>
            </div>

            <button
              type="button"
              onClick={handleShiftEnd}
              aria-label={`Maju 1 bulan Sampai ${ariaLabelPrefix}`}
              title="Geser Sampai maju 1 bulan"
              className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l border-slate-200 cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleStepSingleMonth(-1)}
              aria-label={`Bulan Lalu ${ariaLabelPrefix}`}
              title="Set Dari dan Sampai ke 1 bulan sebelumnya"
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap cursor-pointer transition-colors"
            >
              &lt;&lt; Bulan Lalu
            </button>

            <button
              type="button"
              onClick={() => handleStepSingleMonth(1)}
              aria-label={`Bulan Depan ${ariaLabelPrefix}`}
              title="Set Dari dan Sampai ke 1 bulan berikutnya"
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap cursor-pointer transition-colors"
            >
              Bulan Depan &gt;&gt;
            </button>

            <select
              aria-label={`Pilih 1 Bulan ${ariaLabelPrefix}`}
              title="Pilih 1 bulan untuk menyamakan Dari dan Sampai"
              value=""
              onChange={(e) => {
                const chosen = e.target.value;
                if (!chosen) return;
                const yr = chosen.slice(0, 4);
                const mo = chosen.slice(5, 7);
                selectSingleMonth(mo, yr);
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer"
            >
              <option value="">Pilih 1 Bulan</option>
              {rangeYearOptions.map((yr) => {
                const yrStr = String(yr);
                return (
                  <optgroup key={`single_yr_${yrStr}`} label={yrStr}>
                    {MONTH_OPTIONS.map((m) => {
                      const val = `${yrStr}-${m.value}`;
                      return (
                        <option key={`single_opt_${val}`} value={val}>
                          {m.label} {yrStr}
                        </option>
                      );
                    })}
                  </optgroup>
                );
              })}
            </select>

            <button
              type="button"
              onClick={() =>
                selectSingleMonth(
                  currentCalendarMonthKey.slice(5, 7),
                  currentCalendarMonthKey.slice(0, 4)
                )
              }
              aria-label={`Bulan Ini ${ariaLabelPrefix}`}
              title="Set Dari dan Sampai ke bulan berjalan"
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border whitespace-nowrap cursor-pointer transition-colors ${
                isCurrentCalendarSingleMonth
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Bulan Ini
            </button>
          </div>
        </div>

        {isExceedingMaxRange && (
          <p
            role="alert"
            className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-md px-2.5 py-1 inline-block w-fit"
          >
            Rentang maksimal 12 bulan
          </p>
        )}
      </div>
    );
  }

  const emitSingle = (nextMk: string) => {
    onChangeMonthKey?.(nextMk);
  };

  const commitYear = (raw: string) => {
    const clean = raw.replace(/\D/g, '');
    const num = Number(clean);
    if (clean.length === 4 && Number.isInteger(num) && num >= 2000 && num <= 2099) {
      if (clean !== currentYear) {
        emitSingle(`${clean}-${currentMonth}`);
      }
      setYearDraft(clean);
    } else {
      setYearDraft(currentYear);
    }
  };

  const yearChoices = PRESET_YEARS.includes(Number(currentYear))
    ? PRESET_YEARS
    : [...PRESET_YEARS, Number(currentYear)].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-slate-600">Periode:</span>

      <div className="inline-flex items-center border border-slate-300 rounded-lg bg-white">
        {/* Geser mundur 1 periode */}
        <button
          type="button"
          onClick={() => emitSingle(addMonthsToKey(monthKey, -1))}
          aria-label={`Mundur 1 ${ariaLabelPrefix}`}
          title="Mundur 1 periode"
          className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-r border-slate-200 rounded-l-lg cursor-pointer transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Dropdown 1: Bulan */}
        <select
          aria-label={`Pilih bulan ${ariaLabelPrefix}`}
          value={currentMonth}
          onChange={(e) => emitSingle(`${currentYear}-${e.target.value}`)}
          className="px-2.5 py-2 text-xs sm:text-sm font-semibold text-slate-900 bg-white focus:outline-none cursor-pointer"
        >
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        {/* Dropdown 2: Tahun (bisa pilih dari list 2024-2030 atau ketik langsung) */}
        <div
          ref={yearWrapperRef}
          className="relative inline-flex items-center border-l border-slate-200"
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            aria-label={`Tahun ${ariaLabelPrefix}`}
            value={yearDraft}
            onFocus={(e) => {
              e.target.select();
              setYearMenuOpen(true);
            }}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
              setYearDraft(digits);
              if (digits.length === 4) {
                const num = Number(digits);
                if (num >= 2000 && num <= 2099 && digits !== currentYear) {
                  emitSingle(`${digits}-${currentMonth}`);
                }
              }
            }}
            onBlur={() => commitYear(yearDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitYear(yearDraft);
                setYearMenuOpen(false);
              } else if (e.key === 'Escape') {
                setYearDraft(currentYear);
                setYearMenuOpen(false);
              } else if (e.key === 'ArrowDown') {
                setYearMenuOpen(true);
              }
            }}
            className="w-14 pl-2.5 pr-1 py-2 text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-900 bg-white focus:outline-none text-center"
            title="Pilih atau ketik tahun (4 digit)"
          />
          <button
            type="button"
            aria-label={`Daftar tahun ${ariaLabelPrefix}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setYearMenuOpen((prev) => !prev)}
            className="pr-2 pl-0.5 py-2 text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {yearMenuOpen && (
            <div
              role="listbox"
              aria-label={`Pilih tahun ${ariaLabelPrefix}`}
              className="absolute left-0 top-full mt-1 w-24 bg-white border border-slate-300 rounded-lg shadow-lg py-1 z-30 max-h-52 overflow-y-auto"
            >
              {yearChoices.map((yr) => {
                const yrStr = String(yr);
                const selected = yrStr === currentYear;
                return (
                  <button
                    key={yrStr}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setYearDraft(yrStr);
                      setYearMenuOpen(false);
                      if (yrStr !== currentYear) {
                        emitSingle(`${yrStr}-${currentMonth}`);
                      }
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs sm:text-sm font-mono tabular-nums cursor-pointer transition-colors ${
                      selected
                        ? 'bg-slate-900 text-white font-bold'
                        : 'text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    {yrStr}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Geser maju 1 periode */}
        <button
          type="button"
          onClick={() => emitSingle(addMonthsToKey(monthKey, 1))}
          aria-label={`Maju 1 ${ariaLabelPrefix}`}
          title="Maju 1 periode"
          className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l border-slate-200 rounded-r-lg cursor-pointer transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
