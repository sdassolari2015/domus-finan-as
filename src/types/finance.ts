export type AccountBlockId = string;

export type BoletoSubType = 'fixa' | 'mensal' | 'variavel';

export type ExpenseCategory =
  | 'Consórcios & Patrimônio'
  | 'Financeiro & Cartões'
  | 'Moradia & Financiamento'
  | 'Utilidades (Luz & Água)'
  | 'Transporte & Veículos'
  | 'Lazer & Clube'
  | 'Internet & Telefonia'
  | 'Educação & Filhos'
  | 'Associações & Saúde'
  | 'Assinaturas & Serviços'
  | 'Outros & Jurídico';

export type PaymentStatus = 'Pendente' | 'Pago';

export type FamilyMember = 'Rodolfo' | 'Viviane' | 'Família';

export interface IncomeItem {
  id: string;
  person: FamilyMember;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
}

export interface ExpenseItem {
  id: string;
  description: string;
  dueDate: string; // YYYY-MM-DD
  currentInstallment: number | null;
  totalInstallments: number | null;
  amount: number;
  status: PaymentStatus;
  blockId: AccountBlockId;
  category: ExpenseCategory;
  isRecurringFixed: boolean;
  boletoSubType?: BoletoSubType;
  notes?: string;
}

export interface AccountBlockMeta {
  id: AccountBlockId;
  shortName: string;
  fullTitle: string;
  paymentMethod: string;
  owner: string;
  accentColor: string;
  group: 'cartao_conta' | 'boletos_pix';
  kind?: 'cartao' | 'conta' | 'boletos';
}

export interface MonthLedger {
  monthKey: string; // e.g. '2026-10'
  label: string; // e.g. 'Outubro de 2026'
  year: number;
  month: number; // 1-12
  incomes: IncomeItem[];
  expenses: ExpenseItem[];
  customBlocks?: AccountBlockMeta[];
  generatedFrom?: string;
  completedInstallmentsFromPrev?: {
    description: string;
    amount: number;
    installmentLabel: string;
    blockTitle: string;
  }[];
}
