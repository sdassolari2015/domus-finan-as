import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { MonthLedger, ExpenseItem, IncomeItem } from '../types/finance';
import { INITIAL_OCTOBER_2026 } from '../data/initialData';
import {
  APP_RELEASES,
  AppReleaseNote,
  CURRENT_APP_VERSION,
  PERMANENT_APP_LINK,
} from '../data/appVersion';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const HOUSEHOLD_ID = 'domus_family';
export const VERSION_DOC_KEY = '2099-12';
export const SHARED_PRODUCTION_URL = PERMANENT_APP_LINK;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // Ignore sign-out errors
  }
}

export { onAuthStateChanged };
export type { User };

// Validate connection to Firestore on startup
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'households', HOUSEHOLD_ID));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

function sanitizeIncomes(incomes: IncomeItem[]): IncomeItem[] {
  return (incomes || []).slice(0, 100).map((inc) => ({
    id: String(inc.id || `inc-${Date.now()}`).slice(0, 64),
    person: inc.person || 'Família',
    description: String(inc.description || 'Entrada').slice(0, 120),
    amount: Number(inc.amount) || 0,
    date: String(inc.date || '2026-10-01').slice(0, 16),
  }));
}

function sanitizeExpenses(expenses: ExpenseItem[]): ExpenseItem[] {
  return (expenses || []).slice(0, 300).map((exp) => {
    const clean: ExpenseItem = {
      id: String(exp.id || `exp-${Date.now()}`).slice(0, 64),
      description: String(exp.description || 'Despesa').slice(0, 120),
      dueDate: String(exp.dueDate || '2026-10-10').slice(0, 16),
      currentInstallment:
        typeof exp.currentInstallment === 'number' ? exp.currentInstallment : null,
      totalInstallments:
        typeof exp.totalInstallments === 'number' ? exp.totalInstallments : null,
      amount: Number(exp.amount) || 0,
      status: exp.status === 'Pago' ? 'Pago' : 'Pendente',
      blockId: String(exp.blockId || 'outras').slice(0, 64),
      category: exp.category || 'Outros & Jurídico',
      isRecurringFixed: Boolean(exp.isRecurringFixed),
    };
    if (
      exp.boletoSubType === 'fixa' ||
      exp.boletoSubType === 'mensal' ||
      exp.boletoSubType === 'variavel'
    ) {
      clean.boletoSubType = exp.boletoSubType;
    }
    if (exp.notes) {
      clean.notes = String(exp.notes).slice(0, 200);
    }
    return clean;
  });
}

function sanitizeLedgerList(ledgers: MonthLedger[]): MonthLedger[] {
  const safeList = (ledgers && ledgers.length > 0 ? ledgers : [INITIAL_OCTOBER_2026]).slice(
    0,
    60
  );
  return safeList.map((ledger) => {
    const item: MonthLedger = {
      monthKey: String(ledger.monthKey || '2026-10').slice(0, 16),
      label: String(ledger.label || 'Outubro de 2026').slice(0, 64),
      year: Number(ledger.year) || 2026,
      month: Math.min(12, Math.max(1, Number(ledger.month) || 10)),
      incomes: sanitizeIncomes(ledger.incomes),
      expenses: sanitizeExpenses(ledger.expenses),
    };
    if (Array.isArray(ledger.customBlocks) && ledger.customBlocks.length > 0) {
      item.customBlocks = ledger.customBlocks.slice(0, 40).map((b) => ({
        id: String(b.id || `blk-${Date.now()}`).slice(0, 64),
        shortName: String(b.shortName || 'Cartão').slice(0, 40),
        fullTitle: String(b.fullTitle || 'Cartão').slice(0, 100),
        paymentMethod: String(b.paymentMethod || 'Débito em Conta').slice(0, 60),
        owner: String(b.owner || 'Família').slice(0, 40),
        accentColor: String(b.accentColor || '#0F172A').slice(0, 20),
        group: b.group === 'boletos_pix' ? 'boletos_pix' : 'cartao_conta',
        kind: b.kind === 'conta' ? 'conta' : b.kind === 'boletos' ? 'boletos' : 'cartao',
      }));
    }
    if (ledger.generatedFrom) {
      item.generatedFrom = String(ledger.generatedFrom).slice(0, 64);
    }
    if (
      ledger.completedInstallmentsFromPrev &&
      Array.isArray(ledger.completedInstallmentsFromPrev)
    ) {
      item.completedInstallmentsFromPrev = ledger.completedInstallmentsFromPrev
        .slice(0, 50)
        .map((c) => ({
          description: String(c.description || '').slice(0, 100),
          amount: Number(c.amount) || 0,
          installmentLabel: String(c.installmentLabel || '').slice(0, 20),
          blockTitle: String(c.blockTitle || '').slice(0, 60),
        }));
    }
    return item;
  });
}

export async function saveHouseholdStateToCloud(
  ledgers: MonthLedger[],
  activeMonthKey: string,
  actionDescription: string
): Promise<void> {
  const workspacePath = `households/${HOUSEHOLD_ID}`;
  const sanitizedLedgers = sanitizeLedgerList(ledgers);
  const safeActiveMonth = String(
    activeMonthKey || sanitizedLedgers[0]?.monthKey || '2026-10'
  ).slice(0, 16);
  const safeAction = String(actionDescription || 'Atualização financeira').slice(
    0,
    200
  );

  try {
    const workspaceRef = doc(db, 'households', HOUSEHOLD_ID);
    await setDoc(workspaceRef, {
      householdId: HOUSEHOLD_ID,
      activeMonthKey: safeActiveMonth,
      lastAction: safeAction,
      ledgers: sanitizedLedgers,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, workspacePath);
  }
}

export interface CloudWorkspaceState {
  activeMonthKey: string;
  lastAction: string;
  updatedAt: Date | null;
}

export interface FullHouseholdCloudSnapshot {
  ledgers: MonthLedger[];
  workspace: CloudWorkspaceState;
}

// Explicitly pull the freshest data directly from the Firestore server upon Login / Manual Refresh
export async function fetchLatestHouseholdStateFromServer(): Promise<FullHouseholdCloudSnapshot> {
  const workspacePath = `households/${HOUSEHOLD_ID}`;
  const workspaceRef = doc(db, 'households', HOUSEHOLD_ID);

  try {
    let snap;
    try {
      snap = await getDocFromServer(workspaceRef);
    } catch {
      snap = await getDoc(workspaceRef);
    }

    if (!snap.exists()) {
      await saveHouseholdStateToCloud(
        [INITIAL_OCTOBER_2026],
        '2026-10',
        'Planilha Outubro de 2026 inicializada na nuvem'
      );
      return {
        ledgers: [INITIAL_OCTOBER_2026],
        workspace: {
          activeMonthKey: '2026-10',
          lastAction: 'Planilha Outubro de 2026 inicializada na nuvem',
          updatedAt: new Date(),
        },
      };
    }

    const data = snap.data();
    const rawLedgers = Array.isArray(data.ledgers) ? data.ledgers : [];
    const loaded =
      rawLedgers.length > 0
        ? sanitizeLedgerList(rawLedgers as MonthLedger[])
        : [INITIAL_OCTOBER_2026];
    loaded.sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    const ts = data.updatedAt as Timestamp | null;
    return {
      ledgers: loaded,
      workspace: {
        activeMonthKey: String(data.activeMonthKey || loaded[0].monthKey),
        lastAction: String(data.lastAction || 'Sincronizado na nuvem'),
        updatedAt: ts && typeof ts.toDate === 'function' ? ts.toDate() : new Date(),
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, workspacePath);
  }
}

export function subscribeToHouseholdCloud(
  onLedgersSnapshot: (ledgers: MonthLedger[]) => void,
  onWorkspaceSnapshot: (state: CloudWorkspaceState) => void,
  onStatusChange: (status: 'connecting' | 'synced' | 'error') => void
): () => void {
  onStatusChange('connecting');

  const workspacePath = `households/${HOUSEHOLD_ID}`;
  const workspaceRef = doc(db, 'households', HOUSEHOLD_ID);

  let seeded = false;

  const unsubWorkspace = onSnapshot(
    workspaceRef,
    async (snap) => {
      if (!snap.exists()) {
        if (!seeded) {
          seeded = true;
          try {
            await saveHouseholdStateToCloud(
              [INITIAL_OCTOBER_2026],
              '2026-10',
              'Planilha Outubro de 2026 inicializada na nuvem'
            );
            onStatusChange('synced');
          } catch {
            onStatusChange('error');
          }
        }
        return;
      }

      const data = snap.data();
      const rawLedgers = Array.isArray(data.ledgers) ? data.ledgers : null;

      if (!rawLedgers || rawLedgers.length === 0) {
        if (!seeded) {
          seeded = true;
          try {
            await saveHouseholdStateToCloud(
              [INITIAL_OCTOBER_2026],
              String(data.activeMonthKey || '2026-10'),
              'Planilha Outubro de 2026 sincronizada na nuvem'
            );
            onStatusChange('synced');
          } catch {
            onStatusChange('error');
          }
        }
        return;
      }

      const loaded = sanitizeLedgerList(rawLedgers as MonthLedger[]);
      loaded.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      onLedgersSnapshot(loaded);

      const ts = data.updatedAt as Timestamp | null;
      onWorkspaceSnapshot({
        activeMonthKey: String(data.activeMonthKey || loaded[0].monthKey),
        lastAction: String(data.lastAction || 'Sincronizado na nuvem'),
        updatedAt: ts && typeof ts.toDate === 'function' ? ts.toDate() : new Date(),
      });
      onStatusChange('synced');
    },
    (error) => {
      onStatusChange('error');
      try {
        handleFirestoreError(error, OperationType.GET, workspacePath);
      } catch {
        // Logged by handleFirestoreError
      }
    }
  );

  return () => {
    unsubWorkspace();
  };
}

// Publish the current app version & changelog to Firestore so all installed .bat / iPhone / PC instances are notified automatically without reinstalling
export async function publishCurrentVersionToCloud(): Promise<void> {
  const latest = APP_RELEASES[0];
  if (!latest) return;
  const versionRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', VERSION_DOC_KEY);
  try {
    await setDoc(versionRef, {
      householdId: HOUSEHOLD_ID,
      monthKey: VERSION_DOC_KEY,
      label: `v${CURRENT_APP_VERSION} - ${latest.title}`.slice(0, 64),
      year: 2099,
      month: 12,
      incomes: [
        {
          id: 'ver-meta',
          person: 'Família',
          description: latest.version.slice(0, 32),
          amount: 0,
          date: latest.title.slice(0, 120),
        },
      ],
      expenses: latest.changes.slice(0, 30).map((changeText, idx) => ({
        id: `chg-${idx + 1}`,
        description: String(changeText).slice(0, 200),
        dueDate: '2099-12-31',
        currentInstallment: idx + 1,
        totalInstallments: latest.changes.length,
        amount: 0,
        status: 'Pago',
        blockId: 'outras',
        category: 'Outros & Jurídico',
        isRecurringFixed: true,
      })),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal if offline
  }
}

export function subscribeToCloudAppVersion(
  onVersionUpdate: (release: AppReleaseNote) => void
): () => void {
  const versionRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', VERSION_DOC_KEY);
  const unsub = onSnapshot(
    versionRef,
    (snap) => {
      if (!snap.exists()) {
        void publishCurrentVersionToCloud();
        return;
      }
      const data = snap.data();
      const metaInc = Array.isArray(data.incomes) && data.incomes[0] ? data.incomes[0] : null;
      const versionStr = String(metaInc?.description || CURRENT_APP_VERSION);
      const titleStr = String(metaInc?.date || APP_RELEASES[0].title);
      const rawExp = Array.isArray(data.expenses) ? data.expenses : [];
      const changesList = rawExp
        .map((e: { description?: string }) => String(e?.description || '').trim())
        .filter(Boolean);

      if (versionStr && changesList.length > 0) {
        onVersionUpdate({
          version: versionStr,
          releaseDate: 'Atualização na Nuvem',
          title: titleStr,
          changes: changesList,
        });
      }
    },
    () => {
      // Ignore listener errors if offline
    }
  );
  return unsub;
}

