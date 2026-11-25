import { MonthLedger } from '../types/finance';
import { ACCOUNT_BLOCKS, EXPENSE_CATEGORIES } from '../data/initialData';
import {
  CURRENT_APP_VERSION,
  PERMANENT_APP_LINK,
  APP_RELEASES,
} from '../data/appVersion';
import firebaseConfig from '../../firebase-applet-config.json';
import { DOMUS_ICON_DATA_URI, DOMUS_PNG_BASE64, DOMUS_ICO_BASE64 } from './domusIconData';

export function buildStandaloneAppHTML(ledgers: MonthLedger[]): string {
  const serializedLedgers = JSON.stringify(ledgers);
  const serializedBlocks = JSON.stringify(ACCOUNT_BLOCKS);
  const serializedCategories = JSON.stringify(EXPENSE_CATEGORIES);
  const serializedFirebaseConfig = JSON.stringify(firebaseConfig);
  const serializedReleases = JSON.stringify(APP_RELEASES);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Domus Finanças — Controle Familiar (Notebook & Celular)</title>
  <meta name="theme-color" content="#1B2A41" />
  <meta name="application-name" content="Domus Finanças" />
  <link rel="shortcut icon" type="image/x-icon" href="DomusFinanceiro.ico" />
  <link rel="icon" type="image/x-icon" href="DomusFinanceiro.ico" />
  <link rel="icon" type="image/png" sizes="256x256" href="DomusFinanceiro.png" />
  <link rel="icon" type="image/png" href="${DOMUS_ICON_DATA_URI}" />
  <link rel="apple-touch-icon" href="${DOMUS_ICON_DATA_URI}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; flex-direction: column; -webkit-font-smoothing: antialiased; }
    .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    button, select, input { font-family: inherit; }
    button { cursor: pointer; }

    /* Version Update Banner */
    .ver-banner { background: #064e3b; color: #fff; border-bottom: 1px solid #047857; padding: 10px 20px; font-size: 12px; width: 100%; }
    .ver-banner-inner { max-width: 1100px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .ver-badge { background: #047857; color: #d1fae5; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; }

    /* Login Screen */
    .login-wrap { flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; max-width: 460px; margin: 0 auto; width: 100%; }
    .login-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .login-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
    .login-tab-btn { padding: 8px 10px; border-radius: 8px; font-size: 12px; font-weight: 700; border: none; background: transparent; color: #475569; }
    .login-tab-btn.active-login { background: #0f172a; color: #fff; }
    .login-tab-btn.active-install { background: #047857; color: #fff; }
    .role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0 16px; }
    .role-btn { padding: 14px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; text-align: left; transition: all 0.15s; }
    .role-btn.active { background: #0f172a; color: #fff; border-color: #0f172a; }
    .role-btn .r-name { font-size: 14px; font-weight: 700; display: block; }
    .role-btn .r-sub { font-size: 11px; color: #64748b; margin-top: 3px; display: block; }
    .role-btn.active .r-sub { color: #cbd5e1; }
    .btn-login { width: 100%; padding: 12px 16px; border-radius: 10px; border: none; background: #047857; color: #fff; font-size: 13px; font-weight: 700; margin-top: 12px; }
    .btn-login:hover { background: #065f46; }

    /* Topbar & Workspace Toolbar — Full 100% Screen Width */
    .topbar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 12px 24px; position: sticky; top: 0; z-index: 30; width: 100%; }
    .topbar-inner { width: 100%; max-width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .brand { font-size: 17px; font-weight: 700; color: #0f172a; text-decoration: none; }
    .nav-links { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; }
    .nav-link { font-size: 13px; font-weight: 500; color: #475569; background: none; border: none; border-bottom: 2px solid transparent; padding: 4px 0; }
    .nav-link.active { color: #0f172a; font-weight: 700; border-bottom-color: #0f172a; }
    .toolbar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 12px 24px; width: 100%; }
    .toolbar-inner { width: 100%; max-width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .btn { padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { background: #f1f5f9; }
    .btn-dark { background: #0f172a; color: #fff; border-color: #0f172a; }
    .btn-dark:hover { background: #1e293b; }
    .btn-green { background: #047857; color: #fff; border-color: #047857; }
    .btn-green:hover { background: #065f46; }
    .btn-red-outline { color: #b91c1c; border-color: #fecaca; background: #fff; }
    .btn-red-outline:hover { background: #fef2f2; }

    /* Main Container — Full 100% Screen Width & Height */
    .main { width: 100%; max-width: 100%; margin: 0; padding: 20px 24px; flex: 1; display: flex; flex-direction: column; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 20px; width: 100%; }
    .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; }
    .kpi.dark { background: #0f172a; color: #fff; border-color: #0f172a; }
    .kpi-top { font-size: 12px; color: #64748b; display: flex; justify-content: space-between; }
    .kpi.dark .kpi-top { color: #cbd5e1; }
    .kpi-val { font-size: 24px; font-weight: 700; margin: 8px 0 12px; }
    .kpi-foot { font-size: 11px; color: #64748b; padding-top: 10px; border-top: 1px solid #f1f5f9; display: flex; justify-content: space-between; }
    .kpi.dark .kpi-foot { border-top-color: #1e293b; color: #cbd5e1; }

    .split-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px; width: 100%; flex: 1; }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 18px; width: 100%; }
    .col-4 { grid-column: span 4; }
    .col-8 { grid-column: span 8; }
    .col-5 { grid-column: span 5; }
    .col-7 { grid-column: span 7; }
    .col-6 { grid-column: span 6; }
    .col-12 { grid-column: span 12; }
    @media (max-width: 1200px) { .col-4 { grid-column: span 5; } .col-8 { grid-column: span 7; } }
    @media (max-width: 960px) { .col-4, .col-8, .col-5, .col-7, .col-6 { grid-column: span 12; } .cards-grid { grid-template-columns: 1fr; } }

    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }
    .panel-pad { padding: 20px; }
    .panel-head { background: #f8fafc; padding: 14px 18px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .panel-title { font-size: 14px; font-weight: 700; color: #0f172a; }
    .panel-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .panel-foot { background: #f1f5f9; padding: 11px 18px; border-top: 1px solid #e2e8f0; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }

    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f8fafc; text-align: left; padding: 9px 14px; font-size: 11px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; }
    td { padding: 9px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    tr:hover td { background: #f8fafc; }
    .right { text-align: right; }
    .center { text-align: center; }
    .status-btn { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; border: none; }
    .status-Pendente { background: #fef2f2; color: #b91c1c; }
    .status-Pago { background: #ecfdf5; color: #047857; }
    .del-btn { background: none; border: none; color: #94a3b8; font-size: 12px; padding: 2px 6px; }
    .del-btn:hover { color: #dc2626; }

    /* Bar progress */
    .bar-bg { width: 100%; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; margin-top: 4px; }
    .bar-fill { height: 100%; border-radius: 4px; }

    /* Modal */
    .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.55); display: none; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
    .modal-backdrop.open { display: flex; }
    .modal { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; max-width: 500px; width: 100%; overflow: hidden; }
    .form-row { margin-bottom: 12px; }
    .form-row label { display: block; font-size: 11px; font-weight: 600; color: #334155; margin-bottom: 4px; }
    .form-row input, .form-row select { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; }
    .form-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    .toast { position: fixed; bottom: 20px; right: 20px; background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 10px; font-size: 12px; font-weight: 600; display: none; z-index: 60; box-shadow: 0 8px 20px rgba(0,0,0,0.18); }
  </style>
</head>
<body>
  <div id="appRoot" style="min-height:100vh;display:flex;flex-direction:column;"></div>

  <!-- Modal Notas da Versão / Atualização sem Reinstalar -->
  <div class="modal-backdrop" id="verModal">
    <div class="modal">
      <div class="panel-head" style="background:#0f172a;color:#fff;border-bottom:none">
        <div>
          <span class="panel-title" style="color:#fff" id="verModalTitle">Notas da Versão v${CURRENT_APP_VERSION}</span>
          <div style="font-size:11px;color:#cbd5e1;margin-top:2px">Atualização automática sem mudar o link e sem reinstalar</div>
        </div>
        <button class="btn" onclick="closeVerModal()">Fechar</button>
      </div>
      <div class="panel-pad" id="verModalBody"></div>
    </div>
  </div>

  <!-- Modal Novo Lançamento -->
  <div class="modal-backdrop" id="txModal">
    <div class="modal">
      <div class="panel-head">
        <span class="panel-title" id="modalTitle">Novo Lançamento Financeiro</span>
        <button class="btn" onclick="closeModal()">Fechar</button>
      </div>
      <div class="panel-pad">
        <div class="role-grid" style="margin-top:0">
          <button type="button" class="btn" id="modeExpBtn" onclick="setModalMode('expense')" style="justify-content:center">Despesa / Conta</button>
          <button type="button" class="btn" id="modeIncBtn" onclick="setModalMode('income')" style="justify-content:center">Entrada / Receita</button>
        </div>
        <div id="expFields">
          <div class="form-row">
            <label>Bloco / Cartão / Boleto</label>
            <select id="fBlock"></select>
          </div>
          <div class="form-2col">
            <div class="form-row">
              <label>Descrição do Gasto</label>
              <input type="text" id="fDesc" placeholder="Ex: Fit Energia, Mercado..." />
            </div>
            <div class="form-row">
              <label>Valor (R$)</label>
              <input type="text" id="fAmount" class="mono" placeholder="0,00" />
            </div>
          </div>
          <div class="form-2col">
            <div class="form-row">
              <label>Categoria</label>
              <select id="fCat"></select>
            </div>
            <div class="form-row">
              <label>Data de Vencimento</label>
              <input type="date" id="fDue" class="mono" />
            </div>
          </div>
          <div class="form-2col">
            <div class="form-row">
              <label>Parcela Atual (Opcional)</label>
              <input type="number" id="fCurrInst" class="mono" placeholder="Ex: 13 (vazio se fixa)" />
            </div>
            <div class="form-row">
              <label>Total de Parcelas (Opcional)</label>
              <input type="number" id="fTotInst" class="mono" placeholder="Ex: 47 (vazio se fixa)" />
            </div>
          </div>
        </div>
        <div id="incFields" style="display:none">
          <div class="form-2col">
            <div class="form-row">
              <label>Integrante da Família</label>
              <select id="fPerson">
                <option value="Rodolfo">Rodolfo</option>
                <option value="Viviane">Viviane</option>
                <option value="Família">Família</option>
              </select>
            </div>
            <div class="form-row">
              <label>Data</label>
              <input type="date" id="fIncDate" class="mono" />
            </div>
          </div>
          <div class="form-2col">
            <div class="form-row">
              <label>Descrição da Entrada</label>
              <input type="text" id="fIncDesc" placeholder="Ex: Salário PM, Extra..." />
            </div>
            <div class="form-row">
              <label>Valor Recebido (R$)</label>
              <input type="text" id="fIncAmount" class="mono" placeholder="0,00" />
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button type="button" class="btn" onclick="closeModal()">Cancelar</button>
          <button type="button" class="btn btn-dark" onclick="saveModal()">Salvar na Nuvem</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toastBox"></div>

  <script>
    const STORAGE_KEY = 'domus_standalone_v3';
    const ACK_VER_KEY = 'domus_standalone_ack_ver_v1';
    const HOUSEHOLD_ID = 'domus_family';
    const PERMANENT_URL = '${PERMANENT_APP_LINK}';
    const BLOCKS = ${serializedBlocks};
    const CATEGORIES = ${serializedCategories};
    const FIREBASE_CONFIG = ${serializedFirebaseConfig};
    const RELEASES = ${serializedReleases};

    let currentRelease = RELEASES[0];
    let hasPendingUpdate = localStorage.getItem(ACK_VER_KEY) !== currentRelease.version;
    let loginCardTab = 'login';

    let ledgers = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || ${serializedLedgers};
    let activeMonthKey = ledgers[0]?.monthKey || '2026-10';
    let loggedUser = null;
    let selectedLoginMember = 'Rodolfo';
    let isLoggingIn = false;
    let activeTab = 'overview';
    let cloudStatusText = 'Sincronizado na Nuvem';
    let lastCloudAction = 'Pronto para sincronizar';
    let modalMode = 'expense';

    let fbDb = null;
    let fbFns = null;

    // Initialize Firebase asynchronously so UI renders immediately in 0ms and never shows a white screen
    async function initCloudSync() {
      try {
        const appMod = await import('https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js');
        const app = appMod.initializeApp(FIREBASE_CONFIG);
        fbDb = fsMod.getFirestore(app, FIREBASE_CONFIG.firestoreDatabaseId);
        fbFns = fsMod;

        // Real-time Firestore Cloud Version Listener
        fsMod.onSnapshot(fsMod.doc(fbDb, 'households', HOUSEHOLD_ID, 'ledgers', '2099-12'), (vSnap) => {
          if (vSnap.exists()) {
            const vd = vSnap.data();
            const metaInc = Array.isArray(vd.incomes) && vd.incomes[0] ? vd.incomes[0] : null;
            const verStr = metaInc && metaInc.description ? String(metaInc.description) : '';
            const titleStr = metaInc && metaInc.date ? String(metaInc.date) : currentRelease.title;
            const chgList = (Array.isArray(vd.expenses) ? vd.expenses : [])
              .map(e => String(e && e.description ? e.description : '').trim())
              .filter(Boolean);
            if (verStr && chgList.length > 0) {
              currentRelease = { version: verStr, releaseDate: 'Atualizado na Nuvem', title: titleStr, changes: chgList };
              if (localStorage.getItem(ACK_VER_KEY) !== verStr) {
                hasPendingUpdate = true;
              }
              renderApp();
            }
          }
        });

        // Real-time cloud household subscription
        fsMod.onSnapshot(fsMod.doc(fbDb, 'households', HOUSEHOLD_ID), (snap) => {
          if (snap.exists()) {
            const d = snap.data();
            if (d.activeMonthKey) activeMonthKey = d.activeMonthKey;
            if (d.lastAction) lastCloudAction = d.lastAction;
            if (Array.isArray(d.ledgers) && d.ledgers.length > 0) {
              ledgers = d.ledgers;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(ledgers));
            }
            cloudStatusText = 'Nuvem sincronizada';
            renderApp();
          }
        });
      } catch {
        cloudStatusText = 'Modo Local Ativo';
        renderApp();
      }
    }

    function showToast(msg) {
      const box = document.getElementById('toastBox');
      box.textContent = msg;
      box.style.display = 'block';
      setTimeout(() => { box.style.display = 'none'; }, 4000);
    }

    window.setLoginTab = function(tab) {
      loginCardTab = tab;
      renderApp();
    };

    window.copyPermanentLink = async function() {
      try {
        await navigator.clipboard.writeText(PERMANENT_URL);
        showToast('Link copiado! Cole no navegador do seu iPhone ou Tablet.');
      } catch {
        showToast('Link disponível: ' + PERMANENT_URL);
      }
    };

    window.openVerModal = function() {
      document.getElementById('verModalTitle').textContent = 'Notas da Versão v' + currentRelease.version + ' — ' + currentRelease.title;
      const itemsHtml = currentRelease.changes.map(c => '<li style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;font-size:12px;color:#1e293b">✓ ' + c + '</li>').join('');
      document.getElementById('verModalBody').innerHTML =
        '<div style="padding:10px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;font-size:12px;color:#064e3b;margin-bottom:14px"><strong>Sem precisar desinstalar:</strong> Todas as melhorias já ficam ativas automaticamente no seu aplicativo e no mesmo link fixo.</div>' +
        '<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">O que foi atualizado nesta versão:</div>' +
        '<ul style="list-style:none;padding:0;margin:0">' + itemsHtml + '</ul>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
          '<button type="button" class="btn" onclick="closeVerModal()">Fechar</button>' +
          '<button type="button" class="btn btn-green" onclick="applyVersionUpdateNow()">Atualizar e Sincronizar Agora</button>' +
        '</div>';
      document.getElementById('verModal').classList.add('open');
    };
    window.closeVerModal = function() {
      document.getElementById('verModal').classList.remove('open');
    };
    window.applyVersionUpdateNow = async function() {
      localStorage.setItem(ACK_VER_KEY, currentRelease.version);
      hasPendingUpdate = false;
      closeVerModal();
      try { await pullLatestFromCloud(); } catch {}
      renderApp();
      showToast('Versão v' + currentRelease.version + ' aplicada e sincronizada sem precisar reinstalar!');
    };

    function fmtBRL(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    function fmtDate(d) { if (!d) return '---'; const p = d.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d; }
    function fmtInst(c, t) { if (!c || !t) return '---'; return String(c).padStart(2, '0') + '/' + String(t).padStart(2, '0'); }
    function getLedger() { return ledgers.find(l => l.monthKey === activeMonthKey) || ledgers[0]; }

    async function pullLatestFromCloud() {
      if (!fbDb || !fbFns) return;
      const wRef = fbFns.doc(fbDb, 'households', HOUSEHOLD_ID);
      let snap;
      try { snap = await fbFns.getDocFromServer(wRef); } catch { snap = await fbFns.getDoc(wRef); }
      if (snap && snap.exists()) {
        const d = snap.data();
        if (d.activeMonthKey) activeMonthKey = d.activeMonthKey;
        if (d.lastAction) lastCloudAction = d.lastAction;
        if (Array.isArray(d.ledgers) && d.ledgers.length > 0) {
          ledgers = d.ledgers;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(ledgers));
        }
      }
    }

    async function saveToCloud(actionMsg) {
      const tagged = (loggedUser ? loggedUser + ': ' : '') + actionMsg;
      lastCloudAction = tagged;
      cloudStatusText = 'Salvando na nuvem...';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ledgers));
      renderApp();
      if (!fbDb || !fbFns) {
        cloudStatusText = 'Salvo localmente';
        renderApp();
        return;
      }
      try {
        await fbFns.setDoc(fbFns.doc(fbDb, 'households', HOUSEHOLD_ID), {
          householdId: HOUSEHOLD_ID,
          activeMonthKey: String(activeMonthKey || '2026-10').slice(0, 16),
          lastAction: String(tagged).slice(0, 200),
          ledgers: ledgers.slice(0, 60),
          updatedAt: fbFns.serverTimestamp()
        });
        cloudStatusText = 'Nuvem sincronizada';
        renderApp();
      } catch {
        cloudStatusText = 'Salvo localmente (Offline)';
        renderApp();
      }
    }

    let autoFullscreenOnLogin = true;
    window.toggleAutoFullscreen = function() { autoFullscreenOnLogin = !autoFullscreenOnLogin; renderApp(); };
    window.selectMember = function(m) { selectedLoginMember = m; renderApp(); };
    window.executeLogin = async function() {
      if (autoFullscreenOnLogin && !document.fullscreenElement) {
        try { document.documentElement.requestFullscreen().catch(() => {}); } catch {}
      }
      isLoggingIn = true;
      renderApp();
      try { await pullLatestFromCloud(); } catch {}
      loggedUser = selectedLoginMember;
      isLoggingIn = false;
      renderApp();
      showToast('Login realizado como ' + loggedUser + '! Dados atualizados da nuvem.');
    };
    window.logoutUser = function() { loggedUser = null; renderApp(); };
    window.forceCloudRefresh = async function() {
      cloudStatusText = 'Buscando na nuvem...';
      renderApp();
      try {
        await pullLatestFromCloud();
        cloudStatusText = 'Nuvem sincronizada';
        showToast('Dados atualizados com a última versão da nuvem!');
      } catch {
        cloudStatusText = 'Modo local';
      }
      renderApp();
    };
    try {
      window.moveTo(0, 0);
      window.resizeTo(window.screen.availWidth, window.screen.availHeight);
    } catch {}

    window.toggleFullScreen = function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    };
    window.switchTab = function(t) { activeTab = t; renderApp(); };
    window.changeMonth = function(mKey) {
      activeMonthKey = mKey;
      const target = ledgers.find(x => x.monthKey === mKey);
      saveToCloud('Visualizando ' + (target ? target.label : mKey));
    };
    window.toggleStatus = function(expId) {
      const l = getLedger();
      let desc = '';
      l.expenses = l.expenses.map(e => {
        if (e.id === expId) {
          const ns = e.status === 'Pago' ? 'Pendente' : 'Pago';
          desc = e.description + ' marcado como ' + ns;
          return { ...e, status: ns };
        }
        return e;
      });
      saveToCloud(desc);
    };
    window.markBlockPaid = function(bId) {
      const l = getLedger();
      l.expenses = l.expenses.map(e => e.blockId === bId ? { ...e, status: 'Pago' } : e);
      saveToCloud('Bloco ' + bId + ' quitado');
      showToast('Bloco marcado como Pago e salvo na nuvem!');
    };
    window.deleteExp = function(expId) {
      const l = getLedger();
      const target = l.expenses.find(e => e.id === expId);
      l.expenses = l.expenses.filter(e => e.id !== expId);
      saveToCloud('Excluído: ' + (target ? target.description : 'item'));
    };
    window.deleteInc = function(incId) {
      const l = getLedger();
      l.incomes = l.incomes.filter(i => i.id !== incId);
      saveToCloud('Entrada removida');
    };
    window.generateNextMonth = function() {
      const src = getLedger();
      const nm = src.month === 12 ? 1 : src.month + 1;
      const ny = src.month === 12 ? src.year + 1 : src.year;
      const key = ny + '-' + String(nm).padStart(2, '0');
      const existing = ledgers.find(x => x.monthKey === key);
      if (existing) { activeMonthKey = key; renderApp(); return; }
      const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const nextExp = [];
      for (const e of src.expenses) {
        if (e.currentInstallment && e.totalInstallments) {
          if (e.currentInstallment >= e.totalInstallments) continue;
          nextExp.push({ ...e, id: e.id + '-' + key, currentInstallment: e.currentInstallment + 1, status: 'Pendente' });
        } else {
          nextExp.push({ ...e, id: e.id + '-' + key, status: 'Pendente' });
        }
      }
      const newL = { monthKey: key, label: names[nm - 1] + ' de ' + ny, year: ny, month: nm, incomes: src.incomes, expenses: nextExp };
      ledgers.push(newL);
      activeMonthKey = key;
      saveToCloud('Gerado ' + newL.label);
      showToast(newL.label + ' gerado e salvo na nuvem!');
    };

    window.openModal = function(mode, defaultBlock) {
      modalMode = mode || 'expense';
      document.getElementById('fBlock').innerHTML = BLOCKS.map(b => '<option value="' + b.id + '"' + (b.id === (defaultBlock || 'outras') ? ' selected' : '') + '>' + b.fullTitle + '</option>').join('');
      document.getElementById('fCat').innerHTML = CATEGORIES.map(c => '<option value="' + c.name + '">' + c.name + '</option>').join('');
      document.getElementById('fDue').value = activeMonthKey + '-10';
      document.getElementById('fIncDate').value = activeMonthKey + '-01';
      document.getElementById('fDesc').value = '';
      document.getElementById('fAmount').value = '';
      document.getElementById('fCurrInst').value = '';
      document.getElementById('fTotInst').value = '';
      document.getElementById('fIncDesc').value = '';
      document.getElementById('fIncAmount').value = '';
      setModalMode(modalMode);
      document.getElementById('txModal').classList.add('open');
    };
    window.closeModal = function() { document.getElementById('txModal').classList.remove('open'); };
    window.setModalMode = function(m) {
      modalMode = m;
      document.getElementById('expFields').style.display = m === 'expense' ? 'block' : 'none';
      document.getElementById('incFields').style.display = m === 'income' ? 'block' : 'none';
      document.getElementById('modeExpBtn').className = 'btn ' + (m === 'expense' ? 'btn-dark' : '');
      document.getElementById('modeIncBtn').className = 'btn ' + (m === 'income' ? 'btn-green' : '');
    };
    window.saveModal = function() {
      const l = getLedger();
      if (modalMode === 'expense') {
        const desc = document.getElementById('fDesc').value.trim();
        if (!desc) return;
        const val = parseFloat((document.getElementById('fAmount').value || '0').replace(',', '.')) || 0;
        const bId = document.getElementById('fBlock').value;
        const cat = document.getElementById('fCat').value;
        const due = document.getElementById('fDue').value || (activeMonthKey + '-10');
        const cI = parseInt(document.getElementById('fCurrInst').value, 10) || null;
        const tI = parseInt(document.getElementById('fTotInst').value, 10) || null;
        l.expenses.push({ id: 'exp-' + Date.now(), description: desc, amount: val, blockId: bId, category: cat, dueDate: due, currentInstallment: cI, totalInstallments: tI, status: 'Pendente', isRecurringFixed: !tI });
        closeModal();
        saveToCloud('Novo gasto: ' + desc + ' (' + fmtBRL(val) + ')');
        showToast('Despesa salva na nuvem!');
      } else {
        const desc = document.getElementById('fIncDesc').value.trim();
        if (!desc) return;
        const val = parseFloat((document.getElementById('fIncAmount').value || '0').replace(',', '.')) || 0;
        const person = document.getElementById('fPerson').value;
        const dt = document.getElementById('fIncDate').value || (activeMonthKey + '-01');
        l.incomes.push({ id: 'inc-' + Date.now(), person, description: desc, amount: val, date: dt });
        closeModal();
        saveToCloud('Nova entrada: ' + person + ' - ' + desc);
        showToast('Entrada salva na nuvem!');
      }
    };

    function renderVersionBanner() {
      if (!hasPendingUpdate) return '';
      return '<div class="ver-banner"><div class="ver-banner-inner">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<span class="ver-badge mono">NOVA VERSÃO v' + currentRelease.version + '</span>' +
          '<strong>' + currentRelease.title + '</strong>' +
          '<span style="color:#a7f3d0">— Atualize sem mudar o link e sem precisar reinstalar!</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<button type="button" class="btn" style="background:#065f46;color:#fff;border-color:#047857" onclick="openVerModal()">Ver Atualizações</button>' +
          '<button type="button" class="btn" style="background:#fff;color:#064e3b;border-color:#fff;font-weight:700" onclick="applyVersionUpdateNow()">Atualizar Agora</button>' +
        '</div>' +
      '</div></div>';
    }

    function renderApp() {
      const root = document.getElementById('appRoot');
      if (!loggedUser) {
        const loginTabContent = loginCardTab === 'login'
          ? (
            '<div style="padding:22px">' +
              '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:11px">' +
                '<div style="color:#64748b">Última atividade na nuvem:</div>' +
                '<div style="font-weight:700;color:#0f172a;margin-top:2px">' + lastCloudAction + '</div>' +
              '</div>' +
              '<div style="margin-top:14px;font-size:12px;font-weight:600;color:#334155">Selecione seu Perfil de Acesso:</div>' +
              '<div class="role-grid">' +
                '<button type="button" class="role-btn ' + (selectedLoginMember === 'Rodolfo' ? 'active' : '') + '" onclick="selectMember(\\'Rodolfo\\')"><span class="r-name">Rodolfo</span><span class="r-sub">Titular · Família</span></button>' +
                '<button type="button" class="role-btn ' + (selectedLoginMember === 'Viviane' ? 'active' : '') + '" onclick="selectMember(\\'Viviane\\')"><span class="r-name">Viviane</span><span class="r-sub">Titular · Família</span></button>' +
              '</div>' +
              '<button type="button" class="btn-login" onclick="executeLogin()">' + (isLoggingIn ? 'Sincronizando dados mais atuais da nuvem...' : 'Entrar como ' + selectedLoginMember) + '</button>' +
            '</div>'
          )
          : (
            '<div style="padding:22px;display:flex;flex-direction:column;gap:14px">' +
              '<div style="padding:14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px">' +
                '<div style="font-size:12px;font-weight:700;color:#064e3b">1. Instalação em PC / Notebook (Arquivo .bat)</div>' +
                '<p style="font-size:11px;color:#065f46;margin-top:4px;line-height:1.4">Aplicativo instalado no seu computador com o ícone oficial Domus Finanças e sincronização automática na nuvem.</p>' +
                '<button type="button" class="btn btn-green" style="width:100%;justify-content:center;margin-top:10px" onclick="openVerModal()">Ver Atualizações da Versão v' + currentRelease.version + '</button>' +
              '</div>' +
              '<div style="padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">' +
                '<div style="font-size:12px;font-weight:700;color:#0f172a">2. Acesso para iPhone e Tablet (Via Link)</div>' +
                '<p style="font-size:11px;color:#475569;margin-top:4px;line-height:1.4">Copie o link abaixo, cole no navegador do seu iPhone ou Tablet e salve a página na tela de início / área de trabalho:</p>' +
                '<div class="mono" style="margin-top:8px;padding:8px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;font-size:10px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + PERMANENT_URL + '</div>' +
                '<button type="button" class="btn btn-dark" style="width:100%;justify-content:center;margin-top:8px" onclick="copyPermanentLink()">Copiar Link para iPhone / Tablet</button>' +
              '</div>' +
            '</div>'
          );

        root.innerHTML = renderVersionBanner() + '<div class="login-wrap">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#64748b"><div style="display:flex;align-items:center;gap:8px"><img src="${DOMUS_ICON_DATA_URI}" alt="Domus" style="width:28px;height:28px;border-radius:6px;border:1px solid #e2e8f0" /><strong>Domus Finanças</strong></div><div style="display:flex;align-items:center;gap:8px"><button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:#ecfdf5;color:#065f46;border-color:#a7f3d0" onclick="openVerModal()">v' + currentRelease.version + '</button><span style="color:#047857;font-weight:600">● Nuvem Ativa</span></div></div>' +
          '<div class="login-card">' +
            '<div style="padding:20px 22px 14px;display:flex;align-items:center;gap:14px">' +
              '<img src="${DOMUS_ICON_DATA_URI}" alt="Domus Finanças" style="width:54px;height:54px;border-radius:12px;border:1px solid #e2e8f0;flex-shrink:0" />' +
              '<div>' +
                '<div style="font-size:11px;font-weight:700;color:#047857">GESTÃO FINANCEIRA RESIDENCIAL</div>' +
                '<h1 style="font-size:19px;font-weight:700;margin-top:2px">Domus Finanças</h1>' +
                '<p style="font-size:11px;color:#64748b;margin-top:2px">Sincronização automática em nuvem</p>' +
              '</div>' +
            '</div>' +
            '<div class="login-tabs">' +
              '<button type="button" class="login-tab-btn ' + (loginCardTab === 'login' ? 'active-login' : '') + '" onclick="setLoginTab(\\'login\\')">Entrar no App</button>' +
              '<button type="button" class="login-tab-btn ' + (loginCardTab === 'install' ? 'active-install' : '') + '" onclick="setLoginTab(\\'install\\')">Instalação</button>' +
            '</div>' +
            loginTabContent +
          '</div>' +
          '<div style="text-align:center;font-size:11px;color:#94a3b8">Domus Finanças v' + currentRelease.version + ' · Atualização automática sem modificar o link</div>' +
        '</div>';
        return;
      }

      const l = getLedger();
      const effBlocks = Array.isArray(l.customBlocks) && l.customBlocks.length > 0 ? l.customBlocks : BLOCKS;
      const getSubType = (e) => {
        if (e.boletoSubType === 'fixa' || e.boletoSubType === 'mensal' || e.boletoSubType === 'variavel') return e.boletoSubType;
        if (e.currentInstallment && e.totalInstallments) return 'variavel';
        if (e.isRecurringFixed === false) return 'mensal';
        return 'fixa';
      };

      const totalInc = l.incomes.reduce((a, b) => a + b.amount, 0);
      const totalExp = l.expenses.reduce((a, b) => a + b.amount, 0);
      const paidExp = l.expenses.filter(e => e.status === 'Pago').reduce((a, b) => a + b.amount, 0);
      const pendExp = totalExp - paidExp;
      const cashNow = totalInc - paidExp;
      const freeProj = totalInc - totalExp;
      const commitRatio = totalInc > 0 ? ((totalExp / totalInc) * 100).toFixed(1) : '0.0';
      const freeRatio = totalInc > 0 ? Math.max(0, (freeProj / totalInc) * 100).toFixed(1) : '0.0';

      let bodyHtml = '';
      if (activeTab === 'overview') {
        const incRows = l.incomes.map(i => '<tr><td><strong>' + i.person + '</strong></td><td>' + i.description + '</td><td class="mono">' + fmtDate(i.date) + '</td><td class="mono right" style="font-weight:700;color:#047857">' + fmtBRL(i.amount) + '</td><td class="right"><button class="del-btn" onclick="deleteInc(\\'' + i.id + '\\')">✕</button></td></tr>').join('');
        const incomesPanel = '<div class="panel" style="margin-bottom:20px"><div class="panel-head"><div><div class="panel-title">Entradas & Receitas da Família — ' + l.label + '</div><div class="panel-sub">Total Recebido: <strong class="mono" style="color:#047857">' + fmtBRL(totalInc) + '</strong></div></div><button class="btn btn-green" onclick="openModal(\\'income\\')">+ Nova Entrada</button></div><table><thead><tr><th>Integrante</th><th>Fonte / Informações</th><th>Data</th><th class="right">Valor</th><th></th></tr></thead><tbody>' + incRows + '</tbody></table></div>';

        const kpiBoxes = '<div class="kpi-grid">' +
          '<div class="kpi"><div class="kpi-top"><span>Entradas da Família</span><span>100%</span></div><div class="kpi-val mono">' + fmtBRL(totalInc) + '</div><div class="kpi-foot mono"><span>Receitas de ' + l.label + '</span></div></div>' +
          '<div class="kpi"><div class="kpi-top"><span>Total de Gastos</span><span class="mono">' + commitRatio + '% da renda</span></div><div class="kpi-val mono">' + fmtBRL(totalExp) + '</div><div class="kpi-foot mono"><span style="color:#047857">Pago: ' + fmtBRL(paidExp) + '</span><span style="color:#dc2626">A Pagar: ' + fmtBRL(pendExp) + '</span></div></div>' +
          '<div class="kpi"><div class="kpi-top"><span>Saldo Atual em Caixa</span><span>Entradas − Pagos</span></div><div class="kpi-val mono">' + fmtBRL(cashNow) + '</div><div class="kpi-foot mono"><span>Saída Realizada: ' + (paidExp > 0 ? fmtBRL(paidExp) : 'R$ -') + '</span></div></div>' +
          '<div class="kpi dark"><div class="kpi-top"><span>Saldo Livre da Família</span><span class="mono" style="color:#34d399">' + freeRatio + '% livre</span></div><div class="kpi-val mono">' + fmtBRL(freeProj) + '</div><div class="kpi-foot mono"><span>Após quitar todas as contas</span><span style="color:#34d399">Superávit</span></div></div>' +
        '</div>';

        const sortedExp = [...l.expenses].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const schedRows = sortedExp.map(e => {
          const bMeta = effBlocks.find(b => b.id === e.blockId);
          return '<tr><td><strong>' + e.description + '</strong><br/><span style="font-size:11px;color:#64748b">' + (bMeta ? bMeta.shortName : e.blockId) + ' · ' + e.category + '</span></td>' +
            '<td class="mono">' + fmtDate(e.dueDate) + '</td>' +
            '<td class="mono center">' + fmtInst(e.currentInstallment, e.totalInstallments) + '</td>' +
            '<td class="mono right" style="font-weight:700;color:' + (e.status === 'Pago' ? '#047857' : '#dc2626') + '">' + fmtBRL(e.amount) + '</td>' +
            '<td class="right"><span style="font-weight:700;color:' + (e.status === 'Pago' ? '#047857' : '#dc2626') + '">' + (e.status === 'Pago' ? '✓ Pago' : '● A Pagar') + '</span></td></tr>';
        }).join('');

        const fixedOutras = l.expenses.filter(e => e.blockId === 'outras' && getSubType(e) === 'fixa').reduce((a, b) => a + b.amount, 0);
        const mensalOutras = l.expenses.filter(e => e.blockId === 'outras' && getSubType(e) === 'mensal').reduce((a, b) => a + b.amount, 0);
        const instOutras = l.expenses.filter(e => e.blockId === 'outras' && getSubType(e) === 'variavel').reduce((a, b) => a + b.amount, 0);
        const summaryBars = [
          { label: 'Despesas Fixas (Mensais)', val: fixedOutras, color: '#2563eb' },
          ...(mensalOutras > 0 ? [{ label: 'Gastos Mensais', val: mensalOutras, color: '#0d9488' }] : []),
          ...effBlocks.filter(b => b.id !== 'outras').map(b => ({ label: b.shortName, val: l.expenses.filter(e => e.blockId === b.id).reduce((a, x) => a + x.amount, 0), color: b.accentColor })),
          { label: 'Despesas Variáveis (Parcelados)', val: instOutras, color: '#4f46e5' }
        ].map(r => {
          const pct = totalInc > 0 ? Math.min(100, (r.val / totalInc) * 100) : 0;
          return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>' + r.label + '</span><strong class="mono">' + (r.val > 0 ? fmtBRL(r.val) : '-') + '</strong></div><div class="bar-bg"><div class="bar-fill" style="width:' + (r.val > 0 ? Math.max(2, pct) : 0) + '%;background:' + r.color + '"></div></div></div>';
        }).join('');

        bodyHtml = incomesPanel + kpiBoxes + '<div class="split-grid">' +
          '<div class="col-4 panel"><div class="panel-pad"><div class="panel-title">Resumo de Gastos por Bloco</div><div class="panel-sub" style="margin-bottom:16px">Visão consolidada de cartões, contas e boletos</div>' + summaryBars + '</div><div class="panel-foot mono"><span style="color:#047857;font-weight:700">SALDO EM CAIXA DA FAMÍLIA:</span><strong style="color:#047857;font-size:14px">' + fmtBRL(freeProj) + '</strong></div></div>' +
          '<div class="col-8 panel"><div><div class="panel-head"><div><div class="panel-title">Cronograma de Contas — Resumo Geral (' + l.expenses.length + ')</div><div class="panel-sub">Resumo informativo de contas pagas e a pagar de todas as abas</div></div></div><div style="max-height:calc(100vh - 340px);min-height:380px;overflow-y:auto"><table><thead><tr><th>Conta / Aba de Origem</th><th>Vencimento</th><th class="center">Parcelas</th><th class="right">Valor</th><th class="right">Situação</th></tr></thead><tbody>' + schedRows + '</tbody></table></div></div><div class="panel-foot mono"><span>Pago: <strong style="color:#047857">' + fmtBRL(paidExp) + '</strong></span><span>A Pagar: <strong style="color:#dc2626">' + fmtBRL(pendExp) + '</strong></span><strong>Total: ' + fmtBRL(totalExp) + '</strong></div></div>' +
        '</div>';
      } else if (activeTab === 'cards') {
        bodyHtml = '<div class="cards-grid">' + effBlocks.filter(b => b.id !== 'outras').map(b => {
          const items = l.expenses.filter(e => e.blockId === b.id);
          const bPaid = items.filter(e => e.status === 'Pago').reduce((a, x) => a + x.amount, 0);
          const bPend = items.filter(e => e.status === 'Pendente').reduce((a, x) => a + x.amount, 0);
          const rows = items.length === 0 ? '<tr><td colspan="6" class="center" style="padding:20px;color:#94a3b8">Sem contas lançadas em ' + b.shortName + ' em ' + l.label + '</td></tr>' :
            items.map(e => '<tr><td><strong>' + e.description + '</strong><br/><span style="font-size:11px;color:#64748b">' + e.category + '</span></td><td class="mono">' + fmtDate(e.dueDate) + '</td><td class="mono center">' + fmtInst(e.currentInstallment, e.totalInstallments) + '</td><td class="mono right" style="font-weight:700;color:' + (e.status === 'Pago' ? '#047857' : '#dc2626') + '">' + fmtBRL(e.amount) + '</td><td class="right"><button class="status-btn status-' + e.status + '" onclick="toggleStatus(\\'' + e.id + '\\')">' + e.status + '</button></td><td class="right"><button class="del-btn" onclick="deleteExp(\\'' + e.id + '\\')" title="Excluir">✕</button></td></tr>').join('');
          return '<div class="panel"><div><div class="panel-head"><div><div class="panel-title">' + b.fullTitle + '</div><div class="panel-sub">' + items.length + ' conta(s) lançada(s)</div></div><div style="display:flex;gap:6px">' + (bPend > 0 ? '<button class="btn" onclick="markBlockPaid(\\'' + b.id + '\\')">Quitar</button>' : '') + '<button class="btn btn-dark" onclick="openModal(\\'expense\\', \\'' + b.id + '\\')">+ Criar Conta</button></div></div><table><thead><tr><th>Conta</th><th>Vencimento</th><th class="center">Parcelas</th><th class="right">Valor</th><th class="right">Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="panel-foot mono"><strong>TOTAL =</strong><span>Pago: <strong style="color:#047857">' + fmtBRL(bPaid) + '</strong> · Pendente: <strong style="color:#dc2626">' + fmtBRL(bPend) + '</strong></span></div></div>';
        }).join('') + '</div>';
      } else if (activeTab === 'boletos') {
        const outras = l.expenses.filter(e => e.blockId === 'outras').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const fixas = outras.filter(e => getSubType(e) === 'fixa');
        const mensais = outras.filter(e => getSubType(e) === 'mensal');
        const parc = outras.filter(e => getSubType(e) === 'variavel');
        const renderTbl = (title, sub, arr) => {
          const sPaid = arr.filter(e => e.status === 'Pago').reduce((a, x) => a + x.amount, 0);
          const sPend = arr.filter(e => e.status === 'Pendente').reduce((a, x) => a + x.amount, 0);
          const rows = arr.map(e => '<tr><td><strong>' + e.description + '</strong><br/><span style="font-size:11px;color:#64748b">' + e.category + '</span></td><td class="mono">' + fmtDate(e.dueDate) + '</td><td class="mono center">' + fmtInst(e.currentInstallment, e.totalInstallments) + '</td><td class="mono right" style="font-weight:700;color:' + (e.status === 'Pago' ? '#047857' : '#dc2626') + '">' + fmtBRL(e.amount) + '</td><td class="right"><button class="status-btn status-' + e.status + '" onclick="toggleStatus(\\'' + e.id + '\\')">' + e.status + '</button></td><td class="right"><button class="del-btn" onclick="deleteExp(\\'' + e.id + '\\')">✕</button></td></tr>').join('');
          return '<div class="col-4 panel"><div><div class="panel-head"><div><div class="panel-title">' + title + '</div><div class="panel-sub">' + sub + '</div></div><button class="btn btn-dark" onclick="openModal(\\'expense\\', \\'outras\\')">+ Lançar</button></div><table><thead><tr><th>Gasto</th><th>Vencimento</th><th class="center">Parcelas</th><th class="right">Valor</th><th class="right">Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="panel-foot mono"><strong>SUBTOTAL =</strong><span>Pago: <strong style="color:#047857">' + fmtBRL(sPaid) + '</strong> · Pendente: <strong style="color:#dc2626">' + fmtBRL(sPend) + '</strong></span></div></div>';
        };
        bodyHtml = '<div class="split-grid">' +
          renderTbl('1. Despesas Fixas', 'Contas mensais que nunca acabam', fixas) +
          renderTbl('2. Gastos Mensais', 'Gastos realizados durante o mês', mensais) +
          renderTbl('3. Despesas Variáveis', 'Parcelamentos, consórcios, empréstimos e boletos', parc) +
        '</div>';
      } else if (activeTab === 'reports') {
        const instItems = l.expenses.filter(e => e.currentInstallment && e.totalInstallments);
        let totalDevedor = 0;
        const instRows = instItems.map(e => {
          const paidCnt = e.status === 'Pago' ? Math.min(e.totalInstallments, e.currentInstallment) : Math.max(0, e.currentInstallment - 1);
          const unpaidCnt = Math.max(0, e.totalInstallments - paidCnt);
          const devedor = unpaidCnt * e.amount;
          totalDevedor += devedor;
          return '<tr><td><strong>' + e.description + '</strong><br/><span style="font-size:11px;color:#64748b">' + e.category + '</span></td><td class="mono center">' + fmtInst(e.currentInstallment, e.totalInstallments) + '</td><td class="mono center">' + (unpaidCnt === 0 ? '<strong style="color:#047857">Quitado!</strong>' : 'Faltam ' + unpaidCnt) + '</td><td class="mono right">' + fmtBRL(e.amount) + '</td><td class="mono right"><strong style="color:#dc2626">' + fmtBRL(devedor) + '</strong></td></tr>';
        }).join('');

        const cats = CATEGORIES.map(c => {
          const items = l.expenses.filter(e => e.category === c.name);
          const sum = items.reduce((a, b) => a + b.amount, 0);
          const pctExp = totalExp > 0 ? (sum / totalExp) * 100 : 0;
          const pctInc = totalInc > 0 ? (sum / totalInc) * 100 : 0;
          return { ...c, count: items.length, sum, pctExp, pctInc };
        }).filter(c => c.sum > 0).sort((a, b) => b.sum - a.sum);

        const catRows = cats.map((c, idx) => '<div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span><strong>0' + (idx + 1) + '. ' + c.name + '</strong> (' + c.count + ')</span><span class="mono">' + c.pctExp.toFixed(1) + '% dos gastos · ' + c.pctInc.toFixed(1) + '% da renda · <strong>' + fmtBRL(c.sum) + '</strong></span></div><div class="bar-bg"><div class="bar-fill" style="width:' + Math.max(2, c.pctExp) + '%;background:' + c.color + '"></div></div></div>').join('');

        bodyHtml = '<div class="split-grid">' +
          '<div class="col-7 panel"><div><div class="panel-head"><div><div class="panel-title">Saldo Devedor de Todas as Contas Parceladas</div><div class="panel-sub">Total de parcelas ainda em aberto</div></div><strong class="mono" style="color:#dc2626">' + fmtBRL(totalDevedor) + '</strong></div><table><thead><tr><th>Compromisso</th><th class="center">Parcela</th><th class="center">Em Aberto</th><th class="right">Parcela</th><th class="right">Saldo Devedor</th></tr></thead><tbody>' + instRows + '</tbody></table></div></div>' +
          '<div class="col-5 panel"><div class="panel-head"><div class="panel-title">Ranking Mensal por Categoria</div><strong class="mono">' + fmtBRL(totalExp) + '</strong></div><div class="panel-pad">' + catRows + '</div></div>' +
        '</div>';
      }

      root.innerHTML =
        renderVersionBanner() +
        '<header class="topbar"><div class="topbar-inner">' +
          '<a href="#" class="brand" style="display:flex;align-items:center;gap:10px" onclick="switchTab(\\'overview\\');return false;"><img src="${DOMUS_ICON_DATA_URI}" alt="Domus Finanças" style="width:32px;height:32px;border-radius:8px;border:1px solid #e2e8f0" /><span>Domus Finanças</span></a>' +
          '<nav class="nav-links">' +
            '<button class="nav-link ' + (activeTab === 'overview' ? 'active' : '') + '" onclick="switchTab(\\'overview\\')">Visão Geral</button>' +
            '<button class="nav-link ' + (activeTab === 'cards' ? 'active' : '') + '" onclick="switchTab(\\'cards\\')">Cartões e Contas</button>' +
            '<button class="nav-link ' + (activeTab === 'boletos' ? 'active' : '') + '" onclick="switchTab(\\'boletos\\')">Boletos e Fixas</button>' +
            '<button class="nav-link ' + (activeTab === 'reports' ? 'active' : '') + '" onclick="switchTab(\\'reports\\')">Relatórios</button>' +
          '</nav>' +
          '<button class="btn btn-dark" onclick="openModal(\\'expense\\')">+ Novo Lançamento</button>' +
        '</div></header>' +
        '<div class="toolbar"><div class="toolbar-inner">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<select class="btn" style="font-weight:700" onchange="changeMonth(this.value)">' + ledgers.map(m => '<option value="' + m.monthKey + '"' + (m.monthKey === l.monthKey ? ' selected' : '') + '>' + m.label + '</option>').join('') + '</select>' +
            '<button class="btn btn-green" onclick="generateNextMonth()">Gerar Próximo Mês</button>' +
            '<span style="font-size:12px;color:#475569">● <strong>' + cloudStatusText + '</strong> · Logado: <strong>' + loggedUser + '</strong> · ' + lastCloudAction + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<button class="btn" style="background:#ecfdf5;color:#065f46;border-color:#a7f3d0;font-weight:700" onclick="openVerModal()">v' + currentRelease.version + ' · Atualizações</button>' +
            '<button class="btn" onclick="forceCloudRefresh()">Atualizar da Nuvem</button>' +
            '<button class="btn btn-red-outline" onclick="logoutUser()">Sair / Trocar Login</button>' +
          '</div>' +
        '</div></div>' +
        '<main class="main">' +
          bodyHtml +
        '</main>';
    }

    renderApp();
    initCloudSync();
  </script>
</body>
</html>`;
}

// Encode UTF-8 string to Base64 in browser
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function toBatchBase64Chunks(b64String: string, targetVar: string): string[] {
  const chunks: string[] = [];
  const chunkSize = 800;
  for (let i = 0; i < b64String.length; i += chunkSize) {
    const chunk = b64String.slice(i, i + chunkSize);
    if (i === 0) {
      chunks.push(`> "%${targetVar}%" echo ${chunk}`);
    } else {
      chunks.push(`>> "%${targetVar}%" echo ${chunk}`);
    }
  }
  return chunks;
}

// Build a Windows .bat installer that compiles a native Windows executable (DomusFinancas.exe) with the official Domus Finanças icon embedded in its Win32 PE header, VisualElementsManifest.xml for Start Menu tiles, and Win32 IPropertyStore / WM_SETICON branding so Desktop, Start Menu ("Barra de Início"), Taskbar ("Barra de Tarefas"), and running windows ALWAYS display the official Domus Finanças logo instead of the Google Chrome icon.
export function buildWindowsInstallerBat(ledgers: MonthLedger[]): string {
  const htmlContent = buildStandaloneAppHTML(ledgers);
  const htmlB64 = utf8ToBase64(htmlContent);

  const visualManifestXml = [
    '<Application xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <VisualElements',
    '    BackgroundColor="#1B2A41"',
    '    ShowNameOnSquare150x150Logo="on"',
    '    ForegroundText="light"',
    '    Square150x150Logo="DomusFinanceiro.png"',
    '    Square70x70Logo="DomusFinanceiro.png" />',
    '</Application>',
  ].join('\r\n');
  const manifestB64 = utf8ToBase64(visualManifestXml);

  const csharpLauncherSource = [
    'using System;',
    'using System.Diagnostics;',
    'using System.Drawing;',
    'using System.IO;',
    'using System.Net;',
    'using System.Net.Sockets;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'using System.Threading;',
    '',
    'class DomusLauncher {',
    '    const int LOCAL_PORT = 45820;',
    '',
    '    [DllImport("shell32.dll", SetLastError = true)]',
    '    static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);',
    '',
    '    [DllImport("user32.dll", CharSet = CharSet.Auto)]',
    '    static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);',
    '',
    '    [DllImport("user32.dll")]',
    '    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
    '    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '',
    '    [DllImport("user32.dll", CharSet = CharSet.Unicode)]',
    '    static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);',
    '',
    '    [DllImport("user32.dll")]',
    '    static extern bool IsWindowVisible(IntPtr hWnd);',
    '',
    '    [DllImport("shell32.dll", SetLastError = true)]',
    '    static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [Out, MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore);',
    '',
    '    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    '    interface IPropertyStore {',
    '        int GetCount(out uint cProps);',
    '        int GetAt(uint iProp, out PROPERTYKEY pkey);',
    '        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);',
    '        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);',
    '        int Commit();',
    '    }',
    '',
    '    [StructLayout(LayoutKind.Sequential, Pack = 4)]',
    '    struct PROPERTYKEY {',
    '        public Guid fmtid;',
    '        public uint pid;',
    '        public PROPERTYKEY(string guid, uint id) {',
    '            fmtid = new Guid(guid);',
    '            pid = id;',
    '        }',
    '    }',
    '',
    '    [StructLayout(LayoutKind.Sequential)]',
    '    struct PROPVARIANT {',
    '        public ushort vt;',
    '        public ushort wReserved1;',
    '        public ushort wReserved2;',
    '        public ushort wReserved3;',
    '        public IntPtr pwszVal;',
    '        public IntPtr padding;',
    '        public static PROPVARIANT FromString(string val) {',
    '            PROPVARIANT pv = new PROPVARIANT();',
    '            pv.vt = 31;',
    '            pv.pwszVal = Marshal.StringToCoTaskMemUni(val);',
    '            return pv;',
    '        }',
    '    }',
    '',
    '    static void ApplyWindowBranding(IntPtr hwnd, string exePath, string icoPath, IntPtr hIconBig, IntPtr hIconSmall) {',
    '        const uint WM_SETICON = 0x0080;',
    '        if (hIconBig != IntPtr.Zero) SendMessage(hwnd, WM_SETICON, (IntPtr)1, hIconBig);',
    '        if (hIconSmall != IntPtr.Zero) SendMessage(hwnd, WM_SETICON, (IntPtr)0, hIconSmall);',
    '        try {',
    '            Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");',
    '            IPropertyStore store;',
    '            if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) == 0 && store != null) {',
    '                PROPERTYKEY pkId = new PROPERTYKEY("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 5);',
    '                PROPERTYKEY pkCmd = new PROPERTYKEY("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 2);',
    '                PROPERTYKEY pkIcon = new PROPERTYKEY("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 3);',
    '                PROPERTYKEY pkName = new PROPERTYKEY("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 4);',
    '                PROPVARIANT pvId = PROPVARIANT.FromString("Domus.Financas.DesktopApp");',
    '                PROPVARIANT pvCmd = PROPVARIANT.FromString("\\"" + exePath + "\\"");',
    '                PROPVARIANT pvIcon = PROPVARIANT.FromString(icoPath + ",0");',
    '                PROPVARIANT pvName = PROPVARIANT.FromString("Domus Financas");',
    '                store.SetValue(ref pkId, ref pvId);',
    '                store.SetValue(ref pkCmd, ref pvCmd);',
    '                store.SetValue(ref pkIcon, ref pvIcon);',
    '                store.SetValue(ref pkName, ref pvName);',
    '                store.Commit();',
    '            }',
    '        } catch {}',
    '    }',
    '',
    '    static bool IsServerRunning() {',
    '        try {',
    '            using (TcpClient client = new TcpClient()) {',
    '                IAsyncResult ar = client.BeginConnect(IPAddress.Loopback, LOCAL_PORT, null, null);',
    '                bool ok = ar.AsyncWaitHandle.WaitOne(250);',
    '                if (ok && client.Connected) { client.EndConnect(ar); return true; }',
    '            }',
    '        } catch {}',
    '        return false;',
    '    }',
    '',
    '    static void HandleHttpClient(object obj, string appDir) {',
    '        using (TcpClient client = (TcpClient)obj)',
    '        using (NetworkStream stream = client.GetStream()) {',
    '            stream.ReadTimeout = 3000;',
    '            stream.WriteTimeout = 3000;',
    '            byte[] buf = new byte[4096];',
    '            int read = 0;',
    '            try { read = stream.Read(buf, 0, buf.Length); } catch {}',
    '            if (read <= 0) return;',
    '            string req = Encoding.UTF8.GetString(buf, 0, read);',
    '            string[] firstLine = req.Split(\'\\r\', \'\\n\')[0].Split(\' \');',
    '            string rawPath = firstLine.Length > 1 ? firstLine[1] : "/";',
    '            int qIdx = rawPath.IndexOf(\'?\');',
    '            string cleanPath = (qIdx >= 0 ? rawPath.Substring(0, qIdx) : rawPath).Trim();',
    '',
    '            string standaloneDir = Path.Combine(appDir, "standalone");',
    '            string standaloneJs = Path.Combine(standaloneDir, "app.js");',
    '            string standaloneCss = Path.Combine(standaloneDir, "app.css");',
    '            string standaloneHtml = Path.Combine(standaloneDir, "index.html");',
    '            string fallbackHtml = Path.Combine(appDir, "DomusFinanceiro.html");',
    '            string pngFile = Path.Combine(appDir, "DomusFinanceiro.png");',
    '            string icoFile = Path.Combine(appDir, "DomusFinanceiro.ico");',
    '            string verFile = Path.Combine(standaloneDir, "version.json");',
    '',
    '            string targetFile = fallbackHtml;',
    '            string contentType = "text/html; charset=utf-8";',
    '',
    '            if (cleanPath == "/standalone/app.js" && File.Exists(standaloneJs)) {',
    '                targetFile = standaloneJs;',
    '                contentType = "application/javascript; charset=utf-8";',
    '            } else if (cleanPath == "/standalone/app.css" && File.Exists(standaloneCss)) {',
    '                targetFile = standaloneCss;',
    '                contentType = "text/css; charset=utf-8";',
    '            } else if (cleanPath == "/version.json" && File.Exists(verFile)) {',
    '                targetFile = verFile;',
    '                contentType = "application/json; charset=utf-8";',
    '            } else if (cleanPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase) && File.Exists(pngFile)) {',
    '                targetFile = pngFile;',
    '                contentType = "image/png";',
    '            } else if (cleanPath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase) && File.Exists(icoFile)) {',
    '                targetFile = icoFile;',
    '                contentType = "image/x-icon";',
    '            } else if (File.Exists(standaloneHtml) && File.Exists(standaloneJs)) {',
    '                targetFile = standaloneHtml;',
    '                contentType = "text/html; charset=utf-8";',
    '            }',
    '',
    '            if (!File.Exists(targetFile)) {',
    '                byte[] notFound = Encoding.UTF8.GetBytes("HTTP/1.1 404 Not Found\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n");',
    '                stream.Write(notFound, 0, notFound.Length);',
    '                return;',
    '            }',
    '',
    '            byte[] body = File.ReadAllBytes(targetFile);',
    '            string header = "HTTP/1.1 200 OK\\r\\n" +',
    '                            "Content-Type: " + contentType + "\\r\\n" +',
    '                            "Content-Length: " + body.Length + "\\r\\n" +',
    '                            "Cache-Control: no-cache\\r\\n" +',
    '                            "Access-Control-Allow-Origin: *\\r\\n" +',
    '                            "Connection: close\\r\\n\\r\\n";',
    '            byte[] headerBytes = Encoding.UTF8.GetBytes(header);',
    '            stream.Write(headerBytes, 0, headerBytes.Length);',
    '            stream.Write(body, 0, body.Length);',
    '        }',
    '    }',
    '',
    '    static void RunLocalServerLoop(string appDir) {',
    '        try {',
    '            TcpListener listener = new TcpListener(IPAddress.Loopback, LOCAL_PORT);',
    '            listener.Start();',
    '            while (true) {',
    '                TcpClient client = listener.AcceptTcpClient();',
    '                ThreadPool.QueueUserWorkItem(delegate(object c) {',
    '                    try { HandleHttpClient(c, appDir); } catch {}',
    '                }, client);',
    '            }',
    '        } catch {}',
    '    }',
    '',
    '    [STAThread]',
    '    static void Main(string[] args) {',
    '        try { SetCurrentProcessExplicitAppUserModelID("Domus.Financas.DesktopApp"); } catch {}',
    '        string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(\'\\\\\');',
    '        string exePath = Path.Combine(appDir, "DomusFinancas.exe");',
    '        string htmlPath = Path.Combine(appDir, "DomusFinanceiro.html");',
    '        string icoPath = Path.Combine(appDir, "DomusFinanceiro.ico");',
    '        string profileDir = Path.Combine(appDir, "AppProfile");',
    '',
    '        if (args != null && args.Length > 0 && args[0] == "--server-only") {',
    '            if (!IsServerRunning()) {',
    '                RunLocalServerLoop(appDir);',
    '            }',
    '            return;',
    '        }',
    '',
    '        if (!IsServerRunning()) {',
    '            try {',
    '                ProcessStartInfo bgPsi = new ProcessStartInfo();',
    '                bgPsi.FileName = exePath;',
    '                bgPsi.Arguments = "--server-only";',
    '                bgPsi.CreateNoWindow = true;',
    '                bgPsi.UseShellExecute = false;',
    '                Process.Start(bgPsi);',
    '                for (int w = 0; w < 15; w++) {',
    '                    if (IsServerRunning()) break;',
    '                    Thread.Sleep(80);',
    '                }',
    '            } catch {}',
    '        }',
    '',
    '        string launchUrl = IsServerRunning()',
    '            ? "http://127.0.0.1:" + LOCAL_PORT + "/"',
    '            : "file:///" + htmlPath.Replace("\\\\", "/").Replace(" ", "%20");',
    '',
    '        string[] chromePaths = new string[] {',
    '            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\\Chrome\\Application\\chrome.exe"),',
    '            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\\Chrome\\Application\\chrome.exe"),',
    '            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\\Chrome\\Application\\chrome.exe"),',
    '            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\\Edge\\Application\\msedge.exe"),',
    '            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\\Edge\\Application\\msedge.exe")',
    '        };',
    '',
    '        string browserExe = null;',
    '        foreach (string p in chromePaths) {',
    '            if (!string.IsNullOrEmpty(p) && File.Exists(p)) { browserExe = p; break; }',
    '        }',
    '',
    '        if (browserExe != null) {',
    '            ProcessStartInfo psi = new ProcessStartInfo();',
    '            psi.FileName = browserExe;',
    '            psi.Arguments = "--user-data-dir=\\"" + profileDir + "\\" --app=\\"" + launchUrl + "\\" --start-maximized --allow-file-access-from-files --disable-features=Translate";',
    '            psi.WindowStyle = ProcessWindowStyle.Maximized;',
    '            Process.Start(psi);',
    '        } else {',
    '            Process.Start(launchUrl);',
    '            return;',
    '        }',
    '',
    '        IntPtr hIconBig = IntPtr.Zero;',
    '        IntPtr hIconSmall = IntPtr.Zero;',
    '        try {',
    '            Icon icoBig = new Icon(icoPath, 64, 64);',
    '            hIconBig = icoBig.Handle;',
    '            Icon icoSmall = new Icon(icoPath, 32, 32);',
    '            hIconSmall = icoSmall.Handle;',
    '        } catch {}',
    '',
    '        for (int attempt = 0; attempt < 40; attempt++) {',
    '            Thread.Sleep(200);',
    '            bool found = false;',
    '            EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {',
    '                if (!IsWindowVisible(hWnd)) return true;',
    '                StringBuilder sb = new StringBuilder(256);',
    '                GetWindowText(hWnd, sb, 256);',
    '                string title = sb.ToString();',
    '                if (title.IndexOf("Domus", StringComparison.OrdinalIgnoreCase) >= 0) {',
    '                    ApplyWindowBranding(hWnd, exePath, icoPath, hIconBig, hIconSmall);',
    '                    found = true;',
    '                }',
    '                return true;',
    '            }, IntPtr.Zero);',
    '            if (found && attempt > 10) break;',
    '        }',
    '    }',
    '}',
  ].join('\r\n');
  const csB64 = utf8ToBase64(csharpLauncherSource);

  const vbsScript = [
    'On Error Resume Next',
    'Set ws = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'appDir = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\DomusFinanceiro"',
    'exeFile = appDir & "\\DomusFinancas.exe"',
    'htmlFile = appDir & "\\DomusFinanceiro.html"',
    'icoFile = appDir & "\\DomusFinanceiro.ico"',
    'profileDir = appDir & "\\AppProfile"',
    'fileUri = "file:///" & Replace(Replace(htmlFile, "\\", "/"), " ", "%20")',
    '',
    'chromeExe = ""',
    'c1 = ws.ExpandEnvironmentStrings("%ProgramFiles%") & "\\Google\\Chrome\\Application\\chrome.exe"',
    'c2 = ws.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\\Google\\Chrome\\Application\\chrome.exe"',
    'c3 = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\Google\\Chrome\\Application\\chrome.exe"',
    'If fso.FileExists(c1) Then chromeExe = c1',
    'If chromeExe = "" And fso.FileExists(c2) Then chromeExe = c2',
    'If chromeExe = "" And fso.FileExists(c3) Then chromeExe = c3',
    '',
    'If fso.FileExists(exeFile) Then',
    '  ws.RegWrite "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\DomusFinancasServer", Chr(34) & exeFile & Chr(34) & " --server-only", "REG_SZ"',
    'End If',
    '',
    'Sub CleanOldShortcuts(folderPath)',
    '  If Not fso.FolderExists(folderPath) Then Exit Sub',
    '  For Each file In fso.GetFolder(folderPath).Files',
    '    If LCase(fso.GetExtensionName(file.Name)) = "lnk" Then',
    '      shouldDelete = False',
    '      If InStr(1, file.Name, "Domus", 1) > 0 Then shouldDelete = True',
    '      If Not shouldDelete Then',
    '        Set existingSc = ws.CreateShortcut(file.Path)',
    '        If InStr(1, existingSc.Arguments, "ais-dev-", 1) > 0 Or InStr(1, existingSc.Arguments, "ais-pre-", 1) > 0 Or InStr(1, existingSc.Arguments, "Domus", 1) > 0 Or InStr(1, existingSc.TargetPath, "Domus", 1) > 0 Then',
    '          shouldDelete = True',
    '        End If',
    '      End If',
    '      If shouldDelete Then',
    '        fso.DeleteFile file.Path, True',
    '      End If',
    '    End If',
    '  Next',
    'End Sub',
    '',
    'Sub ConfigureShortcut(lnkPath)',
    '  If fso.FileExists(lnkPath) Then fso.DeleteFile lnkPath, True',
    '  Set sc = ws.CreateShortcut(lnkPath)',
    '  If fso.FileExists(exeFile) Then',
    '    sc.TargetPath = exeFile',
    '    sc.Arguments = ""',
    '  ElseIf chromeExe <> "" Then',
    '    sc.TargetPath = chromeExe',
    '    sc.Arguments = "--user-data-dir=" & Chr(34) & profileDir & Chr(34) & " --app=" & Chr(34) & fileUri & Chr(34) & " --start-maximized"',
    '  Else',
    '    sc.TargetPath = htmlFile',
    '  End If',
    '  sc.IconLocation = icoFile & ",0"',
    '  sc.WorkingDirectory = appDir',
    '  sc.WindowStyle = 3',
    '  sc.Description = "Domus Financas - Aplicativo Independente (100% Desvinculado do AI Studio)"',
    '  sc.Save',
    'End Sub',
    '',
    'desktop = ws.SpecialFolders("Desktop")',
    'startMenu = ws.ExpandEnvironmentStrings("%APPDATA%") & "\\Microsoft\\Windows\\Start Menu\\Programs"',
    'chromeAppsPt = startMenu & "\\Aplicativos do Chrome"',
    'chromeAppsEn = startMenu & "\\Chrome Apps"',
    'taskbarPinned = ws.ExpandEnvironmentStrings("%APPDATA%") & "\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"',
    '',
    'CleanOldShortcuts desktop',
    'CleanOldShortcuts startMenu',
    'CleanOldShortcuts chromeAppsPt',
    'CleanOldShortcuts chromeAppsEn',
    '',
    'ConfigureShortcut desktop & "\\Domus Financas.lnk"',
    'ConfigureShortcut startMenu & "\\Domus Financas.lnk"',
    'If fso.FolderExists(taskbarPinned) Then',
    '  CleanOldShortcuts taskbarPinned',
    '  ConfigureShortcut taskbarPinned & "\\Domus Financas.lnk"',
    'End If',
    '',
    'If fso.FileExists(exeFile) Then',
    '  ws.Run Chr(34) & exeFile & Chr(34), 1, False',
    'ElseIf chromeExe <> "" Then',
    '  appArgs = "--user-data-dir=" & Chr(34) & profileDir & Chr(34) & " --app=" & Chr(34) & fileUri & Chr(34) & " --start-maximized"',
    '  ws.Run Chr(34) & chromeExe & Chr(34) & " " & appArgs, 3, False',
    'Else',
    '  ws.Run Chr(34) & htmlFile & Chr(34), 3, False',
    'End If',
  ].join('\r\n');
  const vbsB64 = utf8ToBase64(vbsScript);

  const originUrl =
    typeof window !== 'undefined' &&
    window.location.origin.startsWith('http') &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('127.0.0.1')
      ? window.location.origin
      : PERMANENT_APP_LINK;

  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'title Instalador Domus Financas v2.8.0 - 100% Independente do AI Studio',
    'echo ====================================================================',
    'echo   INSTALANDO DOMUS FINANCAS v2.8.0 (DESVINCULADO DO AI STUDIO)',
    'echo ====================================================================',
    'echo.',
    'echo [1/4] Preparando pasta local em %LOCALAPPDATA%\\DomusFinanceiro...',
    'set "APP_DIR=%LOCALAPPDATA%\\DomusFinanceiro"',
    'set "STANDALONE_DIR=%APP_DIR%\\standalone"',
    'if not exist "%APP_DIR%" mkdir "%APP_DIR%"',
    'if not exist "%STANDALONE_DIR%" mkdir "%STANDALONE_DIR%"',
    'taskkill /f /im DomusFinancas.exe >nul 2>&1',
    'set "B64_FILE=%APP_DIR%\\app.b64"',
    'set "HTML_FILE=%APP_DIR%\\DomusFinanceiro.html"',
    'set "ICO_B64_FILE=%APP_DIR%\\icon.b64"',
    'set "ICO_FILE=%APP_DIR%\\DomusFinanceiro.ico"',
    'set "PNG_B64_FILE=%APP_DIR%\\logo.b64"',
    'set "PNG_FILE=%APP_DIR%\\DomusFinanceiro.png"',
    'set "MANIFEST_B64_FILE=%APP_DIR%\\manifest.b64"',
    'set "MANIFEST_FILE=%APP_DIR%\\DomusFinancas.VisualElementsManifest.xml"',
    'set "CS_B64_FILE=%APP_DIR%\\launcher.b64"',
    'set "CS_FILE=%APP_DIR%\\DomusLauncher.cs"',
    'set "EXE_FILE=%APP_DIR%\\DomusFinancas.exe"',
    'set "VBS_B64_FILE=%APP_DIR%\\shortcut.b64"',
    'set "VBS_FILE=%APP_DIR%\\create_shortcut.vbs"',
    '',
    'echo [2/4] Gravando sistema e icones oficiais no disco rigido...',
    ...toBatchBase64Chunks(htmlB64, 'B64_FILE'),
    'certutil -f -decode "%B64_FILE%" "%HTML_FILE%" >nul 2>&1',
    'del "%B64_FILE%" >nul 2>&1',
    '',
    ...toBatchBase64Chunks(DOMUS_ICO_BASE64, 'ICO_B64_FILE'),
    'certutil -f -decode "%ICO_B64_FILE%" "%ICO_FILE%" >nul 2>&1',
    'del "%ICO_B64_FILE%" >nul 2>&1',
    '',
    ...toBatchBase64Chunks(DOMUS_PNG_BASE64, 'PNG_B64_FILE'),
    'certutil -f -decode "%PNG_B64_FILE%" "%PNG_FILE%" >nul 2>&1',
    'del "%PNG_B64_FILE%" >nul 2>&1',
    '',
    ...toBatchBase64Chunks(manifestB64, 'MANIFEST_B64_FILE'),
    'certutil -f -decode "%MANIFEST_B64_FILE%" "%MANIFEST_FILE%" >nul 2>&1',
    'del "%MANIFEST_B64_FILE%" >nul 2>&1',
    '',
    'echo [3/4] Baixando pacote completo e compilando motor local (127.0.0.1:45820)...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '${originUrl}/standalone/index.html' -OutFile '%STANDALONE_DIR%\\index.html' -UseBasicParsing; Invoke-WebRequest -Uri '${originUrl}/standalone/app.js' -OutFile '%STANDALONE_DIR%\\app.js' -UseBasicParsing; Invoke-WebRequest -Uri '${originUrl}/standalone/app.css' -OutFile '%STANDALONE_DIR%\\app.css' -UseBasicParsing; Invoke-WebRequest -Uri '${originUrl}/version.json' -OutFile '%STANDALONE_DIR%\\version.json' -UseBasicParsing } catch {}" >nul 2>&1`,
    '',
    ...toBatchBase64Chunks(csB64, 'CS_B64_FILE'),
    'certutil -f -decode "%CS_B64_FILE%" "%CS_FILE%" >nul 2>&1',
    'del "%CS_B64_FILE%" >nul 2>&1',
    '',
    'set "CSC_EXE="',
    'if exist "%SystemRoot%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" set "CSC_EXE=%SystemRoot%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"',
    'if not defined CSC_EXE if exist "%SystemRoot%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe" set "CSC_EXE=%SystemRoot%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"',
    'if defined CSC_EXE (',
    '  "%CSC_EXE%" /nologo /target:winexe /optimize+ /r:System.Drawing.dll /win32icon:"%ICO_FILE%" /out:"%EXE_FILE%" "%CS_FILE%" >nul 2>&1',
    ')',
    'del "%CS_FILE%" >nul 2>&1',
    '',
    'echo [4/4] Removendo atalhos antigos do AI Studio e criando novo atalho independente...',
    ...toBatchBase64Chunks(vbsB64, 'VBS_B64_FILE'),
    'certutil -f -decode "%VBS_B64_FILE%" "%VBS_FILE%" >nul 2>&1',
    'del "%VBS_B64_FILE%" >nul 2>&1',
    'cscript //nologo "%VBS_FILE%" >nul 2>&1',
    'del "%VBS_FILE%" >nul 2>&1',
    '',
    'ie4uinit.exe -show >nul 2>&1',
    'ie4uinit.exe -ClearIconCache >nul 2>&1',
    'echo.',
    'echo ====================================================================',
    'echo   INSTALACAO CONCLUIDA! ABRINDO DOMUS FINANCAS INDEPENDENTE...',
    'echo ====================================================================',
    'timeout /t 2 >nul',
    'exit',
  ];

  return lines.join('\r\n');
}

export function downloadWindowsInstallerBatFile(
  ledgers: MonthLedger[],
  onShowToast?: (msg: string) => void
): void {
  const batContent = buildWindowsInstallerBat(ledgers);
  const blob = new Blob([batContent], { type: 'application/x-bat;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Instalar-Domus-Financeiro-Notebook.bat';
  a.click();
  URL.revokeObjectURL(url);
  if (onShowToast) {
    onShowToast(
      'Instalador Windows (.bat) baixado! Cria o executável nativo DomusFinancas.exe com o ícone oficial na Área de Trabalho, Menu Iniciar e Barra de Tarefas (nunca usa o ícone do Chrome).'
    );
  }
}

export function downloadStandaloneAppHtmlFile(
  ledgers: MonthLedger[],
  onShowToast?: (msg: string) => void
): void {
  const htmlContent = buildStandaloneAppHTML(ledgers);
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Domus-Financeiro-Completo.html';
  a.click();
  URL.revokeObjectURL(url);
  if (onShowToast) {
    onShowToast(
      'Aplicativo Completo Independente (.html) baixado! Funciona no Notebook e no Celular com Login, 5 Abas e Sincronização em Nuvem sem depender de links externos.'
    );
  }
}
