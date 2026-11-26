import React, { useState, useEffect } from 'react';
import {
  Cloud,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Sparkles,
  LogOut,
  Send,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { FamilyMember } from '../types/finance';
import {
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  completeGoogleRedirectIfNeeded,
  submitGoogleAccessRequest,
} from '../services/firebase';
import {
  CURRENT_APP_VERSION,
  ensureStandaloneOfflineCache,
} from '../data/appVersion';
import { AppUpdateBannerModal } from './AppUpdateBannerModal';

export interface LoggedUserSession {
  name: string;
  role: FamilyMember;
  email: string;
  photoURL?: string | null;
  isAdmin: boolean;
  loginTime: string;
}

export interface UnauthorizedGoogleUser {
  email: string;
  displayName: string;
  photoURL?: string | null;
}

interface LoginScreenProps {
  isCheckingSession: boolean;
  unauthorizedUser: UnauthorizedGoogleUser | null;
  hasPendingRequestForUnauthorized: boolean;
  onGoogleAuthCompleted: () => Promise<void>;
  onSwitchGoogleAccount: () => Promise<void>;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
    />
  </svg>
);

export const LoginScreen: React.FC<LoginScreenProps> = ({
  isCheckingSession,
  unauthorizedUser,
  hasPendingRequestForUnauthorized,
  onGoogleAuthCompleted,
  onSwitchGoogleAccount,
}) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestJustSent, setRequestJustSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [versionModalOpen, setVersionModalOpen] = useState(false);

  useEffect(() => {
    void ensureStandaloneOfflineCache();
    void completeGoogleRedirectIfNeeded().then((user) => {
      if (user) {
        void onGoogleAuthCompleted();
      }
    });
  }, [onGoogleAuthCompleted]);

  useEffect(() => {
    setRequestJustSent(false);
  }, [unauthorizedUser?.email]);

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setIsAuthenticating(true);
    try {
      await signInWithGooglePopup();
      await onGoogleAuthCompleted();
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      const isTopLevelWindow =
        typeof window !== 'undefined' && window.self === window.top;

      if (
        isTopLevelWindow &&
        (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment')
      ) {
        try {
          await signInWithGoogleRedirect();
          return;
        } catch {
          // Fall through to error message below
        }
      }

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setErrorMsg('Login cancelado. Clique novamente em "Entrar com Conta Google" para continuar.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg('O navegador bloqueou a janela do Google. Permita pop-ups para este site e tente novamente.');
      } else if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'domus-finan-as.vercel.app';
        setErrorMsg(
          `Domínio "${host}" ainda não está na lista de Domínios Autorizados do Firebase (projeto nimble-might-65wls). Adicione "${host}" em Authentication → Settings → Authorized domains para liberar o login.`
        );
      } else {
        setErrorMsg(
          `Não foi possível concluir o login com o Google agora${code ? ` (${code})` : ''}. Verifique sua conexão e tente novamente.`
        );
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRequestAccess = async () => {
    if (!unauthorizedUser) return;
    setErrorMsg(null);
    setIsSubmittingRequest(true);
    try {
      await submitGoogleAccessRequest({
        email: unauthorizedUser.email,
        displayName: unauthorizedUser.displayName,
      });
      setRequestJustSent(true);
    } catch {
      setErrorMsg('Não foi possível enviar sua solicitação agora. Tente novamente.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const alreadyRequested = hasPendingRequestForUnauthorized || requestJustSent;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <AppUpdateBannerModal
        externalOpenModal={versionModalOpen}
        onCloseExternalModal={() => setVersionModalOpen(false)}
      />

      <div className="flex-1 flex flex-col justify-between p-4 sm:p-8">
        {/* Top Bar */}
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
              title="Ver novidades desta versão"
            >
              <Sparkles className="w-3 h-3 text-emerald-600" />
              <span>v{CURRENT_APP_VERSION}</span>
            </button>
            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
              <Cloud className="w-3.5 h-3.5" />
              Protegido
            </span>
          </div>
        </div>

        {/* Main Card */}
        <div className="max-w-md w-full mx-auto my-6 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          {/* Brand Header */}
          <div className="p-6 pb-5 border-b border-slate-100 flex items-center gap-4">
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
                Acesso privado via Conta Google autorizada
              </p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2 leading-relaxed">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {isCheckingSession ? (
              <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
                <RefreshCw className="w-6 h-6 text-emerald-700 animate-spin" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900">
                    Verificando permissão de acesso...
                  </p>
                  <p className="text-xs text-slate-500">
                    Validando sua conta Google na lista de contas aprovadas
                  </p>
                </div>
              </div>
            ) : unauthorizedUser ? (
              /* ==================== CONTA GOOGLE NÃO AUTORIZADA ==================== */
              <div className="space-y-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <h2 className="text-sm font-bold text-red-950">
                        Acesso Bloqueado — Conta Não Aprovada
                      </h2>
                      <p className="text-xs text-red-800 leading-relaxed">
                        Esta conta Google não está cadastrada nem aprovada pelo administrador para acessar o Domus Finanças.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-white border border-red-200/80 rounded-lg flex items-center gap-3">
                    {unauthorizedUser.photoURL ? (
                      <img
                        src={unauthorizedUser.photoURL}
                        alt={unauthorizedUser.displayName}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                        {unauthorizedUser.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {unauthorizedUser.displayName}
                      </p>
                      <p className="text-[11px] font-mono text-slate-600 truncate">
                        {unauthorizedUser.email}
                      </p>
                    </div>
                  </div>
                </div>

                {alreadyRequested ? (
                  <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 text-xs text-amber-950">
                    <CheckCircle2 className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <strong className="block">Solicitação enviada ao administrador!</strong>
                      <p className="text-[11px] text-amber-900 leading-relaxed">
                        Assim que o administrador aprovar seu e-mail dentro de <strong>Permissões</strong> no app, esta tela liberará seu acesso automaticamente.
                      </p>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmittingRequest}
                    onClick={() => void handleRequestAccess()}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isSubmittingRequest ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span>Solicitar Permissão ao Administrador</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void onSwitchGoogleAccount()}
                  className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4 text-slate-500" />
                  <span>Sair e Trocar Conta Google</span>
                </button>
              </div>
            ) : (
              /* ==================== TELA DE LOGIN GOOGLE OBRIGATÓRIO ==================== */
              <div className="space-y-4">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="space-y-1 text-xs">
                    <p className="font-bold text-slate-900">
                      Entrada restrita a contas autorizadas
                    </p>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Faça login com sua <strong>Conta Google</strong>. Somente e-mails cadastrados e aprovados pelo administrador têm permissão para visualizar ou alterar a planilha.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isAuthenticating}
                  onClick={() => void handleGoogleLogin()}
                  className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-500 text-white text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2.5 shadow-xs"
                >
                  {isAuthenticating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verificando conta Google...</span>
                    </>
                  ) : (
                    <>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0">
                        <GoogleIcon className="w-4 h-4" />
                      </span>
                      <span>Entrar com Conta Google</span>
                    </>
                  )}
                </button>

                <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Contas não cadastradas são bloqueadas automaticamente</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="max-w-md w-full mx-auto text-center text-[11px] text-slate-400 pb-2">
          Domus Finanças v{CURRENT_APP_VERSION} · Login Google Protegido · Nuvem 24h
        </div>
      </div>
    </div>
  );
};
