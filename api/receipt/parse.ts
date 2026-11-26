import { GoogleGenAI, Type } from '@google/genai';

export const maxDuration = 60;

const ALLOWED_MEDIA_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/webm',
  'audio/aac',
  'audio/opus',
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
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
];

function normalizeText(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hasExplicitCreditCardSignal(text: string): boolean {
  const norm = normalizeText(text);
  return /\b(cartao|cartao de credito|compra credito|compra no credito|credito a vista|credito parcelado|no credito|na funcao credito|fatura|mastercard|visa|elo|quero quero|quero_quero)\b/.test(
    norm
  );
}

function hasPixPaymentSignal(text: string): boolean {
  const norm = normalizeText(text);
  return /\b(pix|chave pix|comprovante pix|transferencia pix|pagamento pix|e2e|id\/transacao|id transacao|autenticacao pix)\b/.test(
    norm
  );
}

function extractInstallmentsFromText(rawText: string): {
  currentInstallment: number | null;
  totalInstallments: number | null;
  isPerInstallmentAmount: boolean;
} {
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

function extractDueDateFromText(rawText: string, activeMonthKey: string, todayIso: string): string {
  const norm = normalizeText(rawText);
  const fullDateMatch = rawText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
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

function extractAmountFromText(rawText: string): number {
  const cleaned = rawText
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
    const parsed = numStr.includes(',')
      ? Number(numStr.replace(/\./g, '').replace(',', '.'))
      : Number(numStr);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1000000) {
      return Math.round(parsed * 100) / 100;
    }
  }
  return 0;
}

function findStrictMatchingPendingExpense(
  existingExpenses: ExistingExpenseItem[],
  candidateText: string,
  extractedAmount: number
): ExistingExpenseItem | null {
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

    // Never falsely match if both amounts exist and differ by > 20% and > R$ 15
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

function parsePortugueseFinancialTextFallback(params: {
  text: string;
  blocks: BlockItem[];
  existingExpenses: ExistingExpenseItem[];
  activeMonthKey: string;
  todayIso: string;
  defaultPerson: string;
}) {
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

  const transactionType: 'income' | 'expense' = isIncome ? 'income' : 'expense';

  let person: 'Rodolfo' | 'Viviane' | 'Família' =
    params.defaultPerson === 'Rodolfo' || params.defaultPerson === 'Viviane'
      ? params.defaultPerson
      : 'Família';
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

  const action: 'create' | 'mark_existing_paid' = matchedExpense
    ? 'mark_existing_paid'
    : 'create';

  const isCreditCard = hasExplicitCreditCardSignal(params.text);
  const isPix = hasPixPaymentSignal(params.text);
  const paymentMethod: 'pix' | 'credit_card' | 'boleto' | 'debit_cash' = isCreditCard
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

  let boletoSubType: 'fixa' | 'mensal' | 'variavel' = inst.totalInstallments ? 'variavel' : 'mensal';
  let category: string = matchedExpense ? matchedExpense.category : 'Outros & Jurídico';

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

  let cleanDesc = params.text
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
    confidenceNote: 'Classificado automaticamente pelo motor financeiro do Domus Finanças.',
  };
}

export default async function handler(
  req: { method?: string; body?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const body = (req.body || {}) as Record<string, unknown>;
    let text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    let imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    let imageMimeType =
      typeof body.imageMimeType === 'string'
        ? body.imageMimeType.toLowerCase().split(';')[0].trim()
        : '';

    if (!text && !imageBase64) {
      return res.status(400).json({
        error: 'Envie um comprovante PIX (imagem ou PDF), áudio ou escreva uma mensagem.',
      });
    }

    if (imageBase64) {
      const dataUriMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        imageMimeType = dataUriMatch[1].toLowerCase().split(';')[0].trim();
        imageBase64 = dataUriMatch[2];
      }
      if (imageMimeType === 'image/jpg') {
        imageMimeType = 'image/jpeg';
      } else if (imageMimeType === 'audio/mp3') {
        imageMimeType = 'audio/mpeg';
      } else if (imageMimeType === 'audio/m4a' || imageMimeType === 'audio/x-m4a') {
        imageMimeType = 'audio/mp4';
      } else if (imageMimeType === 'audio/opus') {
        imageMimeType = 'audio/ogg';
      }
      if (!ALLOWED_MEDIA_MIME_TYPES.has(imageMimeType)) {
        return res.status(400).json({
          error: 'Formato de arquivo não suportado. Use PNG, JPG, WEBP, PDF ou Áudio (OGG, MP3, WAV, M4A, WEBM).',
        });
      }
    }

    const isAudioMedia = Boolean(imageBase64 && imageMimeType.startsWith('audio/'));

    const blocks: BlockItem[] =
      Array.isArray(body.blocks) && body.blocks.length > 0
        ? body.blocks.slice(0, 30).map((b: Record<string, unknown>) => ({
            id: String(b?.id ?? '').slice(0, 50),
            shortName: String(b?.shortName ?? '').slice(0, 50),
            fullTitle: String(b?.fullTitle ?? '').slice(0, 90),
            group: b?.group === 'boletos_pix' ? 'boletos_pix' : 'cartao_conta',
          }))
        : DEFAULT_BLOCKS;

    const existingExpenses: ExistingExpenseItem[] = Array.isArray(body.existingExpenses)
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

    const todayIso = new Date().toISOString().slice(0, 10);
    const activeMonthKey =
      typeof body.activeMonthKey === 'string' && /^\d{4}-\d{2}$/.test(body.activeMonthKey)
        ? body.activeMonthKey
        : todayIso.slice(0, 7);
    const defaultPerson =
      typeof body.defaultPerson === 'string' ? body.defaultPerson.slice(0, 30) : 'Família';

    let raw: Record<string, unknown> | null = null;
    let lastModelErr: unknown = null;

    if (apiKey) {
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

      const systemInstruction = `Você é o classificador financeiro automático do aplicativo Domus Finanças (Rodolfo e Viviane).
Analise a imagem/PDF de comprovante (incluindo comprovantes VERTICAIS/COMPRIDOS do Santander, Sicredi, Bradesco, Nubank, Itaú, Caixa), áudio falado em português ou mensagem de texto.

REGRAS CRÍTICAS (SIGA RIGOROSAMENTE):
1. LEITURA COMPLETA DE COMPROVANTES COMPRIDOS (ex: Santander):
   - Leia a imagem INTEIRA do topo até o rodapé: valor (R$ ...), destinatário ("Para: ..."), pagador ("De: ..."), instituição e data.
2. DIFERENCIAÇÃO ESTRITA ENTRE PIX E CARTÃO DE CRÉDITO (paymentMethod):
   - Se o comprovante for um PIX (ex: "Comprovante Pix", "Transferência Pix", "Chave Pix", mesmo emitido pelo banco Sicredi, Santander, Bradesco ou Nubank), defina paymentMethod = "pix" e blockId = "outras".
   - NUNCA coloque um PIX no bloco de Cartão de Crédito só porque o banco é Sicredi, Santander, Bradesco ou Nubank!
   - SÓ defina paymentMethod = "credit_card" e blockId de um cartão (sicredi, nubank, bradesco, santander, quero_quero, caixa) se aparecer EXPLICITAMENTE: "compra crédito", "crédito à vista", "crédito parcelado", "cartão de crédito", "no cartão", "no crédito", "fatura", "Mastercard", "Visa", "Elo" ou "Quero Quero".
3. CONTA FIXA EXISTENTE vs GASTO AVULSO DO MÊS (action):
   - Só use action = "mark_existing_paid" se o destinatário/empresa E o valor corresponderem claramente à conta PENDENTE da lista (ex: PIX para Fit Energia no valor parecido com a conta Fit Energia).
   - Se for PIX para OUTRA empresa ou OUTRO valor (ex: comprovante para COPEL / COPELDIS com legenda "Luz", sendo que a fixa cadastrada é "Fit Energia" de outro valor), NÃO marque a fixa como paga! Use action = "create", blockId = "outras", boletoSubType = "mensal", status = "Pago" e descrição limpa como "Luz - COPELDIS".
4. CONTAS PENDENTES E PARCELADAS:
   - Se a mensagem ou áudio indicar conta a vencer/pendente ("pendente", "a pagar", "vence dia 15", "para dia 20/12"), defina status = "Pendente" e extraia a data em date (YYYY-MM-DD).
   - Se indicar parcelamento ("em 5x de 120", "parcela 2/10", "parcelado em 6 vezes", "600 em 3x"), preencha currentInstallment e totalInstallments (se só disser "5x de 120", currentInstallment=1, totalInstallments=5, amount=120; se disser "600 em 3x", amount=200). Se blockId="outras" e for parcelada, boletoSubType="variavel".
5. ÁUDIO:
   - Se houver áudio, transcreva-o em "transcript" e extraia todos os dados financeiros.
6. CATEGORIAS PERMITIDAS: ${ALLOWED_CATEGORIES.join(' | ')}.
7. DESCRIÇÃO: Curta, limpa, sem repetir palavras e sem colocar o valor na descrição.`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (imageBase64 && imageMimeType) {
        parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
      }
      parts.push({
        text: [
          `Data de hoje: ${todayIso}`,
          `Mês ativo: ${activeMonthKey}`,
          `Usuário padrão: ${defaultPerson}`,
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
          text
            ? `Mensagem/Legenda do usuário: "${text}"`
            : isAudioMedia
            ? 'Ouça o áudio em português, transcreva em transcript e extraia os dados financeiros.'
            : 'Extraia todos os dados do comprovante (do topo ao rodapé).',
        ].join('\n'),
      });

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
                  confidenceNote: { type: Type.STRING },
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
                  'confidenceNote',
                ],
              },
            },
          });
          const responseText = (response.text ?? '').trim();
          const firstBrace = responseText.indexOf('{');
          const lastBrace = responseText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            raw = JSON.parse(responseText.slice(firstBrace, lastBrace + 1));
            break;
          }
        } catch (err) {
          lastModelErr = err;
        }
      }

      // Dedicated transcription fallback if audio failed direct multimodal parsing
      if (!raw && isAudioMedia && imageBase64 && imageMimeType) {
        try {
          const transRes = await ai.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
                { text: 'Transcreva exatamente o que foi falado em português brasileiro.' },
              ],
            },
          });
          const transcriptText = (transRes.text ?? '').trim();
          if (transcriptText) {
            text = text ? `${text} ${transcriptText}` : transcriptText;
            raw = {
              ...parsePortugueseFinancialTextFallback({
                text,
                blocks,
                existingExpenses,
                activeMonthKey,
                todayIso,
                defaultPerson,
              }),
              transcript: transcriptText,
            };
          }
        } catch (err) {
          lastModelErr = err;
        }
      }
    }

    if (!raw && text) {
      raw = parsePortugueseFinancialTextFallback({
        text,
        blocks,
        existingExpenses,
        activeMonthKey,
        todayIso,
        defaultPerson,
      });
    }

    if (!raw) {
      throw (
        lastModelErr ||
        new Error(
          'Não foi possível ler o arquivo agora. Tente enviar um comprovante nítido ou digite o valor junto.'
        )
      );
    }

    const combinedSignalText = `${text} ${String(raw.transcript || '')} ${String(raw.description || '')} ${String(raw.confidenceNote || '')}`;
    const transactionType = raw.transactionType === 'income' ? 'income' : 'expense';
    const paymentMethod = String(raw.paymentMethod || '').toLowerCase();
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

    // Guard: reject mismatched fixed bill match (e.g. COPEL vs Fit Energia)
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

    // Strict PIX vs Credit Card guard: never put a PIX into a Credit Card block
    const explicitCredit =
      paymentMethod === 'credit_card' || hasExplicitCreditCardSignal(combinedSignalText);
    const isPix = paymentMethod === 'pix' || hasPixPaymentSignal(combinedSignalText);
    if (!matchedExpense && blockId !== 'outras' && (isPix || !explicitCredit)) {
      blockId = 'outras';
    }

    // Parse installments from AI or text fallback
    const fallbackInst = extractInstallmentsFromText(`${text} ${String(raw.transcript || '')}`);
    const rawCurr = Number(raw.currentInstallment);
    const rawTot = Number(raw.totalInstallments);
    let currentInstallment: number | null =
      Number.isInteger(rawCurr) && rawCurr >= 1 ? rawCurr : fallbackInst.currentInstallment;
    let totalInstallments: number | null =
      Number.isInteger(rawTot) && rawTot >= 2 ? rawTot : fallbackInst.totalInstallments;
    if (totalInstallments && (!currentInstallment || currentInstallment > totalInstallments)) {
      currentInstallment = 1;
    }
    if (!totalInstallments || totalInstallments < 2) {
      currentInstallment = null;
      totalInstallments = null;
    }

    const boletoSubType: 'fixa' | 'mensal' | 'variavel' =
      totalInstallments && blockId === 'outras'
        ? 'variavel'
        : raw.boletoSubType === 'fixa' || raw.boletoSubType === 'variavel'
        ? raw.boletoSubType
        : 'mensal';

    const category = (ALLOWED_CATEGORIES as readonly string[]).includes(String(raw.category))
      ? String(raw.category)
      : 'Outros & Jurídico';
    const person =
      raw.person === 'Rodolfo' || raw.person === 'Viviane' ? raw.person : 'Família';

    const blockObj = blocks.find((b) => b.id === blockId);
    const destinationLabel =
      transactionType === 'income'
        ? `Visão Geral → Entradas da Família (${person})`
        : action === 'mark_existing_paid' && matchedExpense
        ? `Baixa automática na conta existente: "${matchedExpense.description}" (Pago)`
        : blockId !== 'outras' && blockObj
        ? `Cartões e Contas → ${blockObj.shortName}`
        : boletoSubType === 'fixa'
        ? 'Boletos e Fixas → Despesas Fixas'
        : boletoSubType === 'variavel'
        ? 'Boletos e Fixas → Despesas Variáveis'
        : 'Boletos e Fixas → Gastos Mensais';

    const transcript =
      typeof raw.transcript === 'string' && raw.transcript.trim()
        ? raw.transcript.trim().slice(0, 220)
        : null;

    return res.status(200).json({
      ok: true,
      parsed: {
        transactionType,
        action,
        matchedExistingExpenseId: matchedExpense ? matchedExpense.id : null,
        matchedExistingDescription: matchedExpense ? matchedExpense.description : null,
        description: String(
          matchedExpense ? matchedExpense.description : raw.description || 'Pagamento via PIX'
        ).slice(0, 75),
        amount,
        date:
          typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
            ? raw.date
            : extractDueDateFromText(text, activeMonthKey, todayIso),
        status: isPending ? 'Pendente' : 'Pago',
        blockId,
        boletoSubType,
        category,
        currentInstallment,
        totalInstallments,
        person,
        transcript,
        confidenceNote: String(
          raw.confidenceNote ||
            (transcript
              ? `Áudio transcrito: "${transcript}"`
              : 'Lançamento identificado automaticamente.')
        ),
        destinationLabel,
      },
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Erro ao interpretar o comprovante, áudio ou mensagem.';
    return res.status(500).json({ error: msg });
  }
}
