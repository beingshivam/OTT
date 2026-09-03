import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LogoProvider } from './components/PlatformLogo';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LogoProvider>
      <App />
    </LogoProvider>
  </StrictMode>,
);
