import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  RefreshCw,
  X,
  Info,
  ShieldCheck,
} from 'lucide-react';
import {
  APP_RELEASES,
  AppReleaseNote,
  CURRENT_APP_VERSION,
  getAcknowledgedVersion,
  checkRemoteVersionJson,
  applyInPlaceAppUpdate,
} from '../data/appVersion';
import {
  publishCurrentVersionToCloud,
  subscribeToCloudAppVersion,
} from '../services/firebase';

interface AppUpdateBannerModalProps {
  onUpdateApplied?: () => Promise<void> | void;
  externalOpenModal?: boolean;
  onCloseExternalModal?: () => void;
}

export const AppUpdateBannerModal: React.FC<AppUpdateBannerModalProps> = ({
  onUpdateApplied,
  externalOpenModal,
  onCloseExternalModal,
}) => {
  const [latestRelease, setLatestRelease] = useState<AppReleaseNote>(APP_RELEASES[0]);
  const [hasPendingUpdate, setHasPendingUpdate] = useState<boolean>(() => {
    const ack = getAcknowledgedVersion();
    return ack !== CURRENT_APP_VERSION;
  });
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [justUpdatedSuccess, setJustUpdatedSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (externalOpenModal) {
      setIsModalOpen(true);
    }
  }, [externalOpenModal]);

  // Real-time cloud version sync + /version.json check so iPhone, other PCs, and Notebook .bat detect updates automatically without changing the link or reinstalling
  useEffect(() => {
    let mounted = true;

    void publishCurrentVersionToCloud();

    const unsubCloudVer = subscribeToCloudAppVersion((cloudRelease) => {
      if (!mounted) return;
      setLatestRelease(cloudRelease);
      const ack = getAcknowledgedVersion();
      if (ack !== cloudRelease.version) {
        setHasPendingUpdate(true);
      }
    });

    const verifyVersion = async () => {
      const remote = await checkRemoteVersionJson();
      if (!mounted || !remote) return;
      setLatestRelease(remote);
      const ack = getAcknowledgedVersion();
      if (ack !== remote.version) {
        setHasPendingUpdate(true);
      }
    };

    void verifyVersion();
    const timer = window.setInterval(verifyVersion, 45000);
    return () => {
      mounted = false;
      unsubCloudVer();
      window.clearInterval(timer);
    };
  }, []);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    if (onCloseExternalModal) {
      onCloseExternalModal();
    }
  };

  const handleApplyUpdateNow = async () => {
    setIsUpdating(true);
    try {
      await applyInPlaceAppUpdate(latestRelease.version);
      if (onUpdateApplied) {
        await onUpdateApplied();
      }
      setHasPendingUpdate(false);
      setJustUpdatedSuccess(true);
      window.setTimeout(() => {
        setJustUpdatedSuccess(false);
        handleCloseModal();
      }, 1400);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      {/* Live Update Notification Banner (shown automatically whenever a new version is published) */}
      {hasPendingUpdate && (
        <div className="w-full bg-emerald-900 text-white border-b border-emerald-700 px-4 py-2.5 shadow-xs">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-700 text-emerald-100 font-mono font-bold text-[11px] shrink-0">
                <Sparkles className="w-3 h-3" />
                NOVA VERSÃO v{latestRelease.version}
              </span>
              <span className="font-semibold text-white">
                {latestRelease.title}
              </span>
              <span className="hidden md:inline text-emerald-200">
                — Atualize sem mudar o link e sem precisar reinstalar!
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 border border-emerald-600 text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Ver Atualizações</span>
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleApplyUpdateNow}
                className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-950 text-xs font-bold transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-emerald-700 ${
                    isUpdating ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {isUpdating ? 'Atualizando...' : 'Atualizar Agora'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Changelog & In-Place Update Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">
                      Notas da Versão v{latestRelease.version}
                    </h3>
                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-700 text-white rounded">
                      {hasPendingUpdate ? 'NOVA ATUALIZAÇÃO' : 'ATUALIZADO'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Confira as melhorias aplicadas ao Domus Finanças
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-950 space-y-1">
                  <p className="font-bold">
                    Sem precisar desinstalar e com o mesmo Link Permanente
                  </p>
                  <p className="text-emerald-800 leading-relaxed">
                    Todas as atualizações são aplicadas direto no seu aplicativo e no link do iPhone/Notebook, mantendo seus lançamentos sincronizados na nuvem.
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                  O que foi atualizado na versão v{latestRelease.version}:
                </h4>
                <ul className="space-y-2">
                  {latestRelease.changes.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-800"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {APP_RELEASES.length > 1 && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-[11px] font-bold text-slate-500 mb-2">
                    Histórico recente ({APP_RELEASES[1].version}):
                  </p>
                  <ul className="space-y-1.5 text-[11px] text-slate-600">
                    {APP_RELEASES[1].changes.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {justUpdatedSuccess && (
                <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  <span>
                    Versão v{latestRelease.version} aplicada e sincronizada com sucesso!
                  </span>
                </div>
              )}
            </div>

            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="text-[11px] font-mono text-slate-500">
                Versão instalada: v{latestRelease.version}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={handleApplyUpdateNow}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {hasPendingUpdate
                      ? `Atualizar para v${latestRelease.version} Agora`
                      : 'Sincronizar e Confirmar Versão'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
