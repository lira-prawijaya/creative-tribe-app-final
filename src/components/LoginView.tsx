import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import {
  AuthenticatedSessionState,
  signInWithEmailPassword,
  updateOwnPassword,
} from '../services/authService';
import { SUPER_ADMIN_EMAIL } from '../types/auth';
import { COMPANY_INFO } from '../types/po';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginViewProps {
  isRecoveryMode?: boolean;
  onLoginSuccess: (session: AuthenticatedSessionState) => void;
  onRecoveryComplete?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  isRecoveryMode = false,
  onLoginSuccess,
  onRecoveryComplete,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!isSupabaseConfigured) {
      setErrorMsg(
        'VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum dikonfigurasi di environment variables.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const session = await signInWithEmailPassword(email, password);
      onLoginSuccess(session);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal login. Periksa kembali email dan password Anda.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setRecoverySuccess(null);

    if (newPassword.length < 6) {
      setErrorMsg('Password baru minimal 6 karakter.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Konfirmasi password baru tidak sama.');
      return;
    }

    setSubmitting(true);
    try {
      await updateOwnPassword(newPassword);
      setRecoverySuccess('Password baru berhasil disimpan. Anda dapat melanjutkan ke aplikasi.');
      setNewPassword('');
      setConfirmNewPassword('');
      if (onRecoveryComplete) {
        window.setTimeout(() => {
          onRecoveryComplete();
        }, 900);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memperbarui password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        {/* Brand Header */}
        <div className="text-center space-y-2.5">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
            <img
              src="/assets/aistudio/ctribe_logo_trimmed.png"
              alt={COMPANY_INFO.name}
              className="w-11 h-11 object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {COMPANY_INFO.name}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Finance Administration · Cashflow, PO &amp; Invoice Management
            </p>
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-7 space-y-5">
          {!isSupabaseConfigured && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Konfigurasi Supabase Diperlukan</p>
                <p className="mt-0.5">
                  Setel <code className="font-mono">VITE_SUPABASE_URL</code> dan{' '}
                  <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> agar Supabase Auth
                  dapat digunakan.
                </p>
              </div>
            </div>
          )}

          {isRecoveryMode ? (
            <>
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
                <div className="p-2 rounded-lg bg-slate-900 text-white">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Atur Password Baru</h2>
                  <p className="text-xs text-slate-500">
                    Masukkan password baru untuk akun Anda
                  </p>
                </div>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {recoverySuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{recoverySuccess}</span>
                </div>
              )}

              <form onSubmit={(e) => void handleRecoverySubmit(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="recovery-new-password"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Password Baru (min. 6 karakter)
                  </label>
                  <input
                    id="recovery-new-password"
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Masukkan password baru"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label
                    htmlFor="recovery-confirm-password"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Konfirmasi Password Baru
                  </label>
                  <input
                    id="recovery-confirm-password"
                    type="password"
                    required
                    minLength={6}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Ulangi password baru"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Password Baru'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
                <div className="p-2 rounded-lg bg-slate-900 text-white">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Masuk ke Sistem Finance</h2>
                  <p className="text-xs text-slate-500">
                    Login wajib dengan akun yang terdaftar untuk mengakses aplikasi
                  </p>
                </div>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nama@creativetribejkt.com"
                      className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan password"
                      className="w-full pl-10 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !isSupabaseConfigured}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-xl transition-colors cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  {submitting ? 'Memproses Login...' : 'Masuk'}
                </button>
              </form>

              {/* Super Admin First-Login Info */}
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-900">
                  <Info className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Informasi Super Admin Pertama</span>
                </div>
                <p className="leading-relaxed">
                  Email Super Admin: <span className="font-mono font-semibold">{SUPER_ADMIN_EMAIL}</span>
                </p>
                <p className="leading-relaxed font-semibold">
                  Password awal Super Admin: <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">Admin123!</code> - Segera ganti password setelah login pertama.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <p className="text-center text-[11px] text-slate-500">
            Sesi login tersimpan aman di browser. Hubungi Super Admin jika Anda belum memiliki akun.
          </p>
          <PWAInstallButton />
        </div>
      </div>
    </div>
  );
};
