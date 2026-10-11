import { describe, it, expect } from 'vitest';
import { matchCaptureAccount } from '../../src/domain/capture/accountMatcher';
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
		deletedAt: null,
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
});
