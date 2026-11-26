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
export const ACCESS_CONTROL_DOC_KEY = '2099-09';
export const PRIMARY_ADMIN_EMAIL = 'sdassolari2015@gmail.com';
export const SHARED_PRODUCTION_URL = PERMANENT_APP_LINK;

export interface AuthorizedGoogleUser {
  id: string;
  email: string;
  memberProfile: 'Rodolfo' | 'Viviane' | 'Família';
  isAdmin: boolean;
  addedAt: string;
}

export interface PendingAccessRequest {
  id: string;
  email: string;
  displayName: string;
  requestedAt: string;
}

export interface AccessControlState {
  authorizedUsers: AuthorizedGoogleUser[];
  pendingRequests: PendingAccessRequest[];
}

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
  provider.setCustomParameters({ prompt: 'select_account' });
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

// ==================== GOOGLE ACCOUNT ACCESS CONTROL (WHITELIST + REQUESTS) ====================

export function normalizeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

function getDefaultPrimaryAdmin(): AuthorizedGoogleUser {
  return {
    id: 'auth-primary-admin',
    email: PRIMARY_ADMIN_EMAIL,
    memberProfile: 'Rodolfo',
    isAdmin: true,
    addedAt: '2026-10-01',
  };
}

function parseAccessControlDoc(data: Record<string, unknown> | undefined): AccessControlState {
  const rawIncomes = Array.isArray(data?.incomes) ? data.incomes : [];
  const rawExpenses = Array.isArray(data?.expenses) ? data.expenses : [];

  const userMap = new Map<string, AuthorizedGoogleUser>();
  // Primary owner admin is always guaranteed access and cannot be locked out
  userMap.set(PRIMARY_ADMIN_EMAIL, getDefaultPrimaryAdmin());

  for (const inc of rawIncomes as Array<Record<string, unknown>>) {
    const email = normalizeEmail(String(inc?.description || ''));
    if (!email || !email.includes('@')) continue;
    const rawPerson = String(inc?.person || 'Família');
    const memberProfile: 'Rodolfo' | 'Viviane' | 'Família' =
      rawPerson === 'Rodolfo' || rawPerson === 'Viviane' ? rawPerson : 'Família';
    const isPrimary = email === PRIMARY_ADMIN_EMAIL;
    userMap.set(email, {
      id: String(inc?.id || `auth-${email}`),
      email,
      memberProfile: isPrimary ? 'Rodolfo' : memberProfile,
      isAdmin: isPrimary || Number(inc?.amount) === 1,
      addedAt: String(inc?.date || new Date().toISOString().slice(0, 10)).slice(0, 16),
    });
  }

  const reqMap = new Map<string, PendingAccessRequest>();
  for (const exp of rawExpenses as Array<Record<string, unknown>>) {
    const email = normalizeEmail(String(exp?.description || ''));
    if (!email || !email.includes('@')) continue;
    if (userMap.has(email)) continue; // Already approved
    reqMap.set(email, {
      id: String(exp?.id || `req-${email}`),
      email,
      displayName: String(exp?.notes || email.split('@')[0]).slice(0, 80),
      requestedAt: String(exp?.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 16),
    });
  }

  return {
    authorizedUsers: Array.from(userMap.values()),
    pendingRequests: Array.from(reqMap.values()),
  };
}

async function persistAccessControlState(state: AccessControlState): Promise<void> {
  const accessRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', ACCESS_CONTROL_DOC_KEY);
  const path = `households/${HOUSEHOLD_ID}/ledgers/${ACCESS_CONTROL_DOC_KEY}`;

  // Always preserve primary admin
  const dedupedUsers = new Map<string, AuthorizedGoogleUser>();
  dedupedUsers.set(PRIMARY_ADMIN_EMAIL, getDefaultPrimaryAdmin());
  for (const u of state.authorizedUsers) {
    const email = normalizeEmail(u.email);
    if (!email || !email.includes('@')) continue;
    const isPrimary = email === PRIMARY_ADMIN_EMAIL;
    dedupedUsers.set(email, {
      id: String(u.id || `auth-${Date.now()}`).slice(0, 64),
      email,
      memberProfile: isPrimary ? 'Rodolfo' : u.memberProfile,
      isAdmin: isPrimary ? true : Boolean(u.isAdmin),
      addedAt: String(u.addedAt || new Date().toISOString().slice(0, 10)).slice(0, 16),
    });
  }

  const finalUsers = Array.from(dedupedUsers.values()).slice(0, 100);
  const finalRequests = state.pendingRequests
    .filter((r) => {
      const em = normalizeEmail(r.email);
      return em && em.includes('@') && !dedupedUsers.has(em);
    })
    .slice(0, 100);

  try {
    await setDoc(accessRef, {
      householdId: HOUSEHOLD_ID,
      monthKey: ACCESS_CONTROL_DOC_KEY,
      label: 'Controle de Acesso Google',
      year: 2099,
      month: 9,
      incomes: finalUsers.map((u) => ({
        id: u.id,
        person: u.memberProfile,
        description: u.email.slice(0, 120),
        amount: u.isAdmin ? 1 : 0,
        date: u.addedAt,
      })),
      expenses: finalRequests.map((r) => ({
        id: r.id.slice(0, 64),
        description: normalizeEmail(r.email).slice(0, 120),
        dueDate: r.requestedAt.slice(0, 16),
        currentInstallment: null,
        totalInstallments: null,
        amount: 0,
        status: 'Pendente',
        blockId: 'outras',
        category: 'Outros & Jurídico',
        isRecurringFixed: false,
        notes: String(r.displayName || '').slice(0, 120),
      })),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchAccessControlState(): Promise<AccessControlState> {
  const accessRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', ACCESS_CONTROL_DOC_KEY);
  try {
    let snap;
    try {
      snap = await getDocFromServer(accessRef);
    } catch {
      snap = await getDoc(accessRef);
    }
    if (!snap.exists()) {
      const initial: AccessControlState = {
        authorizedUsers: [getDefaultPrimaryAdmin()],
        pendingRequests: [],
      };
      await persistAccessControlState(initial).catch(() => {});
      return initial;
    }
    return parseAccessControlDoc(snap.data() as Record<string, unknown>);
  } catch {
    return {
      authorizedUsers: [getDefaultPrimaryAdmin()],
      pendingRequests: [],
    };
  }
}

export function subscribeToAccessControl(
  onUpdate: (state: AccessControlState) => void
): () => void {
  const accessRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', ACCESS_CONTROL_DOC_KEY);
  return onSnapshot(
    accessRef,
    (snap) => {
      if (!snap.exists()) {
        const initial: AccessControlState = {
          authorizedUsers: [getDefaultPrimaryAdmin()],
          pendingRequests: [],
        };
        onUpdate(initial);
        void persistAccessControlState(initial).catch(() => {});
        return;
      }
      onUpdate(parseAccessControlDoc(snap.data() as Record<string, unknown>));
    },
    () => {
      // Fallback to primary admin only on listener error
      onUpdate({
        authorizedUsers: [getDefaultPrimaryAdmin()],
        pendingRequests: [],
      });
    }
  );
}

export async function approveOrAddAuthorizedGoogleUser(params: {
  email: string;
  memberProfile: 'Rodolfo' | 'Viviane' | 'Família';
  isAdmin: boolean;
}): Promise<AccessControlState> {
  const normalized = normalizeEmail(params.email);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Informe um endereço de e-mail Google válido.');
  }
  const current = await fetchAccessControlState();
  const nextUsers = current.authorizedUsers.filter((u) => normalizeEmail(u.email) !== normalized);
  nextUsers.push({
    id: `auth-${Date.now()}`,
    email: normalized,
    memberProfile: normalized === PRIMARY_ADMIN_EMAIL ? 'Rodolfo' : params.memberProfile,
    isAdmin: normalized === PRIMARY_ADMIN_EMAIL ? true : params.isAdmin,
    addedAt: new Date().toISOString().slice(0, 10),
  });
  const nextRequests = current.pendingRequests.filter((r) => normalizeEmail(r.email) !== normalized);
  const nextState: AccessControlState = {
    authorizedUsers: nextUsers,
    pendingRequests: nextRequests,
  };
  await persistAccessControlState(nextState);
  return nextState;
}

export async function revokeAuthorizedGoogleUser(email: string): Promise<AccessControlState> {
  const normalized = normalizeEmail(email);
  if (normalized === PRIMARY_ADMIN_EMAIL) {
    throw new Error('A conta do administrador principal não pode ser removida.');
  }
  const current = await fetchAccessControlState();
  const nextState: AccessControlState = {
    authorizedUsers: current.authorizedUsers.filter((u) => normalizeEmail(u.email) !== normalized),
    pendingRequests: current.pendingRequests,
  };
  await persistAccessControlState(nextState);
  return nextState;
}

export async function submitGoogleAccessRequest(params: {
  email: string;
  displayName: string;
}): Promise<AccessControlState> {
  const normalized = normalizeEmail(params.email);
  if (!normalized || !normalized.includes('@')) {
    throw new Error('E-mail Google inválido.');
  }
  const current = await fetchAccessControlState();
  if (current.authorizedUsers.some((u) => normalizeEmail(u.email) === normalized)) {
    return current;
  }
  const nextRequests = current.pendingRequests.filter((r) => normalizeEmail(r.email) !== normalized);
  nextRequests.unshift({
    id: `req-${Date.now()}`,
    email: normalized,
    displayName: String(params.displayName || normalized.split('@')[0]).slice(0, 80),
    requestedAt: new Date().toISOString().slice(0, 10),
  });
  const nextState: AccessControlState = {
    authorizedUsers: current.authorizedUsers,
    pendingRequests: nextRequests,
  };
  await persistAccessControlState(nextState);
  return nextState;
}

export async function rejectGoogleAccessRequest(email: string): Promise<AccessControlState> {
  const normalized = normalizeEmail(email);
  const current = await fetchAccessControlState();
  const nextState: AccessControlState = {
    authorizedUsers: current.authorizedUsers,
    pendingRequests: current.pendingRequests.filter((r) => normalizeEmail(r.email) !== normalized),
  };
  await persistAccessControlState(nextState);
  return nextState;
}


