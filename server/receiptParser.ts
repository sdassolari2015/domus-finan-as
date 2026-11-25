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

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no servidor. Verifique em Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
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

  const systemInstruction = `Você é o classificador financeiro automático do aplicativo Domus Finanças (controle financeiro familiar de Rodolfo e Viviane).
Sua tarefa é analisar um comprovante de PIX (imagem ou PDF) e/ou uma mensagem curta de WhatsApp descrevendo uma saída (gasto/pagamento) ou entrada (receita/recebimento) e retornar exatamente os dados estruturados para lançar na planilha no local exato.

Regras de classificação:
1. TIPO (transactionType):
   - "income": quando o comprovante/mensagem indica dinheiro RECEBIDO (ex: "Pix recebido", "Recebi", "Salário", "Depósito", "Entrada", "Transferência recebida", "Freela", "Extra").
   - "expense": quando indica dinheiro PAGO/GASTO (ex: "Pix enviado", "Comprovante de transferência/pagamento", "Paguei", "Gastei", "Comprei", "Boleto", "Fatura").

2. BAIXA EM CONTA EXISTENTE (action = "mark_existing_paid"):
   - Compare o comprovante/mensagem com a lista de contas PENDENTES já cadastradas no mês.
   - Se o valor e o destinatário/descrição corresponderem claramente a uma conta pendente já cadastrada (por exemplo, comprovante de pagamento da conta de Luz, Água, Internet, Escola, Consórcio ou parcela existente com valor igual ou muito próximo), defina action = "mark_existing_paid" e informe o ID exato em matchedExistingExpenseId.
   - Caso seja um gasto novo do dia a dia ou não haja correspondência clara, defina action = "create" e matchedExistingExpenseId = "".

3. BLOCO / LOCAL EXATO (blockId e boletoSubType) para despesas:
   - Se a mensagem ou comprovante mencionar explicitamente um cartão ou conta da lista disponível (ex: "NuBank", "Bradesco", "Santander", "Caixa", "Sicredi", "Quero Quero", etc.), use o "id" correspondente da lista de blocos disponíveis.
   - Se for pagamento via PIX avulso, boleto, débito ou gasto comum sem cartão específico, use blockId = "outras" e escolha o subtipo exato em boletoSubType:
     * "fixa": contas mensais recorrentes que nunca acabam (luz, energia, água, internet, celular, condomínio, aluguel, streaming, plano de saúde, escola mensal).
     * "variavel": parcelamentos (ex: 3/12), consórcios, empréstimos, financiamentos, boletos parcelados.
     * "mensal": gastos avulsos durante o mês (mercado, padaria, farmácia, gasolina, restaurante, feira, pix do dia a dia, compras à vista).

4. STATUS:
   - Se for um comprovante de PIX já efetivado ou mensagem no passado ("paguei", "fiz pix", "comprei"), status = "Pago".
   - Se for uma conta futura/agendada ("boleto vence dia 20", "a pagar"), status = "Pendente".

5. CATEGORIA:
   - Escolha ESTRITAMENTE uma das categorias permitidas: ${ALLOWED_CATEGORIES.join(' | ')}.

6. PESSOA (para entradas):
   - Escolha "Rodolfo", "Viviane" ou "Família". Se a mensagem não especificar e houver um remetente padrão, use-o ou "Família".

7. DATA:
   - Use formato YYYY-MM-DD. Se o comprovante mostrar a data do pagamento, extraia essa data. Se a mensagem não citar data, use ${todayIso}.

8. VALOR:
   - Retorne apenas o número positivo em reais (ex: 185.50). Se não houver valor legível, retorne 0.

9. DESCRIÇÃO:
   - Crie uma descrição limpa, curta e clara em português (ex: "PIX Mercado Atacadão", "Conta de Luz - Energisa", "Salário Extra Rodolfo"). Máximo 70 caracteres.`;

  const contextLines = [
    `Data de hoje: ${todayIso}`,
    `Mês ativo na planilha: ${activeMonthKey}`,
    `Usuário logado/remetente padrão: ${params.defaultPerson || 'Família'}`,
    `Blocos disponíveis na planilha: ${JSON.stringify(blocks.map((b) => ({ id: b.id, nome: b.shortName, titulo: b.fullTitle })))}`,
    `Contas PENDENTES já existentes neste mês (para possível baixa automática): ${JSON.stringify(
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
    params.text?.trim()
      ? `Mensagem enviada pelo usuário: "${params.text.trim().slice(0, 1500)}"`
      : 'O usuário enviou um comprovante sem texto adicional. Extraia todos os dados da imagem/documento.',
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

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          transactionType: {
            type: Type.STRING,
            description: 'Must be "expense" or "income"',
          },
          action: {
            type: Type.STRING,
            description: 'Must be "create" or "mark_existing_paid"',
          },
          matchedExistingExpenseId: {
            type: Type.STRING,
            description: 'Exact ID from existing pending expenses if action is mark_existing_paid, otherwise empty string',
          },
          description: {
            type: Type.STRING,
            description: 'Short clear Portuguese description of the transaction (max 70 chars)',
          },
          amount: {
            type: Type.NUMBER,
            description: 'Positive numeric value in BRL',
          },
          date: {
            type: Type.STRING,
            description: 'Transaction or due date in YYYY-MM-DD format',
          },
          status: {
            type: Type.STRING,
            description: 'Must be "Pago" or "Pendente"',
          },
          blockId: {
            type: Type.STRING,
            description: 'Exact id from the available blocks list, or "outras"',
          },
          boletoSubType: {
            type: Type.STRING,
            description: 'Must be "fixa", "mensal", or "variavel"',
          },
          category: {
            type: Type.STRING,
            description: 'Exact category from the allowed list',
          },
          currentInstallment: {
            type: Type.INTEGER,
            description: 'Current installment number if installment purchase, otherwise 0',
          },
          totalInstallments: {
            type: Type.INTEGER,
            description: 'Total installments if installment purchase, otherwise 0',
          },
          person: {
            type: Type.STRING,
            description: 'Must be "Rodolfo", "Viviane", or "Família"',
          },
          confidenceNote: {
            type: Type.STRING,
            description: 'One short sentence in Portuguese explaining how the receipt/message was read and classified',
          },
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

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Não foi possível extrair os dados do comprovante ou mensagem.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('A resposta de leitura do comprovante veio em formato inesperado.');
  }

  const validBlockIds = new Set(blocks.map((b) => b.id));
  const transactionType: 'expense' | 'income' =
    parsed.transactionType === 'income' ? 'income' : 'expense';

  const rawMatchedId =
    typeof parsed.matchedExistingExpenseId === 'string'
      ? parsed.matchedExistingExpenseId.trim()
      : '';
  const matchedExpense =
    transactionType === 'expense' && rawMatchedId
      ? existingExpenses.find((e) => e.id === rawMatchedId && e.status === 'Pendente') || null
      : null;

  const action: 'create' | 'mark_existing_paid' =
    matchedExpense && parsed.action === 'mark_existing_paid'
      ? 'mark_existing_paid'
      : 'create';

  const rawBlockId = typeof parsed.blockId === 'string' ? parsed.blockId.trim() : 'outras';
  const blockId = validBlockIds.has(rawBlockId) ? rawBlockId : 'outras';

  const boletoSubType: 'fixa' | 'mensal' | 'variavel' =
    parsed.boletoSubType === 'fixa' ||
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

  const amountNum = Number(parsed.amount);
  const safeAmount = Number.isFinite(amountNum) && amountNum > 0 ? Math.round(amountNum * 100) / 100 : 0;

  const currInstNum = Number(parsed.currentInstallment);
  const totInstNum = Number(parsed.totalInstallments);
  const hasInstallments =
    Number.isInteger(currInstNum) &&
    Number.isInteger(totInstNum) &&
    currInstNum > 0 &&
    totInstNum > 0 &&
    currInstNum <= totInstNum;

  const baseResult: Omit<ParsedReceiptResult, 'destinationLabel'> = {
    transactionType,
    action,
    matchedExistingExpenseId: matchedExpense ? matchedExpense.id : null,
    matchedExistingDescription: matchedExpense ? matchedExpense.description : null,
    description:
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim().slice(0, 75)
        : transactionType === 'income'
        ? 'Entrada via PIX'
        : 'Pagamento via PIX',
    amount: safeAmount,
    date: sanitizeDate(parsed.date, activeMonthKey),
    status: parsed.status === 'Pendente' ? 'Pendente' : 'Pago',
    blockId: matchedExpense ? matchedExpense.blockId : blockId,
    boletoSubType: hasInstallments ? 'variavel' : boletoSubType,
    category,
    currentInstallment: hasInstallments ? currInstNum : null,
    totalInstallments: hasInstallments ? totInstNum : null,
    person,
    confidenceNote:
      typeof parsed.confidenceNote === 'string' && parsed.confidenceNote.trim()
        ? parsed.confidenceNote.trim().slice(0, 220)
        : 'Lançamento identificado automaticamente.',
  };

  return {
    ...baseResult,
    destinationLabel: buildDestinationLabel(baseResult, blocks),
  };
}
