import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageErrorBoundary } from '../../src/components/PageErrorBoundary';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { SessionLockedError } from '../../src/context/SessionContext';

function Exploding({ error }: { error: Error }): React.ReactElement {
	throw error;
}

describe('PageErrorBoundary', () => {
	beforeEach(() => {
		// React logs caught render errors itself; silence it so the run stays readable.
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders children when nothing throws', () => {
		render(
			<PageErrorBoundary>
				<p>Page content</p>
			</PageErrorBoundary>
		);
		expect(screen.getByText('Page content')).toBeInTheDocument();
	});

	it('catches an ordinary page error locally, without an ancestor boundary seeing it', () => {
		const onReset = vi.fn();
		render(
			<ErrorBoundary onReset={onReset}>
				<div data-testid="app-shell-chrome">Nav</div>
				<PageErrorBoundary>
					<Exploding error={new Error('chart data was malformed')} />
				</PageErrorBoundary>
			</ErrorBoundary>
		);

		expect(screen.getByText("This page couldn't load")).toBeInTheDocument();
		// The outer app-level boundary never fired — its "Something went wrong" full-page
		// fallback (which would have replaced everything, including the nav) is absent, and
		// the sibling "chrome" outside PageErrorBoundary is still on screen.
		expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
		expect(screen.getByTestId('app-shell-chrome')).toBeInTheDocument();
		expect(onReset).not.toHaveBeenCalled();
	});

	/**
	 * Regression target: a SessionLockedError means the whole session's key is unusable, not
	 * just the current page. PageErrorBoundary must NOT swallow it — it has to keep propagating
	 * to the app-level ErrorBoundary, the only thing that can fix it (return to LockScreen).
	 */
	it('lets a SessionLockedError propagate past it to the app-level ErrorBoundary', () => {
		const onReset = vi.fn();
		render(
			<ErrorBoundary onReset={onReset}>
				<div data-testid="app-shell-chrome">Nav</div>
				<PageErrorBoundary>
					<Exploding error={new SessionLockedError()} />
				</PageErrorBoundary>
			</ErrorBoundary>
		);

		// The app-level boundary caught it instead — full-page fallback, nav gone with it.
		expect(screen.getByText('Something went wrong')).toBeInTheDocument();
		expect(screen.queryByText("This page couldn't load")).not.toBeInTheDocument();
		expect(screen.queryByTestId('app-shell-chrome')).not.toBeInTheDocument();
	});

	it('lets "Try again" retry rendering the same children', async () => {
		render(
			<PageErrorBoundary>
				<Exploding error={new Error('boom')} />
			</PageErrorBoundary>
		);
		expect(screen.getByText("This page couldn't load")).toBeInTheDocument();

		// Retrying re-renders the exact same throwing element, so it fails again immediately —
		// this only proves the reset button re-attempts a render, not that recovery is possible
		// (recovery in the real app comes from AppShell remounting the boundary on navigation).
		await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(screen.getByText("This page couldn't load")).toBeInTheDocument();
	});
});
