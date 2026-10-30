import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const mocks = vi.hoisted(() => ({ key: {} as CryptoKey }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/context/SessionContext', () => ({
	useSession: () => ({ getEncryptionKey: () => mocks.key })
}));

import { EditTransactionDialog } from '../../src/components/EditTransactionDialog';

// Saving goes through real AES-GCM and IndexedDB writes; allow for a loaded machine.
configure({ asyncUtilTimeout: 5_000 });

describe('EditTransactionDialog on a one-sided transfer', () => {
	vi.setConfig({ testTimeout: 30_000 });

	beforeEach(async () => {
		vi.clearAllMocks();
		await db.delete();
		await db.open();
		mocks.key = await deriveEncryptionKey('4242', randomSaltBase64());
	});

	it('keeps it a transfer when only its note is changed, instead of turning it into an expense', async () => {
		const user = userEvent.setup();
		const account = await AccountRepository.create(mocks.key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100_000,
			creditLimit: null,
			billingCycleDay: null
		});
		// What is left of a loan once the person it was lent to is deleted: no pair, and no record holds it.
		const orphan = await TransactionEngine.recordTransaction(mocks.key, {
			accountId: account.id,
			date: '2026-09-10',
			amount: -5_000,
			type: 'transfer',
			transferPairId: null,
			notes: 'Lent to Ravi'
		});
		const onSaved = vi.fn();
		render(
			<EditTransactionDialog
				transaction={orphan}
				accounts={[account]}
				categories={[]}
				merchants={[]}
				onOpenChange={vi.fn()}
				onSaved={onSaved}
				onRecordAsTransfer={vi.fn()}
			/>
		);

		expect(await screen.findByText(/one-sided movement of money/)).toBeInTheDocument();
		expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();

		await user.clear(screen.getByLabelText('Notes'));
		await user.type(screen.getByLabelText('Notes'), 'Lent to Ravi (Diwali)');
		await user.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		const saved = await TransactionRepository.getById(mocks.key, orphan.id);
		expect(saved).toMatchObject({
			type: 'transfer',
			amount: -5_000,
			notes: 'Lent to Ravi (Diwali)'
		});
		expect((await AccountRepository.getById(mocks.key, account.id))?.currentBalance).toBe(95_000);
	});
});
