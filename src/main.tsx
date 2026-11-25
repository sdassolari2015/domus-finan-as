import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __DOMUS_BOOTED__?: boolean;
  }
}

window.__DOMUS_BOOTED__ = true;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        void reg.update().catch(() => {});
      })
      .catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(<App />);
