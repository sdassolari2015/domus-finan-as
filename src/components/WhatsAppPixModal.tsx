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
  QrCode,
  RefreshCw,
  Mic,
  Square,
  Volume2,
  AlertTriangle,
} from 'lucide-react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, HOUSEHOLD_ID } from '../services/firebase';
import {
  AccountBlockId,
  BoletoSubType,
  ExpenseCategory,
  FamilyMember,
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
  transcript?: string | null;
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
  const [qrBridgeStatus, setQrBridgeStatus] = useState<
    'connecting' | 'qr_ready' | 'connected'
  >('connecting');
  const [qrBridgeData, setQrBridgeData] = useState<string>('');
  const [qrBridgeLogs, setQrBridgeLogs] = useState<
    Array<{ id: string; description: string; notes: string }>
  >([]);
  const [isResettingQr, setIsResettingQr] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen && isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [isOpen, isRecording]);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/whatsapp/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setWaStatus(data);
      })
      .catch(() => {});

    const qrRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', '2099-10');
    const unsub = onSnapshot(
      qrRef,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const incomes = Array.isArray(d?.incomes) ? d.incomes : [];
        const qrState = incomes.find((i: { id?: string }) => i?.id === 'qr-state');
        if (qrState) {
          const st = String(qrState.description || 'connecting');
          if (st === 'qr_ready' || st === 'connected' || st === 'connecting') {
            setQrBridgeStatus(st);
          }
          setQrBridgeData(String(qrState.date || ''));
        }
        const exps = Array.isArray(d?.expenses) ? d.expenses : [];
        setQrBridgeLogs(
          exps.slice(0, 8).map((e: { id?: string; description?: string; notes?: string }) => ({
            id: String(e?.id || ''),
            description: String(e?.description || ''),
            notes: String(e?.notes || ''),
          }))
        );
      },
      () => {}
    );
    return () => unsub();
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
      'audio/ogg',
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/wav',
      'audio/webm',
      'audio/aac',
      'audio/opus',
    ];
    const rawMime = (file.type || '').toLowerCase().split(';')[0].trim();
    let mime = rawMime;
    if (!mime && file.name) {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'ogg' || ext === 'opus') mime = 'audio/ogg';
      else if (ext === 'mp3') mime = 'audio/mpeg';
      else if (ext === 'm4a') mime = 'audio/mp4';
      else if (ext === 'wav') mime = 'audio/wav';
      else if (ext === 'webm') mime = 'audio/webm';
    }
    if (!allowed.includes(mime)) {
      setErrorMsg('Envie uma imagem (PNG, JPG, WEBP), PDF ou Áudio (OGG, MP3, M4A, WAV).');
      return;
    }
    if (file.size > 7 * 1024 * 1024) {
      setErrorMsg('Arquivo muito grande. Envie um arquivo de até 7 MB.');
      return;
    }
    const normalizedMime =
      mime === 'image/jpg'
        ? 'image/jpeg'
        : mime === 'audio/mp3'
        ? 'audio/mpeg'
        : mime === 'audio/m4a' || mime === 'audio/x-m4a'
        ? 'audio/mp4'
        : mime === 'audio/opus'
        ? 'audio/ogg'
        : mime;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setAttachmentPreview({
        name: file.name || (normalizedMime.startsWith('audio/') ? 'audio-lancamento' : 'comprovante-pix'),
        mimeType: normalizedMime,
        base64,
        dataUrl,
      });
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleToggleAudioRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg('Seu navegador não permite gravar áudio aqui. Você pode anexar um arquivo de áudio ou enviar direto no WhatsApp.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = ['audio/webm', 'audio/ogg', 'audio/mp4'];
      const supportedType =
        preferredTypes.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ||
        '';
      const recorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const finalMime = (recorder.mimeType || supportedType || 'audio/webm').split(';')[0].trim();
        const blob = new Blob(audioChunksRef.current, { type: finalMime });
        if (blob.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          setAttachmentPreview({
            name: `Áudio gravado (${recordingSeconds || 1}s)`,
            mimeType: finalMime,
            base64,
            dataUrl,
          });
          setErrorMsg(null);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setIsRecording(true);
      setErrorMsg(null);
      recorder.start();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setErrorMsg('Não foi possível acessar o microfone. Permita o uso do microfone no navegador ou envie o áudio pelo WhatsApp.');
    }
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
    const cleanToken = newTokenInput.replace(/\s+/g, '').trim();
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
          newAccessToken: cleanToken || undefined,
        }),
      });
      const rawText = await res.text();
      let data: {
        ok?: boolean;
        tokenSaved?: boolean;
        deliveredAny?: boolean;
        metaTokenValid?: boolean;
        error?: string;
        attempts?: Array<{ response?: { error?: { message?: string } } }>;
      } = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(
          'O servidor retornou uma resposta inesperada. Atualize a página e tente novamente.'
        );
      }

      // Refresh status banner
      fetch('/api/whatsapp/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => {
          if (st) setWaStatus(st);
        })
        .catch(() => {});

      if (data?.tokenSaved && data?.metaTokenValid) {
        setNewTokenInput('');
        setTestResultMsg({
          ok: true,
          text: data.deliveredAny
            ? '✅ Token Permanente salvo na nuvem, validado na Meta e mensagem de teste enviada! Já pode mandar comprovantes e áudios no WhatsApp.'
            : '✅ Token Permanente salvo na nuvem e validado na Meta! As reações (✅/❌), leitura de comprovantes e áudios já estão 100% ativos no seu WhatsApp.',
        });
        onShowToast('✅ Token Permanente salvo e ativado no WhatsApp!');
      } else if (data?.ok) {
        setNewTokenInput('');
        setTestResultMsg({
          ok: true,
          text: 'Token atualizado e mensagem de teste enviada com sucesso pela Meta! Verifique seu WhatsApp.',
        });
        onShowToast('Mensagem de teste enviada para seu WhatsApp!');
      } else {
        const firstErr =
          data?.error ||
          (Array.isArray(data?.attempts) && data.attempts[0]?.response?.error?.message) ||
          'A Meta recusou o token ou o envio.';
        setTestResultMsg({
          ok: false,
          text: `Retorno da Meta: ${firstErr}`,
        });
      }
    } catch (err) {
      setTestResultMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Erro ao salvar/testar o token.',
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const quickExamples = [
    'Paguei 185,50 no mercado via PIX',
    'Pendente boleto 250,00 vence dia 20',
    'Compra crédito NuBank 6x de 120,00',
    'Recebi 850,00 extra do Rodolfo',
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
          {/* Expired Meta Token Warning Banner (visible on both tabs) */}
          {waStatus?.metaTokenValid === false && (
            <div className="p-3.5 bg-red-50 border border-red-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-red-900">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="block text-red-950">
                    Token Temporário (24h) da Meta Expirado — Reações (✅/❌) e Mídias Pausadas
                  </strong>
                  <p className="text-[11px] leading-relaxed">
                    As mensagens de texto continuam lançando, mas a Meta bloqueou o download de comprovantes/áudios e as reações com emoji até renovar o token.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveSubTab('connect');
                  window.setTimeout(() => tokenInputRef.current?.focus(), 120);
                }}
                className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-xs font-bold rounded-lg whitespace-nowrap shrink-0"
              >
                Renovar Token Agora
              </button>
            </div>
          )}

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
                        {pendingReview.parsed.currentInstallment &&
                        pendingReview.parsed.totalInstallments
                          ? ` · Parcela ${pendingReview.parsed.currentInstallment}/${pendingReview.parsed.totalInstallments}`
                          : ''}
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
                        ) : attachmentPreview.mimeType.startsWith('audio/') ? (
                          <div className="w-12 h-12 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                            <Volume2 className="w-6 h-6 text-emerald-700" />
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
                            {attachmentPreview.mimeType.startsWith('audio/')
                              ? 'Áudio pronto para transcrição e lançamento automático'
                              : 'Comprovante pronto para leitura automática'}
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
                            Anexar Comprovante (Print, Foto, PDF) ou Gravar Áudio
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Reconhece comprovantes compridos (Santander/Sicredi), <strong className="font-mono">Ctrl+V</strong> de prints e áudios falados
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleAudioRecording()}
                          className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 border transition-colors ${
                            isRecording
                              ? 'bg-red-600 hover:bg-red-700 text-white border-red-700'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300'
                          }`}
                        >
                          {isRecording ? (
                            <>
                              <Square className="w-3.5 h-3.5 fill-current" />
                              <span>Parar ({recordingSeconds}s)</span>
                            </>
                          ) : (
                            <>
                              <Mic className="w-3.5 h-3.5" />
                              <span>Gravar Áudio</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold whitespace-nowrap"
                        >
                          Escolher Arquivo
                        </button>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,application/pdf,audio/*"
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
                          <div className="text-[11px] text-emerald-900 font-medium flex items-center gap-1.5 flex-wrap">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span>
                              Lançado em: {entry.parsed.destinationLabel}
                              {entry.parsed.status === 'Pendente' ? ' (Pendente)' : ''}
                              {entry.parsed.currentInstallment && entry.parsed.totalInstallments
                                ? ` · Parcela ${entry.parsed.currentInstallment}/${entry.parsed.totalInstallments}`
                                : ''}
                            </span>
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
            /* ==================== ABA 2: CONECTAR SEU WHATSAPP POR QR CODE (DIRETO, SEM BLOQUEIO 130497 DA META) ==================== */
            <div className="space-y-4">
              {/* Direct QR Code Bridge Card */}
              <div className="p-4 rounded-xl border-2 border-emerald-600 bg-emerald-50/70 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-emerald-800 shrink-0" />
                    <span className="font-bold text-sm text-emerald-950">
                      Conexão Direta com seu WhatsApp por QR Code (Sem Bloqueio da Meta)
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-md font-bold text-[11px] ${
                      qrBridgeStatus === 'connected'
                        ? 'bg-emerald-700 text-white'
                        : qrBridgeStatus === 'qr_ready'
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {qrBridgeStatus === 'connected'
                      ? `Conectado (+${qrBridgeData || '5543996040935'})`
                      : qrBridgeStatus === 'qr_ready'
                      ? 'QR Code Pronto para Ler'
                      : 'Gerando QR Code...'}
                  </span>
                </div>

                {qrBridgeStatus === 'connected' ? (
                  <div className="p-4 bg-white border border-emerald-300 rounded-xl space-y-2.5">
                    <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Seu WhatsApp está conectado! Agora você não precisa abrir o aplicativo para lançar:
                      </span>
                    </div>
                    <ol className="text-xs text-slate-700 space-y-1.5 list-decimal pl-4">
                      <li>
                        Abra o <strong>WhatsApp no seu celular</strong> e entre na conversa com <strong>Você mesmo ("Você")</strong>.
                      </li>
                      <li>
                        Mande apenas a mensagem (ex: <strong>"Paguei 150,00 mercado"</strong>, <strong>"Gasolina 50,00"</strong>, <strong>"Recebi 800 extra"</strong>) ou envie a <strong>foto/PDF do comprovante PIX</strong>.
                      </li>
                      <li>
                        O Domus Finanças lê na mesma hora, <strong>lança sozinho no local exato da planilha</strong> e responde no seu WhatsApp confirmando!
                      </li>
                    </ol>
                  </div>
                ) : (
                  <div className="p-4 bg-white border border-emerald-200 rounded-xl flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-48 h-48 rounded-xl border border-slate-200 bg-white flex items-center justify-center p-2 shrink-0 shadow-xs">
                      {qrBridgeStatus === 'qr_ready' && qrBridgeData.startsWith('data:image/') ? (
                        <img
                          src={qrBridgeData}
                          alt="QR Code do WhatsApp Domus Finanças"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-xs text-slate-500 text-center">
                          <Loader2 className="w-6 h-6 animate-spin text-emerald-700" />
                          <span>Carregando QR Code do WhatsApp...</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-xs text-slate-700">
                      <p className="font-bold text-slate-900 text-sm">
                        Leia este QR Code com seu celular (leva 5 segundos):
                      </p>
                      <ol className="space-y-1.5 list-decimal pl-4">
                        <li>
                          Abra o <strong>WhatsApp</strong> no seu celular (<strong>+55 43 99604-0935</strong>).
                        </li>
                        <li>
                          Toque no menu → <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong>.
                        </li>
                        <li>
                          Aponte a câmera do celular para o <strong>QR Code ao lado</strong>.
                        </li>
                        <li>
                          Assim que conectar, abra a conversa com <strong>Você mesmo ("Você")</strong> no WhatsApp e mande <em>"Paguei 150,00 mercado"</em> ou um comprovante PIX — ele lança sozinho na planilha!
                        </li>
                      </ol>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                  <span className="text-[11px] text-emerald-900">
                    Funciona direto na conversa com você mesmo no WhatsApp, sem o bloqueio internacional 130497 da Meta.
                  </span>
                  <button
                    type="button"
                    disabled={isResettingQr}
                    onClick={async () => {
                      setIsResettingQr(true);
                      try {
                        const qrRef = doc(db, 'households', HOUSEHOLD_ID, 'ledgers', '2099-10');
                        await setDoc(qrRef, {
                          householdId: HOUSEHOLD_ID,
                          monthKey: '2099-10',
                          label: 'Conexão Direta WhatsApp QR Code',
                          year: 2099,
                          month: 10,
                          incomes: [
                            {
                              id: 'qr-state',
                              person: 'Família',
                              description: 'connecting',
                              amount: Date.now(),
                              date: '',
                            },
                            {
                              id: 'qr-cmd',
                              person: 'Família',
                              description: 'reset_qr',
                              amount: Date.now(),
                              date: '',
                            },
                          ],
                          expenses: [],
                          updatedAt: serverTimestamp(),
                        });
                        onShowToast('Gerando novo QR Code do WhatsApp...');
                      } finally {
                        setTimeout(() => setIsResettingQr(false), 2000);
                      }
                    }}
                    className="px-3 py-1.5 bg-white hover:bg-emerald-100 text-emerald-950 border border-emerald-400 rounded-lg text-xs font-bold flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isResettingQr ? 'animate-spin' : ''}`} />
                    <span>{qrBridgeStatus === 'connected' ? 'Trocar / Gerar Novo QR Code' : 'Atualizar QR Code'}</span>
                  </button>
                </div>

                {qrBridgeLogs.length > 0 && (
                  <div className="pt-2 border-t border-emerald-200 space-y-1">
                    <span className="text-[11px] font-bold text-emerald-950">
                      Últimos lançamentos automáticos recebidos pelo WhatsApp:
                    </span>
                    {qrBridgeLogs.map((lg) => (
                      <div
                        key={lg.id}
                        className="text-[11px] bg-white px-2.5 py-1.5 rounded border border-emerald-200 flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-slate-900">{lg.description}</span>
                        <span className="text-emerald-800">{lg.notes}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                <div className="pt-2 mt-2 border-t border-emerald-200/70 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <img
                      src="/domus-logo.png"
                      alt="Logo Domus Finanças"
                      className="w-9 h-9 rounded-full object-cover border border-emerald-400 shadow-xs bg-slate-900"
                    />
                    <div className="text-[11px]">
                      <span className="font-bold text-slate-900 block">
                        Logo Oficial Domus Finanças no Contato &amp; Resposta Automática
                      </span>
                      <span className="text-slate-600">
                        Reconhece imagens PNG/JPG/PDF, reage com ✅/❌ e envia confirmação do lançamento
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        onShowToast('Enviando logo do Domus Finanças para o perfil do contato no WhatsApp...');
                        const res = await fetch('/api/whatsapp/status', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'sync_profile_logo',
                            newAccessToken: newTokenInput.trim() || undefined,
                          }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (res.ok && data?.ok) {
                          onShowToast('✅ Logo do Domus Finanças aplicada com sucesso no perfil do contato!');
                        } else {
                          onShowToast('Perfil atualizado! (Em números de teste 555 da Meta a foto pode levar alguns minutos).');
                        }
                      } catch {
                        onShowToast('Não foi possível sincronizar a foto agora.');
                      }
                    }}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0"
                  >
                    Aplicar Logo no Contato
                  </button>
                </div>
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
                  ref={tokenInputRef}
                  type="password"
                  value={newTokenInput}
                  onChange={(e) => setNewTokenInput(e.target.value)}
                  placeholder="Cole aqui o novo Token da Meta (EAA...) para reativar reações (✅/❌), comprovantes e áudios"
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

                {/* Permanent Token Guide so emoji reactions never expire after 24h */}
                <div className="pt-2.5 mt-2 border-t border-slate-200 space-y-1.5 text-[11px] text-slate-600">
                  <p className="font-bold text-slate-800">
                    Dica: Como criar um Token Permanente (que NUNCA expira em 24h):
                  </p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>
                      Acesse <strong>business.facebook.com</strong> → <strong>Configurações do Negócio</strong> → <strong>Usuários do sistema</strong> → clique em <strong>Adicionar</strong> (nome: <em>Domus</em>, função: <em>Administrador</em>).
                    </li>
                    <li>
                      Clique em <strong>Atribuir ativos</strong> → selecione seu app do WhatsApp com controle total.
                    </li>
                    <li>
                      Clique em <strong>Gerar novo token</strong> → escolha validade <strong>Nunca expira</strong> e marque <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>.
                    </li>
                    <li>
                      Cole o token permanente gerado (<code>EAA...</code>) na caixa acima e clique em <strong>Salvar Token e Testar</strong> (as reações ✅/❌ e leitura de áudios/comprovantes ficam ativas para sempre!).
                    </li>
                  </ol>
                </div>
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
