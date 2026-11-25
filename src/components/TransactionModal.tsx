import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import {
  AccountBlockId,
  BoletoSubType,
  ExpenseCategory,
  ExpenseItem,
  FamilyMember,
  IncomeItem,
  MonthLedger,
  PaymentStatus,
} from '../types/finance';
import {
  EXPENSE_CATEGORIES,
  getEffectiveBlocks,
  getExpenseBoletoSubType,
} from '../data/initialData';

interface TransactionModalProps {
  isOpen: boolean;
  ledger: MonthLedger;
  initialMode: 'expense' | 'income';
  defaultBlockId?: AccountBlockId;
  defaultBoletoSubType?: BoletoSubType;
  defaultDueDate?: string;
  editingExpense?: ExpenseItem | null;
  editingIncome?: IncomeItem | null;
  onClose: () => void;
  onSaveExpense: (expense: Omit<ExpenseItem, 'id'>, existingId?: string) => void;
  onSaveIncome: (income: Omit<IncomeItem, 'id'>, existingId?: string) => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  ledger,
  initialMode,
  defaultBlockId = 'outras',
  defaultBoletoSubType = 'fixa',
  defaultDueDate = '2026-10-10',
  editingExpense,
  editingIncome,
  onClose,
  onSaveExpense,
  onSaveIncome,
}) => {
  const [mode, setMode] = useState<'expense' | 'income'>(initialMode);

  // Expense form states
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [blockId, setBlockId] = useState<AccountBlockId>(defaultBlockId);
  const [boletoSubType, setBoletoSubType] = useState<BoletoSubType>(defaultBoletoSubType);
  const [category, setCategory] = useState<ExpenseCategory>('Utilidades (Luz & Água)');
  const [status, setStatus] = useState<PaymentStatus>('Pendente');
  const [hasInstallments, setHasInstallments] = useState(false);
  const [currentInstallmentStr, setCurrentInstallmentStr] = useState('1');
  const [totalInstallmentsStr, setTotalInstallmentsStr] = useState('12');
  const [notes, setNotes] = useState('');

  // Income form states
  const [person, setPerson] = useState<FamilyMember>('Rodolfo');
  const [incDescription, setIncDescription] = useState('');
  const [incAmountStr, setIncAmountStr] = useState('');
  const [incDate, setIncDate] = useState(defaultDueDate);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveBlocks = getEffectiveBlocks(ledger);

  useEffect(() => {
    setErrorMsg(null);
    if (editingExpense) {
      setMode('expense');
      setDescription(editingExpense.description);
      setAmountStr(String(editingExpense.amount));
      setDueDate(editingExpense.dueDate);
      setBlockId(editingExpense.blockId);
      setBoletoSubType(getExpenseBoletoSubType(editingExpense));
      setCategory(editingExpense.category);
      setStatus(editingExpense.status);
      const isInst =
        editingExpense.currentInstallment !== null &&
        editingExpense.totalInstallments !== null &&
        editingExpense.totalInstallments > 0;
      setHasInstallments(isInst);
      setCurrentInstallmentStr(
        editingExpense.currentInstallment ? String(editingExpense.currentInstallment) : '1'
      );
      setTotalInstallmentsStr(
        editingExpense.totalInstallments ? String(editingExpense.totalInstallments) : '12'
      );
      setNotes(editingExpense.notes || '');
    } else if (editingIncome) {
      setMode('income');
      setPerson(editingIncome.person);
      setIncDescription(editingIncome.description);
      setIncAmountStr(String(editingIncome.amount));
      setIncDate(editingIncome.date);
    } else {
      setMode(initialMode);
      setDescription('');
      setAmountStr('');
      setDueDate(defaultDueDate);
      setBlockId(defaultBlockId);
      setBoletoSubType(defaultBoletoSubType);
      setCategory(
        defaultBlockId === 'bradesco' || defaultBlockId === 'santander'
          ? 'Financeiro & Cartões'
          : defaultBlockId === 'caixa'
          ? 'Moradia & Financiamento'
          : defaultBlockId === 'outras' && defaultBoletoSubType === 'variavel'
          ? 'Consórcios & Patrimônio'
          : 'Utilidades (Luz & Água)'
      );
      setStatus('Pendente');
      setHasInstallments(
        defaultBlockId === 'outras' && defaultBoletoSubType === 'variavel'
      );
      setCurrentInstallmentStr('1');
      setTotalInstallmentsStr('12');
      setNotes('');

      setPerson('Rodolfo');
      setIncDescription('');
      setIncAmountStr('');
      setIncDate(defaultDueDate);
    }
  }, [
    isOpen,
    initialMode,
    defaultBlockId,
    defaultBoletoSubType,
    defaultDueDate,
    editingExpense,
    editingIncome,
  ]);

  if (!isOpen) return null;

  const parseCurrencyInput = (raw: string): number => {
    const normalized = raw.replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(normalized);
    return isNaN(num) ? 0 : num;
  };

  const handleSelectBoletoSubType = (sub: BoletoSubType) => {
    setBoletoSubType(sub);
    if (sub === 'fixa' || sub === 'mensal') {
      setHasInstallments(false);
    } else if (sub === 'variavel') {
      setHasInstallments(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (mode === 'expense') {
      if (!description.trim()) {
        setErrorMsg('Informe a descrição do gasto.');
        return;
      }
      const parsedAmount = parseCurrencyInput(amountStr);
      if (parsedAmount < 0) {
        setErrorMsg('O valor não pode ser negativo.');
        return;
      }

      let currInst: number | null = null;
      let totalInst: number | null = null;
      if (hasInstallments) {
        currInst = parseInt(currentInstallmentStr, 10) || 1;
        totalInst = parseInt(totalInstallmentsStr, 10) || 1;
        if (currInst > totalInst) {
          setErrorMsg('A parcela atual não pode ser maior que o total de parcelas.');
          return;
        }
      }

      const resolvedBoletoSubType: BoletoSubType | undefined =
        blockId === 'outras'
          ? hasInstallments
            ? 'variavel'
            : boletoSubType
          : undefined;

      const isRecurring =
        blockId === 'outras'
          ? resolvedBoletoSubType === 'fixa'
          : !hasInstallments;

      onSaveExpense(
        {
          description: description.trim(),
          amount: parsedAmount,
          dueDate,
          blockId,
          boletoSubType: resolvedBoletoSubType,
          category,
          status,
          currentInstallment: currInst,
          totalInstallments: totalInst,
          isRecurringFixed: isRecurring,
          notes: notes.trim() || undefined,
        },
        editingExpense?.id
      );
      onClose();
    } else {
      if (!incDescription.trim()) {
        setErrorMsg('Informe a descrição da entrada (ex: Salário, Pró-labore).');
        return;
      }
      const parsedIncAmount = parseCurrencyInput(incAmountStr);
      if (parsedIncAmount <= 0) {
        setErrorMsg('Informe um valor válido maior que zero para a entrada.');
        return;
      }

      onSaveIncome(
        {
          person,
          description: incDescription.trim(),
          amount: parsedIncAmount,
          date: incDate,
        },
        editingIncome?.id
      );
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-base font-semibold text-slate-900">
            {editingExpense
              ? 'Editar Despesa'
              : editingIncome
              ? 'Editar Entrada'
              : 'Novo Lançamento Financeiro'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
            aria-label="Fechar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!editingExpense && !editingIncome && (
          <div className="px-6 pt-4">
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('expense')}
                className={`py-2 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'expense'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Despesa / Conta a Pagar
              </button>
              <button
                type="button"
                onClick={() => setMode('income')}
                className={`py-2 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'income'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Entrada / Receita da Casa
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
              {errorMsg}
            </div>
          )}

          {mode === 'expense' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cartão, Conta Bancária ou Boletos e Fixas
                </label>
                <select
                  value={blockId}
                  onChange={(e) => setBlockId(e.target.value as AccountBlockId)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {effectiveBlocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id === 'outras'
                        ? 'Boletos e Fixas (Despesas Fixas, Gastos Mensais e Variáveis)'
                        : b.fullTitle}
                    </option>
                  ))}
                </select>
              </div>

              {blockId === 'outras' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Aba dentro de Boletos e Fixas
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => handleSelectBoletoSubType('fixa')}
                      className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        boletoSubType === 'fixa'
                          ? 'bg-slate-900 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Despesa Fixa
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectBoletoSubType('mensal')}
                      className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        boletoSubType === 'mensal'
                          ? 'bg-slate-900 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Gasto Mensal
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectBoletoSubType('variavel')}
                      className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        boletoSubType === 'variavel'
                          ? 'bg-slate-900 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Despesa Variável
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Descrição da Conta / Gasto
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Fit Energia, Consórcio..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Categoria para Relatório
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat.name} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Data de Vencimento
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="pt-1 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-700">
                    Modalidade de Cobrança
                  </span>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                    <button
                      type="button"
                      onClick={() => setHasInstallments(false)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        !hasInstallments
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sem Parcelas (---)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHasInstallments(true);
                        if (blockId === 'outras') {
                          setBoletoSubType('variavel');
                        }
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        hasInstallments
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Parcelada (Ex: 13/47)
                    </button>
                  </div>
                </div>

                {hasInstallments && (
                  <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg mt-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Parcela Atual
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={currentInstallmentStr}
                        onChange={(e) => setCurrentInstallmentStr(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Total de Parcelas
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={totalInstallmentsStr}
                        onChange={(e) => setTotalInstallmentsStr(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status do Pagamento
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setStatus('Pendente')}
                      className={`py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        status === 'Pendente'
                          ? 'bg-white text-red-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Pendente
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus('Pago')}
                      className={`py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        status === 'Pago'
                          ? 'bg-white text-emerald-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Pago
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Observação (Opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Débito automático..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Integrante da Família
                  </label>
                  <select
                    value={person}
                    onChange={(e) => setPerson(e.target.value as FamilyMember)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="Rodolfo">Rodolfo</option>
                    <option value="Viviane">Viviane</option>
                    <option value="Família">Família (Conjunto)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Data de Recebimento
                  </label>
                  <input
                    type="date"
                    value={incDate}
                    onChange={(e) => setIncDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fonte de Renda / Informações
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Salário PM, Pró-labore..."
                    value={incDescription}
                    onChange={(e) => setIncDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor Recebido (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={incAmountStr}
                    onChange={(e) => setIncAmountStr(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              Salvar Lançamento
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
