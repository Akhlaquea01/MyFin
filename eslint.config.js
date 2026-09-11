import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// `.claude/worktrees/**` holds full checkouts of this repo created for background tasks;
	// linting them duplicates every error and breaks typed linting (multiple tsconfig roots).
	{ ignores: ['scripts/**', '.claude/worktrees/**', 'dev-dist/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	reactRefresh.configs.vite,
	prettier,
	{
		// shadcn/ui components conventionally export a `cva` variants function/constant
		// alongside the component (badge.tsx, button.tsx, tabs.tsx), and context modules
		// conventionally export a `useX()` hook alongside their provider — both are
		// idiomatic React, not the class-component-in-a-component-file pattern this rule
		// exists to catch.
		files: ['src/components/ui/**/*.tsx', 'src/context/**/*.tsx'],
		rules: { 'react-refresh/only-export-components': 'off' }
	},
	{
		// `recommended-latest` also ships a set of React Compiler-oriented rules
		// (set-state-in-effect, incompatible-library, etc.) that assume the app opts into
		// the React Compiler's auto-memoization. This project doesn't use the Compiler, so
		// those rules just flag ordinary, correct patterns (a `useEffect` that loads data
		// on mount, react-hook-form's `watch()`) — keep only the two rules that matter
		// regardless of Compiler usage.
		files: ['src/**/*.{ts,tsx}'],
		plugins: { 'react-hooks': reactHooks },
		rules: {
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn'
		}
	},
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	}
);
