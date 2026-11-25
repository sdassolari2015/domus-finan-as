import { ExpenseItem, MonthLedger, AccountBlockId } from '../types/finance';
import { getEffectiveBlocks, getExpenseBoletoSubType } from '../data/initialData';

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatNumberBR(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateBR(isoDate: string): string {
  if (!isoDate) return '---';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatInstallment(
  current: number | null | undefined,
  total: number | null | undefined
): string {
  if (!current || !total) return '---';
  const c = String(current).padStart(2, '0');
  const t = String(total).padStart(2, '0');
  return `${c}/${t}`;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  totalPaidExpenses: number;
  totalPendingExpenses: number;
  cashBalanceCurrent: number;
  familyProjectedBalance: number;
  fixedOutrasTotal: number;
  mensalOutrasTotal: number;
  installmentOutrasTotal: number;
  allFixedTotal: number;
  allInstallmentTotal: number;
  commitmentRatio: number;
  savingsCapacityRatio: number;
  paidProgressRatio: number;
  blockTotals: Record<
    AccountBlockId,
    {
      total: number;
      paid: number;
      pending: number;
      count: number;
    }
  >;
  finishingThisMonth: ExpenseItem[];
  finishingThisMonthTotal: number;
}

export function calculateFinancialSummary(ledger: MonthLedger): FinancialSummary {
  const totalIncome = ledger.incomes.reduce((acc, item) => acc + item.amount, 0);

  const effectiveBlocks = getEffectiveBlocks(ledger);
  const blockTotals: FinancialSummary['blockTotals'] = {};

  for (const b of effectiveBlocks) {
    blockTotals[b.id] = { total: 0, paid: 0, pending: 0, count: 0 };
  }
  if (!blockTotals.outras) {
    blockTotals.outras = { total: 0, paid: 0, pending: 0, count: 0 };
  }

  let totalExpenses = 0;
  let totalPaidExpenses = 0;
  let totalPendingExpenses = 0;
  let fixedOutrasTotal = 0;
  let mensalOutrasTotal = 0;
  let installmentOutrasTotal = 0;
  let allFixedTotal = 0;
  let allInstallmentTotal = 0;
  const finishingThisMonth: ExpenseItem[] = [];

  for (const exp of ledger.expenses) {
    const val = exp.amount || 0;
    totalExpenses += val;
    if (exp.status === 'Pago') {
      totalPaidExpenses += val;
    } else {
      totalPendingExpenses += val;
    }

    if (!blockTotals[exp.blockId]) {
      blockTotals[exp.blockId] = { total: 0, paid: 0, pending: 0, count: 0 };
    }

    blockTotals[exp.blockId].total += val;
    blockTotals[exp.blockId].count += 1;
    if (exp.status === 'Pago') {
      blockTotals[exp.blockId].paid += val;
    } else {
      blockTotals[exp.blockId].pending += val;
    }

    const hasInstallments =
      exp.currentInstallment !== null &&
      exp.totalInstallments !== null &&
      exp.totalInstallments > 0;

    if (exp.blockId === 'outras') {
      const subType = getExpenseBoletoSubType(exp);
      if (subType === 'fixa') {
        fixedOutrasTotal += val;
      } else if (subType === 'mensal') {
        mensalOutrasTotal += val;
      } else {
        installmentOutrasTotal += val;
      }
    }

    if (hasInstallments) {
      allInstallmentTotal += val;
      if (exp.currentInstallment === exp.totalInstallments && val > 0) {
        finishingThisMonth.push(exp);
      }
    } else {
      allFixedTotal += val;
    }
  }

  const cashBalanceCurrent = totalIncome - totalPaidExpenses;
  const familyProjectedBalance = totalIncome - totalExpenses;
  const commitmentRatio = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;
  const savingsCapacityRatio =
    totalIncome > 0 ? Math.max(0, (familyProjectedBalance / totalIncome) * 100) : 0;
  const paidProgressRatio =
    totalExpenses > 0 ? (totalPaidExpenses / totalExpenses) * 100 : 0;
  const finishingThisMonthTotal = finishingThisMonth.reduce(
    (acc, item) => acc + item.amount,
    0
  );

  return {
    totalIncome,
    totalExpenses,
    totalPaidExpenses,
    totalPendingExpenses,
    cashBalanceCurrent,
    familyProjectedBalance,
    fixedOutrasTotal,
    mensalOutrasTotal,
    installmentOutrasTotal,
    allFixedTotal,
    allInstallmentTotal,
    commitmentRatio,
    savingsCapacityRatio,
    paidProgressRatio,
    blockTotals,
    finishingThisMonth,
    finishingThisMonthTotal,
  };
}
