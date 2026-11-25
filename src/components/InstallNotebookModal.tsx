import React, { useRef, useState } from 'react';
import {
  X,
  Laptop,
  Download,
  Upload,
  Smartphone,
  Copy,
  Check,
  Share2,
} from 'lucide-react';
import { MonthLedger } from '../types/finance';
import { PERMANENT_APP_LINK } from '../data/appVersion';
import {
  downloadWindowsInstallerBatFile,
  downloadStandaloneAppHtmlFile,
} from '../utils/standaloneAppBuilder';

interface InstallNotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
  ledgers: MonthLedger[];
  onImportLedgers: (imported: MonthLedger[]) => void;
  isInstallable?: boolean;
  isInstalled?: boolean;
  onTriggerPWAInstall?: () => Promise<boolean>;
  onShowToast: (msg: string) => void;
}

export const InstallNotebookModal: React.FC<InstallNotebookModalProps> = ({
  isOpen,
  onClose,
  ledgers,
  onImportLedgers,
  onShowToast,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  const directAppUrl =
    typeof window !== 'undefined' &&
    window.location.origin.startsWith('http') &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('127.0.0.1')
      ? window.location.origin
      : PERMANENT_APP_LINK;

  const handleCopyDirectLink = async () => {
    try {
      await navigator.clipboard.writeText(directAppUrl);
      setCopiedLink(true);
      onShowToast(
        'Link copiado! Cole no navegador do seu iPhone ou Tablet e salve a página na tela de início.'
      );
      window.setTimeout(() => setCopiedLink(false), 3500);
    } catch {
      onShowToast(`Link direto: ${directAppUrl}`);
    }
  };

  // Export complete JSON Backup
  const handleExportJSONBackup = () => {
    const jsonStr = JSON.stringify(ledgers, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `domus-backup-completo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('Backup completo (.json) salvo no seu computador.');
  };

  // Import JSON Backup
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || ''));
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].monthKey) {
          onImportLedgers(parsed);
          onShowToast(`Backup restaurado e sincronizado na nuvem (${parsed.length} mês/meses).`);
          onClose();
        } else {
          onShowToast('Arquivo JSON inválido. Selecione um backup gerado pelo Domus.');
        }
      } catch {
        onShowToast('Erro ao ler o arquivo de backup.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <img
              src="/domus-logo.png?v=2"
              alt="Domus Finanças"
              className="w-9 h-9 rounded-lg object-cover border border-slate-200 shadow-2xs shrink-0"
            />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Instalação — PC, iPhone e Tablet
              </h2>
              <p className="text-xs text-slate-500">
                Com o ícone oficial Domus Finanças · Sincronizado na nuvem
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Opção 1: Instalação em PC / Notebook (Gera o arquivo .bat) */}
          <div className="p-5 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                <Laptop className="w-4 h-4 text-emerald-700" />
                1. Instalação em PC / Notebook (Arquivo .bat)
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded">
                Windows
              </span>
            </div>
            <p className="text-xs text-emerald-900 leading-relaxed">
              Gera o arquivo instalador para o seu computador. Ao executar, cria o aplicativo na Área de Trabalho e na Barra de Início com o ícone oficial Domus Finanças.
            </p>
            <button
              type="button"
              onClick={() => downloadWindowsInstallerBatFile(ledgers, onShowToast)}
              className="w-full py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs"
            >
              <Download className="w-4 h-4" />
              <span>Baixar Instalador PC / Notebook (.bat)</span>
            </button>
          </div>

          {/* Opção 2: Acesso para iPhone e Tablet (Copiar Link ou App Portátil) */}
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-slate-800" />
                2. Acesso para iPhone e Tablet (Link ou App Portátil)
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-white rounded">
                Celular / Tablet
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Copie o link abaixo, cole no navegador do seu iPhone, Tablet ou outro computador e salve a página na tela de início:
            </p>

            <div className="p-2.5 bg-white border border-slate-300 rounded-lg font-mono text-xs text-slate-800 truncate select-all">
              {directAppUrl}
            </div>

            <button
              type="button"
              onClick={handleCopyDirectLink}
              className="w-full py-2.5 px-4 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Link Copiado! Cole no Navegador</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copiar Link para iPhone / Tablet</span>
                </>
              )}
            </button>

            <div className="pt-2 border-t border-slate-200 space-y-1.5">
              <p className="text-[11px] text-emerald-900 font-semibold">
                Ou baixe o App Portátil para Celular (.html) — envia por WhatsApp/Arquivos e abre direto sem precisar de nenhum link:
              </p>
              <button
                type="button"
                onClick={() => downloadStandaloneAppHtmlFile(ledgers, onShowToast)}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs"
              >
                <Share2 className="w-4 h-4" />
                <span>Baixar App Portátil para Celular (.html)</span>
              </button>
            </div>
          </div>

          {/* Opção 3: Backup Manual JSON */}
          <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Cópia de Segurança (.json)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Exportar ou restaurar cópia local das contas da família.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportJSONBackup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar .json
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                Restaurar .json
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
