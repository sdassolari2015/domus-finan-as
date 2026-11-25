import React, { useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Clock,
  Edit3,
  Trash2,
  CheckCheck,
  Search,
} from 'lucide-react';
import {
  AccountBlockId,
  BoletoSubType,
  ExpenseCategory,
  ExpenseItem,
  MonthLedger,
} from '../types/finance';
import {
  FinancialSummary,
  formatCurrency,
  formatDateBR,
  formatInstallment,
} from '../utils/formatters';
import { EXPENSE_CATEGORIES, getExpenseBoletoSubType } from '../data/initialData';

interface BoletosPixTabProps {
  ledger: MonthLedger;
  summary: FinancialSummary;
  onToggleExpenseStatus: (expenseId: string) => void;
  onMarkBlockPaid: (blockId: AccountBlockId) => void;
  onEditExpense: (expense: ExpenseItem) => void;
  onDeleteExpense: (expenseId: string) => void;
  onOpenNewModal: (
    mode: 'expense' | 'income',
    blockId?: AccountBlockId,
    defaultBoletoSubType?: BoletoSubType
  ) => void;
}

const BOLETO_TABS: {
  id: BoletoSubType;
  title: string;
  subtitle: string;
  addButtonLabel: string;
}[] = [
  {
    id: 'fixa',
    title: 'Despesas Fixas',
    subtitle: 'Contas mensais que nunca acabam (luz, água, internet, telefone, escola, mensalidades)',
    addButtonLabel: '+ Nova Despesa Fixa',
  },
  {
    id: 'mensal',
    title: 'Gastos Mensais',
    subtitle: 'Gastos realizados durante o mês (compras avulsas, serviços e despesas do dia a dia)',
    addButtonLabel: '+ Novo Gasto Mensal',
  },
  {
    id: 'variavel',
    title: 'Despesas Variáveis',
    subtitle: 'Parcelamentos, consórcios, empréstimos e boletos com prazo definido',
    addButtonLabel: '+ Nova Despesa Variável',
  },
];

export const BoletosPixTab: React.FC<BoletosPixTabProps> = ({
  ledger,
  summary,
  onToggleExpenseStatus,
  onMarkBlockPaid,
  onEditExpense,
  onDeleteExpense,
  onOpenNewModal,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<BoletoSubType>('fixa');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const outrasExpenses = ledger.expenses
    .filter((e) => e.blockId === 'outras')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const fixasItems = outrasExpenses.filter((e) => getExpenseBoletoSubType(e) === 'fixa');
  const mensaisItems = outrasExpenses.filter((e) => getExpenseBoletoSubType(e) === 'mensal');
  const variaveisItems = outrasExpenses.filter(
    (e) => getExpenseBoletoSubType(e) === 'variavel'
  );

  const itemsByTab: Record<BoletoSubType, ExpenseItem[]> = {
    fixa: fixasItems,
    mensal: mensaisItems,
    variavel: variaveisItems,
  };

  const totalsByTab: Record<BoletoSubType, number> = {
    fixa: summary.fixedOutrasTotal,
    mensal: summary.mensalOutrasTotal,
    variavel: summary.installmentOutrasTotal,
  };

  const currentTabMeta =
    BOLETO_TABS.find((t) => t.id === activeSubTab) || BOLETO_TABS[0];

  const currentRawItems = itemsByTab[activeSubTab];
  const filteredItems = currentRawItems.filter((item) => {
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (
      searchQuery.trim() &&
      !item.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !item.category.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const currentPaidSum = filteredItems
    .filter((i) => i.status === 'Pago')
    .reduce((acc, i) => acc + i.amount, 0);
  const currentPendingSum = filteredItems
    .filter((i) => i.status === 'Pendente')
    .reduce((acc, i) => acc + i.amount, 0);
  const currentTotalSum = filteredItems.reduce((acc, i) => acc + i.amount, 0);

  const statsOutras = summary.blockTotals.outras || {
    total: 0,
    paid: 0,
    pending: 0,
    count: 0,
  };

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Boletos, Despesas Fixas, Gastos Mensais & Variáveis
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Organizado em 3 abas separadas: Despesas Fixas ({formatCurrency(summary.fixedOutrasTotal)}), Gastos Mensais ({formatCurrency(summary.mensalOutrasTotal)}) e Despesas Variáveis ({formatCurrency(summary.installmentOutrasTotal)})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {statsOutras.pending > 0 && (
            <button
              type="button"
              onClick={() => onMarkBlockPaid('outras')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <CheckCheck className="w-4 h-4" />
              Quitar Todos
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenNewModal('expense', 'outras', activeSubTab)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {currentTabMeta.addButtonLabel}
          </button>
        </div>
      </div>

      {/* 3 Separate Tabs Selector (Abas Separadas) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {BOLETO_TABS.map((tab) => {
          const isActive = activeSubTab === tab.id;
          const tabItems = itemsByTab[tab.id];
          const tabTotal = totalsByTab[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{tab.title}</span>
                  <span
                    className={`text-xs font-mono tabular-nums font-semibold ${
                      isActive ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {tabItems.length} {tabItems.length === 1 ? 'item' : 'itens'}
                  </span>
                </div>
                <p
                  className={`text-xs mt-1 leading-relaxed ${
                    isActive ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {tab.subtitle}
                </p>
              </div>

              <div
                className={`mt-4 pt-3 border-t flex items-center justify-between text-xs font-mono tabular-nums ${
                  isActive ? 'border-slate-800' : 'border-slate-100'
                }`}
              >
                <span className={isActive ? 'text-slate-300' : 'text-slate-500'}>
                  Total da Aba:
                </span>
                <span
                  className={`text-base font-bold ${
                    isActive ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {formatCurrency(tabTotal)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search & Category Filter for Active Tab */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          Exibindo: <strong className="text-slate-900">{currentTabMeta.title}</strong> —{' '}
          <span>{currentTabMeta.subtitle}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ExpenseCategory | 'all')}
            className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">Todas as Categorias</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`Buscar em ${currentTabMeta.title}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
            />
          </div>
        </div>
      </div>

      {/* Dedicated Table for Selected Sub-Tab */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between">
        <div>
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {currentTabMeta.title} ({filteredItems.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">{currentTabMeta.subtitle}</p>
            </div>
            <div className="flex items-center gap-4 self-start sm:self-auto">
              <span className="text-base font-bold font-mono tabular-nums text-slate-900">
                {formatCurrency(currentTotalSum)}
              </span>
              <button
                type="button"
                onClick={() => onOpenNewModal('expense', 'outras', activeSubTab)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {currentTabMeta.addButtonLabel}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100/60 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="py-3 px-6">Descrição / Categoria</th>
                  <th className="py-3 px-4">Vencimento / Data</th>
                  {activeSubTab === 'variavel' && (
                    <th className="py-3 px-4 text-center">Parcelas</th>
                  )}
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-right">Status</th>
                  <th className="py-3 px-6 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={activeSubTab === 'variavel' ? 6 : 5}
                      className="py-10 px-6 text-center text-slate-400 space-y-2"
                    >
                      <p>Nenhum lançamento cadastrado em {currentTabMeta.title} neste mês.</p>
                      <button
                        type="button"
                        onClick={() => onOpenNewModal('expense', 'outras', activeSubTab)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-4"
                      >
                        {currentTabMeta.addButtonLabel}
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-6">
                        <div className="font-semibold text-slate-900">
                          {exp.description}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          <span>{exp.category}</span>
                          {exp.notes && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span className="text-amber-700">{exp.notes}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatDateBR(exp.dueDate)}
                      </td>
                      {activeSubTab === 'variavel' && (
                        <td className="py-3 px-4 font-mono tabular-nums text-center text-slate-600 whitespace-nowrap">
                          {formatInstallment(
                            exp.currentInstallment,
                            exp.totalInstallments
                          )}
                        </td>
                      )}
                      <td
                        className={`py-3 px-4 font-mono tabular-nums text-right font-semibold whitespace-nowrap ${
                          exp.amount === 0
                            ? 'text-amber-700'
                            : exp.status === 'Pago'
                            ? 'text-slate-700'
                            : 'text-red-600'
                        }`}
                      >
                        {exp.amount > 0 ? (
                          formatCurrency(exp.amount)
                        ) : (
                          <button
                            type="button"
                            onClick={() => onEditExpense(exp)}
                            className="underline underline-offset-2 hover:text-amber-900"
                          >
                            Definir valor
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onToggleExpenseStatus(exp.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
                            exp.status === 'Pago'
                              ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                              : 'bg-red-50 text-red-700 hover:bg-red-100'
                          }`}
                        >
                          {exp.status === 'Pago' ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Pago
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3" />
                              Pendente
                            </>
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-6 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditExpense(exp)}
                            className="p-1 text-slate-400 hover:text-slate-800 rounded transition-colors"
                            title="Editar"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteExpense(exp.id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-3.5 bg-slate-100/80 border-t border-slate-200 flex items-center justify-between text-xs font-mono tabular-nums">
          <span className="font-bold text-slate-700">
            SUBTOTAL ({currentTabMeta.title.toUpperCase()}) =
          </span>
          <div className="flex items-center gap-5">
            <span>
              Pago:{' '}
              <strong className="text-emerald-700">
                {currentPaidSum > 0 ? formatCurrency(currentPaidSum) : 'R$ -'}
              </strong>
            </span>
            <span>
              Pendente:{' '}
              <strong className="text-red-600">
                {currentPendingSum > 0 ? formatCurrency(currentPendingSum) : 'R$ -'}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Grand Total Bar */}
      <div className="p-4 bg-slate-900 text-white rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono tabular-nums">
        <span className="font-sans font-semibold text-slate-200">
          TOTAL GERAL (FIXAS + GASTOS MENSAIS + VARIÁVEIS)
        </span>
        <div className="flex items-center gap-6">
          <span>
            Pago:{' '}
            <strong className="text-emerald-400">
              {statsOutras.paid > 0 ? formatCurrency(statsOutras.paid) : 'R$ -'}
            </strong>
          </span>
          <span>
            Pendente:{' '}
            <strong className="text-red-400">
              {statsOutras.pending > 0 ? formatCurrency(statsOutras.pending) : 'R$ -'}
            </strong>
          </span>
          <span className="text-sm font-bold text-white">
            {formatCurrency(statsOutras.total)}
          </span>
        </div>
      </div>
    </div>
  );
};
