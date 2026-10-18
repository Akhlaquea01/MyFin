import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BudgetPerformanceItem } from '../../src/domain/analytics/analyticsEngine';

const mocks = vi.hoisted(() => ({
	budgetPerformance: vi.fn(),
	withLiveBudgetActuals: vi.fn(),
	key: {} as CryptoKey
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/context/SessionContext', () => ({
	useSession: () => ({ getEncryptionKey: () => mocks.key })
}));
vi.mock('../../src/domain/analytics/analyticsEngine', () => ({
	budgetPerformance: (...args: unknown[]) => mocks.budgetPerformance(...args),
	withLiveBudgetActuals: (...args: unknown[]) => mocks.withLiveBudgetActuals(...args)
}));

import { toast } from 'sonner';
import { BudgetPerformanceCard } from '../../src/components/BudgetPerformanceCard';

const row = (
	name: string,
	periodStart: string,
	periodEnd: string,
	planned: number,
	actual: number
): BudgetPerformanceItem => ({
	budgetId: `${name}-${periodStart}`,
	categoryId: name,
	categoryName: name,
	periodStart,
	periodEnd,
	plannedAmount: planned * 100,
	actualAmount: actual * 100
});

const ROWS = [
	row('Groceries', '2025-12-01', '2025-12-31', 1700, 900),
	row('Local Transport', '2026-09-01', '2026-09-30', 4000, 1101),
	row('Shopping', '2026-10-01', '2026-10-31', 4000, 18153.35),
	row('Healthcare', '2026-10-01', '2026-10-31', 1000, 0)
];

// jsdom lacks the pointer-capture calls Radix Select makes when opening.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, option: string) {
	await user.click(screen.getByRole('combobox', { name: picker }));
	await user.click(await screen.findByRole('option', { name: option }));
}

// Each screen loads in two chained steps (the budgets, then the chosen month's live figures) and the
// pickers are Radix Selects. Alone that settles in well under a second; with the full suite running in
// parallel it has taken 2+ s, so wait up to 5 s for it (Testing Library's default is 1 s).
configure({ asyncUtilTimeout: 5_000 });

describe('BudgetPerformanceCard', () => {
	vi.setConfig({ testTimeout: 30_000 });

	beforeEach(() => {
		// Only the clock's date is faked, so user-event's timers still run.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 9, 18));
		mocks.budgetPerformance.mockReset();
		mocks.budgetPerformance.mockResolvedValue(ROWS);
		mocks.withLiveBudgetActuals.mockImplementation(async (_key, items) => items);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('opens on the current month and shows only that month’s budgets', async () => {
		render(<BudgetPerformanceCard />);

		expect(await screen.findByText('Shopping')).toBeInTheDocument();
		expect(screen.getByText('Healthcare')).toBeInTheDocument();
		expect(screen.queryByText('Local Transport')).not.toBeInTheDocument();
		expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
		expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('October');
		expect(screen.getByRole('combobox', { name: 'Year' })).toHaveTextContent('2026');
		expect(screen.getByText('₹14,153.35 over budget')).toBeInTheDocument();
	});

	it('asks for every period once, not for a date range', async () => {
		render(<BudgetPerformanceCard />);
		await screen.findByText('Shopping');
		expect(mocks.budgetPerformance).toHaveBeenCalledTimes(1);
	});

	it('switches to another month from the dropdown', async () => {
		const user = userEvent.setup();
		render(<BudgetPerformanceCard />);
		await screen.findByText('Shopping');

		await pick(user, 'Month', 'September');

		expect(screen.getByText('Local Transport')).toBeInTheDocument();
		expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
	});

	it('offers the years that have budgets and switches year from the dropdown', async () => {
		const user = userEvent.setup();
		render(<BudgetPerformanceCard />);
		await screen.findByText('Shopping');

		await user.click(screen.getByRole('combobox', { name: 'Year' }));
		const listbox = await screen.findByRole('listbox');
		expect(
			within(listbox)
				.getAllByRole('option')
				.map((o) => o.textContent)
		).toEqual(['2026', '2025']);
		await user.click(within(listbox).getByRole('option', { name: '2025' }));
		await pick(user, 'Month', 'December');

		expect(screen.getByText('Groceries')).toBeInTheDocument();
		expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
	});

	it('says so when a month has no budgets', async () => {
		const user = userEvent.setup();
		render(<BudgetPerformanceCard />);
		await screen.findByText('Shopping');

		await pick(user, 'Month', 'March');

		expect(screen.getByText('No budgets for March 2026.')).toBeInTheDocument();
	});

	it('shows spending recomputed from the ledger rather than the stored figure', async () => {
		mocks.withLiveBudgetActuals.mockImplementation(
			async (_key: unknown, items: BudgetPerformanceItem[]) =>
				items.map((i) => ({ ...i, actualAmount: i.categoryName === 'Healthcare' ? 25_000 : 0 }))
		);
		render(<BudgetPerformanceCard />);

		expect(await screen.findByText('₹250.00 of ₹1,000.00')).toBeInTheDocument();
		expect(screen.queryByText('₹14,153.35 over budget')).not.toBeInTheDocument();
		// Only the month on screen is brought up to date.
		expect(mocks.withLiveBudgetActuals).toHaveBeenLastCalledWith(
			mocks.key,
			expect.arrayContaining([expect.objectContaining({ categoryName: 'Shopping' })])
		);
		expect(
			mocks.withLiveBudgetActuals.mock.lastCall?.[1].map(
				(i: BudgetPerformanceItem) => i.categoryName
			)
		).toEqual(['Shopping', 'Healthcare']);
	});

	it('falls back to the saved figures, and says so, when the refresh fails', async () => {
		mocks.withLiveBudgetActuals.mockRejectedValue(new Error('boom'));
		render(<BudgetPerformanceCard />);

		expect(await screen.findByText('Shopping')).toBeInTheDocument();
		expect(screen.getByText('₹14,153.35 over budget')).toBeInTheDocument();
		expect(toast.error).toHaveBeenCalledWith(
			'Could not refresh this month’s spending; showing the last saved figures.'
		);
	});

	it('reports a failed load and shows the empty state rather than loading forever', async () => {
		mocks.budgetPerformance.mockRejectedValue(new Error('boom'));
		render(<BudgetPerformanceCard />);

		// The empty state is not there when the toast fires: the failed load sets the list to empty,
		// and only then is the month refreshed and rendered. Wait for what is asserted, not for the toast.
		expect(await screen.findByText('No budgets for October 2026.')).toBeInTheDocument();
		expect(toast.error).toHaveBeenCalledWith('boom');
	});
});
