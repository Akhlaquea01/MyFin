import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuplicateCompare } from '../../src/components/DuplicateCompare';
import type { CaptureInfo, Merchant, Transaction } from '../../src/domain/entities';

const merchants: Merchant[] = [{ id: 'm1', name: 'Swiggy', createdAt: 0, updatedAt: 0 }];

const original = {
	id: 'o',
	accountId: 'a',
	date: '2026-10-05',
	amount: -25_000,
	type: 'expense',
	merchantId: 'm1',
	notes: null,
	reviewStatus: 'confirmed',
	duplicateOfId: null,
	transferPairId: null,
	createdAt: 0,
	updatedAt: 0
} as Transaction;

function setup(overrides: Partial<React.ComponentProps<typeof DuplicateCompare>> = {}) {
	const onKeepBoth = vi.fn();
	const onRemoveThis = vi.fn();
	render(
		<DuplicateCompare
			original={original}
			reason="same-amount"
			merchants={merchants}
			accountLabel={null}
			busy={false}
			onKeepBoth={onKeepBoth}
			onRemoveThis={onRemoveThis}
			{...overrides}
		/>
	);
	return { onKeepBoth, onRemoveThis };
}

describe('DuplicateCompare', () => {
	it('shows the entry it looks like: what, how much, when and whether it is settled', () => {
		setup();
		expect(screen.getByText('Swiggy')).toBeInTheDocument();
		expect(screen.getByText('-₹250.00')).toBeInTheDocument();
		expect(screen.getByText(/2026-10-05 · confirmed/)).toBeInTheDocument();
	});

	it('says the other entry is still waiting, and names its account only when given', () => {
		setup({ original: { ...original, reviewStatus: 'unreviewed' }, accountLabel: 'HDFC' });
		expect(screen.getByText(/2026-10-05 · HDFC · waiting in Review/)).toBeInTheDocument();
	});

	it.each([
		['same-reference', /same bank reference number/i],
		['same-time', /within minutes of each other/i],
		['same-merchant', /same amount and merchant/i],
		['same-amount', /could still be a separate purchase/i]
	] as const)('explains a %s match in plain words', (reason, text) => {
		setup({ reason });
		expect(screen.getByText(text)).toBeInTheDocument();
	});

	it('shows when each message arrived and who sent it, so the two can be told apart', () => {
		const capture = (sender: string, receivedAt: number, txnAt?: number): CaptureInfo => ({
			channel: 'sms',
			sender,
			receivedAt,
			txnAt,
			text: 'x'
		});
		setup({
			original: { ...original, capture: capture('VM-HDFCBK', Date.UTC(2026, 9, 5, 13, 59, 33)) },
			duplicate: {
				...original,
				id: 'd',
				capture: capture('AX-AXISBK', Date.UTC(2026, 9, 5, 14, 1, 2), Date.UTC(2026, 9, 5, 14, 0))
			}
		});
		expect(screen.getByTestId('duplicate-original-message')).toHaveTextContent(
			/Already filed: SMS from VM-HDFCBK · received/
		);
		expect(screen.getByTestId('duplicate-new-message')).toHaveTextContent(
			/This one: SMS from AX-AXISBK · received .*payment time/
		);
	});

	it('shows no message lines for entries that were not captured', () => {
		setup();
		expect(screen.queryByTestId('duplicate-original-message')).toBeNull();
		expect(screen.queryByTestId('duplicate-new-message')).toBeNull();
	});

	it('offers to keep both or to remove the new one', async () => {
		const user = userEvent.setup();
		const { onKeepBoth, onRemoveThis } = setup();
		await user.click(screen.getByRole('button', { name: 'Keep both' }));
		expect(onKeepBoth).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole('button', { name: 'Same payment — remove this one' }));
		expect(onRemoveThis).toHaveBeenCalledTimes(1);
	});

	it('disables both actions while the entry is busy', () => {
		setup({ busy: true });
		expect(screen.getByRole('button', { name: 'Keep both' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Same payment — remove this one' })).toBeDisabled();
	});
});
