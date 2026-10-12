import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useUnsavedChanges } from '../../src/lib/unsavedChanges';

const native = vi.hoisted(() => ({
	available: true,
	queue: [] as unknown[],
	listener: null as null | (() => void),
	remove: vi.fn()
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/lib/native/appState', () => ({ subscribeAppActive: () => () => {} }));
vi.mock('../../src/lib/native/nativeShare', () => ({
	isNativeShareAvailable: () => native.available,
	consumeNativeShare: vi.fn(async () => (native.queue.shift() as object | undefined) ?? null),
	onNativeShare: vi.fn(async (listener: () => void) => {
		native.listener = listener;
		return { remove: native.remove };
	})
}));

import { toast } from 'sonner';
import { NativeShareBridge } from '../../src/components/NativeShareBridge';
import { ShareTargetLandingPage } from '../../src/pages/ShareTargetLandingPage';
import { consumeNativeShare } from '../../src/lib/native/nativeShare';

function Where() {
	const { pathname, state } = useLocation();
	return (
		<div>
			<span data-testid="path">{pathname}</span>
			<span data-testid="state">
				{state && typeof state === 'object' ? Object.keys(state).join(',') : ''}
			</span>
			<span data-testid="sharedText">{(state as { sharedText?: string } | null)?.sharedText}</span>
			<span data-testid="sharedFile">
				{(state as { sharedFile?: File } | null)?.sharedFile?.name}
			</span>
		</div>
	);
}

/** A screen with something typed into it, as Quick Add is once a message is pasted. */
function HalfFilledForm() {
	useUnsavedChanges(true);
	return <Where />;
}

function App({ start = '/dashboard', dirty = false }: { start?: string; dirty?: boolean }) {
	return (
		<MemoryRouter initialEntries={[start]}>
			<NativeShareBridge />
			<Routes>
				<Route path="/share-target-landing" element={<ShareTargetLandingPage />} />
				<Route path="*" element={dirty ? <HalfFilledForm /> : <Where />} />
			</Routes>
		</MemoryRouter>
	);
}

describe('NativeShareBridge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		native.available = true;
		native.queue = [];
		native.listener = null;
	});

	it('does nothing outside the Android app', async () => {
		native.available = false;
		native.queue = [{ text: 'Rs.5 debited' }];
		render(<App />);
		await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/dashboard'));
		expect(consumeNativeShare).not.toHaveBeenCalled();
	});

	it('does nothing when nothing was shared', async () => {
		render(<App />);
		await waitFor(() => expect(consumeNativeShare).toHaveBeenCalled());
		expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
	});

	it('takes text waiting at launch and opens Quick Add with it', async () => {
		native.queue = [{ text: 'Rs.250.00 debited from A/c XX1234 to SWIGGY' }];
		render(<App />);

		await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/quick-add'));
		expect(screen.getByTestId('sharedText')).toHaveTextContent(
			'Rs.250.00 debited from A/c XX1234 to SWIGGY'
		);
	});

	it('takes a shared image and opens New Transaction with the file', async () => {
		native.queue = [{ image: { name: 'bill.png', mimeType: 'image/png', base64: btoa('PNG') } }];
		render(<App />);

		await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/transactions/new'));
		expect(screen.getByTestId('sharedFile')).toHaveTextContent('bill.png');
	});

	it('takes a shared statement and opens Import with the file', async () => {
		native.queue = [
			{ file: { name: 'statement.csv', mimeType: 'text/csv', base64: btoa('date,amount') } }
		];
		render(<App />);

		await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/import'));
		expect(screen.getByTestId('sharedFile')).toHaveTextContent('statement.csv');
	});

	it('tells the user when a shared statement could not be taken', async () => {
		native.queue = [{ fileProblem: 'too-large' }];
		render(<App />);

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('That file is too large to import.')
		);
		expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
	});

	describe('when the current screen holds something half-typed', () => {
		afterEach(() => vi.restoreAllMocks());

		it('asks before replacing it, and opens the share when the user agrees', async () => {
			const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
			native.queue = [{ text: 'Rs.5 debited' }];
			render(<App start="/transactions/new" dirty />);

			await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/quick-add'));
			expect(confirm).toHaveBeenCalledTimes(1);
		});

		it('leaves the screen alone when the user declines, and offers to open the share later', async () => {
			vi.spyOn(window, 'confirm').mockReturnValue(false);
			native.queue = [{ text: 'Rs.5 debited' }];
			render(<App start="/transactions/new" dirty />);

			await waitFor(() =>
				expect(toast.info).toHaveBeenCalledWith(
					'The shared content was not opened.',
					expect.objectContaining({ action: expect.objectContaining({ label: 'Open it' }) })
				)
			);
			expect(screen.getByTestId('path')).toHaveTextContent('/transactions/new');
		});

		it('does not ask at all when nothing is half-typed', async () => {
			const confirm = vi.spyOn(window, 'confirm');
			native.queue = [{ text: 'Rs.5 debited' }];
			render(<App />);

			await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/quick-add'));
			expect(confirm).not.toHaveBeenCalled();
		});
	});

	it('picks up a share that arrives while the app is open, even when already on Quick Add', async () => {
		render(<App start="/quick-add" />);
		await waitFor(() => expect(native.listener).not.toBeNull());

		native.queue = [{ text: 'second share' }];
		native.listener?.();

		await waitFor(() => expect(screen.getByTestId('sharedText')).toHaveTextContent('second share'));
		expect(screen.getByTestId('path')).toHaveTextContent('/quick-add');
	});

	it('tells the user when a shared image could not be taken, and does not navigate if that is all there was', async () => {
		native.queue = [{ imageProblem: 'too-large' }];
		render(<App />);

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('That image is too large to attach.')
		);
		expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
	});

	it('still opens the text of a share whose image could not be read', async () => {
		native.queue = [{ text: 'caption', imageProblem: 'unreadable' }];
		render(<App />);

		await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/quick-add'));
		expect(toast.error).toHaveBeenCalledWith("Couldn't read the shared image.");
	});

	it('stops listening when it unmounts', async () => {
		const { unmount } = render(<App />);
		await waitFor(() => expect(native.listener).not.toBeNull());
		unmount();
		await waitFor(() => expect(native.remove).toHaveBeenCalled());
	});
});
