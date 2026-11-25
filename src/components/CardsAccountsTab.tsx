import React, { useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Clock,
  Edit3,
  Trash2,
  CheckCheck,
  CreditCard,
  Landmark,
  X,
} from 'lucide-react';
import {
  AccountBlockId,
  AccountBlockMeta,
  ExpenseItem,
  FamilyMember,
  MonthLedger,
} from '../types/finance';
import {
  FinancialSummary,
  formatCurrency,
  formatDateBR,
  formatInstallment,
} from '../utils/formatters';
import { getEffectiveBlocks } from '../data/initialData';

interface CardsAccountsTabProps {
  ledger: MonthLedger;
  summary: FinancialSummary;
  focusedBlockId: AccountBlockId | null;
  onSelectFocusBlock: (blockId: AccountBlockId | null) => void;
  onToggleExpenseStatus: (expenseId: string) => void;
  onMarkBlockPaid: (blockId: AccountBlockId) => void;
  onEditExpense: (expense: ExpenseItem) => void;
  onDeleteExpense: (expenseId: string) => void;
  onOpenNewModal: (mode: 'expense' | 'income', blockId?: AccountBlockId) => void;
  onAddCustomBlock: (newBlock: AccountBlockMeta) => void;
  onDeleteCustomBlock: (blockId: AccountBlockId) => void;
}

const ACCENT_COLORS = [
  { label: 'Vermelho', value: '#DC2626' },
  { label: 'Laranja', value: '#EA580C' },
  { label: 'Azul', value: '#2563EB' },
  { label: 'Verde', value: '#16A34A' },
  { label: 'Roxo', value: '#7C3AED' },
  { label: 'Esmeralda', value: '#059669' },
  { label: 'Azul Escuro', value: '#0F172A' },
  { label: 'Âmbar', value: '#D97706' },
];

export const CardsAccountsTab: React.FC<CardsAccountsTabProps> = ({
  ledger,
  summary,
  focusedBlockId,
  onSelectFocusBlock,
  onToggleExpenseStatus,
  onMarkBlockPaid,
  onEditExpense,
  onDeleteExpense,
  onOpenNewModal,
  onAddCustomBlock,
  onDeleteCustomBlock,
}) => {
  const [hideEmptyBlocks, setHideEmptyBlocks] = useState(false);

  // Modal state for creating a new Cartão or Conta
  const [createBlockModalOpen, setCreateBlockModalOpen] = useState(false);
  const [newBlockKind, setNewBlockKind] = useState<'cartao' | 'conta'>('cartao');
  const [newShortName, setNewShortName] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState('Débito em Conta');
  const [newOwner, setNewOwner] = useState<FamilyMember>('Família');
  const [newColor, setNewColor] = useState('#2563EB');
  const [formError, setFormError] = useState<string | null>(null);

  // Confirmation state for deleting a Cartão or Conta block
  const [confirmDeleteBlockId, setConfirmDeleteBlockId] = useState<AccountBlockId | null>(null);

  const effectiveBlocks = getEffectiveBlocks(ledger);
  const cardBlocks = effectiveBlocks.filter((b) => b.group === 'cartao_conta');

  const totalCardsAndAccounts = cardBlocks.reduce(
    (acc, b) => acc + (summary.blockTotals[b.id]?.total || 0),
    0
  );
  const totalPaidCards = cardBlocks.reduce(
    (acc, b) => acc + (summary.blockTotals[b.id]?.paid || 0),
    0
  );
  const totalPendingCards = cardBlocks.reduce(
    (acc, b) => acc + (summary.blockTotals[b.id]?.pending || 0),
    0
  );

  const visibleBlocks = cardBlocks.filter((block) => {
    if (focusedBlockId && focusedBlockId !== 'outras' && block.id !== focusedBlockId) {
      return false;
    }
    const count = summary.blockTotals[block.id]?.count || 0;
    if (hideEmptyBlocks && count === 0) {
      return false;
    }
    return true;
  });

  const openCreateModal = (kind: 'cartao' | 'conta') => {
    setNewBlockKind(kind);
    setNewShortName('');
    setNewPaymentMethod('Débito em Conta');
    setNewOwner('Família');
    setNewColor(kind === 'cartao' ? '#7C3AED' : '#2563EB');
    setFormError(null);
    setCreateBlockModalOpen(true);
  };

  const handleCreateBlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newShortName.trim();
    if (!trimmed) {
      setFormError(
        newBlockKind === 'cartao'
          ? 'Informe o nome do cartão (ex: Inter, Itaú, C6).'
          : 'Informe o nome da conta (ex: Caixa, Banco do Brasil, Itaú).'
      );
      return;
    }

    const slug = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const id = `${newBlockKind}_${slug}_${Date.now().toString().slice(-4)}`;
    const prefix = newBlockKind === 'conta' ? 'Conta' : 'Cartão';
    const cleanShort = trimmed.replace(/^(cart[aã]o|conta)\s+/i, '').trim() || trimmed;
    const fullTitle = `${prefix} ${cleanShort} - ${newPaymentMethod}`;

    onAddCustomBlock({
      id,
      shortName: cleanShort,
      fullTitle,
      paymentMethod: newPaymentMethod,
      owner: newOwner,
      accentColor: newColor,
      group: 'cartao_conta',
      kind: newBlockKind,
    });
    setCreateBlockModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header Summary & Actions to Create Card / Create Account */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Cartões e Contas ({cardBlocks.length})
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Gerencie seus cartões de crédito e contas bancárias: crie ou exclua cartões, contas bancárias e lançamentos mensais
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
            <div>
              <span className="text-slate-500 block font-sans">Total Geral</span>
              <span className="text-base font-bold text-slate-900">
                {formatCurrency(totalCardsAndAccounts)}
              </span>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block" />
            <div>
              <span className="text-slate-500 block font-sans">Quitados</span>
              <span className="text-base font-bold text-emerald-700">
                {formatCurrency(totalPaidCards)}
              </span>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block" />
            <div>
              <span className="text-slate-500 block font-sans">A Pagar</span>
              <span className="text-base font-bold text-red-600">
                {formatCurrency(totalPendingCards)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openCreateModal('cartao')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <CreditCard className="w-3.5 h-3.5" />
              + Novo Cartão
            </button>
            <button
              type="button"
              onClick={() => openCreateModal('conta')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Landmark className="w-3.5 h-3.5" />
              + Nova Conta
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar by Institution */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectFocusBlock(null)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              !focusedBlockId || focusedBlockId === 'outras'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Todos ({cardBlocks.length})
          </button>
          {cardBlocks.map((b) => {
            const count = summary.blockTotals[b.id]?.count || 0;
            const active = focusedBlockId === b.id;
            const prefix = b.kind === 'conta' ? 'Conta' : 'Cartão';
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelectFocusBlock(active ? null : b.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {prefix} {b.shortName} ({count})
              </button>
            );
          })}
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={hideEmptyBlocks}
            onChange={(e) => setHideEmptyBlocks(e.target.checked)}
            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          Ocultar blocos sem lançamentos no mês
        </label>
      </div>

      {/* Multi-Column Full-Screen Grid of Card/Account Blocks */}
      {visibleBlocks.length === 0 ? (
        <div className="p-10 bg-white border border-slate-200 rounded-xl text-center space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            Nenhum cartão ou conta visível para o filtro atual.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => openCreateModal('cartao')}
              className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              + Criar Novo Cartão
            </button>
            <button
              type="button"
              onClick={() => openCreateModal('conta')}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800"
            >
              + Criar Nova Conta
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5 items-stretch">
          {visibleBlocks.map((block) => {
            const blockExpenses = ledger.expenses
              .filter((e) => e.blockId === block.id)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
            const stats = summary.blockTotals[block.id] || {
              total: 0,
              paid: 0,
              pending: 0,
              count: 0,
            };
            const isAccountKind = block.kind === 'conta';
            const deleteLabel = isAccountKind ? 'Excluir Conta' : 'Excluir Cartão';

            return (
              <div
                key={block.id}
                className="bg-white border border-slate-200 rounded-xl flex flex-col justify-between overflow-hidden"
              >
                <div>
                  {/* Block Header */}
                  <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {block.fullTitle}
                        </h3>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span>{block.paymentMethod}</span>
                          <span aria-hidden="true"> · </span>
                          <span>Titular: {block.owner}</span>
                          <span aria-hidden="true"> · </span>
                          <span>
                            {stats.count} {stats.count === 1 ? 'conta lançada' : 'contas lançadas'}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                        {stats.pending > 0 && (
                          <button
                            type="button"
                            onClick={() => onMarkBlockPaid(block.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
                            title="Marcar todas as contas deste bloco como Pagas"
                          >
                            <CheckCheck className="w-3.5 h-3.5" />
                            Quitar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenNewModal('expense', block.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Criar Conta
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeleteBlockId(
                              confirmDeleteBlockId === block.id ? null : block.id
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg transition-colors whitespace-nowrap"
                          title={deleteLabel}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{deleteLabel}</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline Confirmation when deleting Cartão / Conta */}
                    {confirmDeleteBlockId === block.id && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-red-900 font-medium">
                          Confirmar exclusão de <strong>{block.fullTitle}</strong>
                          {stats.count > 0 ? ` e suas ${stats.count} conta(s)?` : '?'}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteBlockId(null)}
                            className="px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteCustomBlock(block.id);
                              setConfirmDeleteBlockId(null);
                            }}
                            className="px-2.5 py-1 rounded bg-red-600 text-white font-bold hover:bg-red-700"
                          >
                            Confirmar Exclusão
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Block Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-100/60 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                        <tr>
                          <th className="py-2 px-4">Conta / Gasto</th>
                          <th className="py-2 px-3">Vencimento</th>
                          <th className="py-2 px-3 text-center">Parcelas</th>
                          <th className="py-2 px-3 text-right">Valor</th>
                          <th className="py-2 px-3 text-right">Status</th>
                          <th className="py-2 px-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {blockExpenses.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 px-4 text-center text-slate-400">
                              <p>Sem contas lançadas em {block.shortName} neste mês.</p>
                              <button
                                type="button"
                                onClick={() => onOpenNewModal('expense', block.id)}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-4"
                              >
                                + Criar primeira conta em {block.shortName}
                              </button>
                            </td>
                          </tr>
                        ) : (
                          blockExpenses.map((exp) => {
                            const isLast =
                              exp.currentInstallment !== null &&
                              exp.totalInstallments !== null &&
                              exp.currentInstallment === exp.totalInstallments;
                            return (
                              <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-2.5 px-4">
                                  <div className="font-semibold text-slate-900">
                                    {exp.description}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    <span>{exp.category}</span>
                                    {isLast && (
                                      <>
                                        <span aria-hidden="true"> · </span>
                                        <span className="text-emerald-700 font-medium">
                                          Última parcela!
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                  {formatDateBR(exp.dueDate)}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-center text-slate-600 whitespace-nowrap">
                                  {formatInstallment(
                                    exp.currentInstallment,
                                    exp.totalInstallments
                                  )}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-mono tabular-nums text-right font-semibold whitespace-nowrap ${
                                    exp.status === 'Pago' ? 'text-slate-700' : 'text-red-600'
                                  }`}
                                >
                                  {formatCurrency(exp.amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => onToggleExpenseStatus(exp.id)}
                                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap ${
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
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => onEditExpense(exp)}
                                      className="p-1 text-slate-400 hover:text-slate-800 rounded transition-colors"
                                      title="Editar conta"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onDeleteExpense(exp.id)}
                                      className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                                      title="Excluir conta"
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

                {/* Dual-Column Total Footer */}
                <div className="px-5 py-3 bg-slate-100/80 border-t border-slate-200 flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="font-bold text-slate-700">TOTAL =</span>
                  <div className="flex items-center gap-5">
                    <span className="text-slate-700">
                      Pago:{' '}
                      <strong className="text-emerald-700">
                        {stats.paid > 0 ? formatCurrency(stats.paid) : 'R$ -'}
                      </strong>
                    </span>
                    <span className="text-slate-700">
                      Pendente:{' '}
                      <strong className="text-red-600">
                        {stats.pending > 0 ? formatCurrency(stats.pending) : 'R$ -'}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Criar Novo Cartão ou Nova Conta Bancária */}
      {createBlockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-base font-bold text-slate-900">
                {newBlockKind === 'cartao' ? 'Criar Novo Cartão' : 'Criar Nova Conta Bancária'}
              </h3>
              <button
                type="button"
                onClick={() => setCreateBlockModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBlockSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tipo de Bloco
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setNewBlockKind('cartao')}
                    className={`py-2 px-3 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                      newBlockKind === 'cartao'
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    Cartão de Crédito
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBlockKind('conta')}
                    className={`py-2 px-3 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                      newBlockKind === 'conta'
                        ? 'bg-emerald-700 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Landmark className="w-3.5 h-3.5" />
                    Conta Bancária
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {newBlockKind === 'cartao'
                    ? 'Nome do Cartão / Banco'
                    : 'Nome da Conta / Instituição'}
                </label>
                <input
                  type="text"
                  placeholder={
                    newBlockKind === 'cartao'
                      ? 'Ex: Inter, Itaú, C6 Bank, Mercado Pago...'
                      : 'Ex: Itaú, Banco do Brasil, Sicredi...'
                  }
                  value={newShortName}
                  onChange={(e) => setNewShortName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Titular
                  </label>
                  <select
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value as FamilyMember)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="Família">Família</option>
                    <option value="Rodolfo">Rodolfo</option>
                    <option value="Viviane">Viviane</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Forma de Pagamento
                  </label>
                  <select
                    value={newPaymentMethod}
                    onChange={(e) => setNewPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="Débito em Conta">Débito em Conta</option>
                    <option value="Fatura / Boleto">Fatura / Boleto</option>
                    <option value="Pix / Transferência">Pix / Transferência</option>
                    <option value="Direto na Loja">Direto na Loja</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Cor de Identificação
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENT_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setNewColor(c.value)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 ${
                        newColor === c.value
                          ? 'border-slate-900 bg-slate-100 font-bold text-slate-900'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-xs shrink-0"
                        style={{ backgroundColor: c.value }}
                      />
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCreateBlockModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  {newBlockKind === 'cartao' ? 'Salvar Novo Cartão' : 'Salvar Nova Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
