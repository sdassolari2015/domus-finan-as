import crypto from 'crypto';
import zlib from 'zlib';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore/lite';

// Allow up to 60s execution on Vercel Serverless Functions
export const maxDuration = 60;

const FIREBASE_PROJECT_ID = 'nimble-might-65wls';
const FIRESTORE_DATABASE_ID =
  'ai-studio-domuscontrolefin-af87b841-f232-48c0-a854-6751f0583616';
const HOUSEHOLD_DOC_ID = 'domus_family';
const DIAGNOSTIC_DOC_KEY = '2099-11';

const ALLOWED_MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/webm',
  'audio/amr',
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

// Fast non-deprecated multimodal models (supports tall PNG/JPG, PDF, and OGG/MP3 audio natively)
const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
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
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return 'image/png';
    }
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    // PDF
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return 'application/pdf';
    }
    // OGG (WhatsApp voice notes / PTT)
    if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
      return 'audio/ogg';
    }
    // MP3 (ID3 or MPEG frame sync)
    if (
      (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
      (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
    ) {
      return 'audio/mpeg';
    }
    // WEBM
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return 'audio/webm';
    }
    // RIFF -> WEBP or WAV
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46
    ) {
      if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
        return 'image/webp';
      }
      if (buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) {
        return 'audio/wav';
      }
    }
    // MP4 / M4A (ftyp)
    if (
      buf.length >= 8 &&
      buf[4] === 0x66 &&
      buf[5] === 0x74 &&
      buf[6] === 0x79 &&
      buf[7] === 0x70
    ) {
      return 'audio/mp4';
    }
  }
  const clean = (fallbackMime || 'image/png').toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpg') return 'image/jpeg';
  if (clean === 'audio/opus') return 'audio/ogg';
  if (clean === 'audio/mp3') return 'audio/mpeg';
  if (clean === 'audio/m4a') return 'audio/mp4';
  if (ALLOWED_MEDIA_MIME_TYPES.has(clean)) return clean;
  return 'image/png';
}

function extractTextFromPdfBuffer(buf: Buffer): string {
  try {
    const rawLatin = buf.toString('latin1');
    const chunks: string[] = [];
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(rawLatin)) !== null) {
      const streamBytes = Buffer.from(match[1], 'latin1');
      let decoded = '';
      try {
        decoded = zlib.inflateSync(streamBytes).toString('latin1');
      } catch {
        try {
          decoded = zlib.inflateRawSync(streamBytes).toString('latin1');
        } catch {
          decoded = match[1];
        }
      }

      const parenMatches = decoded.match(/\((?:\\.|[^\\()])+\)/g);
      if (parenMatches) {
        for (const p of parenMatches) {
          const inner = p
            .slice(1, -1)
            .replace(/\\([()\\])/g, '$1')
            .replace(/\\n/g, ' ')
            .replace(/\\r/g, ' ')
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
            .trim();
          if (inner.length >= 2) {
            chunks.push(inner);
          }
        }
      }
    }

    const combined = chunks.join(' ').replace(/\s+/g, ' ').trim();
    return combined.slice(0, 2500);
  } catch {
    return '';
  }
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

// IMPORTANT: firestore.rules requires data.label.size() <= 64!
async function recordWebhookDiagnostic(
  summaryText: string,
  statusText: string
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
    };

    await setDoc(diagRef, {
      householdId: HOUSEHOLD_DOC_ID,
      monthKey: DIAGNOSTIC_DOC_KEY,
      label: 'Diagnóstico Webhook WhatsApp',
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

async function sendWhatsAppReadAndReaction(params: {
  token: string;
  toPhone: string;
  messageId: string;
  emoji: string;
}): Promise<{ ok: boolean; status: number }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '1428542540347469';
  if (!params.token || !phoneNumberId || !params.messageId) {
    return { ok: false, status: 0 };
  }

  // 1. Mark message as read (2 blue ticks)
  fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: params.messageId,
    }),
  }).catch(() => {});

  // 2. React directly on user's message trying all Brazilian 13/12-digit candidates
  const candidates = getCandidateRecipientPhones(params.toPhone);
  let lastStatus = 0;
  for (const candidate of candidates) {
    if (!/^[0-9]{8,20}$/.test(candidate)) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.token}`,
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
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, status: res.status };
      }
      if (res.status === 401) break; // Expired token — no point retrying other format
    } catch {
      // Try next candidate
    }
  }
  return { ok: false, status: lastStatus };
}

async function sendWhatsAppTextReply(
  token: string,
  toPhone: string,
  bodyText: string,
  replyToMessageId?: string
): Promise<{ ok: boolean; details: string }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '1428542540347469';
  if (!token || !phoneNumberId) {
    return { ok: false, details: 'Missing WHATSAPP_ACCESS_TOKEN' };
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
      logs.push(`${candidate}:${res.status}:${respText.slice(0, 75)}`);
      if (res.ok) {
        return { ok: true, details: logs.join(' || ') };
      }
      if (res.status === 401) break;
    } catch (err) {
      logs.push(`${candidate}:ERR:${err instanceof Error ? err.message : 'fetch'}`);
    }
  }

  return { ok: false, details: logs.join(' || ') };
}

async function downloadWhatsAppMediaAsBase64(
  token: string,
  mediaId: string
): Promise<{ base64: string; mimeType: string; pdfExtractedText?: string } | { error: string }> {
  if (!token) return { error: 'Token da Meta ausente — atualize o token no app' };
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
    if (metaRes.status === 401) {
      return { error: 'Token da Meta expirado (HTTP 401) — renove o token no app' };
    }
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

  const pdfExtractedText =
    detectedMime === 'application/pdf' ? extractTextFromPdfBuffer(buffer) : undefined;

  return {
    base64: buffer.toString('base64'),
    mimeType: detectedMime,
    pdfExtractedText,
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
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\s*(?:x|vezes|parcelas?)\b/gi, ' ')
    .replace(/\bparcela\s*\d{1,2}\s*(?:de|\/)\s*\d{1,2}\b/gi, ' ')
    .replace(/\bdia\s+\d{1,2}\b/gi, ' ')
    .replace(/\bvenc(?:e|imento)\s*(?:dia\s*)?\d{1,2}\b/gi, ' ');

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

function extractInstallmentsFromText(rawText: string): {
  currentInstallment: number | null;
  totalInstallments: number | null;
  amountIsPerInstallment: boolean;
} {
  const norm = normalizeText(rawText);

  // Pattern 1: "parcela 2 de 10", "2/10", "parcela 3/12"
  const slashMatch = norm.match(/\b(?:parcela\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/);
  if (slashMatch) {
    const curr = parseInt(slashMatch[1], 10);
    const tot = parseInt(slashMatch[2], 10);
    // Avoid mistaking dates like "25/11" for installments unless curr <= tot and tot >= 2 and tot <= 72 and curr <= 72
    const looksLikeDate = /\b(?:dia|em|vence|vencimento|para)\s+\d{1,2}\/\d{1,2}\b/.test(norm);
    if (!looksLikeDate && curr >= 1 && tot >= 2 && curr <= tot && tot <= 72) {
      return {
        currentInstallment: curr,
        totalInstallments: tot,
        amountIsPerInstallment: true,
      };
    }
  }

  // Pattern 2: "em 6x de 150", "6x de 150", "6 parcelas de 150", "parcelado em 5x", "5 vezes"
  const timesMatch = norm.match(
    /\b(?:em\s+|parcelad[oa]\s*(?:em\s*)?)?(\d{1,2})\s*(?:x|vezes|parcelas?)\b/
  );
  if (timesMatch) {
    const tot = parseInt(timesMatch[1], 10);
    if (tot >= 2 && tot <= 72) {
      const hasPerInstallmentDe = /\b\d{1,2}\s*(?:x|vezes|parcelas?)\s+de\s+(?:r\$\s*)?\d/.test(norm);
      return {
        currentInstallment: 1,
        totalInstallments: tot,
        amountIsPerInstallment: hasPerInstallmentDe,
      };
    }
  }

  return { currentInstallment: null, totalInstallments: null, amountIsPerInstallment: true };
}

function extractDueDateFromText(rawText: string, activeMonthKey: string, todayIso: string): string {
  const norm = normalizeText(rawText);
  const [actYear, actMonth] = activeMonthKey.split('-');

  // Full date DD/MM/YYYY or DD/MM
  const dateMatch = norm.match(/\b(?:vence|vencimento|para|dia|em)\s*(?:dia\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dateMatch) {
    const dd = Math.min(31, Math.max(1, parseInt(dateMatch[1], 10)));
    const mm = Math.min(12, Math.max(1, parseInt(dateMatch[2], 10)));
    const yy = dateMatch[3]
      ? dateMatch[3].length === 2
        ? `20${dateMatch[3]}`
        : dateMatch[3]
      : actYear;
    return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  // Day of month: "vence dia 15", "para dia 20", "vencimento 10"
  const dayMatch = norm.match(/\b(?:vence|vencimento|para\s+o?\s*dia|dia)\s+(\d{1,2})\b/);
  if (dayMatch) {
    const dd = Math.min(31, Math.max(1, parseInt(dayMatch[1], 10)));
    return `${actYear}-${actMonth}-${String(dd).padStart(2, '0')}`;
  }

  return `${activeMonthKey}-${todayIso.slice(8, 10)}`;
}

// Strict helper: checks if text/receipt EXPLICITLY mentions a credit card purchase/invoice
function hasExplicitCreditCardSignal(text: string): boolean {
  const norm = normalizeText(text);
  return /\b(compra\s+(?:no\s+)?credito|credito\s+a\s+vista|credito\s+parcelado|cartao\s+de\s+credito|no\s+cartao|cartao\s+(?:sicredi|nubank|bradesco|santander|caixa|quero)|no\s+credito|passei\s+no\s+(?:cartao|credito|nubank|sicredi|bradesco|santander)|fatura\s+(?:do\s+)?(?:cartao|nubank|sicredi|bradesco|santander)|mastercard|visa\b|elo\b|aproximacao\s+credito|quero\s*quero)\b/.test(
    norm
  );
}

// Strict helper: checks if text/receipt indicates PIX payment
function hasPixPaymentSignal(text: string): boolean {
  const norm = normalizeText(text);
  return (
    /\b(pix|chave\s+pix|transferencia\s+pix|comprovante\s+pix|qr\s*code\s+pix|pix\s+enviado|pix\s+recebido)\b/.test(
      norm
    ) || /\be\d{8}\d{12,}\b/i.test(text)
  );
}

// ONLY match an existing pending fixed bill when the payee/description ACTUALLY matches AND the amount matches!
// Never map COPEL / COPELDIS (a separate bill with a different amount) onto Fit Energia!
function findStrictMatchingPendingExpense(
  searchText: string,
  extractedAmount: number,
  existingExpenses: ExistingExpenseItem[]
): ExistingExpenseItem | null {
  const norm = normalizeText(searchText);
  if (!norm) return null;

  const pendingList = existingExpenses.filter((e) => e.status === 'Pendente');
  for (const exp of pendingList) {
    const expNorm = normalizeText(exp.description);
    const words = expNorm.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length === 0) continue;

    const fullNameMatch = expNorm.length >= 4 && norm.includes(expNorm);
    const allWordsMatch = words.every((w) => norm.includes(w));
    if (!fullNameMatch && !allWordsMatch) continue;

    // If both the receipt/message AND the pending bill have amounts, verify they are compatible!
    // If the amount is clearly different (e.g. R$ 85 vs R$ 309.74), treat it as a separate random monthly expense!
    if (extractedAmount > 0 && exp.amount > 0) {
      const tolerance = Math.max(15, exp.amount * 0.2);
      if (Math.abs(exp.amount - extractedAmount) > tolerance) {
        continue;
      }
    }

    return exp;
  }

  return null;
}

function cleanExpenseDescription(rawDesc: string, fallback: string): string {
  let cleaned = String(rawDesc || '')
    .replace(/^(pago|paguei|gastei|comprei|recebi|pendente|conta\s+pendente|conta\s+a\s+pagar|fiz\s+pix|pix\s+de|pix|lancamento|lançar)[,:\s-]+/i, '')
    .replace(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+\.\d{2})/gi, '')
    .replace(/\b(?:em\s+|parcelad[oa]\s*(?:em\s*)?)?\d{1,2}\s*(?:x|vezes|parcelas?)\b/gi, '')
    .replace(/\b(?:parcela\s*)?\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/gi, '')
    .replace(/\b(?:vence|vencimento|para\s+o?\s*dia)\s*(?:dia\s*)?\d{1,2}(?:\/\d{1,2})?\b/gi, '')
    .replace(/\b(reais|hoje|via\s+pix|pendente|a\s+pagar|para\s+pagar)\b/gi, ' ')
    .replace(/^[,.\-–:\s]+|[,.\-–:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2) {
    cleaned = fallback;
  } else {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned.slice(0, 75);
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
  const extractedAmountRaw = extractAmountFromText(params.text);
  const inst = extractInstallmentsFromText(params.text);
  const dueDate = extractDueDateFromText(params.text, params.activeMonthKey, params.todayIso);

  const isIncome =
    /\b(recebi|recebido|entrada|salario|pro-labore|pro labore|ganhei|depilacao|azilo|freela|renda|deposito recebido|pix recebido)\b/.test(
      norm
    ) ||
    (/\b(extra)\b/.test(norm) && !/\b(paguei|gastei|comprei|mercado|pendente|boleto)\b/.test(norm));

  const transactionType: 'income' | 'expense' = isIncome ? 'income' : 'expense';

  let person: 'Rodolfo' | 'Viviane' | 'Família' =
    params.defaultPerson === 'Viviane' ? 'Viviane' : 'Rodolfo';
  if (/\b(viviane|vivi|azilo|depilacao|sicredi)\b/.test(norm)) {
    person = 'Viviane';
  } else if (/\b(rodolfo|pm|marcenaria)\b/.test(norm)) {
    person = 'Rodolfo';
  }

  // Compute monthly installment value if user wrote "600 em 3x" (without "de")
  let finalAmount = extractedAmountRaw;
  if (
    inst.totalInstallments &&
    inst.totalInstallments >= 2 &&
    !inst.amountIsPerInstallment &&
    extractedAmountRaw > 0 &&
    /\b(total|comprei|compra|gastei|parcelei|dividi)\b/.test(norm)
  ) {
    finalAmount = Math.round((extractedAmountRaw / inst.totalInstallments) * 100) / 100;
  }

  const matchedExpense =
    transactionType === 'expense' && !inst.totalInstallments
      ? findStrictMatchingPendingExpense(params.text, finalAmount, params.existingExpenses)
      : null;

  const action: 'create' | 'mark_existing_paid' = matchedExpense
    ? 'mark_existing_paid'
    : 'create';

  const isCreditCard = hasExplicitCreditCardSignal(params.text);
  const isPix = hasPixPaymentSignal(params.text) && !isCreditCard;

  let blockId = matchedExpense ? matchedExpense.blockId : 'outras';
  if (!matchedExpense && isCreditCard) {
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

  const isPending =
    /\b(pendente|a\s+pagar|para\s+pagar|pra\s+pagar|vence|vencimento|falta\s+pagar|agendad[oa]|nao\s+paguei|devo|boleto\s+para)\b/.test(
      norm
    ) ||
    (Boolean(inst.totalInstallments) && !/\b(paguei|pago|quitado)\b/.test(norm));

  let boletoSubType: 'fixa' | 'mensal' | 'variavel' = inst.totalInstallments ? 'variavel' : 'mensal';
  let category: string = matchedExpense ? matchedExpense.category : 'Outros & Jurídico';

  if (/\b(luz|energia|fit energia|agua|samae|sanepar|copel|copeldis|celesc)\b/.test(norm)) {
    boletoSubType = matchedExpense ? 'fixa' : 'mensal';
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
  } else if (/\b(candeias|clube|lazer|viagem|hotel|cinema|passeio|lanche|pizza|restaurante)\b/.test(norm)) {
    boletoSubType = norm.includes('candeias') ? 'variavel' : 'mensal';
    category = 'Lazer & Clube';
  } else if (/\b(gasolina|combustivel|posto|etanol|diesel|oficina|pneu|carro|moto|uber|pedagio)\b/.test(norm)) {
    boletoSubType = inst.totalInstallments ? 'variavel' : 'mensal';
    category = 'Transporte & Veículos';
  } else if (/\b(farmacia|remedio|medico|consulta|exame|dentista|saude|aapomil|hospital)\b/.test(norm)) {
    boletoSubType = norm.includes('aapomil') ? 'fixa' : inst.totalInstallments ? 'variavel' : 'mensal';
    category = 'Associações & Saúde';
  } else if (/\b(tv|p2p|netflix|spotify|assinatura|amazon|youtube)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Assinaturas & Serviços';
  } else if (/\b(aluguel|condominio|iptu|financiamento|casa|reforma)\b/.test(norm)) {
    boletoSubType = 'fixa';
    category = 'Moradia & Financiamento';
  } else if (blockId !== 'outras') {
    category = 'Financeiro & Cartões';
  }

  if (inst.totalInstallments && blockId === 'outras') {
    boletoSubType = 'variavel';
  }

  const amount =
    finalAmount > 0
      ? finalAmount
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;

  const description = matchedExpense
    ? matchedExpense.description
    : cleanExpenseDescription(
        params.text,
        transactionType === 'income' ? `Entrada (${person})` : 'Pagamento via PIX'
      );

  return {
    transactionType,
    action,
    paymentMethod: isCreditCard ? 'credit_card' : isPix ? 'pix' : isPending ? 'boleto' : 'pix',
    matchedExistingExpenseId: matchedExpense ? matchedExpense.id : '',
    description,
    amount,
    date: dueDate,
    status: isPending ? 'Pendente' : 'Pago',
    blockId,
    boletoSubType,
    category,
    currentInstallment: inst.currentInstallment || 0,
    totalInstallments: inst.totalInstallments || 0,
    person,
    transcript: '',
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

async function transcribeAudioFallback(
  ai: GoogleGenAI,
  audioBase64: string,
  audioMimeType: string
): Promise<string> {
  const audioModels = ['gemini-3.5-transcribe', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  for (const modelName of audioModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            { inlineData: { mimeType: audioMimeType, data: audioBase64 } },
            { text: 'Transcreva fielmente este áudio em português do Brasil, preservando valores em reais, nomes, parcelas e datas.' },
          ],
        },
      });
      const text = (response.text ?? '').trim();
      if (text) return text;
    } catch {
      // Try next audio model
    }
  }
  return '';
}

async function generateWithFallback(
  ai: GoogleGenAI,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
  systemInstruction: string
): Promise<string> {
  let lastErr: unknown;

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
              action: { type: Type.STRING },
              paymentMethod: { type: Type.STRING },
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
              'action',
              'paymentMethod',
              'description',
              'amount',
              'date',
              'status',
              'blockId',
              'boletoSubType',
              'category',
              'currentInstallment',
              'totalInstallments',
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

  throw lastErr || new Error('Gemini unavailable');
}

async function parseAndSaveDirectToFirestore(params: {
  text?: string;
  mediaBase64?: string;
  mediaMimeType?: string;
  pdfExtractedText?: string;
  documentFilename?: string;
  isAudio?: boolean;
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
  let audioTranscript = '';

  const combinedTextContext = [
    params.text || '',
    params.documentFilename ? `Arquivo: ${params.documentFilename}` : '',
    params.pdfExtractedText ? `Texto extraído do PDF: ${params.pdfExtractedText}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        apiVersion: 'v1beta',
        httpOptions: {
          apiVersion: 'v1beta',
          timeout: 12000,
          retryOptions: { attempts: 1 },
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (params.mediaBase64 && params.mediaMimeType) {
        parts.push({
          inlineData: {
            mimeType: params.mediaMimeType,
            data: params.mediaBase64,
          },
        });
      }
      parts.push({
        text: [
          `Data de hoje: ${todayIso}`,
          `Mês ativo na planilha: ${activeMonthKey}`,
          `Remetente: ${defaultPerson}`,
          `Cartões e blocos disponíveis: ${JSON.stringify(blocks)}`,
          `Contas PENDENTES já lançadas no mês (para baixa automática APENAS se o favorecido E o valor realmente baterem): ${JSON.stringify(
            existingExpenses
              .filter((e) => e.status === 'Pendente')
              .map((e) => ({
                id: e.id,
                description: e.description,
                amount: e.amount,
                blockId: e.blockId,
                category: e.category,
              }))
          )}`,
          params.isAudio
            ? 'O usuário enviou um ÁUDIO de voz no WhatsApp. Ouça o áudio em português do Brasil, transcreva-o no campo "transcript" e extraia todos os dados do lançamento financeiro (valor, descrição, se é pago ou pendente, se é parcelado, se é PIX ou cartão de crédito, data de vencimento).'
            : combinedTextContext
            ? `Mensagem/Legenda/PDF: "${combinedTextContext}"`
            : 'Leia o comprovante INTEIRO (do topo extremo ao rodapé extremo, pois comprovantes do Santander e outros bancos são bem compridos) e extraia valor (R$), favorecido, método de pagamento (PIX vs Cartão de Crédito), data e parcelas.',
        ].join('\n'),
      });

      const systemInstruction = `Você é o classificador financeiro preciso do Domus Finanças (Rodolfo e Viviane).

REGRAS OBRIGATÓRIAS:
1. COMPROVANTES COMPRIDOS (Santander, Sicredi, Bradesco, Nubank, Caixa, Itaú, Inter):
   - Leia a imagem ou PDF INTEIRO do topo até o final. O valor (R$) geralmente fica na parte superior e o favorecido ("Para") e pagador ("De") mais abaixo. Extraia o VALOR EXATO impresso no comprovante!

2. DIFERENCIAÇÃO RIGOROSA — PIX vs. CARTÃO DE CRÉDITO ("paymentMethod" e "blockId"):
   - Se o comprovante for um PIX (ex: Comprovante PIX do Sicredi, PIX Santander, PIX Bradesco, PIX Nubank, PDF "sicredi_...pdf" contendo "Pix", "Chave Pix", "Transferência Pix", "ID/Transação E..."), defina paymentMethod = "pix" e OBRIGATORIAMENTE blockId = "outras" (NUNCA jogue um PIX para o cartão de crédito só porque o banco é Sicredi, Santander, Bradesco ou Nubank!).
   - SÓ defina paymentMethod = "credit_card" e escolha um blockId de cartão (sicredi, nubank, bradesco, santander, quero_quero, caixa) se aparecer EXPLICITAMENTE no comprovante ou na mensagem/áudio que é uma COMPRA NO CARTÃO DE CRÉDITO (ex: "compra crédito", "crédito à vista", "crédito parcelado", "cartão de crédito", "Mastercard", "Visa", "Elo", "fatura", ou o usuário disser "no cartão Sicredi", "no crédito Nubank", "passei no cartão").
   - Para boletos/carnês, use paymentMethod = "boleto" e blockId = "outras".

3. BAIXA EM CONTA FIXA JÁ LANÇADA vs. NOVA CONTA ALEATÓRIA DO MÊS ("action"):
   - Só defina action = "mark_existing_paid" e preencha matchedExistingExpenseId quando o pagamento for REALMENTE daquela conta fixa pendente já cadastrada (mesmo favorecido/empresa E valor compatível com o da conta pendente, ex: PIX para "Fit Energia" de R$ 309,74).
   - Se for outra empresa/favorecido OU outro valor diferente (exemplo: comprovante PIX para "COPEL" / "COPELDIS" com outro valor, mesmo que o usuário escreva "Luz" na legenda), NÃO dê baixa em "Fit Energia"! Defina action = "create", matchedExistingExpenseId = "", blockId = "outras", boletoSubType = "mensal" (gasto aleatório do mês) e description = "Luz - COPELDIS".

4. CONTAS PENDENTES E PARCELADAS ("status", "currentInstallment", "totalInstallments", "date"):
   - status: "Pendente" quando a mensagem/áudio indicar conta a pagar, pendente, boleto a vencer, vencimento futuro ("pendente", "a pagar", "vence dia 15", "falta pagar") ou compra parcelada a pagar. Use "Pago" quando for comprovante já pago ou mensagem no passado ("paguei", "pago", "fiz pix").
   - Parcelamento: se mencionar parcelas (ex: "em 5x de 120", "parcelado em 6 vezes", "parcela 2 de 10", "3/12"), preencha currentInstallment (ex: 1 ou 2) e totalInstallments (ex: 5, 6, 10, 12). Se não for parcelado, retorne 0 para ambos.
   - Valor em parcelamento: se disser "em 5x de 120", amount = 120. Se disser "comprei 600 em 3x" (valor total dividido), calcule o valor da parcela mensal: amount = 200.
   - Se for parcelado e NÃO for cartão de crédito (blockId = "outras"), use boletoSubType = "variavel".
   - Data ("date" em YYYY-MM-DD): se mencionar vencimento (ex: "vence dia 15" ou "para dia 20/12"), use essa data exata; caso contrário use a data do comprovante ou hoje (${todayIso}).

5. DESCRIÇÃO LIMPA ("description"):
   - Retorne uma descrição curta, limpa e sem repetir palavras nem incluir o valor (ex: "Lanche da noite", "Pizza da noite", "Luz - COPELDIS", "Mercado Atacadão").
   - Categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.`;

      try {
        const jsonText = await generateWithFallback(ai, parts, systemInstruction);
        raw = JSON.parse(jsonText);
        if (typeof raw?.transcript === 'string' && raw.transcript.trim()) {
          audioTranscript = raw.transcript.trim();
        }
      } catch (primaryErr) {
        geminiErrMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        // If audio failed direct multimodal JSON, transcribe with gemini-3.5-transcribe and parse deterministically
        if (params.isAudio && params.mediaBase64 && params.mediaMimeType) {
          audioTranscript = await transcribeAudioFallback(
            ai,
            params.mediaBase64,
            params.mediaMimeType
          );
        }
      }
    } catch (err) {
      geminiErrMsg = err instanceof Error ? err.message : String(err);
      raw = null;
    }
  }

  const fallbackTextSource = [params.text || '', audioTranscript, params.pdfExtractedText || '']
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!raw && fallbackTextSource) {
    raw = parsePortugueseFinancialTextFallback({
      text: fallbackTextSource,
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
        ? `Falha ao ler ${params.isAudio ? 'áudio' : 'comprovante'} (${geminiErrMsg.slice(0, 90)})`
        : 'Não foi possível identificar os dados do lançamento'
    );
  }

  const transactionType = raw.transactionType === 'income' ? 'income' : 'expense';
  const parsedAmt = parseFlexibleAmount(raw.amount);

  // Extract & validate installments from Gemini + deterministic text/transcript check
  const textInstallments = extractInstallmentsFromText(fallbackTextSource);
  const rawCurrInst = Number(raw.currentInstallment);
  const rawTotInst = Number(raw.totalInstallments);
  let currentInstallment: number | null =
    Number.isInteger(rawCurrInst) &&
    Number.isInteger(rawTotInst) &&
    rawCurrInst >= 1 &&
    rawTotInst >= 2 &&
    rawCurrInst <= rawTotInst
      ? rawCurrInst
      : textInstallments.currentInstallment;
  let totalInstallments: number | null =
    Number.isInteger(rawCurrInst) &&
    Number.isInteger(rawTotInst) &&
    rawCurrInst >= 1 &&
    rawTotInst >= 2 &&
    rawCurrInst <= rawTotInst
      ? rawTotInst
      : textInstallments.totalInstallments;

  // Verify existing pending expense match STRICTLY (never hijack Fit Energia for COPELDIS or mismatched amount!)
  let matchedExpense: ExistingExpenseItem | null =
    transactionType === 'expense' && raw.matchedExistingExpenseId
      ? existingExpenses.find(
          (e) => e.id === raw.matchedExistingExpenseId && e.status === 'Pendente'
        ) || null
      : null;

  if (matchedExpense) {
    const receiptDescNorm = normalizeText(
      `${String(raw.description || '')} ${params.text || ''} ${params.pdfExtractedText || ''}`
    );
    const expNorm = normalizeText(matchedExpense.description);

    // Guard 1: If receipt says COPEL / COPELDIS and matched bill is Fit Energia, reject false match!
    if (/\bcopel/.test(receiptDescNorm) && !/\bcopel/.test(expNorm)) {
      matchedExpense = null;
    }
    // Guard 2: If both have amounts and they differ significantly (> 20% and > R$ 15), reject false match!
    if (
      matchedExpense &&
      parsedAmt > 0 &&
      matchedExpense.amount > 0 &&
      Math.abs(matchedExpense.amount - parsedAmt) > Math.max(15, matchedExpense.amount * 0.2)
    ) {
      matchedExpense = null;
    }
  }

  if (!matchedExpense && transactionType === 'expense' && !totalInstallments) {
    const strictSearch = `${String(raw.description || '')} ${fallbackTextSource}`.trim();
    matchedExpense = findStrictMatchingPendingExpense(
      strictSearch,
      parsedAmt,
      existingExpenses
    );
  }

  const action =
    matchedExpense && matchedExpense.status === 'Pendente'
      ? 'mark_existing_paid'
      : 'create';

  // STRICT PIX vs. CREDIT CARD GUARD:
  // A PIX transfer from Sicredi / Santander / Bradesco / Nubank MUST NEVER go into a Credit Card block!
  const allCombinedText = `${fallbackTextSource} ${String(raw.description || '')}`.trim();
  const explicitCreditCard =
    raw.paymentMethod === 'credit_card' || hasExplicitCreditCardSignal(allCombinedText);
  const detectedPix =
    raw.paymentMethod === 'pix' ||
    (hasPixPaymentSignal(allCombinedText) && !hasExplicitCreditCardSignal(allCombinedText));

  const validBlockIds = new Set(blocks.map((b) => b.id));
  let blockId = matchedExpense
    ? matchedExpense.blockId
    : validBlockIds.has(String(raw.blockId))
    ? String(raw.blockId)
    : 'outras';

  if (!matchedExpense) {
    if (detectedPix && !hasExplicitCreditCardSignal(allCombinedText)) {
      // Force PIX into Boletos e Fixas (outras), NEVER into a credit card block!
      blockId = 'outras';
    } else if (!explicitCreditCard && blockId !== 'outras') {
      // Only allow credit card blocks when credit card is explicitly indicated
      blockId = 'outras';
    }
  }

  const paymentMethodLabel =
    blockId !== 'outras' || explicitCreditCard
      ? 'Cartão de Crédito'
      : detectedPix
      ? 'PIX'
      : raw.paymentMethod === 'boleto'
      ? 'Boleto'
      : 'PIX / Conta';

  let boletoSubType: 'fixa' | 'mensal' | 'variavel' =
    raw.boletoSubType === 'fixa' || raw.boletoSubType === 'variavel'
      ? raw.boletoSubType
      : 'mensal';

  if (totalInstallments && blockId === 'outras') {
    boletoSubType = 'variavel';
  }
  // If user sent a one-off receipt like COPELDIS ("Luz") that did NOT match a fixed bill, ensure it goes to Gastos Mensais!
  if (!matchedExpense && blockId === 'outras' && !totalInstallments && detectedPix) {
    const descNorm = normalizeText(`${String(raw.description || '')} ${params.text || ''}`);
    if (/\bcopel/.test(descNorm)) {
      boletoSubType = 'mensal';
    }
  }

  const category = (ALLOWED_CATEGORIES as readonly string[]).includes(String(raw.category))
    ? String(raw.category)
    : matchedExpense
    ? matchedExpense.category
    : 'Outros & Jurídico';
  const person =
    raw.person === 'Rodolfo' || raw.person === 'Viviane' ? raw.person : defaultPerson;

  const amount =
    parsedAmt > 0
      ? parsedAmt
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;

  // Build clean, non-duplicated description
  let description =
    action === 'mark_existing_paid' && matchedExpense
      ? matchedExpense.description
      : cleanExpenseDescription(
          String(raw.description || ''),
          cleanExpenseDescription(params.text || audioTranscript, 'Comprovante PIX')
        );

  // If user attached a short label caption like "Luz" alongside a media receipt with payee "COPELDIS", combine cleanly as "Luz - COPELDIS"
  if (
    params.mediaBase64 &&
    !params.isAudio &&
    params.text &&
    action !== 'mark_existing_paid'
  ) {
    const cleanCaption = cleanExpenseDescription(params.text, '');
    if (
      cleanCaption.length >= 2 &&
      !normalizeText(description).includes(normalizeText(cleanCaption)) &&
      !normalizeText(cleanCaption).includes(normalizeText(description))
    ) {
      description = `${cleanCaption} - ${description}`.slice(0, 75);
    }
  }

  const date =
    typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? raw.date
      : extractDueDateFromText(fallbackTextSource, activeMonthKey, todayIso);

  const normFallback = normalizeText(fallbackTextSource);
  const status: 'Pago' | 'Pendente' =
    raw.status === 'Pendente' ||
    (/\b(pendente|a\s+pagar|para\s+pagar|pra\s+pagar|vence|vencimento|falta\s+pagar|nao\s+paguei)\b/.test(
      normFallback
    ) &&
      !/\b(paguei|pago|quitado)\b/.test(normFallback))
      ? 'Pendente'
      : 'Pago';

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
      ? 'Boletos e Fixas → Despesas Variáveis (Parceladas)'
      : 'Boletos e Fixas → Gastos Mensais';

  if (amount <= 0) {
    throw new Error(
      params.isAudio
        ? `Não consegui identificar o valor no áudio${audioTranscript ? ` ("${audioTranscript.slice(0, 60)}")` : ''}. Fale o nome e o valor em reais.`
        : 'Não consegui identificar o valor (R$) no comprovante. Envie o comprovante inteiro ou escreva o valor na legenda.'
    );
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
            e.id === matchedExpense.id
              ? {
                  ...e,
                  status: 'Pago',
                  notes: e.notes
                    ? `${String(e.notes)} · Baixa ${paymentMethodLabel} via WhatsApp`
                    : `Baixa ${paymentMethodLabel} via WhatsApp (${params.senderName})`,
                }
              : e
          );
        } else {
          const noteParts = [
            `${paymentMethodLabel} via WhatsApp${params.isAudio ? ' (Áudio)' : ''} (${params.senderName})`,
            audioTranscript ? `"${audioTranscript.slice(0, 90)}"` : '',
          ].filter(Boolean);

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
            notes: noteParts.join(' · ').slice(0, 180),
          });
        }

        return {
          ...ledgerObj,
          incomes: incomes.slice(0, 100),
          expenses: expenses.slice(0, 300),
        };
      });

      const instLabel =
        currentInstallment && totalInstallments
          ? ` [${currentInstallment}/${totalInstallments}]`
          : '';
      const lastActionText = `WhatsApp (${params.senderName}): ${description}${instLabel} (${formatBRLServer(amount)} · ${status})`.slice(
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
    paymentMethodLabel,
    description,
    amount,
    date,
    status,
    currentInstallment,
    totalInstallments,
    destinationLabel,
    audioTranscript,
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

          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

          if (messages.length === 0) {
            continue;
          }

          const token = await getActiveWhatsAppToken();

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
            let pdfExtractedText: string | undefined;
            let documentFilename: string | undefined;
            let isAudio = false;
            let mediaDownloadError = '';

            if (msgType === 'text') {
              textContent = String(msg?.text?.body || '').trim();
            } else if (msgType === 'image') {
              textContent = String(msg?.image?.caption || '').trim();
              const mediaId = String(msg?.image?.id || '');
              const [, media] = await Promise.all([
                sendWhatsAppReadAndReaction({
                  token,
                  toPhone: fromPhone,
                  messageId: incomingMsgId,
                  emoji: '⏳',
                }),
                downloadWhatsAppMediaAsBase64(token, mediaId),
              ]);
              if ('base64' in media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              } else {
                mediaDownloadError = media.error;
              }
            } else if (msgType === 'document') {
              textContent = String(msg?.document?.caption || '').trim();
              documentFilename = String(msg?.document?.filename || '').trim();
              const mediaId = String(msg?.document?.id || '');
              const [, media] = await Promise.all([
                sendWhatsAppReadAndReaction({
                  token,
                  toPhone: fromPhone,
                  messageId: incomingMsgId,
                  emoji: '⏳',
                }),
                downloadWhatsAppMediaAsBase64(token, mediaId),
              ]);
              if ('base64' in media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
                pdfExtractedText = media.pdfExtractedText;
              } else {
                mediaDownloadError = media.error;
              }
            } else if (msgType === 'audio') {
              isAudio = true;
              const mediaId = String(msg?.audio?.id || '');
              const [, media] = await Promise.all([
                sendWhatsAppReadAndReaction({
                  token,
                  toPhone: fromPhone,
                  messageId: incomingMsgId,
                  emoji: '⏳',
                }),
                downloadWhatsAppMediaAsBase64(token, mediaId),
              ]);
              if ('base64' in media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              } else {
                mediaDownloadError = media.error;
              }
            } else {
              await sendWhatsAppReadAndReaction({
                token,
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '⚠️',
              });
              const unsupportedMsg =
                '⚠️ *Domus Finanças:* Formato não suportado. Envie texto, áudio, foto/print ou PDF de comprovante PIX (ex: *"Paguei 150,00 mercado"*, *"Pendente boleto 200,00 vence dia 15"* ou *"Cartão Nubank 3x de 100"*).';
              const replyRes = await sendWhatsAppTextReply(
                token,
                fromPhone,
                unsupportedMsg,
                incomingMsgId
              );
              await recordWebhookDiagnostic(
                `De ${fromPhone} (${msgType})`,
                `Reply: ${replyRes.details}`
              );
              continue;
            }

            if (!textContent && !mediaBase64) {
              const reactRes = await sendWhatsAppReadAndReaction({
                token,
                toPhone: fromPhone,
                messageId: incomingMsgId,
                emoji: '❌',
              });
              const dlErrMsg = [
                '❌ *Deu errado ao baixar o arquivo/áudio no Domus Finanças.*',
                mediaDownloadError ? `• *Detalhe:* ${mediaDownloadError}` : '',
                '💡 Tente reenviar ou verifique se o Token da Meta no app precisa ser renovado.',
              ]
                .filter(Boolean)
                .join('\n');
              const replyRes = await sendWhatsAppTextReply(
                token,
                fromPhone,
                dlErrMsg,
                incomingMsgId
              );
              await recordWebhookDiagnostic(
                `ERR MÍDIA ${fromPhone} (${msgType})`,
                `${mediaDownloadError || 'Sem conteúdo'} | React:${reactRes.status} | Meta:${replyRes.details}`
              );
              continue;
            }

            try {
              const parsed = await parseAndSaveDirectToFirestore({
                text: textContent || undefined,
                mediaBase64,
                mediaMimeType,
                pdfExtractedText,
                documentFilename,
                isAudio,
                senderName,
              });

              const installmentLine =
                parsed.currentInstallment && parsed.totalInstallments
                  ? `• *Parcela:* ${parsed.currentInstallment}/${parsed.totalInstallments}`
                  : '';

              const replySummary = [
                '✅ *Lançamento Confirmado no Domus Finanças!*',
                `• *Tipo:* ${parsed.transactionType === 'income' ? 'Entrada / Receita' : `Saída (${parsed.paymentMethodLabel})`}`,
                `• *Descrição:* ${parsed.description}`,
                `• *Valor:* ${formatBRLServer(parsed.amount)}`,
                installmentLine,
                `• *Local:* ${parsed.destinationLabel}`,
                `• *Situação:* ${parsed.status} (${parsed.date.split('-').reverse().join('/')})`,
                parsed.audioTranscript ? `🎤 *Áudio ouvido:* "${parsed.audioTranscript.slice(0, 120)}"` : '',
                parsed.savedToCloud
                  ? '☁️ *Já gravado automaticamente na planilha da família!*'
                  : '',
              ]
                .filter(Boolean)
                .join('\n');

              const [reactRes, replyRes] = await Promise.all([
                sendWhatsAppReadAndReaction({
                  token,
                  toPhone: fromPhone,
                  messageId: incomingMsgId,
                  emoji: '✅',
                }),
                sendWhatsAppTextReply(
                  token,
                  fromPhone,
                  replySummary,
                  incomingMsgId
                ),
              ]);

              await recordWebhookDiagnostic(
                `OK ${fromPhone}: ${parsed.description} (${formatBRLServer(parsed.amount)} · ${parsed.status})`,
                `Cloud:${parsed.savedToCloud} | ${parsed.paymentMethodLabel} | Mime:${mediaMimeType || 'text'} | React:${reactRes.status} | Meta:${replyRes.details}`
              );
            } catch (err) {
              const errDetail = err instanceof Error ? err.message : 'valor não identificado';
              const errorReply = [
                '❌ *Deu errado ao lançar no Domus Finanças.*',
                `• *Motivo:* ${errDetail}`,
                '💡 *Exemplos que funcionam:* *"Paguei 150,00 mercado"*, *"Pendente luz 120 vence dia 15"*, *"Compra crédito Nubank 6x de 80"*, áudio ou comprovante PIX.',
              ].join('\n');

              const [reactRes, replyRes] = await Promise.all([
                sendWhatsAppReadAndReaction({
                  token,
                  toPhone: fromPhone,
                  messageId: incomingMsgId,
                  emoji: '❌',
                }),
                sendWhatsAppTextReply(
                  token,
                  fromPhone,
                  errorReply,
                  incomingMsgId
                ),
              ]);

              await recordWebhookDiagnostic(
                `ERR ${fromPhone}: "${textContent.slice(0, 35) || documentFilename || mediaMimeType || msgType}"`,
                `Err:${errDetail} | React:${reactRes.status} | Meta:${replyRes.details}`
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
