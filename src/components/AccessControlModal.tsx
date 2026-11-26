import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  UserPlus,
  Trash2,
  CheckCircle2,
  Clock,
  Lock,
  AlertCircle,
  Loader2,
  UserX,
} from 'lucide-react';
import {
  AccessControlState,
  PRIMARY_ADMIN_EMAIL,
  approveOrAddAuthorizedGoogleUser,
  revokeAuthorizedGoogleUser,
  rejectGoogleAccessRequest,
} from '../services/firebase';
import { formatDateBR } from '../utils/formatters';

interface AccessControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessControl: AccessControlState;
  currentUserEmail: string;
  isCurrentUserAdmin: boolean;
  onShowToast: (msg: string) => void;
}

export const AccessControlModal: React.FC<AccessControlModalProps> = ({
  isOpen,
  onClose,
  accessControl,
  currentUserEmail,
  isCurrentUserAdmin,
  onShowToast,
}) => {
  const [newEmail, setNewEmail] = useState('');
  const [newProfile, setNewProfile] = useState<'Viviane' | 'Rodolfo' | 'Família'>('Viviane');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [requestProfiles, setRequestProfiles] = useState<
    Record<string, 'Viviane' | 'Rodolfo' | 'Família'>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newEmail.trim().toLowerCase();
    if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      setErrorMsg('Digite um e-mail Google válido (ex: nome@gmail.com).');
      return;
    }
    setErrorMsg(null);
    setIsSaving(true);
    try {
      await approveOrAddAuthorizedGoogleUser({
        email: cleaned,
        memberProfile: newProfile,
        isAdmin: newIsAdmin,
      });
      setNewEmail('');
      setNewIsAdmin(false);
      onShowToast(`Conta ${cleaned} cadastrada e aprovada para entrar!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao autorizar conta.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApproveRequest = async (email: string) => {
    setErrorMsg(null);
    setIsSaving(true);
    try {
      const profile = requestProfiles[email] || 'Viviane';
      await approveOrAddAuthorizedGoogleUser({
        email,
        memberProfile: profile,
        isAdmin: false,
      });
      onShowToast(`Acesso aprovado para ${email} (${profile})!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao aprovar solicitação.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRejectRequest = async (email: string) => {
    setErrorMsg(null);
    setIsSaving(true);
    try {
      await rejectGoogleAccessRequest(email);
      onShowToast(`Solicitação de ${email} recusada.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao recusar solicitação.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeAccount = async (email: string) => {
    setErrorMsg(null);
    setIsSaving(true);
    try {
      await revokeAuthorizedGoogleUser(email);
      onShowToast(`Permissão revogada para ${email}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao revogar conta.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4">
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold tracking-tight">
                Permissões de Acesso (Contas Google)
              </h2>
              <p className="text-xs text-slate-300">
                Somente contas Google cadastradas e aprovadas aqui conseguem entrar no Domus Finanças
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Pending Requests Section */}
          {accessControl.pendingRequests.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                <Clock className="w-4 h-4 text-amber-700" />
                <span>
                  Solicitações Aguardando sua Aprovação ({accessControl.pendingRequests.length})
                </span>
              </div>
              <div className="space-y-2.5">
                {accessControl.pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3 bg-white border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 text-xs">
                      <p className="font-bold text-slate-900 truncate">{req.displayName}</p>
                      <p className="font-mono text-[11px] text-slate-600 truncate">{req.email}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Solicitou em {formatDateBR(req.requestedAt)}
                      </p>
                    </div>
                    {isCurrentUserAdmin && (
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <select
                          value={requestProfiles[req.email] || 'Viviane'}
                          onChange={(e) =>
                            setRequestProfiles((prev) => ({
                              ...prev,
                              [req.email]: e.target.value as 'Viviane' | 'Rodolfo' | 'Família',
                            }))
                          }
                          className="px-2 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium"
                        >
                          <option value="Viviane">Viviane</option>
                          <option value="Rodolfo">Rodolfo</option>
                          <option value="Família">Família</option>
                        </select>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleApproveRequest(req.email)}
                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Aprovar</span>
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleRejectRequest(req.email)}
                          className="px-2.5 py-1.5 bg-white hover:bg-red-50 text-red-700 border border-red-200 text-xs font-semibold rounded-lg flex items-center gap-1"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          <span>Recusar</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add New Authorized Google Account Form (Admin only) */}
          {isCurrentUserAdmin ? (
            <form
              onSubmit={handleAddAccount}
              className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <UserPlus className="w-4 h-4 text-emerald-700" />
                <span>Cadastrar e Aprovar Nova Conta Google</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email.google@gmail.com"
                  className="sm:col-span-2 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
                <select
                  value={newProfile}
                  onChange={(e) =>
                    setNewProfile(e.target.value as 'Viviane' | 'Rodolfo' | 'Família')
                  }
                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-medium"
                >
                  <option value="Viviane">Perfil: Viviane</option>
                  <option value="Rodolfo">Perfil: Rodolfo</option>
                  <option value="Família">Perfil: Família</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newIsAdmin}
                    onChange={(e) => setNewIsAdmin(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Também pode aprovar ou remover outras contas (Administrador)</span>
                </label>
                <button
                  type="submit"
                  disabled={isSaving || !newEmail.trim()}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  <span>Autorizar Conta</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
              Apenas o administrador principal ({PRIMARY_ADMIN_EMAIL}) ou administradores autorizados podem adicionar ou remover contas.
            </div>
          )}

          {/* Approved Accounts List */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-slate-700">
              Contas Google Autorizadas ({accessControl.authorizedUsers.length})
            </h3>
            <div className="space-y-2">
              {accessControl.authorizedUsers.map((user) => {
                const isPrimary = user.email === PRIMARY_ADMIN_EMAIL;
                const isSelf = user.email === currentUserEmail.toLowerCase();
                return (
                  <div
                    key={user.email}
                    className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {user.email}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700">
                          {user.memberProfile}
                        </span>
                        {user.isAdmin && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800">
                            {isPrimary ? 'Administrador Principal' : 'Administrador'}
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[10px] font-semibold text-slate-400">(Você)</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Autorizado em {formatDateBR(user.addedAt)}
                      </p>
                    </div>

                    {isPrimary ? (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-lg shrink-0"
                        title="Conta protegida do proprietário"
                      >
                        <Lock className="w-3 h-3" />
                        Protegido
                      </span>
                    ) : isCurrentUserAdmin ? (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleRevokeAccount(user.email)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 border border-red-200 rounded-lg shrink-0"
                        title="Remover permissão de acesso imediatamente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Revogar</span>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Bloqueio instantâneo para contas não aprovadas</span>
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
