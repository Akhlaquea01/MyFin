import { describe, it, expect } from 'vitest';
import { formatTransactionLabel } from '../../src/domain/transactions/transactionLabel';
import type { Merchant } from '../../src/domain/entities';

function merchant(overrides: Partial<Merchant> = {}): Merchant {
	return {
		id: 'merch-1',
		name: 'Cafe Coffee Day',
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...overrides
	};
}

// spec 018, User Story 3 (FR-012/FR-013/FR-014): notes > merchant name > neutral placeholder;
// `type` is never read. See contracts/transaction-label.md.
describe('formatTransactionLabel', () => {
	it('returns notes verbatim when present, regardless of merchantId', () => {
		const merchants = [merchant()];
		expect(
			formatTransactionLabel({ notes: 'Split with roommate', merchantId: 'merch-1' }, merchants)
		).toBe('Split with roommate');
	});

	it('returns the resolved merchant name when there are no notes', () => {
		const merchants = [merchant({ id: 'merch-1', name: 'Cafe Coffee Day' })];
		expect(formatTransactionLabel({ notes: null, merchantId: 'merch-1' }, merchants)).toBe(
			'Cafe Coffee Day'
		);
	});

	it('returns the placeholder when there are no notes and no merchantId', () => {
		expect(formatTransactionLabel({ notes: null, merchantId: null }, [])).toBe(
			'Unlabeled transaction'
		);
	});

	it('returns the placeholder when merchantId does not resolve to a known merchant', () => {
		expect(formatTransactionLabel({ notes: null, merchantId: 'missing' }, [merchant()])).toBe(
			'Unlabeled transaction'
		);
	});

	it('treats an empty-string notes value the same as absent notes', () => {
		const merchants = [merchant({ name: 'Amazon' })];
		expect(formatTransactionLabel({ notes: '', merchantId: 'merch-1' }, merchants)).toBe('Amazon');
	});

	it('reflects the current merchant name, not a stale copy, when merchants is re-fetched after a rename', () => {
		const before = [merchant({ name: 'Old Name' })];
		const after = [merchant({ name: 'New Name' })];
		const tx = { notes: null, merchantId: 'merch-1' };
		expect(formatTransactionLabel(tx, before)).toBe('Old Name');
		expect(formatTransactionLabel(tx, after)).toBe('New Name');
	});
});
