import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Plus,
  Edit3,
  Trash2,
  Search,
} from 'lucide-react';
import {
  AccountBlockId,
  IncomeItem,
  MonthLedger,
} from '../types/finance';
import {
  FinancialSummary,
  formatCurrency,
  formatDateBR,
  formatInstallment,
} from '../utils/formatters';
import { getEffectiveBlocks, getExpenseBoletoSubType } from '../data/initialData';

interface OverviewTabProps {
  ledger: MonthLedger;
  summary: FinancialSummary;
  onEditIncome: (income: IncomeItem) => void;
  onDeleteIncome: (incomeId: string) => void;
  onOpenNewModal: (mode: 'expense' | 'income', blockId?: AccountBlockId) => void;
  onNavigateTab: (
    tab: 'overview' | 'cards' | 'boletos' | 'reports',
    focusBlock?: AccountBlockId
  ) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  ledger,
  summary,
  onEditIncome,
  onDeleteIncome,
  onOpenNewModal,
  onNavigateTab,
}) => {
  const [scheduleFilter, setScheduleFilter] = useState<'all' | 'Pendente' | 'Pago'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const effectiveBlocks = getEffectiveBlocks(ledger);
  const cardAndAccountBlocks = effectiveBlocks.filter((b) => b.group === 'cartao_conta');

  const rodolfoIncomes = ledger.incomes.filter((i) => i.person === 'Rodolfo');
  const vivianeIncomes = ledger.incomes.filter((i) => i.person === 'Viviane');
  const rodolfoTotal = rodolfoIncomes.reduce((acc, i) => acc + i.amount, 0);
  const vivianeTotal = vivianeIncomes.reduce((acc, i) => acc + i.amount, 0);
  const rodolfoPct =
    summary.totalIncome > 0 ? (rodolfoTotal / summary.totalIncome) * 100 : 0;
  const vivianePct =
    summary.totalIncome > 0 ? (vivianeTotal / summary.totalIncome) * 100 : 0;

  // Resumo de Gastos rows dynamic for all cards/accounts + 3 boleto tabs
  const summaryRows = [
    {
      id: 'fixas_total',
      label: 'Despesas Fixas (Mensais)',
      amount: summary.fixedOutrasTotal,
      color: '#2563EB',
      onClick: () => onNavigateTab('boletos', 'outras'),
    },
    ...(summary.mensalOutrasTotal > 0
      ? [
          {
            id: 'mensais_total',
            label: 'Gastos Mensais (Durante o Mês)',
            amount: summary.mensalOutrasTotal,
            color: '#0D9488',
            onClick: () => onNavigateTab('boletos', 'outras'),
          },
        ]
      : []),
    ...cardAndAccountBlocks.map((b) => ({
      id: b.id,
      label: b.kind === 'conta' ? `Conta ${b.shortName}` : `Cartão ${b.shortName}`,
      amount: summary.blockTotals[b.id]?.total || 0,
      color: b.accentColor,
      onClick: () => onNavigateTab('cards', b.id),
    })),
    {
      id: 'outras_parceladas',
      label: 'Despesas Variáveis (Parcelados / Consórcios / Boletos)',
      amount: summary.installmentOutrasTotal,
      color: '#4F46E5',
      onClick: () => onNavigateTab('boletos', 'outras'),
    },
  ];

  const paidCount = ledger.expenses.filter((e) => e.status === 'Pago').length;
  const pendingCount = ledger.expenses.filter((e) => e.status === 'Pendente').length;

  const sortedExpenses = [...ledger.expenses]
    .filter((exp) => {
      if (scheduleFilter !== 'all' && exp.status !== scheduleFilter) return false;
      if (
        searchQuery.trim() &&
        !exp.description.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !exp.category.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const getOriginLabel = (exp: typeof ledger.expenses[0]): string => {
    if (exp.blockId === 'outras') {
      const sub = getExpenseBoletoSubType(exp);
      if (sub === 'fixa') return 'Boletos e Fixas · Despesa Fixa';
      if (sub === 'mensal') return 'Boletos e Fixas · Gasto Mensal';
      return 'Boletos e Fixas · Despesa Variável';
    }
    const blockMeta = effectiveBlocks.find((b) => b.id === exp.blockId);
    return blockMeta?.fullTitle || exp.blockId;
  };

  return (
    <div className="space-y-6">
      {/* Banner se mês foi gerado a partir do mês anterior com parcelas encerradas */}
      {ledger.completedInstallmentsFromPrev &&
        ledger.completedInstallmentsFromPrev.length > 0 && (
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-emerald-900">
                Alívio Financeiro Conquistado em {ledger.label}
              </p>
              <p className="text-xs text-emerald-800 mt-0.5">
                As seguintes parcelas terminaram em {ledger.generatedFrom} e não pesam mais no orçamento:{' '}
                {ledger.completedInstallmentsFromPrev
                  .map(
                    (c) =>
                      `${c.description} (${c.installmentLabel} · ${formatCurrency(c.amount)})`
                  )
                  .join(' + ')}
                . Economia mensal de{' '}
                <span className="font-mono font-semibold">
                  {formatCurrency(
                    ledger.completedInstallmentsFromPrev.reduce((a, b) => a + b.amount, 0)
                  )}
                </span>
                !
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('reports')}
              className="px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
            >
              Ver Saldo Devedor de Parcelas
            </button>
          </div>
        )}

      {/* ==================== BLOCO DE ENTRADAS DA FAMÍLIA (ACIMA DAS CAIXAS DE VALORES) ==================== */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Entradas & Receitas da Família — {ledger.label}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              <span>
                Rodolfo: <strong className="text-slate-800">{formatCurrency(rodolfoTotal)}</strong> ({rodolfoPct.toFixed(1)}%)
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Viviane: <strong className="text-slate-800">{formatCurrency(vivianeTotal)}</strong> ({vivianePct.toFixed(1)}%)
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Total Recebido: <strong className="text-emerald-700">{formatCurrency(summary.totalIncome)}</strong>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenNewModal('income')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap self-start lg:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Entrada
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-100/60 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="py-2.5 px-6">Integrante</th>
                <th className="py-2.5 px-4">Fonte / Informações</th>
                <th className="py-2.5 px-4">Data</th>
                <th className="py-2.5 px-4 text-right">Participação</th>
                <th className="py-2.5 px-6 text-right">Valor</th>
                <th className="py-2.5 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {ledger.incomes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Nenhuma entrada cadastrada neste mês. Clique em &ldquo;Nova Entrada&rdquo; para adicionar.
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
                      <td className="py-2.5 px-6 font-semibold text-slate-900">
                        {inc.person}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 font-medium">
                        {inc.description}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                        {formatDateBR(inc.date)}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-500">
                        {share}%
                      </td>
                      <td className="py-2.5 px-6 font-mono tabular-nums text-right font-bold text-emerald-700">
                        {formatCurrency(inc.amount)}
                      </td>
                      <td className="py-2.5 px-6 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditIncome(inc)}
                            className="p-1 text-slate-400 hover:text-slate-800 rounded transition-colors"
                            title="Editar entrada"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteIncome(inc.id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
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
      </div>

      {/* ==================== 4 CAIXAS DE VALORES PRINCIPAIS (ABAIXO DAS ENTRADAS) ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Entradas */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Entradas da Família</span>
              <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                {ledger.incomes.length} {ledger.incomes.length === 1 ? 'fonte' : 'fontes'}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {formatCurrency(summary.totalIncome)}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
            <span>Rodolfo: {formatCurrency(rodolfoTotal)}</span>
            <span aria-hidden="true">·</span>
            <span>Viviane: {formatCurrency(vivianeTotal)}</span>
          </div>
        </div>

        {/* 2. Total de Gastos do Mês */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Total de Gastos Lançados</span>
              <span className="font-mono tabular-nums text-slate-700 font-medium">
                {summary.commitmentRatio.toFixed(1)}% da renda
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {formatCurrency(summary.totalExpenses)}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-emerald-700">
              Pago: {formatCurrency(summary.totalPaidExpenses)}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-red-700">
              A Pagar: {formatCurrency(summary.totalPendingExpenses)}
            </span>
          </div>
        </div>

        {/* 3. Saldo Atual em Caixa */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Saldo Atual em Caixa</span>
              <span className="text-slate-500">Entradas − Pagos</span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {formatCurrency(summary.cashBalanceCurrent)}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Saída Realizada:</span>
            <span className="font-mono tabular-nums font-medium text-slate-800">
              {summary.totalPaidExpenses > 0
                ? formatCurrency(summary.totalPaidExpenses)
                : 'R$ -'}
            </span>
          </div>
        </div>

        {/* 4. Saldo Livre da Família */}
        <div className="p-5 bg-slate-900 text-white border border-slate-900 rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Saldo Livre da Família</span>
              <span className="font-mono tabular-nums text-emerald-400 font-medium">
                {summary.savingsCapacityRatio.toFixed(1)}% livre
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-white">
              {formatCurrency(summary.familyProjectedBalance)}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
            <span>Após quitar todas as contas</span>
            <span className="font-mono tabular-nums text-emerald-400">
              {summary.familyProjectedBalance >= 0 ? 'Superávit' : 'Déficit'}
            </span>
          </div>
        </div>
      </div>

      {/* ==================== DIVISÃO EM 2 COLUNAS: RESUMO POR BLOCO & CRONOGRAMA DE CONSULTA ==================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Coluna Esquerda (4 cols on xl): Resumo de Gastos por Bloco */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Resumo de Gastos por Bloco
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Visão consolidada de cartões, contas e boletos
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('reports')}
                className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap"
              >
                Relatórios
              </button>
            </div>

            <div className="mt-5 space-y-3.5">
              {/* Barra de Entrada */}
              <div className="p-2.5 -mx-2.5 rounded-lg bg-slate-50/70">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900 mb-1.5">
                  <span>ENTRADA TOTAL</span>
                  <span className="font-mono tabular-nums text-emerald-700">
                    {formatCurrency(summary.totalIncome)}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-sm overflow-hidden">
                  <div className="h-full bg-emerald-600 w-full" />
                </div>
              </div>

              <div className="border-t border-slate-100 my-2" />

              {summaryRows.map((row) => {
                const pctOfIncome =
                  summary.totalIncome > 0
                    ? Math.min(100, (row.amount / summary.totalIncome) * 100)
                    : 0;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={row.onClick}
                    className="w-full text-left p-2 -mx-2 rounded-lg hover:bg-slate-50 transition-colors block"
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700">{row.label}</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {row.amount > 0 ? formatCurrency(row.amount) : '-'}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${row.amount > 0 ? Math.max(2, pctOfIncome) : 0}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800">
              SALDO EM CAIXA DA FAMÍLIA:
            </span>
            <span className="text-base font-bold font-mono tabular-nums text-emerald-700">
              {formatCurrency(summary.familyProjectedBalance)}
            </span>
          </div>
        </div>

        {/* Coluna Direita (8 cols on xl): Cronograma de Contas (APENAS RESUMO DE CONSULTA — SEM EDITAR/APAGAR/MARCAR PAGO) */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Cronograma de Contas — Resumo Geral ({ledger.expenses.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Resumo informativo de contas pagas e a pagar de todas as abas (para editar ou dar baixa, acesse a aba correspondente)
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono tabular-nums shrink-0">
                <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900">
                  Pagas ({paidCount}):{' '}
                  <strong>{formatCurrency(summary.totalPaidExpenses)}</strong>
                </div>
                <div className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-900">
                  A Pagar ({pendingCount}):{' '}
                  <strong>{formatCurrency(summary.totalPendingExpenses)}</strong>
                </div>
              </div>
            </div>

            {/* Filtros de Visualização do Resumo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 my-4">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                <button
                  type="button"
                  onClick={() => setScheduleFilter('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    scheduleFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todas ({ledger.expenses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleFilter('Pendente')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    scheduleFilter === 'Pendente'
                      ? 'bg-white text-red-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  A Pagar ({pendingCount})
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleFilter('Pago')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    scheduleFilter === 'Pago'
                      ? 'bg-white text-emerald-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pagas ({paidCount})
                </button>
              </div>

              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Consultar conta ou categoria..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-slate-400"
                />
              </div>
            </div>

            {/* Tabela Somente Leitura de Contas Ordenadas por Vencimento */}
            <div className="overflow-x-auto max-h-[calc(100vh-380px)] min-h-[380px] overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">Conta / Aba de Origem</th>
                    <th className="py-2.5 px-3">Vencimento</th>
                    <th className="py-2.5 px-3 text-center">Parcelas</th>
                    <th className="py-2.5 px-3 text-right">Valor</th>
                    <th className="py-2.5 px-3 text-right">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {sortedExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Nenhuma conta encontrada para este filtro.
                      </td>
                    </tr>
                  ) : (
                    sortedExpenses.map((exp) => {
                      const isLastInstallment =
                        exp.currentInstallment !== null &&
                        exp.totalInstallments !== null &&
                        exp.currentInstallment === exp.totalInstallments;

                      return (
                        <tr
                          key={exp.id}
                          className="hover:bg-slate-50/60 transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">
                              {exp.description}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              <span>{getOriginLabel(exp)}</span>
                              <span aria-hidden="true"> · </span>
                              <span>{exp.category}</span>
                              {isLastInstallment && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className="text-emerald-700 font-medium">
                                    Última parcela
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {formatDateBR(exp.dueDate)}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-center text-slate-600 whitespace-nowrap">
                            {formatInstallment(exp.currentInstallment, exp.totalInstallments)}
                          </td>
                          <td
                            className={`py-2.5 px-3 font-mono tabular-nums text-right font-semibold whitespace-nowrap ${
                              exp.status === 'Pago' ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {exp.amount > 0 ? formatCurrency(exp.amount) : 'A definir'}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                exp.status === 'Pago'
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {exp.status === 'Pago' ? (
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
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
            <span className="text-slate-600">
              Total Pago:{' '}
              <strong className="text-emerald-700">
                {formatCurrency(summary.totalPaidExpenses)}
              </strong>
            </span>
            <span className="text-slate-600">
              Total a Pagar:{' '}
              <strong className="text-red-600">
                {formatCurrency(summary.totalPendingExpenses)}
              </strong>
            </span>
            <span className="text-slate-900 font-bold">
              Total Geral: {formatCurrency(summary.totalExpenses)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
