import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/disableConsoleInProd';
import './index.css';
import App from './App';

// Background work in this app is deliberately fire-and-forget (notification checks, index
// maintenance, session-key writes). Without this, a rejection in any of them vanished silently
// — and `console.error` used to be suppressed in production too, so nothing was recoverable.
// The message is app-authored, never an entity, so this cannot leak financial data.
window.addEventListener('unhandledrejection', (event) => {
	console.error('[unhandledrejection]', event.reason);
});

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
