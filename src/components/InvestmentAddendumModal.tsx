import React, { useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, Upload, X } from 'lucide-react';
import {
  InterestInputType,
  INVESTMENT_SCHEMA_LIMITS,
  InvestmentAddendumFormSubmission,
  InvestmentAsset,
} from '../types/investment';
import { formatIDR, getTodayISODate, normalizeToIsoDate } from '../utils/format';
import {
  addMonthsKeepingDay,
  addMonthsToInvestmentKey,
  computeBonusForAmount,
  computeMonthlyInterestForBalance,
  formatDDMMMYYYYDash,
  formatMonthYearShortID,
  getEffectiveAssetBonusDate,
  getEffectiveAssetEndDate,
  roundInterestRate,
} from '../utils/investmentCalc';
import { RupiahInput } from './RupiahInput';

interface InvestmentAddendumModalProps {
  asset: InvestmentAsset;
  onCancel: () => void;
  onSubmit: (submission: InvestmentAddendumFormSubmission) => Promise<void>;
}

const MAX_PDF_BYTES = 2 * 1024 * 1024; // 2 MB

export const InvestmentAddendumModal: React.FC<InvestmentAddendumModalProps> = ({
  asset,
  onCancel,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nextSeq = (asset.addendums?.length ?? 0) + 1;
  const currentEndDate = useMemo(() => getEffectiveAssetEndDate(asset), [asset]);
  const currentContractNumber = asset.contractNumber?.trim() || asset.name;

  const isAnuitas = asset.paymentMethod === 'ANUITAS';
  const initialMonthlyBunga = isAnuitas
    ? asset.monthlyInstallment > 0
      ? asset.monthlyInstallment
      : asset.fixedPrincipalPerMonth + asset.monthlyInterestAmount
    : asset.monthlyInterestAmount > 0
    ? asset.monthlyInterestAmount
    : 0;

  const [addendumNumber, setAddendumNumber] = useState(
    asset.contractNumber?.trim()
      ? `ADD.${asset.contractNumber.trim()}`
      : `ADD-${String(nextSeq).padStart(2, '0')}`
  );
  const [addendumDate, setAddendumDate] = useState(getTodayISODate());
  const [additionalTenorStr, setAdditionalTenorStr] = useState('6');
  const [newEndDate, setNewEndDate] = useState(() =>
    addMonthsKeepingDay(currentEndDate, 6)
  );
  const [endDateManuallyEdited, setEndDateManuallyEdited] = useState(false);

  const [newPrincipalStr, setNewPrincipalStr] = useState(String(asset.principalAmount ?? 0));
  const [newInterestInputType, setNewInterestInputType] = useState<InterestInputType>(
    asset.interestInputType === 'PERCENT' ? 'PERCENT' : 'RP'
  );
  const [newMonthlyInterestAmountStr, setNewMonthlyInterestAmountStr] = useState(
    String(initialMonthlyBunga)
  );
  const [newMonthlyInterestRateStr, setNewMonthlyInterestRateStr] = useState(
    String(asset.monthlyInterestRate ?? 0)
  );

  const [newLateFeeInputType, setNewLateFeeInputType] = useState<InterestInputType>(
    asset.lateFeeInputType === 'PERCENT' ? 'PERCENT' : 'RP'
  );
  const [newLateFeePerMonthAmountStr, setNewLateFeePerMonthAmountStr] = useState(
    String(asset.lateFeePerMonthAmount ?? 0)
  );
  const [newLateFeePerMonthRateStr, setNewLateFeePerMonthRateStr] = useState(
    String(asset.lateFeePerMonthRate ?? 0)
  );

  const [newBonusInputType, setNewBonusInputType] = useState<InterestInputType>(
    asset.bonusInputType === 'PERCENT' ? 'PERCENT' : 'RP'
  );
  const [newBonusAmountStr, setNewBonusAmountStr] = useState(
    String(asset.bonusAmount ?? 0)
  );
  const [newBonusRateStr, setNewBonusRateStr] = useState(
    String(asset.bonusRate ?? 0)
  );
  const [newBonusDate, setNewBonusDate] = useState(() =>
    addMonthsKeepingDay(currentEndDate, 6)
  );
  const [bonusDateManuallyEdited, setBonusDateManuallyEdited] = useState(false);

  const [notes, setNotes] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfDataUrl, setPdfDataUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const maxAdditionalTenor = Math.max(
    1,
    INVESTMENT_SCHEMA_LIMITS.maxTenor - asset.tenorMonths
  );

  const getAnchorDate = (adDate: string) =>
    adDate && /^\d{4}-\d{2}-\d{2}$/.test(adDate) && adDate > currentEndDate
      ? adDate
      : currentEndDate;

  const handleAddendumDateChange = (nextAdDate: string) => {
    setAddendumDate(nextAdDate);
    if (!endDateManuallyEdited) {
      const n = Math.max(1, Math.min(maxAdditionalTenor, Math.round(Number(additionalTenorStr) || 1)));
      const nextCalculatedEnd = addMonthsKeepingDay(getAnchorDate(nextAdDate), n);
      setNewEndDate(nextCalculatedEnd);
      if (!bonusDateManuallyEdited) {
        setNewBonusDate(nextCalculatedEnd);
      }
    }
  };

  const handleAdditionalTenorChange = (val: string) => {
    setAdditionalTenorStr(val);
    const n = Math.max(1, Math.min(maxAdditionalTenor, Math.round(Number(val) || 1)));
    const nextCalculatedEnd = addMonthsKeepingDay(getAnchorDate(addendumDate), n);
    if (!endDateManuallyEdited) {
      setNewEndDate(nextCalculatedEnd);
      if (!bonusDateManuallyEdited) {
        setNewBonusDate(nextCalculatedEnd);
      }
    }
  };

  const handleNewEndDateChange = (nextVal: string) => {
    setEndDateManuallyEdited(true);
    setNewEndDate(nextVal);
    if (!bonusDateManuallyEdited) {
      setNewBonusDate(nextVal);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PDF_BYTES) {
      setError('Ukuran file Adendum PDF maksimal 2 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setError(null);
        setPdfDataUrl(reader.result);
        setPdfFileName(file.name.slice(0, INVESTMENT_SCHEMA_LIMITS.pdfFileNameMax));
      }
    };
    reader.onerror = () => {
      setError('Gagal membaca file PDF Adendum.');
    };
    reader.readAsDataURL(file);
  };

  const handleClearFile = () => {
    setPdfDataUrl(undefined);
    setPdfFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const additionalTenorNum = Math.max(
    1,
    Math.min(maxAdditionalTenor, Math.round(Number(additionalTenorStr) || 1))
  );
  const parsedNewPrincipal = Math.max(
    asset.principalAmount,
    Math.round(Number(newPrincipalStr) || 0)
  );
  const additionalPrincipalNum = Math.max(0, parsedNewPrincipal - asset.principalAmount);
  const newTotalPrincipal = asset.principalAmount + additionalPrincipalNum;
  const previewNewBonusRp = computeBonusForAmount({
    principalBasis: newTotalPrincipal,
    bonusInputType: newBonusInputType,
    bonusAmount: Number(newBonusAmountStr) || 0,
    bonusRate: Number(newBonusRateStr) || 0,
  });
  const previewNewInterestRp = computeMonthlyInterestForBalance({
    remainingPrincipal: newTotalPrincipal,
    interestInputType: newInterestInputType,
    monthlyInterestAmount: Number(newMonthlyInterestAmountStr) || 0,
    monthlyInterestRate: Number(newMonthlyInterestRateStr) || 0,
    paymentMethod: asset.paymentMethod,
    initialPrincipalBasis: newTotalPrincipal,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addendumNumber.trim()) {
      setError('Nomor Adendum / Kontrak Baru wajib diisi.');
      return;
    }
    const isoAddendumDate = normalizeToIsoDate(addendumDate);
    if (!isoAddendumDate) {
      setError('Tanggal Adendum wajib diisi dengan format tanggal yang valid.');
      return;
    }
    const isoNewEndDate = normalizeToIsoDate(newEndDate);
    if (!isoNewEndDate) {
      setError('Tanggal Jatuh Tempo Baru wajib diisi dengan format tanggal yang valid.');
      return;
    }
    const isoNewBonusDate = normalizeToIsoDate(newBonusDate) ?? isoNewEndDate;
    setError(null);
    setSaving(true);
    const newInterestAmountRp =
      newInterestInputType === 'RP'
        ? Math.max(0, Math.round(Number(newMonthlyInterestAmountStr) || 0))
        : 0;
    const newInterestRatePct =
      newInterestInputType === 'PERCENT'
        ? roundInterestRate(Number(newMonthlyInterestRateStr) || 0)
        : 0;
    try {
      await onSubmit({
        addendumDate: isoAddendumDate,
        addendumNumber: addendumNumber.trim(),
        additionalTenorMonths: additionalTenorNum,
        newEndDate: isoNewEndDate,
        additionalPrincipal: additionalPrincipalNum,
        newInterestInputType: isAnuitas ? 'RP' : newInterestInputType,
        newMonthlyInterestAmount: newInterestAmountRp,
        newMonthlyInterestRate: isAnuitas ? 0 : newInterestRatePct,
        ...(isAnuitas && newInterestAmountRp > 0
          ? { newMonthlyInstallment: newInterestAmountRp }
          : {}),
        newLateFeeInputType,
        newLateFeePerMonthAmount:
          newLateFeeInputType === 'RP'
            ? Math.max(0, Math.round(Number(newLateFeePerMonthAmountStr) || 0))
            : 0,
        newLateFeePerMonthRate:
          newLateFeeInputType === 'PERCENT'
            ? roundInterestRate(Number(newLateFeePerMonthRateStr) || 0)
            : 0,
        newBonusInputType,
        newBonusAmount:
          newBonusInputType === 'RP'
            ? Math.max(0, Math.round(Number(newBonusAmountStr) || 0))
            : 0,
        newBonusRate:
          newBonusInputType === 'PERCENT'
            ? roundInterestRate(Number(newBonusRateStr) || 0)
            : 0,
        newBonusDate: isoNewBonusDate,
        notes: notes.trim(),
        pdfFileName: pdfFileName || undefined,
        pdfDataUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4 shadow-xl max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Adendum Kontrak (Adendum {nextSeq})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {currentContractNumber} · Investor: {asset.name} · Periode lama {asset.tenorMonths} Bulan (JT:{' '}
                {formatDDMMMYYYYDash(currentEndDate)} · Bonus lama:{' '}
                {formatDDMMMYYYYDash(getEffectiveAssetBonusDate(asset))})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-900 rounded cursor-pointer"
            aria-label="Tutup modal adendum"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nomor Adendum / Kontrak Baru *
            </label>
            <input
              type="text"
              required
              maxLength={INVESTMENT_SCHEMA_LIMITS.addendumNumberMax}
              value={addendumNumber}
              onChange={(e) => setAddendumNumber(e.target.value)}
              placeholder="Contoh: ADD.WB-KKB.01.I/2026"
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tanggal Adendum *
            </label>
            <input
              type="date"
              required
              value={addendumDate}
              onChange={(e) => handleAddendumDateChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            {INVESTMENT_SCHEMA_LIMITS.datePattern.test(addendumDate) && (
              <p className="text-[11px] text-slate-500 mt-1">
                Perpanjangan cicilan mulai{' '}
                <strong className="text-slate-700">
                  {formatMonthYearShortID(
                    addMonthsToInvestmentKey(addendumDate.slice(0, 7), 1)
                  )}
                </strong>{' '}
                (1 bln setelah Tgl Adendum, tanpa duplikat)
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Periode Baru / Perpanjangan (Tambah Bulan) *
            </label>
            <input
              type="number"
              required
              min={1}
              max={maxAdditionalTenor}
              value={additionalTenorStr}
              onChange={(e) => handleAdditionalTenorChange(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
              Total Periode Baru: {asset.tenorMonths} + {additionalTenorNum} ={' '}
              <strong className="text-slate-800">
                {asset.tenorMonths + additionalTenorNum} Bulan
              </strong>
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                Tgl Jatuh Tempo Baru *
              </label>
              {endDateManuallyEdited && (
                <button
                  type="button"
                  onClick={() => {
                    setEndDateManuallyEdited(false);
                    const nextCalc = addMonthsKeepingDay(getAnchorDate(addendumDate), additionalTenorNum);
                    setNewEndDate(nextCalc);
                    if (!bonusDateManuallyEdited) {
                      setNewBonusDate(nextCalc);
                    }
                  }}
                  className="text-[11px] font-semibold text-indigo-700 hover:underline cursor-pointer"
                >
                  Auto-hitung
                </button>
              )}
            </div>
            <input
              type="date"
              required
              value={newEndDate}
              onChange={(e) => handleNewEndDateChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Auto = {formatDDMMMYYYYDash(getAnchorDate(addendumDate))} + {additionalTenorNum} Bulan
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nilai Pinjaman Baru (opsional tambahan pokok)
            </label>
            <div className="relative">
              <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                Rp
              </span>
              <RupiahInput
                value={newPrincipalStr}
                onValueChange={setNewPrincipalStr}
                placeholder={formatIDR(asset.principalAmount)}
                className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
              Lama: Rp {formatIDR(asset.principalAmount)}
              {additionalPrincipalNum > 0
                ? ` · Tambahan Pokok: +Rp ${formatIDR(additionalPrincipalNum)}`
                : ' · Tidak ada tambahan pokok'}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                {isAnuitas ? 'Angsuran Baru (Rp)' : 'Bunga Per Bulan Baru (Rp)'}
              </label>
              {!isAnuitas && (
                <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => setNewInterestInputType('RP')}
                    className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                      newInterestInputType === 'RP'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Rp
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewInterestInputType('PERCENT')}
                    className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                      newInterestInputType === 'PERCENT'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    %
                  </button>
                </div>
              )}
            </div>
            {isAnuitas || newInterestInputType === 'RP' ? (
              <div className="relative">
                <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  value={newMonthlyInterestAmountStr}
                  onValueChange={setNewMonthlyInterestAmountStr}
                  placeholder="0"
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            ) : (
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={newMonthlyInterestRateStr}
                  onChange={(e) => setNewMonthlyInterestRateStr(e.target.value)}
                  placeholder="Contoh: 2"
                  className="w-full pl-3 pr-20 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <span className="text-xs font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  % / bulan
                </span>
              </div>
            )}
            <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
              {isAnuitas
                ? `Total Angsuran baru per bulan: Rp ${formatIDR(
                    Number(newMonthlyInterestAmountStr) || 0
                  )}/bln`
                : `Bunga per bulan saja: Rp ${formatIDR(previewNewInterestRp)}/bln`}
            </p>
          </div>
        </div>

        {/* Bonus Baru, Tgl Bonus Baru, Denda Baru */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">Bonus Baru</label>
              <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setNewBonusInputType('RP')}
                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                    newBonusInputType === 'RP'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Rp
                </button>
                <button
                  type="button"
                  onClick={() => setNewBonusInputType('PERCENT')}
                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                    newBonusInputType === 'PERCENT'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  %
                </button>
              </div>
            </div>
            {newBonusInputType === 'RP' ? (
              <div className="relative">
                <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  value={newBonusAmountStr}
                  onValueChange={setNewBonusAmountStr}
                  placeholder="0"
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            ) : (
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={newBonusRateStr}
                  onChange={(e) => setNewBonusRateStr(e.target.value)}
                  placeholder="Contoh: 5"
                  className="w-full pl-3 pr-24 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <span className="text-xs font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  % pokok
                </span>
              </div>
            )}
            <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
              Nominal Bonus baru: <strong className="text-slate-800">Rp {formatIDR(previewNewBonusRp)}</strong>
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                Tgl Bonus Baru
              </label>
              {bonusDateManuallyEdited && (
                <button
                  type="button"
                  onClick={() => {
                    setBonusDateManuallyEdited(false);
                    setNewBonusDate(newEndDate);
                  }}
                  className="text-[11px] font-semibold text-indigo-700 hover:underline cursor-pointer"
                >
                  Samakan Tgl JT
                </button>
              )}
            </div>
            <input
              type="date"
              value={newBonusDate}
              onChange={(e) => {
                setBonusDateManuallyEdited(true);
                setNewBonusDate(e.target.value);
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Default = Tgl Jatuh Tempo Baru ({formatDDMMMYYYYDash(newEndDate)})
            </p>
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                Denda Baru (per Bulan)
              </label>
              <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setNewLateFeeInputType('RP')}
                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                    newLateFeeInputType === 'RP'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Rp
                </button>
                <button
                  type="button"
                  onClick={() => setNewLateFeeInputType('PERCENT')}
                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                    newLateFeeInputType === 'PERCENT'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  %
                </button>
              </div>
            </div>
            {newLateFeeInputType === 'RP' ? (
              <div className="relative">
                <span className="text-xs font-mono text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  Rp
                </span>
                <RupiahInput
                  value={newLateFeePerMonthAmountStr}
                  onValueChange={setNewLateFeePerMonthAmountStr}
                  placeholder="0"
                  className="w-full pl-9 pr-16 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <span className="text-[11px] font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  / bulan
                </span>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={newLateFeePerMonthRateStr}
                  onChange={(e) => setNewLateFeePerMonthRateStr(e.target.value)}
                  className="w-full pl-3 pr-22 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <span className="text-xs font-mono text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  % / bulan
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Catatan & Upload File PDF */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Catatan</label>
            <textarea
              rows={2}
              maxLength={INVESTMENT_SCHEMA_LIMITS.notesMax}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Keterangan alasan perpanjangan / kesepakatan adendum..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Upload File Adendum (PDF)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                id="addendum-pdf-upload"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="addendum-pdf-upload"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Pilih File PDF Adendum
              </label>

              {pdfFileName && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-800">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[240px]">{pdfFileName}</span>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="text-indigo-500 hover:text-red-600 cursor-pointer"
                    title="Hapus file PDF"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg cursor-pointer"
          >
            {saving ? 'Menyimpan...' : `Simpan Adendum ${nextSeq}`}
          </button>
        </div>
      </form>
    </div>
  );
};
