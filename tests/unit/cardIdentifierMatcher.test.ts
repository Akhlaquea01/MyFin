import { describe, it, expect } from 'vitest';
import { findCardMatches } from '../../src/domain/parser/cardIdentifierMatcher';
import type { Account } from '../../src/domain/entities';

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: 'acc-1',
		name: 'HDFC Card',
		type: 'credit_card',
		openingBalance: 0,
		currentBalance: 0,
		creditLimit: null,
		billingCycleDay: null,
		isArchived: false,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...overrides
	};
}

// spec 017, FR-019/FR-020: generic last-4/nickname matching against pasted/imported text, no
// bank-specific parsing.
describe('findCardMatches', () => {
	it('matches a last-4 identifier at a word-ish boundary', () => {
		const acc = account({ cardLast4: '4321' });
		expect(findCardMatches('Spent Rs.500 on card ending 4321', [acc])).toEqual([
			{ accountId: acc.id, accountName: acc.name, matchedIdentifier: '4321', matchType: 'last4' }
		]);
		expect(findCardMatches('**** **** **** 4321 debited', [acc])).toHaveLength(1);
	});

	it('does not match a last-4 identifier embedded inside a longer digit run', () => {
		const acc = account({ cardLast4: '4321' });
		// A 16-digit masked PAN that happens to contain "4321" but not as its own standalone
		// 4-digit group.
		expect(findCardMatches('Card 1234432112340000 charged', [acc])).toEqual([]);
	});

	it('matches a nickname case-insensitively as a substring', () => {
		const acc = account({ cardNickname: 'Amazon Pay ICICI', cardLast4: null });
		expect(findCardMatches('debited from amazon pay icici card', [acc])).toEqual([
			{
				accountId: acc.id,
				accountName: acc.name,
				matchedIdentifier: 'Amazon Pay ICICI',
				matchType: 'nickname'
			}
		]);
	});

	it('counts an account matching by both last4 and nickname once, preferring last4', () => {
		const acc = account({ cardLast4: '4321', cardNickname: 'Amazon Card' });
		const matches = findCardMatches('Amazon Card ending 4321 charged', [acc]);
		expect(matches).toHaveLength(1);
		expect(matches[0].matchType).toBe('last4');
	});

	it('returns one entry per distinct matching account when multiple tagged cards match', () => {
		const first = account({ id: 'acc-1', name: 'HDFC Card', cardLast4: '4321' });
		const second = account({ id: 'acc-2', name: 'ICICI Card', cardLast4: '8765' });
		const matches = findCardMatches('4321 and 8765 both appear here', [first, second]);
		expect(matches.map((m) => m.accountId).sort()).toEqual(['acc-1', 'acc-2']);
	});

	it('never matches an untagged account or a non-credit_card account', () => {
		const untagged = account({ cardLast4: null, cardNickname: null });
		const bank = account({ id: 'acc-2', type: 'bank', cardLast4: '4321' });
		expect(findCardMatches('ending 4321', [untagged, bank])).toEqual([]);
	});

	it('returns no matches for empty text or an empty account list', () => {
		const acc = account({ cardLast4: '4321' });
		expect(findCardMatches('', [acc])).toEqual([]);
		expect(findCardMatches('ending 4321', [])).toEqual([]);
	});
});
