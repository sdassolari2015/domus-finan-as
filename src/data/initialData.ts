import {
  AccountBlockMeta,
  BoletoSubType,
  ExpenseCategory,
  MonthLedger,
  ExpenseItem,
} from '../types/finance';
import { formatInstallment } from '../utils/formatters';

export const ACCOUNT_BLOCKS: AccountBlockMeta[] = [
  {
    id: 'bradesco',
    shortName: 'Bradesco',
    fullTitle: 'Cartão Bradesco - Débito em Conta',
    paymentMethod: 'Débito em Conta',
    owner: 'Família',
    accentColor: '#DC2626',
    group: 'cartao_conta',
    kind: 'cartao',
  },
  {
    id: 'santander',
    shortName: 'Santander',
    fullTitle: 'Cartão Santander - Débito em Conta',
    paymentMethod: 'Débito em Conta',
    owner: 'Família',
    accentColor: '#EA580C',
    group: 'cartao_conta',
    kind: 'cartao',
  },
  {
    id: 'caixa',
    shortName: 'Caixa',
    fullTitle: 'Conta Caixa - Débito em Conta',
    paymentMethod: 'Débito em Conta',
    owner: 'Família',
    accentColor: '#2563EB',
    group: 'cartao_conta',
    kind: 'conta',
  },
  {
    id: 'quero_quero',
    shortName: 'Quero Quero',
    fullTitle: 'Cartão Quero Quero - Direto na Loja',
    paymentMethod: 'Direto na Loja',
    owner: 'Família',
    accentColor: '#16A34A',
    group: 'cartao_conta',
    kind: 'cartao',
  },
  {
    id: 'nubank',
    shortName: 'NuBank',
    fullTitle: 'Cartão NuBank - Débito em Conta',
    paymentMethod: 'Débito em Conta',
    owner: 'Família',
    accentColor: '#7C3AED',
    group: 'cartao_conta',
    kind: 'cartao',
  },
  {
    id: 'sicredi',
    shortName: 'Sicredi',
    fullTitle: 'Cartão Sicredi Viviane - Débito em Conta',
    paymentMethod: 'Débito em Conta',
    owner: 'Viviane',
    accentColor: '#059669',
    group: 'cartao_conta',
    kind: 'cartao',
  },
  {
    id: 'outras',
    shortName: 'Boletos e Fixas',
    fullTitle: 'Outras Despesas - Boletos e Fixas',
    paymentMethod: 'Boletos / Pix',
    owner: 'Família',
    accentColor: '#0F172A',
    group: 'boletos_pix',
    kind: 'boletos',
  },
];

export function getEffectiveBlocks(ledger?: MonthLedger | null): AccountBlockMeta[] {
  if (ledger?.customBlocks && Array.isArray(ledger.customBlocks) && ledger.customBlocks.length > 0) {
    const hasOutras = ledger.customBlocks.some((b) => b.id === 'outras');
    if (hasOutras) {
      return ledger.customBlocks;
    }
    return [...ledger.customBlocks, ACCOUNT_BLOCKS[ACCOUNT_BLOCKS.length - 1]];
  }
  return ACCOUNT_BLOCKS;
}

export function getExpenseBoletoSubType(exp: ExpenseItem): BoletoSubType {
  if (
    exp.boletoSubType === 'fixa' ||
    exp.boletoSubType === 'mensal' ||
    exp.boletoSubType === 'variavel'
  ) {
    return exp.boletoSubType;
  }
  const hasInstallments =
    exp.currentInstallment !== null &&
    exp.totalInstallments !== null &&
    exp.totalInstallments > 0;
  if (hasInstallments) {
    return 'variavel';
  }
  if (!exp.isRecurringFixed) {
    return 'variavel';
  }
  return 'fixa';
}

export const EXPENSE_CATEGORIES: {
  name: ExpenseCategory;
  color: string;
  description: string;
}[] = [
  {
    name: 'Consórcios & Patrimônio',
    color: '#1E40AF',
    description: 'Consórcio Virtus, Consórcio Start e formação de patrimônio',
  },
  {
    name: 'Financeiro & Cartões',
    color: '#B91C1C',
    description: 'Giro de cartão, parcelamentos bancários e encargos',
  },
  {
    name: 'Moradia & Financiamento',
    color: '#0369A1',
    description: 'Financiamento habitacional Caixa e manutenção residencial',
  },
  {
    name: 'Transporte & Veículos',
    color: '#D97706',
    description: 'Moto Trilha, manutenção veicular e combustível',
  },
  {
    name: 'Utilidades (Luz & Água)',
    color: '#047857',
    description: 'Fit Energia, Samae (água/esgoto) e serviços essenciais',
  },
  {
    name: 'Lazer & Clube',
    color: '#7C3AED',
    description: 'Clube Candeias, viagens e recreação familiar',
  },
  {
    name: 'Internet & Telefonia',
    color: '#0D9488',
    description: 'Help Telecon, Tim Rodolfo e Tim Viviane',
  },
  {
    name: 'Educação & Filhos',
    color: '#4F46E5',
    description: 'Reforço Lorenzo, Funcional Criança e atividades escolares',
  },
  {
    name: 'Associações & Saúde',
    color: '#BE123C',
    description: 'AAPomil, convênios e bem-estar',
  },
  {
    name: 'Assinaturas & Serviços',
    color: '#475569',
    description: 'Apple, TV P2P e serviços digitais recorrentes',
  },
  {
    name: 'Outros & Jurídico',
    color: '#64748B',
    description: 'Advogados, acordos agendados e despesas do mês',
  },
];

export const INITIAL_OCTOBER_2026: MonthLedger = {
  monthKey: '2026-10',
  label: 'Outubro de 2026',
  year: 2026,
  month: 10,
  customBlocks: ACCOUNT_BLOCKS,
  incomes: [
    {
      id: 'inc-1',
      person: 'Rodolfo',
      description: 'Salário PM',
      amount: 4149.53,
      date: '2026-10-01',
    },
    {
      id: 'inc-2',
      person: 'Rodolfo',
      description: 'Pró-labore Marcenaria',
      amount: 1621.0,
      date: '2026-10-01',
    },
    {
      id: 'inc-3',
      person: 'Viviane',
      description: 'Depilação',
      amount: 1000.0,
      date: '2026-10-01',
    },
    {
      id: 'inc-4',
      person: 'Viviane',
      description: 'Salário Azilo',
      amount: 2480.0,
      date: '2026-10-01',
    },
  ],
  expenses: [
    // Cartão Bradesco - Débito em Conta (Total: R$ 1.508,32)
    {
      id: 'exp-brad-1',
      description: 'Giro Cartão',
      dueDate: '2026-10-02',
      currentInstallment: 9,
      totalInstallments: 9,
      amount: 1055.55,
      status: 'Pendente',
      blockId: 'bradesco',
      category: 'Financeiro & Cartões',
      isRecurringFixed: false,
      notes: 'Última parcela (09/09) — encerra neste mês!',
    },
    {
      id: 'exp-brad-2',
      description: 'Moto Trilha',
      dueDate: '2026-10-02',
      currentInstallment: 18,
      totalInstallments: 18,
      amount: 452.77,
      status: 'Pendente',
      blockId: 'bradesco',
      category: 'Transporte & Veículos',
      isRecurringFixed: false,
      notes: 'Última parcela (18/18) — encerra neste mês!',
    },

    // Conta Caixa - Débito em Conta (Total: R$ 564,89)
    {
      id: 'exp-caixa-1',
      description: 'Fin. Casa',
      dueDate: '2026-10-22',
      currentInstallment: 125,
      totalInstallments: 360,
      amount: 564.89,
      status: 'Pendente',
      blockId: 'caixa',
      category: 'Moradia & Financiamento',
      isRecurringFixed: false,
      notes: 'Financiamento habitacional Caixa',
    },

    // Cartão NuBank - Débito em Conta (Total: R$ 12,50)
    {
      id: 'exp-nubank-1',
      description: 'Apple',
      dueDate: '2026-10-06',
      currentInstallment: null,
      totalInstallments: null,
      amount: 12.5,
      status: 'Pendente',
      blockId: 'nubank',
      category: 'Assinaturas & Serviços',
      isRecurringFixed: true,
    },

    // Outras Despesas - Boletos e Fixas
    {
      id: 'exp-out-1',
      description: 'AAPomil',
      dueDate: '2026-10-01',
      currentInstallment: null,
      totalInstallments: null,
      amount: 65.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Associações & Saúde',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-2',
      description: 'Candeias',
      dueDate: '2026-10-20',
      currentInstallment: 20,
      totalInstallments: 24,
      amount: 264.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Lazer & Clube',
      isRecurringFixed: false,
      boletoSubType: 'variavel',
    },
    {
      id: 'exp-out-3',
      description: 'Consorcio Start',
      dueDate: '2026-10-05',
      currentInstallment: 30,
      totalInstallments: 53,
      amount: 262.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Consórcios & Patrimônio',
      isRecurringFixed: false,
      boletoSubType: 'variavel',
    },
    {
      id: 'exp-out-4',
      description: 'Consorcio Virtus',
      dueDate: '2026-10-28',
      currentInstallment: 13,
      totalInstallments: 47,
      amount: 1403.09,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Consórcios & Patrimônio',
      isRecurringFixed: false,
      boletoSubType: 'variavel',
    },
    {
      id: 'exp-out-5',
      description: 'Fit Energia',
      dueDate: '2026-10-11',
      currentInstallment: null,
      totalInstallments: null,
      amount: 309.74,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Utilidades (Luz & Água)',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-6',
      description: 'Funcional Criança',
      dueDate: '2026-10-10',
      currentInstallment: null,
      totalInstallments: null,
      amount: 100.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Educação & Filhos',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-7',
      description: 'Help Telecon',
      dueDate: '2026-10-10',
      currentInstallment: null,
      totalInstallments: null,
      amount: 99.9,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Internet & Telefonia',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-8',
      description: 'Reforço Lorenzo',
      dueDate: '2026-10-10',
      currentInstallment: null,
      totalInstallments: null,
      amount: 120.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Educação & Filhos',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-9',
      description: "Saldo dev. Adv's 1",
      dueDate: '2026-11-30',
      currentInstallment: null,
      totalInstallments: null,
      amount: 0.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Outros & Jurídico',
      isRecurringFixed: false,
      boletoSubType: 'variavel',
      notes: 'Vencimento programado para 30/11/2026 — valor a definir',
    },
    {
      id: 'exp-out-10',
      description: 'Samae',
      dueDate: '2026-10-10',
      currentInstallment: null,
      totalInstallments: null,
      amount: 133.14,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Utilidades (Luz & Água)',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-11',
      description: 'Tim Rodolfo',
      dueDate: '2026-10-20',
      currentInstallment: null,
      totalInstallments: null,
      amount: 66.99,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Internet & Telefonia',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-12',
      description: 'Tim Viviane',
      dueDate: '2026-10-20',
      currentInstallment: null,
      totalInstallments: null,
      amount: 55.14,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Internet & Telefonia',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
    {
      id: 'exp-out-13',
      description: 'Tv P2P - Maluco',
      dueDate: '2026-10-25',
      currentInstallment: null,
      totalInstallments: null,
      amount: 20.0,
      status: 'Pendente',
      blockId: 'outras',
      category: 'Assinaturas & Serviços',
      isRecurringFixed: true,
      boletoSubType: 'fixa',
    },
  ],
};

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function shiftDateToMonth(isoDate: string, targetYear: number, targetMonth: number): string {
  const parts = isoDate.split('-');
  const originalDay = parts.length === 3 ? parseInt(parts[2], 10) : 1;
  const maxDaysInTarget = new Date(targetYear, targetMonth, 0).getDate();
  const safeDay = Math.min(originalDay, maxDaysInTarget);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

export function generateNextMonthLedger(source: MonthLedger): MonthLedger {
  const nextMonth = source.month === 12 ? 1 : source.month + 1;
  const nextYear = source.month === 12 ? source.year + 1 : source.year;
  const nextMonthKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  const nextLabel = `${MONTH_NAMES_PT[nextMonth - 1]} de ${nextYear}`;

  const effectiveBlocks = getEffectiveBlocks(source);
  const completedInstallmentsFromPrev: MonthLedger['completedInstallmentsFromPrev'] = [];
  const nextExpenses: ExpenseItem[] = [];

  for (const exp of source.expenses) {
    const hasInstallments =
      exp.currentInstallment !== null &&
      exp.totalInstallments !== null &&
      exp.totalInstallments > 0;

    if (hasInstallments) {
      if ((exp.currentInstallment ?? 0) >= (exp.totalInstallments ?? 0)) {
        const blockMeta = effectiveBlocks.find((b) => b.id === exp.blockId);
        completedInstallmentsFromPrev.push({
          description: exp.description,
          amount: exp.amount,
          installmentLabel: formatInstallment(exp.currentInstallment, exp.totalInstallments),
          blockTitle: blockMeta?.shortName || exp.blockId,
        });
        continue; // Parcela encerrada, não vai para o próximo mês!
      }

      const nextInstallment = (exp.currentInstallment ?? 0) + 1;
      nextExpenses.push({
        ...exp,
        id: `${exp.id}-${nextMonthKey}`,
        dueDate: shiftDateToMonth(exp.dueDate, nextYear, nextMonth),
        currentInstallment: nextInstallment,
        status: 'Pendente',
        notes:
          nextInstallment === exp.totalInstallments
            ? `Última parcela (${formatInstallment(nextInstallment, exp.totalInstallments)}) — encerra neste mês!`
            : exp.notes,
      });
    } else {
      // Se for gasto mensal avulso durante o mês e não recorrente, não repete no próximo mês
      if (exp.boletoSubType === 'mensal' && !exp.isRecurringFixed) {
        continue;
      }

      const expParts = exp.dueDate.split('-');
      const expYear = parseInt(expParts[0], 10);
      const expMonth = parseInt(expParts[1], 10);

      const newDueDate =
        expYear === nextYear && expMonth === nextMonth
          ? exp.dueDate
          : shiftDateToMonth(exp.dueDate, nextYear, nextMonth);

      nextExpenses.push({
        ...exp,
        id: `${exp.id}-${nextMonthKey}`,
        dueDate: newDueDate,
        status: 'Pendente',
      });
    }
  }

  const nextIncomes = source.incomes.map((inc) => ({
    ...inc,
    id: `${inc.id}-${nextMonthKey}`,
    date: shiftDateToMonth(inc.date, nextYear, nextMonth),
  }));

  return {
    monthKey: nextMonthKey,
    label: nextLabel,
    year: nextYear,
    month: nextMonth,
    customBlocks: effectiveBlocks,
    incomes: nextIncomes,
    expenses: nextExpenses,
    generatedFrom: source.label,
    completedInstallmentsFromPrev,
  };
}
