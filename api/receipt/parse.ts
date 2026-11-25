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

const DEFAULT_BLOCKS = [
  { id: 'bradesco', shortName: 'Bradesco', fullTitle: 'Cartão Bradesco - Débito em Conta', group: 'cartao_conta' },
  { id: 'santander', shortName: 'Santander', fullTitle: 'Cartão Santander - Débito em Conta', group: 'cartao_conta' },
  { id: 'caixa', shortName: 'Caixa', fullTitle: 'Conta Caixa - Débito em Conta', group: 'cartao_conta' },
  { id: 'quero_quero', shortName: 'Quero Quero', fullTitle: 'Cartão Quero Quero - Direto na Loja', group: 'cartao_conta' },
  { id: 'nubank', shortName: 'NuBank', fullTitle: 'Cartão NuBank - Débito em Conta', group: 'cartao_conta' },
  { id: 'sicredi', shortName: 'Sicredi', fullTitle: 'Cartão Sicredi Viviane - Débito em Conta', group: 'cartao_conta' },
  { id: 'outras', shortName: 'Boletos e Fixas', fullTitle: 'Outras Despesas - Boletos e Fixas', group: 'boletos_pix' },
];

export default async function handler(
  req: { method?: string; body?: Record<string, unknown> },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Configure GEMINI_API_KEY nas Variáveis de Ambiente da Vercel.',
      });
    }

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

    const blocks =
      Array.isArray(body.blocks) && body.blocks.length > 0
        ? body.blocks.slice(0, 30).map((b: Record<string, unknown>) => ({
            id: String(b?.id ?? '').slice(0, 50),
            shortName: String(b?.shortName ?? '').slice(0, 50),
            fullTitle: String(b?.fullTitle ?? '').slice(0, 90),
            group: b?.group === 'boletos_pix' ? 'boletos_pix' : 'cartao_conta',
          }))
        : DEFAULT_BLOCKS;

    const existingExpenses = Array.isArray(body.existingExpenses)
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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
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

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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

    const raw = JSON.parse((response.text ?? '{}').trim());
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
        confidenceNote: String(raw.confidenceNote || 'Lançamento identificado automaticamente.'),
        destinationLabel,
      },
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Erro ao interpretar o comprovante ou mensagem.';
    return res.status(500).json({ error: msg });
  }
}
