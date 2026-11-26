export interface AppReleaseNote {
  version: string;
  releaseDate: string;
  title: string;
  changes: string[];
}

export const CURRENT_APP_VERSION = '2.9.8';
export const PERMANENT_APP_LINK = 'https://domus-finan-as.vercel.app';
export const STANDALONE_CACHE_NAME = 'domus-standalone-cache-v2.9.8';

export const APP_RELEASES: AppReleaseNote[] = [
  {
    version: '2.9.8',
    releaseDate: 'Versão Atual',
    title: 'Áudio no WhatsApp, PIX vs. Cartão de Crédito, Comprovantes Compridos (Santander), Contas Pendentes e Parceladas',
    changes: [
      'Comprovantes Compridos (Santander) & Conta Fixa vs. Gasto Avulso: Lê o comprovante inteiro do topo ao rodapé. Se for PIX para uma fixa cadastrada (ex: Fit Energia), dá baixa automática; se for outro destinatário/valor (ex: COPEL / COPELDIS com legenda "Luz"), lança corretamente em Gastos Mensais sem baixar a Fit Energia.',
      'Diferenciação Rigorosa PIX vs. Cartão de Crédito: Comprovantes de PIX (mesmo do Sicredi, Santander, Bradesco ou Nubank) vão sempre para Boletos e Fixas — só lança em Cartão de Crédito quando aparecer explicitamente compra no crédito/cartão/fatura.',
      'Contas Pendentes, Parceladas e Áudios no WhatsApp: Reconhece mensagens e áudios de voz (ex: "Pendente boleto 250 vence dia 20", "Compra crédito Nubank 6x de 120"), reações com emoji (✅/❌/⏳) e alerta de renovação de Token Permanente da Meta.',
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
// is cached in browser Cache Storage and /sw.js is registered so the link opens even when AI Studio is closed.
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
