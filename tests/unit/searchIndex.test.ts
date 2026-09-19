import { describe, it, expect } from 'vitest';
import { buildSearchIndex, querySearchIndex } from '../../src/domain/search/searchIndex';
import type { Transaction, Merchant, Account } from '../../src/domain/entities';

function tx(overrides: Partial<Transaction>): Transaction {
	return {
		id: 'tx-1',
		accountId: 'acc-1',
		date: '2026-06-01',
		amount: -1000,
		type: 'expense',
		transferPairId: null,
		merchantId: null,
		notes: null,
		source: 'manual',
		reviewStatus: 'confirmed',
		duplicateOfId: null,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...overrides
	};
}

function merchant(overrides: Partial<Merchant>): Merchant {
	return {
		id: 'm-1',
		name: 'Amazon',
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...overrides
	};
}

function account(overrides: Partial<Account>): Account {
	return {
		id: 'a-1',
		name: 'Checking',
		type: 'bank',
		openingBalance: 0,
		currentBalance: 50000,
		creditLimit: null,
		billingCycleDay: null,
		isArchived: false,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...overrides
	};
}

describe('Search index', () => {
	it('groups results by type', () => {
		const index = buildSearchIndex(
			[tx({ id: 'tx-1', notes: 'Groceries run' })],
			[merchant({ id: 'm-1', name: 'Amazon' })],
			[account({ id: 'a-1', name: 'Checking' })]
		);
		expect(index.map((e) => e.type).sort()).toEqual(['account', 'payee', 'transaction']);
	});

	it('excludes soft-deleted rows from the index', () => {
		const index = buildSearchIndex(
			[tx({ id: 'tx-1', notes: 'Deleted one', deletedAt: 123 })],
			[],
			[]
		);
		expect(index).toHaveLength(0);
	});

	it('matches a case-insensitive substring', () => {
		const index = buildSearchIndex([], [merchant({ id: 'm-1', name: 'Amazon Prime' })], []);
		const results = querySearchIndex(index, 'amazon');
		expect(results).toHaveLength(1);
		expect(results[0].label).toBe('Amazon Prime');
	});

	it('ranks a prefix match above a mid-string substring match', () => {
		const index = buildSearchIndex(
			[],
			[merchant({ id: 'm-1', name: 'Zebra Store' }), merchant({ id: 'm-2', name: 'Amazon' })],
			[]
		);
		const results = querySearchIndex(index, 'a');
		// "Amazon" starts with "a" (prefix), "Zebra Store" only contains "a" mid-string.
		expect(results[0].label).toBe('Amazon');
	});

	it('caps results at the given limit', () => {
		const merchants = Array.from({ length: 30 }, (_, i) =>
			merchant({ id: `m-${i}`, name: `Store ${i}` })
		);
		const index = buildSearchIndex([], merchants, []);
		const results = querySearchIndex(index, 'store', 5);
		expect(results).toHaveLength(5);
	});

	it('returns no results for an empty query', () => {
		const index = buildSearchIndex([], [merchant({ id: 'm-1', name: 'Amazon' })], []);
		expect(querySearchIndex(index, '')).toHaveLength(0);
	});

	it('uses the shared transaction label rule (notes over merchant over placeholder)', () => {
		const index = buildSearchIndex(
			[
				tx({ id: 'tx-1', notes: 'Rent payment' }),
				tx({ id: 'tx-2', notes: null, merchantId: 'm-1' })
			],
			[merchant({ id: 'm-1', name: 'Landlord Co' })],
			[]
		);
		const byId = new Map(index.map((e) => [e.id, e]));
		expect(byId.get('tx-1')?.label).toBe('Rent payment');
		expect(byId.get('tx-2')?.label).toBe('Landlord Co');
	});
});
