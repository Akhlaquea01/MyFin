import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

function Exploding({ message }: { message: string }): React.ReactElement {
	throw new Error(message);
}

describe('ErrorBoundary', () => {
	beforeEach(() => {
		// React logs caught render errors itself; silence it so the run stays readable.
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders children when nothing throws', () => {
		render(
			<ErrorBoundary onReset={() => {}}>
				<p>Ledger</p>
			</ErrorBoundary>
		);
		expect(screen.getByText('Ledger')).toBeInTheDocument();
	});

	/**
	 * The failure this exists for: every page calls `getEncryptionKey()` during render, which
	 * throws by design when the key is missing or no longer matches the data (locked mid-render,
	 * or a backup restored under a different PIN). With no boundary, that unmounted the entire
	 * tree to a blank page with no route back to the lock screen that would fix it.
	 */
	it('catches a render-time throw and offers a way back', async () => {
		render(
			<ErrorBoundary onReset={() => {}}>
				<Exploding message="App is locked: no encryption key available" />
			</ErrorBoundary>
		);

		expect(screen.getByText('Something went wrong')).toBeInTheDocument();
		expect(screen.getByText(/App is locked/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /back to lock screen/i })).toBeInTheDocument();
	});

	it('reassures the user their data is intact', () => {
		render(
			<ErrorBoundary onReset={() => {}}>
				<Exploding message="boom" />
			</ErrorBoundary>
		);
		expect(screen.getByText(/still on this device and has not been changed/i)).toBeInTheDocument();
	});

	it('invokes onReset so the caller can lock and return to the lock screen', async () => {
		const onReset = vi.fn();
		render(
			<ErrorBoundary onReset={onReset}>
				<Exploding message="boom" />
			</ErrorBoundary>
		);

		await userEvent.click(screen.getByRole('button', { name: /back to lock screen/i }));
		expect(onReset).toHaveBeenCalledOnce();
	});
});
