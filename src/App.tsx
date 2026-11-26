/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowRightCircle,
  Download,
  Plus,
  Calendar,
  Laptop,
  WifiOff,
  RefreshCw,
  LogOut,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import {
  AccountBlockId,
  AccountBlockMeta,
  BoletoSubType,
  ExpenseItem,
  IncomeItem,
  MonthLedger,
} from './types/finance';
import {
  INITIAL_OCTOBER_2026,
  generateNextMonthLedger,
  getEffectiveBlocks,
} from './data/initialData';
import {
  calculateFinancialSummary,
  formatCurrency,
  formatDateBR,
  formatInstallment,
} from './utils/formatters';
import { OverviewTab } from './components/OverviewTab';
import { CardsAccountsTab } from './components/CardsAccountsTab';
import { BoletosPixTab } from './components/BoletosPixTab';
import { ReportsTab } from './components/ReportsTab';
import { TransactionModal } from './components/TransactionModal';
import { InstallNotebookModal } from './components/InstallNotebookModal';
import {
  LoginScreen,
  LoggedUserSession,
  UnauthorizedGoogleUser,
} from './components/LoginScreen';
import { AppUpdateBannerModal } from './components/AppUpdateBannerModal';
import { AccessControlModal } from './components/AccessControlModal';
import {
  WhatsAppPixModal,
  ParsedReceiptPayload,
  WhatsAppInboxItemClient,
} from './components/WhatsAppPixModal';
import { CURRENT_APP_VERSION } from './data/appVersion';
import { usePWAInstall, useOnlineStatus } from './hooks/usePWAInstall';
import {
  auth,
  onAuthStateChanged,
  User as FirebaseAuthUser,
  AccessControlState,
  PRIMARY_ADMIN_EMAIL,
  normalizeEmail,
  fetchAccessControlState,
  subscribeToAccessControl,
  testFirestoreConnection,
  subscribeToHouseholdCloud,
  saveHouseholdStateToCloud,
  fetchLatestHouseholdStateFromServer,
  signOutFirebase,
} from './services/firebase';

type ActiveTab = 'overview' | 'cards' | 'boletos' | 'reports';

const STORAGE_KEY = 'domus_household_ledgers_v1';
const ACTIVE_MONTH_STORAGE_KEY = 'domus_active_month_v1';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accessControlLoaded, setAccessControlLoaded] = useState(false);
  const [accessControl, setAccessControl] = useState<AccessControlState>({
    authorizedUsers: [
      {
        id: 'auth-primary-admin',
        email: PRIMARY_ADMIN_EMAIL,
        memberProfile: 'Rodolfo',
        isAdmin: true,
        addedAt: '2026-10-01',
      },
    ],
    pendingRequests: [],
  });
  const [loggedUser, setLoggedUser] = useState<LoggedUserSession | null>(null);
  const [unauthorizedUser, setUnauthorizedUser] = useState<UnauthorizedGoogleUser | null>(null);
  const [accessModalOpen, setAccessModalOpen] = useState(false);

  const [ledgers, setLedgers] = useState<MonthLedger[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial October 2026 data
    }
    return [INITIAL_OCTOBER_2026];
  });

  const [activeMonthKey, setActiveMonthKey] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_MONTH_STORAGE_KEY) || '2026-10';
    } catch {
      return '2026-10';
    }
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [focusedBlockId, setFocusedBlockId] = useState<AccountBlockId | null>(null);

  // Cloud Sync State
  const [cloudStatus, setCloudStatus] = useState<'connecting' | 'synced' | 'saving' | 'error'>(
    'connecting'
  );
  const [lastCloudAction, setLastCloudAction] = useState<string>(
    'Sincronizando com a nuvem...'
  );
  const [lastCloudTime, setLastCloudTime] = useState<Date | null>(null);
  const [isRefreshingCloud, setIsRefreshingCloud] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'expense' | 'income'>('expense');
  const [modalDefaultBlock, setModalDefaultBlock] = useState<AccountBlockId>('outras');
  const [modalDefaultBoletoSubType, setModalDefaultBoletoSubType] =
    useState<BoletoSubType>('fixa');
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [editingIncome, setEditingIncome] = useState<IncomeItem | null>(null);

  // Install Notebook / Portable App Modal state
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false);
  const [pendingWhatsAppItems, setPendingWhatsAppItems] = useState<
    WhatsAppInboxItemClient[]
  >([]);
  const { isInstallable, isInstalled, install: triggerPWAInstall } = usePWAInstall();
  const isOnline = useOnlineStatus();

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    if (!loggedUser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ledgers));
    } catch {
      // Ignore storage quota errors
    }
  }, [ledgers, loggedUser]);

  useEffect(() => {
    if (!loggedUser) return;
    try {
      localStorage.setItem(ACTIVE_MONTH_STORAGE_KEY, activeMonthKey);
    } catch {
      // Ignore
    }
  }, [activeMonthKey, loggedUser]);

  // 1. Track Firebase Google Authentication state
  useEffect(() => {
    void testFirestoreConnection();
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsubAuth();
  }, []);

  // 2. Real-time subscription to Approved Google Accounts & Pending Requests
  useEffect(() => {
    const unsubAccess = subscribeToAccessControl((state) => {
      setAccessControl(state);
      setAccessControlLoaded(true);
    });
    return () => unsubAccess();
  }, []);

  // 3. Enforce strict whitelist gating whenever auth user or approved list changes
  useEffect(() => {
    if (!authReady || !accessControlLoaded) return;

    if (!firebaseUser || !firebaseUser.email) {
      setLoggedUser(null);
      setUnauthorizedUser(null);
      return;
    }

    const emailNorm = normalizeEmail(firebaseUser.email);
    const approvedEntry = accessControl.authorizedUsers.find(
      (u) => normalizeEmail(u.email) === emailNorm
    );

    if (!approvedEntry) {
      // Strictly block any unapproved Google account (including live revocation)
      setLoggedUser(null);
      setUnauthorizedUser({
        email: emailNorm,
        displayName: firebaseUser.displayName || emailNorm.split('@')[0],
        photoURL: firebaseUser.photoURL,
      });
      return;
    }

    setUnauthorizedUser(null);
    setLoggedUser((prev) => {
      if (
        prev &&
        prev.email === approvedEntry.email &&
        prev.role === approvedEntry.memberProfile &&
        prev.isAdmin === approvedEntry.isAdmin
      ) {
        return prev;
      }
      return {
        name: approvedEntry.memberProfile,
        role: approvedEntry.memberProfile,
        email: approvedEntry.email,
        photoURL: firebaseUser.photoURL,
        isAdmin: approvedEntry.isAdmin,
        loginTime: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    });
  }, [authReady, accessControlLoaded, firebaseUser, accessControl]);

  // 4. Real-time Cloud Financial Sync — ONLY active after authenticated & approved Google login
  useEffect(() => {
    if (!loggedUser) return;

    const unsubscribe = subscribeToHouseholdCloud(
      (cloudLedgers) => {
        setLedgers(cloudLedgers);
      },
      (workspaceState) => {
        if (workspaceState.activeMonthKey) {
          setActiveMonthKey(workspaceState.activeMonthKey);
        }
        if (workspaceState.lastAction) {
          setLastCloudAction(workspaceState.lastAction);
        }
        if (workspaceState.updatedAt) {
          setLastCloudTime(workspaceState.updatedAt);
        }
      },
      (status) => {
        setCloudStatus(status);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [loggedUser?.email]);

  // Triggered right after Google popup sign-in to verify freshly from server
  const handleGoogleAuthCompleted = async () => {
    const freshAccess = await fetchAccessControlState();
    setAccessControl(freshAccess);
    setAccessControlLoaded(true);

    const current = auth.currentUser;
    if (!current || !current.email) return;

    const emailNorm = normalizeEmail(current.email);
    const approvedEntry = freshAccess.authorizedUsers.find(
      (u) => normalizeEmail(u.email) === emailNorm
    );
    if (!approvedEntry) {
      setLoggedUser(null);
      setUnauthorizedUser({
        email: emailNorm,
        displayName: current.displayName || emailNorm.split('@')[0],
        photoURL: current.photoURL,
      });
      return;
    }

    setCloudStatus('connecting');
    try {
      const latestSnapshot = await fetchLatestHouseholdStateFromServer();
      setLedgers(latestSnapshot.ledgers);
      setActiveMonthKey(latestSnapshot.workspace.activeMonthKey);
      setLastCloudAction(latestSnapshot.workspace.lastAction);
      setLastCloudTime(latestSnapshot.workspace.updatedAt || new Date());
      setCloudStatus('synced');
      showToast(
        `Login Google aprovado (${approvedEntry.memberProfile})! Planilha sincronizada com a nuvem.`
      );
    } catch {
      setCloudStatus('error');
    }
  };

  // Manual 1-click refresh from server inside workspace toolbar
  const handleManualCloudRefresh = async () => {
    setIsRefreshingCloud(true);
    setCloudStatus('connecting');
    try {
      const latestSnapshot = await fetchLatestHouseholdStateFromServer();
      setLedgers(latestSnapshot.ledgers);
      setActiveMonthKey(latestSnapshot.workspace.activeMonthKey);
      setLastCloudAction(latestSnapshot.workspace.lastAction);
      setLastCloudTime(latestSnapshot.workspace.updatedAt || new Date());
      setCloudStatus('synced');
      showToast('Dados recarregados da nuvem com sucesso!');
    } catch {
      setCloudStatus('error');
      showToast('Não foi possível conectar ao servidor agora.');
    } finally {
      setIsRefreshingCloud(false);
    }
  };

  const handleLogout = async () => {
    await signOutFirebase();
    setLoggedUser(null);
    setUnauthorizedUser(null);
    setAccessModalOpen(false);
  };

  const currentLedger = useMemo(() => {
    return ledgers.find((l) => l.monthKey === activeMonthKey) || ledgers[0];
  }, [ledgers, activeMonthKey]);

  const summary = useMemo(() => {
    return calculateFinancialSummary(currentLedger);
  }, [currentLedger]);

  const withUserPrefix = (action: string) => {
    return loggedUser ? `${loggedUser.name}: ${action}` : action;
  };

  // Mutate current ledger locally AND persist immediately to Firebase Cloud
  const mutateAndSyncCurrentLedger = (
    updater: (ledger: MonthLedger) => MonthLedger,
    actionDescription: string
  ) => {
    const taggedAction = withUserPrefix(actionDescription);
    const updatedLedger = updater(currentLedger);
    const nextLedgers = ledgers.map((l) =>
      l.monthKey === currentLedger.monthKey ? updatedLedger : l
    );
    setLedgers(nextLedgers);
    setCloudStatus('saving');
    setLastCloudAction(taggedAction);
    setLastCloudTime(new Date());

    saveHouseholdStateToCloud(nextLedgers, currentLedger.monthKey, taggedAction)
      .then(() => {
        setCloudStatus('synced');
      })
      .catch(() => {
        setCloudStatus('error');
      });
  };

  // Create a new Cartão or Conta Bancária across ledgers
  const handleAddCustomBlock = (newBlock: AccountBlockMeta) => {
    const taggedAction = withUserPrefix(
      `Criado ${newBlock.kind === 'conta' ? 'nova conta' : 'novo cartão'}: ${newBlock.shortName}`
    );
    const nextLedgers = ledgers.map((l) => {
      const currentBlocks = getEffectiveBlocks(l);
      const outrasBlock = currentBlocks.find((b) => b.id === 'outras');
      const cardAndAccountBlocks = currentBlocks.filter((b) => b.id !== 'outras');
      const updatedCustomBlocks = [
        ...cardAndAccountBlocks,
        newBlock,
        ...(outrasBlock ? [outrasBlock] : []),
      ];
      return {
        ...l,
        customBlocks: updatedCustomBlocks,
      };
    });

    setLedgers(nextLedgers);
    setCloudStatus('saving');
    setLastCloudAction(taggedAction);
    setLastCloudTime(new Date());

    saveHouseholdStateToCloud(nextLedgers, currentLedger.monthKey, taggedAction)
      .then(() => setCloudStatus('synced'))
      .catch(() => setCloudStatus('error'));

    showToast(
      `${newBlock.fullTitle} criado e sincronizado na nuvem!`
    );
  };

  // Delete a Cartão or Conta Bancária block and its associated expenses in the current month
  const handleDeleteCustomBlock = (blockId: AccountBlockId) => {
    const targetBlock = getEffectiveBlocks(currentLedger).find((b) => b.id === blockId);
    const taggedAction = withUserPrefix(
      `Excluído ${targetBlock?.fullTitle || blockId}`
    );

    const nextLedgers = ledgers.map((l) => {
      const currentBlocks = getEffectiveBlocks(l);
      const updatedCustomBlocks = currentBlocks.filter((b) => b.id !== blockId);
      return {
        ...l,
        customBlocks: updatedCustomBlocks,
        expenses: l.expenses.filter((e) => e.blockId !== blockId),
      };
    });

    if (focusedBlockId === blockId) {
      setFocusedBlockId(null);
    }

    setLedgers(nextLedgers);
    setCloudStatus('saving');
    setLastCloudAction(taggedAction);
    setLastCloudTime(new Date());

    saveHouseholdStateToCloud(nextLedgers, currentLedger.monthKey, taggedAction)
      .then(() => setCloudStatus('synced'))
      .catch(() => setCloudStatus('error'));

    showToast(
      `${targetBlock?.fullTitle || 'Bloco'} excluído e sincronizado na nuvem.`
    );
  };

  const handleSelectMonth = (newMonthKey: string) => {
    setActiveMonthKey(newMonthKey);
    const target = ledgers.find((l) => l.monthKey === newMonthKey);
    if (target) {
      const actionText = withUserPrefix(`Visualizando ${target.label}`);
      setLastCloudAction(actionText);
      void saveHouseholdStateToCloud(ledgers, newMonthKey, actionText).catch(
        () => {}
      );
    }
  };

  const handleToggleExpenseStatus = (expenseId: string) => {
    const targetExp = currentLedger.expenses.find((e) => e.id === expenseId);
    const nextStatus = targetExp?.status === 'Pago' ? 'Pendente' : 'Pago';
    const actionText = targetExp
      ? `${targetExp.description} marcado como ${nextStatus}`
      : 'Status de conta atualizado';

    mutateAndSyncCurrentLedger(
      (ledger) => ({
        ...ledger,
        expenses: ledger.expenses.map((exp) =>
          exp.id === expenseId
            ? { ...exp, status: exp.status === 'Pago' ? 'Pendente' : 'Pago' }
            : exp
        ),
      }),
      actionText
    );
  };

  const handleMarkBlockPaid = (blockId: AccountBlockId) => {
    mutateAndSyncCurrentLedger(
      (ledger) => ({
        ...ledger,
        expenses: ledger.expenses.map((exp) =>
          exp.blockId === blockId ? { ...exp, status: 'Pago' } : exp
        ),
      }),
      `Bloco ${blockId} quitado em ${currentLedger.label}`
    );
    showToast('Todas as contas do bloco foram marcadas como Pagas e salvas na nuvem.');
  };

  const handleSaveExpense = (
    expenseData: Omit<ExpenseItem, 'id'>,
    existingId?: string
  ) => {
    if (existingId) {
      mutateAndSyncCurrentLedger(
        (ledger) => ({
          ...ledger,
          expenses: ledger.expenses.map((exp) =>
            exp.id === existingId ? { ...expenseData, id: existingId } : exp
          ),
        }),
        `Despesa editada: ${expenseData.description} (${formatCurrency(expenseData.amount)})`
      );
      showToast(`Despesa "${expenseData.description}" atualizada na nuvem.`);
    } else {
      const newId = `exp-${Date.now()}`;
      mutateAndSyncCurrentLedger(
        (ledger) => ({
          ...ledger,
          expenses: [...ledger.expenses, { ...expenseData, id: newId }],
        }),
        `Novo gasto: ${expenseData.description} (${formatCurrency(expenseData.amount)})`
      );
      showToast(
        `Despesa "${expenseData.description}" salva automaticamente na nuvem.`
      );
    }
  };

  const handleDeleteExpense = (expenseId: string) => {
    const target = currentLedger.expenses.find((e) => e.id === expenseId);
    mutateAndSyncCurrentLedger(
      (ledger) => ({
        ...ledger,
        expenses: ledger.expenses.filter((exp) => exp.id !== expenseId),
      }),
      target ? `Despesa excluída: ${target.description}` : 'Despesa excluída'
    );
    if (target) {
      showToast(`Despesa "${target.description}" removida da nuvem.`);
    }
  };

  const handleSaveIncome = (
    incomeData: Omit<IncomeItem, 'id'>,
    existingId?: string
  ) => {
    if (existingId) {
      mutateAndSyncCurrentLedger(
        (ledger) => ({
          ...ledger,
          incomes: ledger.incomes.map((inc) =>
            inc.id === existingId ? { ...incomeData, id: existingId } : inc
          ),
        }),
        `Entrada editada: ${incomeData.person} - ${incomeData.description}`
      );
      showToast(`Entrada "${incomeData.description}" atualizada na nuvem.`);
    } else {
      const newId = `inc-${Date.now()}`;
      mutateAndSyncCurrentLedger(
        (ledger) => ({
          ...ledger,
          incomes: [...ledger.incomes, { ...incomeData, id: newId }],
        }),
        `Nova entrada: ${incomeData.person} - ${incomeData.description} (${formatCurrency(
          incomeData.amount
        )})`
      );
      showToast(`Entrada "${incomeData.description}" salva na nuvem.`);
    }
  };

  const handleDeleteIncome = (incomeId: string) => {
    const target = currentLedger.incomes.find((i) => i.id === incomeId);
    mutateAndSyncCurrentLedger(
      (ledger) => ({
        ...ledger,
        incomes: ledger.incomes.filter((inc) => inc.id !== incomeId),
      }),
      target ? `Entrada removida: ${target.description}` : 'Entrada removida'
    );
    showToast('Entrada removida e sincronizada na nuvem.');
  };

  const handleGenerateNextMonth = () => {
    const nextMonthNum = currentLedger.month === 12 ? 1 : currentLedger.month + 1;
    const nextYearNum =
      currentLedger.month === 12 ? currentLedger.year + 1 : currentLedger.year;
    const targetKey = `${nextYearNum}-${String(nextMonthNum).padStart(2, '0')}`;

    const existing = ledgers.find((l) => l.monthKey === targetKey);
    if (existing) {
      handleSelectMonth(existing.monthKey);
      showToast(`Alternado para ${existing.label}.`);
      return;
    }

    const generated = generateNextMonthLedger(currentLedger);
    const nextLedgers = [...ledgers, generated];
    setLedgers(nextLedgers);
    setActiveMonthKey(generated.monthKey);
    setCloudStatus('saving');

    const actionText = withUserPrefix(
      `Gerado ${generated.label} a partir de ${currentLedger.label}`
    );
    setLastCloudAction(actionText);
    setLastCloudTime(new Date());

    saveHouseholdStateToCloud(nextLedgers, generated.monthKey, actionText)
      .then(() => setCloudStatus('synced'))
      .catch(() => setCloudStatus('error'));

    const finishedCount = generated.completedInstallmentsFromPrev?.length || 0;
    if (finishedCount > 0) {
      showToast(
        `${generated.label} gerado e salvo na nuvem! ${finishedCount} parcelamento(s) encerraram.`
      );
    } else {
      showToast(
        `${generated.label} gerado e salvo na nuvem com avanço automático de parcelas.`
      );
    }
  };

  const handleRestoreInitialData = () => {
    const initialList = [INITIAL_OCTOBER_2026];
    setLedgers(initialList);
    setActiveMonthKey('2026-10');
    setCloudStatus('saving');
    const actionText = withUserPrefix(
      'Planilha restaurada para Outubro de 2026 original'
    );
    setLastCloudAction(actionText);
    setLastCloudTime(new Date());

    saveHouseholdStateToCloud(initialList, '2026-10', actionText)
      .then(() => setCloudStatus('synced'))
      .catch(() => setCloudStatus('error'));

    showToast('Planilha restaurada e sincronizada na nuvem (Outubro de 2026).');
  };

  const handleExportCSV = () => {
    const headers = [
      'Tipo',
      'Bloco / Pessoa',
      'Descricao',
      'Categoria',
      'Data / Vencimento',
      'Parcelas',
      'Valor (R$)',
      'Status',
    ];
    const rows: string[][] = [];

    for (const inc of currentLedger.incomes) {
      rows.push([
        'Entrada',
        inc.person,
        inc.description,
        'Receita Familiar',
        formatDateBR(inc.date),
        '---',
        inc.amount.toFixed(2).replace('.', ','),
        'Recebido',
      ]);
    }

    for (const exp of currentLedger.expenses) {
      rows.push([
        'Despesa',
        exp.blockId,
        exp.description,
        exp.category,
        formatDateBR(exp.dueDate),
        formatInstallment(exp.currentInstallment, exp.totalInstallments),
        exp.amount.toFixed(2).replace('.', ','),
        exp.status,
      ]);
    }

    const csvContent =
      '\uFEFF' +
      [headers.join(';'), ...rows.map((r) => r.map((c) => `"${c}"`).join(';'))].join(
        '\n'
      );

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contas-casa-${currentLedger.monthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Planilha ${currentLedger.label} exportada em CSV (compatível com Excel).`);
  };

  const openNewTransactionModal = (
    mode: 'expense' | 'income',
    blockId: AccountBlockId = 'outras',
    boletoSubType: BoletoSubType = 'fixa'
  ) => {
    setEditingExpense(null);
    setEditingIncome(null);
    setModalMode(mode);
    setModalDefaultBlock(blockId);
    setModalDefaultBoletoSubType(boletoSubType);
    setModalOpen(true);
  };

  const handleApplyParsedTransaction = (
    parsed: ParsedReceiptPayload,
    sourceLabel: string
  ) => {
    if (parsed.transactionType === 'income') {
      const newIncome: IncomeItem = {
        id: `inc-pix-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        person: parsed.person,
        description: parsed.description,
        amount: parsed.amount,
        date: parsed.date,
      };
      mutateAndSyncCurrentLedger(
        (ledger) => ({
          ...ledger,
          incomes: [...ledger.incomes, newIncome],
        }),
        `${sourceLabel} — Entrada: ${parsed.person} (${parsed.description} · ${formatCurrency(parsed.amount)})`
      );
      showToast(
        `Entrada lançada automaticamente em Visão Geral: ${parsed.description} (${formatCurrency(parsed.amount)})`
      );
      return;
    }

    if (parsed.action === 'mark_existing_paid' && parsed.matchedExistingExpenseId) {
      const targetId = parsed.matchedExistingExpenseId;
      mutateAndSyncCurrentLedger(
        (ledger) => ({
          ...ledger,
          expenses: ledger.expenses.map((exp) =>
            exp.id === targetId
              ? {
                  ...exp,
                  status: 'Pago',
                  notes: exp.notes
                    ? `${exp.notes} · Baixa via ${sourceLabel}`
                    : `Baixa automática via ${sourceLabel}`,
                }
              : exp
          ),
        }),
        `${sourceLabel} — Quitado: ${parsed.matchedExistingDescription || parsed.description}`
      );
      showToast(
        `Baixa automática aplicada! "${parsed.matchedExistingDescription || parsed.description}" marcada como Paga.`
      );
      return;
    }

    const newExpense: ExpenseItem = {
      id: `exp-pix-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      description: parsed.description,
      dueDate: parsed.date,
      currentInstallment: parsed.currentInstallment,
      totalInstallments: parsed.totalInstallments,
      amount: parsed.amount,
      status: parsed.status,
      blockId: parsed.blockId,
      category: parsed.category,
      isRecurringFixed: parsed.boletoSubType === 'fixa',
      boletoSubType: parsed.boletoSubType,
      notes: `Lançado via ${sourceLabel}`,
    };

    mutateAndSyncCurrentLedger(
      (ledger) => ({
        ...ledger,
        expenses: [...ledger.expenses, newExpense],
      }),
      `${sourceLabel} — ${parsed.description} (${formatCurrency(parsed.amount)})`
    );
    showToast(
      `Lançado automaticamente em ${parsed.destinationLabel}: ${parsed.description} (${formatCurrency(parsed.amount)})`
    );
  };

  const handleAcknowledgeWhatsAppItem = async (id: string) => {
    setPendingWhatsAppItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await fetch(`/api/whatsapp/inbox/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
      });
    } catch {
      // Ignore network errors
    }
  };

  const handleNavigateToParsedDestination = (parsed: ParsedReceiptPayload) => {
    if (parsed.transactionType === 'income') {
      handleNavigateTab('overview');
      return;
    }
    if (parsed.blockId && parsed.blockId !== 'outras') {
      handleNavigateTab('cards', parsed.blockId);
      return;
    }
    handleNavigateTab('boletos');
  };

  // Sync current spreadsheet blocks & pending bills to server so real WhatsApp webhooks classify accurately
  useEffect(() => {
    if (!loggedUser) return;
    const effectiveBlocks = getEffectiveBlocks(currentLedger);
    void fetch('/api/whatsapp/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeMonthKey: currentLedger.monthKey,
        blocks: effectiveBlocks.map((b) => ({
          id: b.id,
          shortName: b.shortName,
          fullTitle: b.fullTitle,
          group: b.group,
        })),
        existingExpenses: currentLedger.expenses.map((e) => ({
          id: e.id,
          description: e.description,
          amount: e.amount,
          dueDate: e.dueDate,
          status: e.status,
          blockId: e.blockId,
          category: e.category,
        })),
      }),
    }).catch(() => {});
  }, [loggedUser, currentLedger]);

  // Poll incoming messages from connected WhatsApp number
  useEffect(() => {
    if (!loggedUser) return;
    let active = true;

    const pollInbox = async () => {
      try {
        const res = await fetch('/api/whatsapp/inbox');
        if (!res.ok || !active) return;
        const data = await res.json();
        const items: WhatsAppInboxItemClient[] = Array.isArray(data?.items)
          ? data.items
          : [];
        if (active) {
          setPendingWhatsAppItems(items);
        }
      } catch {
        // Offline or dev server unavailable
      }
    };

    void pollInbox();
    const interval = window.setInterval(() => {
      void pollInbox();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loggedUser]);

  const handleNavigateTab = (
    tab: ActiveTab,
    focusBlock?: AccountBlockId
  ) => {
    setActiveTab(tab);
    if (focusBlock) {
      setFocusedBlockId(focusBlock);
    } else {
      setFocusedBlockId(null);
    }
  };

  const defaultDateForMonth = `${currentLedger.year}-${String(
    currentLedger.month
  ).padStart(2, '0')}-10`;

  const formattedLastTime = lastCloudTime
    ? lastCloudTime.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  // Render strict Google LoginScreen before entering the workspace
  if (!authReady || !accessControlLoaded || !loggedUser) {
    const hasPendingRequest = Boolean(
      unauthorizedUser &&
        accessControl.pendingRequests.some(
          (r) => normalizeEmail(r.email) === normalizeEmail(unauthorizedUser.email)
        )
    );
    return (
      <LoginScreen
        isCheckingSession={!authReady || !accessControlLoaded}
        unauthorizedUser={unauthorizedUser}
        hasPendingRequestForUnauthorized={hasPendingRequest}
        onGoogleAuthCompleted={handleGoogleAuthCompleted}
        onSwitchGoogleAccount={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Live Version Update Notification Banner & Modal */}
      <AppUpdateBannerModal
        onUpdateApplied={handleManualCloudRefresh}
        externalOpenModal={versionModalOpen}
        onCloseExternalModal={() => setVersionModalOpen(false)}
      />

      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4 Nav Links) — Zone 3 (1 Primary Action) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-3">
        <div className="w-full flex items-center justify-between gap-8">
          {/* Zone 1: Brand icon + wordmark */}
          <a
            href="#visao-geral"
            onClick={(e) => {
              e.preventDefault();
              handleNavigateTab('overview');
            }}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            <img
              src="/domus-logo.png?v=2"
              alt="Domus Finanças"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-lg object-cover border border-slate-200 shadow-2xs"
            />
            <span>Domus Finanças</span>
          </a>

          {/* Zone 2: 4 concise single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#visao-geral"
              onClick={(e) => {
                e.preventDefault();
                handleNavigateTab('overview');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'overview'
                  ? 'text-slate-900 font-semibold border-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Visão Geral
            </a>
            <a
              href="#cartoes"
              onClick={(e) => {
                e.preventDefault();
                handleNavigateTab('cards');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'cards'
                  ? 'text-slate-900 font-semibold border-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Cartões e Contas
            </a>
            <a
              href="#boletos"
              onClick={(e) => {
                e.preventDefault();
                handleNavigateTab('boletos');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'boletos'
                  ? 'text-slate-900 font-semibold border-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Boletos e Fixas
            </a>
            <a
              href="#relatorios"
              onClick={(e) => {
                e.preventDefault();
                handleNavigateTab('reports');
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === 'reports'
                  ? 'text-slate-900 font-semibold border-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Relatórios
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => openNewTransactionModal('expense')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Lançamento
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Strip (visible only below md) */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 overflow-x-auto flex items-center gap-2">
        {[
          { id: 'overview', label: 'Visão Geral' },
          { id: 'cards', label: 'Cartões e Contas' },
          { id: 'boletos', label: 'Boletos e Fixas' },
          { id: 'reports', label: 'Relatórios' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleNavigateTab(t.id as ActiveTab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === t.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Workspace Context & Month Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-3">
        <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg">
              <Calendar className="w-4 h-4 text-slate-600" />
              <select
                value={currentLedger.monthKey}
                onChange={(e) => handleSelectMonth(e.target.value)}
                className="text-sm font-bold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
                aria-label="Selecionar mês de referência"
              >
                {ledgers.map((l) => (
                  <option key={l.monthKey} value={l.monthKey}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleGenerateNextMonth}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-2xs"
              title="Avança um mês atualizando parcelas automaticamente"
            >
              <ArrowRightCircle className="w-4 h-4" />
              Gerar Próximo Mês
            </button>

            <button
              type="button"
              onClick={() => setWhatsAppModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-950 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-2xs"
              title="Lançar comprovante PIX, áudio ou mensagem"
            >
              <MessageSquare className="w-4 h-4 text-emerald-800" />
              <span>PIX / WhatsApp</span>
              {pendingWhatsAppItems.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-emerald-700 text-white rounded">
                  {pendingWhatsAppItems.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAccessModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
              title="Gerenciar contas Google autorizadas"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Permissões</span>
              {accessControl.pendingRequests.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-500 text-slate-950 rounded">
                  {accessControl.pendingRequests.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setInstallModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shadow-2xs"
              title="Instalar aplicativo, copiar link oficial e gerenciar backups"
            >
              <Laptop className="w-3.5 h-3.5" />
              Instalar App
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={handleManualCloudRefresh}
              disabled={isRefreshingCloud}
              className="inline-flex items-center justify-center p-1.5 text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
              title={`Atualizar da nuvem (${lastCloudAction}${formattedLastTime ? ` · ${formattedLastTime}` : ''})`}
              aria-label="Atualizar da nuvem"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshingCloud
                    ? 'animate-spin text-emerald-700'
                    : cloudStatus === 'synced'
                    ? 'text-emerald-700'
                    : cloudStatus === 'saving'
                    ? 'text-blue-600'
                    : cloudStatus === 'error'
                    ? 'text-amber-600'
                    : 'text-slate-500'
                }`}
              />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-lg transition-colors whitespace-nowrap"
              title="Sair da conta Google"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </div>
        </div>
      </div>

      {/* Offline Status Indicator */}
      {!isOnline && (
        <div className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
          <WifiOff className="w-3.5 h-3.5" />
          Modo Offline Ativo — Suas alterações serão sincronizadas na nuvem assim que reconectar.
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-40 max-w-md px-4 py-3 bg-slate-900 text-white text-xs font-medium rounded-xl shadow-lg border border-slate-700 flex items-center justify-between gap-4">
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white text-xs font-semibold"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Main Content Viewport — Full 100% Screen Width */}
      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'overview' && (
          <OverviewTab
            ledger={currentLedger}
            summary={summary}
            onEditIncome={(inc) => {
              setEditingIncome(inc);
              setEditingExpense(null);
              setModalOpen(true);
            }}
            onDeleteIncome={handleDeleteIncome}
            onOpenNewModal={openNewTransactionModal}
            onNavigateTab={handleNavigateTab}
          />
        )}

        {activeTab === 'cards' && (
          <CardsAccountsTab
            ledger={currentLedger}
            summary={summary}
            focusedBlockId={focusedBlockId}
            onSelectFocusBlock={setFocusedBlockId}
            onToggleExpenseStatus={handleToggleExpenseStatus}
            onMarkBlockPaid={handleMarkBlockPaid}
            onEditExpense={(exp) => {
              setEditingExpense(exp);
              setEditingIncome(null);
              setModalOpen(true);
            }}
            onDeleteExpense={handleDeleteExpense}
            onOpenNewModal={openNewTransactionModal}
            onAddCustomBlock={handleAddCustomBlock}
            onDeleteCustomBlock={handleDeleteCustomBlock}
          />
        )}

        {activeTab === 'boletos' && (
          <BoletosPixTab
            ledger={currentLedger}
            summary={summary}
            onToggleExpenseStatus={handleToggleExpenseStatus}
            onMarkBlockPaid={handleMarkBlockPaid}
            onEditExpense={(exp) => {
              setEditingExpense(exp);
              setEditingIncome(null);
              setModalOpen(true);
            }}
            onDeleteExpense={handleDeleteExpense}
            onOpenNewModal={openNewTransactionModal}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsTab ledger={currentLedger} summary={summary} />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 sm:px-6 lg:px-8 py-3.5 mt-8">
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>Domus Finanças · {loggedUser.name}</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setVersionModalOpen(true)}
              className="font-mono text-slate-500 hover:text-emerald-700 underline-offset-2 hover:underline transition-colors"
              title="Ver notas da versão"
            >
              v{CURRENT_APP_VERSION}
            </button>
          </div>
          <span className="font-mono tabular-nums">
            {currentLedger.label} · {currentLedger.expenses.length} contas ·{' '}
            {currentLedger.incomes.length} entradas
          </span>
        </div>
      </footer>

      {/* Modal for Adding/Editing Expenses and Incomes */}
      <TransactionModal
        isOpen={modalOpen}
        ledger={currentLedger}
        initialMode={modalMode}
        defaultBlockId={modalDefaultBlock}
        defaultBoletoSubType={modalDefaultBoletoSubType}
        defaultDueDate={defaultDateForMonth}
        editingExpense={editingExpense}
        editingIncome={editingIncome}
        onClose={() => {
          setModalOpen(false);
          setEditingExpense(null);
          setEditingIncome(null);
        }}
        onSaveExpense={handleSaveExpense}
        onSaveIncome={handleSaveIncome}
      />

      {/* Modal for Installing on Notebook / Direct Link / Portable Cloud App & Backup */}
      <InstallNotebookModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        ledgers={ledgers}
        onImportLedgers={(imported) => {
          setLedgers(imported);
          setActiveMonthKey(imported[0].monthKey);
          setCloudStatus('saving');
          saveHouseholdStateToCloud(
            imported,
            imported[0].monthKey,
            withUserPrefix(`Backup restaurado (${imported.length} mês/meses)`)
          )
            .then(() => setCloudStatus('synced'))
            .catch(() => setCloudStatus('error'));
        }}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        onTriggerPWAInstall={triggerPWAInstall}
        onRestoreInitialData={handleRestoreInitialData}
        onShowToast={showToast}
      />

      {/* Modal for PIX Receipt & WhatsApp Automatic Launching */}
      <WhatsAppPixModal
        isOpen={whatsAppModalOpen}
        onClose={() => setWhatsAppModalOpen(false)}
        ledger={currentLedger}
        loggedUserName={loggedUser.name}
        pendingWhatsAppItems={pendingWhatsAppItems}
        onApplyParsedTransaction={handleApplyParsedTransaction}
        onAcknowledgeWhatsAppItem={handleAcknowledgeWhatsAppItem}
        onNavigateToDestination={handleNavigateToParsedDestination}
        onShowToast={showToast}
      />

      {/* Modal for Managing Authorized Google Accounts & Approving Access Requests */}
      <AccessControlModal
        isOpen={accessModalOpen}
        onClose={() => setAccessModalOpen(false)}
        accessControl={accessControl}
        currentUserEmail={loggedUser.email}
        isCurrentUserAdmin={loggedUser.isAdmin}
        onShowToast={showToast}
      />
    </div>
  );
}
