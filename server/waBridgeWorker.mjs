import fs from 'fs';
import path from 'path';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore/lite';

const FIREBASE_PROJECT_ID = 'nimble-might-65wls';
const FIRESTORE_DATABASE_ID =
  'ai-studio-domuscontrolefin-af87b841-f232-48c0-a854-6751f0583616';
const HOUSEHOLD_DOC_ID = 'domus_family';
const QR_BRIDGE_DOC_KEY = '2099-10';
const AUTH_DIR = path.resolve(process.cwd(), '.wa_auth_session');

const ALLOWED_CATEGORIES = [
  'Consórcios & Patrimônio',
  'Financeiro & Cartões',
  'Moradia & Financiamento',
  'Utilidades (Luz & Água)',
  'Transporte & Veículos',
  'Lazer & Clube',
  'Internet & Telefonia',
  'Educação & Filhos',
  'Associações & Saúde',
  'Assinaturas & Serviços',
  'Outros & Jurídico',
];

const DEFAULT_BLOCKS = [
  { id: 'bradesco', shortName: 'Bradesco', fullTitle: 'Cartão Bradesco - Débito em Conta', group: 'cartao_conta' },
  { id: 'santander', shortName: 'Santander', fullTitle: 'Cartão Santander - Débito em Conta', group: 'cartao_conta' },
  { id: 'caixa', shortName: 'Caixa', fullTitle: 'Conta Caixa - Débito em Conta', group: 'cartao_conta' },
  { id: 'quero_quero', shortName: 'Quero Quero', fullTitle: 'Cartão Quero Quero - Direto na Loja', group: 'cartao_conta' },
  { id: 'nubank', shortName: 'NuBank', fullTitle: 'Cartão NuBank - Débito em Conta', group: 'cartao_conta' },
  { id: 'sicredi', shortName: 'Sicredi', fullTitle: 'Cartão Sicredi Viviane - Débito em Conta', group: 'cartao_conta' },
  { id: 'outras', shortName: 'Boletos e Fixas', fullTitle: 'Outras Despesas - Boletos e Fixas', group: 'boletos_pix' },
];

const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
];

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({ projectId: FIREBASE_PROJECT_ID });
const db = getFirestore(app, FIRESTORE_DATABASE_ID);

const sentBotMessageIds = new Set();
let currentSock = null;
let lastHandledCmdTimestamp = Date.now();
let isStarting = false;

function formatBRL(val) {
  return Number(val || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function normalizeText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hasExplicitCreditCardSignal(text) {
  const norm = normalizeText(text);
  return /\b(cartao|cartao de credito|compra credito|compra no credito|credito a vista|credito parcelado|no credito|na funcao credito|fatura|mastercard|visa|elo|quero quero|quero_quero)\b/.test(
    norm
  );
}

function hasPixPaymentSignal(text) {
  const norm = normalizeText(text);
  return /\b(pix|chave pix|comprovante pix|transferencia pix|pagamento pix|e2e|id\/transacao|id transacao|autenticacao pix)\b/.test(
    norm
  );
}

function extractInstallmentsFromText(rawText) {
  const norm = normalizeText(rawText);

  const slashMatch = norm.match(/\b(?:parcela|parc\.?)?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/);
  if (slashMatch) {
    const curr = Number(slashMatch[1]);
    const tot = Number(slashMatch[2]);
    if (curr >= 1 && tot >= 2 && tot <= 120 && curr <= tot) {
      const idx = slashMatch.index ?? 0;
      const surrounding = norm.slice(Math.max(0, idx - 10), idx + slashMatch[0].length + 10);
      if (!/\b(dia|vence|vencimento|em)\s+\d{1,2}\/\d{1,2}/.test(surrounding)) {
        return { currentInstallment: curr, totalInstallments: tot, isPerInstallmentAmount: true };
      }
    }
  }

  const xDeMatch = norm.match(/\b(\d{1,2})\s*(?:x|vezes)\s*(?:de|x)\s*(?:r\$\s*)?\d+/);
  if (xDeMatch) {
    const tot = Number(xDeMatch[1]);
    if (tot >= 2 && tot <= 120) {
      return { currentInstallment: 1, totalInstallments: tot, isPerInstallmentAmount: true };
    }
  }

  const xOnlyMatch = norm.match(/\b(?:em\s+|parcelad[oa]\s+em\s+|parcelad[oa]\s+)?(\d{1,2})\s*(?:x|vezes)\b/);
  if (xOnlyMatch) {
    const tot = Number(xOnlyMatch[1]);
    if (tot >= 2 && tot <= 120) {
      return { currentInstallment: 1, totalInstallments: tot, isPerInstallmentAmount: false };
    }
  }

  return { currentInstallment: null, totalInstallments: null, isPerInstallmentAmount: false };
}

function extractDueDateFromText(rawText, activeMonthKey, todayIso) {
  const norm = normalizeText(rawText);
  const fullDateMatch = String(rawText || '').match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (fullDateMatch) {
    const d = Number(fullDateMatch[1]);
    const m = Number(fullDateMatch[2]);
    const yRaw = fullDateMatch[3];
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const year = yRaw
        ? yRaw.length === 2
          ? `20${yRaw}`
          : yRaw
        : activeMonthKey.slice(0, 4);
      const isInstallmentContext = new RegExp(
        `\\b(?:parcela|parc\\.?)\\s*${fullDateMatch[1]}/${fullDateMatch[2]}\\b`
      ).test(norm);
      if (!isInstallmentContext) {
        return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  const dayMatch = norm.match(/\b(?:dia|vence(?:\s+dia)?|vencimento(?:\s+dia)?|para\s+dia|pro\s+dia)\s+(\d{1,2})\b/);
  if (dayMatch) {
    const d = Number(dayMatch[1]);
    if (d >= 1 && d <= 31) {
      return `${activeMonthKey}-${String(d).padStart(2, '0')}`;
    }
  }

  return `${activeMonthKey}-${todayIso.slice(8, 10)}`;
}

function extractAmountFromText(rawText) {
  const cleaned = String(rawText || '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(?:dia|vence(?:\s+dia)?|vencimento(?:\s+dia)?|para\s+dia)\s+\d{1,2}\b/gi, ' ')
    .replace(/\b(\d{1,2})\s*(?:x|vezes)\b/gi, ' ');

  const brlMatches = cleaned.match(
    /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+\.\d{2}|\b\d+(?:\b|$))/gi
  );
  if (!brlMatches || brlMatches.length === 0) return 0;

  for (const token of brlMatches) {
    const numStr = token.replace(/r\$\s*/i, '').trim();
    let parsed = 0;
    if (numStr.includes(',')) {
      parsed = Number(numStr.replace(/\./g, '').replace(',', '.'));
    } else {
      parsed = Number(numStr);
    }
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1000000) {
      return Math.round(parsed * 100) / 100;
    }
  }
  return 0;
}

function findStrictMatchingPendingExpense(existingExpenses, candidateText, extractedAmount) {
  const norm = normalizeText(candidateText);
  if (!norm) return null;

  const pendingList = existingExpenses.filter((e) => e.status === 'Pendente');
  for (const exp of pendingList) {
    const expNorm = normalizeText(exp.description);
    if (!expNorm || expNorm.length < 3) continue;

    const words = expNorm
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !['conta', 'pagamento', 'mensal', 'parcela', 'fatura'].includes(w));

    const exactNameMatch =
      norm.includes(expNorm) || (words.length > 0 && words.every((w) => norm.includes(w)));
    if (!exactNameMatch) continue;

    if (extractedAmount > 0 && exp.amount > 0) {
      const diff = Math.abs(exp.amount - extractedAmount);
      const pct = diff / Math.max(exp.amount, extractedAmount);
      if (diff > 15 && pct > 0.2) {
        continue;
      }
    }

    return exp;
  }

  return null;
}

function parsePortugueseFinancialTextFallback(params) {
  const norm = normalizeText(params.text);
  const inst = extractInstallmentsFromText(params.text);
  let extractedAmount = extractAmountFromText(params.text);

  if (
    extractedAmount > 0 &&
    inst.totalInstallments &&
    inst.totalInstallments >= 2 &&
    !inst.isPerInstallmentAmount &&
    !/\bde\s*(?:r\$\s*)?\d+/.test(norm)
  ) {
    extractedAmount = Math.round((extractedAmount / inst.totalInstallments) * 100) / 100;
  }

  const isIncome =
    /\b(recebi|recebido|entrada|salario|pro-labore|pro labore|ganhei|depilacao|azilo|freela|renda|deposito recebido|pix recebido)\b/.test(
      norm
    ) ||
    (/\b(extra)\b/.test(norm) && !/\b(paguei|gastei|comprei|mercado)\b/.test(norm));

  const transactionType = isIncome ? 'income' : 'expense';

  let person = params.defaultPerson === 'Viviane' ? 'Viviane' : 'Rodolfo';
  if (/\b(viviane|vivi|azilo|depilacao)\b/.test(norm)) {
    person = 'Viviane';
  } else if (/\b(rodolfo|pm|marcenaria)\b/.test(norm)) {
    person = 'Rodolfo';
  }

  const isPending = /\b(pendente|vence|vencimento|agendado|a pagar|falta pagar|vai vencer|para pagar|boleto para)\b/.test(
    norm
  );

  const matchedExpense =
    transactionType === 'expense' && !isPending
      ? findStrictMatchingPendingExpense(params.existingExpenses, params.text, extractedAmount)
      : null;

  const action = matchedExpense ? 'mark_existing_paid' : 'create';
  const isCreditCard = hasExplicitCreditCardSignal(params.text);
  const isPix = hasPixPaymentSignal(params.text);
  const paymentMethod = isCreditCard
    ? 'credit_card'
    : isPix
    ? 'pix'
    : /\b(boleto)\b/.test(norm)
    ? 'boleto'
    : 'debit_cash';

  let blockId = matchedExpense ? matchedExpense.blockId : 'outras';
  if (!matchedExpense && isCreditCard && !isPix) {
    for (const blk of params.blocks) {
      if (blk.id === 'outras') continue;
      const blkNorm = normalizeText(blk.shortName);
      if (
        (blkNorm && norm.includes(blkNorm)) ||
        norm.includes(blk.id.replace('_', ' ')) ||
        norm.includes(blk.id)
      ) {
        blockId = blk.id;
        break;
      }
    }
  }

  let boletoSubType = inst.totalInstallments ? 'variavel' : 'mensal';
  let category = matchedExpense ? matchedExpense.category : 'Outros & Jurídico';

  if (/\b(luz|energia|fit energia|agua|samae|sanepar|copel|copeldis|celesc)\b/.test(norm)) {
    category = 'Utilidades (Luz & Água)';
  } else if (/\b(internet|telecon|help|tim|vivo|claro|celular|telefone|wi-fi)\b/.test(norm)) {
    category = 'Internet & Telefonia';
  } else if (/\b(escola|reforco|lorenzo|funcional|creche|faculdade|curso)\b/.test(norm)) {
    category = 'Educação & Filhos';
  } else if (/\b(consorcio|virtus|start|patrimonio)\b/.test(norm)) {
    boletoSubType = 'variavel';
    category = 'Consórcios & Patrimônio';
  } else if (/\b(candeias|clube|lazer|viagem|hotel|cinema|passeio)\b/.test(norm)) {
    boletoSubType = norm.includes('candeias') ? 'variavel' : boletoSubType;
    category = 'Lazer & Clube';
  } else if (/\b(gasolina|combustivel|posto|etanol|diesel|oficina|pneu|carro|moto|uber|pedagio)\b/.test(norm)) {
    category = 'Transporte & Veículos';
  } else if (/\b(farmacia|remedio|medico|consulta|exame|dentista|saude|aapomil|hospital)\b/.test(norm)) {
    category = 'Associações & Saúde';
  } else if (/\b(tv|p2p|netflix|spotify|assinatura|amazon|youtube)\b/.test(norm)) {
    category = 'Assinaturas & Serviços';
  } else if (/\b(aluguel|condominio|iptu|financiamento|casa|reforma)\b/.test(norm)) {
    category = 'Moradia & Financiamento';
  } else if (blockId !== 'outras') {
    category = 'Financeiro & Cartões';
  }

  const finalAmount =
    extractedAmount > 0
      ? extractedAmount
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;

  let cleanDesc = String(params.text || '')
    .replace(/^domus[:\s-]*/i, '')
    .replace(/^(paguei|gastei|comprei|recebi|fiz\s+pix|pix\s+de|pix|lancamento|lançar|pago|pendente|conta\s+pendente)\b[\s,:-]*/i, '')
    .replace(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+\.\d{2})/gi, '')
    .replace(/\b(?:dia|vence(?:\s+dia)?|vencimento(?:\s+dia)?|para\s+dia)\s+\d{1,2}(?:\/\d{1,2})?\b/gi, ' ')
    .replace(/\b(?:em\s+|parcelad[oa]\s+em\s+)?\d{1,2}\s*(?:x|vezes)\b/gi, ' ')
    .replace(/\b(?:parcela|parc\.?)\s*\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/gi, ' ')
    .replace(/\b(no|na|do|da|de|em|via|pix|hoje|reais|pendente|a pagar)\b/gi, ' ')
    .replace(/[,;.\-–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (matchedExpense) {
    cleanDesc = matchedExpense.description;
  } else if (!cleanDesc || cleanDesc.length < 2) {
    cleanDesc = transactionType === 'income' ? `Entrada (${person})` : 'Pagamento via PIX';
  } else {
    cleanDesc = cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1);
  }

  return {
    transactionType,
    paymentMethod,
    action,
    matchedExistingExpenseId: matchedExpense ? matchedExpense.id : '',
    description: cleanDesc.slice(0, 75),
    amount: finalAmount,
    date: extractDueDateFromText(params.text, params.activeMonthKey, params.todayIso),
    status: isPending ? 'Pendente' : 'Pago',
    blockId,
    boletoSubType,
    category,
    currentInstallment: inst.currentInstallment ?? 0,
    totalInstallments: inst.totalInstallments ?? 0,
    person,
  };
}

async function updateBridgeStateInFirestore(status, dataValue, logEntry = null) {
  try {
    const ref = doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', QR_BRIDGE_DOC_KEY);
    let prevExpenses = [];
    let cmdEntry = {
      id: 'qr-cmd',
      person: 'Família',
      description: 'idle',
      amount: lastHandledCmdTimestamp,
      date: '',
    };

    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        if (Array.isArray(d?.expenses)) prevExpenses = d.expenses;
        if (Array.isArray(d?.incomes)) {
          const existingCmd = d.incomes.find((i) => i?.id === 'qr-cmd');
          if (existingCmd) cmdEntry = existingCmd;
        }
      }
    } catch {
      // Ignore read error
    }

    const nextExpenses = logEntry
      ? [logEntry, ...prevExpenses].slice(0, 20)
      : prevExpenses.slice(0, 20);

    await setDoc(ref, {
      householdId: HOUSEHOLD_DOC_ID,
      monthKey: QR_BRIDGE_DOC_KEY,
      label: 'Conexão Direta WhatsApp QR Code',
      year: 2099,
      month: 10,
      incomes: [
        {
          id: 'qr-state',
          person: 'Família',
          description: status, // 'connecting' | 'qr_ready' | 'connected'
          amount: Date.now(),
          date: String(dataValue || ''),
        },
        cmdEntry,
      ],
      expenses: nextExpenses,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[WA-Bridge] Error updating Firestore state:', err?.message || err);
  }
}

async function parseAndSaveToSpreadsheet(params) {
  const apiKey = process.env.GEMINI_API_KEY;
  let activeMonthKey = '2026-11';
  let blocks = [...DEFAULT_BLOCKS];
  let existingExpenses = [];
  let rawLedgers = [];

  try {
    const workspaceSnap = await getDoc(doc(db, 'households', HOUSEHOLD_DOC_ID));
    if (workspaceSnap.exists()) {
      const wData = workspaceSnap.data();
      if (typeof wData.activeMonthKey === 'string' && /^\d{4}-\d{2}$/.test(wData.activeMonthKey)) {
        activeMonthKey = wData.activeMonthKey;
      }
      if (Array.isArray(wData.ledgers) && wData.ledgers.length > 0) {
        rawLedgers = wData.ledgers;
        const activeLedger =
          rawLedgers.find((l) => l.monthKey === activeMonthKey) ||
          rawLedgers[rawLedgers.length - 1];
        if (activeLedger) {
          if (typeof activeLedger.monthKey === 'string') {
            activeMonthKey = activeLedger.monthKey;
          }
          if (Array.isArray(activeLedger.customBlocks) && activeLedger.customBlocks.length > 0) {
            blocks = activeLedger.customBlocks;
          }
          if (Array.isArray(activeLedger.expenses)) {
            existingExpenses = activeLedger.expenses;
          }
        }
      }
    }
  } catch {
    // Fallback to defaults
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultPerson = String(params.senderName || '')
    .toLowerCase()
    .includes('viviane')
    ? 'Viviane'
    : 'Rodolfo';

  let raw = null;
  let effectiveText = String(params.text || '').trim();
  const isAudio = Boolean(params.imageBase64 && String(params.imageMimeType || '').startsWith('audio/'));

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
        httpOptions: {
          apiVersion: 'v1beta',
          timeout: 18000,
          retryOptions: { attempts: 1 },
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const parts = [];
      if (params.imageBase64 && params.imageMimeType) {
        parts.push({
          inlineData: {
            mimeType: params.imageMimeType,
            data: params.imageBase64,
          },
        });
      }
      parts.push({
        text: [
          `Data de hoje: ${todayIso}`,
          `Mês ativo: ${activeMonthKey}`,
          `Remetente: ${defaultPerson}`,
          `Blocos disponíveis: ${JSON.stringify(blocks.map((b) => ({ id: b.id, nome: b.shortName, titulo: b.fullTitle })))}`,
          `Contas PENDENTES existentes no mês: ${JSON.stringify(
            existingExpenses
              .filter((e) => e.status === 'Pendente')
              .map((e) => ({
                id: e.id,
                descricao: e.description,
                valor: e.amount,
                vencimento: e.dueDate,
                bloco: e.blockId,
              }))
          )}`,
          effectiveText
            ? `Mensagem/Legenda: "${effectiveText}"`
            : isAudio
            ? 'Ouça o áudio em português, transcreva em transcript e extraia os dados financeiros.'
            : 'Extraia todos os dados do comprovante (do topo ao rodapé).',
        ].join('\n'),
      });

      const systemInstruction = `Você é o classificador financeiro do Domus Finanças (Rodolfo e Viviane).
Analise comprovantes PIX (inclusive compridos do Santander/Sicredi/Bradesco/Nubank), PDFs, áudios em português ou mensagens.

REGRAS OBRIGATÓRIAS:
1. Leia a imagem inteira do topo até o rodapé (valor, destinatário "Para:", pagador "De:", data).
2. PIX vs CARTÃO DE CRÉDITO (paymentMethod):
   - Comprovante de PIX (mesmo Sicredi, Santander, Bradesco ou Nubank) -> paymentMethod = "pix", blockId = "outras" (NUNCA coloque PIX no Cartão de Crédito!).
   - SÓ coloque em bloco de Cartão de Crédito (paymentMethod = "credit_card") se aparecer explicitamente "compra crédito", "crédito à vista", "crédito parcelado", "cartão de crédito", "no cartão", "no crédito", "fatura", "Mastercard", "Visa", "Elo", "Quero Quero".
3. CONTA FIXA EXISTENTE vs GASTO AVULSO:
   - Só use action = "mark_existing_paid" se o destinatário E o valor corresponderem claramente à conta pendente cadastrada (ex: Fit Energia).
   - Se for PIX para outra empresa ou outro valor (ex: COPEL / COPELDIS com legenda "Luz"), NÃO dê baixa na Fit Energia! Use action = "create", blockId = "outras", boletoSubType = "mensal", status = "Pago".
4. PENDENTES E PARCELADAS:
   - "pendente", "a pagar", "vence dia 15" -> status = "Pendente" + data de vencimento em date (YYYY-MM-DD).
   - "5x de 120", "parcela 2/10", "600 em 3x" -> preencha currentInstallment e totalInstallments (se 600 em 3x -> amount = 200). Se blockId="outras", boletoSubType="variavel".
5. ÁUDIO: transcreva o que foi falado em "transcript".
6. Categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.`;

      for (const modelName of MODEL_FALLBACK_CHAIN) {
        try {
          const isGemini25 = modelName.startsWith('gemini-2.5');
          const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts },
            config: {
              systemInstruction,
              temperature: 0.1,
              ...(isGemini25 ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  transactionType: { type: Type.STRING },
                  paymentMethod: { type: Type.STRING },
                  action: { type: Type.STRING },
                  matchedExistingExpenseId: { type: Type.STRING },
                  description: { type: Type.STRING },
                  amount: { type: Type.NUMBER },
                  date: { type: Type.STRING },
                  status: { type: Type.STRING },
                  blockId: { type: Type.STRING },
                  boletoSubType: { type: Type.STRING },
                  category: { type: Type.STRING },
                  currentInstallment: { type: Type.INTEGER },
                  totalInstallments: { type: Type.INTEGER },
                  person: { type: Type.STRING },
                  transcript: { type: Type.STRING },
                },
                required: [
                  'transactionType',
                  'paymentMethod',
                  'action',
                  'description',
                  'amount',
                  'date',
                  'status',
                  'blockId',
                  'boletoSubType',
                  'category',
                  'person',
                ],
              },
            },
          });
          const textResp = (response.text ?? '').trim();
          const firstBrace = textResp.indexOf('{');
          const lastBrace = textResp.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            raw = JSON.parse(textResp.slice(firstBrace, lastBrace + 1));
            break;
          }
        } catch {
          // Try next model
        }
      }

      // Dedicated audio transcription fallback
      if (!raw && isAudio && params.imageBase64 && params.imageMimeType) {
        try {
          const transRes = await ai.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                { inlineData: { mimeType: params.imageMimeType, data: params.imageBase64 } },
                { text: 'Transcreva exatamente o que foi falado em português brasileiro.' },
              ],
            },
          });
          const transcript = (transRes.text ?? '').trim();
          if (transcript) {
            effectiveText = effectiveText ? `${effectiveText} ${transcript}` : transcript;
            raw = {
              ...parsePortugueseFinancialTextFallback({
                text: effectiveText,
                blocks,
                existingExpenses,
                activeMonthKey,
                todayIso,
                defaultPerson,
              }),
              transcript,
            };
          }
        } catch {
          // Ignore transcription fallback error
        }
      }
    } catch {
      raw = null;
    }
  }

  if (!raw && effectiveText) {
    raw = parsePortugueseFinancialTextFallback({
      text: effectiveText,
      blocks,
      existingExpenses,
      activeMonthKey,
      todayIso,
      defaultPerson,
    });
  }

  if (!raw) {
    throw new Error('Could not parse message');
  }

  const transactionType = raw.transactionType === 'income' ? 'income' : 'expense';
  const isPending = raw.status === 'Pendente';
  let matchedExpense =
    transactionType === 'expense' && !isPending && raw.matchedExistingExpenseId
      ? existingExpenses.find(
          (e) => e.id === raw.matchedExistingExpenseId && e.status === 'Pendente'
        ) || null
      : null;

  const amountNum = Number(raw.amount);
  const amount =
    Number.isFinite(amountNum) && amountNum > 0
      ? Math.round(amountNum * 100) / 100
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;

  if (amount <= 0) {
    throw new Error('Zero amount');
  }

  if (matchedExpense && amount > 0 && matchedExpense.amount > 0) {
    const diff = Math.abs(matchedExpense.amount - amount);
    const pct = diff / Math.max(matchedExpense.amount, amount);
    if (diff > 15 && pct > 0.2) {
      matchedExpense = null;
    }
  }

  const action =
    matchedExpense && raw.action === 'mark_existing_paid'
      ? 'mark_existing_paid'
      : 'create';

  const validBlockIds = new Set(blocks.map((b) => b.id));
  let blockId = matchedExpense
    ? matchedExpense.blockId
    : validBlockIds.has(String(raw.blockId))
    ? String(raw.blockId)
    : 'outras';

  const combinedText = `${effectiveText} ${String(raw.transcript || '')} ${String(raw.description || '')}`;
  const paymentMethod = String(raw.paymentMethod || '').toLowerCase();
  const explicitCredit =
    paymentMethod === 'credit_card' || hasExplicitCreditCardSignal(combinedText);
  const isPix = paymentMethod === 'pix' || hasPixPaymentSignal(combinedText);

  if (!matchedExpense && blockId !== 'outras' && (isPix || !explicitCredit)) {
    blockId = 'outras';
  }

  const fallbackInst = extractInstallmentsFromText(`${effectiveText} ${String(raw.transcript || '')}`);
  const rawCurr = Number(raw.currentInstallment);
  const rawTot = Number(raw.totalInstallments);
  let currentInstallment =
    Number.isInteger(rawCurr) && rawCurr >= 1 ? rawCurr : fallbackInst.currentInstallment;
  let totalInstallments =
    Number.isInteger(rawTot) && rawTot >= 2 ? rawTot : fallbackInst.totalInstallments;
  if (totalInstallments && (!currentInstallment || currentInstallment > totalInstallments)) {
    currentInstallment = 1;
  }
  if (!totalInstallments || totalInstallments < 2) {
    currentInstallment = null;
    totalInstallments = null;
  }

  const boletoSubType =
    totalInstallments && blockId === 'outras'
      ? 'variavel'
      : raw.boletoSubType === 'fixa' || raw.boletoSubType === 'variavel'
      ? raw.boletoSubType
      : 'mensal';

  const category = ALLOWED_CATEGORIES.includes(String(raw.category))
    ? String(raw.category)
    : 'Outros & Jurídico';
  const person =
    raw.person === 'Rodolfo' || raw.person === 'Viviane' ? raw.person : defaultPerson;

  const description = String(
    matchedExpense ? matchedExpense.description : raw.description || 'Lançamento via WhatsApp'
  ).slice(0, 75);
  const date =
    typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : extractDueDateFromText(effectiveText, activeMonthKey, todayIso);
  const status = isPending ? 'Pendente' : 'Pago';
  const transcript =
    typeof raw.transcript === 'string' && raw.transcript.trim()
      ? raw.transcript.trim().slice(0, 180)
      : null;

  const blockObj = blocks.find((b) => b.id === blockId);
  const destinationLabel =
    transactionType === 'income'
      ? `Visão Geral → Entradas da Família (${person})`
      : action === 'mark_existing_paid' && matchedExpense
      ? `Baixa automática: "${matchedExpense.description}" (Pago)`
      : blockId !== 'outras' && blockObj
      ? `Cartões e Contas → ${blockObj.shortName}`
      : boletoSubType === 'fixa'
      ? 'Boletos e Fixas → Despesas Fixas'
      : boletoSubType === 'variavel'
      ? 'Boletos e Fixas → Despesas Variáveis'
      : 'Boletos e Fixas → Gastos Mensais';

  let savedToCloud = false;
  if (rawLedgers.length > 0) {
    const updatedLedgers = rawLedgers.map((ledgerObj) => {
      if (ledgerObj.monthKey !== activeMonthKey) return ledgerObj;

      const incomes = Array.isArray(ledgerObj.incomes) ? [...ledgerObj.incomes] : [];
      let expenses = Array.isArray(ledgerObj.expenses) ? [...ledgerObj.expenses] : [];

      if (transactionType === 'income') {
        incomes.push({
          id: `inc-wa-${Date.now()}`,
          person,
          description,
          amount,
          date,
        });
      } else if (action === 'mark_existing_paid' && matchedExpense) {
        expenses = expenses.map((e) =>
          e.id === matchedExpense.id ? { ...e, status: 'Pago' } : e
        );
      } else {
        expenses.push({
          id: `exp-wa-${Date.now()}`,
          description,
          dueDate: date,
          currentInstallment,
          totalInstallments,
          amount,
          status,
          blockId,
          category,
          isRecurringFixed: boletoSubType === 'fixa',
          boletoSubType,
          notes: transcript
            ? `Áudio WhatsApp (${params.senderName}): "${transcript}"`
            : `Lançado via WhatsApp (${params.senderName})`,
        });
      }

      return {
        ...ledgerObj,
        incomes: incomes.slice(0, 100),
        expenses: expenses.slice(0, 300),
      };
    });

    await setDoc(doc(db, 'households', HOUSEHOLD_DOC_ID), {
      householdId: HOUSEHOLD_DOC_ID,
      activeMonthKey,
      lastAction: `WhatsApp (${params.senderName}): ${description} (${formatBRL(amount)})`.slice(
        0,
        200
      ),
      ledgers: updatedLedgers.slice(0, 60),
      updatedAt: serverTimestamp(),
    });
    savedToCloud = true;
  }

  return {
    transactionType,
    description,
    amount,
    date,
    status,
    currentInstallment,
    totalInstallments,
    transcript,
    destinationLabel,
    savedToCloud,
  };
}

function getBaseJid(jid) {
  return String(jid || '')
    .split(':')[0]
    .split('@')[0]
    .replace(/\D/g, '');
}

function isSelfChatOrDomusCommand(msg, sockUser, textContent, hasMedia) {
  const remoteJid = String(msg?.key?.remoteJid || '');
  if (
    !remoteJid ||
    remoteJid === 'status@broadcast' ||
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@newsletter')
  ) {
    return false;
  }

  // If message explicitly starts with "domus" in any private chat, allow it
  if (/^domus\b/i.test(String(textContent || '').trim())) {
    return true;
  }

  // Otherwise, only process messages in the user's "Você mesmo" (Self-Chat)
  if (!msg?.key?.fromMe) return false;

  const myPhoneBase = getBaseJid(sockUser?.id);
  const myLidBase = getBaseJid(sockUser?.lid);
  const remoteBase = getBaseJid(remoteJid);

  const isMyPhone =
    (myPhoneBase && remoteBase === myPhoneBase) ||
    remoteBase === '554396040935' ||
    remoteBase === '5543996040935';
  const isMyLid = myLidBase && remoteBase === myLidBase;

  if (isMyPhone || isMyLid) {
    return Boolean(textContent || hasMedia);
  }
  return false;
}

async function startWhatsAppSocket(clearExistingSession = false) {
  if (isStarting) return;
  isStarting = true;

  try {
    if (currentSock) {
      try {
        currentSock.end(undefined);
      } catch {
        // Ignore
      }
      currentSock = null;
    }

    if (clearExistingSession && fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }

    await updateBridgeStateInFirestore('connecting', '');

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['Domus Financas', 'Chrome', '2.9.8'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    currentSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: { dark: '#0F172A', light: '#FFFFFF' },
          });
          await updateBridgeStateInFirestore('qr_ready', qrDataUrl);
          console.log('[WA-Bridge] QR Code ready and synced to Firestore 2099-10');
        } catch (err) {
          console.error('[WA-Bridge] QR generation error:', err);
        }
      }

      if (connection === 'open') {
        const myPhone = getBaseJid(sock.user?.id) || '5543996040935';
        await updateBridgeStateInFirestore('connected', myPhone, {
          id: `log-${Date.now()}`,
          description: `${new Date().toISOString().slice(11, 19)} | WhatsApp Conectado (+${myPhone})`,
          dueDate: '2099-10-30',
          currentInstallment: null,
          totalInstallments: null,
          amount: 0,
          status: 'Pago',
          blockId: 'outras',
          category: 'Outros & Jurídico',
          isRecurringFixed: false,
          notes: 'Pronto para receber textos, comprovantes e áudios na conversa "Você mesmo"',
        });
        console.log('[WA-Bridge] Connected to WhatsApp:', myPhone);

        try {
          const selfJid = sock.user?.id
            ? `${getBaseJid(sock.user.id)}@s.whatsapp.net`
            : '554396040935@s.whatsapp.net';
          const welcomeMsg = await sock.sendMessage(selfJid, {
            text: [
              '✅ *Domus Finanças conectado ao seu WhatsApp!*',
              '',
              'Para lançar qualquer conta, gasto, entrada, conta pendente ou parcelada sozinho na planilha, mande *aqui nesta conversa (com você mesmo)*:',
              '• *Texto:* _"Paguei 150,00 mercado"_, _"Pendente boleto 250 vence dia 20"_, _"Compra crédito Nubank 6x de 120"_',
              '• *Áudio:* grave um áudio falando o gasto ou entrada!',
              '• *Comprovante PIX:* envie a foto ou PDF do comprovante (Santander, Sicredi, Bradesco, Nubank)!',
            ].join('\n'),
          });
          if (welcomeMsg?.key?.id) {
            sentBotMessageIds.add(welcomeMsg.key.id);
          }
        } catch {
          // Ignore welcome send error
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldLogout = statusCode === DisconnectReason.loggedOut;
        console.log('[WA-Bridge] Connection closed. Code:', statusCode);
        if (shouldLogout) {
          if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          }
          setTimeout(() => startWhatsAppSocket(true), 2000);
        } else {
          setTimeout(() => startWhatsAppSocket(false), 3000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        try {
          const msgId = msg?.key?.id;
          if (!msgId || sentBotMessageIds.has(msgId)) continue;

          const m = msg.message;
          if (!m) continue;

          const textContent = (
            m.conversation ||
            m.extendedTextMessage?.text ||
            m.imageMessage?.caption ||
            m.documentMessage?.caption ||
            m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
            ''
          ).trim();

          // Ignore our own bot confirmation messages
          if (
            textContent.startsWith('✅ *Lançamento Confirmado') ||
            textContent.startsWith('✅ *Lançado na Planilha') ||
            textContent.startsWith('✅ *Domus Finanças conectado') ||
            textContent.startsWith('❌ *Deu errado ao lançar') ||
            textContent.startsWith('⚠️ Recebi sua mensagem')
          ) {
            continue;
          }

          const hasImage = Boolean(m.imageMessage);
          const hasDoc = Boolean(
            m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage
          );
          const hasAudio = Boolean(m.audioMessage);
          const hasMedia = hasImage || hasDoc || hasAudio;

          if (!isSelfChatOrDomusCommand(msg, sock.user, textContent, hasMedia)) {
            continue;
          }

          const targetJid = msg.key.remoteJid;
          await sock
            .sendMessage(targetJid, { react: { text: '⏳', key: msg.key } })
            .catch(() => {});

          let imageBase64;
          let imageMimeType;

          if (hasMedia) {
            try {
              const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                  logger: pino({ level: 'silent' }),
                  reuploadRequest: sock.updateMediaMessage,
                }
              );
              if (buffer && buffer.length <= 10 * 1024 * 1024) {
                imageBase64 = Buffer.from(buffer).toString('base64');
                if (hasImage) {
                  imageMimeType = (m.imageMessage?.mimetype || 'image/jpeg').split(';')[0].trim();
                } else if (hasAudio) {
                  const rawAudioMime = (m.audioMessage?.mimetype || 'audio/ogg').split(';')[0].trim();
                  imageMimeType = rawAudioMime === 'audio/opus' ? 'audio/ogg' : rawAudioMime;
                } else {
                  imageMimeType = (
                    m.documentMessage?.mimetype ||
                    m.documentWithCaptionMessage?.message?.documentMessage?.mimetype ||
                    'application/pdf'
                  )
                    .split(';')[0]
                    .trim();
                }
              }
            } catch (mediaErr) {
              console.error('[WA-Bridge] Media download error:', mediaErr);
            }
          }

          if (!textContent && !imageBase64) continue;

          const senderName = msg.pushName || 'Rodolfo';

          try {
            const parsed = await parseAndSaveToSpreadsheet({
              text: textContent || undefined,
              imageBase64,
              imageMimeType,
              senderName,
            });

            await sock
              .sendMessage(targetJid, {
                react: { text: '✅', key: msg.key },
              })
              .catch(() => {});

            const replyLines = [
              '✅ *Lançamento Confirmado no Domus Finanças!*',
              `• *Tipo:* ${parsed.transactionType === 'income' ? 'Entrada / Receita' : 'Saída / Pagamento'}`,
              `• *Descrição:* ${parsed.description}`,
              `• *Valor:* ${formatBRL(parsed.amount)}`,
              `• *Local:* ${parsed.destinationLabel}`,
              `• *Situação:* ${parsed.status}`,
            ];
            if (parsed.currentInstallment && parsed.totalInstallments) {
              replyLines.push(`• *Parcela:* ${parsed.currentInstallment}/${parsed.totalInstallments}`);
            }
            if (parsed.transcript) {
              replyLines.push(`• *Áudio ouvido:* "${parsed.transcript}"`);
            }
            replyLines.push('☁️ *Já gravado automaticamente na nuvem da família!*');

            const sentReply = await sock.sendMessage(targetJid, { text: replyLines.join('\n') });
            if (sentReply?.key?.id) {
              sentBotMessageIds.add(sentReply.key.id);
            }

            await updateBridgeStateInFirestore('connected', getBaseJid(sock.user?.id) || '5543996040935', {
              id: `log-${Date.now()}`,
              description: `${new Date().toISOString().slice(11, 19)} | Lançado: ${parsed.description} (${formatBRL(parsed.amount)})`,
              dueDate: '2099-10-30',
              currentInstallment: parsed.currentInstallment,
              totalInstallments: parsed.totalInstallments,
              amount: parsed.amount,
              status: parsed.status,
              blockId: 'outras',
              category: 'Outros & Jurídico',
              isRecurringFixed: false,
              notes: parsed.destinationLabel,
            });
          } catch {
            await sock
              .sendMessage(targetJid, {
                react: { text: '❌', key: msg.key },
              })
              .catch(() => {});

            const errReply = [
              '❌ *Deu errado ao lançar no Domus Finanças.*',
              '• *Motivo:* Não consegui identificar o valor no comprovante, áudio ou mensagem.',
              '💡 *Como resolver:* Envie um comprovante PIX nítido (PNG, JPG ou PDF), fale o valor claramente no áudio ou escreva o valor junto (ex: *"Paguei 150,00 mercado"*).',
            ].join('\n');

            const sentErr = await sock.sendMessage(targetJid, { text: errReply });
            if (sentErr?.key?.id) {
              sentBotMessageIds.add(sentErr.key.id);
            }
          }
        } catch (err) {
          console.error('[WA-Bridge] Message process error:', err?.message || err);
        }
      }
    });
  } finally {
    isStarting = false;
  }
}

let lastRelayedDiagId = '';

// Poll Firestore 2099-10 & 2099-11 every 4 seconds
setInterval(async () => {
  try {
    const snap = await getDoc(
      doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', QR_BRIDGE_DOC_KEY)
    );
    if (snap.exists()) {
      const incomes = Array.isArray(snap.data()?.incomes) ? snap.data().incomes : [];
      const cmd = incomes.find((i) => i?.id === 'qr-cmd');
      if (
        cmd &&
        cmd.description === 'reset_qr' &&
        Number(cmd.amount) > lastHandledCmdTimestamp
      ) {
        lastHandledCmdTimestamp = Number(cmd.amount);
        console.log('[WA-Bridge] User requested fresh QR Code via Firestore');
        await startWhatsAppSocket(true);
      }
    }

    if (currentSock && currentSock.user) {
      const diagSnap = await getDoc(
        doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', '2099-11')
      );
      if (diagSnap.exists()) {
        const d = diagSnap.data();
        const expenses = Array.isArray(d?.expenses) ? d.expenses : [];
        const latest = expenses[0];
        if (latest && latest.id && latest.id !== lastRelayedDiagId) {
          const wasInitialized = Boolean(lastRelayedDiagId);
          lastRelayedDiagId = latest.id;
          if (
            wasInitialized &&
            latest.boletoSubType === 'mensal' &&
            typeof latest.notes === 'string' &&
            latest.notes.includes('Lançado:')
          ) {
            const selfJid = `${getBaseJid(currentSock.user.id) || '554396040935'}@s.whatsapp.net`;
            const sentRelay = await currentSock.sendMessage(selfJid, {
              text: `✅ *Domus Finanças:* ${latest.notes}`,
            });
            if (sentRelay?.key?.id) {
              sentBotMessageIds.add(sentRelay.key.id);
            }
          }
        }
      }
    }
  } catch {
    // Ignore poll error
  }
}, 4000);

startWhatsAppSocket(false);
