import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: a small service worker caches the app shell so the app,
// its calculations and saved data keep working without a connection.
// Registration quietly does nothing where service workers are unavailable.
try {
  // Only the installable build (which links a web manifest) ships sw.js.
  const installable = !!document.querySelector('link[rel="manifest"]');
  if (installable && 'serviceWorker' in navigator && window.isSecureContext && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    });
  }
} catch {
  /* ignore */
}
