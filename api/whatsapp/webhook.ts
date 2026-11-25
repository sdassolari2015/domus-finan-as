import crypto from 'crypto';
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
const DIAGNOSTIC_DOC_KEY = '2099-11';
const APP_LOGO_PUBLIC_URL = 'https://domus-finan-as.vercel.app/domus-logo.png';

const ALLOWED_MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

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
] as const;

interface BlockItem {
  id: string;
  shortName: string;
  fullTitle: string;
  group: 'cartao_conta' | 'boletos_pix';
}

interface ExistingExpenseItem {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'Pago' | 'Pendente';
  blockId: string;
  category: string;
  currentInstallment?: number | null;
  totalInstallments?: number | null;
  isRecurringFixed?: boolean;
  boletoSubType?: 'fixa' | 'mensal' | 'variavel';
  notes?: string;
}

const DEFAULT_BLOCKS: BlockItem[] = [
  { id: 'bradesco', shortName: 'Bradesco', fullTitle: 'Cartão Bradesco - Débito em Conta', group: 'cartao_conta' },
  { id: 'santander', shortName: 'Santander', fullTitle: 'Cartão Santander - Débito em Conta', group: 'cartao_conta' },
  { id: 'caixa', shortName: 'Caixa', fullTitle: 'Conta Caixa - Débito em Conta', group: 'cartao_conta' },
  { id: 'quero_quero', shortName: 'Quero Quero', fullTitle: 'Cartão Quero Quero - Direto na Loja', group: 'cartao_conta' },
  { id: 'nubank', shortName: 'NuBank', fullTitle: 'Cartão NuBank - Débito em Conta', group: 'cartao_conta' },
  { id: 'sicredi', shortName: 'Sicredi', fullTitle: 'Cartão Sicredi Viviane - Débito em Conta', group: 'cartao_conta' },
  { id: 'outras', shortName: 'Boletos e Fixas', fullTitle: 'Outras Despesas - Boletos e Fixas', group: 'boletos_pix' },
];

const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
];

function getServerFirestore() {
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({ projectId: FIREBASE_PROJECT_ID });
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}

function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAllowedMetaMediaUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'graph.facebook.com' ||
      host.endsWith('.facebook.com') ||
      host.endsWith('.fbsbx.com') ||
      host.endsWith('.fbcdn.net') ||
      host.endsWith('.whatsapp.net')
    );
  } catch {
    return false;
  }
}

function detectMimeTypeFromMagicBytes(buf: Buffer, fallbackMime: string): string {
  if (buf.length >= 4) {
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    // PDF: 25 50 44 46 (%PDF)
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return 'application/pdf';
    }
    // RIFF....WEBP
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) {
      return 'image/webp';
    }
  }
  const clean = (fallbackMime || 'image/png').toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_MEDIA_MIME_TYPES.has(clean)) return clean;
  return 'image/png';
}

function getCandidateRecipientPhones(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, '');
  const list: string[] = [];
  if (digits.startsWith('55') && digits.length === 12) {
    list.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
    list.push(digits);
  } else if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    list.push(digits);
    list.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  } else {
    list.push(digits);
  }
  return Array.from(new Set(list));
}

function decryptTokenFromCloud(payload: string): string | null {
  try {
    const secret =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
      '';
    if (!secret || !payload) return null;
    const key = crypto.createHash('sha256').update(secret).digest();
    const parts = payload.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

async function getActiveWhatsAppToken(): Promise<string> {
  try {
    const db = getServerFirestore();
    const snap = await getDoc(
      doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', DIAGNOSTIC_DOC_KEY)
    );
    if (snap.exists() && Array.isArray(snap.data()?.incomes)) {
      const entry = snap
        .data()
        .incomes.find((i: { id?: string }) => i?.id === 'wa-token-enc');
      if (entry && typeof entry.date === 'string') {
        const dec = decryptTokenFromCloud(entry.date);
        if (dec && dec.length > 20) return dec;
      }
    }
  } catch {
    // Fallback to env var
  }
  return process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '';
}

async function recordWebhookDiagnostic(
  summaryText: string,
  statusText: string,
  userMessageNotification?: string
): Promise<void> {
  try {
    const db = getServerFirestore();
    const diagRef = doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', DIAGNOSTIC_DOC_KEY);
    const snap = await getDoc(diagRef);
    const prevExpenses =
      snap.exists() && Array.isArray(snap.data()?.expenses) ? snap.data().expenses : [];
    const prevIncomes =
      snap.exists() && Array.isArray(snap.data()?.incomes) ? snap.data().incomes : [];

    const newEntry = {
      id: `diag-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      description: `${new Date().toISOString().slice(11, 19)} | ${summaryText}`.slice(0, 120),
      dueDate: '2099-11-30',
      currentInstallment: null,
      totalInstallments: null,
      amount: 0,
      status: 'Pago',
      blockId: 'outras',
      category: 'Outros & Jurídico',
      isRecurringFixed: false,
      notes: statusText.slice(0, 190),
      ...(userMessageNotification ? { boletoSubType: 'mensal' } : {}),
    };

    await setDoc(diagRef, {
      householdId: HOUSEHOLD_DOC_ID,
      monthKey: DIAGNOSTIC_DOC_KEY,
      label: userMessageNotification
        ? userMessageNotification.slice(0, 500)
        : 'Diagnóstico Webhook WhatsApp',
      year: 2099,
      month: 11,
      incomes: prevIncomes.slice(0, 10),
      expenses: [newEntry, ...prevExpenses].slice(0, 20),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore diagnostic logging errors
  }
}

// Marks the incoming WhatsApp message as read (2 blue checkmarks) and puts an emoji reaction (✅ / ❌ / ⏳)
async function sendWhatsAppReadAndReaction(params: {
  toPhone: string;
  messageId: string;
  emoji: string;
}): Promise<void> {
  const token = await getActiveWhatsAppToken();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '1428542540347469';
  if (!token || !phoneNumberId || !params.messageId) return;

  // 1. Mark message as read (blue ticks)
  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: params.messageId,
    }),
  }).catch(() => {});

  // 2. React directly on the user's message with emoji (✅ or ❌ or ⏳)
  const candidates = getCandidateRecipientPhones(params.toPhone);
  for (const candidate of candidates) {
    if (!/^[0-9]{8,20}$/.test(candidate)) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: candidate,
          type: 'reaction',
          reaction: {
            message_id: params.messageId,
            emoji: params.emoji,
          },
        }),
      });
      if (res.ok) break;
    } catch {
      // Continue
    }
  }
}

async function sendWhatsAppTextReply(
  toPhone: string,
  bodyText: string,
  replyToMessageId?: string
): Promise<{ ok: boolean; details: string }> {
  const token = await getActiveWhatsAppToken();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '1428542540347469';
  if (!token || !phoneNumberId) {
    return { ok: false, details: 'Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID' };
  }
  if (!/^[0-9]{6,20}$/.test(phoneNumberId)) {
    return { ok: false, details: 'Invalid WHATSAPP_PHONE_NUMBER_ID format' };
  }

  const candidates = getCandidateRecipientPhones(toPhone);
  const logs: string[] = [];

  for (const candidate of candidates) {
    if (!/^[0-9]{8,20}$/.test(candidate)) continue;
    try {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: candidate,
        type: 'text',
        text: { body: bodyText.slice(0, 1000) },
      };
      if (replyToMessageId) {
        payload.context = { message_id: replyToMessageId };
      }

      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const respText = await res.text();
      logs.push(`${candidate}:${res.status}:${respText.slice(0, 80)}`);
      if (res.ok) {
        return { ok: true, details: logs.join(' || ') };
      }
    } catch (err) {
      logs.push(`${candidate}:ERR:${err instanceof Error ? err.message : 'fetch'}`);
    }
  }

  return { ok: false, details: logs.join(' || ') };
}

// Automatically uploads the Domus Finanças app logo and sets the WhatsApp Business Contact profile photo & description
async function ensureWhatsAppContactLogoAndProfile(): Promise<void> {
  try {
    const token = await getActiveWhatsAppToken();
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '1428542540347469';
    if (!token || !phoneNumberId) return;

    let profilePictureHandle = '';
    try {
      const logoRes = await fetch(APP_LOGO_PUBLIC_URL);
      if (logoRes.ok) {
        const logoBuf = Buffer.from(await logoRes.arrayBuffer());
        let appId = 'app';
        try {
          const appRes = await fetch('https://graph.facebook.com/v21.0/app', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (appRes.ok) {
            const appJson = (await appRes.json()) as { id?: string };
            if (appJson.id && /^[0-9]+$/.test(appJson.id)) {
              appId = appJson.id;
            }
          }
        } catch {
          // Use 'app' alias
        }

        const sessionRes = await fetch(
          `https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${logoBuf.length}&file_type=image/png&file_name=domus-logo.png`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (sessionRes.ok) {
          const sessionJson = (await sessionRes.json()) as { id?: string };
          if (sessionJson.id) {
            const uploadRes = await fetch(
              `https://graph.facebook.com/v21.0/${sessionJson.id}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `OAuth ${token}`,
                  file_offset: '0',
                  'Content-Type': 'image/png',
                },
                body: new Uint8Array(logoBuf),
              }
            );
            if (uploadRes.ok) {
              const uploadJson = (await uploadRes.json()) as { h?: string };
              if (uploadJson.h) {
                profilePictureHandle = uploadJson.h;
              }
            }
          }
        }
      }
    } catch {
      // Proceed with profile text metadata if image upload handle is not available
    }

    const profilePayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      about: 'Domus Finanças - Controle Financeiro Familiar',
      address: 'Paraná, Brasil',
      description:
        'Assistente automático do Domus Finanças. Envie comprovantes PIX (PNG, JPG ou PDF) ou mensagens para lançar direto na planilha da família.',
      vertical: 'PROF_SERVICES',
      websites: ['https://domus-finan-as.vercel.app'],
    };
    if (profilePictureHandle) {
      profilePayload.profile_picture_handle = profilePictureHandle;
    }

    await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profilePayload),
      }
    ).catch(() => {});
  } catch {
    // Ignore profile update errors
  }
}

async function downloadWhatsAppMediaAsBase64(
  mediaId: string
): Promise<{ base64: string; mimeType: string } | { error: string }> {
  const token = await getActiveWhatsAppToken();
  if (!token) return { error: 'Token ausente ao baixar mídia' };
  const cleanId = mediaId.trim();
  if (!/^[a-zA-Z0-9_.:-]{3,256}$/.test(cleanId)) {
    return { error: `Media ID inválido: ${cleanId.slice(0, 30)}` };
  }

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'curl/8.5.0',
    },
  });
  if (!metaRes.ok) {
    const errTxt = await metaRes.text().catch(() => '');
    return { error: `Meta media lookup HTTP ${metaRes.status}: ${errTxt.slice(0, 80)}` };
  }
  const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!metaJson.url || !isAllowedMetaMediaUrl(metaJson.url)) {
    return { error: 'URL de mídia inválida retornada pela Meta' };
  }

  const fileRes = await fetch(metaJson.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'curl/8.5.0',
      Accept: '*/*',
    },
  });
  if (!fileRes.ok) {
    return { error: `Download binário da mídia falhou HTTP ${fileRes.status}` };
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > 10 * 1024 * 1024) {
    return { error: `Tamanho de arquivo inválido (${arrayBuffer.byteLength} bytes)` };
  }

  const buffer = Buffer.from(arrayBuffer);
  const detectedMime = detectMimeTypeFromMagicBytes(
    buffer,
    metaJson.mime_type || 'image/png'
  );

  return {
    base64: buffer.toString('base64'),
    mimeType: detectedMime,
  };
}

function formatBRLServer(val: number): string {
  return Number(val || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function normalizeText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseFlexibleAmount(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.round(val * 100) / 100;
  }
  if (typeof val === 'string' && val.trim()) {
    const extracted = extractAmountFromText(val);
    if (extracted > 0) return extracted;
    const direct = Number(val.replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (Number.isFinite(direct) && direct > 0) {
      return Math.round(direct * 100) / 100;
    }
  }
  return 0;
}

function extractAmountFromText(rawText: string): number {
  const cleaned = rawText
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');

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

function parsePortugueseFinancialTextFallback(params: {
  text: string;
  blocks: BlockItem[];
  existingExpenses: ExistingExpenseItem[];
  activeMonthKey: string;
  todayIso: string;
  defaultPerson: string;
}) {
  const norm = normalizeText(params.text);
  const extractedAmount = extractAmountFromText(params.text);

  const isIncome =
    /\b(recebi|recebido|entrada|salario|pro-labore|pro labore|ganhei|depilacao|azilo|freela|renda|deposito recebido|pix recebido)\b/.test(
      norm
    ) ||
    (/\b(extra)\b/.test(norm) && !/\b(paguei|gastei|comprei|mercado)\b/.test(norm));

  const transactionType: 'income' | 'expense' = isIncome ? 'income' : 'expense';

  let person: 'Rodolfo' | 'Viviane' | 'Família' =
    params.defaultPerson === 'Viviane' ? 'Viviane' : 'Rodolfo';
  if (/\b(viviane|vivi|azilo|depilacao|sicredi)\b/.test(norm)) {
    person = 'Viviane';
  } else if (/\b(rodolfo|pm|marcenaria)\b/.test(norm)) {
    person = 'Rodolfo';
  }

  let matchedExpense: ExistingExpenseItem | null = null;
  if (transactionType === 'expense') {
    const pendingList = params.existingExpenses.filter((e) => e.status === 'Pendente');
    for (const exp of pendingList) {
      const expNorm = normalizeText(exp.description);
      const words = expNorm.split(/\s+/).filter((w) => w.length >= 3);
      const nameMatches =
        (expNorm.length >= 3 && norm.includes(expNorm)) ||
        (words.length > 0 && words.every((w) => norm.includes(w)));
      const amountMatches =
        extractedAmount > 0 &&
        exp.amount > 0 &&
        Math.abs(exp.amount - extractedAmount) <= 1.5;

      if (nameMatches || (amountMatches && words.some((w) => norm.includes(w)))) {
        matchedExpense = exp;
        break;
      }
    }
  }

  const action: 'create' | 'mark_existing_paid' = matchedExpense
    ? 'mark_existing_paid'
    : 'create';

  let blockId = matchedExpense ? matchedExpense.blockId : 'outras';
  if (!matchedExpense) {
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

  let boletoSubType: 'fixa' | 'mensal' | 'variavel' = 'mensal';
  let category: string = matchedExpense ? matchedExpense.category : 'Outros & Jurídico';

  if (/\b(luz|energia|fit energia|agua|samae|sanepar|copel|celesc)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Utilidades (Luz & Água)';
  } else if (/\b(internet|telecon|help|tim|vivo|claro|celular|telefone|wi-fi)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Internet & Telefonia';
  } else if (/\b(escola|reforco|lorenzo|funcional|creche|faculdade|curso)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Educação & Filhos';
  } else if (/\b(consorcio|virtus|start|patrimonio)\b/.test(norm)) {
    boletoSubType = 'variavel';
    category = 'Consórcios & Patrimônio';
  } else if (/\b(candeias|clube|lazer|viagem|hotel|cinema|passeio)\b/.test(norm)) {
    boletoSubType = norm.includes('candeias') ? 'variavel' : 'mensal';
    category = 'Lazer & Clube';
  } else if (/\b(gasolina|combustivel|posto|etanol|diesel|oficina|pneu|carro|moto|uber|pedagio)\b/.test(norm)) {
    boletoSubType = 'mensal';
    category = 'Transporte & Veículos';
  } else if (/\b(farmacia|remedio|medico|consulta|exame|dentista|saude|aapomil|hospital)\b/.test(norm)) {
    boletoSubType = norm.includes('aapomil') ? 'fixa' : 'mensal';
    category = 'Associações & Saúde';
  } else if (/\b(tv|p2p|netflix|spotify|assinatura|amazon|youtube)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Assinaturas & Serviços';
  } else if (/\b(aluguel|condominio|iptu|financiamento|casa|reforma)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Moradia & Financiamento';
  } else if (/\b(cartao|fatura|banco|juros|tarifa)\b/.test(norm) || blockId !== 'outras') {
    category = 'Financeiro & Cartões';
  } else if (/\b(parcela|parcelado|boleto)\b/.test(norm)) {
    boletoSubType = 'variavel';
  }

  const finalAmount =
    extractedAmount > 0
      ? extractedAmount
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;

  let cleanDesc = params.text
    .replace(/^(paguei|gastei|comprei|recebi|fiz\s+pix|pix\s+de|pix|lancamento|lançar)\s+/i, '')
    .replace(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+\.\d{2})/gi, '')
    .replace(/\b(no|na|do|da|de|em|via|pix|hoje|reais)\b/gi, ' ')
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
    action,
    matchedExistingExpenseId: matchedExpense ? matchedExpense.id : '',
    description: cleanDesc.slice(0, 75),
    amount: finalAmount,
    date: `${params.activeMonthKey}-${params.todayIso.slice(8, 10)}`,
    status: /\b(pendente|vence|agendado|a pagar)\b/.test(norm) ? 'Pendente' : 'Pago',
    blockId,
    boletoSubType,
    category,
    person,
  };
}

function extractJsonObject(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

async function generateWithFallback(
  ai: GoogleGenAI,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
  systemInstruction: string
): Promise<string> {
  let lastErr: unknown;

  // Pass 1: Structured JSON Schema on v1beta across all candidate models
  for (const modelName of MODEL_FALLBACK_CHAIN) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transactionType: { type: Type.STRING },
              action: { type: Type.STRING },
              matchedExistingExpenseId: { type: Type.STRING },
              description: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              date: { type: Type.STRING },
              status: { type: Type.STRING },
              blockId: { type: Type.STRING },
              boletoSubType: { type: Type.STRING },
              category: { type: Type.STRING },
              person: { type: Type.STRING },
            },
            required: [
              'transactionType',
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
      const text = (response.text ?? '').trim();
      const jsonBlock = extractJsonObject(text);
      if (jsonBlock) return jsonBlock;
    } catch (err) {
      lastErr = err;
    }
  }

  // Pass 2: Schema-free JSON extraction fallback in case any model rejected responseSchema
  for (const modelName of MODEL_FALLBACK_CHAIN) {
    try {
      const fallbackParts = [
        ...parts,
        {
          text: `${systemInstruction}\nResponda APENAS um objeto JSON válido com as chaves: {"transactionType":"expense","action":"create","matchedExistingExpenseId":"","description":"Nome do favorecido ou conta","amount":0.00,"date":"YYYY-MM-DD","status":"Pago","blockId":"outras","boletoSubType":"mensal","category":"Outros & Jurídico","person":"Rodolfo"}`,
        },
      ];
      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts: fallbackParts },
      });
      const text = (response.text ?? '').trim();
      const jsonBlock = extractJsonObject(text);
      if (jsonBlock) return jsonBlock;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Gemini unavailable');
}

async function parseAndSaveDirectToFirestore(params: {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  senderName: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const db = getServerFirestore();

  let activeMonthKey = '2026-11';
  let blocks: BlockItem[] = [...DEFAULT_BLOCKS];
  let existingExpenses: ExistingExpenseItem[] = [];
  let rawLedgers: Array<Record<string, unknown>> = [];

  try {
    const workspaceSnap = await getDoc(doc(db, 'households', HOUSEHOLD_DOC_ID));
    if (workspaceSnap.exists()) {
      const wData = workspaceSnap.data();
      if (typeof wData.activeMonthKey === 'string' && /^\d{4}-\d{2}$/.test(wData.activeMonthKey)) {
        activeMonthKey = wData.activeMonthKey;
      }
      if (Array.isArray(wData.ledgers) && wData.ledgers.length > 0) {
        rawLedgers = wData.ledgers as Array<Record<string, unknown>>;
        const activeLedger =
          rawLedgers.find((l) => l.monthKey === activeMonthKey) ||
          rawLedgers[rawLedgers.length - 1];
        if (activeLedger) {
          if (typeof activeLedger.monthKey === 'string') {
            activeMonthKey = activeLedger.monthKey;
          }
          if (Array.isArray(activeLedger.customBlocks) && activeLedger.customBlocks.length > 0) {
            blocks = activeLedger.customBlocks as BlockItem[];
          }
          if (Array.isArray(activeLedger.expenses)) {
            existingExpenses = activeLedger.expenses as ExistingExpenseItem[];
          }
        }
      }
    }
  } catch {
    // Fallback to defaults if Firestore read fails
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultPerson = params.senderName.toLowerCase().includes('viviane')
    ? 'Viviane'
    : 'Rodolfo';

  let raw: Record<string, unknown> | null = null;
  let geminiErrMsg = '';

  if (apiKey) {
    try {
      // CRITICAL: Use apiVersion: 'v1beta' so multimodal PNG/JPG/PDF + systemInstruction + responseSchema work on @google/genai v3.6.1
      const ai = new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
        httpOptions: {
          apiVersion: 'v1beta',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
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
          `Blocos disponíveis: ${JSON.stringify(blocks)}`,
          `Contas PENDENTES existentes no mês: ${JSON.stringify(
            existingExpenses.filter((e) => e.status === 'Pendente')
          )}`,
          params.text
            ? `Mensagem/Legenda: "${params.text}"`
            : 'Extraia o valor (R$), favorecido/descrição e data deste comprovante PIX ou boleto.',
        ].join('\n'),
      });

      const systemInstruction = `Você é o classificador financeiro do Domus Finanças (Rodolfo e Viviane). Analise a imagem PNG/JPG/PDF do comprovante PIX ou mensagem e extraia o lançamento exato.
- transactionType: "income" (entrada/recebido) ou "expense" (saída/pago/transferido).
- action: "mark_existing_paid" se corresponder a uma conta pendente existente (informe o id em matchedExistingExpenseId), ou "create" se for novo.
- amount: valor numérico em reais (ex: 150.50). Procure por "Valor", "R$", "Total", "Valor pago" ou "Valor da transferência" na imagem.
- description: nome do recebedor/favorecido ou descrição curta da despesa.
- blockId: id do cartão/conta se mencionado (ex: nubank, bradesco, santander, caixa, sicredi, quero_quero), ou "outras" para PIX/boletos/gastos gerais.
- boletoSubType: "fixa" (luz, água, internet, fixas mensais), "variavel" (parcelado, consórcio, boleto parcelado) ou "mensal" (mercado, farmácia, gasolina, PIX e gastos do mês).
- Categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.`;

      const jsonText = await generateWithFallback(ai, parts, systemInstruction);
      raw = JSON.parse(jsonText);
    } catch (err) {
      geminiErrMsg = err instanceof Error ? err.message : String(err);
      raw = null;
    }
  }

  if (!raw && params.text) {
    raw = parsePortugueseFinancialTextFallback({
      text: params.text,
      blocks,
      existingExpenses,
      activeMonthKey,
      todayIso,
      defaultPerson,
    });
  }

  if (!raw) {
    throw new Error(
      geminiErrMsg
        ? `Falha ao ler comprovante (${geminiErrMsg.slice(0, 90)})`
        : 'Não foi possível identificar os dados do comprovante'
    );
  }

  const transactionType = raw.transactionType === 'income' ? 'income' : 'expense';
  const matchedExpense =
    transactionType === 'expense' && raw.matchedExistingExpenseId
      ? existingExpenses.find(
          (e) => e.id === raw.matchedExistingExpenseId && e.status === 'Pendente'
        ) || null
      : null;
  const action =
    matchedExpense && raw.action === 'mark_existing_paid'
      ? 'mark_existing_paid'
      : 'create';
  const validBlockIds = new Set(blocks.map((b) => b.id));
  const blockId = matchedExpense
    ? matchedExpense.blockId
    : validBlockIds.has(String(raw.blockId))
    ? String(raw.blockId)
    : 'outras';
  const boletoSubType =
    raw.boletoSubType === 'fixa' || raw.boletoSubType === 'variavel'
      ? raw.boletoSubType
      : 'mensal';
  const category = (ALLOWED_CATEGORIES as readonly string[]).includes(String(raw.category))
    ? String(raw.category)
    : 'Outros & Jurídico';
  const person =
    raw.person === 'Rodolfo' || raw.person === 'Viviane' ? raw.person : defaultPerson;
  const parsedAmt = parseFlexibleAmount(raw.amount);
  const amount =
    parsedAmt > 0
      ? parsedAmt
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;
  const description = String(
    matchedExpense ? matchedExpense.description : raw.description || 'Comprovante PIX'
  ).slice(0, 75);
  const date =
    typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : `${activeMonthKey}-${todayIso.slice(8, 10)}`;
  const status = raw.status === 'Pendente' ? 'Pendente' : 'Pago';

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

  if (amount <= 0) {
    throw new Error('Valor R$ 0,00 ou não identificado na imagem');
  }

  let savedToCloud = false;
  try {
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
          expenses = expenses.map((e: Record<string, unknown>) =>
            e.id === matchedExpense.id ? { ...e, status: 'Pago' } : e
          );
        } else {
          expenses.push({
            id: `exp-wa-${Date.now()}`,
            description,
            dueDate: date,
            currentInstallment: null,
            totalInstallments: null,
            amount,
            status,
            blockId,
            category,
            isRecurringFixed: boletoSubType === 'fixa',
            boletoSubType,
            notes: `Lançado via WhatsApp (${params.senderName})`,
          });
        }

        return {
          ...ledgerObj,
          incomes: incomes.slice(0, 100),
          expenses: expenses.slice(0, 300),
        };
      });

      const lastActionText = `WhatsApp (${params.senderName}): ${description} (${formatBRLServer(amount)})`.slice(
        0,
        200
      );

      await setDoc(doc(db, 'households', HOUSEHOLD_DOC_ID), {
        householdId: HOUSEHOLD_DOC_ID,
        activeMonthKey,
        lastAction: lastActionText,
        ledgers: updatedLedgers.slice(0, 60),
        updatedAt: serverTimestamp(),
      });
      savedToCloud = true;
    }
  } catch {
    savedToCloud = false;
  }

  return {
    transactionType,
    description,
    amount,
    status,
    destinationLabel,
    savedToCloud,
  };
}

export default async function handler(
  req: {
    method?: string;
    query?: Record<string, string | string[] | undefined>;
    body?: Record<string, unknown>;
  },
  res: {
    status: (code: number) => {
      send: (body: string) => void;
      json: (body: unknown) => void;
    };
    setHeader: (name: string, value: string) => void;
  }
) {
  if (req.method === 'GET') {
    const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || 'domus2026').trim();
    const mode = String(req.query?.['hub.mode'] || '');
    const token = String(req.query?.['hub.verify_token'] || '').trim();
    const challenge = String(req.query?.['hub.challenge'] || '');

    if (
      mode === 'subscribe' &&
      token &&
      (safeCompareStrings(token, verifyToken) || safeCompareStrings(token, 'domus2026'))
    ) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(challenge);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(403).send('Forbidden');
  }

  if (req.method === 'POST') {
    try {
      const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;

          const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
          for (const st of statuses) {
            const stStatus = String(st?.status || '');
            const stRecipient = String(st?.recipient_id || '');
            const stErrors = Array.isArray(st?.errors) ? JSON.stringify(st.errors) : '';
            if (stStatus === 'failed' || stErrors) {
              await recordWebhookDiagnostic(
                `STATUS ${stStatus.toUpperCase()} p/ ${stRecipient}`,
                stErrors || 'Falha de entrega reportada pela Meta'
              );
            }
          }

          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

          if (messages.length > 0) {
            // Ensure the WhatsApp Business Profile has the Domus Finanças Logo and info
            ensureWhatsAppContactLogoAndProfile().catch(() => {});
          }

          for (const msg of messages) {
            const fromPhone = String(msg?.from || '').replace(/\D/g, '');
            const incomingMsgId = String(msg?.id || '');
            if (!fromPhone) continue;

            const contact = contacts.find((c: { wa_id?: string }) => c?.wa_id === msg?.from);
            const senderName = String(contact?.profile?.name || 'Rodolfo').slice(0, 40);
            const msgType = String(msg?.type || '');

            let textContent = '';
            let mediaBase64: string | undefined;
            let mediaMimeType: string | undefined;
            let mediaDownloadError = '';

            if (msgType === 'text') {
              textContent = String(msg?.text?.body || '').trim();
            } else if (msgType === 'image') {
              textContent = String(msg?.image?.caption || '').trim();
              const mediaId = String(msg?.image?.id || '');
              // Immediate visual interaction on the user's PNG/JPG message (blue ticks + hourglass reaction)
              await sendWhatsAppReadAndReaction({
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '⏳',
              });
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if ('base64' in media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              } else {
                mediaDownloadError = media.error;
              }
            } else if (msgType === 'document') {
              textContent = String(msg?.document?.caption || '').trim();
              const mediaId = String(msg?.document?.id || '');
              await sendWhatsAppReadAndReaction({
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '⏳',
              });
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if ('base64' in media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              } else {
                mediaDownloadError = media.error;
              }
            } else {
              await sendWhatsAppReadAndReaction({
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '⚠️',
              });
              const unsupportedMsg =
                '⚠️ *Domus Finanças:* Formato não suportado. Envie uma imagem (PNG/JPG), PDF de comprovante PIX ou mensagem de texto com o valor (ex: *"Paguei 150,00 mercado"*).';
              const replyRes = await sendWhatsAppTextReply(
                fromPhone,
                unsupportedMsg,
                incomingMsgId
              );
              await recordWebhookDiagnostic(
                `De ${fromPhone} (${msgType})`,
                `Reply: ${replyRes.details}`,
                unsupportedMsg
              );
              continue;
            }

            if (!textContent && !mediaBase64) {
              await sendWhatsAppReadAndReaction({
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '❌',
              });
              const dlErrMsg = [
                '❌ *Deu errado ao baixar o comprovante no Domus Finanças.*',
                mediaDownloadError ? `• *Detalhe:* ${mediaDownloadError}` : '',
                '💡 Tente reenviar a imagem PNG/JPG ou escreva o valor na legenda (ex: *"Paguei 150,00 mercado"*).',
              ]
                .filter(Boolean)
                .join('\n');
              const replyRes = await sendWhatsAppTextReply(
                fromPhone,
                dlErrMsg,
                incomingMsgId
              );
              await recordWebhookDiagnostic(
                `ERR MÍDIA ${fromPhone}`,
                `${mediaDownloadError || 'Sem conteúdo'} | Meta:${replyRes.details}`,
                dlErrMsg
              );
              continue;
            }

            try {
              const parsed = await parseAndSaveDirectToFirestore({
                text: textContent || undefined,
                imageBase64: mediaBase64,
                imageMimeType: mediaMimeType,
                senderName,
              });

              // React with ✅ on the user's message and mark read!
              await sendWhatsAppReadAndReaction({
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '✅',
              });

              const replySummary = [
                '✅ *Lançamento Confirmado no Domus Finanças!*',
                `• *Tipo:* ${parsed.transactionType === 'income' ? 'Entrada / Receita' : 'Saída / Pagamento'}`,
                `• *Descrição:* ${parsed.description}`,
                `• *Valor:* ${formatBRLServer(parsed.amount)}`,
                `• *Local:* ${parsed.destinationLabel}`,
                `• *Situação:* ${parsed.status}`,
                parsed.savedToCloud
                  ? '☁️ *Já gravado automaticamente na planilha da família!*'
                  : '',
              ]
                .filter(Boolean)
                .join('\n');

              const replyRes = await sendWhatsAppTextReply(
                fromPhone,
                replySummary,
                incomingMsgId
              );
              await recordWebhookDiagnostic(
                `OK ${fromPhone}: ${parsed.description} (${formatBRLServer(parsed.amount)})`,
                `Cloud:${parsed.savedToCloud} | Mime:${mediaMimeType || 'text'} | Meta:${replyRes.details}`,
                replySummary
              );
            } catch (err) {
              // React with ❌ on the user's message so they immediately see it failed!
              await sendWhatsAppReadAndReaction({
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '❌',
              });

              const errDetail = err instanceof Error ? err.message : 'valor não identificado';
              const errorReply = [
                '❌ *Deu errado ao lançar no Domus Finanças.*',
                `• *Motivo:* ${errDetail}`,
                '💡 *Como resolver:* Envie um comprovante PIX nítido (PNG, JPG ou PDF) ou escreva o valor na legenda (ex: *"Paguei 150,00 mercado"* ou *"Recebi 800 extra"*).',
              ].join('\n');

              const replyRes = await sendWhatsAppTextReply(
                fromPhone,
                errorReply,
                incomingMsgId
              );
              await recordWebhookDiagnostic(
                `ERR ${fromPhone}: "${textContent.slice(0, 35) || mediaMimeType || 'img'}"`,
                `Err:${errDetail} | Meta:${replyRes.details}`,
                errorReply
              );
            }
          }
        }
      }
    } catch {
      // Always return 200 OK to Meta
    }
    return res.status(200).json({ status: 'received' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
