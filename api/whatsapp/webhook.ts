import crypto from 'crypto';
import { parseFinancialReceiptOrMessage } from '../../server/receiptParser';

const ALLOWED_MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

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
      host.endsWith('.fbsbx.com') ||
      host.endsWith('.fbcdn.net')
    );
  } catch {
    return false;
  }
}

async function sendWhatsAppTextReply(toPhone: string, bodyText: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;
  if (!/^[0-9]{6,20}$/.test(phoneNumberId) || !/^[0-9]{8,20}$/.test(toPhone)) return;

  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: bodyText.slice(0, 1000) },
      }),
    });
  } catch {
    // Non-blocking reply
  }
}

async function downloadWhatsAppMediaAsBase64(
  mediaId: string
): Promise<{ base64: string; mimeType: string } | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  if (!/^[a-zA-Z0-9_-]{4,128}$/.test(mediaId)) return null;

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) return null;
  const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!metaJson.url || !isAllowedMetaMediaUrl(metaJson.url)) {
    return null;
  }

  const mimeType = (metaJson.mime_type || 'image/jpeg').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_MEDIA_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const fileRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) return null;

  const arrayBuffer = await fileRes.arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
    return null;
  }

  return {
    base64: Buffer.from(arrayBuffer).toString('base64'),
    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
  };
}

function formatBRLServer(val: number): string {
  return Number(val || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
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

          for (const msg of messages) {
            const fromPhone = String(msg?.from || '').replace(/\D/g, '');
            if (!fromPhone) continue;

            const contact = contacts.find((c: { wa_id?: string }) => c?.wa_id === msg?.from);
            const senderName = String(contact?.profile?.name || 'WhatsApp').slice(0, 40);
            const msgType = String(msg?.type || '');

            let textContent = '';
            let mediaBase64: string | undefined;
            let mediaMimeType: string | undefined;

            if (msgType === 'text') {
              textContent = String(msg?.text?.body || '').trim();
            } else if (msgType === 'image') {
              textContent = String(msg?.image?.caption || '').trim();
              const mediaId = String(msg?.image?.id || '');
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if (media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              }
            } else if (msgType === 'document') {
              textContent = String(msg?.document?.caption || '').trim();
              const mediaId = String(msg?.document?.id || '');
              const media = await downloadWhatsAppMediaAsBase64(mediaId);
              if (media) {
                mediaBase64 = media.base64;
                mediaMimeType = media.mimeType;
              }
            }

            if (!textContent && !mediaBase64) continue;

            try {
              const parsed = await parseFinancialReceiptOrMessage({
                text: textContent || undefined,
                imageBase64: mediaBase64,
                imageMimeType: mediaMimeType,
                defaultPerson: senderName.toLowerCase().includes('viviane')
                  ? 'Viviane'
                  : senderName.toLowerCase().includes('rodolfo')
                  ? 'Rodolfo'
                  : 'Família',
              });

              const replySummary = [
                '✅ *Lançamento identificado no Domus Finanças!*',
                `• *Tipo:* ${parsed.transactionType === 'income' ? 'Entrada / Receita' : 'Saída / Pagamento'}`,
                `• *Descrição:* ${parsed.description}`,
                `• *Valor:* ${formatBRLServer(parsed.amount)}`,
                `• *Local:* ${parsed.destinationLabel}`,
                `• *Situação:* ${parsed.status}`,
              ].join('\n');

              await sendWhatsAppTextReply(fromPhone, replySummary);
            } catch {
              await sendWhatsAppTextReply(
                fromPhone,
                '⚠️ Não consegui ler este comprovante/mensagem agora. Tente enviar novamente.'
              );
            }
          }
        }
      }
    } catch {
      // Ignore errors so Meta receives 200 OK
    }
    return res.status(200).json({ status: 'received' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
