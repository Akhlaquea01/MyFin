// Light / dark / follow-the-system. The choice lives in localStorage, not the encrypted profile:
// the lock screen has to be themed before there is a key to read anything with. `public/theme-init.js`
// applies it before first paint; this module keeps it in step afterwards.
import { useSyncExternalStore } from 'react';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';
import { isNativeApp } from './native/platform';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'myfin.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
	const stored = safeGetItem(THEME_STORAGE_KEY);
	return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function getResolvedTheme(): ResolvedTheme {
	const preference = getThemePreference();
	if (preference !== 'system') return preference;
	return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(): void {
	const resolved = getResolvedTheme();
	document.documentElement.classList.toggle('dark', resolved === 'dark');
	// Edge-to-edge: the status bar draws over the app, so its icons follow the app's theme rather
	// than the device's. "Dark" style means light icons for a dark background.
	if (isNativeApp()) {
		SystemBars.setStyle({
			style: resolved === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light
		}).catch(() => {
			// Cosmetic only.
		});
	}
}

export function setThemePreference(preference: ThemePreference): void {
	if (preference === 'system') safeRemoveItem(THEME_STORAGE_KEY);
	else safeSetItem(THEME_STORAGE_KEY, preference);
	// Class first, then subscribers: charts re-read their colors from the DOM when notified.
	applyTheme();
	listeners.forEach((notify) => notify());
}

/** Applies the saved theme and follows the OS setting while the preference is "system". Call once at startup. */
export function initTheme(): void {
	applyTheme();
	window.matchMedia(DARK_QUERY).addEventListener('change', () => {
		if (getThemePreference() !== 'system') return;
		applyTheme();
		listeners.forEach((notify) => notify());
	});
}

function subscribe(notify: () => void): () => void {
	listeners.add(notify);
	return () => listeners.delete(notify);
}

/** The active theme. Components that read colors from the DOM (canvas charts) use it to redraw on change. */
export function useResolvedTheme(): ResolvedTheme {
	return useSyncExternalStore(subscribe, getResolvedTheme);
}

export function useThemePreference(): ThemePreference {
	return useSyncExternalStore(subscribe, getThemePreference);
}
