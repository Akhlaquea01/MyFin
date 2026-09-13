import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorageWarningBanner } from '../../src/components/StorageWarningBanner';

/**
 * Regression: dismissal was local component state only, so the banner reappeared on every
 * reload for as long as the underlying storage condition persisted — a real annoyance given
 * how often this app reloads (e.g. every backup restore). Dismissal now persists for a week.
 */
describe('StorageWarningBanner dismissal', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('shows by default and hides after Dismiss', async () => {
		render(<StorageWarningBanner />);
		expect(screen.getByRole('alert')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('stays dismissed across a remount (simulating a reload) within the dismissal window', async () => {
		const { unmount } = render(<StorageWarningBanner />);
		await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		unmount();

		render(<StorageWarningBanner />);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('resurfaces once the dismissal window has elapsed', () => {
		localStorage.setItem('STORAGE_WARNING_DISMISSED_UNTIL', String(Date.now() - 1000));
		render(<StorageWarningBanner />);
		expect(screen.getByRole('alert')).toBeInTheDocument();
	});
});
