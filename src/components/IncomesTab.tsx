import React from 'react';
import { Plus, Edit3, Trash2 } from 'lucide-react';
import {
  AccountBlockId,
  IncomeItem,
  MonthLedger,
} from '../types/finance';
import {
  FinancialSummary,
  formatCurrency,
  formatDateBR,
} from '../utils/formatters';

interface IncomesTabProps {
  ledger: MonthLedger;
  summary: FinancialSummary;
  onEditIncome: (income: IncomeItem) => void;
  onDeleteIncome: (incomeId: string) => void;
  onOpenNewModal: (mode: 'expense' | 'income', blockId?: AccountBlockId) => void;
}

export const IncomesTab: React.FC<IncomesTabProps> = ({
  ledger,
  summary,
  onEditIncome,
  onDeleteIncome,
  onOpenNewModal,
}) => {
  const rodolfoIncomes = ledger.incomes.filter((i) => i.person === 'Rodolfo');
  const vivianeIncomes = ledger.incomes.filter((i) => i.person === 'Viviane');
  const familyIncomes = ledger.incomes.filter((i) => i.person === 'Família');

  const rodolfoSum = rodolfoIncomes.reduce((acc, i) => acc + i.amount, 0);
  const vivianeSum = vivianeIncomes.reduce((acc, i) => acc + i.amount, 0);
  const familySum = familyIncomes.reduce((acc, i) => acc + i.amount, 0);

  const rodolfoPct = summary.totalIncome > 0 ? (rodolfoSum / summary.totalIncome) * 100 : 0;
  const vivianePct = summary.totalIncome > 0 ? (vivianeSum / summary.totalIncome) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Entradas & Receitas da Família
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Controle das receitas mensais de Rodolfo e Viviane conforme o bloco &ldquo;Entradas&rdquo; da sua planilha
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="text-right">
            <span className="text-xs text-slate-500 block">Total de Entradas no Mês</span>
            <span className="text-xl font-bold font-mono tabular-nums text-emerald-700">
              {formatCurrency(summary.totalIncome)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenNewModal('income')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nova Entrada
          </button>
        </div>
      </div>

      {/* Breakdown by Family Member */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Receitas — Rodolfo</span>
              <span className="font-mono tabular-nums font-semibold text-slate-700">
                {rodolfoPct.toFixed(1)}% da renda
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {formatCurrency(rodolfoSum)}
            </p>
          </div>
          <div className="mt-4">
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-900"
                style={{ width: `${Math.min(100, rodolfoPct)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {rodolfoIncomes.length} {rodolfoIncomes.length === 1 ? 'fonte cadastrada' : 'fontes cadastradas'}
            </p>
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Receitas — Viviane</span>
              <span className="font-mono tabular-nums font-semibold text-slate-700">
                {vivianePct.toFixed(1)}% da renda
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {formatCurrency(vivianeSum)}
            </p>
          </div>
          <div className="mt-4">
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600"
                style={{ width: `${Math.min(100, vivianePct)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {vivianeIncomes.length} {vivianeIncomes.length === 1 ? 'fonte cadastrada' : 'fontes cadastradas'}
            </p>
          </div>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Cobertura das Despesas</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-700">
                Sobra {formatCurrency(summary.familyProjectedBalance)}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700">
              {summary.savingsCapacityRatio.toFixed(1)}% Livre
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between font-mono tabular-nums">
            <span>Gastos: {formatCurrency(summary.totalExpenses)}</span>
            {familySum > 0 && <span>Outras: {formatCurrency(familySum)}</span>}
          </div>
        </div>
      </div>

      {/* Main Table matching the Excel "Entradas" block */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Quadro de Entradas — {ledger.label}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Idêntico às linhas 7 a 14 da sua planilha Excel
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenNewModal('income')}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Entrada
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100/60 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-6">Integrante</th>
                <th className="py-3 px-4">Informações / Fonte</th>
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4 text-right">Participação</th>
                <th className="py-3 px-6 text-right">Valor</th>
                <th className="py-3 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {ledger.incomes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Nenhuma entrada cadastrada neste mês.
                  </td>
                </tr>
              ) : (
                ledger.incomes.map((inc) => {
                  const share =
                    summary.totalIncome > 0
                      ? ((inc.amount / summary.totalIncome) * 100).toFixed(1)
                      : '0.0';
                  return (
                    <tr key={inc.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-6 font-semibold text-slate-900">
                        {inc.person}
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {inc.description}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600">
                        {formatDateBR(inc.date)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-500">
                        {share}%
                      </td>
                      <td className="py-3 px-6 font-mono tabular-nums text-right font-bold text-emerald-700">
                        {formatCurrency(inc.amount)}
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditIncome(inc)}
                            className="p-1.5 text-slate-400 hover:text-slate-800 rounded transition-colors"
                            title="Editar entrada"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteIncome(inc.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors"
                            title="Excluir entrada"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-3.5 bg-slate-100/80 border-t border-slate-200 flex items-center justify-between text-xs font-mono tabular-nums">
          <span className="font-bold text-slate-800">TOTAL DE ENTRADAS =</span>
          <span className="text-sm font-bold text-emerald-700">
            {formatCurrency(summary.totalIncome)}
          </span>
        </div>
      </div>
    </div>
  );
};
