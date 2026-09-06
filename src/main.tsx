import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/disableConsoleInProd';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
