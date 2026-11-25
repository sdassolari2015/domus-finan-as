import React, { useState, useEffect } from 'react';
import {
  Cloud,
  RefreshCw,
  LogIn,
  ShieldCheck,
  UserCheck,
  Lock,
  Laptop,
  Download,
  Smartphone,
  Copy,
  Check,
  Sparkles,
  Share2,
} from 'lucide-react';
import { FamilyMember, MonthLedger } from '../types/finance';
import { signInWithGooglePopup } from '../services/firebase';
import {
  downloadWindowsInstallerBatFile,
  downloadStandaloneAppHtmlFile,
  buildStandaloneAppHTML,
} from '../utils/standaloneAppBuilder';
import {
  CURRENT_APP_VERSION,
  PERMANENT_APP_LINK,
  ensureStandaloneOfflineCache,
} from '../data/appVersion';
import { AppUpdateBannerModal } from './AppUpdateBannerModal';

export interface LoggedUserSession {
  name: string;
  role: FamilyMember;
  email?: string | null;
  loginTime: string;
}

interface LoginScreenProps {
  onLoginSuccess: (session: LoggedUserSession) => Promise<void>;
  ledgers: MonthLedger[];
  lastCloudAction?: string;
  lastCloudTime?: Date | null;
}

type LoginCardTab = 'login' | 'install';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  ledgers,
  lastCloudAction,
  lastCloudTime,
}) => {
  const [activeCardTab, setActiveCardTab] = useState<LoginCardTab>('login');
  const [selectedMember, setSelectedMember] = useState<'Rodolfo' | 'Viviane'>('Rodolfo');
  const [accessPin, setAccessPin] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStepText, setSyncStepText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAltLink, setCopiedAltLink] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [standaloneReady, setStandaloneReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    ensureStandaloneOfflineCache().then((ok) => {
      if (mounted && ok) {
        setStandaloneReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Always prefer the permanent Vercel production domain for mobile & other computers
  const primaryMobileLink = PERMANENT_APP_LINK;

  // Secondary shared link
  const sharedPublicLink =
    typeof window !== 'undefined' &&
    window.location.origin.startsWith('http') &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('127.0.0.1') &&
    !window.location.origin.includes('vercel.app')
      ? window.location.origin
      : 'https://domus-finan-as.vercel.app';

  const handleCopyPermanentLink = async () => {
    try {
      await navigator.clipboard.writeText(primaryMobileLink);
      setCopiedLink(true);
      setDownloadNotice(
        'Link Principal copiado! Cole no navegador do seu celular (com a mesma conta Google) ou use o Aplicativo Portátil abaixo que não precisa de link.'
      );
      window.setTimeout(() => setCopiedLink(false), 3500);
    } catch {
      setDownloadNotice(`Copie o link: ${primaryMobileLink}`);
    }
  };

  const handleCopyAltLink = async () => {
    try {
      await navigator.clipboard.writeText(sharedPublicLink);
      setCopiedAltLink(true);
      setDownloadNotice(
        'Link Compartilhado (ais-pre) copiado! Cole no navegador do seu celular.'
      );
      window.setTimeout(() => setCopiedAltLink(false), 3500);
    } catch {
      setDownloadNotice(`Copie o link: ${sharedPublicLink}`);
    }
  };

  const handleShareOrDownloadMobileApp = async () => {
    try {
      const htmlContent = buildStandaloneAppHTML(ledgers);
      const file = new File([htmlContent], 'Domus-Financas-Celular.html', {
        type: 'text/html',
      });
      if (
        typeof navigator !== 'undefined' &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: 'Domus Finanças — App Independente',
          text: 'Abra este arquivo no iPhone / Celular para usar o Domus Finanças 100% independente de link!',
          files: [file],
        });
        setDownloadNotice(
          'Arquivo do App enviado! No celular, basta tocar nele para abrir o Domus Finanças com nuvem 24h sem depender de nenhum link.'
        );
        return;
      }
    } catch {
      // Fallback to direct download
    }
    downloadStandaloneAppHtmlFile(ledgers, (msg) => setDownloadNotice(msg));
  };

  const handleFamilyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSyncing(true);
    setSyncStepText('Autenticando e buscando lançamentos mais recentes na nuvem...');

    try {
      await onLoginSuccess({
        name: selectedMember,
        role: selectedMember,
        email:
          selectedMember === 'Rodolfo'
            ? 'rodolfo@domus.familia'
            : 'viviane@domus.familia',
        loginTime: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } catch {
      setErrorMsg(
        'Não foi possível sincronizar online no momento. Entrando com os dados salvos no aparelho.'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setIsSyncing(true);
    setSyncStepText('Autenticando com Google e baixando dados mais atuais da nuvem...');

    try {
      const user = await signInWithGooglePopup();
      const displayName = user.displayName || user.email?.split('@')[0] || selectedMember;
      const inferredRole: FamilyMember = displayName
        .toLowerCase()
        .includes('viviane')
        ? 'Viviane'
        : 'Rodolfo';

      await onLoginSuccess({
        name: displayName,
        role: inferredRole,
        email: user.email,
        loginTime: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } catch {
      await onLoginSuccess({
        name: selectedMember,
        role: selectedMember,
        loginTime: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Barra automática de Nova Versão e Modal de Atualizações */}
      <AppUpdateBannerModal
        externalOpenModal={versionModalOpen}
        onCloseExternalModal={() => setVersionModalOpen(false)}
      />

      <div className="flex-1 flex flex-col justify-between p-4 sm:p-8">
        {/* Topo Minimalista */}
        <div className="max-w-md w-full mx-auto pt-1 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <img
              src="/domus-logo.png?v=2"
              alt="Domus Finanças"
              className="w-7 h-7 rounded-md object-cover border border-slate-200 shadow-2xs"
            />
            <span className="font-bold text-slate-900 text-sm tracking-tight">
              Domus Finanças
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVersionModalOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono font-semibold text-[11px] transition-colors"
              title="Ver novidades e atualizações desta versão"
            >
              <Sparkles className="w-3 h-3 text-emerald-600" />
              <span>v{CURRENT_APP_VERSION}</span>
            </button>
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <Cloud className="w-3.5 h-3.5" />
              Nuvem Ativa
            </span>
          </div>
        </div>

        {/* Card Principal com 2 Abas: Entrar | Instalação */}
        <div className="max-w-md w-full mx-auto my-4 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          {/* Cabeçalho da Marca */}
          <div className="p-6 pb-4 flex items-center gap-4">
            <img
              src="/domus-logo.png?v=2"
              alt="Ícone Domus Finanças"
              className="w-14 h-14 rounded-xl object-cover border border-slate-200 shadow-xs shrink-0"
            />
            <div>
              <p className="text-xs font-semibold text-emerald-700">
                Gestão Financeira Residencial
              </p>
              <h1 className="text-xl font-bold text-slate-900 mt-0.5 tracking-tight">
                Domus Finanças
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Sincronização automática em nuvem
              </p>
            </div>
          </div>

          {/* Seletor das 2 Abas: 1. Entrar no App | 2. Instalação */}
          <div className="px-6 border-b border-slate-200 bg-slate-50/70">
            <div className="grid grid-cols-2 gap-2 py-2">
              <button
                type="button"
                onClick={() => {
                  setActiveCardTab('login');
                  setDownloadNotice(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  activeCardTab === 'login'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Entrar no App</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveCardTab('install');
                  setErrorMsg(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  activeCardTab === 'install'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Laptop className="w-3.5 h-3.5" />
                <span>Instalação</span>
              </button>
            </div>
          </div>

          {/* Conteúdo da Aba Selecionada */}
          <div className="p-6 space-y-4">
            {errorMsg && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                {errorMsg}
              </div>
            )}

            {downloadNotice && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 font-medium">
                {downloadNotice}
              </div>
            )}

            {activeCardTab === 'login' ? (
              /* ==================== ABA 1: ENTRAR NO APP ==================== */
              <>
                {lastCloudAction && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-0.5">
                    <div className="flex items-center justify-between text-slate-500">
                      <span>Última atividade na nuvem</span>
                      {lastCloudTime && (
                        <span className="font-mono tabular-nums text-slate-600">
                          {lastCloudTime.toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-slate-800 truncate">
                      {lastCloudAction}
                    </p>
                  </div>
                )}

                <form onSubmit={handleFamilyLogin} className="space-y-4">
                  {/* Seleção de Perfil da Família */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">
                      Selecione seu Perfil de Acesso
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={isSyncing}
                        onClick={() => setSelectedMember('Rodolfo')}
                        className={`p-3.5 rounded-xl border text-left transition-all ${
                          selectedMember === 'Rodolfo'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold">Rodolfo</span>
                          <UserCheck
                            className={`w-4 h-4 ${
                              selectedMember === 'Rodolfo'
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          />
                        </div>
                        <span
                          className={`block text-[11px] mt-1 ${
                            selectedMember === 'Rodolfo'
                              ? 'text-slate-300'
                              : 'text-slate-500'
                          }`}
                        >
                          Titular · Família
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isSyncing}
                        onClick={() => setSelectedMember('Viviane')}
                        className={`p-3.5 rounded-xl border text-left transition-all ${
                          selectedMember === 'Viviane'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold">Viviane</span>
                          <UserCheck
                            className={`w-4 h-4 ${
                              selectedMember === 'Viviane'
                                ? 'text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          />
                        </div>
                        <span
                          className={`block text-[11px] mt-1 ${
                            selectedMember === 'Viviane'
                              ? 'text-slate-300'
                              : 'text-slate-500'
                          }`}
                        >
                          Titular · Família
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Campo opcional de Senha/PIN */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="pin-input"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Senha / PIN de Acesso (Opcional)
                      </label>
                      <span className="text-[11px] text-slate-400">
                        Acesso familiar direto
                      </span>
                    </div>
                    <div className="relative">
                      <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="pin-input"
                        type="password"
                        placeholder="Digite sua senha ou clique em Entrar direto"
                        value={accessPin}
                        disabled={isSyncing}
                        onChange={(e) => setAccessPin(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                  </div>

                  {/* Botão Principal de Entrar */}
                  <button
                    type="submit"
                    disabled={isSyncing}
                    className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs"
                  >
                    {isSyncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{syncStepText}</span>
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Entrar como {selectedMember}</span>
                      </>
                    )}
                  </button>
                </form>

                {/* Autenticação Google secundária */}
                <div className="pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={handleGoogleLogin}
                    className="w-full py-2.5 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
                    <span>Entrar com Conta Google</span>
                  </button>
                </div>
              </>
            ) : (
              /* ==================== ABA 2: INSTALAÇÃO (PC / NOTEBOOK E IPHONE / TABLET) ==================== */
              <div className="space-y-4">
                <div className="p-2.5 bg-emerald-950 text-emerald-100 rounded-lg text-[11px] flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {standaloneReady
                      ? '✓ Desvinculado do AI Studio (Cache Standalone Ativo)'
                      : '✓ Modo Independente 24h (Sem precisar abrir o AI Studio)'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-800 text-emerald-200 font-mono text-[10px]">
                    100% Autônomo
                  </span>
                </div>

                {/* Opção 1: Link de Instalação em PC / Notebook (Gera o arquivo .bat / .bak) */}
                <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Laptop className="w-4 h-4 text-emerald-800 shrink-0" />
                      <h2 className="text-xs font-bold text-emerald-950">
                        1. Instalação em PC / Notebook
                      </h2>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded">
                      Arquivo .bat
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-900 leading-relaxed">
                    Clique abaixo para gerar e baixar o instalador do computador. Ele instala um motor próprio no seu Windows que abre o sistema direto em tela cheia com a logo oficial, mesmo com o AI Studio fechado.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      downloadWindowsInstallerBatFile(ledgers, (msg) =>
                        setDownloadNotice(msg)
                      )
                    }
                    className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-2xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Baixar Instalador PC / Notebook (.bat)</span>
                  </button>
                </div>

                {/* Opção 2: Link para iPhone, Tablet e Outros Navegadores */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-slate-800 shrink-0" />
                      <h2 className="text-xs font-bold text-slate-900">
                        2. Acesso para iPhone e Celular
                      </h2>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-white rounded">
                      Celular / Tablet
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Copie o link abaixo, cole no navegador do seu celular (estando logado no Google) e salve na Tela de Início:
                  </p>

                  {/* Link Principal */}
                  <div className="p-2.5 bg-white border border-slate-300 rounded-lg font-mono text-[11px] text-slate-800 truncate select-all">
                    {primaryMobileLink}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCopyPermanentLink}
                      className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Link Principal Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar Link Principal</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyAltLink}
                      className="w-full py-2.5 px-3 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      {copiedAltLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Link 2 Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar Link Público (Opção 2)</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <p className="text-[11px] text-emerald-900 font-semibold">
                      Se o link pedir login do Google no celular, baixe/envie o App Portátil abaixo (abre direto no celular pelo WhatsApp / Arquivos sem depender de nenhum link):
                    </p>
                    <button
                      type="button"
                      onClick={handleShareOrDownloadMobileApp}
                      className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-2xs"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Baixar / Enviar App Direto para Celular (.html)</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="max-w-md w-full mx-auto text-center text-[11px] text-slate-400 pb-2">
          Domus Finanças v{CURRENT_APP_VERSION} · Desvinculado do AI Studio · Nuvem 24h
        </div>
      </div>
    </div>
  );
};
