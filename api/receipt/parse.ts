import { GoogleGenAI, Type } from '@google/genai';

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
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
];

function normalizeText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
    params.defaultPerson === 'Rodolfo' || params.defaultPerson === 'Viviane'
      ? params.defaultPerson
      : 'Família';
  if (/\b(viviane|vivi|azilo|depilacao|sicredi)\b/.test(norm)) {
    person = 'Viviane';
  } else if (/\b(rodolfo|pm|marcenaria)\b/.test(norm)) {
    person = 'Rodolfo';
  }

  // Try matching an existing pending expense
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
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    let imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    let imageMimeType =
      typeof body.imageMimeType === 'string'
        ? body.imageMimeType.toLowerCase().split(';')[0].trim()
        : '';

    if (!text && !imageBase64) {
      return res.status(400).json({
        error: 'Envie um comprovante PIX (imagem ou PDF) ou escreva uma mensagem.',
      });
    }

    if (imageBase64) {
      const dataUriMatch = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (dataUriMatch) {
        imageMimeType = dataUriMatch[1].toLowerCase().trim();
        imageBase64 = dataUriMatch[2];
      }
      if (imageMimeType === 'image/jpg') {
        imageMimeType = 'image/jpeg';
      }
      if (!ALLOWED_MEDIA_MIME_TYPES.has(imageMimeType)) {
        return res.status(400).json({
          error: 'Formato de arquivo não suportado. Use PNG, JPG, WEBP ou PDF.',
        });
      }
    }

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
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (imageBase64 && imageMimeType) {
        parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
      }
      parts.push({
        text: [
          `Data de hoje: ${todayIso}`,
          `Mês ativo: ${activeMonthKey}`,
          `Usuário padrão: ${defaultPerson}`,
          `Blocos disponíveis: ${JSON.stringify(blocks)}`,
          `Contas PENDENTES existentes: ${JSON.stringify(existingExpenses.filter((e) => e.status === 'Pendente'))}`,
          text ? `Mensagem: "${text}"` : 'Extraia os dados do comprovante PIX.',
        ].join('\n'),
      });

      for (const modelName of MODEL_FALLBACK_CHAIN) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: { parts },
            config: {
              systemInstruction: `Você é o classificador financeiro do Domus Finanças (Rodolfo e Viviane). Analise o comprovante PIX ou mensagem e classifique no local exato. Categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.`,
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
                  currentInstallment: { type: Type.INTEGER },
                  totalInstallments: { type: Type.INTEGER },
                  person: { type: Type.STRING },
                  confidenceNote: { type: Type.STRING },
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

      if (!raw) {
        for (const modelName of MODEL_FALLBACK_CHAIN) {
          try {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: {
                parts: [
                  ...parts,
                  {
                    text: 'Responda APENAS um JSON válido com as chaves: {"transactionType":"expense","action":"create","matchedExistingExpenseId":"","description":"Favorecido","amount":0.00,"date":"YYYY-MM-DD","status":"Pago","blockId":"outras","boletoSubType":"mensal","category":"Outros & Jurídico","person":"Rodolfo","confidenceNote":"OK"}',
                  },
                ],
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
          'Não foi possível ler a imagem agora. Digite o valor junto com o envio (ex: "Paguei 150,00 mercado").'
        )
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
      raw.person === 'Rodolfo' || raw.person === 'Viviane' ? raw.person : 'Família';
    const amountNum = Number(raw.amount);
    const amount =
      Number.isFinite(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) / 100 : 0;

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

    return res.status(200).json({
      ok: true,
      parsed: {
        transactionType,
        action,
        matchedExistingExpenseId: matchedExpense ? matchedExpense.id : null,
        matchedExistingDescription: matchedExpense ? matchedExpense.description : null,
        description: String(raw.description || 'Pagamento via PIX').slice(0, 75),
        amount,
        date:
          typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
            ? raw.date
            : todayIso,
        status: raw.status === 'Pendente' ? 'Pendente' : 'Pago',
        blockId,
        boletoSubType,
        category,
        currentInstallment: null,
        totalInstallments: null,
        person,
        confidenceNote: String(
          raw.confidenceNote || 'Lançamento identificado automaticamente.'
        ),
        destinationLabel,
      },
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Erro ao interpretar o comprovante ou mensagem.';
    return res.status(500).json({ error: msg });
  }
}
