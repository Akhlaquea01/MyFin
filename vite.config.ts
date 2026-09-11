import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Injects the Content-Security-Policy into the built `index.html`.
 *
 * Build-only, deliberately: `@vitejs/plugin-react` injects an inline React Refresh preamble in
 * dev, which `script-src 'self'` blocks — the dev server would show a blank page. The
 * production bundle has no inline script at all (the PWA register hook is an external
 * `registerSW.js`), so the strict policy applies cleanly to what actually ships.
 *
 * This app loads no third-party code and talks to no server, so a strict policy costs nothing
 * and is the highest-leverage hardening available: the blast radius of any XSS here is total,
 * because the session key sits in IndexedDB and would decrypt everything without the PIN
 * (Constitution Principle II).
 *   - img-src data: blob:      required by the receipt attachment viewer
 *   - style-src 'unsafe-inline' required by Tailwind's injected styles
 *   - connect-src 'self'       the valuable one: makes exfiltration to an attacker-controlled
 *     origin impossible even if script injection succeeds, which is what "your data never
 *     leaves your device" has to mean in practice.
 *   - form-action 'self'       spec 008 (share-target) submits a same-origin POST form as
 *     part of the Web Share Target hand-off; 'self' still blocks the actual exfiltration
 *     vector this directive exists for (a form pointed at an attacker-controlled origin) —
 *     the real OS share invocation isn't a same-document form submission at all and was
 *     never subject to this directive either way, so this only widens what this app's own
 *     pages may do, from "nothing" to "only itself."
 *
 * `frame-ancestors` is intentionally absent: it is ignored when delivered via <meta> and must
 * be set as a real response header by the static host.
 */
const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"manifest-src 'self'",
	"worker-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'self'"
].join('; ');

function cspPlugin(): Plugin {
	return {
		name: 'myfin-csp',
		apply: 'build',
		transformIndexHtml(html) {
			// Anchored after the charset declaration so that stays first in <head>, as the HTML
			// spec prefers.
			const charset = '<meta charset="UTF-8" />';
			return html.replace(
				charset,
				`${charset}
		<meta http-equiv="Content-Security-Policy" content="${CSP}" />`
			);
		}
	};
}

export default defineConfig({
	plugins: [
		cspPlugin(),
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
				],
				// Spec 008: a single share_target (the platform allows only one) handles both a
				// text/URL share and an image share — see specs/008-pwa-share-target/research.md §2.
				share_target: {
					action: '/share-target',
					method: 'POST',
					enctype: 'multipart/form-data',
					params: {
						title: 'title',
						text: 'text',
						url: 'url',
						files: { name: 'file', accept: ['image/*'] }
					}
				}
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
		projects: [
			{
				// Pure logic and repository tests. Node environment, no DOM.
				extends: true,
				test: {
					name: 'node',
					environment: 'node',
					include: [
						'src/**/*.{test,spec}.{js,ts}',
						'tests/unit/**/*.{test,spec}.{js,ts}',
						'tests/integration/**/*.{test,spec}.{js,ts}'
					],
					setupFiles: ['./tests/setup/fake-indexeddb.ts']
				}
			},
			{
				// Component tests. Previously impossible: the single `environment: 'node'` config
				// meant no component could be rendered at all, which is why a stale-closure bug
				// that disabled auto-lock entirely (CRIT-01) shipped with 176 tests passing.
				extends: true,
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['tests/component/**/*.{test,spec}.{js,ts,tsx}'],
					setupFiles: ['./tests/setup/fake-indexeddb.ts', './tests/setup/dom.ts']
				}
			}
		]
	}
});
