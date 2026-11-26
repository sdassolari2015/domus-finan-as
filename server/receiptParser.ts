import { GoogleGenAI, Type } from '@google/genai';

export interface ParserBlockOption {
  id: string;
  shortName: string;
  fullTitle: string;
  group: 'cartao_conta' | 'boletos_pix';
}

export interface ParserExistingExpense {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'Pendente' | 'Pago';
  blockId: string;
  category: string;
}

export interface ParsedReceiptResult {
  transactionType: 'expense' | 'income';
  action: 'create' | 'mark_existing_paid';
  matchedExistingExpenseId: string | null;
  matchedExistingDescription: string | null;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
  status: 'Pago' | 'Pendente';
  // Expense fields
  blockId: string;
  boletoSubType: 'fixa' | 'mensal' | 'variavel';
  category: string;
  currentInstallment: number | null;
  totalInstallments: number | null;
  // Income fields
  person: 'Rodolfo' | 'Viviane' | 'Família';
  // Optional audio transcription
  transcript?: string | null;
  // Explanation shown to user
  confidenceNote: string;
  destinationLabel: string;
}

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

const DEFAULT_BLOCKS: ParserBlockOption[] = [
  { id: 'bradesco', shortName: 'Bradesco', fullTitle: 'Cartão Bradesco - Débito em Conta', group: 'cartao_conta' },
  { id: 'santander', shortName: 'Santander', fullTitle: 'Cartão Santander - Débito em Conta', group: 'cartao_conta' },
  { id: 'caixa', shortName: 'Caixa', fullTitle: 'Conta Caixa - Débito em Conta', group: 'cartao_conta' },
  { id: 'quero_quero', shortName: 'Quero Quero', fullTitle: 'Cartão Quero Quero - Direto na Loja', group: 'cartao_conta' },
  { id: 'nubank', shortName: 'NuBank', fullTitle: 'Cartão NuBank - Débito em Conta', group: 'cartao_conta' },
  { id: 'sicredi', shortName: 'Sicredi', fullTitle: 'Cartão Sicredi Viviane - Débito em Conta', group: 'cartao_conta' },
  { id: 'outras', shortName: 'Boletos e Fixas', fullTitle: 'Outras Despesas - Boletos e Fixas', group: 'boletos_pix' },
];

const MODEL_CHAIN = [
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

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no servidor. Verifique em Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      apiVersion: 'v1beta',
      timeout: 18000,
      retryOptions: { attempts: 1 },
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sanitizeDate(raw: unknown, fallbackMonthKey?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return raw.trim();
  }
  if (fallbackMonthKey && /^\d{4}-\d{2}$/.test(fallbackMonthKey)) {
    const day = new Date().toISOString().slice(8, 10);
    return `${fallbackMonthKey}-${day}`;
  }
  return today;
}

function buildDestinationLabel(
  result: Omit<ParsedReceiptResult, 'destinationLabel'>,
  blocks: ParserBlockOption[]
): string {
  if (result.transactionType === 'income') {
    return `Visão Geral → Entradas da Família (${result.person})`;
  }
  if (result.action === 'mark_existing_paid' && result.matchedExistingDescription) {
    return `Baixa automática na conta existente: "${result.matchedExistingDescription}" (Pago)`;
  }
  const block = blocks.find((b) => b.id === result.blockId);
  if (result.blockId !== 'outras' && block) {
    return `Cartões e Contas → ${block.shortName}`;
  }
  if (result.boletoSubType === 'fixa') {
    return 'Boletos e Fixas → Despesas Fixas';
  }
  if (result.boletoSubType === 'variavel') {
    return 'Boletos e Fixas → Despesas Variáveis';
  }
  return 'Boletos e Fixas → Gastos Mensais';
}

export async function parseFinancialReceiptOrMessage(params: {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  blocks?: ParserBlockOption[];
  existingExpenses?: ParserExistingExpense[];
  activeMonthKey?: string;
  defaultPerson?: string;
}): Promise<ParsedReceiptResult> {
  const ai = getGeminiClient();

  const blocks =
    Array.isArray(params.blocks) && params.blocks.length > 0
      ? params.blocks.slice(0, 30)
      : DEFAULT_BLOCKS;

  const existingExpenses = Array.isArray(params.existingExpenses)
    ? params.existingExpenses.slice(0, 120)
    : [];

  const todayIso = new Date().toISOString().slice(0, 10);
  const activeMonthKey =
    typeof params.activeMonthKey === 'string' && /^\d{4}-\d{2}$/.test(params.activeMonthKey)
      ? params.activeMonthKey
      : todayIso.slice(0, 7);

  let effectiveText = params.text?.trim() || '';
  const isAudio = Boolean(params.imageBase64 && params.imageMimeType?.startsWith('audio/'));

  const systemInstruction = `Você é o classificador financeiro automático do aplicativo Domus Finanças (controle financeiro familiar de Rodolfo e Viviane).
Sua tarefa é analisar um comprovante de PIX (incluindo comprovantes VERTICAIS/COMPRIDOS do Santander, Sicredi, Bradesco, Nubank, Itaú), PDF bancário, áudio falado em português ou mensagem curta de WhatsApp e retornar os dados estruturados exatos.

REGRAS CRÍTICAS:
1. TIPO (transactionType):
   - "income": dinheiro RECEBIDO ("Pix recebido", "Recebi", "Salário", "Depósito", "Entrada", "Freela", "Extra").
   - "expense": dinheiro PAGO/GASTO/A PAGAR ("Pix enviado", "Comprovante de pagamento", "Paguei", "Gastei", "Comprei", "Boleto", "Fatura", "Pendente").

2. LEITURA COMPLETA DE COMPROVANTES COMPRIDOS (ex: Santander):
   - Leia a imagem INTEIRA do topo ao rodapé para pegar valor (R$), destinatário ("Para: ..."), pagador ("De: ...") e data.

3. DIFERENCIAÇÃO ESTRITA ENTRE PIX E CARTÃO DE CRÉDITO (paymentMethod e blockId):
   - Se for um comprovante de PIX (mesmo emitido pelo banco Sicredi, Santander, Bradesco, Nubank ou Caixa), defina paymentMethod = "pix" e blockId = "outras" (Boletos e Fixas).
   - NUNCA coloque um PIX no bloco de Cartão de Crédito só porque o nome do banco aparece no comprovante!
   - SÓ defina paymentMethod = "credit_card" e o blockId do cartão (sicredi, nubank, bradesco, santander, quero_quero, caixa) se aparecer EXPLICITAMENTE: "compra crédito", "crédito à vista", "crédito parcelado", "cartão de crédito", "no cartão", "no crédito", "fatura", "Mastercard", "Visa", "Elo" ou "Quero Quero".

4. CONTA FIXA EXISTENTE vs GASTO AVULSO DO MÊS (action):
   - Só use action = "mark_existing_paid" quando o destinatário/empresa E o valor corresponderem claramente a uma conta PENDENTE já cadastrada (ex: PIX para Fit Energia no valor parecido com a conta Fit Energia).
   - Se o PIX for para OUTRA empresa ou OUTRO valor (ex: PIX para COPEL / COPELDIS com legenda "Luz", enquanto a conta fixa cadastrada é "Fit Energia" de outro valor), NÃO dê baixa na conta fixa! Use action = "create", blockId = "outras", boletoSubType = "mensal", status = "Pago" e descrição limpa como "Luz - COPELDIS".

5. CONTAS PENDENTES E PARCELADAS:
   - Se for conta pendente/a vencer ("pendente", "a pagar", "vence dia 15", "para dia 20/12"), defina status = "Pendente" e extraia a data de vencimento em date (YYYY-MM-DD).
   - Se mencionar parcelamento ("em 5x de 120", "parcela 2/10", "parcelado em 6 vezes", "600 em 3x"), preencha currentInstallment e totalInstallments (se disser "600 em 3x", amount = 200). Em blockId = "outras", contas parceladas usam boletoSubType = "variavel".

6. ÁUDIO:
   - Se houver áudio, transcreva-o em "transcript" e extraia todos os campos financeiros.

7. CATEGORIA:
   - Escolha ESTRITAMENTE uma das categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.

8. DESCRIÇÃO:
   - Curta, limpa e clara em português (máx. 70 chars), sem repetir palavras e sem colocar o valor na descrição.`;

  const contextLines = [
    `Data de hoje: ${todayIso}`,
    `Mês ativo na planilha: ${activeMonthKey}`,
    `Usuário logado/remetente padrão: ${params.defaultPerson || 'Família'}`,
    `Blocos disponíveis na planilha: ${JSON.stringify(blocks.map((b) => ({ id: b.id, nome: b.shortName, titulo: b.fullTitle })))}`,
    `Contas PENDENTES já existentes neste mês: ${JSON.stringify(
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
      ? `Mensagem/Legenda enviada pelo usuário: "${effectiveText.slice(0, 1500)}"`
      : isAudio
      ? 'O usuário enviou um áudio em português. Transcreva em transcript e extraia todos os dados financeiros.'
      : 'O usuário enviou um comprovante sem texto adicional. Extraia todos os dados da imagem/documento (do topo ao rodapé).',
  ].join('\n');

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (params.imageBase64 && params.imageMimeType) {
    parts.push({
      inlineData: {
        mimeType: params.imageMimeType,
        data: params.imageBase64,
      },
    });
  }

  parts.push({ text: contextLines });

  let rawText = '';
  let lastModelErr: unknown;

  for (const modelName of MODEL_CHAIN) {
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
      rawText = (response.text ?? '').trim();
      if (rawText) break;
    } catch (err) {
      lastModelErr = err;
    }
  }

  // Dedicated audio transcription fallback
  if (!rawText && isAudio && params.imageBase64 && params.imageMimeType) {
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
      }
    } catch (err) {
      lastModelErr = err;
    }
  }

  let parsed: Record<string, unknown>;
  if (rawText) {
    try {
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      parsed = JSON.parse(
        firstBrace !== -1 && lastBrace > firstBrace
          ? rawText.slice(firstBrace, lastBrace + 1)
          : rawText
      );
    } catch {
      throw new Error('A resposta de leitura do comprovante veio em formato inesperado.');
    }
  } else if (effectiveText) {
    const norm = normalizeText(effectiveText);
    const inst = extractInstallmentsFromText(effectiveText);
    const cleaned = effectiveText
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b(?:dia|vence(?:\s+dia)?|vencimento(?:\s+dia)?|para\s+dia)\s+\d{1,2}\b/gi, ' ')
      .replace(/\b(\d{1,2})\s*(?:x|vezes)\b/gi, ' ');
    const brlMatches = cleaned.match(
      /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+\.\d{2}|\b\d+(?:\b|$))/gi
    );
    let extractedAmount = 0;
    if (brlMatches) {
      for (const token of brlMatches) {
        const numStr = token.replace(/r\$\s*/i, '').trim();
        const val = numStr.includes(',')
          ? Number(numStr.replace(/\./g, '').replace(',', '.'))
          : Number(numStr);
        if (Number.isFinite(val) && val > 0 && val < 1000000) {
          extractedAmount = Math.round(val * 100) / 100;
          break;
        }
      }
    }
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
      /\b(recebi|recebido|entrada|salario|pro-labore|pro labore|ganhei|depilacao|azilo|freela|renda)\b/.test(
        norm
      );
    const isPending = /\b(pendente|vence|vencimento|agendado|a pagar|falta pagar)\b/.test(norm);
    const isCredit = hasExplicitCreditCardSignal(effectiveText);
    const isPix = hasPixPaymentSignal(effectiveText);
    let fallbackBlock = 'outras';
    if (isCredit && !isPix) {
      for (const blk of blocks) {
        if (blk.id === 'outras') continue;
        const blkNorm = normalizeText(blk.shortName);
        if ((blkNorm && norm.includes(blkNorm)) || norm.includes(blk.id.replace('_', ' '))) {
          fallbackBlock = blk.id;
          break;
        }
      }
    }
    parsed = {
      transactionType: isIncome ? 'income' : 'expense',
      paymentMethod: isCredit ? 'credit_card' : isPix ? 'pix' : 'debit_cash',
      action: 'create',
      matchedExistingExpenseId: '',
      description: effectiveText.slice(0, 70),
      amount: extractedAmount,
      date: extractDueDateFromText(effectiveText, activeMonthKey, todayIso),
      status: isPending ? 'Pendente' : 'Pago',
      blockId: fallbackBlock,
      boletoSubType: inst.totalInstallments ? 'variavel' : 'mensal',
      category: fallbackBlock !== 'outras' ? 'Financeiro & Cartões' : 'Outros & Jurídico',
      currentInstallment: inst.currentInstallment ?? 0,
      totalInstallments: inst.totalInstallments ?? 0,
      person: params.defaultPerson || 'Família',
      transcript: isAudio ? effectiveText : '',
      confidenceNote: 'Classificado automaticamente pelo motor financeiro do Domus.',
    };
  } else {
    throw lastModelErr instanceof Error
      ? lastModelErr
      : new Error('Não foi possível extrair os dados do comprovante, áudio ou mensagem.');
  }

  const validBlockIds = new Set(blocks.map((b) => b.id));
  const transactionType: 'expense' | 'income' =
    parsed.transactionType === 'income' ? 'income' : 'expense';
  const isPending = parsed.status === 'Pendente';

  const rawMatchedId =
    typeof parsed.matchedExistingExpenseId === 'string'
      ? parsed.matchedExistingExpenseId.trim()
      : '';
  let matchedExpense =
    transactionType === 'expense' && !isPending && rawMatchedId
      ? existingExpenses.find((e) => e.id === rawMatchedId && e.status === 'Pendente') || null
      : null;

  const amountNum = Number(parsed.amount);
  const safeAmount =
    Number.isFinite(amountNum) && amountNum > 0
      ? Math.round(amountNum * 100) / 100
      : matchedExpense && matchedExpense.amount > 0
      ? matchedExpense.amount
      : 0;

  // Reject mismatched fixed bill match (e.g. COPEL vs Fit Energia)
  if (matchedExpense && safeAmount > 0 && matchedExpense.amount > 0) {
    const diff = Math.abs(matchedExpense.amount - safeAmount);
    const pct = diff / Math.max(matchedExpense.amount, safeAmount);
    if (diff > 15 && pct > 0.2) {
      matchedExpense = null;
    }
  }

  const action: 'create' | 'mark_existing_paid' =
    matchedExpense && parsed.action === 'mark_existing_paid'
      ? 'mark_existing_paid'
      : 'create';

  const rawBlockId = typeof parsed.blockId === 'string' ? parsed.blockId.trim() : 'outras';
  let blockId = validBlockIds.has(rawBlockId) ? rawBlockId : 'outras';

  const combinedText = `${effectiveText} ${String(parsed.transcript || '')} ${String(parsed.description || '')} ${String(parsed.confidenceNote || '')}`;
  const paymentMethod = String(parsed.paymentMethod || '').toLowerCase();
  const explicitCredit =
    paymentMethod === 'credit_card' || hasExplicitCreditCardSignal(combinedText);
  const isPix = paymentMethod === 'pix' || hasPixPaymentSignal(combinedText);

  if (!matchedExpense && blockId !== 'outras' && (isPix || !explicitCredit)) {
    blockId = 'outras';
  }

  const fallbackInst = extractInstallmentsFromText(`${effectiveText} ${String(parsed.transcript || '')}`);
  const currInstNum = Number(parsed.currentInstallment);
  const totInstNum = Number(parsed.totalInstallments);
  let currentInstallment =
    Number.isInteger(currInstNum) && currInstNum >= 1
      ? currInstNum
      : fallbackInst.currentInstallment;
  let totalInstallments =
    Number.isInteger(totInstNum) && totInstNum >= 2
      ? totInstNum
      : fallbackInst.totalInstallments;
  if (totalInstallments && (!currentInstallment || currentInstallment > totalInstallments)) {
    currentInstallment = 1;
  }
  if (!totalInstallments || totalInstallments < 2) {
    currentInstallment = null;
    totalInstallments = null;
  }

  const hasInstallments = Boolean(currentInstallment && totalInstallments);

  const boletoSubType: 'fixa' | 'mensal' | 'variavel' =
    hasInstallments && blockId === 'outras'
      ? 'variavel'
      : parsed.boletoSubType === 'fixa' ||
        parsed.boletoSubType === 'mensal' ||
        parsed.boletoSubType === 'variavel'
      ? parsed.boletoSubType
      : 'mensal';

  const rawCategory = typeof parsed.category === 'string' ? parsed.category.trim() : '';
  const category = (ALLOWED_CATEGORIES as readonly string[]).includes(rawCategory)
    ? rawCategory
    : 'Outros & Jurídico';

  const person: 'Rodolfo' | 'Viviane' | 'Família' =
    parsed.person === 'Rodolfo' || parsed.person === 'Viviane' || parsed.person === 'Família'
      ? parsed.person
      : params.defaultPerson === 'Rodolfo' || params.defaultPerson === 'Viviane'
      ? params.defaultPerson
      : 'Família';

  const transcript =
    typeof parsed.transcript === 'string' && parsed.transcript.trim()
      ? parsed.transcript.trim().slice(0, 220)
      : null;

  const baseResult: Omit<ParsedReceiptResult, 'destinationLabel'> = {
    transactionType,
    action,
    matchedExistingExpenseId: matchedExpense ? matchedExpense.id : null,
    matchedExistingDescription: matchedExpense ? matchedExpense.description : null,
    description:
      matchedExpense
        ? matchedExpense.description
        : typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim().slice(0, 75)
        : transactionType === 'income'
        ? 'Entrada via PIX'
        : 'Pagamento via PIX',
    amount: safeAmount,
    date: sanitizeDate(parsed.date, activeMonthKey),
    status: isPending ? 'Pendente' : 'Pago',
    blockId: matchedExpense ? matchedExpense.blockId : blockId,
    boletoSubType,
    category,
    currentInstallment,
    totalInstallments,
    person,
    transcript,
    confidenceNote:
      typeof parsed.confidenceNote === 'string' && parsed.confidenceNote.trim()
        ? parsed.confidenceNote.trim().slice(0, 220)
        : transcript
        ? `Áudio transcrito: "${transcript}"`
        : 'Lançamento identificado automaticamente.',
  };

  return {
    ...baseResult,
    destinationLabel: buildDestinationLabel(baseResult, blocks),
  };
}
