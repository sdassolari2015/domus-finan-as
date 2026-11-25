import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Layers,
  TrendingDown,
} from 'lucide-react';
import {
  AccountBlockId,
  ExpenseCategory,
  MonthLedger,
} from '../types/finance';
import {
  FinancialSummary,
  formatCurrency,
  formatDateBR,
  formatInstallment,
} from '../utils/formatters';
import {
  EXPENSE_CATEGORIES,
  getEffectiveBlocks,
} from '../data/initialData';

interface ReportsTabProps {
  ledger: MonthLedger;
  summary: FinancialSummary;
}

const MONTH_SHORT_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

function estimateEndMonthLabel(
  baseYear: number,
  baseMonth: number,
  currentInst: number,
  totalInst: number
): string {
  const remainingAfterThis = Math.max(0, totalInst - currentInst);
  if (remainingAfterThis === 0) {
    return `Encerra em ${MONTH_SHORT_PT[baseMonth - 1]}/${baseYear}`;
  }
  const totalMonthsFromZero = baseYear * 12 + (baseMonth - 1) + remainingAfterThis;
  const targetYear = Math.floor(totalMonthsFromZero / 12);
  const targetMonthIdx = totalMonthsFromZero % 12;
  return `${MONTH_SHORT_PT[targetMonthIdx]}/${targetYear}`;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({ ledger, summary }) => {
  const [activeReportSubTab, setActiveReportSubTab] = useState<
    'saldo_devedor' | 'categorias'
  >('saldo_devedor');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | null>(null);
  const [selectedBlockFilter, setSelectedBlockFilter] = useState<AccountBlockId | 'all'>(
    'all'
  );

  const effectiveBlocks = getEffectiveBlocks(ledger);

  // Aggregate expenses by category
  const categoryStats = EXPENSE_CATEGORIES.map((catMeta) => {
    const items = ledger.expenses.filter((e) => e.category === catMeta.name);
    const total = items.reduce((acc, i) => acc + i.amount, 0);
    const paid = items
      .filter((i) => i.status === 'Pago')
      .reduce((acc, i) => acc + i.amount, 0);
    const pending = items
      .filter((i) => i.status === 'Pendente')
      .reduce((acc, i) => acc + i.amount, 0);
    const pctOfExpenses =
      summary.totalExpenses > 0 ? (total / summary.totalExpenses) * 100 : 0;
    const pctOfIncome =
      summary.totalIncome > 0 ? (total / summary.totalIncome) * 100 : 0;

    return {
      ...catMeta,
      items,
      total,
      paid,
      pending,
      pctOfExpenses,
      pctOfIncome,
    };
  })
    .filter((c) => c.total > 0 || c.items.length > 0)
    .sort((a, b) => b.total - a.total);

  const activeCategoryObj =
    categoryStats.find((c) => c.name === selectedCategory) || categoryStats[0] || null;

  // All installment accounts with exact Saldo Devedor calculation
  const rawInstallmentItems = ledger.expenses.filter(
    (e) =>
      e.currentInstallment !== null &&
      e.totalInstallments !== null &&
      e.totalInstallments > 0
  );

  const enrichedInstallments = rawInstallmentItems
    .map((item) => {
      const curr = item.currentInstallment ?? 1;
      const tot = item.totalInstallments ?? 1;
      const isPaidThisMonth = item.status === 'Pago';

      // Number of installments already paid vs still unpaid (Saldo Devedor)
      const paidInstallmentsCount = isPaidThisMonth
        ? Math.min(tot, curr)
        : Math.max(0, curr - 1);
      const unpaidInstallmentsCount = Math.max(0, tot - paidInstallmentsCount);

      const totalContracted = tot * item.amount;
      const amountAlreadyPaid = paidInstallmentsCount * item.amount;
      const saldoDevedor = unpaidInstallmentsCount * item.amount;
      const progressPct = tot > 0 ? Math.min(100, (paidInstallmentsCount / tot) * 100) : 0;
      const blockMeta = effectiveBlocks.find((b) => b.id === item.blockId);

      return {
        ...item,
        curr,
        tot,
        paidInstallmentsCount,
        unpaidInstallmentsCount,
        totalContracted,
        amountAlreadyPaid,
        saldoDevedor,
        progressPct,
        blockShortName:
          item.blockId === 'outras'
            ? 'Despesas Variáveis (Boletos/Consórcios)'
            : blockMeta?.fullTitle || item.blockId,
      };
    })
    .filter((item) =>
      selectedBlockFilter === 'all' ? true : item.blockId === selectedBlockFilter
    )
    .sort((a, b) => b.saldoDevedor - a.saldoDevedor);

  const totalContractedAll = enrichedInstallments.reduce(
    (acc, i) => acc + i.totalContracted,
    0
  );
  const totalAlreadyPaidAll = enrichedInstallments.reduce(
    (acc, i) => acc + i.amountAlreadyPaid,
    0
  );
  const totalSaldoDevedorAll = enrichedInstallments.reduce(
    (acc, i) => acc + i.saldoDevedor,
    0
  );
  const totalMonthlyInstallmentFiltered = enrichedInstallments.reduce(
    (acc, i) => acc + i.amount,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tab Selector (Sem botão de Planilha Antiga do Excel) */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Relatórios Financeiros & Saldo Devedor — {ledger.label}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Acompanhe o saldo devedor total de todas as contas parceladas e a distribuição dos gastos por categoria
          </p>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl self-start lg:self-auto">
          <button
            type="button"
            onClick={() => setActiveReportSubTab('saldo_devedor')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap ${
              activeReportSubTab === 'saldo_devedor'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            Saldo Devedor (Contas Parceladas)
          </button>
          <button
            type="button"
            onClick={() => setActiveReportSubTab('categorias')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap ${
              activeReportSubTab === 'categorias'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Gastos por Categoria
          </button>
        </div>
      </div>

      {activeReportSubTab === 'saldo_devedor' ? (
        <div className="space-y-6">
          {/* 4 KPI Cards for Installment Debt Balance */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-slate-900 text-white border border-slate-900 rounded-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Saldo Devedor Total Restante</span>
                  <span className="font-mono tabular-nums text-red-400 font-semibold">
                    {enrichedInstallments.length} contas
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
                  {formatCurrency(totalSaldoDevedorAll)}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
                <span>Soma de todas as parcelas a vencer</span>
              </div>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Valor Total Já Quitado</span>
                  <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                    {totalContractedAll > 0
                      ? ((totalAlreadyPaidAll / totalContractedAll) * 100).toFixed(1)
                      : '0.0'}
                    % amortizado
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                  {formatCurrency(totalAlreadyPaidAll)}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Parcelas anteriores + pagas no mês</span>
              </div>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Parcelas Neste Mês ({ledger.label})</span>
                  <span className="font-mono tabular-nums text-slate-700 font-medium">
                    Mensal
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {formatCurrency(totalMonthlyInstallmentFiltered)}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Comprometimento mensal com parcelas</span>
              </div>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Valor Total Contratado</span>
                  <span className="text-slate-500">100% dos contratos</span>
                </div>
                <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {formatCurrency(totalContractedAll)}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Pago + Saldo Devedor</span>
              </div>
            </div>
          </div>

          {/* Filter by Block / Origin */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
              <button
                type="button"
                onClick={() => setSelectedBlockFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedBlockFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todas as Origens ({rawInstallmentItems.length})
              </button>
              {effectiveBlocks.map((b) => {
                const count = rawInstallmentItems.filter((i) => i.blockId === b.id).length;
                if (count === 0) return null;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBlockFilter(b.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      selectedBlockFilter === b.id
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {b.id === 'outras' ? 'Despesas Variáveis' : b.shortName} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detailed Saldo Devedor Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Saldo Devedor de Todas as Contas Parceladas ({enrichedInstallments.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  O saldo devedor considera todas as parcelas que ainda estão em aberto (se a parcela atual já foi marcada como Paga, ela já foi abatida do saldo devedor)
                </p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <span className="text-xs text-slate-500 block font-sans">
                  Saldo Devedor Consolidado
                </span>
                <span className="text-base font-bold text-red-600">
                  {formatCurrency(totalSaldoDevedorAll)}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100/60 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="py-3 px-6">Conta Parcelada / Origem</th>
                    <th className="py-3 px-3 text-center">No Mês</th>
                    <th className="py-3 px-3 text-center">Parcela Atual</th>
                    <th className="py-3 px-4">Progresso Pago</th>
                    <th className="py-3 px-3 text-center">Parcelas em Aberto</th>
                    <th className="py-3 px-3">Previsão de Término</th>
                    <th className="py-3 px-4 text-right">Valor da Parcela</th>
                    <th className="py-3 px-4 text-right">Total Já Pago</th>
                    <th className="py-3 px-6 text-right">Saldo Devedor Atual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {enrichedInstallments.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-400">
                        Nenhuma conta parcelada encontrada para este filtro.
                      </td>
                    </tr>
                  ) : (
                    enrichedInstallments.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-6">
                          <div className="font-bold text-slate-900">{item.description}</div>
                          <div className="text-[11px] text-slate-500">
                            <span>{item.blockShortName}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{item.category}</span>
                            <span aria-hidden="true"> · </span>
                            <span>Vence {formatDateBR(item.dueDate)}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              item.status === 'Pago' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {item.status === 'Pago' ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Pago
                              </>
                            ) : (
                              <>
                                <Clock className="w-3.5 h-3.5" />
                                A Pagar
                              </>
                            )}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 font-mono tabular-nums text-center font-semibold text-slate-800 whitespace-nowrap">
                          {formatInstallment(item.curr, item.tot)}
                        </td>
                        <td className="py-3.5 px-4 min-w-[150px]">
                          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 mb-1">
                            <span>{item.progressPct.toFixed(0)}% quitado</span>
                            <span>
                              {item.paidInstallmentsCount}/{item.tot}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                item.unpaidInstallmentsCount === 0
                                  ? 'bg-emerald-600'
                                  : 'bg-slate-900'
                              }`}
                              style={{ width: `${item.progressPct}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-mono tabular-nums text-center whitespace-nowrap">
                          {item.unpaidInstallmentsCount === 0 ? (
                            <span className="font-semibold text-emerald-700">Quitado!</span>
                          ) : (
                            <span className="font-semibold text-slate-800">
                              Faltam {item.unpaidInstallmentsCount}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {estimateEndMonthLabel(
                            ledger.year,
                            ledger.month,
                            item.curr,
                            item.tot
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold text-slate-900 whitespace-nowrap">
                          {formatCurrency(item.amount)}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold text-emerald-700 whitespace-nowrap">
                          {formatCurrency(item.amountAlreadyPaid)}
                        </td>
                        <td className="py-3.5 px-6 font-mono tabular-nums text-right font-bold text-red-600 whitespace-nowrap">
                          {item.saldoDevedor === 0
                            ? 'R$ 0,00 (Quitado)'
                            : formatCurrency(item.saldoDevedor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono tabular-nums">
              <span className="font-sans font-semibold text-slate-300">
                TOTAIS CONSOLIDADOS DAS CONTAS PARCELADAS
              </span>
              <div className="flex flex-wrap items-center gap-6">
                <span>
                  Contratado:{' '}
                  <strong className="text-white">
                    {formatCurrency(totalContractedAll)}
                  </strong>
                </span>
                <span>
                  Já Pago:{' '}
                  <strong className="text-emerald-400">
                    {formatCurrency(totalAlreadyPaidAll)}
                  </strong>
                </span>
                <span className="text-sm">
                  Saldo Devedor Total:{' '}
                  <strong className="text-red-400">
                    {formatCurrency(totalSaldoDevedorAll)}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Category Breakdown & Drilldown */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left 5 cols: Selected Category Drilldown */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Detalhamento da Categoria Selecionada
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Clique em qualquer categoria ao lado para ver as contas correspondentes
              </p>
            </div>

            {activeCategoryObj && (
              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-xs shrink-0"
                      style={{ backgroundColor: activeCategoryObj.color }}
                    />
                    <span className="text-xs font-bold text-slate-900">
                      {activeCategoryObj.name}
                    </span>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-bold text-slate-900">
                    {formatCurrency(activeCategoryObj.total)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-3">
                  {activeCategoryObj.description} · Representa{' '}
                  <strong className="font-mono">
                    {activeCategoryObj.pctOfExpenses.toFixed(1)}%
                  </strong>{' '}
                  das despesas e{' '}
                  <strong className="font-mono">
                    {activeCategoryObj.pctOfIncome.toFixed(1)}%
                  </strong>{' '}
                  da renda da casa.
                </p>

                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {activeCategoryObj.items.map((item) => {
                    const blockMeta = effectiveBlocks.find((b) => b.id === item.blockId);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-2 px-3 bg-slate-50 border border-slate-200/80 rounded-lg text-xs"
                      >
                        <div>
                          <span className="font-semibold text-slate-800">
                            {item.description}
                          </span>
                          <span className="text-slate-400"> · </span>
                          <span className="text-slate-500">
                            {blockMeta?.shortName || item.blockId}
                          </span>
                          {item.currentInstallment && item.totalInstallments && (
                            <>
                              <span className="text-slate-400"> · </span>
                              <span className="font-mono text-slate-600">
                                {formatInstallment(
                                  item.currentInstallment,
                                  item.totalInstallments
                                )}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {item.amount > 0 ? formatCurrency(item.amount) : 'A definir'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right 7 cols: Full Ranked Table by Category */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Ranking Mensal de Gastos por Categoria
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Peso de cada categoria sobre o total de despesas (
                    {formatCurrency(summary.totalExpenses)}) e sobre a renda (
                    {formatCurrency(summary.totalIncome)})
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3.5">
                {categoryStats.map((cat, idx) => {
                  const isSelected = activeCategoryObj?.name === cat.name;
                  return (
                    <div
                      key={cat.name}
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`p-3 rounded-xl border transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-slate-50 border-slate-300'
                          : 'bg-white border-slate-200/70 hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-slate-400 font-semibold">
                            {String(idx + 1).padStart(2, '0')}.
                          </span>
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="font-bold text-slate-900">{cat.name}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500">
                            {cat.items.length} {cat.items.length === 1 ? 'conta' : 'contas'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                          <span className="text-slate-500">
                            {cat.pctOfExpenses.toFixed(1)}% dos gastos
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-600">
                            {cat.pctOfIncome.toFixed(1)}% da renda
                          </span>
                          <span className="font-bold text-slate-900 text-sm">
                            {formatCurrency(cat.total)}
                          </span>
                        </div>
                      </div>

                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${Math.max(cat.total > 0 ? 2 : 0, cat.pctOfExpenses)}%`,
                            backgroundColor: cat.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
              <span className="text-slate-500">
                Maior categoria do mês:{' '}
                <strong className="text-slate-900">
                  {categoryStats[0]?.name} ({formatCurrency(categoryStats[0]?.total || 0)})
                </strong>
              </span>
              <span className="font-mono tabular-nums font-bold text-emerald-700">
                Margem Livre: {formatCurrency(summary.familyProjectedBalance)} (
                {summary.savingsCapacityRatio.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
