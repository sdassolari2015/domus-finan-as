import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const HOUSEHOLD_DOC_ID = 'domus_family';

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
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
  'gemini-4-argon',
];

function getServerFirestore() {
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
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
      host.endsWith('.fbsbx.com') ||
      host.endsWith('.fbcdn.net')
    );
  } catch {
    return false;
  }
}

// Normalizes Brazilian 9-digit mobile numbers so replies work whether Meta delivered 12 or 13 digits
function getCandidateRecipientPhones(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, '');
  const list = [digits];
  if (digits.startsWith('55') && digits.length === 12) {
    // Insert 9 after DDD: 55 + DD + 9 + 8digits
    list.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  } else if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    // Also try 12-digit version without the 9
    list.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  }
  return Array.from(new Set(list));
}

async function sendWhatsAppTextReply(toPhone: string, bodyText: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return;
  if (!/^[0-9]{6,20}$/.test(phoneNumberId)) return;

  const candidates = getCandidateRecipientPhones(toPhone);
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
          to: candidate,
          type: 'text',
          text: { body: bodyText.slice(0, 1000) },
        }),
      });
      if (res.ok) {
        return;
      }
    } catch {
      // Try next candidate
    }
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

async function generateWithFallback(
  ai: GoogleGenAI,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
  systemInstruction: string
): Promise<string> {
  let lastErr: unknown;
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
      if (text) return text;
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const db = getServerFirestore();
  let activeMonthKey = '2026-10';
  let blocks = [...DEFAULT_BLOCKS];
  let existingExpenses: Array<{
    id: string;
    description: string;
    amount: number;
    dueDate: string;
    status: string;
    blockId: string;
    category: string;
  }> = [];

  try {
    const workspaceSnap = await getDoc(doc(db, 'households', HOUSEHOLD_DOC_ID));
    if (workspaceSnap.exists()) {
      const wData = workspaceSnap.data();
      if (typeof wData.activeMonthKey === 'string' && /^\d{4}-\d{2}$/.test(wData.activeMonthKey)) {
        activeMonthKey = wData.activeMonthKey;
      }
    }
    const ledgerSnap = await getDoc(
      doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', activeMonthKey)
    );
    if (ledgerSnap.exists()) {
      const lData = ledgerSnap.data();
      if (Array.isArray(lData.customBlocks) && lData.customBlocks.length > 0) {
        blocks = lData.customBlocks;
      }
      if (Array.isArray(lData.expenses)) {
        existingExpenses = lData.expenses;
      }
    }
  } catch {
    // Fallback to defaults if Firestore read fails
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultPerson = params.senderName.toLowerCase().includes('viviane')
    ? 'Viviane'
    : 'Rodolfo';

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
      params.text ? `Mensagem: "${params.text}"` : 'Extraia os dados do comprovante PIX.',
    ].join('\n'),
  });

  const systemInstruction = `Você é o classificador financeiro do Domus Finanças (Rodolfo e Viviane). Analise o comprovante PIX ou mensagem e classifique no local exato.
- transactionType: "income" (entrada/recebido) ou "expense" (saída/pago).
- action: "mark_existing_paid" se corresponder a uma conta pendente existente (informe o id em matchedExistingExpenseId), ou "create" se for novo.
- blockId: id do cartão/conta se mencionado (ex: nubank, bradesco, santander, caixa, sicredi, quero_quero), ou "outras" para PIX/boletos/gastos gerais.
- boletoSubType: "fixa" (luz, água, internet, fixas mensais), "variavel" (parcelado, consórcio, boleto parcelado) ou "mensal" (mercado, farmácia, gasolina, gastos do mês).
- Categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.`;

  const jsonText = await generateWithFallback(ai, parts, systemInstruction);
  const raw = JSON.parse(jsonText);

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
    : validBlockIds.has(raw.blockId)
    ? raw.blockId
    : 'outras';
  const boletoSubType =
    raw.boletoSubType === 'fixa' || raw.boletoSubType === 'variavel'
      ? raw.boletoSubType
      : 'mensal';
  const category = (ALLOWED_CATEGORIES as readonly string[]).includes(raw.category)
    ? raw.category
    : 'Outros & Jurídico';
  const person =
    raw.person === 'Rodolfo' || raw.person === 'Viviane' ? raw.person : defaultPerson;
  const amountNum = Number(raw.amount);
  const amount =
    Number.isFinite(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) / 100 : 0;
  const description = String(raw.description || 'Lançamento via WhatsApp').slice(0, 75);
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

  // Persist directly to Google Cloud Firestore so the spreadsheet updates immediately in real time!
  let savedToCloud = false;
  try {
    const ledgerRef = doc(db, 'households', HOUSEHOLD_DOC_ID, 'ledgers', activeMonthKey);
    const ledgerSnap = await getDoc(ledgerRef);
    if (ledgerSnap.exists() && amount > 0) {
      const lData = ledgerSnap.data();
      const incomes = Array.isArray(lData.incomes) ? [...lData.incomes] : [];
      let expenses = Array.isArray(lData.expenses) ? [...lData.expenses] : [];

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

      const updatedPayload: Record<string, unknown> = {
        monthKey: lData.monthKey || activeMonthKey,
        label: lData.label || activeMonthKey,
        year: Number(lData.year) || 2026,
        month: Number(lData.month) || 10,
        incomes: incomes.slice(0, 100),
        expenses: expenses.slice(0, 500),
        updatedAt: serverTimestamp(),
      };
      if (Array.isArray(lData.customBlocks) && lData.customBlocks.length > 0) {
        updatedPayload.customBlocks = lData.customBlocks;
      }

      await setDoc(ledgerRef, updatedPayload);
      await setDoc(
        doc(db, 'households', HOUSEHOLD_DOC_ID),
        {
          householdId: HOUSEHOLD_DOC_ID,
          activeMonthKey,
          lastAction: `WhatsApp (${params.senderName}): ${description} (${formatBRLServer(amount)})`,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

          for (const msg of messages) {
            const fromPhone = String(msg?.from || '').replace(/\D/g, '');
            if (!fromPhone) continue;

            const contact = contacts.find((c: { wa_id?: string }) => c?.wa_id === msg?.from);
            const senderName = String(contact?.profile?.name || 'Rodolfo').slice(0, 40);
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
                'Domus Finanças: Envie a foto/PDF de um comprovante PIX ou uma mensagem com o valor (ex: "Paguei 150 mercado" ou "Recebi 800 extra").'
              );
              continue;
            }

            if (!textContent && !mediaBase64) continue;

            try {
              const parsed = await parseAndSaveDirectToFirestore({
                text: textContent || undefined,
                imageBase64: mediaBase64,
                imageMimeType: mediaMimeType,
                senderName,
              });

              const replySummary = [
                '✅ *Lançado na Planilha Domus Finanças!*',
                `• *Tipo:* ${parsed.transactionType === 'income' ? 'Entrada / Receita' : 'Saída / Pagamento'}`,
                `• *Descrição:* ${parsed.description}`,
                `• *Valor:* ${formatBRLServer(parsed.amount)}`,
                `• *Local:* ${parsed.destinationLabel}`,
                `• *Situação:* ${parsed.status}`,
                parsed.savedToCloud
                  ? '☁️ *Já gravado automaticamente na nuvem da família!*'
                  : '',
              ]
                .filter(Boolean)
                .join('\n');

              await sendWhatsAppTextReply(fromPhone, replySummary);
            } catch {
              await sendWhatsAppTextReply(
                fromPhone,
                '⚠️ Recebi sua mensagem, mas não consegui identificar o valor. Envie por exemplo: "Paguei 150,00 mercado" ou a foto nítida do comprovante PIX.'
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
