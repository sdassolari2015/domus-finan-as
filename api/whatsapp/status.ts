import crypto from 'crypto';
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

function getServerFirestore() {
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({ projectId: FIREBASE_PROJECT_ID });
  return getFirestore(app, FIRESTORE_DATABASE_ID);
}

function getEncryptionKey(): Buffer | null {
  const secret =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
    '';
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptTokenForCloud(plainToken: string): string | null {
  const key = getEncryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

function decryptTokenFromCloud(payload: string): string | null {
  try {
    const key = getEncryptionKey();
    if (!key || !payload) return null;
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

async function getEffectiveAccessToken(overrideToken?: string): Promise<{
  token: string;
  diagExpenses: Array<Record<string, unknown>>;
  diagIncomes: Array<Record<string, unknown>>;
}> {
  const db = getServerFirestore();
  let diagExpenses: Array<Record<string, unknown>> = [];
  let diagIncomes: Array<Record<string, unknown>> = [];

  try {
    const snap = await getDoc(
      doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', DIAGNOSTIC_DOC_KEY)
    );
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data?.expenses)) diagExpenses = data.expenses;
      if (Array.isArray(data?.incomes)) diagIncomes = data.incomes;
    }
  } catch {
    // Ignore read error
  }

  if (overrideToken && overrideToken.trim().length > 20) {
    return { token: overrideToken.trim(), diagExpenses, diagIncomes };
  }

  // Check if there is a newer encrypted token saved in Firestore 2099-11
  const tokenEntry = diagIncomes.find((i) => i?.id === 'wa-token-enc');
  if (tokenEntry && typeof tokenEntry.date === 'string') {
    const decrypted = decryptTokenFromCloud(tokenEntry.date);
    if (decrypted && decrypted.length > 20) {
      return { token: decrypted, diagExpenses, diagIncomes };
    }
  }

  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '',
    diagExpenses,
    diagIncomes,
  };
}

async function saveEncryptedTokenToCloud(
  plainToken: string,
  prevExpenses: Array<Record<string, unknown>>
): Promise<void> {
  const encrypted = encryptTokenForCloud(plainToken);
  if (!encrypted) return;
  try {
    const db = getServerFirestore();
    await setDoc(
      doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', DIAGNOSTIC_DOC_KEY),
      {
        householdId: HOUSEHOLD_DOC_ID,
        monthKey: DIAGNOSTIC_DOC_KEY,
        label: 'Diagnóstico Webhook WhatsApp',
        year: 2099,
        month: 11,
        incomes: [
          {
            id: 'wa-token-enc',
            person: 'Família',
            description: 'AES256GCM',
            amount: 0,
            date: encrypted,
          },
        ],
        expenses: prevExpenses.slice(0, 20),
        updatedAt: serverTimestamp(),
      }
    );
  } catch {
    // Ignore save error
  }
}

function getCandidatePhones(rawPhone: string): string[] {
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

export default async function handler(
  req: { method?: string; body?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  const overrideToken =
    typeof req.body?.newAccessToken === 'string'
      ? req.body.newAccessToken.trim()
      : undefined;

  const { token, diagExpenses } = await getEffectiveAccessToken(overrideToken);
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '1428542540347469';
  const hasAccessToken = Boolean(token);
  const hasPhoneNumberId = Boolean(phoneNumberId);
  const hasVerifyToken = true;
  const hasAllowedPhones = Boolean(process.env.WHATSAPP_ALLOWED_PHONES?.trim());
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

  if (req.method === 'POST') {
    if (!hasAccessToken || !hasPhoneNumberId) {
      return res.status(400).json({
        ok: false,
        error: 'Cole o Token de Acesso da Meta ou configure WHATSAPP_ACCESS_TOKEN.',
      });
    }
    if (!/^[0-9]{6,20}$/.test(phoneNumberId)) {
      return res.status(400).json({
        ok: false,
        error: 'WHATSAPP_PHONE_NUMBER_ID inválido.',
      });
    }

    // If user pasted a new token directly in the app, verify and persist it encrypted in Firestore
    if (overrideToken && overrideToken.length > 20) {
      await saveEncryptedTokenToCloud(overrideToken, diagExpenses);
    }

    // Subscribe WABA to webhook automatically
    const wabaId =
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || '1460969489540812';
    if (/^[0-9]{6,25}$/.test(wabaId)) {
      await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }

    const rawTo =
      typeof req.body?.to === 'string' && req.body.to.trim()
        ? req.body.to.trim()
        : '5543996040935';
    const candidates = getCandidatePhones(rawTo);
    const attempts: Array<{
      to: string;
      kind: 'text' | 'template';
      status: number;
      ok: boolean;
      response: unknown;
    }> = [];

    let deliveredAny = false;

    for (const candidate of candidates) {
      if (!/^[0-9]{8,20}$/.test(candidate)) continue;

      let candidateDelivered = false;

      // 1. Try direct text message
      try {
        const textRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: candidate,
              type: 'text',
              text: {
                body: '✅ *Domus Finanças conectado ao seu WhatsApp!*\n\nAgora você já pode enviar:\n• Fotos ou PDFs de comprovantes PIX\n• Mensagens como: *"Paguei 150,00 mercado"* ou *"Recebi 800 extra"*',
              },
            }),
          }
        );
        const textJson = await textRes.json().catch(() => ({}));
        attempts.push({
          to: candidate,
          kind: 'text',
          status: textRes.status,
          ok: textRes.ok,
          response: textJson,
        });
        if (textRes.ok) {
          deliveredAny = true;
          candidateDelivered = true;
        }
      } catch (err) {
        attempts.push({
          to: candidate,
          kind: 'text',
          status: 500,
          ok: false,
          response: { error: err instanceof Error ? err.message : 'fetch error' },
        });
      }

      // 2. Also send hello_world template
      try {
        const tplRes = await fetch(
          `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: candidate,
              type: 'template',
              template: {
                name: 'hello_world',
                language: { code: 'en_US' },
              },
            }),
          }
        );
        const tplJson = await tplRes.json().catch(() => ({}));
        attempts.push({
          to: candidate,
          kind: 'template',
          status: tplRes.status,
          ok: tplRes.ok,
          response: tplJson,
        });
        if (tplRes.ok) {
          deliveredAny = true;
          candidateDelivered = true;
        }
      } catch {
        // Ignore template error
      }

      if (candidateDelivered) {
        break;
      }
    }

    return res.status(200).json({
      ok: deliveredAny,
      candidates,
      attempts,
    });
  }

  let metaTokenValid: boolean | null = null;
  let metaPhoneDisplay: string | null = null;
  let metaVerifiedName: string | null = null;
  let metaError: string | null = null;

  if (hasAccessToken && hasPhoneNumberId && /^[0-9]{6,20}$/.test(phoneNumberId)) {
    try {
      const checkRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const checkJson = (await checkRes.json().catch(() => ({}))) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string; code?: number };
      };
      if (checkRes.ok) {
        metaTokenValid = true;
        metaPhoneDisplay = checkJson.display_phone_number || null;
        metaVerifiedName = checkJson.verified_name || null;

        const wabaId =
          process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || '1460969489540812';
        if (/^[0-9]{6,25}$/.test(wabaId)) {
          await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      } else {
        metaTokenValid = false;
        metaError =
          checkJson?.error?.message || `HTTP ${checkRes.status} ao validar token na Meta`;
      }
    } catch (err) {
      metaTokenValid = false;
      metaError = err instanceof Error ? err.message : 'Erro de conexão com a Meta';
    }
  }

  const recentLogs = diagExpenses.slice(0, 6).map((e) => ({
    summary: String(e?.description || ''),
    details: String(e?.notes || ''),
  }));

  return res.status(200).json({
    connected: hasAccessToken && hasPhoneNumberId && metaTokenValid !== false,
    hasAccessToken,
    hasPhoneNumberId,
    hasVerifyToken,
    hasAllowedPhones,
    hasGeminiKey,
    metaTokenValid,
    metaPhoneDisplay,
    metaVerifiedName,
    metaError,
    recentLogs,
    pendingInboxCount: 0,
    webhookPath: '/api/whatsapp/webhook',
  });
}
