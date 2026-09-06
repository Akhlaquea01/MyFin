import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Personal Finance Manager',
				short_name: 'MyFin',
				description:
					'A private, offline-first personal finance manager. Your data never leaves your device.',
				start_url: '/',
				display: 'standalone',
				background_color: '#0b0f19',
				theme_color: '#0f766e',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
				]
			},
			workbox: {
				// Offline-first: precache the app shell so it works with zero network,
				// including on first launch after install (SC-009).
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']
			},
			devOptions: { enabled: true, type: 'module' }
		})
	],
	resolve: {
		alias: {
			'@': path.resolve(import.meta.dirname, './src')
		}
	},
	test: {
		expect: { requireAssertions: true },
		environment: 'node',
		include: [
			'src/**/*.{test,spec}.{js,ts}',
			'tests/unit/**/*.{test,spec}.{js,ts}',
			'tests/integration/**/*.{test,spec}.{js,ts}'
		],
		setupFiles: ['./tests/setup/fake-indexeddb.ts']
	}
});
