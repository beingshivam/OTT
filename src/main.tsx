import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LogoProvider } from './components/PlatformLogo';
import './styles/app.css';
import { startTracking } from './lib/track';
import { loadFeed } from './lib/feed';
import { loadCatalogue } from './lib/catalogue';

startTracking();

/**
 * Draw once, complete.
 *
 * The app used to mount straight away and draw a loading frame — toolbar,
 * grey placeholder board, the footer pulled up into view — then rearrange
 * itself when the data landed a few hundred milliseconds later: the posters
 * inserted above the toolbar, the footer thrown 700px down. Measured on a
 * throttled phone that was a layout shift of 0.78 (Google's "good" is 0.1),
 * and every returning visitor, whose fonts were cached, saw it.
 *
 * The data is already downloading — each page preloads it (build-seo.mjs) —
 * and the prerendered page is on screen meanwhile. So wait for it, then
 * replace the prerendered page with the finished one in a single swap. Never
 * for long: past MAX_WAIT the app mounts anyway and shows its placeholders,
 * which is what it always did.
 */
const MAX_WAIT = 3000;
const needs: Promise<unknown>[] = [loadFeed().catch(() => null)];
if (/^\/streaming\/?$/.test(location.pathname)) needs.push(loadCatalogue().catch(() => null));

let mounted = false;
const mount = () => {
  if (mounted) return;
  mounted = true;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LogoProvider>
        <App />
      </LogoProvider>
    </StrictMode>,
  );
};
Promise.all(needs).then(mount);
setTimeout(mount, MAX_WAIT);
