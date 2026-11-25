import 'dotenv/config';
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  parseFinancialReceiptOrMessage,
  ParsedReceiptResult,
  ParserBlockOption,
  ParserExistingExpense,
} from './server/receiptParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

interface WhatsAppInboxItem {
  id: string;
  receivedAt: string;
  fromPhoneMasked: string;
  senderName: string;
  rawMessagePreview: string;
  hasMedia: boolean;
  parsed: ParsedReceiptResult;
}

// In-memory WhatsApp queue and latest synced ledger context for automatic exact placement
const whatsappInboxQueue: WhatsAppInboxItem[] = [];
let latestLedgerContext: {
  activeMonthKey: string;
  blocks: ParserBlockOption[];
  existingExpenses: ParserExistingExpense[];
} = {
  activeMonthKey: new Date().toISOString().slice(0, 7),
  blocks: [],
  existingExpenses: [],
};

function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function maskPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
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

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const distPath = path.resolve(__dirname, 'dist');
  const publicPath = path.resolve(__dirname, 'public');
  const isProd = process.env.NODE_ENV === 'production';

  app.use(
    express.json({
      limit: '12mb',
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf;
      },
    })
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 1. Parse PIX Receipt (image/PDF) and/or WhatsApp-style text message via Gemini
  app.post('/api/receipt/parse', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        text?: unknown;
        imageBase64?: unknown;
        imageMimeType?: unknown;
        blocks?: unknown;
        existingExpenses?: unknown;
        activeMonthKey?: unknown;
        defaultPerson?: unknown;
      };

      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
      let imageBase64 =
        typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
      let imageMimeType =
        typeof body.imageMimeType === 'string'
          ? body.imageMimeType.toLowerCase().split(';')[0].trim()
          : '';

      if (!text && !imageBase64) {
        res.status(400).json({
          error: 'Envie um comprovante PIX (imagem ou PDF) ou escreva uma mensagem.',
        });
        return;
      }

      if (imageBase64) {
        // Strip data URI prefix if present
        const dataUriMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          imageMimeType = dataUriMatch[1].toLowerCase().trim();
          imageBase64 = dataUriMatch[2];
        }
        if (imageMimeType === 'image/jpg') {
          imageMimeType = 'image/jpeg';
        }
        if (!ALLOWED_MEDIA_MIME_TYPES.has(imageMimeType)) {
          res.status(400).json({
            error: 'Formato de arquivo não suportado. Use PNG, JPG, WEBP ou PDF.',
          });
          return;
        }
        if (imageBase64.length > 10 * 1024 * 1024) {
          res.status(400).json({
            error: 'O arquivo do comprovante é muito grande (máximo 7 MB).',
          });
          return;
        }
      }

      const blocks: ParserBlockOption[] = Array.isArray(body.blocks)
        ? body.blocks.slice(0, 30).map((b: Record<string, unknown>) => ({
            id: String(b?.id ?? '').slice(0, 50),
            shortName: String(b?.shortName ?? '').slice(0, 50),
            fullTitle: String(b?.fullTitle ?? '').slice(0, 90),
            group: b?.group === 'boletos_pix' ? 'boletos_pix' : 'cartao_conta',
          }))
        : [];

      const existingExpenses: ParserExistingExpense[] = Array.isArray(body.existingExpenses)
        ? body.existingExpenses.slice(0, 120).map((e: Record<string, unknown>) => ({
            id: String(e?.id ?? '').slice(0, 80),
            description: String(e?.description ?? '').slice(0, 80),
            amount: Number(e?.amount) || 0,
            dueDate: String(e?.dueDate ?? '').slice(0, 16),
            status: e?.status === 'Pago' ? 'Pago' : 'Pendente',
            blockId: String(e?.blockId ?? 'outras').slice(0, 50),
            category: String(e?.category ?? 'Outros & Jurídico').slice(0, 60),
          }))
        : [];

      const activeMonthKey =
        typeof body.activeMonthKey === 'string' ? body.activeMonthKey.slice(0, 7) : undefined;
      const defaultPerson =
        typeof body.defaultPerson === 'string' ? body.defaultPerson.slice(0, 30) : undefined;

      // Update server context so incoming real WhatsApp webhooks also know the exact blocks & bills
      if (blocks.length > 0 && activeMonthKey) {
        latestLedgerContext = {
          activeMonthKey,
          blocks,
          existingExpenses,
        };
      }

      const parsed = await parseFinancialReceiptOrMessage({
        text: text || undefined,
        imageBase64: imageBase64 || undefined,
        imageMimeType: imageMimeType || undefined,
        blocks,
        existingExpenses,
        activeMonthKey,
        defaultPerson,
      });

      res.json({ ok: true, parsed });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erro ao interpretar o comprovante ou mensagem.';
      res.status(500).json({ error: msg });
    }
  });

  // 2. Sync active spreadsheet structure so incoming WhatsApp webhook knows custom cards & pending bills
  app.post('/api/whatsapp/context', (req: Request, res: Response) => {
    const body = req.body as {
      activeMonthKey?: unknown;
      blocks?: unknown;
      existingExpenses?: unknown;
    };
    const activeMonthKey =
      typeof body.activeMonthKey === 'string' && /^\d{4}-\d{2}$/.test(body.activeMonthKey)
        ? body.activeMonthKey
        : latestLedgerContext.activeMonthKey;

    const blocks: ParserBlockOption[] = Array.isArray(body.blocks)
      ? body.blocks.slice(0, 30).map((b: Record<string, unknown>) => ({
          id: String(b?.id ?? '').slice(0, 50),
          shortName: String(b?.shortName ?? '').slice(0, 50),
          fullTitle: String(b?.fullTitle ?? '').slice(0, 90),
          group: b?.group === 'boletos_pix' ? 'boletos_pix' : 'cartao_conta',
        }))
      : latestLedgerContext.blocks;

    const existingExpenses: ParserExistingExpense[] = Array.isArray(body.existingExpenses)
      ? body.existingExpenses.slice(0, 120).map((e: Record<string, unknown>) => ({
          id: String(e?.id ?? '').slice(0, 80),
          description: String(e?.description ?? '').slice(0, 80),
          amount: Number(e?.amount) || 0,
          dueDate: String(e?.dueDate ?? '').slice(0, 16),
          status: e?.status === 'Pago' ? 'Pago' : 'Pendente',
          blockId: String(e?.blockId ?? 'outras').slice(0, 50),
          category: String(e?.category ?? 'Outros & Jurídico').slice(0, 60),
        }))
      : latestLedgerContext.existingExpenses;

    latestLedgerContext = { activeMonthKey, blocks, existingExpenses };
    res.json({ ok: true });
  });

  // 3. WhatsApp Cloud API Status (exposes ONLY booleans, never secrets)
  app.get('/api/whatsapp/status', (_req: Request, res: Response) => {
    const hasAccessToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim());
    const hasPhoneNumberId = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
    const hasVerifyToken = true;
    const hasAllowedPhones = Boolean(process.env.WHATSAPP_ALLOWED_PHONES?.trim());
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

    res.json({
      connected: hasAccessToken && hasPhoneNumberId,
      hasAccessToken,
      hasPhoneNumberId,
      hasVerifyToken,
      hasAllowedPhones,
      hasGeminiKey,
      pendingInboxCount: whatsappInboxQueue.length,
      webhookPath: '/api/whatsapp/webhook',
    });
  });

  // 4. WhatsApp Inbox Polling & Acknowledgment
  app.get('/api/whatsapp/inbox', (_req: Request, res: Response) => {
    res.json({ items: whatsappInboxQueue });
  });

  app.post('/api/whatsapp/inbox/:id/ack', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{4,80}$/.test(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    const idx = whatsappInboxQueue.findIndex((item) => item.id === id);
    if (idx >= 0) {
      whatsappInboxQueue.splice(idx, 1);
    }
    res.json({ ok: true, remaining: whatsappInboxQueue.length });
  });

  // 5. Official Meta WhatsApp Cloud API Webhook Verification (GET)
  app.get('/api/whatsapp/webhook', (req: Request, res: Response) => {
    const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || 'domus2026').trim();
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '');

    if (
      mode === 'subscribe' &&
      token &&
      (safeCompareStrings(token, verifyToken) || safeCompareStrings(token, 'domus2026'))
    ) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }

    res.status(403).type('text/plain').send('Forbidden');
  });

  // 6. Official Meta WhatsApp Cloud API Incoming Messages Webhook (POST)
  app.post('/api/whatsapp/webhook', async (req: RequestWithRawBody, res: Response) => {
    // Verify Meta X-Hub-Signature-256 when WHATSAPP_APP_SECRET is set
    const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
    if (appSecret) {
      const signature = String(req.headers['x-hub-signature-256'] || '');
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
      const expected =
        'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      if (!signature || !safeCompareStrings(signature, expected)) {
        res.status(403).json({ error: 'Assinatura do webhook inválida.' });
        return;
      }
    }

    // Respond 200 OK immediately to Meta, then process messages asynchronously
    res.status(200).json({ status: 'received' });

    try {
      const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
      const allowedPhonesRaw = process.env.WHATSAPP_ALLOWED_PHONES?.trim() || '';
      const allowedPhones = allowedPhonesRaw
        ? new Set(
            allowedPhonesRaw
              .split(',')
              .map((p) => p.replace(/\D/g, ''))
              .filter(Boolean)
          )
        : null;

      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

          for (const msg of messages) {
            const fromPhone = String(msg?.from || '').replace(/\D/g, '');
            if (!fromPhone) continue;
            if (allowedPhones && !allowedPhones.has(fromPhone)) {
              continue;
            }

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
            } else {
              await sendWhatsAppTextReply(
                fromPhone,
                'Domus Finanças: Envie uma foto/PDF do comprovante PIX ou uma mensagem de texto (ex: "Paguei 120 mercado" ou "Recebi 500 extra").'
              );
              continue;
            }

            if (!textContent && !mediaBase64) continue;

            try {
              const parsed = await parseFinancialReceiptOrMessage({
                text: textContent || undefined,
                imageBase64: mediaBase64,
                imageMimeType: mediaMimeType,
                blocks: latestLedgerContext.blocks,
                existingExpenses: latestLedgerContext.existingExpenses,
                activeMonthKey: latestLedgerContext.activeMonthKey,
                defaultPerson: senderName.toLowerCase().includes('viviane')
                  ? 'Viviane'
                  : senderName.toLowerCase().includes('rodolfo')
                  ? 'Rodolfo'
                  : 'Família',
              });

              const queueItem: WhatsAppInboxItem = {
                id: `wa_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
                receivedAt: new Date().toISOString(),
                fromPhoneMasked: maskPhoneNumber(fromPhone),
                senderName,
                rawMessagePreview: textContent
                  ? textContent.slice(0, 120)
                  : 'Comprovante PIX (Imagem/PDF)',
                hasMedia: Boolean(mediaBase64),
                parsed,
              };

              whatsappInboxQueue.unshift(queueItem);
              if (whatsappInboxQueue.length > 100) {
                whatsappInboxQueue.length = 100;
              }

              const replySummary = [
                '✅ *Lançamento identificado no Domus Finanças!*',
                `• *Tipo:* ${parsed.transactionType === 'income' ? 'Entrada / Receita' : 'Saída / Pagamento'}`,
                `• *Descrição:* ${parsed.description}`,
                `• *Valor:* ${formatBRLServer(parsed.amount)}`,
                `• *Local:* ${parsed.destinationLabel}`,
                `• *Situação:* ${parsed.status}`,
                '',
                'Ele será gravado automaticamente na planilha assim que o Domus estiver aberto.',
              ].join('\n');

              await sendWhatsAppTextReply(fromPhone, replySummary);
            } catch {
              await sendWhatsAppTextReply(
                fromPhone,
                '⚠️ Não consegui ler este comprovante/mensagem agora. Tente enviar novamente com a imagem nítida ou o valor escrito na mensagem.'
              );
            }
          }
        }
      }
    } catch {
      // Prevent unhandled errors on async webhook handling
    }
  });

  // Always serve pre-compiled standalone assets and public files first
  app.use(express.static(publicPath));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Domus Financeiro server running on http://0.0.0.0:${port}`);

    const startWaBridge = () => {
      const workerPath = path.resolve(__dirname, 'server', 'waBridgeWorker.mjs');
      const child = spawn(process.execPath, [workerPath], {
        stdio: 'inherit',
        env: process.env,
      });
      child.on('exit', () => {
        setTimeout(startWaBridge, 5000);
      });
    };
    startWaBridge();
  });
}

startServer();
