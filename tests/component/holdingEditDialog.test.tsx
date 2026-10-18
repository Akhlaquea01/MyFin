import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../src/data/dexie/db';
import { InvestmentHoldingRepository } from '../../src/data/dexie/wealthRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const mocks = vi.hoisted(() => ({ key: {} as CryptoKey }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/context/SessionContext', () => ({
	useSession: () => ({ getEncryptionKey: () => mocks.key })
}));

import { toast } from 'sonner';
import { HoldingEditDialog } from '../../src/components/HoldingEditDialog';

// Saving goes through real AES-GCM and IndexedDB writes. Alone that takes a few hundred ms; with the
// full suite running in parallel the first test has taken 3+ s, so wait up to 5 s for the save
// (Testing Library's default is 1 s) and let a test run for 30 s (Vitest's default is 5 s).
configure({ asyncUtilTimeout: 5_000 });

describe('HoldingEditDialog', () => {
	vi.setConfig({ testTimeout: 30_000 });

	beforeEach(async () => {
		vi.clearAllMocks();
		await db.delete();
		await db.open();
		mocks.key = await deriveEncryptionKey('4242', randomSaltBase64());
	});

	it('lets a holding that only has a cost basis be given its units, keeping the cost as entered', async () => {
		const user = userEvent.setup();
		const legacy = await InvestmentHoldingRepository.create(mocks.key, {
			name: 'Old gold',
			type: 'other',
			costBasis: 50_000
		});
		const onChanged = vi.fn();
		render(<HoldingEditDialog holding={legacy} onOpenChange={vi.fn()} onChanged={onChanged} />);

		await user.type(screen.getByLabelText('Units held (optional)'), '4');
		await user.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => expect(onChanged).toHaveBeenCalled());
		expect(await InvestmentHoldingRepository.getById(mocks.key, legacy.id)).toMatchObject({
			units: 4,
			avgPrice: 12_500,
			costBasis: 50_000
		});
	});

	it('keeps a holding without units as it is when the units are left blank', async () => {
		const user = userEvent.setup();
		const legacy = await InvestmentHoldingRepository.create(mocks.key, {
			name: 'Old gold',
			type: 'other',
			costBasis: 50_000
		});
		const onChanged = vi.fn();
		render(<HoldingEditDialog holding={legacy} onOpenChange={vi.fn()} onChanged={onChanged} />);

		await user.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => expect(onChanged).toHaveBeenCalled());
		const saved = await InvestmentHoldingRepository.getById(mocks.key, legacy.id);
		expect(saved?.units).toBeUndefined();
		expect(saved?.costBasis).toBe(50_000);
	});

	it('asks for units that make sense rather than saving none or a negative number', async () => {
		const user = userEvent.setup();
		const legacy = await InvestmentHoldingRepository.create(mocks.key, {
			name: 'Old gold',
			type: 'other',
			costBasis: 50_000
		});
		render(<HoldingEditDialog holding={legacy} onOpenChange={vi.fn()} onChanged={vi.fn()} />);

		await user.type(screen.getByLabelText('Units held (optional)'), '-2');
		await user.click(screen.getByRole('button', { name: 'Save changes' }));

		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(
			(await InvestmentHoldingRepository.getById(mocks.key, legacy.id))?.units
		).toBeUndefined();
	});

	it('shows the cost basis as it is stored when the units and price are untouched', async () => {
		const exact = await InvestmentHoldingRepository.create(mocks.key, {
			name: 'Fund',
			type: 'mutual_fund',
			units: 10,
			avgPrice: 10_002, // 10 x 100.02 would say 1,000.20; 1,000.17 was actually paid
			costBasis: 100_017
		});
		render(<HoldingEditDialog holding={exact} onOpenChange={vi.fn()} onChanged={vi.fn()} />);

		expect(await screen.findByText(/Cost basis: ₹1,000\.17/)).toBeInTheDocument();
		expect(screen.queryByLabelText('Units held (optional)')).not.toBeInTheDocument();
	});
});
