import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../../src/components/ThemeToggle';
import {
	THEME_STORAGE_KEY,
	getResolvedTheme,
	getThemePreference,
	initTheme,
	setThemePreference,
	useResolvedTheme
} from '../../src/lib/theme';

// A matchMedia whose "prefers dark" answer the test can flip, firing the change listeners like a
// real OS switch would.
function mockSystemTheme(initiallyDark: boolean) {
	let dark = initiallyDark;
	const listeners = new Set<() => void>();
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			get matches() {
				return dark;
			},
			media: query,
			addEventListener: (_: string, fn: () => void) => listeners.add(fn),
			removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		})
	});
	return (nextDark: boolean) => {
		dark = nextDark;
		act(() => listeners.forEach((fn) => fn()));
	};
}

const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove('dark');
});

afterEach(() => {
	localStorage.clear();
});

describe('theme preference', () => {
	it('defaults to following the system when nothing (or something unrecognised) is stored', () => {
		expect(getThemePreference()).toBe('system');
		localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
		expect(getThemePreference()).toBe('system');
	});

	it('lets an explicit choice win over the system setting', () => {
		mockSystemTheme(true);
		expect(getResolvedTheme()).toBe('dark');
		setThemePreference('light');
		expect(getResolvedTheme()).toBe('light');
		expect(isDark()).toBe(false);
	});

	it('persists the choice and applies it to the document', () => {
		mockSystemTheme(false);
		setThemePreference('dark');
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
		expect(isDark()).toBe(true);
	});

	it('forgets the stored choice when switched back to system', () => {
		mockSystemTheme(false);
		setThemePreference('dark');
		setThemePreference('system');
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
		expect(isDark()).toBe(false);
	});

	it('survives storage that throws', () => {
		mockSystemTheme(true);
		const original = Storage.prototype.getItem;
		Storage.prototype.getItem = () => {
			throw new Error('blocked');
		};
		try {
			expect(getThemePreference()).toBe('system');
			expect(getResolvedTheme()).toBe('dark');
		} finally {
			Storage.prototype.getItem = original;
		}
	});
});

describe('initTheme', () => {
	it('applies the saved theme at startup', () => {
		mockSystemTheme(false);
		localStorage.setItem(THEME_STORAGE_KEY, 'dark');
		initTheme();
		expect(isDark()).toBe(true);
	});

	it('follows the OS while on system, and ignores it once a theme is chosen', () => {
		const setSystemDark = mockSystemTheme(false);
		initTheme();
		expect(isDark()).toBe(false);

		setSystemDark(true);
		expect(isDark()).toBe(true);

		setThemePreference('light');
		setSystemDark(true);
		expect(isDark()).toBe(false);
	});
});

describe('useResolvedTheme', () => {
	it('re-renders its caller when the theme changes, after the class is already applied', () => {
		mockSystemTheme(false);
		const seenClassAtRender: boolean[] = [];
		const { result } = renderHook(() => {
			const theme = useResolvedTheme();
			seenClassAtRender.push(isDark());
			return theme;
		});
		expect(result.current).toBe('light');

		act(() => setThemePreference('dark'));
		expect(result.current).toBe('dark');
		// Charts read their colors from the DOM while rendering, so the class must already be set.
		expect(seenClassAtRender.at(-1)).toBe(true);
	});
});

describe('ThemeToggle', () => {
	it('switches the theme from its menu and shows the current choice', async () => {
		mockSystemTheme(false);
		const user = userEvent.setup();
		render(<ThemeToggle />);

		await user.click(screen.getByRole('button', { name: 'Change theme' }));
		expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked();

		await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
		expect(isDark()).toBe(true);
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

		await user.click(screen.getByRole('button', { name: 'Change theme' }));
		expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();
	});
});
