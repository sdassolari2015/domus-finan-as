export interface AppReleaseNote {
  version: string;
  releaseDate: string;
  title: string;
  changes: string[];
}

export const CURRENT_APP_VERSION = '3.0.0';
export const PERMANENT_APP_LINK = 'https://domus-finan-as.vercel.app';
export const STANDALONE_CACHE_NAME = 'domus-standalone-cache-v3.0.0';

export const APP_RELEASES: AppReleaseNote[] = [
  {
    version: '3.0.0',
    releaseDate: 'Versão Atual',
    title: 'Visual Mais Limpo, Conexão WhatsApp Simplificada & Link Oficial GitHub/Vercel',
    changes: [
      'Conexão WhatsApp Simplificada: Removidas caixas duplicadas de QR Code, tutoriais antigos da Meta, URL de Webhook e botões de configuração já concluídos — mantendo apenas status direto e troca rápida de token recolhida.',
      'Link Oficial Definitivo: A tela de Instalação e o instalador para PC agora apontam sempre para o link oficial publicado via GitHub/Vercel (domus-finan-as.vercel.app).',
      'Barra Superior Mais Limpa: Removido excesso de textos e botões secundários no topo do aplicativo para uma navegação mais direta e organizada.',
    ],
  },
  {
    version: '2.9.9',
    releaseDate: 'Versão Anterior',
    title: 'Login Obrigatório com Conta Google & Controle de Permissões Aprovadas',
    changes: [
      'Acesso Exclusivo com Conta Google: Apenas contas Google cadastradas e aprovadas pelo administrador conseguem entrar e visualizar a planilha.',
      'Gerenciador de Permissões em Tempo Real: Aprove solicitações ou cadastre novos e-mails no botão Permissões.',
    ],
  },
  {
    version: '2.8.1',
    releaseDate: 'Versão Anterior',
    title: 'Acesso Rápido no PC & Celular com Sincronização em Nuvem 24h',
    changes: [
      'Visão Geral com Entradas no topo, Cronograma de Contas informativo, gestão de Cartões/Contas, 3 abas em Boletos e Fixas e aba de Saldo Devedor em Relatórios.',
      'Sincronização em Tempo Real 24h com Google Cloud Firestore mantendo todos os dados da família salvos na nuvem.',
    ],
  },
];

export const ACK_VERSION_STORAGE_KEY = 'domus_acknowledged_version_v1';

export function getAcknowledgedVersion(): string | null {
  try {
    return localStorage.getItem(ACK_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAcknowledgedVersion(version: string): void {
  try {
    localStorage.setItem(ACK_VERSION_STORAGE_KEY, version);
  } catch {
    // Ignore storage errors
  }
}

export async function checkRemoteVersionJson(): Promise<AppReleaseNote | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.version === 'string' && Array.isArray(data.changes)) {
      return {
        version: data.version,
        releaseDate: data.releaseDate || 'Nova Atualização',
        title: data.title || 'Nova Versão Disponível',
        changes: data.changes,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Ensures the full production React bundle (/standalone/index.html, /standalone/app.js, /standalone/app.css)
// is cached in browser Cache Storage and /sw.js is registered for fast offline fallback.
export async function ensureStandaloneOfflineCache(): Promise<boolean> {
  try {
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    if (!('caches' in window)) {
      return false;
    }
    const cache = await caches.open(STANDALONE_CACHE_NAME);
    const urls = [
      '/standalone/index.html',
      '/standalone/app.js',
      '/standalone/app.css',
      '/manifest.json',
      '/version.json',
      '/domus-logo.png',
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/pwa-192x192.png',
      '/pwa-512x512.png',
    ];
    let coreReady = false;
    for (const url of urls) {
      try {
        const existing = await cache.match(url);
        if (!existing) {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.status === 200 && !res.redirected) {
            await cache.put(url, res.clone());
          }
        }
      } catch {
        // Ignore individual asset fetch error when offline
      }
    }
    const hasShell = await cache.match('/standalone/index.html');
    const hasJs = await cache.match('/standalone/app.js');
    coreReady = Boolean(hasShell && hasJs);
    return coreReady;
  } catch {
    return false;
  }
}

export async function applyInPlaceAppUpdate(newVersion: string): Promise<void> {
  setAcknowledgedVersion(newVersion);
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) {
        await caches.delete(k);
      }
      const cache = await caches.open(STANDALONE_CACHE_NAME);
      const refreshUrls = [
        '/standalone/index.html',
        '/standalone/app.js',
        '/standalone/app.css',
        '/version.json',
      ];
      for (const u of refreshUrls) {
        try {
          const res = await fetch(`${u}?t=${Date.now()}`, { cache: 'no-store' });
          if (res && res.status === 200 && !res.redirected) {
            await cache.put(u, res);
          }
        } catch {
          // Ignore if offline
        }
      }
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.update();
      }
    }
  } catch {
    // Ignore cache cleanup errors
  }
}
