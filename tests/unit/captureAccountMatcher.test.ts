import { describe, it, expect } from 'vitest';
import { findAccountMatches, matchCaptureAccount } from '../../src/domain/capture/accountMatcher';
import type { Account } from '../../src/domain/entities';

function account(id: string, overrides: Partial<Account> = {}): Account {
	return {
		id,
		name: id,
		type: 'bank',
		openingBalance: 0,
		currentBalance: 0,
		creditLimit: null,
		billingCycleDay: null,
		isArchived: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

const tails = (accountTail: string | null, cardTail: string | null = null) => ({
	accountTail,
	cardTail
});

describe('matchCaptureAccount', () => {
	const hdfc = account('hdfc', { accountLast4: '1234' });
	const icici = account('icici', { accountLast4: '9876' });
	const card = account('card', { type: 'credit_card', cardLast4: '5678' });
	const all = [hdfc, icici, card];

	it('picks the one account whose digits the message names', () => {
		expect(matchCaptureAccount(tails('1234'), all, 'icici')).toEqual({
			accountId: 'hdfc',
			how: 'tail',
			accountCheck: null,
			tailHint: null
		});
	});

	it('matches a card by the digits after "card"', () => {
		expect(matchCaptureAccount(tails(null, '5678'), all, 'icici')).toMatchObject({
			accountId: 'card',
			how: 'card-tail',
			accountCheck: null
		});
	});

	it('matches a debit card tagged on a bank account', () => {
		const withDebit = account('hdfc', { accountLast4: '1234', cardLast4: '4321' });
		expect(matchCaptureAccount(tails(null, '4321'), [withDebit], null)?.accountId).toBe('hdfc');
	});

	it('lets a three-digit tail find a four-digit tag, and the reverse', () => {
		expect(matchCaptureAccount(tails('876'), all, null)?.accountId).toBe('icici');
		const threeDigitTag = account('short', { accountLast4: '987' });
		expect(matchCaptureAccount(tails('0987'), [threeDigitTag], null)?.accountId).toBe('short');
	});

	it('falls back to the default account and says the digits matched nothing', () => {
		expect(matchCaptureAccount(tails('0000'), all, 'icici')).toEqual({
			accountId: 'icici',
			how: 'default',
			accountCheck: 'unmatched-tail',
			tailHint: '0000'
		});
	});

	it('falls back to the default account without a hint when the message names no account', () => {
		expect(matchCaptureAccount(tails(null), all, 'icici')).toEqual({
			accountId: 'icici',
			how: 'default',
			accountCheck: 'default-account',
			tailHint: null
		});
	});

	it('does not guess between two accounts that both fit', () => {
		const clash = [account('a', { accountLast4: '1234' }), account('b', { accountLast4: '1234' })];
		expect(matchCaptureAccount(tails('1234'), clash, 'a')).toMatchObject({
			accountId: 'a',
			how: 'default',
			accountCheck: 'default-account'
		});
	});

	it('ignores archived accounts, including as the default', () => {
		const archived = account('old', { accountLast4: '1234', isArchived: true });
		expect(matchCaptureAccount(tails('1234'), [archived, icici], 'icici')).toMatchObject({
			accountId: 'icici',
			accountCheck: 'unmatched-tail'
		});
		expect(matchCaptureAccount(tails('1234'), [archived], 'old')).toBeNull();
	});

	it('returns null when nothing matches and there is no usable default', () => {
		expect(matchCaptureAccount(tails('0000'), all, null)).toBeNull();
		expect(matchCaptureAccount(tails('0000'), all, 'gone')).toBeNull();
	});

	it('prefers the bank account over a card that happens to share the digits', () => {
		const bank = account('bank', { accountLast4: '1234' });
		const sameDigitsCard = account('visa', { type: 'credit_card', cardLast4: '1234' });
		expect(matchCaptureAccount(tails('1234'), [sameDigitsCard, bank], 'visa')).toMatchObject({
			accountId: 'bank',
			how: 'tail',
			accountCheck: null
		});
	});

	it('uses a card tagged with the digits when no bank account carries them', () => {
		const sameDigitsCard = account('visa', { type: 'credit_card', cardLast4: '1234' });
		expect(matchCaptureAccount(tails('1234'), [icici, sameDigitsCard], 'icici')).toMatchObject({
			accountId: 'visa',
			how: 'tail'
		});
	});

	it('prefers the longer overlap when a three-digit and a four-digit tag both fit', () => {
		const short = account('short', { accountLast4: '234' });
		const long = account('long', { accountLast4: '1234' });
		expect(matchCaptureAccount(tails('1234'), [short, long], null)?.accountId).toBe('long');
	});

	it('keeps the digits as a hint when several accounts fit', () => {
		const clash = [account('a', { accountLast4: '1234' }), account('b', { accountLast4: '1234' })];
		expect(matchCaptureAccount(tails('1234'), clash, 'a')?.tailHint).toBe('1234');
	});
});

describe('findAccountMatches', () => {
	const savings = account('savings', { name: 'HDFC Savings', accountLast4: '1234' });
	const card = account('card', { name: 'ICICI Card', type: 'credit_card', cardLast4: '5678' });
	const all = [savings, card];

	it('finds a bank account named after "A/c" and says it is an account', () => {
		expect(findAccountMatches('Rs.500 debited from A/c XX1234 to SWIGGY', all)).toEqual([
			{
				accountId: 'savings',
				accountName: 'HDFC Savings',
				matchedIdentifier: '1234',
				matchType: 'account'
			}
		]);
	});

	it('finds a masked number with no "A/c" in front of it', () => {
		expect(
			findAccountMatches('Rs.500 debited from HDFC Bank XX1234', all).map((m) => m.accountId)
		).toEqual(['savings']);
	});

	it('keeps the credit-card match as a card match and does not list it twice', () => {
		const matches = findAccountMatches('Spent Rs.500 on card ending 5678', all);
		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ accountId: 'card', matchType: 'last4' });
	});

	it('returns both when the message names an account and a card', () => {
		const matches = findAccountMatches('Rs.500 from A/c XX1234 on card ending 5678', all);
		expect(matches.map((m) => m.accountId).sort()).toEqual(['card', 'savings']);
	});

	it('never reads an amount as an account number', () => {
		expect(findAccountMatches('Paid Rs 1234.00 to SWIGGY', all)).toEqual([]);
	});

	it('ignores archived accounts', () => {
		const archived = account('old', { accountLast4: '1234', isArchived: true });
		expect(findAccountMatches('debited from A/c XX1234', [archived])).toEqual([]);
	});
});
