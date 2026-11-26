import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileSpreadsheet,
  FolderKanban,
  History,
  KeyRound,
  Landmark,
  LogOut,
  Menu,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  clearDatabaseErrorBanner,
  isSupabaseConfigured,
  supabase,
  subscribeDatabaseErrors,
} from './lib/supabaseClient';
import {
  AuthenticatedSessionState,
  loadAuthenticatedProfile,
  restoreSavedSession,
  sendPresenceOfflineBeacon,
  signOutCurrentUser,
  updateUserPresence,
} from './services/authService';
import {
  deleteAllAuditLogs,
  deleteSelectedAuditLogs,
  logAuditActivity,
  subscribeAuditLogs,
} from './services/auditLogService';
import {
  createDefaultBossReportMonth,
  generateBossRowId,
  refreshBossReportMonthsFromSupabase,
  refreshBossReportMonthsRangeFromSupabase,
  saveBossReportMonth,
  saveBossReportMonthsBatch,
  subscribeBossReportMonths,
} from './services/bossReportService';
import {
  createClientInvoice,
  deleteClientInvoice,
  getClientInvoiceById,
  markClientInvoicePaid,
  markClientInvoiceUnpaid,
  refreshClientInvoicesRangeFromSupabase,
  restoreClientInvoice,
  reviseClientInvoice,
  sendClientInvoice,
  setClientInvoiceStatusWarna,
  softDeleteClientInvoice,
  subscribeClientInvoices,
  updateClientInvoice,
  updateClientInvoicePrintOptions,
} from './services/clientInvoiceService';
import {
  createClientPO,
  deleteClientPO,
  subscribeClientPOs,
  updateClientPO,
} from './services/clientPOService';
import {
  addInvestmentAddendum,
  createInvestmentAsset,
  deleteInvestmentAsset,
  importInvestmentsBatch,
  refreshInvestmentsRangeFromSupabase,
  setInvestmentDisbursementStatus,
  setInvestmentMonthPaid,
  setInvestmentMonthStatus,
  subscribeInvestments,
  toggleInvestmentPaidMonth,
  updateInvestmentAsset,
  updateInvestmentDates,
} from './services/investmentService';
import {
  createOpexItem,
  deleteOpexItem,
  refreshOpexFromSupabase,
  refreshOpexRangeFromSupabase,
  setOpexMonthPaymentStatus,
  subscribeOpexItems,
  updateOpexItem,
} from './services/opexService';
import {
  cancelPurchaseOrderInvoice,
  cancelPurchaseOrderPaid,
  createPurchaseOrder,
  deletePurchaseOrder,
  refreshPurchaseOrdersRangeFromSupabase,
  restorePurchaseOrder,
  revisePurchaseOrder,
  setPurchaseOrderStatusWarna,
  softDeletePurchaseOrder,
  submitPurchaseOrderPph,
  subscribePurchaseOrders,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from './services/poService';
import {
  createProjectionManualItem,
  deleteProjectionManualItem,
  refreshProjectionManualItemsRangeFromSupabase,
  subscribeProjectionManualItems,
  updateProjectionManualItem,
} from './services/projectionManualService';
import {
  AppMenuKey,
  AppMenuPermissionsMap,
  AuditActor,
  AuditLogEntry,
  buildDefaultViewOnlyMenuPermissions,
  DEFAULT_SYSTEM_ACTOR,
  deriveClientInvoicePermissions,
  deriveVendorPermissions,
  isSuperAdminEmail,
} from './types/auth';
import {
  BossReportColorStatus,
  BossReportMonthData,
  BossReportRescheduledItem,
} from './types/bossReport';
import { ClientInvoice, ClientInvoiceInput } from './types/clientInvoice';
import { ClientPurchaseOrder, ClientPurchaseOrderInput } from './types/clientPO';
import {
  InvestmentAddendumFormSubmission,
  InvestmentAsset,
  InvestmentComponentKey,
  InvestmentInput,
  isInvestmentComponentPaidInSet,
} from './types/investment';
import { OpexInput, OpexItem, OpexPaymentStatus, OpexStatusWarna } from './types/opex';
import {
  ProjectionManualItem,
  ProjectionManualItemInput,
} from './types/projectionManualItem';
import {
  COMPANY_INFO,
  PaymentTermsMode,
  POStatus,
  PurchaseOrder,
  PurchaseOrderInput,
  VendorPphStatus,
  VendorPphType,
} from './types/po';
import {
  addMonthKeys,
  formatMonthShortID,
  StatusColorKey,
} from './types/statusWarna';
import {
  calculateDueDate,
  calculateVendorInvoiceTaxBreakdown,
  formatIDR,
  generateDefaultInvoiceNumber,
  getSuggestedPaymentTermsDays,
  getTodayISODate,
  getVendorPOEffectiveCostAmount,
  hasVendorInvoice,
} from './utils/format';
import {
  calculateClientInvoiceBreakdown,
  resolveClientInvoiceNominal,
} from './utils/clientInvoiceFormat';
import {
  BossReportComputedRow,
  computeBossReportViewModel,
} from './utils/bossReportCalc';
import { AccountBalanceView } from './components/AccountBalanceView';
import { ActivityLogView } from './components/ActivityLogView';
import { BalanceRealisasiView } from './components/BalanceRealisasiView';
import { CancelVendorPOTargetStatus } from './components/CancelVendorInvoiceModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { ClientInvoiceDocumentPreview } from './components/ClientInvoiceDocumentPreview';
import { ClientInvoiceFormView } from './components/ClientInvoiceFormView';
import { ClientInvoiceListView } from './components/ClientInvoiceListView';
import { ClientPOView } from './components/ClientPOView';
import { ClientReceivablesView } from './components/ClientReceivablesView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InvoicedPOView } from './components/InvoicedPOView';
import { InvestmentView } from './components/InvestmentView';
import { LoginView } from './components/LoginView';
import { OpexView } from './components/OpexView';
import { PODocumentPreview } from './components/PODocumentPreview';
import { POFormView } from './components/POFormView';
import { POListView } from './components/POListView';
import { ProjectVendorSummary } from './components/ProjectVendorSummary';
import { ProjectionReportView } from './components/ProjectionReportView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ReviseSubmitPayload } from './components/ReviseDocumentModal';
import { UserManagementView } from './components/UserManagementView';
import {
  buildProjectionColorChangePlan,
  ProjectionSourceSyncAction,
} from './utils/projectionStatusActions';

type ClientSubTab = 'client-po' | 'client-invoices' | 'receivables';
type VendorSubTab = 'po-vendor' | 'vendor-bills';

type SidebarMenuKey =
  | 'projection'
  | 'opex'
  | 'investment'
  | 'balance'
  | 'accounts'
  | 'project-client'
  | 'invoice'
  | 'project-vendor'
  | 'activity-logs'
  | 'user-management';

type POReturnTarget =
  | { type: 'projection' }
  | { type: 'project-vendor'; tab: VendorSubTab };

type ActiveView =
  | { type: 'projection' }
  | { type: 'balance' }
  | { type: 'accounts' }
  | { type: 'opex' }
  | { type: 'investment' }
  | { type: 'project-client'; tab: ClientSubTab }
  | { type: 'project-vendor'; tab: VendorSubTab }
  | {
      type: 'client-invoice-create';
      duplicateFrom?: ClientInvoice | null;
      prefillFromClientPO?: ClientPurchaseOrder | null;
      returnTab: ClientSubTab;
    }
  | {
      type: 'client-invoice-edit';
      invoiceId: string;
      invoiceSnapshot?: ClientInvoice | null;
      mode?: 'view' | 'edit';
      returnTab: ClientSubTab;
    }
  | {
      type: 'client-invoice-preview';
      invoiceId: string;
      autoPrint?: boolean;
      returnTab: ClientSubTab;
    }
  | { type: 'create'; duplicateFrom?: PurchaseOrder | null; returnTarget: POReturnTarget }
  | { type: 'edit'; poId: string; returnTarget: POReturnTarget }
  | { type: 'preview'; poId: string; returnTarget: POReturnTarget; autoPrint?: boolean }
  | { type: 'activity-logs' }
  | { type: 'user-management' };

function detectBossMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'bos') return true;
    return window.location.hash.includes('mode=bos');
  } catch {
    return false;
  }
}

function detectInitialBossTab(): 'projection' | 'balance' {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'balance') return 'balance';
    return window.location.hash.includes('tab=balance') ? 'balance' : 'projection';
  } catch {
    return 'projection';
  }
}

function detectInitialReportRange(): { startMonthKey: string; endMonthKey: string } {
  const todayMonth = getTodayISODate().slice(0, 7);
  try {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const toParam = params.get('to');
    const valid = (v: string | null): v is string =>
      Boolean(v && /^\d{4}-\d{2}$/.test(v));
    if (valid(fromParam) && valid(toParam)) {
      return fromParam <= toParam
        ? { startMonthKey: fromParam, endMonthKey: toParam }
        : { startMonthKey: toParam, endMonthKey: fromParam };
    }
    if (valid(fromParam)) {
      return { startMonthKey: fromParam, endMonthKey: fromParam };
    }
  } catch {
    // Abaikan error URLSearchParams
  }
  return { startMonthKey: todayMonth, endMonthKey: todayMonth };
}

function PurchaseOrderApp() {
  const isBossMode = useMemo(() => detectBossMode(), []);
  const [bossTab, setBossTab] = useState<'projection' | 'balance'>(() =>
    detectInitialBossTab()
  );

  // Mandatory Authentication & Per-Menu RBAC State
  const [authSession, setAuthSession] = useState<AuthenticatedSessionState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Business Data State
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [clientInvoices, setClientInvoices] = useState<ClientInvoice[]>([]);
  const [loadingClientInvoices, setLoadingClientInvoices] = useState(false);
  const [bossReportMonths, setBossReportMonths] = useState<
    Record<string, BossReportMonthData>
  >({});
  const [opexItems, setOpexItems] = useState<OpexItem[]>([]);
  const [investments, setInvestments] = useState<InvestmentAsset[]>([]);
  const [loadingInvestments, setLoadingInvestments] = useState(false);
  const [clientPOs, setClientPOs] = useState<ClientPurchaseOrder[]>([]);
  const [projectionManualItems, setProjectionManualItems] = useState<ProjectionManualItem[]>([]);
  const [dbErrorBanner, setDbErrorBanner] = useState<string | null>(null);
  const [partialFetchToast, setPartialFetchToast] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 1. projectionPeriod (Periode untuk menu Projection & Realisasi, terpisah dari investmentPeriod)
  const initialReportRange = useMemo(() => detectInitialReportRange(), []);
  const [startYear, setStartYear] = useState<string>(() =>
    initialReportRange.startMonthKey.slice(0, 4)
  );
  const [startMonth, setStartMonth] = useState<string>(() =>
    initialReportRange.startMonthKey.slice(5, 7).padStart(2, '0')
  );
  const [endYear, setEndYear] = useState<string>(() =>
    initialReportRange.endMonthKey.slice(0, 4)
  );
  const [endMonth, setEndMonth] = useState<string>(() =>
    initialReportRange.endMonthKey.slice(5, 7).padStart(2, '0')
  );
  const projectionPeriod = `${startYear}-${String(startMonth).padStart(2, '0')}`;
  const setProjectionPeriod = (nextMonthKey: string) => {
    const yr = nextMonthKey.slice(0, 4);
    const mo = String(nextMonthKey.slice(5, 7)).padStart(2, '0');
    setStartYear(yr);
    setStartMonth(mo);
    setEndYear(yr);
    setEndMonth(mo);
  };

  // 2. investmentPeriod (Khusus untuk menu Investment — independen dari projectionPeriod)
  const [investmentPeriod, setInvestmentPeriod] = useState<string>(() =>
    getTodayISODate().slice(0, 7)
  );
  const cutoffPeriod = investmentPeriod;
  const handleChangeStartPeriod = (nextMonth: string, nextYear: string) => {
    const cleanMonth = String(nextMonth).padStart(2, '0');
    const cleanYear = String(nextYear);
    const nextStartKey = `${cleanYear}-${cleanMonth}`;
    const currentEndKey = `${endYear}-${String(endMonth).padStart(2, '0')}`;
    setStartMonth(cleanMonth);
    setStartYear(cleanYear);
    if (nextStartKey > currentEndKey) {
      setEndMonth(cleanMonth);
      setEndYear(cleanYear);
    }
  };
  const handleChangeEndPeriod = (nextMonth: string, nextYear: string) => {
    const cleanMonth = String(nextMonth).padStart(2, '0');
    const cleanYear = String(nextYear);
    const nextEndKey = `${cleanYear}-${cleanMonth}`;
    const currentStartKey = `${startYear}-${String(startMonth).padStart(2, '0')}`;
    setEndMonth(cleanMonth);
    setEndYear(cleanYear);
    if (nextEndKey < currentStartKey) {
      setStartMonth(cleanMonth);
      setStartYear(cleanYear);
    }
  };
  const handleChangePeriodRange = (nextStartMk: string, nextEndMk: string) => {
    const [sy = '2026', sm = '01'] = nextStartMk.split('-');
    const [ey = '2026', em = '01'] = nextEndMk.split('-');
    const cleanStartMonth = sm.padStart(2, '0');
    const cleanEndMonth = em.padStart(2, '0');
    const safeStart = `${sy}-${cleanStartMonth}`;
    const safeEnd = `${ey}-${cleanEndMonth}`;
    setStartYear(sy);
    setStartMonth(cleanStartMonth);
    if (safeEnd < safeStart) {
      setEndYear(sy);
      setEndMonth(cleanStartMonth);
    } else {
      setEndYear(ey);
      setEndMonth(cleanEndMonth);
    }
  };

  useEffect(() => {
    if (!partialFetchToast) return;
    const timer = window.setTimeout(() => {
      setPartialFetchToast(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [partialFetchToast]);

  useEffect(() => {
    if (!actionToast) return;
    const timer = window.setTimeout(() => {
      setActionToast(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

  const handleLoadRangeData = useCallback(
    async (rawStartMk: string, rawEndMk: string) => {
      if (!isSupabaseConfigured) return;
      const startMatch = /^(\d{4})-(\d{1,2})/.exec(rawStartMk);
      const endMatch = /^(\d{4})-(\d{1,2})/.exec(rawEndMk);
      if (!startMatch || !endMatch) return;
      const safeStart = `${startMatch[1]}-${startMatch[2].padStart(2, '0')}`;
      const safeEnd = `${endMatch[1]}-${endMatch[2].padStart(2, '0')}`;
      if (safeEnd < safeStart) return;

      const [sy, sm] = safeStart.split('-').map(Number);
      const [ey, em] = safeEnd.split('-').map(Number);
      const spanMonths = (ey - sy) * 12 + (em - sm) + 1;
      if (spanMonths > 12) return;

      let anyFailed = false;

      try {
        await refreshOpexRangeFromSupabase(safeStart, safeEnd);
      } catch (err) {
        console.warn('[RangeFetch][Opex] Gagal memuat Opex:', err);
        anyFailed = true;
      }

      try {
        await refreshInvestmentsRangeFromSupabase(safeStart, safeEnd);
      } catch (err) {
        console.warn('[RangeFetch][Investment] Gagal memuat Investment:', err);
        anyFailed = true;
      }

      try {
        await refreshPurchaseOrdersRangeFromSupabase(safeStart, safeEnd);
      } catch (err) {
        console.warn('[RangeFetch][ProjectCost] Gagal memuat Project Cost:', err);
        anyFailed = true;
      }

      try {
        await refreshClientInvoicesRangeFromSupabase(safeStart, safeEnd);
      } catch (err) {
        console.warn('[RangeFetch][CashIn] Gagal memuat Cash In:', err);
        anyFailed = true;
      }

      try {
        await refreshBossReportMonthsRangeFromSupabase(safeStart, safeEnd);
      } catch (err) {
        console.warn('[RangeFetch][BossReport] Gagal memuat ringkasan bulan:', err);
        anyFailed = true;
      }

      try {
        await refreshProjectionManualItemsRangeFromSupabase(safeStart, safeEnd);
      } catch (err) {
        console.warn(
          '[RangeFetch][ProjectionManual] Gagal memuat item manual Projection:',
          err
        );
        anyFailed = true;
      }

      if (anyFailed) {
        setPartialFetchToast('Sebagian data gagal dimuat, coba refresh');
      }
    },
    []
  );

  // Default Landing Page = Projection
  const [view, setView] = useState<ActiveView>({ type: 'projection' });
  const [editingClientInvoiceId, setEditingClientInvoiceId] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Restore Supabase Auth session from localStorage & listen for auth events
  useEffect(() => {
    let active = true;

    const initSession = async () => {
      try {
        const restored = await restoreSavedSession();
        if (active) {
          setAuthSession(restored);
        }
      } catch {
        if (active) {
          setAuthSession(null);
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };

    void initSession();

    const client = supabase;
    if (!client) {
      return () => {
        active = false;
      };
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
        return;
      }

      if (event === 'SIGNED_OUT') {
        setAuthSession(null);
        setIsPasswordRecovery(false);
        return;
      }

      if (
        (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
        session?.user
      ) {
        void loadAuthenticatedProfile(session.user)
          .then((profile) => {
            if (active) setAuthSession(profile);
          })
          .catch(() => {
            void signOutCurrentUser();
            if (active) setAuthSession(null);
          });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const isSuperAdmin = Boolean(
    authSession && authSession.isSuperAdmin && isSuperAdminEmail(authSession.user.email)
  );

  const menuPermissions: AppMenuPermissionsMap = useMemo(
    () => authSession?.permissions ?? buildDefaultViewOnlyMenuPermissions(),
    [authSession]
  );

  const canViewMenu = useCallback(
    (key: AppMenuKey): boolean => {
      if (!authSession) return false;
      if (authSession.isSuperAdmin) return true;
      return Boolean(menuPermissions[key]?.canView);
    },
    [authSession, menuPermissions]
  );

  const canEditMenu = useCallback(
    (key: AppMenuKey): boolean => {
      if (!authSession) return false;
      if (authSession.isSuperAdmin) return true;
      return Boolean(menuPermissions[key]?.canView && menuPermissions[key]?.canEdit);
    },
    [authSession, menuPermissions]
  );

  const currentActor: AuditActor = useMemo(() => {
    if (!authSession) return DEFAULT_SYSTEM_ACTOR;
    const roleLabel =
      authSession.user.role === 'super_admin'
        ? 'Super Admin'
        : authSession.user.role === 'admin'
        ? 'Admin'
        : authSession.user.role === 'finance'
        ? 'Finance'
        : 'Staff';
    return {
      uid: authSession.user.id,
      name: authSession.user.nama || authSession.user.email,
      email: authSession.user.email,
      roleId: authSession.user.role,
      roleName: roleLabel,
    };
  }, [authSession]);

  const clientInvoicePermissions = useMemo(
    () => deriveClientInvoicePermissions(menuPermissions, Boolean(authSession?.isSuperAdmin)),
    [menuPermissions, authSession?.isSuperAdmin]
  );

  const vendorPermissions = useMemo(
    () => deriveVendorPermissions(menuPermissions, Boolean(authSession?.isSuperAdmin)),
    [menuPermissions, authSession?.isSuperAdmin]
  );

  const isViewAllowed = useCallback(
    (targetView: ActiveView): boolean => {
      if (!authSession) return false;
      switch (targetView.type) {
        case 'projection':
          return canViewMenu('dashboard');
        case 'balance':
          return canViewMenu('realisasi');
        case 'accounts':
          return canViewMenu('saldo_rekening');
        case 'opex':
          return canViewMenu('opex');
        case 'investment':
          return canViewMenu('investment');
        case 'activity-logs':
          return canViewMenu('log_aktivitas');
        case 'user-management':
          return Boolean(authSession.isSuperAdmin && isSuperAdminEmail(authSession.user.email));
        case 'project-client':
          return targetView.tab === 'client-invoices'
            ? canViewMenu('invoice')
            : canViewMenu('project_client');
        case 'client-invoice-create':
          return canEditMenu('invoice');
        case 'client-invoice-edit':
          return targetView.mode === 'view'
            ? canViewMenu('invoice') || canViewMenu('project_client')
            : canEditMenu('invoice');
        case 'client-invoice-preview':
          return canViewMenu('invoice') || canViewMenu('dashboard') || canViewMenu('project_client');
        case 'project-vendor':
          return canViewMenu('project_vendor');
        case 'create':
        case 'edit':
          return canEditMenu('project_vendor');
        case 'preview':
          return canViewMenu('project_vendor') || canViewMenu('dashboard');
      }
    },
    [authSession, canEditMenu, canViewMenu]
  );

  const firstAllowedView = useMemo<ActiveView | null>(() => {
    if (!authSession) return null;
    if (canViewMenu('dashboard')) return { type: 'projection' };
    if (canViewMenu('opex')) return { type: 'opex' };
    if (canViewMenu('investment')) return { type: 'investment' };
    if (canViewMenu('realisasi')) return { type: 'balance' };
    if (canViewMenu('saldo_rekening')) return { type: 'accounts' };
    if (canViewMenu('project_client')) return { type: 'project-client', tab: 'client-po' };
    if (canViewMenu('invoice')) return { type: 'project-client', tab: 'client-invoices' };
    if (canViewMenu('project_vendor')) return { type: 'project-vendor', tab: 'po-vendor' };
    if (canViewMenu('log_aktivitas')) return { type: 'activity-logs' };
    if (isSuperAdmin) return { type: 'user-management' };
    return null;
  }, [authSession, canViewMenu, isSuperAdmin]);

  // Redirect whenever the active view is not permitted by the user's RBAC permissions
  useEffect(() => {
    if (!authSession || isPasswordRecovery) return;
    if (!isViewAllowed(view) && firstAllowedView) {
      setView(firstAllowedView);
    }
  }, [authSession, isPasswordRecovery, view, isViewAllowed, firstAllowedView]);

  const handleRefreshCurrentProfile = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    const { data } = await client.auth.getUser();
    if (data.user) {
      const updated = await loadAuthenticatedProfile(data.user);
      setAuthSession(updated);
    }
  }, []);

  // Presence Heartbeat (langsung saat buka app + setiap 30 detik) & Tab Close Offline Beacon
  useEffect(() => {
    const userId = authSession?.user.id;
    const userEmail = authSession?.user.email;
    if (!userId || !isSupabaseConfigured) return;

    let latestToken: string | null = null;
    const syncToken = () => {
      if (!supabase) return;
      void supabase.auth.getSession().then(({ data }) => {
        latestToken = data.session?.access_token ?? null;
      });
    };
    syncToken();

    // Langsung update last_seen_at = NOW(), is_online = true saat app dibuka / login
    void updateUserPresence(userId, true, { email: userEmail });

    const heartbeatTimer = window.setInterval(() => {
      syncToken();
      void updateUserPresence(userId, true, { email: userEmail });
    }, 30_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncToken();
        void updateUserPresence(userId, true, { email: userEmail });
      }
    };

    const handleTabClose = () => {
      sendPresenceOfflineBeacon(userId, latestToken);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleTabClose);
    window.addEventListener('beforeunload', handleTabClose);

    return () => {
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleTabClose);
      window.removeEventListener('beforeunload', handleTabClose);
    };
  }, [authSession?.user.id, authSession?.user.email]);

  const handleLogout = useCallback(async () => {
    const userId = authSession?.user.id;
    const userEmail = authSession?.user.email;
    if (authSession) {
      void logAuditActivity(currentActor, {
        action: 'LOGOUT',
        entityType: 'AUTH',
        entityId: authSession.user.id,
        entityLabel: authSession.user.email,
        summary: `Logout user ${authSession.user.nama} (${authSession.user.email})`,
      });
    }
    await signOutCurrentUser(userId, userEmail);
    setAuthSession(null);
    setIsPasswordRecovery(false);
    setMobileSidebarOpen(false);
  }, [authSession, currentActor]);

  // Subscribe to all operational collections ONLY after user is authenticated
  useEffect(() => {
    if (!authSession) {
      setOrders([]);
      setClientInvoices([]);
      setBossReportMonths({});
      setOpexItems([]);
      setInvestments([]);
      setClientPOs([]);
      setProjectionManualItems([]);
      setAuditLogs([]);
      setLoadingOrders(false);
      setLoadingClientInvoices(false);
      setLoadingInvestments(false);
      return;
    }

    const unsubscribePOs = subscribePurchaseOrders(
      (list) => {
        setOrders(list);
        setLoadingOrders(false);
      },
      () => {
        setLoadingOrders(false);
      },
      { readOnly: isBossMode || !canEditMenu('project_vendor') }
    );

    setLoadingClientInvoices(true);
    const unsubscribeClientInvoices = subscribeClientInvoices(
      (list) => {
        setClientInvoices(list);
        setLoadingClientInvoices(false);
      },
      (err) => {
        setLoadingClientInvoices(false);
        if (err && isSupabaseConfigured) {
          setPartialFetchToast('Sebagian data gagal dimuat, coba refresh');
        }
      },
      { readOnly: isBossMode || !canEditMenu('invoice') }
    );

    const unsubscribeBossReport = subscribeBossReportMonths(
      (monthsMap) => {
        setBossReportMonths(monthsMap);
      },
      {
        readOnly: isBossMode || !canEditMenu('dashboard'),
        onError: () => {
          if (isSupabaseConfigured) {
            setPartialFetchToast('Sebagian data gagal dimuat, coba refresh');
          }
        },
      }
    );

    const unsubscribeOpex = subscribeOpexItems(
      (list) => {
        setOpexItems(list);
      },
      { readOnly: isBossMode || !canEditMenu('opex') }
    );

    setLoadingInvestments(true);
    const unsubscribeInvestments = subscribeInvestments(
      (list) => {
        setInvestments(list);
        setLoadingInvestments(false);
      },
      {
        readOnly: isBossMode || !canEditMenu('investment'),
        onError: () => {
          setLoadingInvestments(false);
        },
      }
    );

    const unsubscribeClientPOs = subscribeClientPOs(
      (list) => {
        setClientPOs(list);
      },
      { readOnly: isBossMode || !canEditMenu('project_client') }
    );

    const unsubscribeProjectionManual = subscribeProjectionManualItems((list) => {
      setProjectionManualItems(list);
    });

    const unsubscribeLogs = subscribeAuditLogs((list) => {
      setAuditLogs(list);
    });

    const unsubscribeDbErrors = subscribeDatabaseErrors((message) => {
      setDbErrorBanner(message);
    });

    return () => {
      unsubscribePOs();
      unsubscribeClientInvoices();
      unsubscribeBossReport();
      unsubscribeOpex();
      unsubscribeInvestments();
      unsubscribeClientPOs();
      unsubscribeProjectionManual();
      unsubscribeLogs();
      unsubscribeDbErrors();
    };
  }, [authSession?.user.id, isBossMode, canEditMenu]);

  const currentMenu: SidebarMenuKey = (() => {
    if (view.type === 'projection') return 'projection';
    if (view.type === 'balance') return 'balance';
    if (view.type === 'accounts') return 'accounts';
    if (view.type === 'opex') return 'opex';
    if (view.type === 'investment') return 'investment';
    if (view.type === 'activity-logs') return 'activity-logs';
    if (view.type === 'user-management') return 'user-management';
    if (
      (view.type === 'project-client' && view.tab === 'client-invoices') ||
      view.type === 'client-invoice-create' ||
      view.type === 'client-invoice-edit' ||
      view.type === 'client-invoice-preview'
    ) {
      return 'invoice';
    }
    if (view.type === 'project-client') {
      return 'project-client';
    }
    if (view.type === 'project-vendor') return 'project-vendor';
    if (view.type === 'create' || view.type === 'edit' || view.type === 'preview') {
      return view.returnTarget.type === 'projection' ? 'projection' : 'project-vendor';
    }
    return 'projection';
  })();

  // ==================== MUTATION HANDLERS + AUDIT LOGGING ====================

  const handleSavePO = async (
    input: PurchaseOrderInput,
    openPreviewAfter: boolean,
    existingId?: string
  ) => {
    const total = input.items.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0
    );

    let targetId = existingId;
    if (existingId) {
      await updatePurchaseOrder(existingId, input);
      void logAuditActivity(currentActor, {
        action: 'EDIT_PO',
        entityType: 'PO',
        entityId: existingId,
        entityLabel: input.poNumber,
        amount: total,
        summary: `${currentActor.name} mengedit PO Vendor ${input.poNumber} untuk ${input.vendorName} sebesar Rp ${formatIDR(total)}`,
      });
    } else {
      targetId = await createPurchaseOrder(input);
      void logAuditActivity(currentActor, {
        action: 'CREATE_PO',
        entityType: 'PO',
        entityId: targetId,
        entityLabel: input.poNumber,
        amount: total,
        summary: `${currentActor.name} membuat PO Vendor ${input.poNumber} untuk ${input.vendorName} sebesar Rp ${formatIDR(total)}`,
      });
    }

    const fallbackReturn: POReturnTarget =
      view.type === 'edit' || view.type === 'create'
        ? view.returnTarget
        : { type: 'project-vendor', tab: 'po-vendor' };

    if (openPreviewAfter && targetId) {
      setView({ type: 'preview', poId: targetId, returnTarget: fallbackReturn });
    } else {
      setView(fallbackReturn);
    }
  };

  const handleStatusChange = async (
    poId: string,
    status: POStatus,
    invoiceMeta?: {
      invoiceDate?: string;
      invoiceNumber?: string;
      invoiceFileUrl?: string;
      invoiceFileName?: string;
      localAttachmentDataUrl?: string;
      paymentTermsMode?: PaymentTermsMode;
      paymentTermsDays?: number;
      manualDueDateNote?: string;
      dueDate?: string;
      dppAmount?: number;
      ppnRate?: number;
      ppnAmount?: number;
      grossAmount?: number;
      pphType?: VendorPphType;
      pphRate?: number;
      pphAmount?: number;
      pphStatus?: VendorPphStatus;
      pphDate?: string;
      netAkhir?: number;
    }
  ) => {
    setUpdatingStatus(true);
    try {
      const targetPO = orders.find((item) => item.id === poId);
      let resolvedMeta = invoiceMeta;
      if (status === 'Invoiced' && !resolvedMeta && targetPO) {
        const invDate = targetPO.invoiceDate || getTodayISODate();
        if (targetPO.paymentTermsMode === 'MANUAL' && targetPO.dueDate) {
          resolvedMeta = {
            invoiceDate: invDate,
            invoiceNumber:
              targetPO.invoiceNumber || generateDefaultInvoiceNumber(targetPO.poNumber, orders),
            paymentTermsMode: 'MANUAL',
            manualDueDateNote: targetPO.manualDueDateNote ?? '',
            dueDate: targetPO.dueDate,
          };
        } else {
          const termsDays =
            typeof targetPO.paymentTermsDays === 'number'
              ? targetPO.paymentTermsDays
              : getSuggestedPaymentTermsDays(targetPO.totalAmount);
          resolvedMeta = {
            invoiceDate: invDate,
            invoiceNumber:
              targetPO.invoiceNumber || generateDefaultInvoiceNumber(targetPO.poNumber, orders),
            paymentTermsMode: 'NET',
            paymentTermsDays: termsDays,
            manualDueDateNote: '',
            dueDate: calculateDueDate(invDate, termsDays),
          };
        }
      }
      await updatePurchaseOrderStatus(poId, status, resolvedMeta);
      if (
        status === 'Paid' &&
        targetPO &&
        (targetPO.status === 'Reschedule' || Boolean(targetPO.rescheduledToMonth))
      ) {
        const resolvedOrigin =
          targetPO.rescheduledFromMonth ||
          (targetPO.dueDate || targetPO.invoiceDate || targetPO.poDate || getTodayISODate()).slice(
            0,
            7
          );
        await syncSourceChangeToBossReportMonths({
          sourceIds: [`po_${poId}`],
          clearAutoOverrides: true,
          scopeOriginMonthKey: resolvedOrigin,
        });
      }

      if (targetPO) {
        const effectiveAmt =
          resolvedMeta?.netAkhir !== undefined
            ? resolvedMeta.pphType &&
              resolvedMeta.pphType !== 'NONE' &&
              (resolvedMeta.pphAmount ?? 0) > 0 &&
              resolvedMeta.pphStatus === 'Belum Disubmit'
              ? resolvedMeta.grossAmount ?? resolvedMeta.netAkhir
              : resolvedMeta.netAkhir
            : getVendorPOEffectiveCostAmount(targetPO);
        if (status === 'Invoiced') {
          void logAuditActivity(currentActor, {
            action: 'MARK_INVOICED',
            entityType: 'PO',
            entityId: poId,
            entityLabel: targetPO.poNumber,
            amount: effectiveAmt,
            summary: `${currentActor.name} menginput Invoice Vendor ${
              resolvedMeta?.invoiceNumber || targetPO.invoiceNumber || '-'
            } untuk PO ${targetPO.poNumber} (${targetPO.vendorName}) sebesar Rp ${formatIDR(effectiveAmt)}`,
          });
        } else if (status === 'Paid') {
          void logAuditActivity(currentActor, {
            action: 'MARK_PAID_PO',
            entityType: 'PO',
            entityId: poId,
            entityLabel: targetPO.poNumber,
            amount: effectiveAmt,
            summary: `${currentActor.name} melunasi PO Vendor ${targetPO.poNumber} — ${targetPO.vendorName} sebesar Rp ${formatIDR(effectiveAmt)}`,
          });
        } else {
          void logAuditActivity(currentActor, {
            action: 'UPDATE_PO_STATUS',
            entityType: 'PO',
            entityId: poId,
            entityLabel: targetPO.poNumber,
            amount: effectiveAmt,
            summary: `${currentActor.name} mengubah status PO ${targetPO.poNumber} (${targetPO.vendorName}) menjadi ${status}`,
          });
        }
      }
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSubmitVendorPOPph = async (
    poId: string,
    params: { pphType: VendorPphType; pphRate: number; pphDate: string }
  ) => {
    setUpdatingStatus(true);
    try {
      const targetPO = orders.find((o) => o.id === poId);
      await submitPurchaseOrderPph(poId, params);
      if (targetPO) {
        const dpp =
          Math.max(0, Math.round(Number(targetPO.dppAmount) || 0)) ||
          Math.max(0, Math.round(Number(targetPO.totalAmount) || 0));
        const ppnRate = Math.max(0, Math.min(100, Number(targetPO.ppnRate) || 0));
        const tax = calculateVendorInvoiceTaxBreakdown({
          dpp,
          ppnRate,
          pphType: params.pphType,
          pphRate: params.pphRate,
        });
        void logAuditActivity(currentActor, {
          action: 'SUBMIT_PPH_PO',
          entityType: 'PO',
          entityId: poId,
          entityLabel: targetPO.poNumber,
          amount: tax.netAkhir,
          summary: `${currentActor.name} melakukan Submit ${params.pphType} (${params.pphRate}%) untuk ${targetPO.poNumber} — ${targetPO.vendorName} (PPh Rp ${formatIDR(tax.pphAmount)} · NET Rp ${formatIDR(tax.netAkhir)})`,
        });
      }
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleCancelPOInvoice = async (
    poId: string,
    params: { targetStatus: 'Draft' | 'Sent'; reason: string }
  ) => {
    const targetPO = orders.find((o) => o.id === poId);
    const stUpper = String(targetPO?.status ?? '')
      .trim()
      .toUpperCase();
    if (stUpper === 'PAID' || stUpper === 'LUNAS') {
      setActionToast({
        type: 'error',
        message: 'PO sudah lunas, batalkan pembayaran dulu',
      });
      return;
    }

    setUpdatingStatus(true);
    try {
      const result = await cancelPurchaseOrderInvoice(poId, params);
      if (targetPO && (targetPO.status === 'Reschedule' || Boolean(targetPO.rescheduledToMonth))) {
        await syncSourceChangeToBossReportMonths({
          sourceIds: [`po_${poId}`],
          clearAutoOverrides: true,
        });
      }
      const targetLabel = result.targetStatus === 'Sent' ? 'SENT' : 'DRAFT';
      void logAuditActivity(currentActor, {
        action: 'CANCEL_PO_INVOICE',
        entityType: 'PO',
        entityId: poId,
        entityLabel: result.poNumber,
        amount: result.cancelledAmount,
        summary: `Tagihan PO ${result.poNumber} dibatalkan ke ${targetLabel} oleh ${currentActor.name} - Alasan: ${params.reason.trim()}`,
      });
      setActionToast({
        type: 'success',
        message: `Tagihan berhasil dibatalkan, PO kembali ke ${targetLabel}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membatalkan tagihan PO.';
      setActionToast({
        type: 'error',
        message: msg,
      });
      throw err;
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleCancelPOPaid = async (
    poId: string,
    params: { targetStatus: CancelVendorPOTargetStatus; reason: string }
  ) => {
    setUpdatingStatus(true);
    try {
      const result = await cancelPurchaseOrderPaid(poId, params);
      await syncSourceChangeToBossReportMonths({
        sourceIds: [`po_${poId}`],
        clearAutoOverrides: true,
      });
      const targetLabel =
        result.targetStatus === 'Sent'
          ? 'SENT'
          : result.targetStatus === 'Invoiced'
          ? 'SUDAH DITAGIH'
          : 'DRAFT';
      void logAuditActivity(currentActor, {
        action: 'CANCEL_PO_PAID',
        entityType: 'PO',
        entityId: poId,
        entityLabel: result.poNumber,
        amount: result.cancelledAmount,
        summary: `Pembayaran & Tagihan PO ${result.poNumber} dibatalkan (Batalkan Lunas) ke ${targetLabel} oleh ${currentActor.name} - Alasan: ${params.reason.trim()}`,
      });
      setActionToast({
        type: 'success',
        message: `Lunas berhasil dibatalkan, PO kembali ke ${targetLabel}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membatalkan status Lunas PO.';
      setActionToast({
        type: 'error',
        message: msg,
      });
      throw err;
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDeleteSelectedAuditLogs = async (ids: string[]) => {
    if (!isSuperAdmin) return;
    try {
      const count = await deleteSelectedAuditLogs(ids);
      setActionToast({
        type: 'success',
        message: `${count} log aktivitas terpilih berhasil dihapus`,
      });
    } catch (err) {
      setActionToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal menghapus log terpilih.',
      });
      throw err;
    }
  };

  const handleDeleteAllAuditLogs = async (reason: string) => {
    if (!isSuperAdmin) return;
    try {
      await deleteAllAuditLogs(currentActor, reason);
      setActionToast({
        type: 'success',
        message: `Semua log lama dihapus oleh ${currentActor.name}`,
      });
    } catch (err) {
      setActionToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal menghapus semua log.',
      });
      throw err;
    }
  };

  const handleSoftDeletePO = async (poId: string, reason?: string) => {
    const targetPO = orders.find((o) => o.id === poId);
    const poAmount = targetPO ? getVendorPOEffectiveCostAmount(targetPO) : 0;
    await softDeletePurchaseOrder(poId, currentActor, reason);
    void logAuditActivity(currentActor, {
      action: 'SOFT_DELETE_PO',
      entityType: 'PO',
      entityId: poId,
      entityLabel: targetPO?.poNumber ?? poId,
      amount: poAmount,
      summary: `${currentActor.name} menghapus PO ${targetPO?.poNumber ?? poId} (${
        targetPO?.vendorName ?? '-'
      })${poAmount > 0 ? ` sebesar Rp ${formatIDR(poAmount)}` : ''}${
        reason ? ` · Alasan: ${reason}` : ''
      }`,
    });
    if (view.type === 'preview' && view.poId === poId) {
      setView(view.returnTarget);
    }
  };

  const handleRestorePO = async (poId: string) => {
    const targetPO = orders.find((o) => o.id === poId);
    const poAmount = targetPO ? getVendorPOEffectiveCostAmount(targetPO) : 0;
    await restorePurchaseOrder(poId);
    void logAuditActivity(currentActor, {
      action: 'RESTORE_PO',
      entityType: 'PO',
      entityId: poId,
      entityLabel: targetPO?.poNumber ?? poId,
      amount: poAmount,
      summary: `${currentActor.name} memulihkan PO ${targetPO?.poNumber ?? poId} dari Riwayat Hapus`,
    });
  };

  const handlePermanentDeletePO = async (poId: string) => {
    const targetPO = orders.find((o) => o.id === poId);
    const poAmount = targetPO ? getVendorPOEffectiveCostAmount(targetPO) : 0;
    await deletePurchaseOrder(poId);
    void logAuditActivity(currentActor, {
      action: 'PERMANENT_DELETE_PO',
      entityType: 'PO',
      entityId: poId,
      entityLabel: targetPO?.poNumber ?? poId,
      amount: poAmount,
      summary: `${currentActor.name} menghapus permanen PO ${targetPO?.poNumber ?? poId} — ${
        targetPO?.vendorName ?? '-'
      } (Rp ${formatIDR(poAmount)})`,
    });
    if (view.type === 'preview' && view.poId === poId) {
      setView(view.returnTarget);
    }
  };

  const handleEdit = (
    invoice: ClientInvoice,
    targetMode: 'view' | 'edit' = 'edit',
    returnTab: ClientSubTab = 'client-invoices'
  ) => {
    console.log('handleEdit (client_invoices):', invoice);
    const raw = invoice as unknown as Record<string, unknown>;
    const resolvedId = String(invoice?.id ?? raw?._id ?? '').trim();
    setEditingClientInvoiceId(resolvedId || null);
    setView({
      type: 'client-invoice-edit',
      invoiceId: resolvedId,
      invoiceSnapshot: invoice,
      mode: targetMode,
      returnTab,
    });

    if (resolvedId) {
      void getClientInvoiceById(resolvedId)
        .then((fresh) => {
          if (!fresh) return;
          setClientInvoices((prev) =>
            prev.some((item) => item.id === fresh.id)
              ? prev.map((item) => (item.id === fresh.id ? fresh : item))
              : [fresh, ...prev]
          );
          setView((prevView) =>
            prevView.type === 'client-invoice-edit' && prevView.invoiceId === resolvedId
              ? { ...prevView, invoiceSnapshot: fresh }
              : prevView
          );
        })
        .catch((err) => {
          console.error('Gagal mengambil detail client_invoices saat Edit:', err);
        });
    }
  };

  const handleSaveClientInvoice = async (
    input: ClientInvoiceInput,
    openPreviewAfter: boolean,
    existingId?: string
  ) => {
    const total = resolveClientInvoiceNominal(input);
    const resolvedExistingId =
      existingId ||
      (view.type === 'client-invoice-edit'
        ? editingClientInvoiceId ?? view.invoiceId
        : undefined);

    if (view.type === 'client-invoice-edit' && !resolvedExistingId) {
      throw new Error('ID Invoice Client tidak ditemukan saat menyimpan perubahan.');
    }

    let targetId = resolvedExistingId;
    if (resolvedExistingId) {
      await updateClientInvoice(resolvedExistingId, input);
      void logAuditActivity(currentActor, {
        action: 'EDIT_CLIENT_INV',
        entityType: 'CLIENT_INVOICE',
        entityId: resolvedExistingId,
        entityLabel: input.invoiceNumber,
        amount: total,
        summary: `${currentActor.name} mengedit Invoice Client ${input.invoiceNumber} — ${input.clientName} sebesar Rp ${formatIDR(total)}`,
      });
    } else {
      targetId = await createClientInvoice(input);
      void logAuditActivity(currentActor, {
        action: 'CREATE_CLIENT_INV',
        entityType: 'CLIENT_INVOICE',
        entityId: targetId,
        entityLabel: input.invoiceNumber,
        amount: total,
        summary: `${currentActor.name} membuat Invoice Client ${input.invoiceNumber} — ${input.clientName} sebesar Rp ${formatIDR(total)}`,
      });
    }

    setEditingClientInvoiceId(null);

    const returnTab: ClientSubTab =
      view.type === 'client-invoice-create' || view.type === 'client-invoice-edit'
        ? view.returnTab
        : 'client-invoices';

    if (openPreviewAfter && targetId) {
      setView({
        type: 'client-invoice-preview',
        invoiceId: targetId,
        returnTab: 'client-invoices',
      });
    } else {
      setView({ type: 'project-client', tab: returnTab });
    }
  };

  const handleMarkClientInvoicePaid = async (invoiceId: string, paidDate: string) => {
    const inv = clientInvoices.find((i) => i.id === invoiceId);
    const invNominal = inv ? resolveClientInvoiceNominal(inv) : 0;
    await markClientInvoicePaid(invoiceId, paidDate);
    if (inv && (inv.status === 'Reschedule' || Boolean(inv.rescheduledToMonth))) {
      const resolvedOrigin =
        inv.rescheduledFromMonth ||
        (inv.dueDate || inv.invoiceDate || getTodayISODate()).slice(0, 7);
      await syncSourceChangeToBossReportMonths({
        sourceIds: [`ci_${invoiceId}`],
        clearAutoOverrides: true,
        scopeOriginMonthKey: resolvedOrigin,
      });
    }
    void logAuditActivity(currentActor, {
      action: 'MARK_PAID_CLIENT_INV',
      entityType: 'CLIENT_INVOICE',
      entityId: invoiceId,
      entityLabel: inv?.invoiceNumber ?? invoiceId,
      amount: invNominal,
      summary: `${currentActor.name} melunasi Invoice Client ${inv?.invoiceNumber ?? invoiceId} (${
        inv?.clientName ?? '-'
      }) sebesar Rp ${formatIDR(invNominal)}`,
    });
  };

  const handleSendClientInvoice = async (
    invoiceId: string,
    params: {
      sentDate: string;
      dueDate: string;
      paymentTermsMode: PaymentTermsMode;
      paymentTermsDays?: number;
      manualDueDateNote?: string;
    }
  ) => {
    const inv = clientInvoices.find((i) => i.id === invoiceId);
    const invNominal = inv ? resolveClientInvoiceNominal(inv) : 0;
    await sendClientInvoice(invoiceId, params);
    void logAuditActivity(currentActor, {
      action: 'SEND_CLIENT_INV',
      entityType: 'CLIENT_INVOICE',
      entityId: invoiceId,
      entityLabel: inv?.invoiceNumber ?? invoiceId,
      amount: invNominal,
      summary: `${currentActor.name} mengirim Invoice Client ${inv?.invoiceNumber ?? invoiceId} ke ${
        inv?.clientName ?? '-'
      } sebesar Rp ${formatIDR(invNominal)} (Tgl Kirim: ${params.sentDate} · JT: ${params.dueDate})`,
    });
  };

  const handleSoftDeleteClientInvoice = async (invoiceId: string, reason?: string) => {
    const inv = clientInvoices.find((i) => i.id === invoiceId);
    const invNominal = inv ? resolveClientInvoiceNominal(inv) : 0;
    await softDeleteClientInvoice(invoiceId, currentActor, reason);
    void logAuditActivity(currentActor, {
      action: 'SOFT_DELETE_CLIENT_INV',
      entityType: 'CLIENT_INVOICE',
      entityId: invoiceId,
      entityLabel: inv?.invoiceNumber ?? invoiceId,
      amount: invNominal,
      summary: `${currentActor.name} menghapus Invoice Client ${inv?.invoiceNumber ?? invoiceId} (${
        inv?.clientName ?? '-'
      })${invNominal > 0 ? ` sebesar Rp ${formatIDR(invNominal)}` : ''}${
        reason ? ` · Alasan: ${reason}` : ''
      }`,
    });
  };

  const handleRestoreClientInvoice = async (invoiceId: string) => {
    const inv = clientInvoices.find((i) => i.id === invoiceId);
    const invNominal = inv ? resolveClientInvoiceNominal(inv) : 0;
    await restoreClientInvoice(invoiceId);
    void logAuditActivity(currentActor, {
      action: 'RESTORE_CLIENT_INV',
      entityType: 'CLIENT_INVOICE',
      entityId: invoiceId,
      entityLabel: inv?.invoiceNumber ?? invoiceId,
      amount: invNominal,
      summary: `${currentActor.name} memulihkan Invoice Client ${inv?.invoiceNumber ?? invoiceId} dari Riwayat Hapus`,
    });
  };

  const handlePermanentDeleteClientInvoice = async (invoiceId: string) => {
    const inv = clientInvoices.find((i) => i.id === invoiceId);
    const invNominal = inv ? resolveClientInvoiceNominal(inv) : 0;
    await deleteClientInvoice(invoiceId);
    void logAuditActivity(currentActor, {
      action: 'PERMANENT_DELETE_CLIENT_INV',
      entityType: 'CLIENT_INVOICE',
      entityId: invoiceId,
      entityLabel: inv?.invoiceNumber ?? invoiceId,
      amount: invNominal,
      summary: `${currentActor.name} menghapus permanen Invoice Client ${inv?.invoiceNumber ?? invoiceId} — ${
        inv?.clientName ?? '-'
      } (Rp ${formatIDR(invNominal)})`,
    });
  };

  const handleRevisePO = async (po: PurchaseOrder, payload: ReviseSubmitPayload) => {
    const newTotal = payload.newItems.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0
    );
    const oldCost = getVendorPOEffectiveCostAmount(po);

    setUpdatingStatus(true);
    try {
      await revisePurchaseOrder(
        po.id,
        {
          ...payload,
          paymentTermsMode: po.paymentTermsMode,
          paymentTermsDays: po.paymentTermsDays,
          manualDueDateNote: po.manualDueDateNote,
        },
        po
      );
      void logAuditActivity(currentActor, {
        action: 'REVISE_PO',
        entityType: 'PO',
        entityId: po.id,
        entityLabel: po.poNumber,
        amount: newTotal,
        summary: `${currentActor.name} merevisi PO ${po.poNumber} (${po.vendorName}) · Rp ${formatIDR(
          oldCost
        )} → Rp ${formatIDR(newTotal)} · Alasan: ${payload.reason}`,
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleReviseClientInvoice = async (
    inv: ClientInvoice,
    payload: ReviseSubmitPayload
  ) => {
    const subtotal = payload.newItems.reduce(
      (sum, item) => sum + Math.round(Number(item.amount) || 0),
      0
    );
    const revBreakdown = calculateClientInvoiceBreakdown({
      dpp: subtotal,
      includePPN: Boolean(inv.includePPN),
      ppnPercent: inv.ppnPercent ?? 11,
      includePPh: Boolean(inv.includePPh),
      includeCitibank: Boolean(inv.includeCitibank),
    });
    const newTotal = revBreakdown.netReceivable;

    const newInvId = await reviseClientInvoice(
      inv.id,
      {
        ...payload,
      },
      inv
    );
    void logAuditActivity(currentActor, {
      action: 'REVISE_CLIENT_INV',
      entityType: 'CLIENT_INVOICE',
      entityId: inv.id,
      entityLabel: inv.invoiceNumber,
      amount: newTotal,
      summary: `${currentActor.name} merevisi Invoice Client ${inv.invoiceNumber} (${inv.clientName}) · Rp ${formatIDR(
        resolveClientInvoiceNominal(inv)
      )} → Rp ${formatIDR(newTotal)} · Alasan: ${payload.reason}`,
    });

    if (view.type === 'client-invoice-preview') {
      setView({
        type: 'client-invoice-preview',
        invoiceId: newInvId,
        returnTab: view.returnTab,
      });
    } else if (view.type === 'client-invoice-edit') {
      setEditingClientInvoiceId(newInvId);
      setView({
        type: 'client-invoice-edit',
        invoiceId: newInvId,
        mode: 'view',
        returnTab: view.returnTab,
      });
    }
  };

  const handleSaveBossReportMonth = async (monthData: BossReportMonthData) => {
    await saveBossReportMonth(monthData);
    void logAuditActivity(currentActor, {
      action: 'UPDATE_BOSS_REPORT',
      entityType: 'REPORT',
      entityId: monthData.monthKey,
      entityLabel: monthData.monthKey,
      summary: `Update Projection bulan ${monthData.monthKey}`,
    });
  };

  const handleSaveBossReportMonthsBatch = async (months: BossReportMonthData[]) => {
    if (months.length === 0) return;
    await saveBossReportMonthsBatch(months);
    const label = months.map((m) => m.monthKey).join(', ');
    void logAuditActivity(currentActor, {
      action: 'UPDATE_BOSS_REPORT',
      entityType: 'REPORT',
      entityId: months[0].monthKey,
      entityLabel: label,
      summary: `Update status Projection bulan ${label}`,
    });
  };

  const syncSourceChangeToBossReportMonths = async (params: {
    sourceIds: string[];
    clearAutoOverrides?: boolean;
    scopeOriginMonthKey?: string;
    markOriginMovedOut?: {
      originMonthKey: string;
      targetMonthKey: string;
      sourceIds: string[];
      name: string;
      amount: number;
    };
    upsertRescheduled?: {
      sourceId: string;
      section: 'cashIn' | 'operasional' | 'investment' | 'projectCost';
      sourceCategory: 'clientInvoice' | 'opex' | 'investment' | 'vendorPO';
      name: string;
      amount: number;
      originMonthKey: string;
      targetMonthKey: string;
      dueISO?: string;
      investmentAssetId?: string;
      investmentComponent?: 'principal' | 'interest' | 'lateFee' | 'bonus';
      investmentInstallmentMonthKey?: string;
    };
  }) => {
    const sourceIdSet = new Set(params.sourceIds);
    const scopeOriginMK = params.scopeOriginMonthKey;
    const modifiedMap = new Map<string, BossReportMonthData>();

    const getMutableMonth = (mk: string): BossReportMonthData => {
      const cached = modifiedMap.get(mk);
      if (cached) return cached;
      const base = bossReportMonths[mk] ?? createDefaultBossReportMonth(mk);
      const copy: BossReportMonthData = {
        ...base,
        accounts: base.accounts.map((a) => ({ ...a })),
        cashInManual: base.cashInManual.map((i) => ({ ...i })),
        operasional: base.operasional.map((i) => ({ ...i })),
        investment: base.investment.map((i) => ({ ...i })),
        projectCostManual: base.projectCostManual.map((i) => ({ ...i })),
        autoOverrides: base.autoOverrides.map((o) => ({ ...o })),
        rescheduledIn: (base.rescheduledIn ?? []).map((r) => ({
          ...r,
          historyMonths: [...r.historyMonths],
        })),
      };
      return copy;
    };

    for (const [mk] of Object.entries(bossReportMonths)) {
      let dirty = false;
      const copy = getMutableMonth(mk);

      if (params.clearAutoOverrides !== false && (!scopeOriginMK || mk === scopeOriginMK)) {
        const filteredOverrides = copy.autoOverrides.filter(
          (o) => !sourceIdSet.has(o.sourceId)
        );
        if (filteredOverrides.length !== copy.autoOverrides.length) {
          copy.autoOverrides = filteredOverrides;
          dirty = true;
        }
      }

      const filteredRescheduled = (copy.rescheduledIn ?? []).filter((rs) => {
        if (!sourceIdSet.has(rs.sourceId)) return true;
        if (scopeOriginMK && rs.originMonthKey !== scopeOriginMK) return true;
        return false;
      });
      if (filteredRescheduled.length !== (copy.rescheduledIn ?? []).length) {
        copy.rescheduledIn = filteredRescheduled;
        dirty = true;
      }

      if (dirty) {
        modifiedMap.set(mk, copy);
      }
    }

    if (params.markOriginMovedOut) {
      const m = params.markOriginMovedOut;
      const originCopy = getMutableMonth(m.originMonthKey);
      const restOverrides = originCopy.autoOverrides.filter(
        (o) => !m.sourceIds.includes(o.sourceId)
      );
      for (const sid of m.sourceIds) {
        restOverrides.push({
          sourceId: sid,
          hasCustomName: false,
          name: m.name,
          hasCustomAmount: false,
          amount: Math.max(0, Math.round(m.amount)),
          hasCustomColor: true,
          color: 'red',
          rescheduledToMonth: m.targetMonthKey,
        });
      }
      originCopy.autoOverrides = restOverrides;
      modifiedMap.set(m.originMonthKey, originCopy);
    }

    if (params.upsertRescheduled) {
      const u = params.upsertRescheduled;
      const targetCopy = getMutableMonth(u.targetMonthKey);
      const arrivedId = `rs_${u.originMonthKey}_${u.sourceId}`;
      const arrivedItem: BossReportRescheduledItem = {
        id: arrivedId,
        sourceId: u.sourceId,
        section: u.section,
        sourceCategory: u.sourceCategory,
        name: u.name,
        amount: Math.max(0, Math.round(u.amount)),
        color: 'white',
        originMonthKey: u.originMonthKey,
        fromMonthKey: u.originMonthKey,
        rescheduledFromMonth: u.originMonthKey,
        historyMonths: [u.originMonthKey, u.targetMonthKey],
        ...(u.dueISO ? { dueISO: u.dueISO } : {}),
        ...(u.investmentAssetId ? { investmentAssetId: u.investmentAssetId } : {}),
        ...(u.investmentComponent ? { investmentComponent: u.investmentComponent } : {}),
        ...(u.investmentInstallmentMonthKey
          ? { investmentInstallmentMonthKey: u.investmentInstallmentMonthKey }
          : {}),
      };
      targetCopy.rescheduledIn = [
        ...(targetCopy.rescheduledIn ?? []).filter(
          (rs) =>
            rs.id !== arrivedId &&
            !(
              rs.sourceId === u.sourceId &&
              rs.originMonthKey === u.originMonthKey &&
              rs.fromMonthKey === u.originMonthKey
            )
        ),
        arrivedItem,
      ];
      modifiedMap.set(u.targetMonthKey, targetCopy);
    }

    const monthsToSave = Array.from(modifiedMap.values());
    if (monthsToSave.length > 0) {
      await saveBossReportMonthsBatch(monthsToSave);
    }
  };

  const handleSyncProjectionSource = async (action: ProjectionSourceSyncAction) => {
    if (action.type === 'clientInvoice') {
      const inv = clientInvoices.find((i) => i.id === action.invoiceId);
      const color: StatusColorKey = action.color ?? (action.paid ? 'green' : 'white');
      await setClientInvoiceStatusWarna(action.invoiceId, {
        color,
        targetMonthKey: action.targetMonthKey,
        originMonthKey: action.originMonthKey,
        paidDate: getTodayISODate(),
      });
      void logAuditActivity(currentActor, {
        action:
          color === 'green' ? 'MARK_PAID_CLIENT_INV' : 'UPDATE_CLIENT_INV_STATUS',
        entityType: 'CLIENT_INVOICE',
        entityId: action.invoiceId,
        entityLabel: inv?.invoiceNumber ?? action.invoiceId,
        summary:
          color === 'green'
            ? `Tandai Invoice Client ${inv?.invoiceNumber ?? action.invoiceId} Paid dari Projection (Rp ${formatIDR(
                inv ? resolveClientInvoiceNominal(inv) : 0
              )})`
            : color === 'red'
            ? `Pending Invoice Client ${inv?.invoiceNumber ?? action.invoiceId} ke ${formatMonthShortID(
                action.targetMonthKey ?? ''
              )}`
            : `Kembalikan status Invoice Client ${inv?.invoiceNumber ?? action.invoiceId} menjadi Projection`,
      });
      return;
    }

    if (action.type === 'opex') {
      const item = opexItems.find((x) => x.id === action.opexId);
      const nextStatus: OpexPaymentStatus =
        action.color === 'red'
          ? 'Reschedule'
          : action.color === 'green' || action.paid
          ? 'Paid'
          : 'Not Paid';
      const nextWarna: OpexStatusWarna =
        action.color === 'red'
          ? 'MERAH'
          : action.color === 'green' || action.paid
          ? 'HIJAU'
          : 'PUTIH';
      await setOpexMonthPaymentStatus(
        action.opexId,
        action.monthKey,
        nextStatus,
        nextWarna,
        action.targetMonthKey
      );
      const opexStatusLabel =
        nextStatus === 'Paid'
          ? 'Paid'
          : nextStatus === 'Reschedule'
          ? 'Pending'
          : 'Projection';
      void logAuditActivity(currentActor, {
        action: 'UPDATE_OPEX_STATUS',
        entityType: 'OPEX',
        entityId: action.opexId,
        entityLabel: item?.name ?? action.opexId,
        summary: `Sinkronisasi status Opex "${item?.name ?? action.opexId}" (${action.monthKey}) → ${opexStatusLabel}${
          action.targetMonthKey ? ` (pindah ke ${formatMonthShortID(action.targetMonthKey)})` : ''
        }`,
      });
      return;
    }

    if (action.type === 'vendorPO') {
      const targetPO = orders.find((o) => o.id === action.poId);
      const poAmount = targetPO ? getVendorPOEffectiveCostAmount(targetPO) : 0;
      const color: StatusColorKey = action.color ?? (action.paid ? 'green' : 'white');
      await setPurchaseOrderStatusWarna(action.poId, {
        color,
        targetMonthKey: action.targetMonthKey,
        originMonthKey: action.originMonthKey,
      });
      void logAuditActivity(currentActor, {
        action: color === 'green' ? 'MARK_PAID_PO' : 'UPDATE_PO_STATUS',
        entityType: 'PO',
        entityId: action.poId,
        entityLabel: targetPO?.poNumber ?? action.poId,
        amount: poAmount,
        summary:
          color === 'green'
            ? `${currentActor.name} melunasi PO ${targetPO?.poNumber ?? action.poId} sebesar Rp ${formatIDR(
                poAmount
              )}`
            : color === 'red'
            ? `${currentActor.name} menunda (Pending) PO ${targetPO?.poNumber ?? action.poId} ke ${formatMonthShortID(
                action.targetMonthKey ?? ''
              )}`
            : `${currentActor.name} mengembalikan status PO ${targetPO?.poNumber ?? action.poId} ke Projection`,
      });
      return;
    }

    if (action.type === 'investment') {
      const asset = investments.find((x) => x.id === action.assetId);
      const color: StatusColorKey = action.color ?? (action.paid ? 'green' : 'white');
      const compLabel =
        action.component === 'principal'
          ? 'Pokok'
          : action.component === 'interest'
          ? 'Bunga'
          : action.component === 'lateFee'
          ? 'Denda'
          : action.component === 'bonus'
          ? 'Bonus'
          : 'Cicilan';
      await setInvestmentMonthStatus(
        action.assetId,
        action.monthKey,
        color,
        action.targetMonthKey,
        action.component
      );
      void logAuditActivity(currentActor, {
        action: 'TOGGLE_INVESTMENT_PAID',
        entityType: 'INVESTMENT',
        entityId: action.assetId,
        entityLabel: asset?.name ?? action.assetId,
        summary: `Sinkronisasi status ${compLabel} "${asset?.name ?? action.assetId}" bulan ${action.monthKey} → ${
          color === 'green'
            ? 'Paid'
            : color === 'red'
            ? `Pending (${formatMonthShortID(action.targetMonthKey ?? '')})`
            : 'Projection'
        }`,
      });
      return;
    }

    if (action.type === 'investmentDisbursement') {
      const asset = investments.find((x) => x.id === action.assetId);
      await setInvestmentDisbursementStatus(action.assetId, {
        color: action.color,
        rescheduledFromMonth: action.originMonthKey,
        rescheduledToMonth: action.rescheduledToMonth,
        ...(action.color === 'green' ? { paidDate: getTodayISODate() } : {}),
      });
      void logAuditActivity(currentActor, {
        action: 'UPDATE_INVESTMENT',
        entityType: 'INVESTMENT',
        entityId: action.assetId,
        entityLabel: asset?.contractNumber || asset?.name || action.assetId,
        summary: `Update status Pencairan Pinjaman Investment "${
          asset?.name ?? action.assetId
        }" → ${
          action.color === 'green'
            ? 'Paid'
            : action.color === 'red'
            ? `Pending (${action.rescheduledToMonth ?? '-'})`
            : 'Projection'
        }`,
      });
      return;
    }

    if (action.type === 'investmentRescheduleDates') {
      const asset = investments.find((x) => x.id === action.assetId);
      await updateInvestmentDates(action.assetId, {
        ...(action.newEndDate !== undefined ? { endDate: action.newEndDate } : {}),
        ...(action.newBonusDate !== undefined ? { bonusDate: action.newBonusDate } : {}),
      });
      const parts: string[] = [];
      if (action.newEndDate) parts.push(`JT Akhir -> ${action.newEndDate}`);
      if (action.newBonusDate) parts.push(`Tgl Bonus -> ${action.newBonusDate}`);
      void logAuditActivity(currentActor, {
        action: 'UPDATE_INVESTMENT',
        entityType: 'INVESTMENT',
        entityId: action.assetId,
        entityLabel: asset?.name ?? action.assetId,
        summary: `Sinkronisasi reschedule tanggal investasi "${asset?.name ?? action.assetId}" (${parts.join(', ')})`,
      });
    }
  };

  const handleRescheduledCopyAction = async (
    monthKey: string,
    rescheduledItemId: string,
    nextColor: BossReportColorStatus,
    targetMonthKey?: string
  ) => {
    const baseMonth =
      bossReportMonths[monthKey] ?? createDefaultBossReportMonth(monthKey);
    const viewModel = computeBossReportViewModel(
      monthKey,
      baseMonth,
      orders,
      clientInvoices,
      opexItems,
      investments,
      bossReportMonths,
      { cutoffPeriod }
    );
    const allRows = [
      ...viewModel.cashInRows,
      ...viewModel.operasionalRows,
      ...viewModel.investmentRows,
      ...viewModel.projectCostRows,
    ];
    const row = allRows.find(
      (r) => r.isRescheduledIn && r.rescheduledItemId === rescheduledItemId
    );
    if (!row) return;
    const plan = buildProjectionColorChangePlan({
      row,
      nextColor,
      currentMonthKey: monthKey,
      targetMonthKey,
      viewModel,
      bossReportMonths,
      investments,
      opexItems,
    });
    if (plan.monthsToSave.length > 0) {
      await handleSaveBossReportMonthsBatch(plan.monthsToSave);
    }
    for (const syncAct of plan.sourceSyncActions) {
      await handleSyncProjectionSource(syncAct);
    }
  };

  const handleChangeClientInvoiceStatusWarna = async (
    invoiceId: string,
    color: 'white' | 'green' | 'red',
    targetMonthKey?: string,
    originMonthKey?: string
  ) => {
    const inv = clientInvoices.find((i) => i.id === invoiceId);
    const resolvedOrigin =
      originMonthKey ||
      inv?.rescheduledFromMonth ||
      (inv?.dueDate || inv?.invoiceDate || getTodayISODate()).slice(0, 7);
    const resolvedTarget =
      color === 'red' ? targetMonthKey || addMonthKeys(resolvedOrigin, 1) : undefined;
    await setClientInvoiceStatusWarna(invoiceId, {
      color,
      targetMonthKey: resolvedTarget,
      originMonthKey: resolvedOrigin,
      paidDate: getTodayISODate(),
    });
    const nominal = inv ? resolveClientInvoiceNominal(inv) : 0;
    const displayName = inv
      ? `${inv.invoiceNumber} · ${inv.clientName}${inv.projectName ? ` (${inv.projectName})` : ''}`
      : invoiceId;
    await syncSourceChangeToBossReportMonths({
      sourceIds: [`ci_${invoiceId}`],
      clearAutoOverrides: true,
      scopeOriginMonthKey: resolvedOrigin,
      ...(color === 'red' && resolvedTarget
        ? {
            markOriginMovedOut: {
              originMonthKey: resolvedOrigin,
              targetMonthKey: resolvedTarget,
              sourceIds: [`ci_${invoiceId}`],
              name: displayName,
              amount: nominal,
            },
            upsertRescheduled: {
              sourceId: `ci_${invoiceId}`,
              section: 'cashIn',
              sourceCategory: 'clientInvoice',
              name: displayName,
              amount: nominal,
              originMonthKey: resolvedOrigin,
              targetMonthKey: resolvedTarget,
              ...(inv?.dueDate ? { dueISO: inv.dueDate } : {}),
            },
          }
        : {}),
    });
    void logAuditActivity(currentActor, {
      action:
        color === 'green' ? 'MARK_PAID_CLIENT_INV' : 'UPDATE_CLIENT_INV_STATUS',
      entityType: 'CLIENT_INVOICE',
      entityId: invoiceId,
      entityLabel: inv?.invoiceNumber ?? invoiceId,
      summary:
        color === 'green'
          ? `Status Invoice Client ${inv?.invoiceNumber ?? invoiceId} → Paid (Rp ${formatIDR(
              nominal
            )})`
          : color === 'red'
          ? `Status Invoice Client ${inv?.invoiceNumber ?? invoiceId} → Pending (pindah ke ${formatMonthShortID(
              resolvedTarget ?? ''
            )})`
          : `Batalkan Pending Invoice Client ${inv?.invoiceNumber ?? invoiceId} → kembali ke ${formatMonthShortID(
              resolvedOrigin
            )}`,
    });
  };

  const handleChangePOStatusWarna = async (
    poId: string,
    color: 'white' | 'green' | 'red',
    targetMonthKey?: string,
    originMonthKey?: string
  ) => {
    const po = orders.find((o) => o.id === poId);
    const resolvedOrigin =
      originMonthKey ||
      po?.rescheduledFromMonth ||
      (po?.dueDate || po?.invoiceDate || po?.poDate || getTodayISODate()).slice(0, 7);
    const resolvedTarget =
      color === 'red' ? targetMonthKey || addMonthKeys(resolvedOrigin, 1) : undefined;
    await setPurchaseOrderStatusWarna(poId, {
      color,
      targetMonthKey: resolvedTarget,
      originMonthKey: resolvedOrigin,
    });
    const nominal = po ? getVendorPOEffectiveCostAmount(po) : 0;
    const displayName = po
      ? `${po.poNumber} · ${po.vendorName}${po.projectName ? ` (${po.projectName})` : ''}`
      : poId;
    await syncSourceChangeToBossReportMonths({
      sourceIds: [`po_${poId}`],
      clearAutoOverrides: true,
      scopeOriginMonthKey: resolvedOrigin,
      ...(color === 'red' && resolvedTarget
        ? {
            markOriginMovedOut: {
              originMonthKey: resolvedOrigin,
              targetMonthKey: resolvedTarget,
              sourceIds: [`po_${poId}`],
              name: displayName,
              amount: nominal,
            },
            upsertRescheduled: {
              sourceId: `po_${poId}`,
              section: 'projectCost',
              sourceCategory: 'vendorPO',
              name: displayName,
              amount: nominal,
              originMonthKey: resolvedOrigin,
              targetMonthKey: resolvedTarget,
              ...(po?.dueDate ? { dueISO: po.dueDate } : {}),
            },
          }
        : {}),
    });
    void logAuditActivity(currentActor, {
      action: color === 'green' ? 'MARK_PAID_PO' : 'UPDATE_PO_STATUS',
      entityType: 'PO',
      entityId: poId,
      entityLabel: po?.poNumber ?? poId,
      amount: nominal,
      summary:
        color === 'green'
          ? `${currentActor.name} melunasi PO Vendor ${po?.poNumber ?? poId} (${
              po?.vendorName ?? '-'
            }) sebesar Rp ${formatIDR(nominal)}`
          : color === 'red'
          ? `${currentActor.name} menunda PO Vendor ${po?.poNumber ?? poId} ke ${formatMonthShortID(
              resolvedTarget ?? ''
            )}`
          : `${currentActor.name} membatalkan Pending PO Vendor ${po?.poNumber ?? poId} → kembali ke ${formatMonthShortID(
              resolvedOrigin
            )}`,
    });
  };

  const handleSetInvestmentMonthStatusWarna = async (
    assetId: string,
    monthKey: string,
    color: 'white' | 'green' | 'red',
    targetMonthKey?: string,
    component?: InvestmentComponentKey
  ) => {
    const asset = investments.find((x) => x.id === assetId);
    const resolvedTarget =
      color === 'red' ? targetMonthKey || addMonthKeys(monthKey, 1) : undefined;
    await setInvestmentMonthStatus(assetId, monthKey, color, resolvedTarget, component);
    if (asset) {
      const workingMonthsRecord: Record<string, BossReportMonthData> = {
        ...bossReportMonths,
      };
      const vm = computeBossReportViewModel(
        monthKey,
        workingMonthsRecord[monthKey] ?? createDefaultBossReportMonth(monthKey),
        orders,
        clientInvoices,
        opexItems,
        investments,
        workingMonthsRecord,
        { cutoffPeriod }
      );
      const matchingRows = vm.investmentRows.filter((r: BossReportComputedRow) => {
        if (
          r.isRescheduledIn ||
          r.investmentAssetId !== assetId ||
          (r.investmentInstallmentMonthKey || r.originMonthKey || monthKey) !== monthKey
        ) {
          return false;
        }
        if (!component) return true;
        if (component === 'interest' || component === 'lateFee') {
          return r.investmentComponent === 'interest' || r.investmentComponent === 'lateFee';
        }
        return r.investmentComponent === component;
      });
      const savedMap = new Map<string, BossReportMonthData>();
      for (const r of matchingRows) {
        const currentVm = computeBossReportViewModel(
          monthKey,
          workingMonthsRecord[monthKey] ?? createDefaultBossReportMonth(monthKey),
          orders,
          clientInvoices,
          opexItems,
          investments,
          workingMonthsRecord,
          { cutoffPeriod }
        );
        const freshRow =
          currentVm.investmentRows.find(
            (cand: BossReportComputedRow) => cand.rowKey === r.rowKey
          ) ?? r;
        const plan = buildProjectionColorChangePlan({
          row: freshRow,
          nextColor: color,
          currentMonthKey: monthKey,
          targetMonthKey: resolvedTarget,
          viewModel: currentVm,
          bossReportMonths: workingMonthsRecord,
          investments,
          opexItems,
        });
        for (const m of plan.monthsToSave) {
          workingMonthsRecord[m.monthKey] = m;
          savedMap.set(m.monthKey, m);
        }
      }
      if (savedMap.size > 0) {
        await saveBossReportMonthsBatch(Array.from(savedMap.values()));
      }
    }
    const compLabel =
      component === 'principal'
        ? 'Pokok'
        : component === 'interest'
        ? 'Bunga'
        : component === 'lateFee'
        ? 'Denda'
        : component === 'bonus'
        ? 'Bonus'
        : 'cicilan';
    void logAuditActivity(currentActor, {
      action: 'TOGGLE_INVESTMENT_PAID',
      entityType: 'INVESTMENT',
      entityId: assetId,
      entityLabel: asset?.name ?? assetId,
      summary: `Status ${compLabel} "${asset?.name ?? assetId}" (${monthKey}) → ${
        color === 'green'
          ? 'Paid'
          : color === 'red'
          ? `Pending (pindah ke ${formatMonthShortID(resolvedTarget ?? '')})`
          : 'Projection (Batalkan Pending)'
      }`,
    });
  };

  // Opex Handlers
  const handleCreateOpex = async (input: OpexInput): Promise<string> => {
    const id = await createOpexItem(input);
    await Promise.all([
      refreshOpexFromSupabase(),
      refreshBossReportMonthsFromSupabase().catch(() => undefined),
    ]);
    void logAuditActivity(currentActor, {
      action: 'CREATE_OPEX',
      entityType: 'OPEX',
      entityId: id,
      entityLabel: input.name,
      amount: input.amount,
      summary: `${currentActor.name} menambah Opex "${input.name}" sebesar Rp ${formatIDR(input.amount)} (${
        input.isRecurring ? 'Recurring/bulan' : `Bulan ${input.monthKey}`
      })`,
    });
    return id;
  };

  const handleUpdateOpex = async (id: string, input: OpexInput): Promise<void> => {
    await updateOpexItem(id, input);
    await Promise.all([
      refreshOpexFromSupabase(),
      refreshBossReportMonthsFromSupabase().catch(() => undefined),
    ]);
    void logAuditActivity(currentActor, {
      action: 'EDIT_OPEX',
      entityType: 'OPEX',
      entityId: id,
      entityLabel: input.name,
      amount: input.amount,
      summary: `${currentActor.name} mengedit Opex "${input.name}" sebesar Rp ${formatIDR(input.amount)}`,
    });
  };

  const handleSetOpexMonthStatus = async (
    id: string,
    monthKey: string,
    status: OpexPaymentStatus,
    statusWarna?: OpexStatusWarna,
    targetMonthKey?: string
  ): Promise<void> => {
    const item = opexItems.find((x) => x.id === id);
    const resolvedTarget =
      status === 'Reschedule'
        ? targetMonthKey || addMonthKeys(monthKey, 1)
        : undefined;
    await setOpexMonthPaymentStatus(id, monthKey, status, statusWarna, resolvedTarget);
    await syncSourceChangeToBossReportMonths({
      sourceIds: [`opex_${id}`],
      clearAutoOverrides: true,
      scopeOriginMonthKey: monthKey,
      ...(item && status === 'Reschedule' && resolvedTarget
        ? {
            markOriginMovedOut: {
              originMonthKey: monthKey,
              targetMonthKey: resolvedTarget,
              sourceIds: [`opex_${id}`],
              name: item.name,
              amount: item.amount,
            },
          }
        : {}),
      upsertRescheduled:
        item && status === 'Reschedule' && resolvedTarget
          ? {
              sourceId: `opex_${id}`,
              section: 'operasional',
              sourceCategory: 'opex',
              name: item.name,
              amount: item.amount,
              originMonthKey: monthKey,
              targetMonthKey: resolvedTarget,
            }
          : undefined,
    });
    const opexStatusLabel =
      status === 'Paid'
        ? 'Paid'
        : status === 'Reschedule'
        ? 'Pending'
        : 'Projection';
    void logAuditActivity(currentActor, {
      action: 'UPDATE_OPEX_STATUS',
      entityType: 'OPEX',
      entityId: id,
      entityLabel: item?.name ?? id,
      summary: `Status Opex "${item?.name ?? id}" (${monthKey}) → ${opexStatusLabel}${
        resolvedTarget ? ` → pindah ke ${formatMonthShortID(resolvedTarget)}` : ''
      }`,
    });
  };

  const handleDeleteOpex = async (id: string): Promise<void> => {
    const cleanId = id.trim().replace(/^opex_/, '').replace(/__\d{4}-\d{2}$/, '');
    const item = opexItems.find((x) => x.id === cleanId);
    await deleteOpexItem(cleanId);
    try {
      await syncSourceChangeToBossReportMonths({
        sourceIds: [`opex_${cleanId}`],
        clearAutoOverrides: true,
      });
    } catch {
      // Tetap lanjut refresh meski pembersihan referensi projection opsional gagal
    }
    await Promise.all([
      refreshOpexFromSupabase().catch(() => undefined),
      refreshBossReportMonthsFromSupabase().catch(() => undefined),
    ]);
    void logAuditActivity(currentActor, {
      action: 'DELETE_OPEX',
      entityType: 'OPEX',
      entityId: cleanId,
      entityLabel: item?.name ?? cleanId,
      summary: `Hapus Opex "${item?.name ?? cleanId}"`,
    });
  };

  // Projection Manual Item Handlers (Sekali Pakai — Terpisah dari Master Investment / Project / PO)
  const handleCreateProjectionManualItem = async (
    input: ProjectionManualItemInput
  ): Promise<ProjectionManualItem> => {
    const created = await createProjectionManualItem({
      ...input,
      createdBy: input.createdBy || currentActor.name || currentActor.email,
    });
    const sectionLabel =
      created.section === 'INVESTMENT' ? 'B. Investment' : 'C. Project Cost';
    void logAuditActivity(currentActor, {
      action: 'CREATE_PROJECTION_MANUAL_ITEM',
      entityType: 'REPORT',
      entityId: created.id,
      entityLabel: `${sectionLabel} · ${created.namaItem}`,
      amount: created.nominal,
      summary: `${currentActor.name} menambah item manual Projection (${sectionLabel} · ${created.periode}) "${created.namaItem}" sebesar Rp ${formatIDR(
        created.nominal
      )}`,
    });
    return created;
  };

  const handleUpdateProjectionManualItem = async (
    id: string,
    input: ProjectionManualItemInput
  ): Promise<ProjectionManualItem> => {
    const updated = await updateProjectionManualItem(id, input);
    const sectionLabel =
      updated.section === 'INVESTMENT' ? 'B. Investment' : 'C. Project Cost';
    void logAuditActivity(currentActor, {
      action: 'EDIT_PROJECTION_MANUAL_ITEM',
      entityType: 'REPORT',
      entityId: updated.id,
      entityLabel: `${sectionLabel} · ${updated.namaItem}`,
      amount: updated.nominal,
      summary: `${currentActor.name} mengedit item manual Projection (${sectionLabel} · ${updated.periode}) "${updated.namaItem}" sebesar Rp ${formatIDR(
        updated.nominal
      )}`,
    });
    return updated;
  };

  const handleDeleteProjectionManualItem = async (id: string): Promise<void> => {
    const existing = projectionManualItems.find((x) => x.id === id);
    await deleteProjectionManualItem(id);
    const sectionLabel = existing
      ? existing.section === 'INVESTMENT'
        ? 'B. Investment'
        : 'C. Project Cost'
      : 'Projection';
    void logAuditActivity(currentActor, {
      action: 'DELETE_PROJECTION_MANUAL_ITEM',
      entityType: 'REPORT',
      entityId: id,
      entityLabel: existing?.namaItem ?? id,
      amount: existing?.nominal,
      summary: `${currentActor.name} menghapus item manual Projection (${sectionLabel}${
        existing ? ` · ${existing.periode}` : ''
      }) "${existing?.namaItem ?? id}"`,
    });
  };

  // Investment Handlers
  const handleCreateInvestment = async (input: InvestmentInput): Promise<string> => {
    const id = await createInvestmentAsset(input);
    void logAuditActivity(currentActor, {
      action: 'CREATE_INVESTMENT',
      entityType: 'INVESTMENT',
      entityId: id,
      entityLabel: input.name,
      summary: `Tambah Aset/Cicilan "${input.name}" · Cicilan Rp ${formatIDR(
        input.monthlyInstallment
      )}/bln (${input.tenorMonths}x)`,
    });
    return id;
  };

  const handleUpdateInvestment = async (
    id: string,
    input: InvestmentInput
  ): Promise<void> => {
    await updateInvestmentAsset(id, input);
    void logAuditActivity(currentActor, {
      action: 'EDIT_INVESTMENT',
      entityType: 'INVESTMENT',
      entityId: id,
      entityLabel: input.name,
      summary: `Update Aset/Cicilan "${input.name}" · Cicilan Rp ${formatIDR(
        input.monthlyInstallment
      )}/bln`,
    });
  };

  const handleToggleInvestmentPaidMonth = async (
    id: string,
    monthKey: string,
    component?: InvestmentComponentKey
  ): Promise<void> => {
    const item = investments.find((x) => x.id === id);
    const paidSet = new Set(item?.paidMonths ?? []);
    const wasPaid = Boolean(
      item?.status === 'Lunas' ||
        (component
          ? isInvestmentComponentPaidInSet(paidSet, monthKey, component)
          : paidSet.has(monthKey))
    );
    await toggleInvestmentPaidMonth(id, monthKey, component);
    const today = getTodayISODate();
    const dateParts = today.split('-');
    const dateDisplay =
      dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : today;
    const compLabel =
      component === 'principal'
        ? 'Pokok'
        : component === 'interest'
        ? 'Bunga'
        : component === 'lateFee'
        ? 'Denda'
        : component === 'bonus'
        ? 'Bonus'
        : 'Cicilan';
    void logAuditActivity(currentActor, {
      action: 'TOGGLE_INVESTMENT_PAID',
      entityType: 'INVESTMENT',
      entityId: id,
      entityLabel: item?.contractNumber || item?.name || id,
      dateISO: today,
      summary: `${dateDisplay} - ${compLabel} ${monthKey} (${item?.name ?? id}) - ${
        wasPaid ? 'Paid -> Projection (Batal Paid)' : 'Projection -> Paid'
      } - Oleh ${currentActor.name} - "${
        wasPaid ? 'Dibatalkan dari Detail Kontrak' : 'Pelunasan dari Detail Kontrak'
      }"`,
    });
  };

  const handleDeleteInvestment = async (id: string): Promise<void> => {
    const item = investments.find((x) => x.id === id);
    await deleteInvestmentAsset(id);
    void logAuditActivity(currentActor, {
      action: 'DELETE_INVESTMENT',
      entityType: 'INVESTMENT',
      entityId: id,
      entityLabel: item?.name ?? id,
      summary: `Hapus Aset/Cicilan "${item?.name ?? id}"`,
    });
  };

  const handleAddInvestmentAddendum = async (
    id: string,
    submission: InvestmentAddendumFormSubmission
  ): Promise<void> => {
    const item = investments.find((x) => x.id === id);
    await addInvestmentAddendum(id, submission);
    void logAuditActivity(currentActor, {
      action: 'ADDENDUM_INVESTMENT',
      entityType: 'INVESTMENT',
      entityId: id,
      entityLabel: submission.addendumNumber || item?.name || id,
      summary: `Adendum/Perpanjangan "${item?.name ?? id}" (${submission.addendumNumber}) · +${submission.additionalTenorMonths} bln${
        submission.additionalPrincipal > 0
          ? ` · Pokok +Rp ${formatIDR(submission.additionalPrincipal)}`
          : ''
      }`,
    });
  };

  const handleImportInvestmentsCsv = async (
    entries: Array<{ id?: string; input: InvestmentInput }>,
    options: { replaceExisting: boolean }
  ): Promise<{ count: number }> => {
    const res = await importInvestmentsBatch(entries, options);
    const totalPokok = entries.reduce((s, e) => s + (e.input.principalAmount || 0), 0);
    const totalBunga = entries.reduce((s, e) => s + (e.input.monthlyInstallment || 0), 0);
    void logAuditActivity(currentActor, {
      action: 'IMPORT_INVESTMENT_CSV',
      entityType: 'INVESTMENT',
      entityId: 'csv_batch',
      entityLabel: `${res.count} Kontrak CSV`,
      summary: `Import ${res.count} kontrak Investment dari CSV (Total Pokok Rp ${formatIDR(
        totalPokok
      )} · Total Bunga/bln Rp ${formatIDR(totalBunga)})`,
    });
    return res;
  };

  // Client PO Handlers
  const handleCreateClientPO = async (
    input: ClientPurchaseOrderInput
  ): Promise<string> => {
    const id = await createClientPO(input);
    void logAuditActivity(currentActor, {
      action: 'CREATE_CLIENT_PO',
      entityType: 'CLIENT_PO',
      entityId: id,
      entityLabel: input.clientPoNumber,
      amount: input.amount,
      summary: `${currentActor.name} menambah PO Client ${input.clientPoNumber} — ${input.clientName} sebesar Rp ${formatIDR(
        input.amount
      )}`,
    });
    return id;
  };

  const handleUpdateClientPO = async (
    id: string,
    input: ClientPurchaseOrderInput
  ): Promise<void> => {
    await updateClientPO(id, input);
    void logAuditActivity(currentActor, {
      action: 'EDIT_CLIENT_PO',
      entityType: 'CLIENT_PO',
      entityId: id,
      entityLabel: input.clientPoNumber,
      amount: input.amount,
      summary: `${currentActor.name} mengedit PO Client ${input.clientPoNumber} — ${input.clientName} sebesar Rp ${formatIDR(
        input.amount
      )}`,
    });
  };

  const handleDeleteClientPO = async (id: string): Promise<void> => {
    const item = clientPOs.find((x) => x.id === id);
    await deleteClientPO(id);
    void logAuditActivity(currentActor, {
      action: 'DELETE_CLIENT_PO',
      entityType: 'CLIENT_PO',
      entityId: id,
      entityLabel: item?.clientPoNumber ?? id,
      summary: `Hapus PO Client ${item?.clientPoNumber ?? id}`,
    });
  };

  const handleOpenPreview = (
    po: PurchaseOrder,
    returnTarget: POReturnTarget,
    autoPrint = false
  ) => {
    setView({ type: 'preview', poId: po.id, returnTarget, autoPrint });
  };

  const navigateSidebar = (menu: SidebarMenuKey) => {
    setMobileSidebarOpen(false);
    setEditingClientInvoiceId(null);
    if (menu === 'projection') setView({ type: 'projection' });
    else if (menu === 'balance') setView({ type: 'balance' });
    else if (menu === 'accounts') setView({ type: 'accounts' });
    else if (menu === 'opex') setView({ type: 'opex' });
    else if (menu === 'investment') setView({ type: 'investment' });
    else if (menu === 'project-client') {
      setView({
        type: 'project-client',
        tab: canViewMenu('project_client') ? 'client-po' : 'client-invoices',
      });
    } else if (menu === 'invoice') {
      setView({ type: 'project-client', tab: 'client-invoices' });
    } else if (menu === 'project-vendor') {
      setView({ type: 'project-vendor', tab: 'po-vendor' });
    } else if (menu === 'user-management') {
      setView({ type: 'user-management' });
    } else {
      setView({ type: 'activity-logs' });
    }
  };

  const partialFetchToastNode = partialFetchToast ? (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-sm bg-slate-900 text-white text-xs rounded-xl shadow-lg border border-slate-700 px-3.5 py-2.5 flex items-center gap-2.5 print:hidden"
    >
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="font-medium">{partialFetchToast}</span>
      <button
        type="button"
        onClick={() => {
          setPartialFetchToast(null);
          void handleLoadRangeData(
            `${startYear}-${String(startMonth).padStart(2, '0')}`,
            `${endYear}-${String(endMonth).padStart(2, '0')}`
          );
        }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold shrink-0 cursor-pointer"
      >
        <RefreshCw className="w-3 h-3" />
        Refresh
      </button>
      <button
        type="button"
        aria-label="Tutup notifikasi"
        onClick={() => setPartialFetchToast(null)}
        className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : null;

  const actionToastNode = actionToast ? (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-4 z-50 max-w-sm text-xs rounded-xl shadow-lg border px-3.5 py-2.5 flex items-center gap-2.5 print:hidden ${
        partialFetchToast ? 'bottom-16' : 'bottom-4'
      } ${
        actionToast.type === 'error'
          ? 'bg-red-900 text-white border-red-700'
          : 'bg-emerald-900 text-white border-emerald-700'
      }`}
    >
      {actionToast.type === 'error' ? (
        <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
      ) : (
        <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
      )}
      <span className="font-medium">{actionToast.message}</span>
      <button
        type="button"
        aria-label="Tutup notifikasi"
        onClick={() => setActionToast(null)}
        className="text-white/70 hover:text-white shrink-0 cursor-pointer ml-auto"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : null;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl px-8 py-7 shadow-sm text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden mx-auto">
            <img
              src="/assets/aistudio/ctribe_logo_trimmed.png"
              alt={COMPANY_INFO.name}
              className="w-11 h-11 object-contain"
            />
          </div>
          <div className="w-6 h-6 rounded-full border-2 border-slate-900 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-900">Memeriksa sesi login...</p>
          <p className="text-xs text-slate-500">{COMPANY_INFO.name}</p>
        </div>
      </div>
    );
  }

  if (!authSession || isPasswordRecovery) {
    return (
      <LoginView
        isRecoveryMode={isPasswordRecovery}
        onLoginSuccess={(session) => {
          setAuthSession(session);
          setIsPasswordRecovery(false);
          void logAuditActivity(
            {
              uid: session.user.id,
              name: session.user.nama || session.user.email,
              email: session.user.email,
              roleId: session.user.role,
              roleName: session.user.role,
            },
            {
              action: 'LOGIN',
              entityType: 'AUTH',
              entityId: session.user.id,
              entityLabel: session.user.email,
              summary: `Login berhasil: ${session.user.nama || session.user.email} (${session.user.email})`,
            }
          );
        }}
        onRecoveryComplete={() => {
          setIsPasswordRecovery(false);
          void handleRefreshCurrentProfile();
        }}
      />
    );
  }

  if (!firstAllowedView) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <div className="w-11 h-11 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5 text-amber-700" />
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-bold text-slate-900">Akses Menu Belum Tersedia</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Akun <span className="font-semibold text-slate-800">{authSession.user.email}</span>{' '}
              belum memiliki menu yang diizinkan untuk dibuka. Hubungi Super Admin untuk mengatur hak akses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </div>
    );
  }

  // Boss Mode (?mode=bos) — Read-Only View (Requires Login & Projection/Realisasi View Permission)
  if (isBossMode) {
    const canViewBossProjection = canViewMenu('dashboard');
    const canViewBossRealisasi = canViewMenu('realisasi');

    if (!canViewBossProjection && !canViewBossRealisasi) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
            <h1 className="text-base font-bold text-slate-900">Akses Mode Pimpinan Dibatasi</h1>
            <p className="text-xs text-slate-600">
              Akun Anda tidak memiliki izin melihat menu Dashboard (Projection) atau Realisasi.
            </p>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </div>
      );
    }

    const effectiveBossTab: 'projection' | 'balance' =
      bossTab === 'balance' && canViewBossRealisasi
        ? 'balance'
        : canViewBossProjection
        ? 'projection'
        : 'balance';

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0">
                <img
                  src="/assets/aistudio/ctribe_logo_trimmed.png"
                  alt={COMPANY_INFO.name}
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  {COMPANY_INFO.name} — {effectiveBossTab === 'balance' ? 'Realisasi' : 'Projection'}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tampilan Khusus Pimpinan · Read-Only (Hanya Lihat &amp; Unduh Laporan)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <PWAInstallButton />
              <span className="text-xs text-slate-600 hidden sm:inline">
                {authSession.user.nama} ({authSession.user.email})
              </span>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {(!isSupabaseConfigured || dbErrorBanner) && (
            <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-300 text-xs text-red-900 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Kesalahan Koneksi Supabase</p>
                  <p className="mt-0.5 break-all">
                    {dbErrorBanner ||
                      'VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum dikonfigurasi di environment variables.'}
                  </p>
                </div>
              </div>
              {dbErrorBanner && (
                <button
                  type="button"
                  onClick={() => {
                    setDbErrorBanner(null);
                    clearDatabaseErrorBanner();
                  }}
                  className="text-red-700 hover:text-red-950 font-semibold shrink-0 cursor-pointer"
                >
                  Tutup
                </button>
              )}
            </div>
          )}
          {effectiveBossTab === 'balance' ? (
            <BalanceRealisasiView
              orders={orders}
              clientInvoices={clientInvoices}
              opexItems={opexItems}
              investments={investments}
              bossReportMonths={bossReportMonths}
              auditLogs={auditLogs}
              currentActor={currentActor}
              selectedMonthKey={projectionPeriod}
              cutoffPeriod={cutoffPeriod}
              onChangeMonthKey={setProjectionPeriod}
              startMonth={startMonth}
              startYear={startYear}
              endMonth={endMonth}
              endYear={endYear}
              onChangeStartPeriod={handleChangeStartPeriod}
              onChangeEndPeriod={handleChangeEndPeriod}
              onChangeRange={handleChangePeriodRange}
              onSwitchToProjection={() => {
                if (canViewBossProjection) setBossTab('projection');
              }}
              onLoadRangeData={handleLoadRangeData}
              isLoading={loadingOrders || loadingClientInvoices}
              isBossMode={true}
              canEdit={false}
            />
          ) : (
            <ProjectionReportView
              orders={orders}
              clientInvoices={clientInvoices}
              opexItems={opexItems}
              investments={investments}
              clientPOs={clientPOs}
              projectionManualItems={projectionManualItems}
              bossReportMonths={bossReportMonths}
              auditLogs={auditLogs}
              currentActor={currentActor}
              selectedMonthKey={projectionPeriod}
              cutoffPeriod={cutoffPeriod}
              onChangeMonthKey={setProjectionPeriod}
              startMonth={startMonth}
              startYear={startYear}
              endMonth={endMonth}
              endYear={endYear}
              onChangeStartPeriod={handleChangeStartPeriod}
              onChangeEndPeriod={handleChangeEndPeriod}
              onChangeRange={handleChangePeriodRange}
              onSwitchToBalance={() => {
                if (canViewBossRealisasi) setBossTab('balance');
              }}
              onLoadRangeData={handleLoadRangeData}
              isLoading={loadingOrders || loadingClientInvoices}
              isBossMode={true}
              canEdit={false}
            />
          )}
        </main>
        {partialFetchToastNode}
        {actionToastNode}
      </div>
    );
  }

  const previewPO =
    view.type === 'preview' ? orders.find((item) => item.id === view.poId) ?? null : null;
  const editingPO =
    view.type === 'edit' ? orders.find((item) => item.id === view.poId) ?? null : null;
  const editingClientInvoice =
    view.type === 'client-invoice-edit'
      ? clientInvoices.find(
          (item) => item.id === (editingClientInvoiceId ?? view.invoiceId)
        ) ??
        view.invoiceSnapshot ??
        null
      : null;

  if (view.type === 'preview') {
    if (!previewPO) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-3">
            <p className="text-sm text-slate-600">Dokumen Purchase Order tidak ditemukan.</p>
            <button
              type="button"
              onClick={() => setView(view.returnTarget)}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
            >
              Kembali
            </button>
          </div>
        </div>
      );
    }

    return (
      <PODocumentPreview
        po={previewPO}
        autoPrint={Boolean(view.autoPrint)}
        permissions={vendorPermissions}
        currentActor={currentActor}
        onBack={() => setView(view.returnTarget)}
        onEdit={(po) =>
          setView({ type: 'edit', poId: po.id, returnTarget: view.returnTarget })
        }
        onDuplicate={(po) =>
          setView({ type: 'create', duplicateFrom: po, returnTarget: view.returnTarget })
        }
        onStatusChange={(poId, nextStatus) => handleStatusChange(poId, nextStatus)}
        onRevisePO={handleRevisePO}
        isUpdatingStatus={updatingStatus}
      />
    );
  }

  if (view.type === 'client-invoice-preview') {
    const previewClientInvoice =
      clientInvoices.find((item) => item.id === view.invoiceId) ?? null;

    if (!previewClientInvoice) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-3">
            <p className="text-sm text-slate-600">Dokumen Invoice Client tidak ditemukan.</p>
            <button
              type="button"
              onClick={() =>
                setView({ type: 'project-client', tab: view.returnTab })
              }
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
            >
              Kembali
            </button>
          </div>
        </div>
      );
    }

    return (
      <ClientInvoiceDocumentPreview
        invoice={previewClientInvoice}
        autoPrint={Boolean(view.autoPrint)}
        permissions={clientInvoicePermissions}
        currentActor={currentActor}
        onBack={() => setView({ type: 'project-client', tab: view.returnTab })}
        onEdit={(inv) => handleEdit(inv, 'edit', view.returnTab)}
        onDuplicate={(inv) => {
          setEditingClientInvoiceId(null);
          setView({
            type: 'client-invoice-create',
            duplicateFrom: inv,
            returnTab: view.returnTab,
          });
        }}
        onSendInvoice={handleSendClientInvoice}
        onReviseInvoice={handleReviseClientInvoice}
        onUpdatePrintOptions={updateClientInvoicePrintOptions}
      />
    );
  }

  const activeOrders = orders.filter((po) => !po.isDeleted);
  const activeInvoices = clientInvoices.filter((inv) => !inv.isDeleted);
  const unbilledVendorCount = activeOrders.filter(
    (po) => po.status === 'Draft' || po.status === 'Sent'
  ).length;
  const billedVendorCount = activeOrders.filter(
    (po) =>
      po.status === 'Invoiced' ||
      po.status === 'Paid' ||
      po.status === 'Reschedule' ||
      (po.status === 'Not Paid' && hasVendorInvoice(po))
  ).length;
  const receivablesCount = activeInvoices.filter(
    (inv) => !inv.isVoided && (inv.status === 'Unpaid' || inv.status === 'Reschedule')
  ).length;

  const getHeaderInfo = (): { title: string; subtitle: string } => {
    if (view.type === 'projection') {
      return {
        title: 'Projection',
        subtitle:
          'Dashboard proyeksi arus kas bulanan: Saldo Awal, Cash In, Cash Out (Operasional, Investment, Project Cost) & Ending Balance per rekening',
      };
    }
    if (view.type === 'balance') {
      return {
        title: 'Realisasi',
        subtitle:
          'Dashboard realisasi arus kas bulanan: Saldo Awal, Cash In Paid, Cash Out Paid (Operasional, Investment, Project Cost) & Saldo Tersedia per rekening',
      };
    }
    if (view.type === 'accounts') {
      return {
        title: 'Detail Saldo Rekening & Ending Balance',
        subtitle:
          'Input Saldo Awal per rekening, Saldo Akhir terhitung otomatis dari Realisasi.',
      };
    }
    if (view.type === 'opex') {
      return {
        title: 'Opex (Biaya Operasional)',
        subtitle:
          'Input & kelola biaya operasional bulanan beserta status pembayaran & recurring otomatis ke Projection',
      };
    }
    if (view.type === 'investment') {
      return {
        title: 'Investment (Aset & Cicilan)',
        subtitle:
          'Kelola aset, cicilan (Pokok + Bunga), denda bulanan & bonus — seluruhnya otomatis masuk ke Projection · Cash Out Investment',
      };
    }
    if (view.type === 'project-client') {
      if (view.tab === 'client-po') {
        return {
          title: 'Project · Client — PO Client',
          subtitle:
            'Daftar Purchase Order yang diterima dari Client; buat Invoice Client langsung dari PO',
        };
      }
      if (view.tab === 'client-invoices') {
        return {
          title: 'Project · Client — Invoice Client (Cash In)',
          subtitle: 'Kelola invoice tagihan ke Client untuk proyeksi Cash In otomatis',
        };
      }
      return {
        title: 'Project · Client — Piutang',
        subtitle:
          'Daftar invoice client berstatus belum lunas / jatuh tempo untuk penagihan piutang',
      };
    }
    if (view.type === 'project-vendor') {
      if (view.tab === 'po-vendor') {
        return {
          title: 'Project · Vendor — PO Vendor',
          subtitle: 'Kelola seluruh Purchase Order Vendor, status, dan dokumen siap cetak A4',
        };
      }
      return {
        title: 'Project · Vendor — Tagihan Vendor (Cash Out Project Cost)',
        subtitle:
          'Daftar PO Vendor yang sudah ditagih (Invoiced) dan Lunas (Paid) untuk Cash Out Project Cost',
      };
    }
    if (view.type === 'client-invoice-create') {
      return {
        title: 'Buat Invoice Client',
        subtitle:
          'Buat draft invoice client baru; atur Tanggal Kirim & Estimasi Bayar saat Kirim Invoice',
      };
    }
    if (view.type === 'client-invoice-edit') {
      return {
        title: view.mode === 'view' ? 'Detail Invoice Client' : 'Edit Invoice Client',
        subtitle: 'Perbarui informasi tagihan ke Client sebelum berstatus PAID',
      };
    }
    if (view.type === 'create') {
      return {
        title: 'Buat PO Vendor Baru',
        subtitle: 'Buat Purchase Order baru dengan penomoran otomatis dan siap cetak A4',
      };
    }
    if (view.type === 'edit') {
      return {
        title: 'Edit Purchase Order',
        subtitle: 'Perbarui informasi Purchase Order sebelum ditandai lunas',
      };
    }
    if (view.type === 'user-management') {
      return {
        title: 'Manajemen User & Hak Akses',
        subtitle:
          'Tambah user, atur peran, nonaktifkan/hapus akun, reset password, dan atur hak Lihat/Edit per menu (Khusus Super Admin)',
      };
    }
    return {
      title: 'Log Aktivitas Sistem',
      subtitle: 'Audit trail untuk perubahan Projection, Opex, Investment, PO, dan Invoice',
    };
  };

  const currentHeader = getHeaderInfo();

  const renderSidebarNav = () => (
    <div className="space-y-4">
      <div className="space-y-1">
        {/* 1. Projection (Main Dashboard) */}
        {canViewMenu('dashboard') && (
          <button
            type="button"
            onClick={() => navigateSidebar('projection')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'projection'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <BarChart3
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'projection' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Dashboard (Projection)</span>
            </span>
          </button>
        )}

        {/* 2. Opex */}
        {canViewMenu('opex') && (
          <button
            type="button"
            onClick={() => navigateSidebar('opex')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'opex'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Wallet
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'opex' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Opex</span>
            </span>
            {opexItems.length > 0 && (
              <span
                className={`text-xs font-mono tabular-nums ${
                  currentMenu === 'opex' ? 'text-white' : 'text-[#111111]'
                }`}
              >
                {opexItems.length}
              </span>
            )}
          </button>
        )}

        {/* 3. Investment */}
        {canViewMenu('investment') && (
          <button
            type="button"
            onClick={() => navigateSidebar('investment')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'investment'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <TrendingUp
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'investment' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Investment</span>
            </span>
            {investments.length > 0 && (
              <span
                className={`text-xs font-mono tabular-nums ${
                  currentMenu === 'investment' ? 'text-white' : 'text-[#111111]'
                }`}
              >
                {investments.length}
              </span>
            )}
          </button>
        )}

        {/* 3B. Realisasi */}
        {canViewMenu('realisasi') && (
          <button
            type="button"
            onClick={() => navigateSidebar('balance')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'balance'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Landmark
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'balance' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Realisasi</span>
            </span>
          </button>
        )}

        {/* 3C. Detail Saldo Rekening */}
        {canViewMenu('saldo_rekening') && (
          <button
            type="button"
            onClick={() => navigateSidebar('accounts')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'accounts'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Building2
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'accounts' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Detail Saldo Rekening</span>
            </span>
          </button>
        )}

        {/* 4. Project (Parent + Sub-menu: Client, Invoice, Vendor) */}
        {(canViewMenu('project_client') ||
          canViewMenu('invoice') ||
          canViewMenu('project_vendor')) && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setProjectMenuOpen((prev) => !prev)}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
                currentMenu === 'project-client' ||
                currentMenu === 'invoice' ||
                currentMenu === 'project-vendor'
                  ? 'text-[#111111] bg-white/30 font-semibold'
                  : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <FolderKanban className="w-4 h-4 shrink-0 text-[#111111]" />
                <span className="truncate">Project</span>
              </span>
              {projectMenuOpen ? (
                <ChevronDown className="w-4 h-4 text-[#111111] shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[#111111] shrink-0" />
              )}
            </button>

            {projectMenuOpen && (
              <div className="mt-1 ml-3 pl-3 border-l border-[#111111]/35 space-y-1">
                {canViewMenu('project_client') && (
                  <button
                    type="button"
                    onClick={() => navigateSidebar('project-client')}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
                      currentMenu === 'project-client'
                        ? 'bg-[#1A2E05] text-white'
                        : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <ArrowDownLeft
                        className={`w-3.5 h-3.5 shrink-0 ${
                          currentMenu === 'project-client' ? 'text-white' : 'text-[#111111]'
                        }`}
                      />
                      <span className="truncate">Client</span>
                    </span>
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        currentMenu === 'project-client' ? 'text-white' : 'text-[#111111]'
                      }`}
                    >
                      {clientPOs.length}
                    </span>
                  </button>
                )}

                {canViewMenu('invoice') && (
                  <button
                    type="button"
                    onClick={() => navigateSidebar('invoice')}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
                      currentMenu === 'invoice'
                        ? 'bg-[#1A2E05] text-white'
                        : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Receipt
                        className={`w-3.5 h-3.5 shrink-0 ${
                          currentMenu === 'invoice' ? 'text-white' : 'text-[#111111]'
                        }`}
                      />
                      <span className="truncate">Invoice</span>
                    </span>
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        currentMenu === 'invoice' ? 'text-white' : 'text-[#111111]'
                      }`}
                    >
                      {activeInvoices.length}
                    </span>
                  </button>
                )}

                {canViewMenu('project_vendor') && (
                  <button
                    type="button"
                    onClick={() => navigateSidebar('project-vendor')}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
                      currentMenu === 'project-vendor'
                        ? 'bg-[#1A2E05] text-white'
                        : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <FileSpreadsheet
                        className={`w-3.5 h-3.5 shrink-0 ${
                          currentMenu === 'project-vendor' ? 'text-white' : 'text-[#111111]'
                        }`}
                      />
                      <span className="truncate">Vendor</span>
                    </span>
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        currentMenu === 'project-vendor' ? 'text-white' : 'text-[#111111]'
                      }`}
                    >
                      {activeOrders.length}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Audit Section */}
      {canViewMenu('log_aktivitas') && (
        <div className="pt-3 border-t border-[#65A30D] space-y-1">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#111111]/70">
            Audit
          </p>
          <button
            type="button"
            onClick={() => navigateSidebar('activity-logs')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'activity-logs'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <History
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'activity-logs' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Log Aktivitas</span>
            </span>
            <span
              className={`text-xs font-mono tabular-nums ${
                currentMenu === 'activity-logs' ? 'text-white' : 'text-[#111111]'
              }`}
            >
              {auditLogs.length}
            </span>
          </button>
        </div>
      )}

      {/* Administrasi — Khusus Super Admin */}
      {isSuperAdmin && (
        <div className="pt-3 border-t border-[#65A30D] space-y-1">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#111111]/70">
            Super Admin
          </p>
          <button
            type="button"
            onClick={() => navigateSidebar('user-management')}
            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer ${
              currentMenu === 'user-management'
                ? 'bg-[#1A2E05] text-white'
                : 'text-[#111111] hover:bg-[#A3E635] hover:text-[#111111]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Users
                className={`w-4 h-4 shrink-0 ${
                  currentMenu === 'user-management' ? 'text-white' : 'text-[#111111]'
                }`}
              />
              <span className="truncate">Manajemen User</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );

  const renderSidebarAccountFooter = () => (
    <div className="shrink-0 p-3.5 border-t border-[#65A30D] bg-[#84CC16] space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#111111] truncate">
            {authSession.user.nama || authSession.user.email}
          </p>
          <p className="text-[11px] text-[#111111]/80 truncate">{authSession.user.email}</p>
        </div>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${
            isSuperAdmin
              ? 'bg-[#1A2E05] text-white'
              : 'bg-white/40 text-[#111111] border border-[#65A30D]'
          }`}
        >
          {isSuperAdmin ? 'Super Admin' : authSession.user.role}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMobileSidebarOpen(false);
            setShowChangePasswordModal(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#111111] bg-white/85 border border-[#65A30D] hover:bg-white rounded-lg transition-colors cursor-pointer"
        >
          <KeyRound className="w-3.5 h-3.5 text-[#111111]" />
          Password
        </button>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-white/90 border border-red-300 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Left Sidebar — Fixed */}
      <aside className="app-sidebar hidden lg:flex lg:flex-col lg:fixed lg:top-0 lg:left-0 lg:z-30 lg:h-dvh w-64 shrink-0 bg-[#84CC16] border-r border-[#65A30D] print:hidden">
        <div className="h-16 shrink-0 px-4 border-b border-[#65A30D] flex items-center">
          <button
            type="button"
            onClick={() => setView(firstAllowedView)}
            className="flex items-center gap-2.5 text-left cursor-pointer min-w-0"
          >
            <div className="w-9 h-9 rounded-lg bg-white border border-[#65A30D]/40 flex items-center justify-center p-1 shrink-0">
              <img
                src="/assets/aistudio/ctribe_logo_trimmed.png"
                alt={COMPANY_INFO.name}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-[#111111] leading-snug truncate">
                {COMPANY_INFO.name}
              </p>
              <p className="text-[11px] text-[#111111] truncate">Cashflow &amp; PO Management</p>
            </div>
          </button>
        </div>

        <nav
          aria-label="Menu Utama"
          className="flex-1 min-h-0 p-3 overflow-y-auto sidebar-scroll-thin"
        >
          {renderSidebarNav()}
        </nav>

        {renderSidebarAccountFooter()}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="app-sidebar fixed inset-0 z-50 lg:hidden flex print:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[80vw] bg-[#84CC16] h-full border-r border-[#65A30D] flex flex-col">
            <div className="h-16 shrink-0 px-4 border-b border-[#65A30D] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white border border-[#65A30D]/40 flex items-center justify-center p-1 shrink-0">
                  <img
                    src="/assets/aistudio/ctribe_logo_trimmed.png"
                    alt={COMPANY_INFO.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="text-sm font-bold text-[#111111] truncate">
                  {COMPANY_INFO.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="p-1.5 text-[#111111] hover:bg-white/30 rounded-lg cursor-pointer"
                aria-label="Tutup menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav
              aria-label="Menu Mobile"
              className="flex-1 min-h-0 p-3 overflow-y-auto sidebar-scroll-thin"
            >
              {renderSidebarNav()}
            </nav>
            {renderSidebarAccountFooter()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-10 h-16 shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="lg:hidden w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0">
              <img
                src="/assets/aistudio/ctribe_logo_trimmed.png"
                alt={COMPANY_INFO.name}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 truncate">
                {currentHeader.title}
              </h1>
              <p className="hidden sm:block text-xs text-slate-500 truncate">
                {currentHeader.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            {(currentMenu === 'project-client' || currentMenu === 'invoice') &&
              view.type === 'project-client' &&
              canEditMenu('invoice') && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingClientInvoiceId(null);
                    setView({
                      type: 'client-invoice-create',
                      returnTab: view.tab,
                    });
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FilePlus2 className="w-3.5 h-3.5" />
                  Buat Invoice Client
                </button>
              )}

            {view.type === 'project-vendor' && canEditMenu('project_vendor') && (
              <button
                type="button"
                onClick={() =>
                  setView({
                    type: 'create',
                    returnTarget: { type: 'project-vendor', tab: view.tab },
                  })
                }
                className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Buat PO Vendor
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          {(!isSupabaseConfigured || dbErrorBanner) && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-300 text-xs text-red-900 flex items-start justify-between gap-3 print:hidden"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Kesalahan Database Supabase</p>
                  <p className="mt-0.5 break-all">
                    {dbErrorBanner ||
                      'VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum dikonfigurasi di environment variables. Data tidak dapat dimuat atau disimpan.'}
                  </p>
                </div>
              </div>
              {dbErrorBanner && (
                <button
                  type="button"
                  onClick={() => {
                    setDbErrorBanner(null);
                    clearDatabaseErrorBanner();
                  }}
                  className="text-red-700 hover:text-red-950 font-semibold shrink-0 cursor-pointer"
                >
                  Tutup
                </button>
              )}
            </div>
          )}
          {/* 1. PROJECTION (MAIN DASHBOARD) */}
          {view.type === 'projection' && canViewMenu('dashboard') && (
            <ProjectionReportView
              orders={orders}
              clientInvoices={clientInvoices}
              opexItems={opexItems}
              investments={investments}
              clientPOs={clientPOs}
              projectionManualItems={projectionManualItems}
              bossReportMonths={bossReportMonths}
              auditLogs={auditLogs}
              currentActor={currentActor}
              selectedMonthKey={projectionPeriod}
              cutoffPeriod={cutoffPeriod}
              onChangeMonthKey={setProjectionPeriod}
              startMonth={startMonth}
              startYear={startYear}
              endMonth={endMonth}
              endYear={endYear}
              onChangeStartPeriod={handleChangeStartPeriod}
              onChangeEndPeriod={handleChangeEndPeriod}
              onChangeRange={handleChangePeriodRange}
              onSwitchToBalance={() => {
                if (canViewMenu('realisasi')) setView({ type: 'balance' });
              }}
              onSaveBossReportMonth={handleSaveBossReportMonth}
              onSaveBossReportMonthsBatch={handleSaveBossReportMonthsBatch}
              onSyncProjectionSource={handleSyncProjectionSource}
              onLogProjectionStatusRevision={(entry) =>
                void logAuditActivity(currentActor, entry)
              }
              onPreviewPO={(po) => handleOpenPreview(po, { type: 'projection' }, false)}
              onPreviewClientInvoice={(inv) =>
                setView({
                  type: 'client-invoice-preview',
                  invoiceId: inv.id,
                  returnTab: 'client-invoices',
                })
              }
              onNavigateVendor={() => {
                if (canViewMenu('project_vendor')) {
                  setView({ type: 'project-vendor', tab: 'po-vendor' });
                }
              }}
              onNavigateClient={() => {
                if (canViewMenu('invoice')) {
                  setView({ type: 'project-client', tab: 'client-invoices' });
                } else if (canViewMenu('project_client')) {
                  setView({ type: 'project-client', tab: 'client-po' });
                }
              }}
              onNavigateOpex={() => {
                if (canViewMenu('opex')) setView({ type: 'opex' });
              }}
              onNavigateInvestment={() => {
                if (canViewMenu('investment')) setView({ type: 'investment' });
              }}
              onCreateOpex={handleCreateOpex}
              onUpdateOpex={handleUpdateOpex}
              onDeleteOpex={handleDeleteOpex}
              onCreateProjectionManualItem={handleCreateProjectionManualItem}
              onUpdateProjectionManualItem={handleUpdateProjectionManualItem}
              onDeleteProjectionManualItem={handleDeleteProjectionManualItem}
              onLoadRangeData={handleLoadRangeData}
              isLoading={loadingOrders || loadingClientInvoices}
              isBossMode={!canEditMenu('dashboard')}
              canEdit={canEditMenu('dashboard')}
            />
          )}

          {/* 1B. REALISASI (PAID ONLY) */}
          {view.type === 'balance' && canViewMenu('realisasi') && (
            <BalanceRealisasiView
              orders={orders}
              clientInvoices={clientInvoices}
              opexItems={opexItems}
              investments={investments}
              bossReportMonths={bossReportMonths}
              auditLogs={auditLogs}
              currentActor={currentActor}
              selectedMonthKey={projectionPeriod}
              cutoffPeriod={cutoffPeriod}
              onChangeMonthKey={setProjectionPeriod}
              startMonth={startMonth}
              startYear={startYear}
              endMonth={endMonth}
              endYear={endYear}
              onChangeStartPeriod={handleChangeStartPeriod}
              onChangeEndPeriod={handleChangeEndPeriod}
              onChangeRange={handleChangePeriodRange}
              onSwitchToProjection={() => {
                if (canViewMenu('dashboard')) setView({ type: 'projection' });
              }}
              onSaveBossReportMonth={handleSaveBossReportMonth}
              onSaveBossReportMonthsBatch={handleSaveBossReportMonthsBatch}
              onSyncProjectionSource={handleSyncProjectionSource}
              onLogProjectionStatusRevision={(entry) =>
                void logAuditActivity(currentActor, entry)
              }
              onNavigateOpex={() => {
                if (canViewMenu('opex')) setView({ type: 'opex' });
              }}
              onNavigateInvestment={() => {
                if (canViewMenu('investment')) setView({ type: 'investment' });
              }}
              onLoadRangeData={handleLoadRangeData}
              isLoading={loadingOrders || loadingClientInvoices}
              isBossMode={!canEditMenu('realisasi')}
              canEdit={canEditMenu('realisasi')}
            />
          )}

          {/* 1C. DETAIL SALDO REKENING & ENDING BALANCE */}
          {view.type === 'accounts' && canViewMenu('saldo_rekening') && (
            <AccountBalanceView
              orders={orders}
              clientInvoices={clientInvoices}
              opexItems={opexItems}
              investments={investments}
              bossReportMonths={bossReportMonths}
              selectedMonthKey={projectionPeriod}
              cutoffPeriod={cutoffPeriod}
              onChangeMonthKey={setProjectionPeriod}
              onSaveBossReportMonth={handleSaveBossReportMonth}
              onBackToProjection={() => setView(firstAllowedView)}
              onGoToBalance={() => {
                if (canViewMenu('realisasi')) setView({ type: 'balance' });
              }}
              isLoading={loadingOrders || loadingClientInvoices}
              canEdit={canEditMenu('saldo_rekening')}
            />
          )}

          {/* 2. OPEX */}
          {view.type === 'opex' && canViewMenu('opex') && (
            <OpexView
              opexItems={opexItems}
              bossReportMonths={bossReportMonths}
              bankAccounts={
                (
                  bossReportMonths[getTodayISODate().slice(0, 7)] ??
                  Object.values(bossReportMonths)[0] ??
                  createDefaultBossReportMonth(getTodayISODate().slice(0, 7))
                ).accounts
              }
              isLoading={false}
              canEdit={canEditMenu('opex')}
              onCreateOpex={handleCreateOpex}
              onUpdateOpex={handleUpdateOpex}
              onSetMonthStatus={handleSetOpexMonthStatus}
              onRescheduledCopyAction={handleRescheduledCopyAction}
              onDeleteOpex={handleDeleteOpex}
            />
          )}

          {/* 3. INVESTMENT */}
          {view.type === 'investment' && canViewMenu('investment') && (
            <InvestmentView
              investments={investments}
              bossReportMonths={bossReportMonths}
              selectedMonthKey={investmentPeriod}
              onChangeMonthKey={setInvestmentPeriod}
              auditLogs={auditLogs}
              isLoading={loadingInvestments}
              canEdit={canEditMenu('investment')}
              onCreateInvestment={handleCreateInvestment}
              onUpdateInvestment={handleUpdateInvestment}
              onTogglePaidMonth={handleToggleInvestmentPaidMonth}
              onSetMonthStatusWarna={handleSetInvestmentMonthStatusWarna}
              onRescheduledCopyAction={handleRescheduledCopyAction}
              onDeleteInvestment={handleDeleteInvestment}
              onAddAddendum={handleAddInvestmentAddendum}
              onImportCsv={handleImportInvestmentsCsv}
            />
          )}

          {/* 4A. PROJECT -> CLIENT / INVOICE */}
          {view.type === 'project-client' &&
            (canViewMenu('project_client') || canViewMenu('invoice')) && (
              <div className="space-y-5">
                {/* Sub-menu Tabs: PO Client | Invoice Client - Cash In | Piutang */}
                <div className="bg-white border border-slate-200 rounded-xl p-1.5 inline-flex flex-wrap gap-1 shadow-xs">
                  {canViewMenu('project_client') && (
                    <button
                      type="button"
                      onClick={() =>
                        setView({ type: 'project-client', tab: 'client-po' })
                      }
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        view.tab === 'client-po'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>PO Client</span>
                      <span
                        className={`font-mono tabular-nums ${
                          view.tab === 'client-po' ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      >
                        {clientPOs.length}
                      </span>
                    </button>
                  )}

                  {canViewMenu('invoice') && (
                    <button
                      type="button"
                      onClick={() =>
                        setView({ type: 'project-client', tab: 'client-invoices' })
                      }
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        view.tab === 'client-invoices'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <ArrowDownLeft className="w-3.5 h-3.5" />
                      <span>Invoice Client - Cash In</span>
                      <span
                        className={`font-mono tabular-nums ${
                          view.tab === 'client-invoices'
                            ? 'text-slate-300'
                            : 'text-slate-400'
                        }`}
                      >
                        {activeInvoices.length}
                      </span>
                    </button>
                  )}

                  {canViewMenu('project_client') && (
                    <button
                      type="button"
                      onClick={() =>
                        setView({ type: 'project-client', tab: 'receivables' })
                      }
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        view.tab === 'receivables'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Piutang</span>
                      <span
                        className={`font-mono tabular-nums ${
                          view.tab === 'receivables' ? 'text-amber-300' : 'text-amber-600'
                        }`}
                      >
                        {receivablesCount}
                      </span>
                    </button>
                  )}
                </div>

                {view.tab === 'client-po' && canViewMenu('project_client') && (
                  <ClientPOView
                    clientPOs={clientPOs}
                    clientInvoices={clientInvoices}
                    isLoading={loadingClientInvoices}
                    canEdit={canEditMenu('project_client')}
                    canCreateInvoice={canEditMenu('invoice')}
                    onCreateClientPO={handleCreateClientPO}
                    onUpdateClientPO={handleUpdateClientPO}
                    onDeleteClientPO={handleDeleteClientPO}
                    onCreateInvoiceFromPO={(cpo) => {
                      setEditingClientInvoiceId(null);
                      setView({
                        type: 'client-invoice-create',
                        prefillFromClientPO: cpo,
                        returnTab: 'client-po',
                      });
                    }}
                  />
                )}

                {view.tab === 'client-invoices' && canViewMenu('invoice') && (
                  <ClientInvoiceListView
                    invoices={clientInvoices}
                    bossReportMonths={bossReportMonths}
                    isLoading={loadingClientInvoices}
                    permissions={clientInvoicePermissions}
                    currentActor={currentActor}
                    onCreateNew={() => {
                      setEditingClientInvoiceId(null);
                      setView({
                        type: 'client-invoice-create',
                        returnTab: 'client-invoices',
                      });
                    }}
                    onView={(inv) => handleEdit(inv, 'view', 'client-invoices')}
                    onEdit={(inv) => handleEdit(inv, 'edit', 'client-invoices')}
                    onDuplicate={(inv) => {
                      setEditingClientInvoiceId(null);
                      setView({
                        type: 'client-invoice-create',
                        duplicateFrom: inv,
                        returnTab: 'client-invoices',
                      });
                    }}
                    onSendInvoice={handleSendClientInvoice}
                    onMarkPaid={handleMarkClientInvoicePaid}
                    onChangeStatusWarna={handleChangeClientInvoiceStatusWarna}
                    onRescheduledCopyAction={handleRescheduledCopyAction}
                    onReviseInvoice={handleReviseClientInvoice}
                    onDelete={handleSoftDeleteClientInvoice}
                    onRestore={handleRestoreClientInvoice}
                    onPermanentDelete={handlePermanentDeleteClientInvoice}
                    onUpdatePrintOptions={updateClientInvoicePrintOptions}
                  />
                )}

                {view.tab === 'receivables' && canViewMenu('project_client') && (
                  <ClientReceivablesView
                    invoices={clientInvoices}
                    bossReportMonths={bossReportMonths}
                    isLoading={loadingClientInvoices}
                    canEdit={canEditMenu('project_client')}
                    onViewInvoice={(inv) => handleEdit(inv, 'view', 'receivables')}
                    onMarkPaid={handleMarkClientInvoicePaid}
                    onChangeStatusWarna={handleChangeClientInvoiceStatusWarna}
                    onRescheduledCopyAction={handleRescheduledCopyAction}
                  />
                )}
              </div>
            )}

          {/* 4B. PROJECT -> VENDOR */}
          {view.type === 'project-vendor' && canViewMenu('project_vendor') && (
            <div className="space-y-5">
              {/* Sub-menu Tabs: PO Vendor | Tagihan Vendor - Cash Out Project Cost */}
              <div className="bg-white border border-slate-200 rounded-xl p-1.5 inline-flex flex-wrap gap-1 shadow-xs">
                <button
                  type="button"
                  onClick={() =>
                    setView({ type: 'project-vendor', tab: 'po-vendor' })
                  }
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    view.tab === 'po-vendor'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>PO Vendor</span>
                  <span
                    className={`font-mono tabular-nums ${
                      view.tab === 'po-vendor' ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {activeOrders.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setView({ type: 'project-vendor', tab: 'vendor-bills' })
                  }
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    view.tab === 'vendor-bills'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>Tagihan Vendor - Cash Out Project Cost</span>
                  <span
                    className={`font-mono tabular-nums ${
                      view.tab === 'vendor-bills' ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {billedVendorCount}
                  </span>
                </button>

                {unbilledVendorCount > 0 && (
                  <span className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 rounded-lg font-mono tabular-nums">
                    {unbilledVendorCount} PO belum ditagih
                  </span>
                )}
              </div>

              <ProjectVendorSummary orders={orders} bossReportMonths={bossReportMonths} />

              {view.tab === 'po-vendor' && (
                <POListView
                  orders={orders}
                  bossReportMonths={bossReportMonths}
                  isLoading={loadingOrders}
                  permissions={vendorPermissions}
                  currentActor={currentActor}
                  onCreateNew={() =>
                    setView({
                      type: 'create',
                      returnTarget: { type: 'project-vendor', tab: 'po-vendor' },
                    })
                  }
                  onPreview={(po) =>
                    handleOpenPreview(
                      po,
                      { type: 'project-vendor', tab: 'po-vendor' },
                      false
                    )
                  }
                  onPrint={(po) =>
                    handleOpenPreview(
                      po,
                      { type: 'project-vendor', tab: 'po-vendor' },
                      true
                    )
                  }
                  onEdit={(po) =>
                    setView({
                      type: 'edit',
                      poId: po.id,
                      returnTarget: { type: 'project-vendor', tab: 'po-vendor' },
                    })
                  }
                  onDuplicate={(po) =>
                    setView({
                      type: 'create',
                      duplicateFrom: po,
                      returnTarget: { type: 'project-vendor', tab: 'po-vendor' },
                    })
                  }
                  onStatusChange={handleStatusChange}
                  onSubmitPph={handleSubmitVendorPOPph}
                  onCancelInvoice={handleCancelPOInvoice}
                  onCancelPaid={handleCancelPOPaid}
                  onChangeStatusWarna={handleChangePOStatusWarna}
                  onRescheduledCopyAction={handleRescheduledCopyAction}
                  onRevisePO={handleRevisePO}
                  onDelete={handleSoftDeletePO}
                  onRestore={handleRestorePO}
                  onPermanentDelete={handlePermanentDeletePO}
                />
              )}

              {view.tab === 'vendor-bills' && (
                <InvoicedPOView
                  orders={orders}
                  bossReportMonths={bossReportMonths}
                  isLoading={loadingOrders}
                  permissions={vendorPermissions}
                  currentActor={currentActor}
                  onGoToList={() =>
                    setView({ type: 'project-vendor', tab: 'po-vendor' })
                  }
                  onPreview={(po) =>
                    handleOpenPreview(
                      po,
                      { type: 'project-vendor', tab: 'vendor-bills' },
                      false
                    )
                  }
                  onPrint={(po) =>
                    handleOpenPreview(
                      po,
                      { type: 'project-vendor', tab: 'vendor-bills' },
                      true
                    )
                  }
                  onStatusChange={handleStatusChange}
                  onSubmitPph={handleSubmitVendorPOPph}
                  onCancelInvoice={handleCancelPOInvoice}
                  onCancelPaid={handleCancelPOPaid}
                  onChangeStatusWarna={handleChangePOStatusWarna}
                  onRescheduledCopyAction={handleRescheduledCopyAction}
                  onRevisePO={handleRevisePO}
                />
              )}
            </div>
          )}

          {/* CLIENT INVOICE CREATE / EDIT */}
          {(view.type === 'client-invoice-create' ||
            view.type === 'client-invoice-edit') && (
            <ClientInvoiceFormView
              key={
                view.type === 'client-invoice-edit'
                  ? `edit-${editingClientInvoiceId ?? view.invoiceId}-${view.mode ?? 'edit'}`
                  : `create-${view.prefillFromClientPO?.id ?? view.duplicateFrom?.id ?? 'new'}`
              }
              existingInvoices={clientInvoices}
              existingPOs={orders}
              editingId={
                view.type === 'client-invoice-edit'
                  ? editingClientInvoiceId ?? view.invoiceId
                  : null
              }
              editingInvoice={editingClientInvoice}
              duplicateFrom={
                view.type === 'client-invoice-create'
                  ? view.duplicateFrom ?? null
                  : null
              }
              prefillFromClientPO={
                view.type === 'client-invoice-create'
                  ? view.prefillFromClientPO ?? null
                  : null
              }
              mode={view.type === 'client-invoice-edit' ? view.mode ?? 'edit' : 'edit'}
              permissions={clientInvoicePermissions}
              currentActor={currentActor}
              onCancel={() => {
                setEditingClientInvoiceId(null);
                setView({ type: 'project-client', tab: view.returnTab });
              }}
              onSave={handleSaveClientInvoice}
              onSendInvoice={handleSendClientInvoice}
              onReviseInvoice={handleReviseClientInvoice}
              onUpdatePrintOptions={updateClientInvoicePrintOptions}
            />
          )}

          {/* VENDOR PO CREATE / EDIT */}
          {(view.type === 'create' || view.type === 'edit') &&
            canEditMenu('project_vendor') && (
              <POFormView
                key={view.type === 'edit' ? view.poId : view.duplicateFrom?.id ?? 'new'}
                existingPOs={orders}
                editingPO={editingPO}
                duplicateFrom={view.type === 'create' ? view.duplicateFrom ?? null : null}
                onCancel={() => setView(view.returnTarget)}
                onSave={handleSavePO}
              />
            )}

          {/* AUDIT LOG */}
          {view.type === 'activity-logs' && canViewMenu('log_aktivitas') && (
            <ActivityLogView
              logs={auditLogs}
              orders={orders}
              clientInvoices={clientInvoices}
              clientPOs={clientPOs}
              opexItems={opexItems}
              investments={investments}
              isSuperAdmin={isSuperAdmin}
              onDeleteSelectedLogs={handleDeleteSelectedAuditLogs}
              onDeleteAllLogs={handleDeleteAllAuditLogs}
            />
          )}

          {/* MANAJEMEN USER (KHUSUS SUPER ADMIN) */}
          {view.type === 'user-management' && isSuperAdmin && (
            <UserManagementView
              currentActor={currentActor}
              onLogActivity={(entry) => void logAuditActivity(currentActor, entry)}
              onPermissionsUpdated={handleRefreshCurrentProfile}
            />
          )}
        </main>
      </div>

      <ChangePasswordModal
        isOpen={showChangePasswordModal}
        userEmail={authSession.user.email}
        onClose={() => setShowChangePasswordModal(false)}
      />

      {partialFetchToastNode}
      {actionToastNode}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <PurchaseOrderApp />
    </ErrorBoundary>
  );
}
