import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  MessageSquare,
  Upload,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Copy,
  Check,
  Smartphone,
  ArrowUpRight,
  ArrowDownLeft,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  AccountBlockId,
  BoletoSubType,
  ExpenseCategory,
  ExpenseItem,
  FamilyMember,
  IncomeItem,
  MonthLedger,
} from '../types/finance';
import { getEffectiveBlocks } from '../data/initialData';
import { formatCurrency, formatDateBR } from '../utils/formatters';

export interface ParsedReceiptPayload {
  transactionType: 'expense' | 'income';
  action: 'create' | 'mark_existing_paid';
  matchedExistingExpenseId: string | null;
  matchedExistingDescription: string | null;
  description: string;
  amount: number;
  date: string;
  status: 'Pago' | 'Pendente';
  blockId: AccountBlockId;
  boletoSubType: BoletoSubType;
  category: ExpenseCategory;
  currentInstallment: number | null;
  totalInstallments: number | null;
  person: FamilyMember;
  confidenceNote: string;
  destinationLabel: string;
}

export interface WhatsAppInboxItemClient {
  id: string;
  receivedAt: string;
  fromPhoneMasked: string;
  senderName: string;
  rawMessagePreview: string;
  hasMedia: boolean;
  parsed: ParsedReceiptPayload;
}

interface WhatsAppServerStatus {
  connected: boolean;
  hasAccessToken: boolean;
  hasPhoneNumberId: boolean;
  hasVerifyToken: boolean;
  hasAllowedPhones: boolean;
  hasGeminiKey: boolean;
  metaTokenValid?: boolean | null;
  metaPhoneDisplay?: string | null;
  metaVerifiedName?: string | null;
  metaError?: string | null;
  pendingInboxCount: number;
  webhookPath: string;
}

interface FeedEntry {
  id: string;
  timestamp: string;
  source: 'local' | 'whatsapp';
  inputSummary: string;
  parsed: ParsedReceiptPayload;
  applied: boolean;
}

interface WhatsAppPixModalProps {
  isOpen: boolean;
  onClose: () => void;
  ledger: MonthLedger;
  loggedUserName: string;
  pendingWhatsAppItems: WhatsAppInboxItemClient[];
  onApplyParsedTransaction: (
    parsed: ParsedReceiptPayload,
    sourceLabel: string
  ) => void;
  onAcknowledgeWhatsAppItem: (id: string) => Promise<void>;
  onNavigateToDestination: (parsed: ParsedReceiptPayload) => void;
  onShowToast: (msg: string) => void;
}

export const WhatsAppPixModal: React.FC<WhatsAppPixModalProps> = ({
  isOpen,
  onClose,
  ledger,
  loggedUserName,
  pendingWhatsAppItems,
  onApplyParsedTransaction,
  onAcknowledgeWhatsAppItem,
  onNavigateToDestination,
  onShowToast,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'inbox' | 'connect'>('inbox');
  const [messageText, setMessageText] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<{
    name: string;
    mimeType: string;
    base64: string;
    dataUrl: string;
  } | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<{
    inputSummary: string;
    parsed: ParsedReceiptPayload;
  } | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [waStatus, setWaStatus] = useState<WhatsAppServerStatus | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [testPhoneInput, setTestPhoneInput] = useState('5543996040935');
  const [newTokenInput, setNewTokenInput] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResultMsg, setTestResultMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/whatsapp/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setWaStatus(data);
      })
      .catch(() => {});
  }, [isOpen, pendingWhatsAppItems.length]);

  if (!isOpen) return null;

  const effectiveBlocks = getEffectiveBlocks(ledger);
  const webhookUrl = 'https://domus-finan-as.vercel.app/api/whatsapp/webhook';

  const readFileAsAttachment = (file: File) => {
    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'application/pdf',
    ];
    const mime = file.type.toLowerCase();
    if (!allowed.includes(mime)) {
      setErrorMsg('Envie uma imagem (PNG, JPG, WEBP) ou PDF do comprovante PIX.');
      return;
    }
    if (file.size > 7 * 1024 * 1024) {
      setErrorMsg('Arquivo muito grande. Envie um comprovante de até 7 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setAttachmentPreview({
        name: file.name || 'comprovante-pix',
        mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
        base64,
        dataUrl,
      });
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readFileAsAttachment(file);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          readFileAsAttachment(file);
          return;
        }
      }
    }
  };

  const handleAnalyzeAndSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedText = messageText.trim();
    if (!trimmedText && !attachmentPreview) {
      setErrorMsg('Anexe um comprovante PIX ou digite uma mensagem de gasto/entrada.');
      return;
    }

    setErrorMsg(null);
    setIsAnalyzing(true);

    try {
      const res = await fetch('/api/receipt/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmedText || undefined,
          imageBase64: attachmentPreview?.base64 || undefined,
          imageMimeType: attachmentPreview?.mimeType || undefined,
          activeMonthKey: ledger.monthKey,
          defaultPerson: loggedUserName,
          blocks: effectiveBlocks.map((b) => ({
            id: b.id,
            shortName: b.shortName,
            fullTitle: b.fullTitle,
            group: b.group,
          })),
          existingExpenses: ledger.expenses.map((exp) => ({
            id: exp.id,
            description: exp.description,
            amount: exp.amount,
            dueDate: exp.dueDate,
            status: exp.status,
            blockId: exp.blockId,
            category: exp.category,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.parsed) {
        throw new Error(
          data?.error || 'Não foi possível ler o comprovante ou mensagem agora.'
        );
      }

      const parsed: ParsedReceiptPayload = data.parsed;
      const inputSummary = attachmentPreview
        ? trimmedText
          ? `Comprovante (${attachmentPreview.name}) · "${trimmedText}"`
          : `Comprovante PIX (${attachmentPreview.name})`
        : trimmedText;

      setMessageText('');
      setAttachmentPreview(null);

      if (autoLaunch && parsed.amount > 0) {
        onApplyParsedTransaction(parsed, 'PIX/Mensagem');
        setFeed((prev) => [
          {
            id: `feed-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            source: 'local',
            inputSummary,
            parsed,
            applied: true,
          },
          ...prev,
        ]);
      } else {
        setPendingReview({ inputSummary, parsed });
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Erro ao ler o comprovante. Tente novamente.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmPendingReview = (forceCreateNew = false) => {
    if (!pendingReview) return;
    const finalParsed: ParsedReceiptPayload = forceCreateNew
      ? {
          ...pendingReview.parsed,
          action: 'create',
          matchedExistingExpenseId: null,
          matchedExistingDescription: null,
        }
      : pendingReview.parsed;

    onApplyParsedTransaction(finalParsed, 'PIX/Mensagem');
    setFeed((prev) => [
      {
        id: `feed-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        source: 'local',
        inputSummary: pendingReview.inputSummary,
        parsed: finalParsed,
        applied: true,
      },
      ...prev,
    ]);
    setPendingReview(null);
  };

  const handleApplyWhatsAppQueueItem = async (item: WhatsAppInboxItemClient) => {
    onApplyParsedTransaction(item.parsed, `WhatsApp (${item.senderName})`);
    await onAcknowledgeWhatsAppItem(item.id);
    setFeed((prev) => [
      {
        id: item.id,
        timestamp: new Date(item.receivedAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        source: 'whatsapp',
        inputSummary: `${item.senderName}: ${item.rawMessagePreview}`,
        parsed: item.parsed,
        applied: true,
      },
      ...prev,
    ]);
  };

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      onShowToast('URL do Webhook do WhatsApp copiada!');
      window.setTimeout(() => setCopiedWebhook(false), 3000);
    } catch {
      onShowToast(`URL do Webhook: ${webhookUrl}`);
    }
  };

  const handleSendTestWhatsApp = async () => {
    const cleanPhone = testPhoneInput.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      setTestResultMsg({
        ok: false,
        text: 'Informe seu número com DDI 55 e DDD (ex: 5543996040935).',
      });
      return;
    }
    setIsSendingTest(true);
    setTestResultMsg(null);
    try {
      const res = await fetch('/api/whatsapp/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: cleanPhone,
          newAccessToken: newTokenInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      // Refresh status banner
      fetch('/api/whatsapp/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => {
          if (st) setWaStatus(st);
        })
        .catch(() => {});

      if (data?.ok) {
        setNewTokenInput('');
        setTestResultMsg({
          ok: true,
          text: 'Token atualizado e mensagem de teste enviada com sucesso pela Meta! Verifique seu WhatsApp.',
        });
        onShowToast('Mensagem de teste enviada para seu WhatsApp!');
      } else {
        const firstErr =
          Array.isArray(data?.attempts) && data.attempts[0]?.response?.error?.message
            ? data.attempts[0].response.error.message
            : data?.error || 'A Meta recusou o envio.';
        setTestResultMsg({
          ok: false,
          text: `Retorno da Meta: ${firstErr}`,
        });
      }
    } catch (err) {
      setTestResultMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Erro ao testar envio.',
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const quickExamples = [
    'Paguei 185,50 no mercado hoje via PIX',
    'Cartão NuBank 149,90 farmácia',
    'Recebi 850,00 extra do Rodolfo',
    'PIX 210,00 conta de luz',
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
      onPaste={handlePaste}
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-emerald-950 text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-700 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold tracking-tight">
                Lançamento Rápido via PIX &amp; WhatsApp
              </h2>
              <p className="text-xs text-emerald-200">
                Envie um comprovante PIX (print/foto/PDF) ou mensagem — lança direto no local exato de {ledger.label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-emerald-200 hover:text-white rounded-lg transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('inbox')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeSubTab === 'inbox'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Enviar PIX / Mensagem</span>
              {pendingWhatsAppItems.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-amber-400 text-slate-950 font-mono">
                  {pendingWhatsAppItems.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('connect')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeSubTab === 'connect'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Conectar Número WhatsApp</span>
              {waStatus?.connected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>

          {activeSubTab === 'inbox' && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoLaunch}
                onChange={(e) => setAutoLaunch(e.target.checked)}
                className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span className="font-medium">Lançar automático sem confirmar</span>
            </label>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeSubTab === 'inbox' ? (
            <>
              {/* Pending items arriving directly from connected real WhatsApp number */}
              {pendingWhatsAppItems.length > 0 && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-950">
                      Recebidos do seu Número no WhatsApp ({pendingWhatsAppItems.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pendingWhatsAppItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 bg-white border border-emerald-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="text-xs space-y-0.5">
                          <div className="font-bold text-slate-900">
                            {item.parsed.description} ·{' '}
                            <span className="font-mono text-emerald-800">
                              {formatCurrency(item.parsed.amount)}
                            </span>
                          </div>
                          <div className="text-slate-600">
                            Local: <strong>{item.parsed.destinationLabel}</strong>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            De {item.senderName} ({item.fromPhoneMasked}) · {item.rawMessagePreview}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleApplyWhatsAppQueueItem(item)}
                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg whitespace-nowrap"
                        >
                          Lançar na Planilha
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error feedback */}
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Pending Review Card (when autoLaunch is OFF or value is 0) */}
              {pendingReview && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                        Confirme o local exato antes de lançar
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                        {pendingReview.parsed.description} —{' '}
                        <span className="font-mono text-emerald-800">
                          {formatCurrency(pendingReview.parsed.amount)}
                        </span>
                      </h3>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-bold rounded ${
                        pendingReview.parsed.transactionType === 'income'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-900 text-white'
                      }`}
                    >
                      {pendingReview.parsed.transactionType === 'income'
                        ? 'Entrada'
                        : pendingReview.parsed.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-white p-3 rounded-lg border border-amber-200">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Destino na Planilha</span>
                      <strong className="text-slate-900">
                        {pendingReview.parsed.destinationLabel}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Data &amp; Categoria</span>
                      <strong className="text-slate-900">
                        {formatDateBR(pendingReview.parsed.date)} · {pendingReview.parsed.category}
                      </strong>
                    </div>
                  </div>

                  <p className="text-[11px] text-amber-900">
                    {pendingReview.parsed.confidenceNote}
                  </p>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingReview(null)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    {pendingReview.parsed.action === 'mark_existing_paid' && (
                      <button
                        type="button"
                        onClick={() => handleConfirmPendingReview(true)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                      >
                        Criar como Nova Conta
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleConfirmPendingReview(false)}
                      className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                    >
                      {pendingReview.parsed.action === 'mark_existing_paid'
                        ? 'Confirmar Baixa (Marcar Pago)'
                        : 'Confirmar e Lançar na Planilha'}
                    </button>
                  </div>
                </div>
              )}

              {/* Input Box — Upload PIX Receipt or Type Quick Message */}
              <form onSubmit={handleAnalyzeAndSubmit} className="space-y-3">
                {/* Comprovante PIX Upload / Paste Dropzone */}
                <div className="p-3.5 bg-slate-50 border border-dashed border-slate-300 rounded-xl">
                  {attachmentPreview ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {attachmentPreview.mimeType === 'application/pdf' ? (
                          <div className="w-12 h-12 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                            <FileText className="w-6 h-6 text-red-600" />
                          </div>
                        ) : (
                          <img
                            src={attachmentPreview.dataUrl}
                            alt="Prévia do comprovante PIX"
                            className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {attachmentPreview.name}
                          </p>
                          <p className="text-[11px] text-emerald-700 font-medium">
                            Comprovante PIX pronto para leitura automática
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachmentPreview(null)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                        title="Remover anexo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                          <Upload className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Anexar Comprovante PIX (Print, Foto ou PDF)
                          </p>
                          <p className="text-[11px] text-slate-500">
                            No PC você também pode dar <strong className="font-mono">Ctrl+V</strong> direto em um print copiado do WhatsApp
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold whitespace-nowrap shrink-0"
                      >
                        Escolher Arquivo
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleFileInputChange}
                        className="hidden"
                      />
                    </div>
                  )}
                </div>

                {/* Message Input */}
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    value={messageText}
                    disabled={isAnalyzing}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Escreva uma saída ou entrada (ex: Paguei 185,50 mercado, Recebi 1200 extra)..."
                    className="flex-1 px-3.5 py-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                  <button
                    type="submit"
                    disabled={isAnalyzing || (!messageText.trim() && !attachmentPreview)}
                    className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Lendo...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Lançar Agora</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Quick Example Chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 mr-1">Exemplos rápidos:</span>
                  {quickExamples.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setMessageText(ex)}
                      className="text-[11px] px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </form>

              {/* Recent Launches Feed */}
              <div className="pt-2 border-t border-slate-200 space-y-2.5">
                <h3 className="text-xs font-bold text-slate-700">
                  Lançamentos feitos por Comprovante / Mensagem ({feed.length})
                </h3>
                {feed.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                    Envie um print de comprovante PIX ou digite uma mensagem acima. O sistema identifica se é <strong>Entrada</strong>, <strong>Cartão/Conta</strong>, <strong>Despesa Fixa</strong>, <strong>Gasto Mensal</strong> ou <strong>Parcelamento</strong> e grava direto na nuvem.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {feed.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {entry.parsed.transactionType === 'income' ? (
                              <ArrowDownLeft className="w-4 h-4 text-emerald-700 shrink-0" />
                            ) : (
                              <ArrowUpRight className="w-4 h-4 text-red-600 shrink-0" />
                            )}
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {entry.parsed.description}
                            </span>
                            <span
                              className={`font-mono text-xs font-bold ${
                                entry.parsed.transactionType === 'income'
                                  ? 'text-emerald-700'
                                  : 'text-slate-900'
                              }`}
                            >
                              {formatCurrency(entry.parsed.amount)}
                            </span>
                          </div>
                          <div className="text-[11px] text-emerald-900 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span>Lançado em: {entry.parsed.destinationLabel}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {entry.timestamp} · {entry.parsed.confidenceNote}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onNavigateToDestination(entry.parsed);
                            onClose();
                          }}
                          className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0"
                        >
                          Ver na Planilha
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ==================== ABA 2: CONECTAR NÚMERO REAL NO WHATSAPP (API OFICIAL META) ==================== */
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                  waStatus?.connected
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-700" />
                    {waStatus?.connected
                      ? 'Número do WhatsApp Conectado e Ativo!'
                      : 'Servidor Oficial do WhatsApp Pronto para Conectar seu Número'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                      waStatus?.connected
                        ? 'bg-emerald-700 text-white'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {waStatus?.connected ? 'Conectado' : 'Aguardando Número Meta'}
                  </span>
                </div>
                <p className="leading-relaxed text-slate-600">
                  A Meta (dona do WhatsApp) exige que o número seja ativado na conta oficial do <strong>Meta for Developers</strong> (gratuito para uso pessoal/teste). O servidor do Domus já está 100% programado para receber seus comprovantes PIX e responder confirmando o lançamento direto no seu WhatsApp.
                </p>
                {waStatus?.metaPhoneDisplay && (
                  <p className="text-xs font-bold text-emerald-800">
                    Número do Robô Ativo na Meta: {waStatus.metaPhoneDisplay} ({waStatus.metaVerifiedName || 'Test Number'})
                  </p>
                )}
                {waStatus?.metaError && (
                  <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    Aviso da Meta: {waStatus.metaError}
                  </p>
                )}
              </div>

              {/* Test Send Direct to WhatsApp & Instant Token Update */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2.5">
                <label className="block text-xs font-bold text-slate-900">
                  Atualizar Token da Meta e Testar no seu WhatsApp Agora
                </label>
                <input
                  type="password"
                  value={newTokenInput}
                  onChange={(e) => setNewTokenInput(e.target.value)}
                  placeholder="Se o token expirou, cole aqui o novo Token da Meta (EAA...) para atualizar sem ir na Vercel"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg"
                />
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={testPhoneInput}
                    onChange={(e) => setTestPhoneInput(e.target.value)}
                    placeholder="5543996040935"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={isSendingTest}
                    onClick={() => void handleSendTestWhatsApp()}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 shrink-0"
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>{newTokenInput.trim() ? 'Salvar Token e Testar' : 'Testar no Meu WhatsApp'}</span>
                      </>
                    )}
                  </button>
                </div>
                {testResultMsg && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs ${
                      testResultMsg.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                  >
                    {testResultMsg.text}
                  </div>
                )}
              </div>

              {/* Webhook URL to paste in Meta */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2">
                <label className="block text-xs font-bold text-slate-900">
                  URL de Callback (Webhook) do Domus Finanças
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-2.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-[11px] text-slate-800 truncate select-all">
                    {webhookUrl}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shrink-0"
                  >
                    {copiedWebhook ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 4-Step Guide */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-slate-900">
                  Como ativar seu número gratuito no WhatsApp (4 passos):
                </h3>
                <ol className="space-y-2 text-xs text-slate-700 list-decimal pl-4">
                  <li>
                    Acesse <strong>developers.facebook.com</strong>, crie um aplicativo do tipo <em>Empresa</em> e adicione o produto <strong>WhatsApp</strong> (a Meta libera um número oficial gratuito na hora).
                  </li>
                  <li>
                    No painel lateral do AI Studio, abra <strong>Settings &gt; Secrets</strong> e adicione as variáveis do seu número:
                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-[11px]">
                      <div className="px-2 py-1 bg-slate-50 border border-slate-200 rounded flex items-center justify-between">
                        <span>WHATSAPP_ACCESS_TOKEN</span>
                        <span className={waStatus?.hasAccessToken ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                          {waStatus?.hasAccessToken ? 'OK' : 'Pendente'}
                        </span>
                      </div>
                      <div className="px-2 py-1 bg-slate-50 border border-slate-200 rounded flex items-center justify-between">
                        <span>WHATSAPP_PHONE_NUMBER_ID</span>
                        <span className={waStatus?.hasPhoneNumberId ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                          {waStatus?.hasPhoneNumberId ? 'OK' : 'Pendente'}
                        </span>
                      </div>
                      <div className="px-2 py-1 bg-slate-50 border border-slate-200 rounded flex items-center justify-between">
                        <span>WHATSAPP_VERIFY_TOKEN</span>
                        <span className={waStatus?.hasVerifyToken ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                          {waStatus?.hasVerifyToken ? 'OK' : 'Pendente'}
                        </span>
                      </div>
                      <div className="px-2 py-1 bg-slate-50 border border-slate-200 rounded flex items-center justify-between">
                        <span>WHATSAPP_ALLOWED_PHONES</span>
                        <span className={waStatus?.hasAllowedPhones ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                          {waStatus?.hasAllowedPhones ? 'Ativo' : 'Opcional'}
                        </span>
                      </div>
                    </div>
                  </li>
                  <li>
                    No painel da Meta (<strong>WhatsApp &gt; Configuração &gt; Webhook</strong>), cole a URL acima, informe o mesmo <code>WHATSAPP_VERIFY_TOKEN</code> e marque o campo <strong>messages</strong>.
                  </li>
                  <li>
                    Pronto! Basta mandar foto/PDF de qualquer comprovante PIX ou mensagem para esse número no WhatsApp que ele responde confirmando e lança direto na planilha da família.
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Sincronização direta com a nuvem da família</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
